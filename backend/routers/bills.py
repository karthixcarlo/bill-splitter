from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Form
from pydantic import BaseModel
from typing import List, Optional
import json
import uuid
import re

router = APIRouter()

class BillItem(BaseModel):
    name: str
    quantity: int
    price_per_unit: float
    total_price: float

class ParsedBill(BaseModel):
    items: List[BillItem]
    tax_amount: float
    service_charge: float
    total: float
    restaurant_name: Optional[str] = None


@router.post("/parse-bill")
async def parse_bill(
    request: Request,
    file: UploadFile = File(...),
    host_id: str = Form(...)
):
    """
    Parse a bill image using Gemini Vision AI.
    Returns parsed items for the frontend to display.
    """
    gemini = request.app.state.gemini

    if not gemini:
        raise HTTPException(status_code=503, detail="Gemini AI client not configured. Check GEMINI_API_KEY.")

    print(f"[parse-bill] Received file: {file.filename}, type: {file.content_type}, host: {host_id}")

    # Read uploaded file
    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    print(f"[parse-bill] File size: {len(image_bytes)} bytes")

    # Prepare Gemini request
    gemini_image = {
        'mime_type': file.content_type or 'image/jpeg',
        'data': image_bytes
    }

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
        print("[parse-bill] Calling Gemini API...")
        response = gemini.generate_content([prompt, gemini_image])
        print(f"[parse-bill] Gemini response received. Text length: {len(response.text) if response.text else 0}")
    except Exception as e:
        error_msg = str(e)
        print(f"[parse-bill] Gemini API Error: {error_msg}")

        # Give user-friendly error messages
        if "400" in error_msg:
            raise HTTPException(status_code=400, detail="Could not read the image. Please upload a clear photo of a bill/receipt (JPG or PNG).")
        elif "429" in error_msg:
            raise HTTPException(status_code=429, detail="AI is busy right now. Please wait a few seconds and try again.")
        elif "403" in error_msg:
            raise HTTPException(status_code=403, detail="AI API key issue. Check GEMINI_API_KEY.")
        else:
            raise HTTPException(status_code=500, detail=f"AI Error: {error_msg[:200]}")

    # Parse the JSON response
    if not response.text or not response.text.strip():
        raise HTTPException(status_code=500, detail="AI returned an empty response. Please try again with a clearer image.")

    response_text = response.text.strip()
    print(f"[parse-bill] Raw AI response (first 200 chars): {response_text[:200]}")

    # Strip markdown code fences if present
    response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
    response_text = re.sub(r'\s*```$', '', response_text)
    response_text = response_text.strip()

    try:
        parsed_data = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"[parse-bill] JSON parse failed: {e}")
        print(f"[parse-bill] Bad JSON: {response_text[:500]}")

        # Try to extract JSON from the text
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                parsed_data = json.loads(json_match.group())
                print("[parse-bill] Extracted JSON from text successfully.")
            except:
                raise HTTPException(status_code=500,
                    detail="AI response could not be parsed. Please try again with a clearer, well-lit photo of the bill.")
        else:
            raise HTTPException(status_code=500,
                detail="AI did not return structured data. Please try again with a clearer photo.")

    # Validate and normalize the data
    if "items" not in parsed_data or not isinstance(parsed_data.get("items"), list):
        raise HTTPException(status_code=500, detail="AI could not find any items in the bill. Please upload a clearer image.")

    # Normalise each item
    normalized_items = []
    for item in parsed_data["items"]:
        try:
            normalized_items.append({
                "name": str(item.get("name", "Unknown Item")),
                "quantity": int(item.get("quantity", 1)),
                "price_per_unit": float(item.get("price_per_unit", 0.0)),
                "total_price": float(item.get("total_price", 0.0))
            })
        except (ValueError, TypeError):
            continue  # skip malformed items

    if not normalized_items:
        raise HTTPException(status_code=500, detail="No valid items could be extracted. Please try a clearer image.")

    result = {
        "restaurant_name": str(parsed_data.get("restaurant_name", "Restaurant")),
        "items": normalized_items,
        "tax_amount": float(parsed_data.get("tax_amount", 0.0)),
        "service_charge": float(parsed_data.get("service_charge", 0.0)),
        "total": float(parsed_data.get("total", 0.0))
    }

    print(f"[parse-bill] Success! Found {len(normalized_items)} items. Restaurant: {result['restaurant_name']}")

    return {
        "success": True,
        "data": result,
        "bill_id": None
    }


@router.get("/bills/{bill_id}")
async def get_bill(request: Request, bill_id: str):
    """Get bill details with all items"""
    try:
        supabase = request.app.state.supabase

        bill_response = supabase.table("bills").select("*").eq("id", bill_id).execute()

        if not bill_response.data:
            raise HTTPException(status_code=404, detail="Bill not found")

        bill = bill_response.data[0]
        items_response = supabase.table("bill_items").select("*").eq("bill_id", bill_id).execute()

        return {
            **bill,
            "items": items_response.data
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
