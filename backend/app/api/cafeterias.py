"""Cafeterias: the outlets, who staffs them, and the requests to change that.

    GET/POST/PUT/DELETE  /catalog/cafeterias[/{code}]
    GET                  /catalog/cafeterias/deleted
    POST                 /catalog/cafeterias/{code}/restore
    DELETE               /catalog/cafeterias/{code}/purge
    GET/POST             /catalog/cafeterias/assignments
    PUT/DELETE           /catalog/cafeterias/assignments/{id}
    GET                  /catalog/cafeterias/assignable-users
    POST                 /catalog/cafeterias/staff-requests
    GET                  /catalog/cafeterias/staff-requests/mine | /inbox
    POST                 /catalog/cafeterias/staff-requests/{id}/approve | /reject

A cafeteria is not its own table: it is a `unit` whose code carries a reserved
prefix, so an outlet is a routing destination like any department and needs no
parallel hierarchy. Staffing is therefore ordinary user_unit_roles rows.

TWO AUTHORITIES, deliberately unequal:
  Cafeteria Admin   - a flat role. Creates outlets and writes assignments.
  Cafeteria Manager - runs ONE outlet. May not write user_unit_roles at all;
                      every add/edit/remove they want is a request the Admin
                      approves. That is why staff requests exist rather than
                      letting a manager edit their own roster: the roster
                      grants access to the system, so granting it stays with
                      the role that is accountable for it.

Approving a request performs the change and records the decision in the same
transaction, so an approved request can never leave the roster unchanged.
"""
from __future__ import annotations

import secrets

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_auth, require_internal
from ..security.passwords import MAX_PASSWORD_BYTES, hash_password
from ..security.principal import current_principal
from ._helpers import body, flag, required

bp = Blueprint("cafeterias", __name__, url_prefix="/catalog/cafeterias")

CAFETERIA_PREFIX = "cafeteria__"
RETENTION_DAYS = 7
STAFF_ROLES = ("cafeteria-manager", "cafeteria-staff")
ROLE_LABELS = {"cafeteria-manager": "Cafeteria Manager", "cafeteria-staff": "Cafeteria Staff"}
ACTIONS = ("add", "edit", "remove", "suspend", "restore")
MIN_REJECTION_COMMENT = 20


def _slug(value: str) -> str:
    out: list[str] = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_")


def _is_cafeteria_admin() -> bool:
    principal = current_principal()
    return principal.is_admin or principal.has_role("cafeteria-admin")


def _assert_cafeteria_admin() -> None:
    if not _is_cafeteria_admin():
        raise Forbidden("Only a Cafeteria Admin can do that.")


def _assert_may_decide_staff_request() -> None:
    """Deciding a Manager's staffing request is the Cafeteria Admin's alone.

    Deliberately NOT _assert_cafeteria_admin: that one also admits System Admin,
    which is right for managing outlets but wrong here. The chain is Manager ->
    Cafeteria Admin, and a System Admin standing in for the approver would make
    the approval step something the chain does not actually require.
    """
    if not current_principal().has_role("cafeteria-admin"):
        raise Forbidden(
            "Only a Cafeteria Admin can decide staffing requests."
        )


def _managed_codes() -> set[str]:
    """The outlets the caller manages. Empty for anyone who is not a manager."""
    return set(current_principal().units_for_role("cafeteria-manager"))


# --- Outlets --------------------------------------------------------------
# The client's Cafeteria: id and code are the same value (a unit has no
# surrogate key), and `name` is the unit's description.
_CAFETERIA_SELECT = """
    SELECT code AS id, code, description AS name, is_active AS active, archived_at
      FROM unit
     WHERE code LIKE 'cafeteria!_!_%%' ESCAPE '!'
"""


def _cafeteria_response(code: str) -> dict:
    rows = query(_CAFETERIA_SELECT + " AND code = %s", (code,))
    if not rows:
        raise NotFound("Cafeteria not found.")
    row = rows[0]
    row.pop("archived_at", None)
    return row


@bp.get("")
@require_auth
def list_cafeterias():
    sql = _CAFETERIA_SELECT + " AND archived_at IS NULL"
    if flag("activeOnly") or flag("active"):
        sql += " AND is_active"
    rows = query(sql + " ORDER BY description")
    for row in rows:
        row.pop("archived_at", None)
    return jsonify(rows)


