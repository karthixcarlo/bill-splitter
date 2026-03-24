from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Depends
import io
import re
import logging

from auth import get_current_user
from rate_limit import limiter

logger = logging.getLogger("bpp.scan")
router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_MAGIC = {
    b'\xFF\xD8\xFF': 'image/jpeg',
    b'\x89PNG': 'image/png',
    b'GIF8': 'image/gif',
    b'RIFF': 'image/webp',
}


def validate_image(data: bytes) -> str:
    for magic, mime in ALLOWED_IMAGE_MAGIC.items():
        if data[:len(magic)] == magic:
            return mime
    raise HTTPException(status_code=400, detail="Invalid image format. Upload JPEG, PNG, GIF, or WebP.")


@router.post("/scan-qr")
@limiter.limit("5/minute")
async def scan_qr_code(
    request: Request,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """
    Scan a QR code image and extract UPI VPA using Gemini Vision.
    """
    try:
        gemini = request.app.state.gemini

        # Read uploaded image
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        if len(image_bytes) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")

        detected_mime = validate_image(image_bytes)
        gemini_image = {
            'mime_type': detected_mime,
            'data': image_bytes
        }
        
        # Use Gemini to read QR code
        prompt = """
Look at this QR code image and extract the UPI payment information.
If this is a UPI payment QR code, return ONLY the VPA (Virtual Payment Address) in this exact format:
VPA: username@bank

If you cannot find a UPI VPA, respond with: NOT_FOUND

Do not include any other text or explanation.
"""
        
        response = gemini.generate_content([prompt, gemini_image])
        response_text = response.text.strip()
        
        # Parse response
        if 'NOT_FOUND' in response_text:
            raise HTTPException(
                status_code=400,
                detail="No UPI QR code found in image"
            )
        
        # Extract VPA from response
        vpa_match = re.search(r'VPA:\s*([^\s]+@[^\s]+)', response_text, re.IGNORECASE)
        if not vpa_match:
            # Try to find email-like pattern
            vpa_match = re.search(r'([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)', response_text)
        
        if not vpa_match:
            raise HTTPException(
                status_code=400,
                detail="Could not extract UPI VPA from QR code"
            )
        
        vpa = vpa_match.group(1)
        
        return {
            "success": True,
            "vpa": vpa,
            "raw_data": response_text
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[scan-qr] Error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Error processing QR code. Please try again."
        )
