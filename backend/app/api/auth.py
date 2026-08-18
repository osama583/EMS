"""Authentication: login, refresh, logout, and the current-user projection.

Token model
-----------
Login returns a short-lived access token (minutes) plus a long-lived refresh
token (days). The access token goes in the Authorization header on every call;
when it expires the client posts the refresh token to /auth/refresh for a new
pair. Refresh tokens rotate on use, so a stolen one is only good until the
legitimate client next refreshes.

Both are returned in the JSON body rather than set as cookies. The frontend is
a separate origin calling a token-authenticated API, so there is no ambient
credential for CSRF to abuse - the header must be set deliberately by our own
code. See docs/security.md.
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from ..config import config
from ..db import query_one, transaction
from ..errors import BadRequest, Unauthorized
from ..extensions import limiter
from ..logging_setup import audit
from ..security import (
    REFRESH,
    decode_token,
    hash_password,
    issue_access_token,
    issue_refresh_token,
    needs_rehash,
    require_auth,
    verify_password,
)
from ..security.passwords import MAX_PASSWORD_BYTES
from ..security.principal import current_principal
from ..services.identity import project_auth_user

log = logging.getLogger(__name__)

bp = Blueprint("auth", __name__, url_prefix="/auth")

# Deliberately identical for "no such account", "wrong password" and
# "deactivated": a distinguishable message turns the login form into an account
# enumeration oracle.
_INVALID_CREDENTIALS = "The email or password is incorrect."


def _tokens_for(user_id: int) -> dict[str, object]:
    access, access_expires = issue_access_token(user_id)
    refresh, _ = issue_refresh_token(user_id)
    return {
        "accessToken": access,
        "refreshToken": refresh,
        "tokenType": "Bearer",
        "expiresIn": config.access_token_ttl_minutes * 60,
        "expiresAt": access_expires.isoformat(),
    }


def _json_body() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise BadRequest("A JSON request body is required.")
    return body


@bp.post("/login")
@limiter.limit(config.ratelimit_auth)
def login():
    body = _json_body()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))

    if not email or not password:
        raise BadRequest("Email and password are required.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")

    user = query_one(
        "SELECT user_id, full_name, username, email, password, is_active, archived_at "
        "FROM users WHERE lower(email) = %s",
        (email,),
    )

    # Verify even when the user is missing, so a bad email and a bad password
    # take the same time and cannot be told apart by response latency.
    password_ok = verify_password(password, user["password"] if user else None)
    if not user or not password_ok or not user["is_active"] or user["archived_at"] is not None:
        audit("auth.login.failed", email=email, reason="invalid_credentials")
        raise Unauthorized(_INVALID_CREDENTIALS, code="invalid_credentials")

    # Transparent upgrade when the cost factor has been raised since signup.
    if needs_rehash(user["password"]):
        with transaction() as cur:
            cur.execute(
                "UPDATE users SET password = %s WHERE user_id = %s",
                (hash_password(password), user["user_id"]),
            )

    audit("auth.login.succeeded", actor_user_id=user["user_id"])
    return jsonify({"user": project_auth_user(user), **_tokens_for(user["user_id"])})


@bp.post("/refresh")
@limiter.limit(config.ratelimit_auth)
def refresh():
    body = _json_body()
    token = str(body.get("refreshToken", "")).strip()
    if not token:
        raise BadRequest("A refresh token is required.")

    claims = decode_token(token, expected_type=REFRESH)
    user = query_one(
        "SELECT user_id, full_name, username, email, is_active, archived_at FROM users WHERE user_id = %s",
        (claims["user_id"],),
    )
    if not user or not user["is_active"] or user["archived_at"] is not None:
        raise Unauthorized("Your session is no longer valid.", code="session_invalid")

    audit("auth.token.refreshed", actor_user_id=user["user_id"])
    return jsonify({"user": project_auth_user(user), **_tokens_for(user["user_id"])})


@bp.post("/logout")
@require_auth
def logout():
    # Tokens are stateless and short-lived, so there is nothing server-side to
    # tear down; the client discards both. The endpoint exists so logout is
    # audited and so a future denylist has a place to hook in.
    audit("auth.logout", actor_user_id=current_principal().user_id)
    return "", 204


@bp.get("/me")
@require_auth
def me():
    principal = current_principal()
    user = query_one(
        "SELECT user_id, full_name, username, email FROM users WHERE user_id = %s",
        (principal.user_id,),
    )
    if not user:
        raise Unauthorized("Your account no longer exists.")
    return jsonify(project_auth_user(user))
