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
import uuid

from flask import Blueprint, jsonify, request

from ..config import config
from ..db import fetch_one, query_one, transaction
from ..errors import BadRequest, Conflict, NotFound, Unauthorized
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


@bp.post("/register")
@limiter.limit(config.ratelimit_auth)
def register():
    """Self-registration for an EXTERNAL guest account.

    Guests may browse, save and register for public events. They can never
    submit a proposal or reach any internal page - that is enforced by the
    'external-user' role, which @require_internal rejects, not by anything the
    client sends.

    Returns the same envelope as login, so the caller is signed in immediately.
    """
    body = _json_body()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    first_name = str(body.get("firstName", "")).strip()
    last_name = str(body.get("lastName", "")).strip()

    if not email or not password or not first_name:
        raise BadRequest("Email, password and first name are required.")
    if len(password) < 8:
        raise BadRequest("Choose a password of at least 8 characters.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")

    full_name = (first_name + " " + last_name).strip()
    with transaction() as cur:
        existing = fetch_one(
            cur, "SELECT user_id FROM users WHERE lower(email) = %s", (email,)
        )
        if existing:
            # Deliberately vague: a precise message would confirm which
            # addresses already hold an account.
            raise Conflict("That email address cannot be registered.")

        username = email.split("@")[0][:80]
        # Usernames are unique; a guest whose local part collides with an
        # existing account gets a suffixed one rather than a failed signup.
        if fetch_one(cur, "SELECT 1 FROM users WHERE lower(username) = lower(%s)", (username,)):
            username = (username[:70] + "-" + uuid.uuid4().hex[:8])

        cur.execute(
            """INSERT INTO users (full_name, username, email, password, is_active)
               VALUES (%s, %s, %s, %s, TRUE) RETURNING user_id, full_name, username, email""",
            (full_name, username, email, hash_password(password)),
        )
        user = dict(cur.fetchone())
        cur.execute(
            "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, NULL, %s)",
            (user["user_id"], "external-user"),
        )
        age = body.get("age")
        cur.execute(
            """INSERT INTO external_user_profile (user_id, age, gender)
               VALUES (%s, %s, %s)""",
            (user["user_id"], int(age) if str(age or "").isdigit() else None, body.get("gender")),
        )

    audit("auth.guest.registered", actor_user_id=user["user_id"])
    return jsonify({"user": project_auth_user(user), **_tokens_for(user["user_id"])}), 201


# ---------------------------------------------------------------------------
# TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
#
# Lists every active user plus the one shared plaintext demo password (every
# seeded account uses the same password - see seed/run.py). Powers the login
# page's searchable account picker. Inert unless DEMO_MODE=true; a deployment
# that never sets it serves a 404 here regardless of anything else.
# ---------------------------------------------------------------------------
_DEV_USERS_SQL = """
    SELECT u.user_id AS id, u.full_name, u.email,
           COALESCE(s.department_or_school, st.school) AS department
      FROM users u
 LEFT JOIN staff s ON s.user_id = u.user_id
 LEFT JOIN student st ON st.user_id = u.user_id
     WHERE u.is_active AND u.archived_at IS NULL
  ORDER BY u.full_name
"""

# One row per user (their first role by assignment order), fetched for every
# seeded user in a single round trip instead of one query per user - the
# per-user loop this replaced took ~9s over a remote DB for ~40 users.
_DEV_USER_ROLES_SQL = """
    SELECT DISTINCT ON (uur.user_id)
           uur.user_id, r.role_name, u.description AS unit_description
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit u ON u.code = uur.unit_code
     WHERE r.archived_at IS NULL
  ORDER BY uur.user_id, uur.user_unit_role_id
"""


def _dev_user_rows() -> list[dict[str, object]]:
    from ..db import query as _query

    rows = _query(_DEV_USERS_SQL)
    roles_by_user = {row["user_id"]: row for row in _query(_DEV_USER_ROLES_SQL)}

    out = []
    for row in rows:
        role = roles_by_user.get(row["id"])
        role_label = "Unassigned"
        if role:
            role_label = (
                f"{role['role_name']} — {role['unit_description']}"
                if role["unit_description"]
                else role["role_name"]
            )
        out.append(
            {
                "id": str(row["id"]),
                "displayName": row["full_name"],
                "email": row["email"],
                "roleLabel": role_label,
                "department": row["department"] or "APU Community",
            }
        )
    return out


@bp.get("/dev-users")
def dev_users():
    if not config.demo_mode:
        raise NotFound("Not found.")
    return jsonify([{**row, "password": config.demo_password} for row in _dev_user_rows()])
