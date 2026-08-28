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
       AND uur.is_active
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

_ACTIVE_INTERNAL_USERS_SQL = """
    SELECT u.user_id, u.full_name AS "displayName", u.email,
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

_ALL_ACTIVE_ROLES_SQL = """
    SELECT uur.user_id, uur.role_code, r.role_name, uur.unit_code, u.description AS unit_description
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
 LEFT JOIN unit u ON u.code = uur.unit_code
     WHERE uur.is_active AND r.archived_at IS NULL
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


def has_page_access(assignments: tuple[tuple[str, str | None], ...], page_code: str) -> bool:
    """Would `page_code` be visible in the sidebar for a caller holding `assignments`?

    The same _satisfies_grant() predicate nav_tree_for() applies per page, exposed for callers that
    hold a Principal's (role_code, unit_code) tuple rather than the roles_for() dict shape - the AI
    assistant's authorization gate (ai/topic_access.py) being the reason it exists. Sharing the
    predicate is the entire point: the chat and the sidebar must never disagree about what a page
    grants, and a second implementation is how they would.

    MULTI-ROLE: true if ANY assignment satisfies ANY grant on the page - the union, never the
    intersection, matching nav_tree_for().

    FAILS CLOSED: a page with zero grant rows is visible to nobody, same as the sidebar.

    Deliberately checks only this page's OWN grants, not its parent folder's. nav_tree_for() hides
    a folder's children when the folder itself is not visible, which is a NAVIGATION concern (an
    unreachable link is confusing); for authorization, the page's own grant is the decision, and
    inheriting a folder's absence would refuse a topic an administrator explicitly granted."""
    grants = [g for g in query(_NAV_GRANTS_SQL) if g["page_code"] == page_code]
    if not grants:
        return False
    roles = [{"roleCode": role, "unitCode": unit} for role, unit in (assignments or ())]
    return any(_satisfies_grant(roles, grant) for grant in grants)


def role_has_page_grant(role_code: str, page_code: str) -> bool:
    """Is `role_code` named in ANY active grant on `page_code`, whatever the unit?

    The ROLE-level counterpart to has_page_access(), which answers the same question for one
    account. ai/knowledge_base.role_capability_document() needs this one because "what can a
    Cafeteria Manager do" has no asker to resolve a unit-scoped grant against - there is no single
    unit that question is about - so a capability counts as reachable when the role appears in a
    grant for that page at all. That makes it an overview of what the role is DESIGNED to reach,
    deliberately not a claim about any particular account's current, unit-scoped access.

    A 'unit' grant is excluded on purpose: it names units and no roles, so it grants the page by
    where someone works rather than by what they are, and no role is "designed" to reach it.

    FAILS CLOSED, exactly like has_page_access(): a page with no grant rows is reachable by nobody.
    """
    return any(
        grant["page_code"] == page_code
        and grant["grant_type"] != "unit"
        and role_code in set(grant["role_codes"] or ())
        for grant in query(_NAV_GRANTS_SQL)
    )


def users_with_page_access(page_code: str) -> list[dict[str, Any]]:
    """Active internal users who can see `page_code` in their sidebar, per its
    nav_page_grants rows - the same predicate nav_tree_for() uses per-user, run
    once across every active internal account instead.

    Used to scope candidate pickers (Co-owner/Organizer on the proposal form) to
    people who could plausibly BE an applicant/collaborator on a proposal, rather
    than every active internal account regardless of role - see
    /auth/internal-users' docstring for why that endpoint stayed unscoped (it also
    backs the department "Assign Work" picker, which filters by unit client-side
    instead and is intentionally untouched by this function).
    """
    grants = [g for g in query(_NAV_GRANTS_SQL) if g["page_code"] == page_code]
    if not grants:
        return []

    roles_by_user: dict[int, list[dict[str, Any]]] = {}
    for row in query(_ALL_ACTIVE_ROLES_SQL):
        roles_by_user.setdefault(row["user_id"], []).append({
            "roleCode": row["role_code"], "roleName": row["role_name"] or row["role_code"],
            "unitCode": row["unit_code"], "unitDescription": row["unit_description"],
        })

    users = query(_ACTIVE_INTERNAL_USERS_SQL)
    result = []
    for user in users:
        roles = roles_by_user.get(user["user_id"], [])
        if not any(_satisfies_grant(roles, g) for g in grants):
            continue
        result.append({
            "displayName": user["displayName"],
            "email": user["email"],
            "department": user["department"],
            "roles": roles,
            "roleLabel": _role_label(roles[0]) if roles else "Unassigned",
        })
    return result


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
