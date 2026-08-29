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
code.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from ..config import config
from ..db import fetch_one, query, query_one, transaction
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
    require_internal,
    verify_password,
)
from ..security.passwords import MAX_PASSWORD_BYTES
from ..security.principal import current_principal
from ..services.email import notifications
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
        "SELECT user_id, full_name, email, password, is_active, archived_at "
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
        "SELECT user_id, full_name, email, is_active, archived_at FROM users WHERE user_id = %s",
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
        "SELECT user_id, full_name, email FROM users WHERE user_id = %s",
        (principal.user_id,),
    )
    if not user:
        raise Unauthorized("Your account no longer exists.")
    return jsonify(project_auth_user(user))


_RESET_TOKEN_TTL_MINUTES = 10


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@bp.post("/password-reset/request")
@limiter.limit(config.ratelimit_auth)
def request_password_reset():
    """Forgot-password step 1. Always returns the same generic message,
    whether or not the email is registered - a distinguishable response
    would turn this into an account-enumeration oracle (see login())."""
    body = _json_body()
    email = str(body.get("email", "")).strip().lower()
    generic_message = "If that email address is registered, a reset link has been sent."
    if not email:
        raise BadRequest("Email is required.")

    user = query_one(
        "SELECT user_id, full_name, email FROM users "
        "WHERE lower(email) = %s AND is_active AND archived_at IS NULL",
        (email,),
    )
    if user:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_RESET_TOKEN_TTL_MINUTES)
        with transaction() as cur:
            cur.execute("DELETE FROM password_reset_token WHERE user_id = %s", (user["user_id"],))
            cur.execute(
                "INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
                (user["user_id"], _hash_reset_token(token), expires_at),
            )
        notifications.password_reset_requested(
            email=user["email"],
            full_name=user["full_name"],
            reset_link=f"{config.frontend_url}/reset-password?token={token}",
            expiry_minutes=_RESET_TOKEN_TTL_MINUTES,
        )
        audit("auth.password_reset.requested", actor_user_id=user["user_id"])

    return jsonify({"message": generic_message})


@bp.post("/password-reset/confirm")
@limiter.limit(config.ratelimit_auth)
def confirm_password_reset():
    """Forgot-password step 2: the token from the emailed link, plus a new password."""
    body = _json_body()
    token = str(body.get("token", "")).strip()
    password = str(body.get("password", ""))
    invalid_message = "This reset link could not be used. Please request a new one."

    if not token or not password:
        raise BadRequest("A token and new password are required.")
    if len(password) < 8:
        raise BadRequest("Choose a password of at least 8 characters.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")

    row = query_one(
        "SELECT prt.password_reset_token_id, prt.user_id, prt.expires_at, u.full_name, u.email "
        "FROM password_reset_token prt JOIN users u ON u.user_id = prt.user_id "
        "WHERE prt.token_hash = %s",
        (_hash_reset_token(token),),
    )
    if not row or row["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return jsonify({"status": "invalid", "message": invalid_message})

    with transaction() as cur:
        cur.execute(
            "UPDATE users SET password = %s WHERE user_id = %s",
            (hash_password(password), row["user_id"]),
        )
        cur.execute(
            "DELETE FROM password_reset_token WHERE password_reset_token_id = %s",
            (row["password_reset_token_id"],),
        )

    notifications.password_reset_completed(
        email=row["email"], full_name=row["full_name"], support_contact=config.email_from or "support",
    )
    audit("auth.password_reset.completed", actor_user_id=row["user_id"])
    return jsonify({"status": "reset", "message": "Your password has been reset. You can now sign in."})


@bp.post("/me/password")
@require_auth
@limiter.limit(config.ratelimit_auth)
def change_own_password():
    """Profile page's password-change form: current password + new password."""
    body = _json_body()
    old_password = str(body.get("oldPassword", ""))
    new_password = str(body.get("newPassword", ""))

    if not old_password or not new_password:
        raise BadRequest("Current and new passwords are required.")
    if len(new_password) < 8:
        raise BadRequest("Choose a password of at least 8 characters.")
    if len(new_password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")

    principal = current_principal()
    user = query_one(
        "SELECT user_id, full_name, email, password FROM users WHERE user_id = %s",
        (principal.user_id,),
    )
    if not user or not verify_password(old_password, user["password"]):
        raise BadRequest("Your current password is incorrect.", code="invalid_current_password")
    if verify_password(new_password, user["password"]):
        raise BadRequest(
            "New password must be different from your current password.", code="password_unchanged"
        )

    with transaction() as cur:
        cur.execute(
            "UPDATE users SET password = %s WHERE user_id = %s",
            (hash_password(new_password), user["user_id"]),
        )

    notifications.password_reset_completed(
        email=user["email"], full_name=user["full_name"], support_contact=config.email_from or "support",
    )
    audit("auth.password.changed", actor_user_id=user["user_id"])
    return jsonify({"message": "Your password has been updated."})


# This intentionally is not the administration directory.
_INTERNAL_DIRECTORY_SQL = """
    SELECT u.user_id AS id, u.full_name AS "displayName", u.email,
           COALESCE(s.department_or_school, st.school, 'APU Community') AS department
      FROM users u
 LEFT JOIN staff s ON s.user_id = u.user_id
 LEFT JOIN student st ON st.user_id = u.user_id
     WHERE u.is_active AND u.archived_at IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM user_unit_roles external_role
            WHERE external_role.user_id = u.user_id
              AND external_role.role_code = 'external-user'
              AND external_role.is_active
       )
  ORDER BY u.full_name
"""

_INTERNAL_DIRECTORY_ROLES_SQL = """
    SELECT uur.user_id, uur.role_code AS "roleCode", r.role_name AS "roleName",
           uur.unit_code AS "unitCode", un.description AS "unitDescription"
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit un ON un.code = uur.unit_code
     WHERE uur.user_id = ANY(%s)
       AND uur.is_active AND r.is_active AND r.archived_at IS NULL
  ORDER BY uur.user_id, uur.user_unit_role_id
"""


@bp.get("/internal-users")
@require_internal
def internal_users():
    """Active internal people, limited to fields needed by collaboration UI.

    Administration-only details (IDs, assignment IDs and all mutations)
    remain exclusively behind ``/admin/users``.
    """
    users = query(_INTERNAL_DIRECTORY_SQL)
    if not users:
        return jsonify([])

    roles_by_user: dict[int, list[dict]] = {}
    for role in query(_INTERNAL_DIRECTORY_ROLES_SQL, ([user["id"] for user in users],)):
        roles_by_user.setdefault(role.pop("user_id"), []).append(role)

    for user in users:
        roles = roles_by_user.get(user["id"], [])
        user["roles"] = roles
        user["roleLabel"] = (
            f"{roles[0]['roleName']} — {roles[0]['unitDescription']}"
            if roles and roles[0]["unitDescription"]
            else roles[0]["roleName"] if roles else "Unassigned"
        )
        user.pop("id")
    return jsonify(users)


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

        cur.execute(
            """INSERT INTO users (full_name, email, password, is_active)
               VALUES (%s, %s, %s, TRUE) RETURNING user_id, full_name, email""",
            (full_name, email, hash_password(password)),
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
# TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode) Lists every active user plus
# the one shared plaintext demo password (every seeded account uses the same password - see
# seed/run.py).
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
