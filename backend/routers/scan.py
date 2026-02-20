from fastapi import APIRouter, UploadFile, File, HTTPException, Request
import io
import re

router = APIRouter()

@router.post("/scan-qr")
async def scan_qr_code(
    request: Request,
    file: UploadFile = File(...)
):
    """
    Scan a QR code image and extract UPI VPA using Gemini Vision.
    """
    try:
        gemini = request.app.state.gemini
        
        # Read uploaded image
        image_bytes = await file.read()
        
        # Pass raw bytes to Gemini
        gemini_image = {
            'mime_type': file.content_type or 'image/jpeg',
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
        raise HTTPException(
            status_code=500,
            detail=f"Error processing QR code: {str(e)}"
        )