@bp.get("/deleted")
@require_internal
def list_deleted_cafeterias():
    _assert_cafeteria_admin()
    return jsonify(
        query(
            _CAFETERIA_SELECT.replace(
                "archived_at\n",
                'archived_at AS "deletedAt",'
                "(archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
                "GREATEST(0, %s - EXTRACT(DAY FROM now() - archived_at)::int) AS \"daysRemaining\"\n",
            )
            + " AND archived_at IS NOT NULL ORDER BY archived_at DESC",
            (RETENTION_DAYS, RETENTION_DAYS),
        )
    )


@bp.post("")
@require_internal
def create_cafeteria():
    """The code is derived from the name and prefixed, so an outlet is always
    recognisable as one from its code alone and can never collide with a
    department unit."""
    _assert_cafeteria_admin()
    payload = body()
    (name,) = required(payload, "name")
    slug = _slug(str(name))
    if not slug:
        raise BadRequest("Name must contain at least one letter or digit.")
    code = CAFETERIA_PREFIX + slug

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (code,)):
            raise Conflict("A cafeteria with that name already exists.")
        cur.execute(
            "INSERT INTO unit (code, description, is_active) VALUES (%s, %s, %s)",
            (code, str(name).strip(), bool(payload.get("active", True))),
        )
        # An outlet must accept both staffing roles, or no one could be
        # assigned to it.
        for role_code in STAFF_ROLES:
            cur.execute(
                "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (role_code, code),
            )
        audit("cafeterias.created", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_cafeteria_response(code)), 201


def _load_cafeteria(cur, code: str) -> dict:
    row = fetch_one(
        cur,
        "SELECT code, description, is_active FROM unit WHERE code = %s "
        "AND code LIKE 'cafeteria!_!_%%' ESCAPE '!'",
        (code,),
    )
    if row is None:
        raise NotFound("Cafeteria not found.")
    return row


def _apply_cafeteria_update(code: str, payload: dict) -> dict:
    fields: dict[str, object] = {}
    if "name" in payload:
        fields["description"] = str(payload["name"]).strip()
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])
    if not fields:
        raise BadRequest("No updatable fields were supplied. A cafeteria's code is immutable.")

    with transaction() as cur:
        _load_cafeteria(cur, code)
        assignments = ", ".join(f"{c} = %s" for c in fields)
        cur.execute(f"UPDATE unit SET {assignments} WHERE code = %s", [*fields.values(), code])
        audit("cafeterias.updated", unit_code=code, actor_user_id=current_principal().user_id)
    return _cafeteria_response(code)


@bp.put("/<code>")
@require_internal
def replace_cafeteria(code: str):
    _assert_cafeteria_admin()
    return jsonify(_apply_cafeteria_update(code, body()))


@bp.patch("/<code>")
@require_internal
def update_cafeteria(code: str):
    _assert_cafeteria_admin()
    return jsonify(_apply_cafeteria_update(code, body()))


def _cafeteria_blockers(cur, code: str) -> list[str]:
    staffed = fetch_one(
        cur, "SELECT count(*) AS c FROM user_unit_roles WHERE unit_code = %s", (code,)
    )["c"]
    blockers = [f"{staffed} staff assignment(s) still point at this cafeteria"] if staffed else []
    menu = fetch_one(
        cur,
        "SELECT count(*) AS c FROM fmb_options WHERE unit_code = %s AND archived_at IS NULL",
        (code,),
    )["c"]
    if menu:
        blockers.append(f"{menu} menu item(s) belong to this cafeteria")
    return blockers


@bp.get("/<code>/deletion-check")
@require_internal
def cafeteria_deletion_check(code: str):
    _assert_cafeteria_admin()
    with transaction() as cur:
        row = _load_cafeteria(cur, code)
        blockers = _cafeteria_blockers(cur, code)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["description"]}
    )


@bp.delete("/<code>")
@require_internal
def delete_cafeteria(code: str):
    _assert_cafeteria_admin()
    with transaction() as cur:
        _load_cafeteria(cur, code)
        blockers = _cafeteria_blockers(cur, code)
        if blockers:
            raise Conflict(blockers[0] + ". Clear those first.")
        cur.execute(
            "UPDATE unit SET archived_at = now(), is_active = FALSE WHERE code = %s", (code,)
        )
        audit("cafeterias.deleted", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_cafeteria_response(code))


