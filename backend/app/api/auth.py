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
from ..services.email import notifications, render
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
              AND external_role.archived_at IS NULL
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
       AND uur.is_active AND uur.archived_at IS NULL
       AND r.is_active AND r.archived_at IS NULL
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


# ---------------------------------------------------------------------------
# Guest self-registration, in three steps: start -> verify -> (resend).
#
# No users row exists until the emailed code is confirmed. The submitted form is
# staged in pending_registration under a challenge id, so an abandoned signup
# leaves nothing behind but an expired row, and an address is only really taken
# once someone has proved they can read mail sent to it.
#
# Guests may browse, save and register for public events. They can never submit
# a proposal or reach any internal page - that is enforced by the
# 'external-user' role, which @require_internal rejects, not by anything the
# client sends.
# ---------------------------------------------------------------------------

#: Youngest age that may hold an account. The registration form applies the same
#: floor for fast feedback; this copy is the one that actually decides, since a
#: client can post whatever it likes.
MINIMUM_AGE = 16

#: The only values the gender field accepts. Anything else is rejected rather
#: than stored, so the column cannot fill up with free text.
ALLOWED_GENDERS = ("Male", "Female", "Prefer not to say")

_OTP_TTL_MINUTES = 10
#: A code may be got wrong this many times before the challenge is burned -
#: 6 digits is only a million combinations, which is not many for a machine.
_OTP_MAX_ATTEMPTS = 5
#: Matches the resend cooldown the form counts down, so the button and the
#: server agree on when another code may be sent.
_OTP_RESEND_COOLDOWN_SECONDS = 30


def _hash_otp(challenge_id: str, code: str) -> str:
    """The code is stored hashed, salted with the challenge id.

    Six digits is a small enough space that an unsalted hash of a leaked table
    would fall to a lookup instantly; binding it to the challenge means the work
    has to be redone per row.
    """
    return hashlib.sha256(f"{challenge_id}:{code}".encode("utf-8")).hexdigest()


def _purge_expired_registrations(cur) -> None:
    cur.execute("DELETE FROM pending_registration WHERE expires_at < now()")


