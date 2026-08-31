"""Administration: users, role assignments, units, roles, and page visibility.

    GET/POST/PATCH/DELETE  /admin/users[/{id}]
    GET/POST/DELETE        /admin/users/{id}/assignments[/{assignment_id}]
    GET/POST/PATCH/DELETE  /admin/units[/{code}]
    GET/POST/PATCH/DELETE  /admin/roles[/{code}]
    GET                    /admin/roles/{code}/units      legal unit pairings
    GET                    /admin/units/{code}/roles      roles assignable there
    GET/POST/PATCH/DELETE  /admin/nav-pages[/{code}]
    GET/PUT                /admin/nav-pages/{code}/grants

Every route is system-admin only. The mock exposed GET /admin/users with no
check at all, handing the full staff and student directory to any caller.

Deletes are soft: archived_at is stamped and a 7-day window allows restore.
Protected roles can never be deleted, and a role or unit still referenced by a
user assignment is blocked rather than cascaded.
"""
from __future__ import annotations

import datetime as dt
import secrets

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_admin
from ..security.passwords import hash_password
from ..services import soft_delete
from ..services.email import notifications, recipients, reminders
from ..security.principal import HEAD_ROLE_CODES, current_principal
from ..services.identity import CAFETERIA_UNIT_PREFIX
from ._helpers import body, flag, required

bp = Blueprint("admin", __name__, url_prefix="/admin")

RETENTION_DAYS = 7


def _slug(value: str) -> str:
    out: list[str] = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_")


# --- Users ----------------------------------------------------------------
# The client's AdminUserRecord: camelCase, `active` rather than is_active, and a roleLabel built from
# the user's first assignment.
_USER_SELECT = """
    SELECT u.user_id AS id, u.full_name AS "displayName", u.email,
           u.is_active AS active, u.archived_at,
           COALESCE(s.department_or_school, st.school, 'APU Community') AS department
      FROM users u
 LEFT JOIN staff s ON s.user_id = u.user_id
 LEFT JOIN student st ON st.user_id = u.user_id
"""

# Every assignment for a set of users, in one statement. The label mirrors
# services/identity.py's _role_label so a user reads the same in the directory
# as in their own session.
_ASSIGNMENTS_FOR_USERS = """
    SELECT uur.user_id,
           uur.user_unit_role_id AS "assignmentId",
           uur.role_code AS "roleCode",
           r.role_name AS "roleName",
           uur.unit_code AS "unitCode",
           un.description AS "unitDescription"
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit un ON un.code = uur.unit_code
     WHERE uur.user_id = ANY(%s)
  ORDER BY uur.user_id, uur.user_unit_role_id
"""


def _role_label(assignment: dict | None) -> str:
    if not assignment:
        return "Unassigned"
    name = assignment["roleName"] or assignment["roleCode"]
    unit = assignment["unitDescription"]
    return f"{name} — {unit}" if unit else name


def _with_roles(rows: list[dict]) -> list[dict]:
    """Attach each user's assignments and roleLabel.

    One query for every user's assignments rather than one per user: the
    directory lists the whole organisation, and a query per row is a round trip
    per row.
    """
    if not rows:
        return rows
    grouped: dict[int, list[dict]] = {}
    for assignment in query(_ASSIGNMENTS_FOR_USERS, ([r["id"] for r in rows],)):
        grouped.setdefault(assignment.pop("user_id"), []).append(assignment)

    for row in rows:
        row["roles"] = grouped.get(row["id"], [])
        row["roleLabel"] = _role_label(row["roles"][0] if row["roles"] else None)
        row["id"] = str(row["id"])
    return rows


def _user_row(cur, user_id: int, *, live_only: bool = True) -> dict:
    sql = _USER_SELECT + " WHERE u.user_id = %s"
    if live_only:
        sql += " AND u.archived_at IS NULL"
    row = fetch_one(cur, sql, (user_id,))
    if row is None:
        raise NotFound("User not found.")
    return row


def _user_response(user_id: int) -> dict:
    """The full AdminUserRecord the client expects back from a write."""
    rows = query(_USER_SELECT + " WHERE u.user_id = %s", (user_id,))
    if not rows:
        raise NotFound("User not found.")
    row = _with_roles(rows)[0]
    row.pop("archived_at", None)
    return row


@bp.get("/users")
@require_admin
def list_users():
    rows = query(_USER_SELECT + " WHERE u.archived_at IS NULL ORDER BY u.full_name")
    for row in _with_roles(rows):
        row.pop("archived_at", None)
    return jsonify(rows)


@bp.get("/users/deleted")
@require_admin
def list_deleted_users():
    """The soft-delete bin, with how long each account has before purge."""
    rows = query(
        _USER_SELECT.replace(
            "u.archived_at,",
            'u.archived_at AS "deletedAt",'
            "(u.archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
            "GREATEST(0, %s - EXTRACT(DAY FROM now() - u.archived_at)::int) AS \"daysRemaining\",",
        )
        + " WHERE u.archived_at IS NOT NULL ORDER BY u.archived_at DESC",
        (RETENTION_DAYS, RETENTION_DAYS),
    )
    return jsonify(_with_roles(rows))


def _assert_email_free(cur, email: str, user_id: int | None) -> None:
    """Email is the account's only identifier, so it is the only uniqueness rule."""
    clash = fetch_one(
        cur,
        "SELECT 1 FROM users WHERE lower(email) = lower(%s) "
        "  AND (%s::int IS NULL OR user_id <> %s)",
        (email, user_id, user_id),
    )
    if clash:
        raise Conflict("That email is already in use.")


@bp.post("/users")
@require_admin
def create_user():
    """Create an account.

    The form may set an opening password. When none is supplied the account
    gets a random one nobody holds: users.password is NOT NULL, and a hash of
    an unknown secret is the honest way to say "this account cannot be signed
    into yet" - better than an admin inventing a password on someone else's
    behalf. Signing in then requires a reset.
    """
    payload = body()
    (display_name, email) = required(payload, "displayName", "email")
    password = payload.get("password") or secrets.token_urlsafe(32)

    with transaction() as cur:
        _assert_email_free(cur, str(email), None)
        cur.execute(
            """INSERT INTO users (full_name, email, password, is_active)
               VALUES (%s, %s, %s, %s) RETURNING user_id""",
            (
                str(display_name).strip(),
                str(email).strip().lower(),
                hash_password(str(password)),
                bool(payload.get("active", True)),
            ),
        )
        user_id = cur.fetchone()["user_id"]
        department = payload.get("department")
        if department:
            cur.execute(
                "INSERT INTO staff (user_id, department_or_school) VALUES (%s, %s)",
                (user_id, department),
            )
        audit("admin.user.created", target_user_id=user_id, actor_user_id=current_principal().user_id)
        # Sent from inside the transaction because this is the ONLY point the
        # password exists in plaintext - it is hashed on the way into the row,
        # so it cannot be recovered afterwards to email later.
        notifications.account_created_with_password(
            email=str(email).strip().lower(),
            full_name=str(display_name).strip(),
            password=str(password),
            role_label=recipients.role_label(cur, user_id),
        )
    return jsonify(_user_response(user_id)), 201


def _assert_account_holds_no_last_post(cur, user_id: int, *, action: str) -> None:
    """Apply the last-holder rules to every posting this ACCOUNT carries.

    Deactivating the account is the same outage as removing the assignment -
    _last_holder_blocker() already discounts holders whose account is inactive,
    so a School whose only head is switched off is a School with no head. Going
    through the account rather than the assignment is simply the other way users
    reach the same state, and it has to be refused from there too.
    """
    for row in fetch_all(
        cur,
        "SELECT user_unit_role_id FROM user_unit_roles "
        " WHERE user_id = %s AND unit_code IS NOT NULL AND archived_at IS NULL AND is_active",
        (user_id,),
    ):
        _assert_unit_keeps_its_leaders(cur, row["user_unit_role_id"], action=action)


