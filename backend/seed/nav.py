"""The sidebar catalogue and its permission grants.

nav_page rows describe WHAT exists in the sidebar; nav_page_grants rows describe
WHO sees each entry. A page with zero grants is visible to nobody (fail closed),
and a folder gates its own children - failing a folder's grant hides everything
inside it regardless of the children's own grants.

Grant types, OR'd together within a page:
    role       actor holds any of these roles (FLAT roles only)
    unit       actor holds any role in any of these units
    unit_role  actor holds any of these roles in any of these units

Why a mixed role list splits into two rows: a 'role' row can only carry flat
roles. A unit-scoped role there would mean "Lecturer anywhere", which is not a
thing the permission model expresses. So flat roles go in a 'role' row and
unit-scoped roles go in a 'unit_role' row naming every active unit - which
preserves the restriction exactly. Using a bare 'unit' row instead would admit
every OTHER unit-scoped role too, a real broadening of access.
"""
from __future__ import annotations

from .data import CAFETERIA_UNITS, SCHOOL_UNITS, SERVICE_UNITS

ALL_UNIT_ROLES = ["head-of-school", "head-of-department", "lecturer", "staff", "student"]
HEAD_ROLES = ["head-of-school", "head-of-department"]
ALL_INTERNAL_ROLES = ALL_UNIT_ROLES + ["cfo", "cafeteria-admin", "cafeteria-staff", "system-admin"]

# Roles that have role_unit rows, i.e. must always be paired with a unit.
UNIT_SCOPED_ROLES = frozenset(ALL_UNIT_ROLES) | {"cafeteria-manager", "cafeteria-staff"}

ALL_UNIT_CODES = [code for code, _ in SCHOOL_UNITS + SERVICE_UNITS + CAFETERIA_UNITS]
CAFETERIA_UNIT_CODES = [code for code, _ in CAFETERIA_UNITS]
SERVICE_UNIT_CODES = [code for code, _ in SERVICE_UNITS]


def grants_for(role_codes: list[str]) -> list[tuple[str, list[str], list[str]]]:
    """Split a role list into the grant rows that express it exactly.

    Returns (grant_type, role_codes, unit_codes) tuples.
    """
    flat = [r for r in role_codes if r not in UNIT_SCOPED_ROLES]
    scoped = [r for r in role_codes if r in UNIT_SCOPED_ROLES]
    rows: list[tuple[str, list[str], list[str]]] = []
    if flat:
        rows.append(("role", flat, []))
    if scoped:
        if set(scoped) == UNIT_SCOPED_ROLES:
            # Every unit-scoped role is listed, so "any role in any unit" is
            # equivalent and reads better in the Permissions table.
            rows.append(("unit", [], ALL_UNIT_CODES))
        else:
            rows.append(("unit_role", scoped, ALL_UNIT_CODES))
    return rows


def cafeteria_manager_grant() -> tuple[str, list[str], list[str]]:
    """Scoped to real cafeteria units only - never every unit, which would put a
    cafeteria page in front of an unrelated department head."""
    return ("unit_role", ["cafeteria-manager"], CAFETERIA_UNIT_CODES)


