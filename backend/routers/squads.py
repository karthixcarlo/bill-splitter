from fastapi import APIRouter, HTTPException, Request, Body, Depends
from typing import List
import logging

from auth import get_current_user
from rate_limit import limiter

logger = logging.getLogger("bpp.squads")
router = APIRouter()


@router.post("/squads/create")
@limiter.limit("5/minute")
async def create_squad(
    request: Request,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """Create a squad and add creator as admin + invited members."""
    supabase = request.app.state.supabase
    name = payload.get("name", "").strip()
    emoji = payload.get("emoji", "🍕")
    member_ids: List[str] = payload.get("member_ids", [])

    if not name:
        raise HTTPException(status_code=400, detail="Squad name required")
    if len(name) > 30:
        raise HTTPException(status_code=400, detail="Squad name too long (max 30)")

    creator_id = user["user_id"]

    # Create squad
    squad_resp = supabase.table("squads").insert({
        "name": name,
        "emoji": emoji,
        "created_by": creator_id,
    }).execute()

    if not squad_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create squad")

    squad_id = squad_resp.data[0]["id"]

    # Add creator as admin
    members = [{"squad_id": squad_id, "user_id": creator_id, "role": "admin"}]
    for mid in member_ids:
        if mid != creator_id:
            members.append({"squad_id": squad_id, "user_id": mid, "role": "member"})

    supabase.table("squad_members").insert(members).execute()
    logger.info(f"[squad] Created {squad_id} with {len(members)} members")

    return {"success": True, "squad_id": squad_id}


@router.get("/squads/my")
@limiter.limit("20/minute")
async def get_my_squads(request: Request, user: dict = Depends(get_current_user)):
    """Get all squads the user belongs to, with member info."""
    supabase = request.app.state.supabase
    uid = user["user_id"]

    # Get squad IDs
    memberships = supabase.table("squad_members").select("squad_id").eq("user_id", uid).execute()
    squad_ids = [m["squad_id"] for m in (memberships.data or [])]
    if not squad_ids:
        return {"squads": []}

    # Fetch squads
    squads_resp = supabase.table("squads").select("*").in_("id", squad_ids).execute()

    # Fetch all members for these squads with usernames + aura
    members_resp = supabase.table("squad_members").select(
        "squad_id,user_id,role,users(username,aura_score)"
    ).in_("squad_id", squad_ids).execute()

    # Group members by squad
    members_by_squad = {}
    for m in (members_resp.data or []):
        sid = m["squad_id"]
        if sid not in members_by_squad:
            members_by_squad[sid] = []
        u = m.get("users") or {}
        members_by_squad[sid].append({
            "user_id": m["user_id"],
            "role": m["role"],
            "username": u.get("username", "Unknown"),
            "aura_score": u.get("aura_score", 500),
        })

    result = []
    for s in (squads_resp.data or []):
        result.append({
            **s,
            "members": members_by_squad.get(s["id"], []),
        })

    return {"squads": result}


@router.get("/squads/{squad_id}")
@limiter.limit("20/minute")
async def get_squad(request: Request, squad_id: str, user: dict = Depends(get_current_user)):
    """Get squad details, members, and ledger summary."""
    supabase = request.app.state.supabase
    uid = user["user_id"]

    # Verify membership
    membership = supabase.table("squad_members").select("id").eq("squad_id", squad_id).eq("user_id", uid).execute()
    if not membership.data:
        raise HTTPException(status_code=403, detail="Not a member of this squad")

    # Squad info
    squad_resp = supabase.table("squads").select("*").eq("id", squad_id).execute()
    if not squad_resp.data:
        raise HTTPException(status_code=404, detail="Squad not found")

    # Members
    members_resp = supabase.table("squad_members").select(
        "user_id,role,users(username,aura_score)"
    ).eq("squad_id", squad_id).execute()

    members = []
    for m in (members_resp.data or []):
        u = m.get("users") or {}
        members.append({
            "user_id": m["user_id"],
            "role": m["role"],
            "username": u.get("username", "Unknown"),
            "aura_score": u.get("aura_score", 500),
        })

    # Ledger — unsettled balances
    ledger_resp = supabase.table("squad_ledger").select(
        "from_user_id,to_user_id,amount,description,bill_id,created_at"
    ).eq("squad_id", squad_id).eq("settled", False).order("created_at", desc=True).execute()

    # Compute net balances
    balances = {}  # user_id -> net amount (positive = owed money, negative = owes money)
    for entry in (ledger_resp.data or []):
        from_u = entry["from_user_id"]
        to_u = entry["to_user_id"]
        amt = float(entry["amount"])
        balances[from_u] = balances.get(from_u, 0) - amt
        balances[to_u] = balances.get(to_u, 0) + amt

    balance_list = []
    for m in members:
        balance_list.append({
            "user_id": m["user_id"],
            "username": m["username"],
            "aura_score": m["aura_score"],
            "net_balance": round(balances.get(m["user_id"], 0), 2),
        })

    # Leaderboard stats — most hosted, most paid, highest aura
    leaderboard = sorted(members, key=lambda m: m["aura_score"], reverse=True)

    return {
        **squad_resp.data[0],
        "members": members,
        "balances": balance_list,
        "leaderboard": leaderboard,
        "recent_ledger": ledger_resp.data or [],
    }


@router.post("/squads/{squad_id}/add-members")
@limiter.limit("10/minute")
async def add_members(
    request: Request,
    squad_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """Add members to a squad (admin only)."""
    supabase = request.app.state.supabase
    uid = user["user_id"]

    # Verify admin
    admin_check = supabase.table("squad_members").select("role").eq("squad_id", squad_id).eq("user_id", uid).execute()
    if not admin_check.data or admin_check.data[0]["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can add members")

    member_ids = payload.get("member_ids", [])
    if not member_ids:
        raise HTTPException(status_code=400, detail="No members to add")

    rows = [{"squad_id": squad_id, "user_id": mid, "role": "member"} for mid in member_ids]
    try:
        supabase.table("squad_members").insert(rows).execute()
    except Exception as e:
        logger.error(f"[squad] Add members error: {e}")

    return {"success": True, "added": len(rows)}


@router.delete("/squads/{squad_id}/leave")
@limiter.limit("5/minute")
async def leave_squad(request: Request, squad_id: str, user: dict = Depends(get_current_user)):
    """Leave a squad."""
    supabase = request.app.state.supabase
    uid = user["user_id"]

    supabase.table("squad_members").delete().eq("squad_id", squad_id).eq("user_id", uid).execute()
    return {"success": True}


@router.post("/squads/{squad_id}/settle")
@limiter.limit("5/minute")
async def settle_debt(
    request: Request,
    squad_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """Mark all unsettled ledger entries between two users as settled."""
    supabase = request.app.state.supabase
    uid = user["user_id"]
    other_user_id = payload.get("other_user_id")
    if not other_user_id:
        raise HTTPException(status_code=400, detail="other_user_id required")

    # Settle entries in both directions
    supabase.table("squad_ledger").update({"settled": True}).eq(
        "squad_id", squad_id
    ).eq("from_user_id", uid).eq("to_user_id", other_user_id).eq("settled", False).execute()

    supabase.table("squad_ledger").update({"settled": True}).eq(
        "squad_id", squad_id
    ).eq("from_user_id", other_user_id).eq("to_user_id", uid).eq("settled", False).execute()

    return {"success": True}