def _apply_user_update(user_id: int, payload: dict) -> dict:
    fields: dict[str, object] = {}
    if "displayName" in payload:
        fields["full_name"] = str(payload["displayName"]).strip()
    if "fullName" in payload:
        fields["full_name"] = str(payload["fullName"]).strip()
    if "email" in payload:
        fields["email"] = str(payload["email"]).strip().lower()
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])
    # A password change goes through the hasher, never straight to the column.
    if payload.get("password"):
        fields["password"] = hash_password(str(payload["password"]))
    if not fields:
        raise BadRequest("No updatable fields were supplied.")

    with transaction() as cur:
        # Raises NotFound for a missing or archived account before anything is written.
        _user_row(cur, user_id)
        if fields.get("is_active") is False:
            _assert_account_holds_no_last_post(cur, user_id, action="deactivated")
        if "email" in fields:
            _assert_email_free(cur, str(fields["email"]), user_id)
        assignments = ", ".join(f"{c} = %s" for c in fields)
        cur.execute(
            f"UPDATE users SET {assignments} WHERE user_id = %s RETURNING user_id",
            [*fields.values(), user_id],
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
        audit("admin.user.updated", target_user_id=user_id,
              changed=sorted(k for k in fields if k != "password"),
              actor_user_id=current_principal().user_id)
    return _user_response(user_id)


@bp.put("/users/<int:user_id>")
@require_admin
def replace_user(user_id: int):
    return jsonify(_apply_user_update(user_id, body()))


@bp.patch("/users/<int:user_id>")
@require_admin
def update_user(user_id: int):
    return jsonify(_apply_user_update(user_id, body()))


@bp.patch("/users/<int:user_id>/status")
@require_admin
def set_user_status(user_id: int):
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    if not payload["active"] and user_id == current_principal().user_id:
        raise Conflict("You cannot deactivate your own account.")
    return jsonify(_apply_user_update(user_id, {"active": payload["active"]}))


@bp.get("/users/<int:user_id>/deletion-check")
@require_admin
def user_deletion_check(user_id: int):
    """What deleting this account would take with it. Shown before the click."""
    with transaction() as cur:
        row = _user_row(cur, user_id)
        blockers: list[str] = []
        if user_id == current_principal().user_id:
            blockers.append("This is your own account")
        clubs = fetch_one(
            cur, "SELECT count(*) AS c FROM clubs WHERE user_id = %s AND active", (user_id,)
        )["c"]
        if clubs:
            blockers.append(f"{clubs} club(s) still have this user as president")
        assignments = fetch_one(
            cur, "SELECT count(*) AS c FROM user_unit_roles WHERE user_id = %s", (user_id,)
        )["c"]
    return jsonify(
        {
            "canDelete": not blockers,
            "blockingReasons": blockers,
            "entityLabel": row["displayName"],
            "details": [f"{assignments} role assignment(s) will be kept for restore"]
            if assignments
            else [],
        }
    )


@bp.delete("/users/<int:user_id>")
@require_admin
def delete_user(user_id: int):
    principal = current_principal()
    if user_id == principal.user_id:
        raise Conflict("You cannot delete your own account.")
    with transaction() as cur:
        _user_row(cur, user_id)
        president_of = fetch_one(
            cur, "SELECT count(*) AS c FROM clubs WHERE user_id = %s AND active", (user_id,)
        )["c"]
        if president_of:
            raise Conflict(
                f"{president_of} club(s) still have this user as president. "
                "Reassign them first."
            )
        cur.execute(
            "UPDATE users SET archived_at = now(), is_active = FALSE WHERE user_id = %s "
            "RETURNING user_id",
            (user_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
        audit("admin.user.deleted", target_user_id=user_id, actor_user_id=principal.user_id)
    return jsonify(_user_response(user_id))


@bp.post("/users/<int:user_id>/restore")
@require_admin
def restore_user(user_id: int):
    with transaction() as cur:
        cur.execute(
            "UPDATE users SET archived_at = NULL, is_active = TRUE WHERE user_id = %s "
            "RETURNING user_id",
            (user_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
        audit("admin.user.restored", target_user_id=user_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_user_response(user_id))


@bp.delete("/users/<int:user_id>/purge")
@require_admin
def purge_user(user_id: int):
    """Permanent, and only from the bin. Role assignments go with the account;
    anything that records what the user *did* is left to the database's own
    constraints rather than being cascaded through here."""
    principal = current_principal()
    if user_id == principal.user_id:
        raise Conflict("You cannot purge your own account.")
    with transaction() as cur:
        row = fetch_one(
            cur,
            "SELECT user_id FROM users WHERE user_id = %s AND archived_at IS NOT NULL",
            (user_id,),
        )
        if row is None:
            raise NotFound("No deleted user with that id.")
        cur.execute("DELETE FROM user_unit_roles WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM staff WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM student WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM external_user_profile WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
        audit("admin.user.purged", target_user_id=user_id, actor_user_id=principal.user_id)
    return "", 204


# --- Role assignments -----------------------------------------------------
@bp.get("/users/<int:user_id>/assignments")
@require_admin
def list_assignments(user_id: int):
    return jsonify(
        query(
            """SELECT uur.user_unit_role_id AS id, uur.role_code AS "roleCode",
                      r.role_name AS "roleName", uur.unit_code AS "unitCode",
                      un.description AS "unitDescription", uur.assigned_at AS "assignedAt"
                 FROM user_unit_roles uur
                 JOIN role r ON r.role_code = uur.role_code
            LEFT JOIN unit un ON un.code = uur.unit_code
                WHERE uur.user_id = %s ORDER BY uur.user_unit_role_id""",
            (user_id,),
        )
    )


@bp.post("/users/<int:user_id>/assignments")
@require_admin
def create_assignment(user_id: int):
    """Grant a role, validating the pairing against role_unit.

    Three rules the database cannot express on its own: a unit-linked role must
    name one of ITS units, a flat role must name none, and a unit may have at
    most one head at a time.
    """
    payload = body()
    (role_code,) = required(payload, "roleCode")
    unit_code = payload.get("unitCode") or None

    with transaction() as cur:
        role = fetch_one(cur, "SELECT * FROM role WHERE role_code = %s", (role_code,))
        if role is None:
            raise NotFound("Role not found.")
        if role_code == "external-user":
            raise Forbidden("External guest accounts are self-registered and cannot be assigned.")

        legal_units = {
            r["unit_code"]
            for r in fetch_all(cur, "SELECT unit_code FROM role_unit WHERE role_code = %s", (role_code,))
        }
        if legal_units and unit_code not in legal_units:
            raise BadRequest(
                "This role must be paired with one of its units: " + ", ".join(sorted(legal_units)) + "."
            )
        if not legal_units and unit_code:
            raise BadRequest("This is a system-wide role and cannot be tied to a unit.")

        # A unit used to be capped at one head, which made a handover impossible
        # to perform safely: installing a successor meant removing the incumbent
        # first, leaving the unit headless in between - and _last_holder_blocker()
        # below now refuses exactly that removal. Appointing the successor first
        # and retiring the incumbent second is the sequence those two rules
        # describe together, so the cap had to go for either to be satisfiable.
        # Two heads is an overlap during a handover, not a steady state.

        duplicate = fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND role_code = %s "
            "AND unit_code IS NOT DISTINCT FROM %s",
            (user_id, role_code, unit_code),
        )
        if duplicate:
            raise Conflict("This user already holds that role.")

        cur.execute(
            """INSERT INTO user_unit_roles (user_id, unit_code, role_code)
               VALUES (%s, %s, %s) RETURNING user_unit_role_id""",
            (user_id, unit_code, role_code),
        )
        assignment_id = cur.fetchone()["user_unit_role_id"]
        audit("admin.assignment.created", target_user_id=user_id, role_code=role_code,
              unit_code=unit_code, actor_user_id=current_principal().user_id)
    return jsonify({"id": assignment_id}), 201


def _last_holder_blocker(cur, assignment_id: int, role_codes: tuple[str, ...],
                         label: str, remedy: str, *, action: str) -> None:
    """Refuse to leave a unit with nobody holding `role_codes`.

    Two situations share this shape and this consequence. A School or Department
    with no head has no one to decide the proposals routed to its Head of
    School/Department stage; a cafeteria with no manager has no one to approve
    its catering orders. Either way the work does not fail loudly - it queues in
    an inbox that belongs to no account, and no amount of chasing moves it. So
    losing the last holder is not a staffing change but a stall, and it is nearly
    always a step someone meant to pair with naming a successor.

    The successor therefore comes first: create_assignment() no longer caps a
    unit at one head, precisely so this check passes when the incumbent is then
    retired. `action` names what was refused ("removed", "deactivated") so the
    message points at the click to undo.

    Only counts LIVE, ACTIVE holders whose ACCOUNT is also live - a head on a
    deactivated account cannot open an inbox, so being succeeded by one leaves
    the same stall. A flat (unit-less) role is never a headship and returns
    immediately.
    """
    row = fetch_one(
        cur,
        "SELECT role_code, unit_code FROM user_unit_roles WHERE user_unit_role_id = %s",
        (assignment_id,),
    )
    if row is None or row["role_code"] not in role_codes or not row["unit_code"]:
        return
    others = fetch_one(
        cur,
        "SELECT count(*) AS c FROM user_unit_roles uur JOIN users u ON u.user_id = uur.user_id "
        " WHERE uur.unit_code = %s AND uur.role_code = ANY(%s) "
        "   AND uur.user_unit_role_id <> %s AND uur.archived_at IS NULL AND uur.is_active "
        "   AND u.is_active AND u.archived_at IS NULL",
        (row["unit_code"], list(role_codes), assignment_id),
    )["c"]
    if others:
        return
    unit = fetch_one(cur, "SELECT description FROM unit WHERE code = %s", (row["unit_code"],))
    name = (unit and unit["description"]) or row["unit_code"]
    raise Conflict(
        f"This is the only {label} for {name}, so the assignment cannot be {action}. "
        f"{remedy} first - both can hold the role while you hand over."
    )


def _assert_unit_keeps_its_leaders(cur, assignment_id: int, *, action: str) -> None:
    """Both last-holder rules, applied to one assignment.

    The cafeteria half duplicates what cafeterias.py already enforces on its own
    staffing routes. That is deliberate: Admin > Users is a second door into the
    same user_unit_roles rows, and a rule that holds from one door but not the
    other does not hold.
    """
    _last_holder_blocker(
        cur, assignment_id, HEAD_ROLE_CODES, "head",
        "Give the unit another Head of School or Head of Department", action=action,
    )
    _last_holder_blocker(
        cur, assignment_id, ("cafeteria-manager",), "Cafeteria Manager",
        "Assign another manager to that cafeteria", action=action,
    )


@bp.delete("/users/<int:user_id>/assignments/<int:assignment_id>")
@require_admin
def delete_assignment(user_id: int, assignment_id: int):
    with transaction() as cur:
        _assert_unit_keeps_its_leaders(cur, assignment_id, action="removed")
        cur.execute(
            "DELETE FROM user_unit_roles WHERE user_unit_role_id = %s AND user_id = %s "
            "RETURNING role_code, unit_code",
            (assignment_id, user_id),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("Assignment not found.")
        audit("admin.assignment.deleted", target_user_id=user_id, role_code=row["role_code"],
              actor_user_id=current_principal().user_id)
    return "", 204


# --- Units ----------------------------------------------------------------
# A unit's code IS its identity - there is no surrogate key - so the client's `id` and `code` are the
# same value, and `name` is the description column.
_UNIT_SELECT = """
    SELECT u.code AS id, u.code, u.description AS name, u.is_active AS active,
           u.archived_at,
           COALESCE(ARRAY_AGG(ru.role_code) FILTER (WHERE ru.role_code IS NOT NULL), '{}')
               AS "roleCodes"
      FROM unit u
 LEFT JOIN role_unit ru ON ru.unit_code = u.code
"""
_UNIT_GROUP_BY = " GROUP BY u.code, u.description, u.is_active, u.archived_at"


def _unit_response(code: str) -> dict:
    rows = query(_UNIT_SELECT + " WHERE u.code = %s" + _UNIT_GROUP_BY, (code,))
    if not rows:
        raise NotFound("Unit not found.")
    row = rows[0]
    row.pop("archived_at", None)
    return row


def _set_unit_roles(cur, code: str, role_codes) -> None:
    """Replace this unit's role links.

    Wholesale rather than per-row: the links are only meaningful as a set, and
    applying them one at a time would leave the unit briefly offering pairings
    the admin never chose.
    """
    cur.execute("DELETE FROM role_unit WHERE unit_code = %s", (code,))
    for role_code in dict.fromkeys(role_codes or ()):
        exists = fetch_one(
            cur, "SELECT 1 FROM role WHERE role_code = %s AND archived_at IS NULL", (role_code,)
        )
        if not exists:
            raise BadRequest("No such role: " + str(role_code) + ".")
        cur.execute(
            "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (role_code, code),
        )


@bp.get("/units")
@require_admin
def list_units():
    rows = query(_UNIT_SELECT + " WHERE u.archived_at IS NULL" + _UNIT_GROUP_BY + " ORDER BY u.description")
    for row in rows:
        row.pop("archived_at", None)
    return jsonify(rows)


@bp.get("/units/archive")
@require_admin
def list_deleted_units():
    """The soft-delete bin. Named /archive because the client asks for it there."""
    return jsonify(
        query(
            _UNIT_SELECT.replace(
                "u.archived_at,",
                'u.archived_at AS "deletedAt",'
                "(u.archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
                "GREATEST(0, %s - EXTRACT(DAY FROM now() - u.archived_at)::int) AS \"daysRemaining\",",
            )
            + " WHERE u.archived_at IS NOT NULL"
            + _UNIT_GROUP_BY.replace("u.archived_at", "u.archived_at")
            + " ORDER BY u.archived_at DESC",
            (RETENTION_DAYS, RETENTION_DAYS),
        )
    )


@bp.post("/units")
@require_admin
def create_unit():
    payload = body()
    # The client sends the display name; older callers sent `description`.
    name = payload.get("name") or payload.get("description")
    if not name or not str(name).strip():
        raise BadRequest("Missing required field(s): name.")
    name = str(name).strip()
    # The code is derived server-side and immutable thereafter, so it can be
    # relied on as a stable routing key.
    code = payload.get("code") or _slug(name)
    if not code:
        raise BadRequest("Name must contain at least one letter or digit.")

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (code,)):
            raise Conflict("A unit with that code already exists.")
        cur.execute(
            "INSERT INTO unit (code, description, is_active) VALUES (%s, %s, %s)",
            (code, name, bool(payload.get("active", True))),
        )
        _set_unit_roles(cur, code, payload.get("roleCodes"))
        audit("admin.unit.created", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_unit_response(code)), 201


def _apply_unit_update(code: str, payload: dict) -> dict:
    fields: dict[str, object] = {}
    if "name" in payload:
        fields["description"] = str(payload["name"]).strip()
    elif "description" in payload:
        fields["description"] = str(payload["description"]).strip()
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (code,)) is None:
            raise NotFound("Unit not found.")
        if fields:
            assignments = ", ".join(f"{c} = %s" for c in fields)
            cur.execute(
                f"UPDATE unit SET {assignments} WHERE code = %s", [*fields.values(), code]
            )
        # A unit's code is immutable; only its name, status and role links move.
        if "roleCodes" in payload:
            _set_unit_roles(cur, code, payload["roleCodes"])
        elif not fields:
            raise BadRequest("No updatable fields were supplied. A unit's code is immutable.")
        audit("admin.unit.updated", unit_code=code, actor_user_id=current_principal().user_id)
    return _unit_response(code)


@bp.put("/units/<code>")
@require_admin
def replace_unit(code: str):
    return jsonify(_apply_unit_update(code, body()))


@bp.patch("/units/<code>")
@require_admin
def update_unit(code: str):
    return jsonify(_apply_unit_update(code, body()))


@bp.patch("/units/<code>/status")
@require_admin
def set_unit_status(code: str):
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    return jsonify(_apply_unit_update(code, {"active": payload["active"]}))


def _unit_blockers(cur, code: str) -> list[str]:
    blockers: list[str] = []
    assigned = fetch_one(
        cur, "SELECT count(*) AS c FROM user_unit_roles WHERE unit_code = %s", (code,)
    )["c"]
    if assigned:
        blockers.append(f"{assigned} user assignment(s) reference this unit")
    tasks = fetch_one(
        cur,
        "SELECT count(*) AS c FROM request_task WHERE assigned_unit_code = %s "
        "AND status NOT IN ('completed','cancelled')",
        (code,),
    )["c"]
    if tasks:
        blockers.append(f"{tasks} open department task(s) are routed here")
    return blockers


@bp.get("/units/<code>/deletion-check")
@require_admin
def unit_deletion_check(code: str):
    """What still depends on this unit. Shown before a destructive click."""
    with transaction() as cur:
        row = fetch_one(cur, "SELECT description FROM unit WHERE code = %s", (code,))
        if row is None:
            raise NotFound("Unit not found.")
        blockers = _unit_blockers(cur, code)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["description"]}
    )


@bp.delete("/units/<code>")
@require_admin
def delete_unit(code: str):
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (code,)) is None:
            raise NotFound("Unit not found.")
        blockers = _unit_blockers(cur, code)
        if blockers:
            raise Conflict(blockers[0] + ". Remove those first.")
        cur.execute(
            "UPDATE unit SET archived_at = now(), is_active = FALSE WHERE code = %s RETURNING code",
            (code,),
        )
        audit("admin.unit.deleted", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_unit_response(code))


@bp.post("/units/<code>/restore")
@require_admin
def restore_unit(code: str):
    with transaction() as cur:
        cur.execute(
            "UPDATE unit SET archived_at = NULL, is_active = TRUE WHERE code = %s RETURNING code",
            (code,),
        )
        if cur.fetchone() is None:
            raise NotFound("Unit not found.")
        audit("admin.unit.restored", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_unit_response(code))


@bp.delete("/units/<code>/purge")
@require_admin
def purge_unit(code: str):
    """Permanent, and only from the bin."""
    with transaction() as cur:
        row = fetch_one(
            cur, "SELECT code FROM unit WHERE code = %s AND archived_at IS NOT NULL", (code,)
        )
        if row is None:
            raise NotFound("No deleted unit with that code.")
        blockers = _unit_blockers(cur, code)
        if blockers:
            raise Conflict(blockers[0] + ". It cannot be purged.")
        cur.execute("DELETE FROM role_unit WHERE unit_code = %s", (code,))
        cur.execute("DELETE FROM unit WHERE code = %s", (code,))
        audit("admin.unit.purged", unit_code=code, actor_user_id=current_principal().user_id)
    return "", 204


_ELIGIBLE_ROLES_SQL = """
    SELECT r.role_code AS "roleCode", r.role_name AS "roleName",
           COALESCE(r.description, '') AS description,
           r.is_protected AS "isProtected", r.is_active AS active,
           COALESCE(ARRAY_AGG(DISTINCT ru2.unit_code)
                    FILTER (WHERE ru2.unit_code IS NOT NULL), '{}') AS "unitCodes"
      FROM role_unit ru
      JOIN role r ON r.role_code = ru.role_code
 LEFT JOIN role_unit ru2 ON ru2.role_code = r.role_code
     WHERE ru.unit_code = ANY(%s) AND r.archived_at IS NULL AND r.is_active
  GROUP BY r.role_code, r.role_name, r.description, r.is_protected, r.is_active
  ORDER BY r.role_name
"""


@bp.get("/units/<code>/roles")
@bp.get("/units/<code>/eligible-roles")
@require_admin
def roles_for_unit(code: str):
    """Roles legally assignable in this unit, so the picker cannot offer a
    pairing the assignment endpoint would reject."""
    return jsonify(query(_ELIGIBLE_ROLES_SQL, ([code],)))


# --- Roles ----------------------------------------------------------------
# unitCodes is the client's field name, and an empty array is what makes a role
# "flat" (system-wide). Aggregated in the statement rather than a query per row.
_ROLE_SELECT = """
    SELECT r.role_code AS "roleCode", r.role_name AS "roleName",
           COALESCE(r.description, '') AS description,
           r.is_protected AS "isProtected", r.is_active AS active, r.archived_at,
           COALESCE(ARRAY_AGG(ru.unit_code) FILTER (WHERE ru.unit_code IS NOT NULL), '{}')
               AS "unitCodes"
      FROM role r
 LEFT JOIN role_unit ru ON ru.role_code = r.role_code
"""
_ROLE_GROUP_BY = (
    " GROUP BY r.role_code, r.role_name, r.description, r.is_protected,"
    " r.is_active, r.archived_at"
)


def _role_response(code: str) -> dict:
    rows = query(_ROLE_SELECT + " WHERE r.role_code = %s" + _ROLE_GROUP_BY, (code,))
    if not rows:
        raise NotFound("Role not found.")
    row = rows[0]
    row.pop("archived_at", None)
    return row


def _set_role_units(cur, code: str, unit_codes) -> None:
    cur.execute("DELETE FROM role_unit WHERE role_code = %s", (code,))
    for unit_code in dict.fromkeys(unit_codes or ()):
        exists = fetch_one(
            cur, "SELECT 1 FROM unit WHERE code = %s AND archived_at IS NULL", (unit_code,)
        )
        if not exists:
            raise BadRequest("No such unit: " + str(unit_code) + ".")
        cur.execute(
            "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (code, unit_code),
        )


@bp.get("/roles")
@require_admin
def list_roles():
    rows = query(_ROLE_SELECT + " WHERE r.archived_at IS NULL" + _ROLE_GROUP_BY + " ORDER BY r.role_name")
    for row in rows:
        row.pop("archived_at", None)
    return jsonify(rows)


@bp.get("/roles/flat")
@require_admin
def list_flat_roles():
    """Roles with no unit links: the ones that mean the same thing everywhere,
    and so are the only ones a plain 'role' page grant may name."""
    return jsonify(
        query(
            _ROLE_SELECT
            + " WHERE r.archived_at IS NULL AND r.is_active"
            + _ROLE_GROUP_BY
            + " HAVING COUNT(ru.unit_code) = 0 ORDER BY r.role_name"
        )
    )


@bp.get("/roles/archive")
@require_admin
def list_deleted_roles():
    return jsonify(
        query(
            _ROLE_SELECT.replace(
                "r.archived_at,",
                'r.archived_at AS "deletedAt",'
                "(r.archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
                "GREATEST(0, %s - EXTRACT(DAY FROM now() - r.archived_at)::int) AS \"daysRemaining\",",
            )
            + " WHERE r.archived_at IS NOT NULL"
            + _ROLE_GROUP_BY
            + " ORDER BY r.archived_at DESC",
            (RETENTION_DAYS, RETENTION_DAYS),
        )
    )


@bp.get("/nav-pages/eligible-roles")
@require_admin
def eligible_roles_for_units():
    """Roles assignable in ANY of the given units - what a unit_role grant may
    name once the admin has picked its units."""
    raw = request.args.get("unitCodes", "")
    unit_codes = [c.strip() for c in raw.split(",") if c.strip()]
    if not unit_codes:
        return jsonify([])
    return jsonify(query(_ELIGIBLE_ROLES_SQL, (unit_codes,)))


@bp.post("/roles")
@require_admin
def create_role():
    payload = body()
    (role_name,) = required(payload, "roleName")
    role_code = payload.get("roleCode") or _slug(str(role_name)).replace("_", "-")
    if not role_code:
        raise BadRequest("Role name must contain at least one letter or digit.")
    # The client sends unitCodes; `units` is the older spelling.
    unit_codes = payload.get("unitCodes", payload.get("units")) or []

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM role WHERE role_code = %s", (role_code,)):
            raise Conflict("A role with that code already exists.")
        cur.execute(
            """INSERT INTO role (role_code, role_name, description, is_protected, is_active)
               VALUES (%s, %s, %s, FALSE, %s)""",
            (
                role_code,
                str(role_name).strip(),
                payload.get("description"),
                bool(payload.get("active", True)),
            ),
        )
        _set_role_units(cur, role_code, unit_codes)
        audit("admin.role.created", role_code=role_code, actor_user_id=current_principal().user_id)
    return jsonify(_role_response(role_code)), 201


def _apply_role_update(code: str, payload: dict) -> dict:
    with transaction() as cur:
        role = fetch_one(cur, "SELECT is_protected FROM role WHERE role_code = %s", (code,))
        if role is None:
            raise NotFound("Role not found.")

        fields: dict[str, object] = {}
        if "roleName" in payload:
            fields["role_name"] = str(payload["roleName"]).strip()
        if "description" in payload:
            fields["description"] = payload["description"]
        if "active" in payload:
            fields["is_active"] = bool(payload["active"])
        if fields:
            assignments = ", ".join(f"{c} = %s" for c in fields)
            cur.execute(
                f"UPDATE role SET {assignments} WHERE role_code = %s", [*fields.values(), code]
            )

        links = payload.get("unitCodes", payload.get("units"))
        if links is not None:
            if role["is_protected"]:
                # Protected roles keep editable names, but their unit links are
                # load-bearing for workflow routing.
                raise Forbidden("A protected role's unit links cannot be changed.")
            _set_role_units(cur, code, links)
        elif not fields:
            raise BadRequest("No updatable fields were supplied.")
        audit("admin.role.updated", role_code=code, actor_user_id=current_principal().user_id)
    return _role_response(code)


@bp.put("/roles/<code>")
@require_admin
def replace_role(code: str):
    return jsonify(_apply_role_update(code, body()))


@bp.patch("/roles/<code>")
@require_admin
def update_role(code: str):
    return jsonify(_apply_role_update(code, body()))


def _role_blockers(cur, code: str) -> list[str]:
    blockers: list[str] = []
    role = fetch_one(cur, "SELECT is_protected FROM role WHERE role_code = %s", (code,))
    if role and role["is_protected"]:
        blockers.append("This role is protected by the workflow and cannot be deleted")
    holders = fetch_one(
        cur, "SELECT count(*) AS c FROM user_unit_roles WHERE role_code = %s", (code,)
    )["c"]
    if holders:
        blockers.append(f"{holders} user(s) still hold this role")
    return blockers


@bp.get("/roles/<code>/deletion-check")
@require_admin
def role_deletion_check(code: str):
    with transaction() as cur:
        row = fetch_one(cur, "SELECT role_name FROM role WHERE role_code = %s", (code,))
        if row is None:
            raise NotFound("Role not found.")
        blockers = _role_blockers(cur, code)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["role_name"]}
    )


