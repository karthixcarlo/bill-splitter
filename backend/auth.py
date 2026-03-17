"""
JWT authentication dependency for FastAPI routes.
Validates Supabase JWT tokens and extracts user_id.
"""
import os
import json
import base64
import hmac
import hashlib
from fastapi import Request, HTTPException


def _decode_jwt_payload(token: str) -> dict:
    """Decode the payload section of a JWT without external libraries."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    # Base64url decode the payload (middle part)
    payload_b64 = parts[1]
    # Add padding if needed
    padding = 4 - len(payload_b64) % 4
    if padding != 4:
        payload_b64 += "=" * padding
    payload_bytes = base64.urlsafe_b64decode(payload_b64)
    return json.loads(payload_bytes)


def _verify_jwt_signature(token: str, secret: str) -> bool:
    """Verify HMAC-SHA256 JWT signature using the Supabase JWT secret."""
    parts = token.split(".")
    if len(parts) != 3:
        return False
    message = f"{parts[0]}.{parts[1]}".encode()
    signature_b64 = parts[2]
    # Add padding
    padding = 4 - len(signature_b64) % 4
    if padding != 4:
        signature_b64 += "=" * padding
    expected_sig = base64.urlsafe_b64decode(signature_b64)
    actual_sig = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return hmac.compare_digest(expected_sig, actual_sig)


async def get_current_user(request: Request) -> dict:
    """
    FastAPI dependency that extracts and validates the Supabase JWT from
    the Authorization header. Returns {"user_id": "..."}.

    If SUPABASE_JWT_SECRET is set, signature is verified.
    Otherwise, only the payload is decoded (development mode).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[7:]  # Strip "Bearer "

    try:
        payload = _decode_jwt_payload(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Verify signature if JWT secret is available
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
    if jwt_secret:
        if not _verify_jwt_signature(token, jwt_secret):
            raise HTTPException(status_code=401, detail="Invalid token signature")

    # Check expiry
    import time
    exp = payload.get("exp")
    if exp and time.time() > exp:
        raise HTTPException(status_code=401, detail="Token expired")

    # Extract user ID (Supabase puts it in 'sub')
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")

    return {"user_id": user_id}
