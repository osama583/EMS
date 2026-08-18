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

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_admin
from ..security.passwords import hash_password
from ..security.principal import HEAD_ROLE_CODES, current_principal
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
_USER_SELECT = """
    SELECT u.user_id AS id, u.full_name, u.username, u.email, u.is_active, u.archived_at,
           COALESCE(s.department_or_school, st.school) AS department
      FROM users u
 LEFT JOIN staff s ON s.user_id = u.user_id
 LEFT JOIN student st ON st.user_id = u.user_id
"""


@bp.get("/users")
@require_admin
def list_users():
    deleted = flag("deleted")
    rows = query(
        _USER_SELECT
        + (" WHERE u.archived_at IS NOT NULL" if deleted else " WHERE u.archived_at IS NULL")
        + " ORDER BY u.full_name"
    )
    for row in rows:
        row["roles"] = query(
            """SELECT uur.user_unit_role_id AS "assignmentId", uur.role_code AS "roleCode",
                      r.role_name AS "roleName", uur.unit_code AS "unitCode",
                      un.description AS "unitDescription"
                 FROM user_unit_roles uur
                 JOIN role r ON r.role_code = uur.role_code
            LEFT JOIN unit un ON un.code = uur.unit_code
                WHERE uur.user_id = %s ORDER BY uur.user_unit_role_id""",
            (row["id"],),
        )
        if deleted:
            row["daysRemaining"] = RETENTION_DAYS
    return jsonify(rows)


@bp.post("/users")
@require_admin
def create_user():
    payload = body()
    full_name, email, password = required(payload, "fullName", "email", "password")
    username = payload.get("username") or str(email).split("@")[0]

    with transaction() as cur:
        clash = fetch_one(
            cur,
            "SELECT user_id FROM users WHERE lower(email) = lower(%s) OR lower(username) = lower(%s)",
            (email, username),
        )
        if clash:
            raise Conflict("That email or username is already in use.")
        cur.execute(
            """INSERT INTO users (full_name, username, email, password, is_active)
               VALUES (%s, %s, %s, %s, %s) RETURNING user_id""",
            (full_name, username, email, hash_password(str(password)), bool(payload.get("active", True))),
        )
        user_id = cur.fetchone()["user_id"]
        department = payload.get("department")
        if department:
            cur.execute(
                "INSERT INTO staff (user_id, department_or_school) VALUES (%s, %s)",
                (user_id, department),
            )
        audit("admin.user.created", target_user_id=user_id, actor_user_id=current_principal().user_id)
    return jsonify({"id": user_id}), 201