@bp.delete("/roles/<code>")
@require_admin
def delete_role(code: str):
    with transaction() as cur:
        role = fetch_one(cur, "SELECT is_protected FROM role WHERE role_code = %s", (code,))
        if role is None:
            raise NotFound("Role not found.")
        if role["is_protected"]:
            raise Forbidden("This role is protected and cannot be deleted.")
        holders = fetch_one(
            cur, "SELECT count(*) AS c FROM user_unit_roles WHERE role_code = %s", (code,)
        )["c"]
        if holders:
            raise Conflict(f"{holders} user(s) still hold this role. Remove those assignments first.")
        cur.execute(
            "UPDATE role SET archived_at = now(), is_active = FALSE WHERE role_code = %s", (code,)
        )
        audit("admin.role.deleted", role_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_role_response(code))


@bp.post("/roles/<code>/restore")
@require_admin
def restore_role(code: str):
    with transaction() as cur:
        cur.execute(
            "UPDATE role SET archived_at = NULL, is_active = TRUE WHERE role_code = %s "
            "RETURNING role_code",
            (code,),
        )
        if cur.fetchone() is None:
            raise NotFound("Role not found.")
        audit("admin.role.restored", role_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_role_response(code))


@bp.delete("/roles/<code>/purge")
@require_admin
def purge_role(code: str):
    with transaction() as cur:
        row = fetch_one(
            cur,
            "SELECT is_protected FROM role WHERE role_code = %s AND archived_at IS NOT NULL",
            (code,),
        )
        if row is None:
            raise NotFound("No deleted role with that code.")
        if row["is_protected"]:
            raise Forbidden("This role is protected and cannot be purged.")
        blockers = _role_blockers(cur, code)
        if blockers:
            raise Conflict(blockers[0] + ". It cannot be purged.")
        cur.execute("DELETE FROM role_unit WHERE role_code = %s", (code,))
        cur.execute("DELETE FROM nav_page_grant_roles WHERE role_code = %s", (code,))
        cur.execute("DELETE FROM role WHERE role_code = %s", (code,))
        audit("admin.role.purged", role_code=code, actor_user_id=current_principal().user_id)
    return "", 204


