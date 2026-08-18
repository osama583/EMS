"""Shared extension instances, created here so they can be imported without
triggering a circular import back through the app factory."""
from __future__ import annotations

from flask import request
from flask_limiter import Limiter

from .config import config


def rate_limit_key() -> str:
    """Rate-limit per authenticated user where possible, else per client IP.

    Keying purely on IP would let one abusive account hide behind a shared
    campus NAT, and would throttle every user behind it together.
    """
    from flask import g

    user_id = getattr(g, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    forwarded = request.headers.get("X-Forwarded-For", "")
    client = forwarded.split(",")[0].strip() if forwarded else (request.remote_addr or "unknown")
    return f"ip:{client}"


limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=[config.ratelimit_default],
    storage_uri=config.ratelimit_storage_uri,
    strategy="fixed-window",
    headers_enabled=True,
)