def _send_registration_code(*, cur, challenge_id: str, email: str, full_name: str) -> None:
    """Issues a fresh code for an existing challenge and emails it."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    cur.execute(
        "UPDATE pending_registration SET otp_hash = %s, attempts = 0, last_sent_at = now(), "
        "expires_at = now() + make_interval(mins => %s) WHERE challenge_id = %s",
        (_hash_otp(challenge_id, code), _OTP_TTL_MINUTES, challenge_id),
    )
    notifications.guest_registration_otp(
        email=email, full_name=full_name, otp_code=code, expiry_minutes=_OTP_TTL_MINUTES,
    )


@bp.post("/register/start")
@limiter.limit(config.ratelimit_auth)
def register_start():
    """Step 1: stage the submitted form and email a 6-digit code.

    Creates no account. Returns the challenge id the client sends back to
    /register/verify, plus the masked address, so the form can say where the
    code went without echoing an address the reader may have mistyped.
    """
    body = _json_body()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    first_name = str(body.get("firstName", "")).strip()
    last_name = str(body.get("lastName", "")).strip()
    gender = str(body.get("gender", "")).strip()
    raw_age = str(body.get("age", "")).strip()

    if not email or not password or not first_name:
        raise BadRequest("Email, password and first name are required.")
    if len(password) < 8:
        raise BadRequest("Choose a password of at least 8 characters.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"Password must be at most {MAX_PASSWORD_BYTES} bytes.")
    if not raw_age.isdigit():
        raise BadRequest("Age is required.")
    age = int(raw_age)
    if age < MINIMUM_AGE:
        raise BadRequest(f"You must be at least {MINIMUM_AGE} years old to create an account.")
    # An upper bound as well: the field is free-entry, and a number like 900 is a
    # typo rather than a person.
    if age > 120:
        raise BadRequest("Enter a valid age.")
    if gender not in ALLOWED_GENDERS:
        raise BadRequest(f"Gender must be one of: {', '.join(ALLOWED_GENDERS)}.")

    full_name = (first_name + " " + last_name).strip()
    challenge_id = secrets.token_urlsafe(24)

    with transaction() as cur:
        _purge_expired_registrations(cur)
        existing = fetch_one(cur, "SELECT user_id FROM users WHERE lower(email) = %s", (email,))
        if existing:
            # Deliberately vague, as in login(): a precise message would confirm
            # which addresses already hold an account.
            raise Conflict("That email address cannot be registered.")

        # Starting again replaces any previous unverified attempt, so only the
        # newest code is live for an address.
        cur.execute("DELETE FROM pending_registration WHERE lower(email) = %s", (email,))
        cur.execute(
            """INSERT INTO pending_registration
                   (challenge_id, email, full_name, password_hash, age, gender, otp_hash, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s, '', now() + make_interval(mins => %s))""",
            (challenge_id, email, full_name, hash_password(password), age, gender, _OTP_TTL_MINUTES),
        )
        _send_registration_code(cur=cur, challenge_id=challenge_id, email=email, full_name=full_name)

    audit("auth.guest.registration_started")
    return jsonify({
        "challengeId": challenge_id,
        "status": "otp-required",
        "maskedEmail": render.mask_email(email),
    }), 201


@bp.post("/register/verify")
@limiter.limit(config.ratelimit_auth)
def register_verify():
    """Step 2: confirm the code, create the account, and sign the guest in.

    Returns the same envelope as login, so a verified guest is signed in at
    once rather than being sent back to a form.
    """
    body = _json_body()
    challenge_id = str(body.get("challengeId", "")).strip()
    otp = str(body.get("otp", "")).strip()
    if not challenge_id or not otp:
        raise BadRequest("The challenge id and code are both required.")

    with transaction() as cur:
        pending = fetch_one(
            cur,
            "SELECT *, (expires_at < now()) AS is_expired "
            "FROM pending_registration WHERE challenge_id = %s FOR UPDATE",
            (challenge_id,),
        )
        if pending is None:
            return jsonify({"status": "expired", "message": "That signup has expired. Please start again."})
        # Expiry is decided BY POSTGRES, not by comparing a stored UTC timestamp
        # against the app server's local clock - those differ by whole hours here,
        # which made every freshly issued code look already expired.
        if pending["is_expired"]:
            cur.execute("DELETE FROM pending_registration WHERE challenge_id = %s", (challenge_id,))
            return jsonify({"status": "expired", "message": "That code has expired. Please request a new one."})
        if pending["attempts"] >= _OTP_MAX_ATTEMPTS:
            cur.execute("DELETE FROM pending_registration WHERE challenge_id = %s", (challenge_id,))
            return jsonify({"status": "expired", "message": "Too many incorrect codes. Please start again."})

        if not secrets.compare_digest(pending["otp_hash"], _hash_otp(challenge_id, otp)):
            cur.execute(
                "UPDATE pending_registration SET attempts = attempts + 1 WHERE challenge_id = %s",
                (challenge_id,),
            )
            remaining = _OTP_MAX_ATTEMPTS - (pending["attempts"] + 1)
            message = (
                "That code is not correct. Please check and try again."
                if remaining > 0
                else "Too many incorrect codes. Please start again."
            )
            return jsonify({"status": "invalid", "message": message})

        # The address is re-checked here, not just at /start: minutes may have
        # passed, and nothing stopped the same address registering in between.
        if fetch_one(cur, "SELECT user_id FROM users WHERE lower(email) = %s", (pending["email"],)):
            cur.execute("DELETE FROM pending_registration WHERE challenge_id = %s", (challenge_id,))
            raise Conflict("That email address cannot be registered.")

        cur.execute(
            """INSERT INTO users (full_name, email, password, is_active)
               VALUES (%s, %s, %s, TRUE) RETURNING user_id, full_name, email""",
            (pending["full_name"], pending["email"], pending["password_hash"]),
        )
        user = dict(cur.fetchone())
        cur.execute(
            "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, NULL, %s)",
            (user["user_id"], "external-user"),
        )
        cur.execute(
            "INSERT INTO external_user_profile (user_id, age, gender) VALUES (%s, %s, %s)",
            (user["user_id"], pending["age"], pending["gender"]),
        )
        cur.execute("DELETE FROM pending_registration WHERE challenge_id = %s", (challenge_id,))

    audit("auth.guest.registered", actor_user_id=user["user_id"])
    return jsonify({
        "status": "verified",
        "message": "Your email address has been verified.",
        "user": project_auth_user(user),
        **_tokens_for(user["user_id"]),
    }), 201


@bp.post("/register/resend")
@limiter.limit(config.ratelimit_auth)
def register_resend():
    """Sends a new code for a signup already in progress.

    Each send restarts the expiry window and clears the attempt count, so a
    reader who mistyped several times is not locked out of a code they have only
    just been given.
    """
    body = _json_body()
    challenge_id = str(body.get("challengeId", "")).strip()
    if not challenge_id:
        raise BadRequest("The challenge id is required.")

    with transaction() as cur:
        pending = fetch_one(
            cur,
            "SELECT challenge_id, email, full_name, (expires_at < now()) AS is_expired, "
            "GREATEST(0, %s - EXTRACT(EPOCH FROM (now() - last_sent_at)))::int AS cooldown_remaining "
            "FROM pending_registration WHERE challenge_id = %s FOR UPDATE",
            (_OTP_RESEND_COOLDOWN_SECONDS, challenge_id),
        )
        if pending is None or pending["is_expired"]:
            return jsonify({"status": "expired", "message": "That signup has expired. Please start again."})

        if pending["cooldown_remaining"] > 0:
            wait = pending["cooldown_remaining"]
            return jsonify({"status": "sent", "message": f"Please wait {wait}s before requesting another code."})

        _send_registration_code(
            cur=cur, challenge_id=challenge_id, email=pending["email"], full_name=pending["full_name"],
        )

    return jsonify({"status": "sent", "message": "A new code is on its way."})


@bp.get("/register/email-status")
@limiter.limit(config.ratelimit_auth)
def register_email_status():
    """Live check for the email field: is this address free, and is there a
    signup already in progress the reader could resume instead of starting over?

    Unlike the deliberately vague messages elsewhere, this one does tell the
    caller whether an address is taken - the registration form cannot guide
    someone through a unique-address field without it, and the same fact is
    already observable by submitting the form.
    """
    email = str(request.args.get("email", "")).strip().lower()
    if not email:
        raise BadRequest("Email is required.")

    taken = query_one("SELECT user_id FROM users WHERE lower(email) = %s", (email,))
    pending = query_one(
        "SELECT challenge_id FROM pending_registration "
        "WHERE lower(email) = %s AND expires_at > now()",
        (email,),
    )
    return jsonify({
        "available": taken is None,
        "hasPendingChallenge": pending is not None,
        "challengeId": pending["challenge_id"] if pending else None,
    })


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
     WHERE uur.archived_at IS NULL AND r.archived_at IS NULL
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
