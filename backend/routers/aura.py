from fastapi import APIRouter, HTTPException, Request, Body, Depends
from typing import Optional
import logging

from auth import get_current_user
from rate_limit import limiter

logger = logging.getLogger("bpp.aura")
router = APIRouter()


@router.get("/aura/{user_id}")
@limiter.limit("30/minute")
async def get_aura(request: Request, user_id: str):
    """Public endpoint: get a user's aura score and recent events."""
    supabase = request.app.state.supabase

    # Get cached score
    user_resp = supabase.table("users").select("username,aura_score").eq("id", user_id).execute()
    if not user_resp.data:
        raise HTTPException(status_code=404, detail="User not found")

    user = user_resp.data[0]

    # Get last 10 events
    events_resp = supabase.table("aura_events").select(
        "event_type,points,created_at,bill_id"
    ).eq("user_id", user_id).order("created_at", desc=True).limit(10).execute()

    return {
        "user_id": user_id,
        "username": user.get("username", "Unknown"),
        "aura_score": user.get("aura_score", 500),
        "recent_events": events_resp.data or [],
    }


@router.get("/aura/leaderboard/top")
async def aura_leaderboard(request: Request):
    """Public endpoint: top 20 users by aura score."""
    supabase = request.app.state.supabase
    resp = supabase.table("users").select(
        "id,username,aura_score"
    ).order("aura_score", desc=True).limit(20).execute()

    return {"leaderboard": resp.data or []}


@router.post("/aura/record")
@limiter.limit("10/minute")
async def record_aura_event(
    request: Request,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """
    Record an aura event. Called by frontend after key actions.
    Expects: target_user_id, event_type, bill_id (optional)
    Only the authenticated user can record events for themselves,
    OR any user can record negative events for others (nudge, dodge).
    """
    supabase = request.app.state.supabase
    target_user_id = payload.get("target_user_id")
    event_type = payload.get("event_type")
    bill_id = payload.get("bill_id")

    if not target_user_id or not event_type:
        raise HTTPException(status_code=400, detail="target_user_id and event_type required")

    POINT_MAP = {
        "fast_payment": 50,
        "normal_payment": 20,
        "slow_payment": -10,
        "nudge_received": -30,
        "multi_nudge": -50,
        "dodge_attempt": -100,
        "hosted_bill": 40,
        "fast_claim": 10,
        "roulette_loser": -20,
        "payment_cleared": 15,
        "streak_bonus": 25,
    }

    if event_type not in POINT_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid event_type: {event_type}")

    # Positive events: only the user themselves can record
    # Negative events: anyone can record (for nudges, etc.)
    points = POINT_MAP[event_type]
    if points > 0 and user["user_id"] != target_user_id:
        raise HTTPException(status_code=403, detail="Cannot record positive events for other users")

    row = {
        "user_id": target_user_id,
        "event_type": event_type,
        "points": points,
        "metadata": {"recorded_by": user["user_id"]},
    }
    if bill_id:
        row["bill_id"] = bill_id

    try:
        supabase.table("aura_events").insert(row).execute()
    except Exception as e:
        logger.error(f"[aura] Failed to record event: {e}")
        raise HTTPException(status_code=500, detail="Failed to record aura event")

    return {"success": True, "event_type": event_type, "points": points}