@bp.patch("/users/<int:user_id>")
@require_admin
def update_user(user_id: int):
    payload = body()
    fields: dict[str, object] = {}
    if "fullName" in payload:
        fields["full_name"] = payload["fullName"]
    if "username" in payload:
        fields["username"] = payload["username"]
    if "email" in payload:
        fields["email"] = payload["email"]
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])
    # A password change goes through the hasher, never straight to the column.
    if payload.get("password"):
        fields["password"] = hash_password(str(payload["password"]))
    if not fields:
        raise BadRequest("No updatable fields were supplied.")

    assignments = ", ".join(f"{c} = %s" for c in fields)
    with transaction() as cur:
        cur.execute(
            f"UPDATE users SET {assignments} WHERE user_id = %s RETURNING user_id",
            [*fields.values(), user_id],
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
        audit("admin.user.updated", target_user_id=user_id,
              changed=sorted(k for k in fields if k != "password"),
              actor_user_id=current_principal().user_id)
    return jsonify({"id": user_id})


@bp.delete("/users/<int:user_id>")
@require_admin
def delete_user(user_id: int):
    principal = current_principal()
    if user_id == principal.user_id:
        raise Conflict("You cannot delete your own account.")
    with transaction() as cur:
        cur.execute(
            "UPDATE users SET archived_at = now(), is_active = FALSE WHERE user_id = %s RETURNING user_id",
            (user_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
        audit("admin.user.deleted", target_user_id=user_id, actor_user_id=principal.user_id)
    return "", 204


@bp.post("/users/<int:user_id>/restore")
@require_admin
def restore_user(user_id: int):
    with transaction() as cur:
        cur.execute(
            "UPDATE users SET archived_at = NULL, is_active = TRUE WHERE user_id = %s RETURNING user_id",
            (user_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("User not found.")
    return jsonify({"id": user_id})


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

        if role_code in HEAD_ROLE_CODES and unit_code:
            existing_head = fetch_one(
                cur,
                """SELECT u.full_name FROM user_unit_roles uur JOIN users u ON u.user_id = uur.user_id
                    WHERE uur.unit_code = %s AND uur.role_code = ANY(%s) AND uur.user_id <> %s""",
                (unit_code, list(HEAD_ROLE_CODES), user_id),
            )
            if existing_head:
                raise Conflict(
                    f"{existing_head['full_name']} already heads this unit. "
                    "Remove that assignment first - a unit has one head at a time."
                )

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


@bp.delete("/users/<int:user_id>/assignments/<int:assignment_id>")
@require_admin
def delete_assignment(user_id: int, assignment_id: int):
    with transaction() as cur:
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
@bp.get("/units")
@require_admin
def list_units():
    deleted = flag("deleted")
    where = "archived_at IS NOT NULL" if deleted else "archived_at IS NULL"
    return jsonify(
        query(f"SELECT code, description, is_active, archived_at FROM unit WHERE {where} ORDER BY description")
    )


@bp.post("/units")
@require_admin
def create_unit():
    payload = body()
    (description,) = required(payload, "description")
    # The code is derived server-side and immutable thereafter, so it can be
    # relied on as a stable routing key.
    code = payload.get("code") or _slug(str(description))
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM unit WHERE code = %s", (code,)):
            raise Conflict("A unit with that code already exists.")
        cur.execute(
            "INSERT INTO unit (code, description, is_active) VALUES (%s, %s, %s)",
            (code, description, bool(payload.get("active", True))),
        )
        audit("admin.unit.created", unit_code=code, actor_user_id=current_principal().user_id)
    return jsonify({"code": code, "description": description}), 201


@bp.patch("/units/<code>")
@require_admin
def update_unit(code: str):
    payload = body()
    fields: dict[str, object] = {}
    if "description" in payload:
        fields["description"] = payload["description"]
    if "active" in payload:
        fields["is_active"] = bool(payload["active"])
    if not fields:
        raise BadRequest("No updatable fields were supplied. A unit's code is immutable.")
    assignments = ", ".join(f"{c} = %s" for c in fields)
    with transaction() as cur:
        cur.execute(
            f"UPDATE unit SET {assignments} WHERE code = %s RETURNING code", [*fields.values(), code]
        )
        if cur.fetchone() is None:
            raise NotFound("Unit not found.")
    return jsonify({"code": code})


@bp.get("/units/<code>/deletion-check")
@require_admin
def unit_deletion_check(code: str):
    """What still depends on this unit. Shown before a destructive click."""
    with transaction() as cur:
        blockers = []
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
    return jsonify({"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": code})


@bp.delete("/units/<code>")
@require_admin
def delete_unit(code: str):
    with transaction() as cur:
        assigned = fetch_one(
            cur, "SELECT count(*) AS c FROM user_unit_roles WHERE unit_code = %s", (code,)
        )["c"]
        if assigned:
            raise Conflict(
                f"{assigned} user(s) are still assigned to this unit. Remove those assignments first."
            )
        cur.execute(
            "UPDATE unit SET archived_at = now(), is_active = FALSE WHERE code = %s RETURNING code",
            (code,),
        )
        if cur.fetchone() is None:
            raise NotFound("Unit not found.")
        audit("admin.unit.deleted", unit_code=code, actor_user_id=current_principal().user_id)
    return "", 204


@bp.get("/units/<code>/roles")
@require_admin
def roles_for_unit(code: str):
    """Roles legally assignable in this unit, so the picker cannot offer a
    pairing the assignment endpoint would reject."""
    return jsonify(
        query(
            """SELECT r.role_code AS "roleCode", r.role_name AS "roleName", r.description
                 FROM role_unit ru JOIN role r ON r.role_code = ru.role_code
                WHERE ru.unit_code = %s AND r.archived_at IS NULL AND r.is_active
             ORDER BY r.role_name""",
            (code,),
        )
    )


# --- Roles ----------------------------------------------------------------
@bp.get("/roles")
@require_admin
def list_roles():
    deleted = flag("deleted")
    where = "archived_at IS NOT NULL" if deleted else "archived_at IS NULL"
    rows = query(
        f"""SELECT role_code AS "roleCode", role_name AS "roleName", description,
                   is_protected AS "isProtected", is_active AS "isActive", archived_at
              FROM role WHERE {where} ORDER BY role_name"""
    )
    for row in rows:
        row["units"] = [
            r["unit_code"]
            for r in query("SELECT unit_code FROM role_unit WHERE role_code = %s", (row["roleCode"],))
        ]
        # No linked units means a flat, system-wide role.
        row["isFlat"] = not row["units"]
    return jsonify(rows)


@bp.post("/roles")
@require_admin
def create_role():
    payload = body()
    (role_name,) = required(payload, "roleName")
    role_code = payload.get("roleCode") or _slug(str(role_name)).replace("_", "-")
    units = payload.get("units") or []

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM role WHERE role_code = %s", (role_code,)):
            raise Conflict("A role with that code already exists.")
        cur.execute(
            """INSERT INTO role (role_code, role_name, description, is_protected, is_active)
               VALUES (%s, %s, %s, FALSE, %s)""",
            (role_code, role_name, payload.get("description"), bool(payload.get("active", True))),
        )
        for unit_code in units:
            cur.execute(
                "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s)", (role_code, unit_code)
            )
        audit("admin.role.created", role_code=role_code, actor_user_id=current_principal().user_id)
    return jsonify({"roleCode": role_code}), 201


@bp.patch("/roles/<code>")
@require_admin
def update_role(code: str):
    payload = body()
    with transaction() as cur:
        role = fetch_one(cur, "SELECT * FROM role WHERE role_code = %s", (code,))
        if role is None:
            raise NotFound("Role not found.")

        fields: dict[str, object] = {}
        if "roleName" in payload:
            fields["role_name"] = payload["roleName"]
        if "description" in payload:
            fields["description"] = payload["description"]
        if "active" in payload:
            fields["is_active"] = bool(payload["active"])
        if fields:
            assignments = ", ".join(f"{c} = %s" for c in fields)
            cur.execute(
                f"UPDATE role SET {assignments} WHERE role_code = %s", [*fields.values(), code]
            )

        if "units" in payload:
            if role["is_protected"]:
                # Protected roles keep editable names, but their unit links are
                # load-bearing for workflow routing.
                raise Forbidden("A protected role's unit links cannot be changed.")
            cur.execute("DELETE FROM role_unit WHERE role_code = %s", (code,))
            for unit_code in payload["units"]:
                cur.execute(
                    "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s)", (code, unit_code)
                )
    return jsonify({"roleCode": code})


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
    return "", 204


# --- Page visibility ------------------------------------------------------
@bp.get("/nav-pages")
@require_admin
def list_nav_pages():
    pages = query(
        """SELECT page_code AS "pageCode", label, entry_type AS "entryType", icon,
                  route_path AS "routePath", parent_page_code AS "parentPageCode",
                  sort_order AS "sortOrder", is_active AS "isActive"
             FROM nav_page WHERE archived_at IS NULL ORDER BY sort_order, page_code"""
    )
    for page in pages:
        page["grants"] = query(
            """SELECT g.grant_id AS id, g.grant_type AS "grantType", g.is_active AS "isActive",
                      COALESCE(ARRAY_AGG(DISTINCT gr.role_code)
                               FILTER (WHERE gr.role_code IS NOT NULL), '{}') AS "roleCodes",
                      COALESCE(ARRAY_AGG(DISTINCT gu.unit_code)
                               FILTER (WHERE gu.unit_code IS NOT NULL), '{}') AS "unitCodes"
                 FROM nav_page_grants g
            LEFT JOIN nav_page_grant_roles gr ON gr.grant_id = g.grant_id
            LEFT JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
                WHERE g.page_code = %s AND g.archived_at IS NULL
             GROUP BY g.grant_id, g.grant_type, g.is_active""",
            (page["pageCode"],),
        )
    return jsonify(pages)


GRANT_TYPES = ("role", "unit_role", "unit")


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

            role_codes = grant.get("roleCodes") or []
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

        cur.execute("DELETE FROM nav_page_grants WHERE page_code = %s", (page_code,))
        for grant in grants:
            cur.execute(
                """INSERT INTO nav_page_grants (page_code, grant_type, is_active)
                   VALUES (%s, %s, %s) RETURNING grant_id""",
                (page_code, grant["grantType"], bool(grant.get("isActive", True))),
            )
            grant_id = cur.fetchone()["grant_id"]
            for role_code in grant.get("roleCodes") or []:
                cur.execute(
                    "INSERT INTO nav_page_grant_roles (grant_id, role_code) VALUES (%s, %s)",
                    (grant_id, role_code),
                )
            for unit_code in grant.get("unitCodes") or []:
                cur.execute(
                    "INSERT INTO nav_page_grant_units (grant_id, unit_code) VALUES (%s, %s)",
                    (grant_id, unit_code),
                )
        audit("admin.grants.replaced", page_code=page_code, count=len(grants),
              actor_user_id=current_principal().user_id)
    return jsonify({"pageCode": page_code, "grantCount": len(grants)})


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
