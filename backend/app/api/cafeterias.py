"""Cafeterias: the outlets and who staffs them.

    GET/POST/PUT/DELETE  /catalog/cafeterias[/{code}]
    GET                  /catalog/cafeterias/deleted
    POST                 /catalog/cafeterias/{code}/restore
    DELETE               /catalog/cafeterias/{code}/purge
    GET/POST             /catalog/cafeterias/assignments
    PUT/DELETE           /catalog/cafeterias/assignments/{id}
    GET                  /catalog/cafeterias/assignments/{id}/deletion-check
    GET                  /catalog/cafeterias/assignments/deleted
    POST                 /catalog/cafeterias/assignments/{id}/restore
    GET                  /catalog/cafeterias/assignable-users
    GET                  /catalog/cafeterias/staff-requests-history

A cafeteria is not its own table: it is a `unit` whose code carries a reserved
prefix, so an outlet is a routing destination like any department and needs no
parallel hierarchy. Staffing is therefore ordinary user_unit_roles rows.

TWO AUTHORITIES, both able to write directly:
  Cafeteria Admin   - a flat role. Creates outlets and writes assignments for
                      any cafeteria.
  Cafeteria Manager - runs ONE outlet. May create, edit, suspend/restore, and
                      remove staff at their own outlet directly - scoped to
                      their own cafeteria code and to the 'cafeteria-staff'
                      role only (they cannot appoint a peer manager).

An outlet may hold more than one manager, and the last one cannot be removed,
suspended or moved away (_assert_not_last_manager). The two rules are a pair: a
cafeteria with nobody running it has no one to answer its catering orders, so a
handover has to install the successor before retiring the incumbent, which is
only possible if both may hold the role at once.
"""
from __future__ import annotations

import secrets

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_auth, require_internal
from ..security.passwords import MAX_PASSWORD_BYTES, hash_password
from ..services import soft_delete
from ..services.email import notifications
from ..security.principal import current_principal
from ._helpers import body, flag, paged, pagination, required

bp = Blueprint("cafeterias", __name__, url_prefix="/catalog/cafeterias")

CAFETERIA_PREFIX = "cafeteria__"
RETENTION_DAYS = 7
STAFF_ROLES = ("cafeteria-manager", "cafeteria-staff")
ROLE_LABELS = {"cafeteria-manager": "Cafeteria Manager", "cafeteria-staff": "Cafeteria Staff"}


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


def _managed_codes() -> set[str]:
    """The outlets the caller manages. Empty for anyone who is not a manager."""
    return set(current_principal().units_for_role("cafeteria-manager"))


def _assert_may_staff(cafeteria_code: str, role_code: str) -> None:
    """Either a Cafeteria Admin (any outlet, any staff role) or a Cafeteria
    Manager acting on their own outlet and only naming 'cafeteria-staff' -
    a manager does not appoint a peer manager over their own roster."""
    if _is_cafeteria_admin():
        return
    if cafeteria_code in _managed_codes() and role_code == "cafeteria-staff":
        return
    raise Forbidden("You are not authorised to manage staff at that cafeteria.")


def _actor_role() -> str:
    """The caller's role as it should read on the audit log - the most
    specific one that actually explains why they were allowed to act."""
    principal = current_principal()
    if principal.has_role("system-admin"):
        return "system-admin"
    if principal.has_role("cafeteria-admin"):
        return "cafeteria-admin"
    return "cafeteria-manager"