# --- Page visibility ------------------------------------------------------
_NAV_PAGE_SELECT = """
    SELECT page_code AS "pageCode", label, entry_type AS "entryType", icon,
           route_path AS "routePath", parent_page_code AS "parentPageCode",
           sort_order AS "sortOrder", is_active AS active, archived_at
      FROM nav_page
"""

# Every grant for a set of pages, in one statement rather than one query per
# page - the visibility screen lists the whole sidebar at once.
_GRANTS_FOR_PAGES = """
    SELECT g.page_code,
           g.grant_id AS "grantId",
           g.grant_type AS "grantType",
           g.is_active AS active,
           COALESCE(ARRAY_AGG(DISTINCT gr.role_code)
                    FILTER (WHERE gr.role_code IS NOT NULL), '{}') AS "roleCodes",
           COALESCE(ARRAY_AGG(DISTINCT gu.unit_code)
                    FILTER (WHERE gu.unit_code IS NOT NULL), '{}') AS "unitCodes"
      FROM nav_page_grants g
 LEFT JOIN nav_page_grant_roles gr ON gr.grant_id = g.grant_id
 LEFT JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
     WHERE g.page_code = ANY(%s) AND g.archived_at IS NULL
  GROUP BY g.page_code, g.grant_id, g.grant_type, g.is_active
  ORDER BY g.grant_id
"""