@bp.post("/<code>/restore")
@require_internal
def restore_cafeteria(code: str):
    _assert_cafeteria_admin()
    with transaction() as cur:
        cur.execute(
            "UPDATE unit SET archived_at = NULL, is_active = TRUE WHERE code = %s RETURNING code",
            (code,),
        )
        if cur.fetchone() is None:
            raise NotFound("Cafeteria not found.")
        audit("cafeterias.restored", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify(_cafeteria_response(code))


@bp.delete("/<code>/purge")
@require_internal
def purge_cafeteria(code: str):
    _assert_cafeteria_admin()
    with transaction() as cur:
        row = fetch_one(
            cur, "SELECT code FROM unit WHERE code = %s AND archived_at IS NOT NULL", (code,)
        )
        if row is None:
            raise NotFound("No deleted cafeteria with that code.")
        blockers = _cafeteria_blockers(cur, code)
        if blockers:
            raise Conflict(blockers[0] + ". It cannot be purged.")
        cur.execute("DELETE FROM role_unit WHERE unit_code = %s", (code,))
        cur.execute("DELETE FROM unit WHERE code = %s", (code,))
        audit("cafeterias.purged", unit_code=code, actor_user_id=current_principal().user_id)
    return "", 204


# --- Assignments ----------------------------------------------------------
_ASSIGNMENT_SELECT = """
    SELECT uur.user_unit_role_id AS "assignmentId", u.user_id AS "userId",
           u.full_name AS "displayName", u.email, u.username,
           u.is_active AS "userActive",
           uur.role_code AS "roleCode", uur.unit_code AS "cafeteriaCode",
           uur.is_active AS active,
           un.description AS "cafeteriaName"
      FROM user_unit_roles uur
      JOIN users u ON u.user_id = uur.user_id
      JOIN unit un ON un.code = uur.unit_code
     WHERE uur.role_code = ANY(%s) AND un.archived_at IS NULL
"""


def _shape_assignments(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["assignmentId"] = str(row["assignmentId"])
        row["userId"] = str(row["userId"])
        row["roleLabel"] = ROLE_LABELS.get(row["roleCode"], row["roleCode"])
    return rows


def _assignment_response(assignment_id: int) -> dict:
    rows = query(
        _ASSIGNMENT_SELECT + " AND uur.user_unit_role_id = %s", (list(STAFF_ROLES), assignment_id)
    )
    if not rows:
        raise NotFound("Assignment not found.")
    return _shape_assignments(rows)[0]


@bp.get("/assignments")
@require_internal
def list_assignments():
    """Every cafeteria staffing row.

    An Admin sees all outlets; a Manager sees only the outlets they run, so the
    scope comes from their own roles rather than from a query parameter.
    """
    sql = _ASSIGNMENT_SELECT
    params: list = [list(STAFF_ROLES)]
    if not _is_cafeteria_admin():
        managed = _managed_codes()
        if not managed:
            raise Forbidden("You do not manage a cafeteria.")
        sql += " AND uur.unit_code = ANY(%s)"
        params.append(sorted(managed))
    rows = query(sql + " ORDER BY un.description, u.full_name", params)
    return jsonify(_shape_assignments(rows))


@bp.get("/assignable-users")
@require_internal
def assignable_users():
    """Internal users who could take a cafeteria role.

    Excludes anyone who already holds one: a person staffs one outlet, and
    offering an existing holder would only produce a duplicate the assignment
    endpoint rejects.
    """
    _assert_cafeteria_admin()
    rows = query(
        """SELECT u.user_id AS id, u.full_name AS "displayName", u.email
             FROM users u
            WHERE u.is_active AND u.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM user_unit_roles r
                               WHERE r.user_id = u.user_id AND r.role_code = ANY(%s))
              AND NOT EXISTS (SELECT 1 FROM user_unit_roles r
                               WHERE r.user_id = u.user_id AND r.role_code = 'external-user')
         ORDER BY u.full_name""",
        (list(STAFF_ROLES),),
    )
    for row in rows:
        row["id"] = str(row["id"])
    return jsonify(rows)


def _assert_assignable(cur, user_id: int, cafeteria_code: str, role_code: str,
                       *, exclude_assignment: int | None = None) -> None:
    if role_code not in STAFF_ROLES:
        raise BadRequest("roleCode must be one of: " + ", ".join(STAFF_ROLES) + ".")
    _load_cafeteria(cur, cafeteria_code)
    user = fetch_one(
        cur,
        "SELECT 1 FROM users WHERE user_id = %s AND is_active AND archived_at IS NULL",
        (user_id,),
    )
    if user is None:
        raise NotFound("User not found.")

    clash = fetch_one(
        cur,
        "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND role_code = ANY(%s) "
        "AND (%s::bigint IS NULL OR user_unit_role_id <> %s)",
        (user_id, list(STAFF_ROLES), exclude_assignment, exclude_assignment),
    )
    if clash:
        raise Conflict("That user already staffs a cafeteria. Remove that assignment first.")

    # One manager per outlet: two would each believe the roster is theirs.
    if role_code == "cafeteria-manager":
        existing = fetch_one(
            cur,
            "SELECT u.full_name FROM user_unit_roles r JOIN users u ON u.user_id = r.user_id "
            "WHERE r.unit_code = %s AND r.role_code = 'cafeteria-manager' "
            "  AND (%s::bigint IS NULL OR r.user_unit_role_id <> %s)",
            (cafeteria_code, exclude_assignment, exclude_assignment),
        )
        if existing:
            raise Conflict(
                f"{existing['full_name']} already manages this cafeteria. "
                "Remove that assignment first."
            )


@bp.post("/assignments")
@require_internal
def create_assignment():
    """Assign someone to a cafeteria.

    The Admin creates the person and their posting in one step: a cafeteria hire
    is a new account far more often than an existing user changing jobs, and
    creating the account elsewhere first only to come back and assign it is two
    screens for one act. Passing `userId` instead still assigns an existing
    account, which is what the edit path does.
    """
    _assert_cafeteria_admin()
    payload = body()
    cafeteria_code, role_code = required(payload, "cafeteriaCode", "roleCode")
    user_id = payload.get("userId")

    with transaction() as cur:
        if not user_id:
            user_id = _create_staff_account(cur, payload)
        _assert_assignable(cur, int(user_id), str(cafeteria_code), str(role_code))
        cur.execute(
            "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, %s, %s) "
            "RETURNING user_unit_role_id",
            (int(user_id), cafeteria_code, role_code),
        )
        assignment_id = cur.fetchone()["user_unit_role_id"]
        audit("cafeterias.assignment.created", target_user_id=int(user_id),
              unit_code=cafeteria_code, role_code=role_code,
              actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id)), 201


@bp.put("/assignments/<int:assignment_id>")
@require_internal
def update_assignment(assignment_id: int):
    """Move an assignment to another outlet or role.

    The user is deliberately not changeable: reassigning to a different person
    is a removal and an addition, two decisions that should each be recorded.
    """
    _assert_cafeteria_admin()
    payload = body()
    with transaction() as cur:
        existing = fetch_one(
            cur,
            "SELECT user_id, unit_code, role_code FROM user_unit_roles "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s)",
            (assignment_id, list(STAFF_ROLES)),
        )
        if existing is None:
            raise NotFound("Assignment not found.")
        cafeteria_code = payload.get("cafeteriaCode", existing["unit_code"])
        role_code = payload.get("roleCode", existing["role_code"])
        _assert_assignable(
            cur, existing["user_id"], str(cafeteria_code), str(role_code),
            exclude_assignment=assignment_id,
        )
        cur.execute(
            "UPDATE user_unit_roles SET unit_code = %s, role_code = %s "
            "WHERE user_unit_role_id = %s",
            (cafeteria_code, role_code, assignment_id),
        )
        # The person's own details, when the Admin edited them on the same form.
        _apply_user_detail_changes(cur, existing["user_id"], {
            "payload_display_name": payload.get("displayName"),
            "payload_username": payload.get("username"),
            "payload_email": payload.get("email"),
            "payload_active": payload.get("userActive"),
            "payload_password_hash": (
                _hash_new_password(str(payload["password"])) if payload.get("password") else None
            ),
        })
        audit("cafeterias.assignment.updated", assignment_id=assignment_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id))


