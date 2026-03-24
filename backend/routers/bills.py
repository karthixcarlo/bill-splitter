from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Form, Body, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
from uuid import UUID
import json
import re
import logging

from auth import get_current_user
from rate_limit import limiter

logger = logging.getLogger("bpp.bills")
router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MAGIC = {
    b'\xFF\xD8\xFF': 'image/jpeg',
    b'\x89PNG': 'image/png',
    b'GIF8': 'image/gif',
    b'RIFF': 'image/webp',
}


def validate_image(data: bytes) -> str:
    """Validate image file by magic bytes. Returns mime type."""
    for magic, mime in ALLOWED_IMAGE_MAGIC.items():
        if data[:len(magic)] == magic:
            return mime
    raise HTTPException(status_code=400, detail="Invalid image format. Upload JPEG, PNG, GIF, or WebP.")


class BillItem(BaseModel):
    name: str = Field(..., max_length=200)
    quantity: int = Field(..., ge=1, le=999)
    price_per_unit: float = Field(..., ge=0)
    total_price: float = Field(..., ge=0)


class ParsedBill(BaseModel):
    items: List[BillItem]
    tax_amount: float = Field(..., ge=0)
    service_charge: float = Field(..., ge=0)
    total: float = Field(..., ge=0)
    restaurant_name: Optional[str] = None


@router.post("/parse-bill")
@limiter.limit("5/minute")
async def parse_bill(
    request: Request,
    file: UploadFile = File(...),
    host_id: str = Form(...),
    user: dict = Depends(get_current_user),
):
    gemini = request.app.state.gemini
    if not gemini:
        raise HTTPException(status_code=503, detail="Gemini AI client not configured. Check GEMINI_API_KEY.")

    # Verify the authenticated user matches the host_id claim
    if user["user_id"] != host_id:
        raise HTTPException(status_code=403, detail="Authenticated user does not match host_id.")

    logger.info(f"[parse-bill] file={file.filename} host={host_id}")
    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")

    # Validate file is actually an image
    detected_mime = validate_image(image_bytes)
    gemini_image = {'mime_type': detected_mime, 'data': image_bytes}

    prompt = """You are an expert at reading restaurant bill/receipt images.
Analyze this bill image and extract all line items.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "restaurant_name": "Restaurant Name or Unknown",
  "items": [
    {
      "name": "Item Name",
      "quantity": 1,
      "price_per_unit": 0.0,
      "total_price": 0.0
    }
  ],
  "tax_amount": 0.0,
  "service_charge": 0.0,
  "total": 0.0
}

Rules:
- quantity must be an integer >= 1
- all prices must be numbers (not strings)
- include ALL items from the bill
- if you cannot read a price clearly, use 0.0
- do NOT include "tax", "service charge", "GST", "tip" as items — those go in their own fields
- respond with ONLY the JSON, nothing else"""

    try:
        response = gemini.generate_content([prompt, gemini_image])
    except Exception as e:
        err = str(e)
        logger.error(f"[parse-bill] Gemini error: {err}")
        if "400" in err:
            raise HTTPException(status_code=400, detail="Could not read the image. Please upload a clear photo of a bill/receipt.")
        elif "429" in err:
            raise HTTPException(status_code=429, detail="AI is busy right now. Please wait a few seconds and try again.")
        elif "403" in err:
            raise HTTPException(status_code=403, detail="AI API key issue. Contact support.")
        else:
            raise HTTPException(status_code=500, detail="AI processing failed. Please try again.")

    if not response.text or not response.text.strip():
        raise HTTPException(status_code=500, detail="AI returned an empty response. Try a clearer image.")

    response_text = response.text.strip()
    response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)
    response_text = response_text.strip()

    try:
        parsed_data = json.loads(response_text)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if match:
            try:
                parsed_data = json.loads(match.group())
            except Exception:
                raise HTTPException(status_code=500, detail="AI response could not be parsed. Try a clearer photo.")
        else:
            raise HTTPException(status_code=500, detail="AI did not return structured data. Try a clearer photo.")

    if "items" not in parsed_data or not isinstance(parsed_data.get("items"), list):
        raise HTTPException(status_code=500, detail="AI could not find items in the bill. Upload a clearer image.")

    normalized_items = []
    for item in parsed_data["items"]:
        try:
            normalized_items.append({
                "name": str(item.get("name", "Unknown Item")),
                "quantity": int(item.get("quantity", 1)),
                "price_per_unit": float(item.get("price_per_unit", 0.0)),
                "total_price": float(item.get("total_price", 0.0)),
            })
        except (ValueError, TypeError):
            continue

    if not normalized_items:
        raise HTTPException(status_code=500, detail="No valid items extracted. Try a clearer image.")

    result = {
        "restaurant_name": str(parsed_data.get("restaurant_name", "Restaurant")),
        "items": normalized_items,
        "tax_amount": float(parsed_data.get("tax_amount", 0.0)),
        "service_charge": float(parsed_data.get("service_charge", 0.0)),
        "total": float(parsed_data.get("total", 0.0)),
    }
    logger.info(f"[parse-bill] OK — {len(normalized_items)} items, restaurant={result['restaurant_name']}")

    # Generate AI roast of the order using Gemini
    ai_roast = None
    try:
        item_summary = ", ".join(f"{i['name']} x{i['quantity']}" for i in normalized_items)
        total_str = f"₹{result['total']:.0f}"
        roast_prompt = f"""You are a brutally funny Gen Z food critic. A group of friends just ordered: {item_summary}. Total bill: {total_str} at {result['restaurant_name']}.

Generate a 2-sentence roast of their diet or spending habits using heavy Gen Z slang (e.g., 'skibidi', 'negative aura', 'locked in', 'cooked', 'no cap', 'rizz', 'bussin', 'mid'). Keep it funny and slightly aggressive. Do NOT use any markdown formatting. Just return the raw roast text."""

        roast_response = gemini.generate_content([roast_prompt])
        if roast_response.text and roast_response.text.strip():
            ai_roast = roast_response.text.strip()
            logger.info(f"[parse-bill] AI roast generated: {ai_roast[:80]}...")
    except Exception as roast_err:
        logger.warning(f"[parse-bill] Roast generation failed (non-fatal): {roast_err}")

    return {"success": True, "data": result, "bill_id": None, "ai_roast": ai_roast}