def _with_grants(pages: list[dict]) -> list[dict]:
    if not pages:
        return pages
    grouped: dict[str, list[dict]] = {}
    for grant in query(_GRANTS_FOR_PAGES, ([p["pageCode"] for p in pages],)):
        grouped.setdefault(grant.pop("page_code"), []).append(grant)
    for page in pages:
        page["grants"] = grouped.get(page["pageCode"], [])
        page.pop("archived_at", None)
    return pages


def _nav_page_response(page_code: str) -> dict:
    rows = query(_NAV_PAGE_SELECT + " WHERE page_code = %s", (page_code,))
    if not rows:
        raise NotFound("Page not found.")
    return _with_grants(rows)[0]


@bp.get("/nav-pages")
@require_admin
def list_nav_pages():
    pages = query(
        _NAV_PAGE_SELECT + " WHERE archived_at IS NULL ORDER BY sort_order, page_code"
    )
    return jsonify(_with_grants(pages))


@bp.get("/nav-pages/deleted")
@require_admin
def list_deleted_nav_pages():
    pages = query(
        _NAV_PAGE_SELECT.replace(
            "archived_at\n",
            'archived_at AS "deletedAt",'
            "(archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
            "GREATEST(0, %s - EXTRACT(DAY FROM now() - archived_at)::int) AS \"daysRemaining\"\n",
        )
        + " WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
        (RETENTION_DAYS, RETENTION_DAYS),
    )
    return jsonify(_with_grants(pages))