def _record_staff_audit(cur, *, cafeteria_code: str, action: str, target_user_id: int,
                        target_display_name: str, target_email: str, role_code: str) -> None:
    """One row per staff create/edit/suspend/restore/remove, written in the
    same transaction as the write it records. This is the audit log's only
    source of truth - separate from audit() (logging_setup.py), which writes
    a structured log line, not a queryable table."""
    principal = current_principal()
    cur.execute(
        """INSERT INTO cafeteria_staff_audit_log
               (cafeteria_code, action, target_user_id, target_display_name, target_email,
                role_code, actor_user_id, actor_display_name, actor_role)
           VALUES (%s, %s, %s, %s, %s, %s, %s,
                   (SELECT full_name FROM users WHERE user_id = %s), %s)""",
        (
            cafeteria_code, action, target_user_id, target_display_name, target_email,
            role_code, principal.user_id, principal.user_id, _actor_role(),
        ),
    )


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
    """Server-side search/status-filter/pagination, mirroring what the Manage
    Cafeterias screen used to do client-side over the full unpaginated list
    (cafeteria-manage.ts's filteredCafeterias/pageSlice) - the query here is
    that same predicate, just run in the database instead of fetched-then-
    filtered in the browser, so the endpoint cannot hand back every outlet in
    one response.

    ?activeOnly/?active still work unpaginated for the plain pickers (F&B's
    read-only Cafeteria Menus viewer, the proposal form) that just want every
    live outlet and never called this with ?page - those stay a small, bounded
    list and get no filtering to preserve their existing contract.

    ?namesOnly=true projects just code/name - for a caller that only needs to
    populate a "which cafeteria" dropdown (Staff Action History's filter) and
    has no use for `active`/`id`, so there is no reason to send it.
    """
    where = ["archived_at IS NULL"]
    params: list = []

    active_only = flag("activeOnly") or flag("active")
    if active_only:
        where.append("is_active")

    search = (request.args.get("q") or "").strip()
    if search:
        where.append("(description ILIKE %s OR code ILIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    status_filter = (request.args.get("status") or "").strip().lower()
    if status_filter in ("active", "inactive"):
        where.append("is_active = %s")
        params.append(status_filter == "active")

    where_sql = " AND ".join(where)

    if flag("namesOnly"):
        return jsonify(
            query(
                "SELECT code, description AS name FROM unit "
                f"WHERE code LIKE 'cafeteria!_!_%%' ESCAPE '!' AND {where_sql} ORDER BY description",
                params,
            )
        )

    if "page" not in request.args and "pageSize" not in request.args:
        rows = query(_CAFETERIA_SELECT + f" AND {where_sql} ORDER BY description", params)
        for row in rows:
            row.pop("archived_at", None)
        return jsonify(rows)

    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS c FROM unit WHERE code LIKE 'cafeteria!_!_%%' ESCAPE '!' AND {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            _CAFETERIA_SELECT + f" AND {where_sql} ORDER BY description LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    for row in rows:
        row.pop("archived_at", None)
    return jsonify(paged(rows, total))


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
_ASSIGNMENT_COLUMNS = """
    uur.user_unit_role_id AS "assignmentId", u.user_id AS "userId",
    u.full_name AS "displayName", u.email,
    u.is_active AS "userActive",
    uur.role_code AS "roleCode", uur.unit_code AS "cafeteriaCode",
    uur.is_active AS active,
    un.description AS "cafeteriaName"
"""
_ASSIGNMENT_FROM = """
    FROM user_unit_roles uur
    JOIN users u ON u.user_id = uur.user_id
    JOIN unit un ON un.code = uur.unit_code
"""
_ASSIGNMENT_SELECT = (
    f"SELECT {_ASSIGNMENT_COLUMNS} {_ASSIGNMENT_FROM} "
    "WHERE uur.role_code = ANY(%s) AND un.archived_at IS NULL AND uur.archived_at IS NULL"
)


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
    """Cafeteria staffing rows, server-side searched/filtered/paginated -
    mirroring what Staff Assignments used to do client-side over the full
    unfiltered list (cafeteria-staff-assignments.ts's filteredAssignments/
    pageSlice): search by name/email/cafeteria and filter by role, now run in
    the database instead of fetched-then-filtered in the browser, so the
    endpoint cannot hand back every staffing row in one response.

    An Admin sees all outlets; a Manager sees only the outlets they run, so
    that scope comes from their own roles rather than from a query parameter
    and is applied before search/role/pagination narrow it further.

    ?page/?pageSize are optional: omitted, the endpoint returns the full
    (already role-scoped) array as before, for any caller that still wants
    that - only Staff Assignments sends them.
    """
    where = ["uur.role_code = ANY(%s)", "un.archived_at IS NULL", "uur.archived_at IS NULL"]
    params: list = [list(STAFF_ROLES)]
    if not _is_cafeteria_admin():
        managed = _managed_codes()
        if not managed:
            raise Forbidden("You do not manage a cafeteria.")
        where.append("uur.unit_code = ANY(%s)")
        params.append(sorted(managed))

    search = (request.args.get("q") or "").strip()
    if search:
        where.append("(u.full_name ILIKE %s OR u.email ILIKE %s OR un.description ILIKE %s)")
        params.extend([f"%{search}%"] * 3)

    role_filter = (request.args.get("role") or "").strip()
    if role_filter:
        if role_filter not in STAFF_ROLES:
            raise BadRequest("role must be one of: " + ", ".join(STAFF_ROLES) + ".")
        where.append("uur.role_code = %s")
        params.append(role_filter)

    where_sql = " AND ".join(where)

    if "page" not in request.args and "pageSize" not in request.args:
        rows = query(
            f"SELECT {_ASSIGNMENT_COLUMNS} {_ASSIGNMENT_FROM} WHERE {where_sql} "
            "ORDER BY un.description, u.full_name",
            params,
        )
        return jsonify(_shape_assignments(rows))

    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS c {_ASSIGNMENT_FROM} WHERE {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"SELECT {_ASSIGNMENT_COLUMNS} {_ASSIGNMENT_FROM} WHERE {where_sql} "
            "ORDER BY un.description, u.full_name LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    return jsonify(paged(_shape_assignments(rows), total))


@bp.get("/assignable-users")
@require_internal
def assignable_users():
    """Internal users who could take a cafeteria role.

    Excludes anyone who already holds one: a person staffs one outlet, and
    offering an existing holder would only produce a duplicate the assignment
    endpoint rejects. Open to a Cafeteria Manager too - they need this to pick
    an existing user for their own outlet, same as the Admin does for any.
    """
    if not _is_cafeteria_admin() and not _managed_codes():
        raise Forbidden("You are not authorised to view assignable users.")
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
        "AND archived_at IS NULL AND (%s::bigint IS NULL OR user_unit_role_id <> %s)",
        (user_id, list(STAFF_ROLES), exclude_assignment, exclude_assignment),
    )
    if clash:
        raise Conflict("That user already staffs a cafeteria. Remove that assignment first.")

    # An outlet may briefly hold TWO managers, deliberately. It used to be capped
    # at one, which read as tidy but made a handover impossible to perform
    # safely: the only way to install a successor was to remove the incumbent
    # first, leaving the outlet unmanaged in between - and _assert_not_last_manager()
    # below now refuses exactly that removal. Appointing the successor first and
    # retiring the incumbent second is the sequence those two rules describe
    # together, so the cap has to go for either of them to be satisfiable.


def _assert_not_last_manager(cur, assignment_id: int, unit_code: str, role_code: str,
                             *, action: str) -> None:
    """Refuse to leave an outlet with nobody running it.

    A cafeteria with no manager has no one to approve its catering orders, no
    one who can hire or suspend its staff, and no addressee for the emails the
    workflow sends it - the orders simply queue up unanswered. Losing the last
    manager is therefore not a staffing change, it is an outage, and it is
    almost always a step someone meant to pair with appointing a replacement.

    So the replacement comes first: _assert_assignable() lets a second manager
    be appointed alongside the incumbent precisely so this check passes when the
    incumbent is then retired. `action` names what was refused ("removed",
    "suspended", "moved") so the message tells the caller which click to undo.

    Only counts LIVE, ACTIVE postings - an archived or suspended manager cannot
    approve anything, so being succeeded by one is the same outage.
    """
    if role_code != "cafeteria-manager":
        return
    others = fetch_one(
        cur,
        "SELECT count(*) AS c FROM user_unit_roles uur JOIN users u ON u.user_id = uur.user_id "
        " WHERE uur.unit_code = %s AND uur.role_code = 'cafeteria-manager' "
        "   AND uur.user_unit_role_id <> %s AND uur.archived_at IS NULL AND uur.is_active "
        "   AND u.is_active AND u.archived_at IS NULL",
        (unit_code, assignment_id),
    )["c"]
    if others:
        return
    outlet = fetch_one(cur, "SELECT description FROM unit WHERE code = %s", (unit_code,))
    name = (outlet and outlet["description"]) or unit_code
    raise Conflict(
        f"This is the only Cafeteria Manager for {name}, so the posting cannot be {action}. "
        "Assign another manager to this cafeteria first - both can hold the role while you "
        "hand over."
    )


@bp.post("/assignments")
@require_internal
def create_assignment():
    """Assign someone to a cafeteria.

    The caller creates the person and their posting in one step: a cafeteria
    hire is a new account far more often than an existing user changing jobs,
    and creating the account elsewhere first only to come back and assign it
    is two screens for one act. Passing `userId` instead still assigns an
    existing account, which is what the edit path does. A Cafeteria Manager
    may do this too, scoped to their own outlet and to 'cafeteria-staff' only.
    """
    payload = body()
    cafeteria_code, role_code = required(payload, "cafeteriaCode", "roleCode")
    cafeteria_code, role_code = str(cafeteria_code), str(role_code)
    _assert_may_staff(cafeteria_code, role_code)
    user_id = payload.get("userId")

    with transaction() as cur:
        created_now = not user_id
        if not user_id:
            user_id = _create_staff_account(cur, payload)
        _assert_assignable(cur, int(user_id), str(cafeteria_code), str(role_code))
        cur.execute(
            "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, %s, %s) "
            "RETURNING user_unit_role_id",
            (int(user_id), cafeteria_code, role_code),
        )
        assignment_id = cur.fetchone()["user_unit_role_id"]
        target = fetch_one(cur, "SELECT full_name, email FROM users WHERE user_id = %s", (int(user_id),))
        # Only for an account created HERE: an existing user being reassigned
        # already has a password and must not be sent a new-account email. The
        # plaintext exists only inside this request (see _create_staff_account).
        if created_now and payload.get("password"):
            cafeteria = fetch_one(
                cur, "SELECT description FROM unit WHERE code = %s", (cafeteria_code,)
            )
            notifications.cafeteria_staff_account_created(
                email=target["email"],
                full_name=target["full_name"],
                password=str(payload["password"]),
                cafeteria_name=(cafeteria and cafeteria["description"]) or cafeteria_code,
                role_code=role_code,
            )
        _record_staff_audit(
            cur, cafeteria_code=cafeteria_code, action="create", target_user_id=int(user_id),
            target_display_name=target["full_name"], target_email=target["email"], role_code=role_code,
        )
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
    A Cafeteria Manager may edit their own outlet's staff directly, but both
    the assignment's current outlet and any outlet/role it's moved to must
    stay inside their own scope.
    """
    payload = body()
    with transaction() as cur:
        existing = fetch_one(
            cur,
            "SELECT user_id, unit_code, role_code FROM user_unit_roles "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s) AND archived_at IS NULL",
            (assignment_id, list(STAFF_ROLES)),
        )
        if existing is None:
            raise NotFound("Assignment not found.")
        cafeteria_code = str(payload.get("cafeteriaCode", existing["unit_code"]))
        role_code = str(payload.get("roleCode", existing["role_code"]))
        _assert_may_staff(existing["unit_code"], existing["role_code"])
        _assert_may_staff(cafeteria_code, role_code)
        _assert_assignable(
            cur, existing["user_id"], str(cafeteria_code), str(role_code),
            exclude_assignment=assignment_id,
        )
        # Moving this posting to another outlet, or demoting it to staff, takes a
        # manager off its current cafeteria exactly as removing it would.
        if existing["role_code"] == "cafeteria-manager" and (
            cafeteria_code != existing["unit_code"] or role_code != "cafeteria-manager"
        ):
            _assert_not_last_manager(
                cur, assignment_id, existing["unit_code"], existing["role_code"], action="moved",
            )
        cur.execute(
            "UPDATE user_unit_roles SET unit_code = %s, role_code = %s "
            "WHERE user_unit_role_id = %s",
            (cafeteria_code, role_code, assignment_id),
        )
        # The person's own details, when the Admin edited them on the same form.
        _apply_user_detail_changes(cur, existing["user_id"], {
            "payload_display_name": payload.get("displayName"),
            "payload_email": payload.get("email"),
            "payload_active": payload.get("userActive"),
            "payload_password_hash": (
                _hash_new_password(str(payload["password"])) if payload.get("password") else None
            ),
        })
        target = fetch_one(cur, "SELECT full_name, email FROM users WHERE user_id = %s", (existing["user_id"],))
        _record_staff_audit(
            cur, cafeteria_code=cafeteria_code, action="edit", target_user_id=existing["user_id"],
            target_display_name=target["full_name"], target_email=target["email"], role_code=role_code,
        )
        audit("cafeterias.assignment.updated", assignment_id=assignment_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id))


@bp.patch("/assignments/<int:assignment_id>/status")
@require_internal
def set_assignment_status(assignment_id: int):
    """Suspend or restore a posting without discarding it.

    Distinct from DELETE: someone on leave keeps their assignment (and its
    history) and simply stops appearing on the active roster. A Cafeteria
    Manager may do this for their own outlet's staff.
    """
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    with transaction() as cur:
        existing = fetch_one(
            cur,
            "SELECT user_id, unit_code, role_code FROM user_unit_roles "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s) AND archived_at IS NULL",
            (assignment_id, list(STAFF_ROLES)),
        )
        if existing is None:
            raise NotFound("Assignment not found.")
        _assert_may_staff(existing["unit_code"], existing["role_code"])
        if not payload["active"]:
            _assert_not_last_manager(
                cur, assignment_id, existing["unit_code"], existing["role_code"],
                action="suspended",
            )
        cur.execute(
            "UPDATE user_unit_roles SET is_active = %s "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s)",
            (bool(payload["active"]), assignment_id, list(STAFF_ROLES)),
        )
        if cur.rowcount == 0:
            raise NotFound("Assignment not found.")
        target = fetch_one(cur, "SELECT full_name, email FROM users WHERE user_id = %s", (existing["user_id"],))
        _record_staff_audit(
            cur, cafeteria_code=existing["unit_code"],
            action="restore" if payload["active"] else "suspend",
            target_user_id=existing["user_id"], target_display_name=target["full_name"],
            target_email=target["email"], role_code=existing["role_code"],
        )
        audit("cafeterias.assignment.status", assignment_id=assignment_id,
              active=bool(payload["active"]), actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id))


def _load_assignment(cur, assignment_id: int, *, archived: bool = False) -> dict:
    """One posting, live or binned, with the details every delete path reports."""
    row = fetch_one(
        cur,
        "SELECT uur.user_id, uur.unit_code, uur.role_code, u.full_name, u.email "
        "  FROM user_unit_roles uur JOIN users u ON u.user_id = uur.user_id "
        " WHERE uur.user_unit_role_id = %s AND uur.role_code = ANY(%s) "
        f"   AND uur.archived_at IS {'NOT NULL' if archived else 'NULL'}",
        (assignment_id, list(STAFF_ROLES)),
    )
    if row is None:
        raise NotFound(
            "No deleted assignment with that id." if archived else "Assignment not found."
        )
    return row


def _assignment_delete_blockers(cur, assignment_id: int, row: dict) -> list[str]:
    """Everything that refuses this delete: work done here, and the outage rule.

    soft_delete.assignment_blockers() answers "has this posting been used",
    scoped to the outlet. The last-manager rule is a second, different refusal -
    the posting may be brand new and still be the only thing keeping the outlet
    running - so it is folded in here rather than left to surprise the caller
    after the confirm dialog already said yes.
    """
    blockers = soft_delete.assignment_blockers(cur, row["user_id"], row["unit_code"])
    try:
        _assert_not_last_manager(
            cur, assignment_id, row["unit_code"], row["role_code"], action="removed",
        )
    except Conflict as exc:
        blockers.append(str(exc))
    return blockers


@bp.get("/assignments/<int:assignment_id>/deletion-check")
@require_internal
def assignment_deletion_check(assignment_id: int):
    """What deleting this posting would run into. Shown before the click, so a
    posting that cannot go explains itself in the dialog rather than the delete
    being refused after it."""
    with transaction() as cur:
        row = _load_assignment(cur, assignment_id)
        _assert_may_staff(row["unit_code"], row["role_code"])
        blockers = _assignment_delete_blockers(cur, assignment_id, row)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["full_name"]}
    )


@bp.delete("/assignments/<int:assignment_id>")
@require_internal
def delete_assignment(assignment_id: int):
    """Retire a posting. A Cafeteria Manager may do this for their own outlet's
    staff.

    Soft delete, which is what migration 023 added the column for: the row is
    stamped rather than removed, so a mis-click stays recoverable for
    RETENTION_DAYS and the sweep performs the permanent removal. `is_active` is
    deliberately left alone - archived_at is what every live read now filters
    on, and preserving the suspend flag means a restore brings the posting back
    exactly as it was found.
    """
    with transaction() as cur:
        existing = _load_assignment(cur, assignment_id)
        _assert_may_staff(existing["unit_code"], existing["role_code"])
        blockers = _assignment_delete_blockers(cur, assignment_id, existing)
        if blockers:
            raise Conflict(blockers[0])
        cur.execute(
            "UPDATE user_unit_roles SET archived_at = now() "
            "WHERE user_unit_role_id = %s AND role_code = ANY(%s) AND archived_at IS NULL",
            (assignment_id, list(STAFF_ROLES)),
        )
        if cur.rowcount == 0:
            raise NotFound("Assignment not found.")
        _record_staff_audit(
            cur, cafeteria_code=existing["unit_code"], action="remove",
            target_user_id=existing["user_id"], target_display_name=existing["full_name"],
            target_email=existing["email"], role_code=existing["role_code"],
        )
        audit("cafeterias.assignment.deleted", assignment_id=assignment_id,
              target_user_id=existing["user_id"], actor_user_id=current_principal().user_id)
    return "", 204


@bp.get("/assignments/deleted")
@require_internal
def list_deleted_assignments():
    """The bin: postings awaiting a restore or the sweep, scoped to the caller's
    own outlets exactly like the live list."""
    where = ["uur.role_code = ANY(%s)", "uur.archived_at IS NOT NULL"]
    params: list = [list(STAFF_ROLES)]
    if not _is_cafeteria_admin():
        managed = _managed_codes()
        if not managed:
            raise Forbidden("You do not manage a cafeteria.")
        where.append("uur.unit_code = ANY(%s)")
        params.append(sorted(managed))
    rows = query(
        f"SELECT {_ASSIGNMENT_COLUMNS},"
        '       uur.archived_at AS "deletedAt",'
        '       (uur.archived_at + make_interval(days => %s)) AS "permanentDeletionAt",'
        "       GREATEST(0, %s - EXTRACT(DAY FROM now() - uur.archived_at)::int)"
        '           AS "daysRemaining"'
        f" {_ASSIGNMENT_FROM} WHERE {' AND '.join(where)} ORDER BY uur.archived_at DESC",
        [RETENTION_DAYS, RETENTION_DAYS, *params],
    )
    return jsonify(_shape_assignments(rows))


@bp.post("/assignments/<int:assignment_id>/restore")
@require_internal
def restore_assignment(assignment_id: int):
    """Bring a posting back out of the bin.

    Refused when the person has taken a LIVE posting in the meantime:
    uq_user_unit_roles_live (migration 024) would reject the write anyway, and a
    unique-violation 500 is a worse answer than saying what happened.
    """
    with transaction() as cur:
        existing = _load_assignment(cur, assignment_id, archived=True)
        _assert_may_staff(existing["unit_code"], existing["role_code"])
        clash = fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND role_code = ANY(%s) "
            "  AND archived_at IS NULL",
            (existing["user_id"], list(STAFF_ROLES)),
        )
        if clash:
            raise Conflict(
                f"{existing['full_name']} already staffs a cafeteria. "
                "Remove that posting before restoring this one."
            )
        cur.execute(
            "UPDATE user_unit_roles SET archived_at = NULL WHERE user_unit_role_id = %s",
            (assignment_id,),
        )
        _record_staff_audit(
            cur, cafeteria_code=existing["unit_code"], action="restore",
            target_user_id=existing["user_id"], target_display_name=existing["full_name"],
            target_email=existing["email"], role_code=existing["role_code"],
        )
        audit("cafeterias.assignment.restored", assignment_id=assignment_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_assignment_response(assignment_id))


def _hash_new_password(plaintext: str) -> str:
    """Hash a password chosen for someone else, refusing one bcrypt cannot hold."""
    if len(plaintext.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise BadRequest(f"A password must be {MAX_PASSWORD_BYTES} bytes or fewer.")
    if len(plaintext) < 8:
        raise BadRequest("A password must be at least 8 characters.")
    return hash_password(plaintext)


def _assert_identity_free(cur, email: str) -> None:
    """Reject a clash while the Manager can still fix it.

    Without this the request is accepted and only fails at approval, in front of
    the Admin, with the Manager no longer present to correct it. Email is the
    account's only identifier, so it is the only thing to check.
    """
    if fetch_one(cur, "SELECT 1 FROM users WHERE lower(email) = lower(%s)", (email.strip(),)):
        raise Conflict("An account with that email address already exists.")


def _create_staff_account(cur, payload: dict) -> int:
    """Create the account a cafeteria posting is for.

    Shares its rules with the request flow so a Manager's proposal and an
    Admin's direct create cannot diverge on what makes a valid account.
    """
    display_name, email = required(payload, "displayName", "email")
    email = str(email).strip().lower()
    _assert_identity_free(cur, email)

    password = payload.get("password")
    password_hash = (
        _hash_new_password(str(password))
        if password
        # No password named: a random one nobody holds, so the account exists
        # but is reachable only through a reset.
        else hash_password(secrets.token_urlsafe(32))
    )
    cur.execute(
        """INSERT INTO users (full_name, email, password, is_active)
           VALUES (%s, %s, %s, %s) RETURNING user_id""",
        (
            str(display_name).strip(),
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
    if req.get("payload_email"):
        fields["email"] = str(req["payload_email"]).strip().lower()
    if req.get("payload_active") is not None:
        fields["is_active"] = req["payload_active"]
    if req.get("payload_password_hash"):
        fields["password"] = req["payload_password_hash"]
    if not fields:
        return

    # Switching the ACCOUNT off takes its postings down with it, so the outlet is
    # left unmanaged exactly as removing the posting would leave it - the Edit
    # Staff form is simply another way to reach that state, and it has to be
    # refused from here too.
    if fields.get("is_active") is False:
        for row in fetch_all(
            cur,
            "SELECT user_unit_role_id, unit_code, role_code FROM user_unit_roles "
            " WHERE user_id = %s AND role_code = 'cafeteria-manager' "
            "   AND archived_at IS NULL AND is_active",
            (user_id,),
        ):
            _assert_not_last_manager(
                cur, row["user_unit_role_id"], row["unit_code"], row["role_code"],
                action="deactivated",
            )

    email = fields.get("email")
    if email and fetch_one(
        cur,
        "SELECT 1 FROM users WHERE lower(email) = lower(%s) AND user_id <> %s",
        (email, user_id),
    ):
        raise Conflict("Another account already uses that email address.")

    assignments = ", ".join(f"{c} = %s" for c in fields)
    cur.execute(
        f"UPDATE users SET {assignments} WHERE user_id = %s",
        [*fields.values(), user_id],
    )


# --- Staff action audit log ------------------------------------------------
_AUDIT_ACTIONS = ("create", "edit", "suspend", "restore", "remove")
_AUDIT_ACTOR_ROLES = ("cafeteria-manager", "cafeteria-admin", "system-admin")
_AUDIT_SORT_COLUMNS = {
    "createdAt": "l.created_at",
    "cafeteria": "un.description",
    "target": "l.target_display_name",
    "actor": "l.actor_display_name",
    "action": "l.action",
}
_AUDIT_SELECT = """
    SELECT l.cafeteria_staff_audit_log_id AS id, l.cafeteria_code AS "cafeteriaCode",
           un.description AS "cafeteriaName", l.action,
           l.target_user_id AS "targetUserId", l.target_display_name AS "targetDisplayName",
           l.target_email AS "targetEmail", l.role_code AS "roleCode",
           l.actor_user_id AS "actorUserId", l.actor_display_name AS "actorDisplayName",
           l.actor_role AS "actorRole", l.created_at AS "createdAt"
      FROM cafeteria_staff_audit_log l
      JOIN unit un ON un.code = l.cafeteria_code
"""


@bp.get("/staff-requests-history")
@require_internal
def staff_audit_log():
    """Server-side searched/filtered/sorted/paginated audit trail of staff
    create/edit/suspend/restore/remove actions.

    Cafeteria Admin sees every cafeteria's timeline; Cafeteria Manager sees
    only their own outlet's (which may include an Admin's actions there too -
    the point is "what happened at my cafeteria", not "what I personally
    did"). ?actorRole=cafeteria-manager|cafeteria-admin|system-admin narrows
    by who performed the action, so a Manager can tell what they are and are
    not responsible for.
    """
    if not _is_cafeteria_admin():
        managed = _managed_codes()
        if not managed:
            raise Forbidden("You do not manage a cafeteria.")

    where = ["1 = 1"]
    params: list = []
    if not _is_cafeteria_admin():
        where.append("l.cafeteria_code = ANY(%s)")
        params.append(sorted(_managed_codes()))

    cafeteria_filter = (request.args.get("cafeteriaCode") or "").strip()
    if cafeteria_filter:
        where.append("l.cafeteria_code = %s")
        params.append(cafeteria_filter)

    action_filter = (request.args.get("action") or "").strip()
    if action_filter:
        if action_filter not in _AUDIT_ACTIONS:
            raise BadRequest("action must be one of: " + ", ".join(_AUDIT_ACTIONS) + ".")
        where.append("l.action = %s")
        params.append(action_filter)

    actor_role_filter = (request.args.get("actorRole") or "").strip()
    if actor_role_filter:
        if actor_role_filter not in _AUDIT_ACTOR_ROLES:
            raise BadRequest("actorRole must be one of: " + ", ".join(_AUDIT_ACTOR_ROLES) + ".")
        where.append("l.actor_role = %s")
        params.append(actor_role_filter)

    search = (request.args.get("q") or "").strip()
    if search:
        where.append(
            "(l.target_display_name ILIKE %s OR l.target_email ILIKE %s "
            "OR l.actor_display_name ILIKE %s OR un.description ILIKE %s)"
        )
        params.extend([f"%{search}%"] * 4)

    where_sql = " AND ".join(where)

    sort_key = request.args.get("sort", "createdAt")
    sort_column = _AUDIT_SORT_COLUMNS.get(sort_key, "l.created_at")
    order = "ASC" if request.args.get("order") == "asc" else "DESC"

    with transaction() as cur:
        total = fetch_one(cur, f"SELECT count(*) AS c FROM cafeteria_staff_audit_log l "
                                f"JOIN unit un ON un.code = l.cafeteria_code WHERE {where_sql}",
                           params)["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"{_AUDIT_SELECT} WHERE {where_sql} ORDER BY {sort_column} {order}, l.cafeteria_staff_audit_log_id {order} "
            f"LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    for row in rows:
        row["id"] = str(row["id"])
        row["targetUserId"] = str(row["targetUserId"])
        row["actorUserId"] = str(row["actorUserId"])
        row["roleLabel"] = ROLE_LABELS.get(row["roleCode"], row["roleCode"])
    return jsonify(paged(rows, total))

