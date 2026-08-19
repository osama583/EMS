"""Projects a user row into the AuthUser payload the frontend consumes.

One place builds this shape, so /auth/login, /auth/refresh and /auth/me can
never drift apart. Password hashes are never read into the projection.
"""
from __future__ import annotations

from typing import Any

from ..db import query, query_one

# Every cafeteria outlet is a unit whose code the create endpoint prefixes
# (app/api/cafeterias.py CAFETERIA_PREFIX), so this prefix is what makes a unit a
# cafeteria. The 'cafeteria' grant type below relies on it.
CAFETERIA_UNIT_PREFIX = "cafeteria__"

_ROLES_SQL = """
    SELECT uur.user_unit_role_id,
           uur.role_code,
           r.role_name,
           uur.unit_code,
           u.description AS unit_description
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit u ON u.code = uur.unit_code
     WHERE uur.user_id = %s
       AND r.archived_at IS NULL
  ORDER BY uur.user_unit_role_id
"""

_NAV_PAGES_SQL = """
    SELECT page_code, label, entry_type, icon, route_path, parent_page_code, sort_order
      FROM nav_page
     WHERE is_active AND archived_at IS NULL
  ORDER BY sort_order, page_code
"""

# Each grant row carries a SET of roles and a SET of units, via its two junction
# tables. Aggregating them here keeps the visibility check to one query instead
# of one per page.
_NAV_GRANTS_SQL = """
    SELECT g.grant_id,
           g.page_code,
           g.grant_type,
           COALESCE(ARRAY_AGG(DISTINCT gr.role_code) FILTER (WHERE gr.role_code IS NOT NULL), '{}') AS role_codes,
           COALESCE(ARRAY_AGG(DISTINCT gu.unit_code) FILTER (WHERE gu.unit_code IS NOT NULL), '{}') AS unit_codes
      FROM nav_page_grants g
 LEFT JOIN nav_page_grant_roles gr ON gr.grant_id = g.grant_id
 LEFT JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
     WHERE g.is_active AND g.archived_at IS NULL
  GROUP BY g.grant_id, g.page_code, g.grant_type
"""


def roles_for(user_id: int) -> list[dict[str, Any]]:
    return [
        {
            "assignmentId": row["user_unit_role_id"],
            "roleCode": row["role_code"],
            "roleName": row["role_name"] or row["role_code"],
            "unitCode": row["unit_code"],
            "unitDescription": row["unit_description"],
        }
        for row in query(_ROLES_SQL, (user_id,))
    ]


def _satisfies_grant(roles: list[dict[str, Any]], grant: dict[str, Any]) -> bool:
    role_codes = set(grant["role_codes"] or ())
    unit_codes = set(grant["unit_codes"] or ())
    if grant["grant_type"] == "role":
        return any(r["roleCode"] in role_codes for r in roles)
    if grant["grant_type"] == "unit":
        return any(r["unitCode"] in unit_codes for r in roles)
    if grant["grant_type"] == "cafeteria":
        # Names the group, not its members: any listed role held in ANY cafeteria,
        # including outlets created after this grant was written. Cafeteria staff
        # all see the same pages, so enumerating outlets only went stale.
        return any(
            r["roleCode"] in role_codes and (r["unitCode"] or "").startswith(CAFETERIA_UNIT_PREFIX)
            for r in roles
        )
    # unit_role: cross-product WITHIN the row - any listed role held in any listed unit.
    return any(r["roleCode"] in role_codes and r["unitCode"] in unit_codes for r in roles)


def nav_tree_for(user_id: int, roles: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Ordered, permission-filtered sidebar tree.

    A page with zero grant rows is visible to nobody - fail closed. A folder the
    user cannot see hides all of its children, even ones they would otherwise
    pass.
    """
    roles = roles if roles is not None else roles_for(user_id)
    pages = query(_NAV_PAGES_SQL)

    grants_by_page: dict[str, list[dict[str, Any]]] = {}
    for grant in query(_NAV_GRANTS_SQL):
        grants_by_page.setdefault(grant["page_code"], []).append(grant)

    def visible(page: dict[str, Any]) -> bool:
        grants = grants_by_page.get(page["page_code"], [])
        return any(_satisfies_grant(roles, g) for g in grants)

    def build(parent_code: str | None) -> list[dict[str, Any]]:
        return [
            {
                "pageCode": page["page_code"],
                "label": page["label"],
                "entryType": page["entry_type"],
                "icon": page["icon"],
                "routePath": page["route_path"],
                "children": build(page["page_code"]) if page["entry_type"] == "folder" else [],
            }
            for page in pages
            if page["parent_page_code"] == parent_code and visible(page)
        ]

    return build(None)


def _role_label(entry: dict[str, Any]) -> str:
    return f"{entry['roleName']} — {entry['unitDescription']}" if entry["unitDescription"] else entry["roleName"]


def _department_for(user_id: int, roles: list[dict[str, Any]]) -> str:
    staff = query_one("SELECT department_or_school FROM staff WHERE user_id = %s", (user_id,))
    if staff and staff["department_or_school"]:
        return staff["department_or_school"]
    student = query_one("SELECT school FROM student WHERE user_id = %s", (user_id,))
    if student and student["school"]:
        return student["school"]
    unit_role = next((r for r in roles if r["unitDescription"]), None)
    return unit_role["unitDescription"] if unit_role else "APU Community"


def project_auth_user(user: dict[str, Any]) -> dict[str, Any]:
    """Build the AuthUser payload. `user` is a row from `users`; its password is ignored."""
    user_id = user["user_id"]
    roles = roles_for(user_id)
    role_codes = {r["roleCode"] for r in roles}

    cafeteria_code = next(
        (
            r["unitCode"]
            for r in roles
            if r["roleCode"] == "cafeteria-manager" and (r["unitCode"] or "").startswith(CAFETERIA_UNIT_PREFIX)
        ),
        None,
    )
    president_of = [
        str(row["club_id"]) for row in query("SELECT club_id FROM clubs WHERE user_id = %s", (user_id,))
    ]

    payload: dict[str, Any] = {
        "id": str(user_id),
        "email": user["email"],
        "displayName": user["full_name"],
        "username": user["username"],
        "accountType": "external" if "external-user" in role_codes else "internal",
        "roles": [
            {
                "roleCode": r["roleCode"],
                "roleName": r["roleName"],
                "unitCode": r["unitCode"],
                "unitDescription": r["unitDescription"],
            }
            for r in roles
        ],
        "roleLabel": _role_label(roles[0]) if roles else "Unassigned",
        "department": _department_for(user_id, roles),
        "nav": nav_tree_for(user_id, roles),
        "isClubAdmin": "club-admin" in role_codes,
        "presidentOfClubIds": president_of,
    }
    if cafeteria_code:
        payload["cafeteriaCode"] = cafeteria_code
    return payload