@bp.post("/nav-pages")
@require_admin
def create_nav_page():
    """A new sidebar entry.

    Both the code and the route are derived from the label: they are what the
    router and every grant key on, so letting the client choose them invites a
    page whose route says one thing and whose code says another. A new entry
    lands at the end of its sibling list.
    """
    payload = body()
    (label,) = required(payload, "label")
    entry_type = payload.get("entryType", "page")
    if entry_type not in ("page", "folder"):
        raise BadRequest("entryType must be 'page' or 'folder'.")

    page_code = payload.get("pageCode") or _slug(str(label)).replace("_", "-")
    if not page_code:
        raise BadRequest("Label must contain at least one letter or digit.")
    parent = payload.get("parentPageCode") or None

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM nav_page WHERE page_code = %s", (page_code,)):
            raise Conflict("A page with that code already exists.")
        if parent:
            parent_row = fetch_one(
                cur,
                "SELECT entry_type FROM nav_page WHERE page_code = %s AND archived_at IS NULL",
                (parent,),
            )
            if parent_row is None:
                raise BadRequest("No such parent page: " + str(parent) + ".")
            if parent_row["entry_type"] != "folder":
                raise BadRequest("Only a folder can hold child pages.")

        next_order = fetch_one(
            cur,
            "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM nav_page "
            "WHERE parent_page_code IS NOT DISTINCT FROM %s",
            (parent,),
        )["next"]
        cur.execute(
            """INSERT INTO nav_page
                   (page_code, label, entry_type, icon, route_path, parent_page_code,
                    sort_order, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                page_code,
                str(label).strip(),
                entry_type,
                payload.get("icon"),
                None if entry_type == "folder" else f"/app/{page_code}",
                parent,
                next_order,
                bool(payload.get("active", True)),
            ),
        )
        audit("admin.nav_page.created", page_code=page_code,
              actor_user_id=current_principal().user_id)
    return jsonify(_nav_page_response(page_code)), 201


def _apply_nav_page_update(page_code: str, payload: dict) -> dict:
    fields: dict[str, object] = {}
    if "label" in payload:
        fields["label"] = str(payload["label"]).strip()
    if "icon" in payload:
        fields["icon"] = payload["icon"]
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])
    if "parentPageCode" in payload:
        fields["parent_page_code"] = payload["parentPageCode"] or None
    if not fields:
        raise BadRequest("No updatable fields were supplied.")

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM nav_page WHERE page_code = %s", (page_code,)) is None:
            raise NotFound("Page not found.")
        parent = fields.get("parent_page_code")
        if parent:
            if parent == page_code:
                raise BadRequest("A page cannot be its own parent.")
            parent_row = fetch_one(
                cur,
                "SELECT entry_type FROM nav_page WHERE page_code = %s AND archived_at IS NULL",
                (parent,),
            )
            if parent_row is None:
                raise BadRequest("No such parent page: " + str(parent) + ".")
            if parent_row["entry_type"] != "folder":
                raise BadRequest("Only a folder can hold child pages.")

        assignments = ", ".join(f"{c} = %s" for c in fields)
        cur.execute(
            f"UPDATE nav_page SET {assignments} WHERE page_code = %s",
            [*fields.values(), page_code],
        )
        audit("admin.nav_page.updated", page_code=page_code,
              changed=sorted(fields), actor_user_id=current_principal().user_id)
    return _nav_page_response(page_code)


@bp.put("/nav-pages/<page_code>")
@require_admin
def replace_nav_page(page_code: str):
    return jsonify(_apply_nav_page_update(page_code, body()))


@bp.patch("/nav-pages/<page_code>")
@require_admin
def update_nav_page(page_code: str):
    return jsonify(_apply_nav_page_update(page_code, body()))


@bp.get("/nav-pages/<page_code>/deletion-check")
@require_admin
def nav_page_deletion_check(page_code: str):
    """What deleting this page would take with it.

    Runs the shared gate (soft_delete's "nav_page" rule) rather than counting
    child pages by hand. The hand-written version only ever looked downward at
    the folder tree, so a page nobody had filed under a folder read as free to
    delete no matter how many roles were relying on it - and deleting it revoked
    every one of those grants silently. A page's grants ARE its usage: they are
    the whole reason the row exists, and the rule for everything else in this app
    is that a record somebody is using gets deactivated, never deleted.
    """
    with transaction() as cur:
        preview = soft_delete.preview(cur, "nav_page", page_code)
    if not preview:
        raise NotFound("Page not found.")
    return jsonify(preview)


@bp.delete("/nav-pages/<page_code>")
@require_admin
def delete_nav_page(page_code: str):
    """Soft delete, refused while anything still depends on the page.

    Two things do. Child pages: deleting their folder orphans them out of the
    sidebar entirely. Permission grants: they are what makes the page visible to
    anyone, so deleting a granted page revokes access that an administrator
    deliberately gave, without ever showing them the list of who loses it.

    Hiding a page that is in use is what the is_active toggle is for - it takes
    the page out of every sidebar and leaves the grants intact to come back to.
    """
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM nav_page WHERE page_code = %s", (page_code,)) is None:
            raise NotFound("Page not found.")
        blockers = soft_delete.soft_delete(cur, "nav_page", page_code)
        if blockers:
            raise Conflict(
                blockers[0] + ". Clear that first, or deactivate the page instead of deleting it."
            )
        audit("admin.nav_page.deleted", page_code=page_code,
              actor_user_id=current_principal().user_id)
    return jsonify(_nav_page_response(page_code))


@bp.post("/nav-pages/<page_code>/restore")
@require_admin
def restore_nav_page(page_code: str):
    with transaction() as cur:
        cur.execute(
            "UPDATE nav_page SET archived_at = NULL, is_active = TRUE WHERE page_code = %s "
            "RETURNING page_code",
            (page_code,),
        )
        if cur.fetchone() is None:
            raise NotFound("Page not found.")
        audit("admin.nav_page.restored", page_code=page_code,
              actor_user_id=current_principal().user_id)
    return jsonify(_nav_page_response(page_code))


@bp.delete("/nav-pages/<page_code>/purge")
@require_admin
def purge_nav_page(page_code: str):
    with transaction() as cur:
        row = fetch_one(
            cur,
            "SELECT page_code FROM nav_page WHERE page_code = %s AND archived_at IS NOT NULL",
            (page_code,),
        )
        if row is None:
            raise NotFound("No deleted page with that code.")
        children = fetch_one(
            cur, "SELECT count(*) AS c FROM nav_page WHERE parent_page_code = %s", (page_code,)
        )["c"]
        if children:
            raise Conflict(f"{children} page(s) still name this one as their parent.")
        cur.execute("DELETE FROM nav_page_grants WHERE page_code = %s", (page_code,))
        cur.execute("DELETE FROM nav_page WHERE page_code = %s", (page_code,))
        audit("admin.nav_page.purged", page_code=page_code,
              actor_user_id=current_principal().user_id)
    return "", 204


# 'cafeteria' carries roles only - it matches those roles in ANY cafeteria unit,
# so unlike 'unit_role' it does not go stale when a new outlet is created. See
# migration 004 and services/identity.py _satisfies_grant.
GRANT_TYPES = ("role", "unit_role", "unit", "cafeteria")


@bp.put("/nav-pages/<page_code>/grants")
@require_admin
def replace_grants(page_code: str):
    """Replace a page's grants wholesale.

    PUT rather than per-row POST/DELETE because permissions are only meaningful
    as a set - applied one row at a time, a page passes through states that
    grant more (or less) than the admin intended.

    A 'role' grant may only carry FLAT roles: a unit-scoped role there would
    mean "Lecturer anywhere", which the model does not express.
    """
    payload = body()
    grants = payload.get("grants")
    if not isinstance(grants, list):
        raise BadRequest("Provide a 'grants' array. An empty array hides the page from everyone.")

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM nav_page WHERE page_code = %s", (page_code,)) is None:
            raise NotFound("Page not found.")

        seen_types: set[str] = set()
        for grant in grants:
            grant_type = grant.get("grantType")
            if grant_type not in GRANT_TYPES:
                raise BadRequest("grantType must be one of: " + ", ".join(GRANT_TYPES) + ".")
            if grant_type in seen_types:
                raise BadRequest(
                    f"Only one '{grant_type}' grant per page is allowed. Merge them into one row."
                )
            seen_types.add(grant_type)

            _assert_grant_is_legal(
                cur, str(grant_type), grant.get("roleCodes") or [], grant.get("unitCodes") or []
            )

        cur.execute("DELETE FROM nav_page_grants WHERE page_code = %s", (page_code,))
        for grant in grants:
            cur.execute(
                """INSERT INTO nav_page_grants (page_code, grant_type, is_active)
                   VALUES (%s, %s, %s) RETURNING grant_id""",
                (page_code, grant["grantType"], bool(grant.get("isActive", True))),
            )
            grant_id = cur.fetchone()["grant_id"]
            _write_grant_links(
                cur,
                grant_id,
                grant.get("roleCodes") or [],
                grant.get("unitCodes") or [],
                str(grant["grantType"]),
            )
        audit("admin.grants.replaced", page_code=page_code, count=len(grants),
              actor_user_id=current_principal().user_id)
    return jsonify({"pageCode": page_code, "grantCount": len(grants)})


# One grant at a time, which is how the Permissions tab edits them. The
# wholesale PUT above stays for callers that own the entire set.
def _grant_response(grant_id: int) -> dict:
    rows = query(
        """SELECT g.grant_id AS "grantId", g.grant_type AS "grantType", g.is_active AS active,
                  COALESCE(ARRAY_AGG(DISTINCT gr.role_code)
                           FILTER (WHERE gr.role_code IS NOT NULL), '{}') AS "roleCodes",
                  COALESCE(ARRAY_AGG(DISTINCT gu.unit_code)
                           FILTER (WHERE gu.unit_code IS NOT NULL), '{}') AS "unitCodes"
             FROM nav_page_grants g
        LEFT JOIN nav_page_grant_roles gr ON gr.grant_id = g.grant_id
        LEFT JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
            WHERE g.grant_id = %s
         GROUP BY g.grant_id, g.grant_type, g.is_active""",
        (grant_id,),
    )
    if not rows:
        raise NotFound("Grant not found.")
    return rows[0]


def _assert_grant_is_legal(cur, grant_type: str, role_codes, unit_codes) -> None:
    """The rules the database cannot state on its own."""
    if grant_type not in GRANT_TYPES:
        raise BadRequest("grantType must be one of: " + ", ".join(GRANT_TYPES) + ".")

    # A 'cafeteria' grant takes its units from the prefix, so a role that cannot
    # be held in a cafeteria would match nothing and read as access that isn't
    # really granted.
    if grant_type == "cafeteria":
        if not role_codes:
            raise BadRequest("A 'cafeteria' grant needs at least one role.")
        eligible = {
            r["role_code"]
            for r in fetch_all(
                cur,
                "SELECT DISTINCT role_code FROM role_unit "
                "WHERE role_code = ANY(%s) AND unit_code LIKE %s",
                (list(role_codes), CAFETERIA_UNIT_PREFIX + "%"),
            )
        }
        stray = sorted(set(role_codes) - eligible)
        if stray:
            raise BadRequest(
                ", ".join(stray)
                + " cannot be held in a cafeteria, so a 'cafeteria' grant for "
                + ("them" if len(stray) > 1 else "it")
                + " would match nobody."
            )

    # A 'role' grant means "holds this role anywhere", which only a role with no
    # unit links can mean.
    if grant_type == "role" and role_codes:
        scoped = [
            r["role_code"]
            for r in fetch_all(
                cur,
                "SELECT DISTINCT role_code FROM role_unit WHERE role_code = ANY(%s)",
                (list(role_codes),),
            )
        ]
        if scoped:
            raise BadRequest(
                "A 'role' grant can only hold system-wide roles. "
                + ", ".join(sorted(scoped))
                + " must be granted with a unit, using 'unit_role'."
            )

    for role_code in role_codes or ():
        if fetch_one(cur, "SELECT 1 FROM role WHERE role_code = %s", (role_code,)) is None:
            raise BadRequest("No such role: " + str(role_code) + ".")
    for unit_code in unit_codes or ():
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (unit_code,)) is None:
            raise BadRequest("No such unit: " + str(unit_code) + ".")


def _write_grant_links(cur, grant_id: int, role_codes, unit_codes, grant_type: str = "") -> None:
    # A 'cafeteria' grant draws its units from the code prefix. Storing a unit
    # list alongside would be dead data that reads like a restriction.
    if grant_type == "cafeteria":
        unit_codes = ()
    cur.execute("DELETE FROM nav_page_grant_roles WHERE grant_id = %s", (grant_id,))
    cur.execute("DELETE FROM nav_page_grant_units WHERE grant_id = %s", (grant_id,))
    for role_code in dict.fromkeys(role_codes or ()):
        cur.execute(
            "INSERT INTO nav_page_grant_roles (grant_id, role_code) VALUES (%s, %s)",
            (grant_id, role_code),
        )
    for unit_code in dict.fromkeys(unit_codes or ()):
        cur.execute(
            "INSERT INTO nav_page_grant_units (grant_id, unit_code) VALUES (%s, %s)",
            (grant_id, unit_code),
        )


@bp.post("/nav-pages/<page_code>/grants")
@require_admin
def add_grant(page_code: str):
    payload = body()
    grant_type = payload.get("grantType")
    role_codes = payload.get("roleCodes") or []
    unit_codes = payload.get("unitCodes") or []

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM nav_page WHERE page_code = %s", (page_code,)) is None:
            raise NotFound("Page not found.")
        _assert_grant_is_legal(cur, str(grant_type), role_codes, unit_codes)
        # nav_page_grants is UNIQUE (page_code, grant_type): a second row of the
        # same type would be rejected by the database anyway, so say why.
        clash = fetch_one(
            cur,
            "SELECT 1 FROM nav_page_grants WHERE page_code = %s AND grant_type = %s "
            "AND archived_at IS NULL",
            (page_code, grant_type),
        )
        if clash:
            raise Conflict(
                f"This page already has a '{grant_type}' grant. Edit that one instead."
            )
        cur.execute(
            """INSERT INTO nav_page_grants (page_code, grant_type, is_active)
               VALUES (%s, %s, %s) RETURNING grant_id""",
            (page_code, grant_type, bool(payload.get("active", True))),
        )
        grant_id = cur.fetchone()["grant_id"]
        _write_grant_links(cur, grant_id, role_codes, unit_codes, str(grant_type))
        audit("admin.grant.created", page_code=page_code, grant_type=grant_type,
              actor_user_id=current_principal().user_id)
    return jsonify(_grant_response(grant_id)), 201


def _grant_for_page(cur, page_code: str, grant_id: int) -> dict:
    row = fetch_one(
        cur,
        "SELECT grant_id, grant_type FROM nav_page_grants "
        "WHERE grant_id = %s AND page_code = %s",
        (grant_id, page_code),
    )
    if row is None:
        raise NotFound("Grant not found on this page.")
    return row


@bp.put("/nav-pages/<page_code>/grants/<int:grant_id>")
@require_admin
def update_grant(page_code: str, grant_id: int):
    payload = body()
    with transaction() as cur:
        existing = _grant_for_page(cur, page_code, grant_id)
        grant_type = payload.get("grantType", existing["grant_type"])
        role_codes = payload.get("roleCodes") or []
        unit_codes = payload.get("unitCodes") or []
        _assert_grant_is_legal(cur, str(grant_type), role_codes, unit_codes)

        cur.execute(
            "UPDATE nav_page_grants SET grant_type = %s WHERE grant_id = %s",
            (grant_type, grant_id),
        )
        _write_grant_links(cur, grant_id, role_codes, unit_codes, str(grant_type))
        audit("admin.grant.updated", page_code=page_code, grant_id=grant_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_grant_response(grant_id))


@bp.patch("/nav-pages/<page_code>/grants/<int:grant_id>")
@require_admin
def set_grant_active(page_code: str, grant_id: int):
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    with transaction() as cur:
        _grant_for_page(cur, page_code, grant_id)
        cur.execute(
            "UPDATE nav_page_grants SET is_active = %s WHERE grant_id = %s",
            (bool(payload["active"]), grant_id),
        )
    return jsonify(_grant_response(grant_id))


@bp.delete("/nav-pages/<page_code>/grants/<int:grant_id>")
@require_admin
def remove_grant(page_code: str, grant_id: int):
    """Hard delete: a grant is a permission, and an archived one that still
    counted would be a permission nobody can see but everybody has."""
    with transaction() as cur:
        _grant_for_page(cur, page_code, grant_id)
        removed = _grant_response(grant_id)
        cur.execute("DELETE FROM nav_page_grants WHERE grant_id = %s", (grant_id,))
        audit("admin.grant.deleted", page_code=page_code, grant_id=grant_id,
              actor_user_id=current_principal().user_id)
    return jsonify(removed)


@bp.get("/nav-pages/preview")
@require_admin
def preview_nav():
    """The sidebar a given role/unit combination would see. Lets an admin check
    a permission change without impersonating anyone."""
    from ..services.identity import nav_tree_for

    role_code = request.args.get("roleCode")
    unit_code = request.args.get("unitCode")
    if not role_code:
        raise BadRequest("A ?roleCode= parameter is required.")
    role = query("SELECT role_name FROM role WHERE role_code = %s", (role_code,))
    fake_roles = [
        {
            "roleCode": role_code,
            "roleName": role[0]["role_name"] if role else role_code,
            "unitCode": unit_code,
            "unitDescription": None,
        }
    ]
    return jsonify(nav_tree_for(0, fake_roles))


@bp.post("/purge-deleted")
@require_admin
def purge_deleted():
    """Permanently remove everything that has outlived the retention window.

    The bin is a 7-day recovery window (RETENTION_DAYS), not storage: once a
    record has sat there longer than that, nobody is coming back for it. This
    is what empties it.

    Meant to run nightly from cron (scripts/purge_deleted.py), but this
    deployment has no always-on host to install that crontab on, so a System
    Admin triggers the identical sweep from the sidebar instead. Both call
    soft_delete.purge_everything(), so the button and the job can never sweep
    different things.

    Safety is in the sweep itself, not here: dependencies are re-checked per row
    IMMEDIATELY BEFORE deletion rather than trusted from when the row was
    archived (a week is long enough for something to have come to reference it),
    each row is committed in its own transaction so one failure cannot abort the
    rest, and a row that has picked up a dependency is left in the bin and
    reported as `blocked` rather than force-deleted.

    ?dryRun=1 reports what WOULD go without deleting anything.
    """
    principal = current_principal()
    dry_run = flag("dryRun")

    if dry_run:
        by_entity = {
            entity: {"eligible": len(soft_delete.expired(entity)), "purged": 0, "blocked": 0, "failed": 0}
            for entity in sorted(soft_delete.DELETION_RULES)
        }
        with transaction() as cur:
            by_entity[soft_delete.ASSIGNMENT_ENTITY] = {
                "eligible": len(soft_delete.expired_assignments(cur)),
                "purged": 0,
                "blocked": 0,
                "failed": 0,
            }
        return jsonify({
            "dryRun": True,
            "byEntity": by_entity,
            "entities": sorted(by_entity),
            "totalPurged": 0,
            "totalBlocked": 0,
            "totalEligible": sum(v["eligible"] for v in by_entity.values()),
            "retentionDays": soft_delete.RETENTION_DAYS,
        })

    by_entity = soft_delete.purge_everything()
    total_purged = sum(v["purged"] for v in by_entity.values())
    total_blocked = sum(v["blocked"] for v in by_entity.values())
    audit(
        "admin.purge_deleted.swept",
        actor_user_id=principal.user_id,
        purged=total_purged,
        blocked=total_blocked,
    )
    return jsonify({
        "dryRun": False,
        "byEntity": by_entity,
        "entities": sorted(by_entity),
        "totalPurged": total_purged,
        "totalBlocked": total_blocked,
        "totalEligible": sum(v["eligible"] for v in by_entity.values()),
        "retentionDays": soft_delete.RETENTION_DAYS,
    })


@bp.post("/send-event-reminders")
@require_admin
def send_event_reminders():
    """Run the event-reminder sweep now, on demand.

    Same situation as the purge sweep above: the reminders are designed to be
    driven by cron (see scripts/send_event_reminders.py and "Scheduled jobs" in
    the backend README), but this deployment has no always-on server to install
    a crontab on. Rather than leave the feature unreachable, a System Admin can
    trigger the identical code path from the UI.

    This is NOT a second implementation - it calls the same
    reminders.send_due_reminders() the cron job calls, so what happens here and
    what would happen at 08:00 are the same thing by construction, and the
    idempotency guarantee holds across both: every send is recorded in
    event_reminder_sent, so pressing the button twice sends nothing the second
    time, and pressing it after a cron run sends only what cron did not.

    ?dryRun=1 reports who WOULD be emailed without sending or recording
    anything - the safe way to check a threshold change before it reaches real
    mailboxes.
    """
    dry_run = flag("dryRun")
    today = dt.date.today()

    with transaction() as cur:
        if dry_run:
            due = {
                "savedCapacity": len(reminders.due_capacity_reminders(cur)),
                "savedStarting": len(reminders.due_saved_starting_reminders(cur)),
                "registeredStarting": len(reminders.due_registered_starting_reminders(cur)),
            }
            return jsonify({
                "dryRun": True,
                "byKind": due,
                "total": sum(due.values()),
                "capacityPercent": reminders.capacity_percent(cur),
                "leadDays": reminders.lead_days(cur),
            })

        sent = reminders.send_due_reminders(cur, today)
        by_kind = {
            "savedCapacity": sent[reminders.CAPACITY],
            "savedStarting": sent[reminders.SAVED_STARTING],
            "registeredStarting": sent[reminders.REGISTERED_STARTING],
        }
        audit(
            "admin.event_reminders.sent",
            actor_user_id=current_principal().user_id,
            total=sum(by_kind.values()),
        )
    return jsonify({"dryRun": False, "byKind": by_kind, "total": sum(by_kind.values())})