@bp.patch("/assignments/<int:assignment_id>/status")
@require_internal
def set_assignment_status(assignment_id: int):
    """Suspend or restore a posting without discarding it.

    Distinct from DELETE: someone on leave keeps their assignment (and its
    history) and simply stops appearing on the active roster.
    """
    _assert_cafeteria_admin()
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    with transaction() as cur:
        cur.execute(
            "UPDATE user_unit_roles SET is_active = %s "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s)",
            (bool(payload["active"]), assignment_id, list(STAFF_ROLES)),
        )
        if cur.rowcount == 0:
            raise NotFound("Assignment not found.")
        audit("cafeterias.assignment.status", assignment_id=assignment_id,
              active=bool(payload["active"]), actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id))


@bp.delete("/assignments/<int:assignment_id>")
@require_internal
def delete_assignment(assignment_id: int):
    _assert_cafeteria_admin()
    with transaction() as cur:
        cur.execute(
            "DELETE FROM user_unit_roles WHERE user_unit_role_id = %s AND role_code = ANY(%s) "
            "RETURNING user_id, unit_code",
            (assignment_id, list(STAFF_ROLES)),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("Assignment not found.")
        audit("cafeterias.assignment.deleted", assignment_id=assignment_id,
              target_user_id=row["user_id"], actor_user_id=current_principal().user_id)
    return "", 204


# --- Staff requests -------------------------------------------------------
_STAFF_REQUEST_SELECT = """
    SELECT r.cafeteria_staff_request_id AS id, r.cafeteria_code AS "cafeteriaCode",
           un.description AS "cafeteriaName",
           r.requested_by_user_id AS "requestedByUserId",
           req.full_name AS "requestedByName",
           r.action, r.target_assignment_id AS "targetAssignmentId",
           r.target_user_id AS "targetUserId",
           COALESCE(r.payload_display_name, t.full_name, '') AS "displayName",
           COALESCE(r.payload_email, t.email, '') AS email,
           COALESCE(r.payload_username, t.username, '') AS username,
           r.payload_active AS "proposedActive",
           (r.payload_password_hash IS NOT NULL) AS "setsPassword",
           -- The target's CURRENT details, so the Admin can see what an edit
           -- actually changes rather than only what it proposes.
           t.full_name AS "currentDisplayName", t.email AS "currentEmail",
           t.username AS "currentUsername", t.is_active AS "currentActive",
           a.is_active AS "assignmentActive",
           r.role_code AS "roleCode", r.status, COALESCE(r.comment, '') AS comment,
           r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
           res.full_name AS "resolvedByName"
      FROM cafeteria_staff_requests r
      JOIN unit un ON un.code = r.cafeteria_code
      JOIN users req ON req.user_id = r.requested_by_user_id
 LEFT JOIN users t ON t.user_id = r.target_user_id
 LEFT JOIN users res ON res.user_id = r.resolved_by_user_id
 LEFT JOIN user_unit_roles a ON a.user_unit_role_id = r.target_assignment_id
"""


def _shape_requests(rows: list[dict]) -> list[dict]:
    for row in rows:
        for key in ("id", "requestedByUserId", "targetAssignmentId", "targetUserId"):
            if row.get(key) is not None:
                row[key] = str(row[key])
    return rows


def _staff_request_response(request_id: int) -> dict:
    rows = query(_STAFF_REQUEST_SELECT + " WHERE r.cafeteria_staff_request_id = %s", (request_id,))
    if not rows:
        raise NotFound("Request not found.")
    return _shape_requests(rows)[0]


def _hash_new_password(plaintext: str) -> str:
    """Hash a password chosen for someone else, refusing one bcrypt cannot hold."""
    if len(plaintext.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"A password must be {MAX_PASSWORD_BYTES} bytes or fewer.")
    if len(plaintext) < 8:
        raise BadRequest("A password must be at least 8 characters.")
    return hash_password(plaintext)


def _assert_identity_free(cur, email: str, username=None) -> None:
    """Reject a clash while the Manager can still fix it.

    Without this the request is accepted and only fails at approval, in front of
    the Admin, with the Manager no longer present to correct it.
    """
    if fetch_one(cur, "SELECT 1 FROM users WHERE lower(email) = lower(%s)", (email.strip(),)):
        raise Conflict("An account with that email address already exists.")
    if username and fetch_one(
        cur, "SELECT 1 FROM users WHERE lower(username) = lower(%s)", (str(username).strip(),)
    ):
        raise Conflict("An account with that username already exists.")


def _assert_no_pending_request(cur, cafeteria_code: str, target_user, email) -> None:
    """One request per person may await a decision (migration 007).

    Two pending rows about the same person are two roster changes the Admin will
    apply, and the second lands on a roster the first already changed.
    """
    if target_user:
        clash = fetch_one(
            cur,
            "SELECT cafeteria_staff_request_id FROM cafeteria_staff_requests "
            "WHERE status = 'pending' AND cafeteria_code = %s AND target_user_id = %s",
            (cafeteria_code, int(target_user)),
        )
        who = "That person"
    elif email:
        clash = fetch_one(
            cur,
            "SELECT cafeteria_staff_request_id FROM cafeteria_staff_requests "
            "WHERE status = 'pending' AND cafeteria_code = %s AND target_user_id IS NULL "
            "AND lower(payload_email) = lower(%s)",
            (cafeteria_code, str(email).strip()),
        )
        who = "That email address"
    else:
        return
    if clash:
        raise Conflict(
            f"{who} already has a request awaiting a decision. Wait for the Cafeteria "
            "Admin to resolve it, or withdraw it first."
        )


@bp.post("/staff-requests")
@require_internal
def submit_staff_request():
    """A Manager asks the Admin to change their roster.

    The cafeteria is taken from the caller's own manager role, never from the
    body: a manager must not be able to file a request against an outlet that
    is not theirs.
    """
    payload = body()
    (action,) = required(payload, "action")
    if action not in ACTIONS:
        raise BadRequest("action must be one of: " + ", ".join(ACTIONS) + ".")

    managed = _managed_codes()
    if not managed:
        raise Forbidden("Only a Cafeteria Manager can raise a staffing request.")
    cafeteria_code = payload.get("cafeteriaCode") or next(iter(sorted(managed)))
    if cafeteria_code not in managed:
        raise Forbidden("You do not manage that cafeteria.")

    # A Manager staffs their outlet; they do not appoint their own peers. Naming
    # a manager is how someone would grant themselves a colleague with equal
    # authority over the roster, so the role is fixed here rather than trusted
    # from the body. Only a Cafeteria Admin assigns managers.
    role_code = payload.get("roleCode") or "cafeteria-staff"
    if role_code != "cafeteria-staff":
        raise Forbidden(
            "A Manager can only request Cafeteria Staff. Ask a Cafeteria Admin to "
            "appoint a manager."
        )

    principal = current_principal()
    with transaction() as cur:
        _load_cafeteria(cur, str(cafeteria_code))
        target_assignment = payload.get("targetAssignmentId")
        target_user = payload.get("targetUserId")

        if action in ("edit", "remove", "suspend", "restore"):
            if not target_assignment:
                raise BadRequest(f"A '{action}' request needs targetAssignmentId.")
            owned = fetch_one(
                cur,
                "SELECT user_id FROM user_unit_roles WHERE user_unit_role_id = %s "
                "AND unit_code = %s AND role_code = ANY(%s)",
                (int(target_assignment), cafeteria_code, list(STAFF_ROLES)),
            )
            if owned is None:
                raise NotFound("That assignment is not at your cafeteria.")
            target_user = owned["user_id"]
        elif not (target_user or payload.get("email")):
            raise BadRequest("An 'add' request needs targetUserId or an email address.")

        # An 'add' creates the account only once approved, so the credential has
        # to survive until then - hashed here, never stored in the clear.
        password_hash = None
        if payload.get("password"):
            password_hash = _hash_new_password(str(payload["password"]))
        if action == "add" and payload.get("email"):
            _assert_identity_free(cur, str(payload["email"]), payload.get("username"))

        # Spell out the clash before the unique index raises a raw constraint
        # error. The index is what actually guarantees it (two concurrent
        # submits both pass this read), but it cannot produce a useful message.
        _assert_no_pending_request(
            cur, str(cafeteria_code), target_user, payload.get("email")
        )

        cur.execute(
            """INSERT INTO cafeteria_staff_requests
                   (cafeteria_code, requested_by_user_id, action, target_user_id,
                    target_assignment_id, payload_display_name, payload_email,
                    payload_username, payload_password_hash, payload_active,
                    role_code, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
               RETURNING cafeteria_staff_request_id""",
            (
                cafeteria_code,
                principal.user_id,
                action,
                int(target_user) if target_user else None,
                int(target_assignment) if target_assignment else None,
                payload.get("displayName"),
                payload.get("email"),
                payload.get("username"),
                password_hash,
                payload.get("active") if "active" in payload else None,
                role_code,
            ),
        )
        request_id = cur.fetchone()["cafeteria_staff_request_id"]
        # Not `action=`: that is audit()'s own first parameter.
        audit("cafeterias.staff_request.created", request_id=request_id,
              unit_code=cafeteria_code, requested_action=action,
              actor_user_id=principal.user_id)
    return jsonify(_staff_request_response(request_id)), 201


@bp.get("/staff-requests/mine")
@require_internal
def my_staff_requests():
    """The caller's own requests, scoped to them rather than to a parameter."""
    rows = query(
        _STAFF_REQUEST_SELECT + " WHERE r.requested_by_user_id = %s ORDER BY r.created_at DESC",
        (current_principal().user_id,),
    )
    return jsonify(_shape_requests(rows))


@bp.get("/staff-requests/inbox")
@require_internal
def staff_request_inbox():
    """Pending requests awaiting an Admin's decision."""
    _assert_cafeteria_admin()
    rows = query(
        _STAFF_REQUEST_SELECT + " WHERE r.status = 'pending' ORDER BY r.created_at",
    )
    return jsonify(_shape_requests(rows))


def _create_staff_account(cur, payload: dict) -> int:
    """Create the account a cafeteria posting is for.

    Shares its rules with the request flow so a Manager's proposal and an
    Admin's direct create cannot diverge on what makes a valid account.
    """
    display_name, email = required(payload, "displayName", "email")
    email = str(email).strip().lower()
    username = str(payload.get("username") or email.split("@")[0]).strip()[:80]
    _assert_identity_free(cur, email, username)

    password = payload.get("password")
    password_hash = (
        _hash_new_password(str(password))
        if password
        # No password named: a random one nobody holds, so the account exists
        # but is reachable only through a reset.
        else hash_password(secrets.token_urlsafe(32))
    )
    cur.execute(
        """INSERT INTO users (full_name, username, email, password, is_active)
           VALUES (%s, %s, %s, %s, %s) RETURNING user_id""",
        (
            str(display_name).strip(),
            username,
            email,
            password_hash,
            bool(payload.get("active", True)),
        ),
    )
    user_id = cur.fetchone()["user_id"]
    audit("cafeterias.staff_account.created", target_user_id=user_id,
          actor_user_id=current_principal().user_id)
    return user_id


def _apply_user_detail_changes(cur, user_id: int, req: dict) -> None:
    """Write the person's own details from an approved request.

    Only the fields the request named are touched: a Manager who changed just
    the email must not silently reset the display name or the active flag.
    """
    fields: dict[str, object] = {}
    if req.get("payload_display_name"):
        fields["full_name"] = req["payload_display_name"]
    if req.get("payload_username"):
        fields["username"] = req["payload_username"]
    if req.get("payload_email"):
        fields["email"] = str(req["payload_email"]).strip().lower()
    if req.get("payload_active") is not None:
        fields["is_active"] = req["payload_active"]
    if req.get("payload_password_hash"):
        fields["password"] = req["payload_password_hash"]
    if not fields:
        return

    for column, value in (("username", fields.get("username")), ("email", fields.get("email"))):
        if value and fetch_one(
            cur,
            f"SELECT 1 FROM users WHERE lower({column}) = lower(%s) AND user_id <> %s",
            (value, user_id),
        ):
            raise Conflict(f"Another account already uses that {column}.")

    assignments = ", ".join(f"{c} = %s" for c in fields)
    cur.execute(
        f"UPDATE users SET {assignments} WHERE user_id = %s",
        [*fields.values(), user_id],
    )


def _apply_staff_request(cur, req: dict) -> None:
    """Carry out an approved request against user_unit_roles."""
    action = req["action"]
    code = req["cafeteria_code"]
    role_code = req["role_code"]

    if action == "remove":
        cur.execute(
            "DELETE FROM user_unit_roles WHERE user_unit_role_id = %s AND unit_code = %s",
            (req["target_assignment_id"], code),
        )
        return

    if action in ("suspend", "restore"):
        # Suspending clears the roster without discarding the assignment, so the
        # person's history (and assigned_at) survives a spell of leave.
        cur.execute(
            "UPDATE user_unit_roles SET is_active = %s "
            "WHERE user_unit_role_id = %s AND unit_code = %s",
            (action == "restore", req["target_assignment_id"], code),
        )
        if cur.rowcount == 0:
            raise Conflict("That assignment no longer exists.")
        return

    if action == "edit":
        assignment = fetch_one(
            cur,
            "SELECT user_id FROM user_unit_roles WHERE user_unit_role_id = %s",
            (req["target_assignment_id"],),
        )
        if assignment is None:
            raise Conflict("That assignment no longer exists.")
        _assert_assignable(
            cur, assignment["user_id"], code, role_code,
            exclude_assignment=req["target_assignment_id"],
        )
        cur.execute(
            "UPDATE user_unit_roles SET role_code = %s WHERE user_unit_role_id = %s",
            (role_code, req["target_assignment_id"]),
        )
        # An edit request may also carry the person's own details. Applied only
        # for the fields the request actually named, so approving an edit cannot
        # blank out something the Manager left alone.
        _apply_user_detail_changes(cur, assignment["user_id"], req)
        return

    # add: an existing user, or a new account created for the named address.
    user_id = req["target_user_id"]
    if user_id is None:
        email = (req["payload_email"] or "").strip().lower()
        if not email:
            raise Conflict("This request names no user and no email address.")
        found = fetch_one(cur, "SELECT user_id FROM users WHERE lower(email) = %s", (email,))
        if found:
            user_id = found["user_id"]
        else:
            username = req.get("payload_username") or email.split("@")[0][:80]
            if fetch_one(cur, "SELECT 1 FROM users WHERE lower(username) = lower(%s)", (username,)):
                username = username[:70] + "-" + str(req["cafeteria_staff_request_id"])
            cur.execute(
                """INSERT INTO users (full_name, username, email, password, is_active)
                   VALUES (%s, %s, %s, %s, %s) RETURNING user_id""",
                (
                    req["payload_display_name"] or email.split("@")[0],
                    username,
                    email,
                    # Already hashed when the request was raised (migration 009),
                    # so no plaintext credential is ever stored. A request that
                    # named no password gets a random one nobody holds, leaving
                    # the account reachable only through a reset.
                    req.get("payload_password_hash") or hash_password(secrets.token_urlsafe(32)),
                    req["payload_active"] if req.get("payload_active") is not None else True,
                ),
            )
            user_id = cur.fetchone()["user_id"]

    _assert_assignable(cur, user_id, code, role_code)
    cur.execute(
        "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, %s, %s)",
        (user_id, code, role_code),
    )


def _decide_staff_request(request_id: int, decision: str, comment: str) -> dict:
    _assert_may_decide_staff_request()
    if decision == "reject" and len(comment) < MIN_REJECTION_COMMENT:
        raise BadRequest(
            f"A rejection needs an explanation of at least {MIN_REJECTION_COMMENT} characters."
        )
    principal = current_principal()
    with transaction() as cur:
        req = fetch_one(
            cur,
            "SELECT * FROM cafeteria_staff_requests WHERE cafeteria_staff_request_id = %s",
            (request_id,),
        )
        if req is None:
            raise NotFound("Request not found.")
        if req["status"] != "pending":
            raise Conflict("This request has already been decided.")

        # The roster change and the decision land together: an approved request
        # that failed to apply would be a lie in the audit trail.
        if decision == "approve":
            _apply_staff_request(cur, req)

        cur.execute(
            """UPDATE cafeteria_staff_requests
                  SET status = %s, comment = %s, resolved_at = now(), resolved_by_user_id = %s
                WHERE cafeteria_staff_request_id = %s""",
            (
                "approved" if decision == "approve" else "rejected",
                comment or None,
                principal.user_id,
                request_id,
            ),
        )
        audit("cafeterias.staff_request.decided", request_id=request_id,
              decision=decision, actor_user_id=principal.user_id)
    return _staff_request_response(request_id)


@bp.post("/staff-requests/<int:request_id>/approve")
@require_internal
def approve_staff_request(request_id: int):
    return jsonify(_decide_staff_request(request_id, "approve", ""))


@bp.post("/staff-requests/<int:request_id>/reject")
@require_internal
def reject_staff_request(request_id: int):
    payload = body()
    return jsonify(
        _decide_staff_request(request_id, "reject", str(payload.get("comment") or "").strip())
    )