# Each entry: (page_code, label, entry_type, icon, route_path, parent, sort_order, [grant rows])
# Grant rows are either produced by grants_for() or written literally where the
# rule is narrower than "these roles, any unit".
def nav_catalogue() -> list[dict]:
    pages: list[dict] = []

    def page(code, label, icon, route, parent, order, grants, entry_type="page"):
        pages.append(
            {
                "page_code": code,
                "label": label,
                "entry_type": entry_type,
                "icon": icon,
                "route_path": route,
                "parent_page_code": parent,
                "sort_order": order,
                "grants": grants,
            }
        )

    def folder(code, label, icon, order, grants):
        page(code, label, icon, None, None, order, grants, entry_type="folder")

    # --- Top level --------------------------------------------------------
    page("how-it-works", "How It Works", "help_center", "/app/how-it-works", None, 0,
         grants_for(["lecturer", "student"]))
    # Ten roles hold a dashboard (docs/dashboards/01 § 1): both head roles across
    # every unit, the CFO, and every Cafeteria Manager. The cafeteria grant is a
    # `cafeteria` row rather than a unit_role row enumerating outlets - enumerating
    # outlets is exactly what went stale in commit 7ee8930 and left a new outlet's
    # staff with an empty sidebar.
    page("dashboard", "Dashboard", "space_dashboard", "/app/dashboard", None, 1,
         grants_for([*HEAD_ROLES, "cfo"]) + [cafeteria_manager_grant()])
    # Cafeteria Manager gets Inbox/Ongoing/History for the per-order food
    # approval flow, but never Drafts or Forms - they review orders, they do not
    # submit proposals.
    page("inbox", "Inbox", "inbox", "/app/inbox", None, 2,
         grants_for([*ALL_UNIT_ROLES, "cfo"]) + [cafeteria_manager_grant()])
    page("reports", "Reports", "analytics", "/app/reports", None, 3,
         grants_for(["cafeteria-admin"]))

    # --- My Requests ------------------------------------------------------
    folder("my-requests", "My Requests", "assignment", 4,
           grants_for([*ALL_UNIT_ROLES, "cfo"]) + [cafeteria_manager_grant()])
    page("ongoing", "Ongoing", "schedule", "/app/ongoing", "my-requests", 0,
         grants_for([*ALL_UNIT_ROLES, "cfo"]) + [cafeteria_manager_grant()])
    page("history", "History", "history", "/app/history", "my-requests", 1,
         grants_for([*ALL_UNIT_ROLES, "cfo"]) + [cafeteria_manager_grant()])
    page("drafts", "Drafts", "draft", "/app/proposals/drafts", "my-requests", 2,
         grants_for(ALL_UNIT_ROLES))

    # --- Events -----------------------------------------------------------
    folder("events", "Events", "event", 5, grants_for(ALL_INTERNAL_ROLES))
    page("explore-events", "Explore Events", "explore", "/app/events/explore-events", "events", 0,
         grants_for(ALL_INTERNAL_ROLES))
    page("my-events", "My Events", "favorite", "/app/events/my-events", "events", 1,
         grants_for(ALL_UNIT_ROLES))
    # The university-wide master calendar. Route is top-level (/app/event-calendar) even though
    # the nav entry sits under Events - route_path and the nav tree are independent.
    # Granted to every internal role plus Cafeteria Managers: the calendar is a planning surface,
    # and per-event visibility is enforced server-side (events.py's master_calendar), so a broad
    # page grant never means broad access to event DETAIL.
    page("event-calendar", "Event Calendar", "calendar_month", "/app/event-calendar", "events", 3,
         grants_for(ALL_INTERNAL_ROLES) + [cafeteria_manager_grant()])

    # --- Forms ------------------------------------------------------------
    folder("forms", "Forms", "note_add", 6, grants_for(ALL_UNIT_ROLES))
    page("proposal-form", "Proposal", "note_add", "/app/forms/event-proposal", "forms", 0,
         grants_for(ALL_UNIT_ROLES))

    # --- Cafeteria Manager's own pages -----------------------------------
    # F&B does NOT get My Menu: it reviews food requests but runs no cafeteria
    # and owns no menu. My Menu belongs to whoever runs a specific cafeteria.
    page("menu", "My Menu", "restaurant_menu", "/app/menu", None, 9, [cafeteria_manager_grant()])
    folder("my-cafeteria-folder", "My Cafeteria", "storefront", 10, [cafeteria_manager_grant()])
    page("cafeteria-my-staff", "My Staff", "assignment_ind", "/app/cafeterias/my-staff",
         "my-cafeteria-folder", 0, [cafeteria_manager_grant()])

    # --- Dropdown Settings ------------------------------------------------
    # Each kind is granted only to the department that actually owns it. A
    # uniform grant would show a Logistics head a link to the Sound & Light
    # dropdown that the API would then refuse on click.
    folder("dropdown-settings", "Dropdown Settings", "tune", 16, [
        ("unit_role", ["head-of-department"], SERVICE_UNIT_CODES),
        ("role", ["cfo"], []),
    ])
    dropdown_kinds = [
        ("logistics", "Logistics Items", "inventory_2", "logistics_and_facilities"),
        ("transportation", "Transportation Types", "directions_bus", "transport_services"),
        ("photoVideo", "Photography Services", "photo_camera", "photography_services"),
        ("soundLight", "Sound & Light", "settings_input_component", "a_v_services"),
        ("dietaryInformation", "Dietary Information", "nutrition", "food_beverage_services"),
        ("servingUnit", "Serving Units", "straighten", "food_beverage_services"),
        ("campusTourStart", "Campus Tour Starting Points", "location_on", "student_services"),
        ("campusTourType", "Campus Tour Types", "tour", "student_services"),
        ("waterNormal", "Mineral Water", "water_drop", "food_beverage_services"),
        # Funding is the CFO's flat-role workflow - no owning unit.
        ("fundingMain", "Funding Main Items", "account_balance_wallet", None),
        ("fundingSub", "Funding Sub-items", "account_tree", None),
        # University venues, also the CFO's. Registered here rather than as a
        # page of its own precisely so it is not a special case: it gets the
        # same route, the same management page, the same Page Visibility row and
        # the same role-grant plumbing as the twelve catalogues above it.
        ("venue", "Venue Management", "location_city", None),
    ]
    for index, (kind, label, icon, unit_code) in enumerate(dropdown_kinds):
        grant = (
            [("unit_role", ["head-of-department"], [unit_code])] if unit_code else [("role", ["cfo"], [])]
        )
        page(f"dropdown-{kind}", label, icon, f"/app/dropdown-options/{kind}",
             "dropdown-settings", index, grant)

    # --- Cafeterias (Cafeteria Admin) ------------------------------------
    # F&B is added to the FOLDER so Menu Oversight is reachable; the two
    # cafeteria-admin-only children keep their own narrower grants.
    folder("cafeteria-admin-folder", "Cafeterias", "storefront", 17, [
        ("role", ["cafeteria-admin"], []),
        ("unit_role", ["head-of-department"], ["food_beverage_services"]),
    ])
    page("cafeteria-manage", "Manage Cafeterias", "storefront", "/app/cafeterias/manage",
         "cafeteria-admin-folder", 0, grants_for(["cafeteria-admin"]))
    page("cafeteria-staff-assignments", "Staff Assignments", "assignment_ind",
         "/app/cafeterias/staff-assignments", "cafeteria-admin-folder", 1,
         grants_for(["cafeteria-admin"]))
    page("cafeteria-menu-oversight", "Menu Oversight", "restaurant_menu",
         "/app/cafeterias/menu-oversight", "cafeteria-admin-folder", 2, [
             ("role", ["cafeteria-admin"], []),
             ("unit_role", ["head-of-department"], ["food_beverage_services"]),
         ])
    # Audit log of every staff create/edit/suspend/restore/remove - Admin sees every cafeteria,
    # Manager sees only their own outlet's timeline (server-side scoped, not a client filter).
    page("cafeteria-staff-requests-history", "Staff Action History", "history",
         "/app/cafeterias/staff-requests-history", "cafeteria-admin-folder", 3,
         grants_for(["cafeteria-admin"]) + [cafeteria_manager_grant()])

    # --- Internal Directory (System Admin) -------------------------------
    folder("admin-directory", "Internal Directory", "folder_shared", 18,
           grants_for(["system-admin"]))
    page("admin-users", "Users", "group", "/app/users", "admin-directory", 0,
         grants_for(["system-admin"]))
    page("admin-units", "Units", "domain", "/app/units", "admin-directory", 1,
         grants_for(["system-admin"]))
    page("admin-roles", "Roles", "badge", "/app/roles", "admin-directory", 2,
         grants_for(["system-admin"]))
    page("admin-page-visibility", "Page Visibility", "visibility", "/app/admin/page-visibility",
         "admin-directory", 3, grants_for(["system-admin"]))

    # --- Clubs ------------------------------------------------------------
    folder("manage-clubs", "Clubs", "groups", 19,
           grants_for(["club-admin", "student", "lecturer"]))
    page("clubs-manage", "Manage Clubs", "admin_panel_settings", "/app/clubs/manage",
         "manage-clubs", 0, grants_for(["club-admin"]))
    # Granted the hub's BASE path, not /app/clubs/my-clubs: the hub's three tabs
    # are one page, so granting a single tab's path would refuse the others.
    page("clubs-my", "My Clubs", "groups", "/app/clubs", "manage-clubs", 1,
         grants_for(["club-admin", "student", "lecturer"]))
    page("clubs-discover", "Discover Clubs", "explore", "/app/clubs/discover", "manage-clubs", 2,
         grants_for(["club-admin", "student", "lecturer"]))
    page("club-category", "Club Category", "category", "/app/club-category",
         "manage-clubs", 3, grants_for(["club-admin"]))

    # --- System Configuration --------------------------------------------
    folder("system-config", "System Configuration", "settings", 20, grants_for(["system-admin"]))
    page("admin-settings-policies", "Approval Workflows & Policies", "rule",
         "/app/admin/settings/policies", "system-config", 0, grants_for(["system-admin"]))
    page("admin-settings-categories", "Event Categories", "category",
         "/app/admin/settings/categories", "system-config", 1, grants_for(["system-admin"]))
    page("admin-settings-formats", "Event Formats", "grid_view",
         "/app/admin/settings/formats", "system-config", 2, grants_for(["system-admin"]))
    return pages