@router.post("/bills/save")
@limiter.limit("10/minute")
async def save_bill(request: Request, payload: dict = Body(...), user: dict = Depends(get_current_user)):
    """
    Persist a confirmed bill to Supabase.
    Expects: host_id, restaurant_name, items[], tax_amount, service_charge, participant_ids[]
    Returns: bill_id (UUID)
    """
    supabase = request.app.state.supabase

    host_id = payload.get("host_id")
    if not host_id:
        raise HTTPException(status_code=400, detail="host_id is required — user must be logged in.")

    # Verify authenticated user matches host_id
    if user["user_id"] != host_id:
        raise HTTPException(status_code=403, detail="Authenticated user does not match host_id.")

    # 1. Insert bill
    bill_row = {
        "host_id": host_id,
        "restaurant_name": payload.get("restaurant_name", "Restaurant"),
        "tax_amount": float(payload.get("tax_amount", 0.0)),
        "service_charge": float(payload.get("service_charge", 0.0)),
        "image_url": payload.get("image_url", ""),   # no image stored; Gemini parses in memory
        "status": "open",
    }
    # Persist AI roast if provided
    ai_roast = payload.get("ai_roast")
    if ai_roast:
        bill_row["ai_roast"] = ai_roast
    # Aura threshold gate
    min_aura = payload.get("min_aura_threshold", 0)
    if min_aura and int(min_aura) > 0:
        bill_row["min_aura_threshold"] = int(min_aura)
    bill_resp = supabase.table("bills").insert(bill_row).execute()
    if not bill_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create bill in database.")

    bill_id = bill_resp.data[0]["id"]
    logger.info(f"[save-bill] Created bill {bill_id}")

    # 2. Batch-insert bill_items
    items = payload.get("items", [])
    if items:
        item_rows = [
            {
                "bill_id": bill_id,
                "name": str(item.get("name", "Item")),
                "quantity": int(item.get("quantity", 1)),
                "price_per_unit": float(item.get("price_per_unit", 0.0)),
                "total_price": float(item.get("total_price", 0.0)),
            }
            for item in items
        ]
        supabase.table("bill_items").insert(item_rows).execute()
        logger.info(f"[save-bill] Inserted {len(item_rows)} items")

    # 3. Insert HOST as first participant immediately
    try:
        host_part_resp = supabase.table("participants").insert({"bill_id": bill_id, "user_id": host_id}).execute()
        logger.info(f"[save-bill] Added host as participant: {host_part_resp.data}")
    except Exception as e:
        logger.error(f"[save-bill] ERROR inserting host participant: {e}")

    # 4. Insert selected friend participants
    participant_ids = payload.get("participant_ids", [])
    logger.info(f"[save-bill] Received participant_ids: {participant_ids}")
    if participant_ids:
        participant_rows = [{"bill_id": bill_id, "user_id": uid} for uid in participant_ids if uid != host_id]
        logger.info(f"[save-bill] Inserting {len(participant_rows)} friend rows: {participant_rows}")
        if participant_rows:
            try:
                friends_resp = supabase.table("participants").insert(participant_rows).execute()
                logger.info(f"[save-bill] Friend participants inserted: {friends_resp.data}")
            except Exception as e:
                logger.error(f"[save-bill] ERROR inserting friend participants: {e}")
    else:
        logger.info(f"[save-bill] No friend participant_ids provided")

    # 5. Record aura event for hosting
    try:
        supabase.table("aura_events").insert({
            "user_id": host_id,
            "event_type": "hosted_bill",
            "points": 40,
            "bill_id": bill_id,
        }).execute()
    except Exception as e:
        logger.warning(f"[save-bill] Aura event failed (non-fatal): {e}")

    return {"success": True, "bill_id": bill_id}


