"""JWT issue and verification.

Two token types share one secret but are separated by a `typ` claim, checked on
decode. That stops a refresh token — which is long-lived — from being replayed
as an access token.

Claims are deliberately thin: subject, type, issued-at, expiry, and a token id.
Roles are NOT baked in. They are re-read from the database on every request
(see principal.py), so revoking a role takes effect immediately rather than
whenever the current access token happens to expire.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from ..config import config
from ..errors import Unauthorized

ACCESS = "access"
REFRESH = "refresh"
_ALGORITHM = "HS256"


def _issue(subject: int, token_type: str, ttl: timedelta) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + ttl
    payload = {
        "sub": str(subject),
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, config.secret_key, algorithm=_ALGORITHM), expires_at


def issue_access_token(user_id: int) -> tuple[str, datetime]:
    return _issue(user_id, ACCESS, timedelta(minutes=config.access_token_ttl_minutes))


def issue_refresh_token(user_id: int) -> tuple[str, datetime]:
    return _issue(user_id, REFRESH, timedelta(days=config.refresh_token_ttl_days))


def decode_token(token: str, *, expected_type: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(token, config.secret_key, algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Your session has expired. Please sign in again.", code="token_expired") from None
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid authentication token.", code="token_invalid") from None

    if claims.get("typ") != expected_type:
        raise Unauthorized("Invalid authentication token.", code="token_invalid")
    try:
        claims["user_id"] = int(claims["sub"])
    except (KeyError, TypeError, ValueError):
        raise Unauthorized("Invalid authentication token.", code="token_invalid") from None
    return claims