@router.post("/bills/{bill_id}/audit")
@limiter.limit("10/minute")
async def audit_payment(
    request: Request,
    bill_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """
    Host-only: update a participant's payment_status (cleared/unpaid).
    Prevents participants from marking their own payment as cleared.
    """
    supabase = request.app.state.supabase
    target_user_id = payload.get("user_id")
    decision = payload.get("decision")

    if not target_user_id or decision not in ("cleared", "unpaid"):
        raise HTTPException(status_code=400, detail="user_id and decision ('cleared'|'unpaid') required")

    # Verify caller is the bill host
    bill_resp = supabase.table("bills").select("host_id").eq("id", bill_id).execute()
    if not bill_resp.data:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill_resp.data[0]["host_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the bill host can audit payments")

    supabase.table("participants").update(
        {"payment_status": decision}
    ).eq("bill_id", bill_id).eq("user_id", target_user_id).execute()

    return {"success": True, "user_id": target_user_id, "payment_status": decision}


@router.post("/bills/{bill_id}/mercy")
@limiter.limit("10/minute")
async def mercy_decision(
    request: Request,
    bill_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    """
    Host-only: grant or deny a mercy request.
    Grant sets payment_status to 'cleared'; deny resets to 'unpaid'.
    """
    supabase = request.app.state.supabase
    target_user_id = payload.get("user_id")
    decision = payload.get("decision")

    if not target_user_id or decision not in ("grant", "deny"):
        raise HTTPException(status_code=400, detail="user_id and decision ('grant'|'deny') required")

    # Verify caller is the bill host
    bill_resp = supabase.table("bills").select("host_id").eq("id", bill_id).execute()
    if not bill_resp.data:
        raise HTTPException(status_code=404, detail="Bill not found")
    if bill_resp.data[0]["host_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the bill host can decide mercy requests")

    if decision == "grant":
        update_data = {"payment_status": "cleared"}
    else:
        update_data = {"payment_status": "unpaid", "mercy_type": "none", "mercy_payload": None}

    supabase.table("participants").update(update_data).eq(
        "bill_id", bill_id
    ).eq("user_id", target_user_id).execute()

    return {"success": True, "user_id": target_user_id, "decision": decision}


@router.get("/bills/{bill_id}")
@limiter.limit("30/minute")
async def get_bill(request: Request, bill_id: str):
    """
    Fetch a bill with its items and the host's UPI VPA.
    Uses PostgREST embedded resource syntax to join users table.
    """
    supabase = request.app.state.supabase
    try:
        # Join users so the frontend gets host upi_vpa without a second round-trip
        bill_resp = supabase.table("bills").select("*,users(id,username,upi_vpa)").eq("id", bill_id).execute()
        if not bill_resp.data:
            raise HTTPException(status_code=404, detail="Bill not found")

        bill = bill_resp.data[0]
        items_resp = supabase.table("bill_items").select("*").eq("bill_id", bill_id).execute()

        # Fetch claims with claimer usernames so the UI can show "Claimed by [name]"
        claims_data = []
        item_ids = [item["id"] for item in (items_resp.data or [])]
        if item_ids:
            claims_resp = supabase.table("claims").select("item_id,user_id,share_fraction,users(id,username)").in_("item_id", item_ids).execute()
            for c in (claims_resp.data or []):
                user_info = c.get("users") or {}
                claims_data.append({
                    "item_id": c["item_id"],
                    "user_id": c["user_id"],
                    "username": user_info.get("username", "Someone"),
                    "share_fraction": c.get("share_fraction", 1.0),
                })

        # Fetch participants with escape requests, payment status, and mercy data
        participants_resp = supabase.table("participants").select("user_id,leave_requested,payment_status,mercy_type,mercy_payload,users(username,aura_score,snitch_name,snitch_phone)").eq("bill_id", bill_id).execute()
        escape_requests = []
        participants_list = []
        for p in (participants_resp.data or []):
            p_user = p.get("users") or {}
            participants_list.append({
                "user_id": p["user_id"],
                "username": p_user.get("username", "Someone"),
                "aura_score": p_user.get("aura_score", 500),
                "payment_status": p.get("payment_status", "unpaid"),
                "leave_requested": p.get("leave_requested", False),
                "mercy_type": p.get("mercy_type", "none"),
                "mercy_payload": p.get("mercy_payload"),
                "snitch_name": p_user.get("snitch_name"),
                "snitch_phone": p_user.get("snitch_phone"),
            })
            if p.get("leave_requested"):
                escape_requests.append({
                    "user_id": p["user_id"],
                    "username": p_user.get("username", "Someone"),
                    "bill_id": bill_id,
                })

        # Fetch payments for this bill
        payments_resp = supabase.table("payments").select("payer_id,amount_paid").eq("bill_id", bill_id).execute()
        payments_list = [{"payer_id": pay["payer_id"], "amount_paid": float(pay["amount_paid"])} for pay in (payments_resp.data or [])]

        # Flatten host info to top-level so guest page reads bill.host_vpa directly
        host_user = bill.get("users") or {}
        host_vpa = host_user.get("upi_vpa", "")
        host_name = host_user.get("username", "Host")

        return {
            **bill,
            "items": items_resp.data or [],
            "claims": claims_data,
            "host_vpa": host_vpa,
            "host_name": host_name,
            "escape_requests": escape_requests,
            "participants": participants_list,
            "payments": payments_list,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[get-bill] Error fetching bill {bill_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load bill. Please try again.")
