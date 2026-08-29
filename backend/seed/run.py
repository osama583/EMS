"""Populate the database with system data.

    python -m seed.run              # seed an empty database
    python -m seed.run --reset      # wipe seedable tables first, then seed
    python -m seed.run --force      # seed even if data exists (may violate uniques)

System data only: the org chart, roles, sidebar and grants, dropdown
catalogues, config, clubs, and demo accounts. No proposals - those are created
through the API so they pass through the real state machine.

Everything runs in ONE transaction. A failure part-way leaves the database
exactly as it was rather than half-populated.
"""
from __future__ import annotations

import argparse
import json
import logging
import pathlib
import secrets
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config  # noqa: E402
from app.db import fetch_all, fetch_one, init_pool, transaction  # noqa: E402
from app.logging_setup import configure_logging  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402
from seed import data as D  # noqa: E402
from seed.nav import nav_catalogue  # noqa: E402

log = logging.getLogger("seed")

ICONS = json.loads((pathlib.Path(__file__).resolve().parent / "icons.json").read_text(encoding="utf-8"))

# Order matters: children before parents, so foreign keys never block a wipe.
SEEDABLE_TABLES = [
    "nav_page_grant_roles",
    "nav_page_grant_units",
    "nav_page_grants",
    "nav_page",
    "club_category_links",
    "club_members",
    "club_join_requests",
    "clubs",
    "club_categories",
    "venue_options",
    "funding_sub_options",
    "funding_main_options",
    "fmb_options",
    "serving_unit_options",
    "dietary_information_options",
    "campus_tour_type_options",
    "campus_tour_start_options",
    "sound_light_options",
    "media_options",
    "transportation_options",
    "logistics_options",
    "event_format",
    "event_category",
    "event_requirements",
    "config",
    "user_unit_roles",
    "role_unit",
    "student",
    "staff",
    "external_user_profile",
    "role",
    "users",
    "unit",
]


def _icon(name: str) -> str:
    """Look up the inline SVG for a nav icon name. Raises rather than falling back to
    "" - a silently empty icon renders as nothing in NavIconComponent, and a warning
    buried in seed output is easy to miss (this is how clubs-manage and manage-clubs
    shipped with invisible icons)."""
    icon = ICONS.get(name)
    if icon is None:
        raise SystemExit(
            f"seed: no icon named {name!r} in seed/icons.json. "
            "Add it there before referencing it from seed/nav.py."
        )
    return icon


def wipe(cur) -> None:
    """Truncate seedable tables. Refuses if any proposal exists - those are real
    work, and cascading through them would silently destroy it."""
    proposals = fetch_one(cur, "SELECT count(*) AS c FROM request")
    if proposals and proposals["c"]:
        raise SystemExit(
            f"Refusing to reset: {proposals['c']} proposal(s) exist. "
            "Delete them deliberately first, or use a fresh database."
        )
    cur.execute("TRUNCATE " + ", ".join(SEEDABLE_TABLES) + " RESTART IDENTITY CASCADE")
    log.info("seed.wiped", extra={"tables": len(SEEDABLE_TABLES)})


# --- Individual seed steps -----------------------------------------------
def seed_units(cur) -> None:
    for code, description in D.SCHOOL_UNITS + D.SERVICE_UNITS + D.CAFETERIA_UNITS:
        cur.execute(
            "INSERT INTO unit (code, description, is_active) VALUES (%s, %s, TRUE)",
            (code, description),
        )


def seed_roles(cur) -> None:
    for role_code, role_name, description in D.PROTECTED_ROLES:
        cur.execute(
            """INSERT INTO role (role_code, role_name, description, is_protected, is_active)
               VALUES (%s, %s, %s, TRUE, TRUE)""",
            (role_code, role_name, description),
        )


def seed_role_units(cur) -> None:
    """Which (role, unit) pairings are legal. A role with zero rows here is flat."""
    school_codes = [c for c, _ in D.SCHOOL_UNITS]
    service_codes = [c for c, _ in D.SERVICE_UNITS]
    cafeteria_codes = [c for c, _ in D.CAFETERIA_UNITS]
    pairs: list[tuple[str, str]] = []
    for code in school_codes:
        pairs += [("head-of-school", code), ("lecturer", code), ("student", code)]
    for code in service_codes:
        pairs.append(("head-of-department", code))
    for code in school_codes + service_codes:
        pairs.append(("staff", code))
    for code in cafeteria_codes:
        pairs += [("cafeteria-manager", code), ("cafeteria-staff", code)]
    for role_code, unit_code in pairs:
        cur.execute(
            "INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (role_code, unit_code),
        )


def seed_users(cur, password: str) -> list[tuple[str, str, str]]:
    """Insert demo accounts. Returns (email, display name, role summary) for the report."""
    password_hash = hash_password(password)
    unit_names = dict(D.SCHOOL_UNITS + D.SERVICE_UNITS + D.CAFETERIA_UNITS)
    summary: list[tuple[str, str, str]] = []

    for email, display_name, assignments in D.SEED_ACCOUNTS:
        cur.execute(
            """INSERT INTO users (full_name, email, password, is_active)
               VALUES (%s, %s, %s, TRUE) RETURNING user_id""",
            (display_name, email, password_hash),
        )
        user_id = cur.fetchone()["user_id"]

        student_school = staff_department = None
        for role_code, unit_code in assignments:
            cur.execute(
                "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, %s, %s)",
                (user_id, unit_code, role_code),
            )
            if role_code == "student":
                student_school = unit_names.get(unit_code)
            elif role_code in ("head-of-school", "head-of-department", "lecturer", "staff"):
                staff_department = unit_names.get(unit_code)

        # The staff/student extension tables are still consulted as the display
        # override for a user's department, ahead of their unit role.
        if student_school:
            cur.execute(
                "INSERT INTO student (user_id, school) VALUES (%s, %s)", (user_id, student_school)
            )
        elif staff_department:
            cur.execute(
                "INSERT INTO staff (user_id, department_or_school) VALUES (%s, %s)",
                (user_id, staff_department),
            )

        roles_text = ", ".join(
            f"{r}@{unit_names.get(u, u)}" if u else r for r, u in assignments
        ) or "(no role)"
        summary.append((email, display_name, roles_text))
    return summary


def seed_catalogues(cur) -> None:
    for name in D.EVENT_CATEGORIES:
        cur.execute(
            "INSERT INTO event_category (name, code, active) VALUES (%s, %s, TRUE)",
            (name, _slug(name)),
        )
    for name in D.EVENT_FORMATS:
        cur.execute(
            "INSERT INTO event_format (name, code, active) VALUES (%s, %s, TRUE)",
            (name, _slug(name)),
        )
    for name in D.EVENT_REQUIREMENTS:
        cur.execute("INSERT INTO event_requirements (requirement_name) VALUES (%s)", (name,))
    for code, number in D.CONFIG_VALUES:
        cur.execute("INSERT INTO config (code, number) VALUES (%s, %s)", (code, number))


def _slug(value: str) -> str:
    """lowercase_with_underscores - the same convention unit.code and role_code use."""
    out = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_")


def _requirement_ids(cur) -> dict[str, int]:
    return {
        r["requirement_name"]: r["requirement_id"]
        for r in fetch_all(cur, "SELECT requirement_id, requirement_name FROM event_requirements")
    }


def seed_options(cur) -> None:
    req = _requirement_ids(cur)

    def insert_simple(table, requirement, rows):
        """requirement=None for the two shared lookups (dietary information and
        serving units), which are not scoped to a requirement and have no such column."""
        for label, description, extra in rows:
            columns = ["label", "description", "active"]
            values: list = [label, description, True]
            if requirement is not None:
                columns.insert(0, "requirement_id")
                values.insert(0, req[requirement])
            for key, value in extra.items():
                columns.append(key)
                values.append(value)
            placeholders = ", ".join(["%s"] * len(values))
            cur.execute(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})", values
            )

    insert_simple("logistics_options", "logistics", D.LOGISTICS_OPTIONS)
    insert_simple("transportation_options", "transportation", D.TRANSPORTATION_OPTIONS)
    insert_simple("media_options", "photoVideo", D.MEDIA_OPTIONS)
    insert_simple("sound_light_options", "soundLight", D.SOUND_LIGHT_OPTIONS)
    insert_simple("dietary_information_options", None, D.DIETARY_OPTIONS)
    insert_simple("serving_unit_options", None, D.SERVING_UNIT_OPTIONS)
    insert_simple("campus_tour_start_options", "campusTour", D.CAMPUS_TOUR_START_OPTIONS)
    insert_simple("campus_tour_type_options", "campusTour", D.CAMPUS_TOUR_TYPE_OPTIONS)

    # Venues carry an explicit sort_order: the CFO's chosen order is what every
    # venue dropdown in the system reads, so a fresh seed has to start from a
    # definite one rather than whatever the insert order happened to be.
    for position, (label, description, extra) in enumerate(D.VENUE_OPTIONS):
        columns = ["label", "description", "active", "sort_order", *extra]
        values = [label, description, True, position, *extra.values()]
        cur.execute(
            f"INSERT INTO venue_options ({', '.join(columns)}) "
            f"VALUES ({', '.join(['%s'] * len(values))})",
            values,
        )

    main_ids: dict[str, int] = {}
    for label, description, finance_code in D.FUNDING_MAIN_OPTIONS:
        cur.execute(
            """INSERT INTO funding_main_options
                   (requirement_id, label, description, budget_category_finance_code, active)
               VALUES (%s, %s, %s, %s, TRUE) RETURNING funding_main_option_id""",
            (req["fundingPurchase"], label, description, finance_code),
        )
        main_ids[label] = cur.fetchone()["funding_main_option_id"]
    for main_label, subs in D.FUNDING_SUB_OPTIONS:
        for sub_label, sub_description in subs:
            cur.execute(
                """INSERT INTO funding_sub_options (main_option_id, label, description, active)
                   VALUES (%s, %s, %s, TRUE)""",
                (main_ids[main_label], sub_label, sub_description),
            )

    serving = {
        r["label"]: r["serving_unit_option_id"]
        for r in fetch_all(cur, "SELECT serving_unit_option_id, label FROM serving_unit_options")
    }
    dietary = {
        r["label"]: r["dietary_information_option_id"]
        for r in fetch_all(
            cur, "SELECT dietary_information_option_id, label FROM dietary_information_options"
        )
    }
    for unit_code, items in D.FMB_MENU.items():
        for label, description, serving_label, dietary_label, price in items:
            cur.execute(
                """INSERT INTO fmb_options
                       (requirement_id, unit_code, label, description,
                        serving_unit_option_id, dietary_information_option_id,
                        unit_price_rm, active)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)""",
                (
                    req["fmb"],
                    unit_code,
                    label,
                    description,
                    serving.get(serving_label),
                    dietary.get(dietary_label),
                    price,
                ),
            )


def seed_nav(cur) -> None:
    for entry in nav_catalogue():
        cur.execute(
            """INSERT INTO nav_page
                   (page_code, label, entry_type, icon, route_path, parent_page_code,
                    sort_order, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)""",
            (
                entry["page_code"],
                entry["label"],
                entry["entry_type"],
                _icon(entry["icon"]),
                entry["route_path"],
                entry["parent_page_code"],
                entry["sort_order"],
            ),
        )
        # nav_page_grants is UNIQUE (page_code, grant_type), so a page can hold at
        # most ONE row per type. Where the catalogue emits two grants of the same
        # type (e.g. Inbox: the unit roles, plus Cafeteria Manager) they merge
        # into a single row's role and unit sets.
        #
        # Merging turns two separate cross-products into one larger one, which in
        # principle widens access - the merged Inbox row nominally allows
        # "student in a cafeteria unit" and "cafeteria-manager in a school". In
        # practice neither is reachable: role_unit governs which (role, unit)
        # pairs may be assigned at all, and neither combination is linked there,
        # so no user can ever hold one.
        merged: dict[str, tuple[set[str], set[str]]] = {}
        for grant_type, role_codes, unit_codes in entry["grants"]:
            roles, units = merged.setdefault(grant_type, (set(), set()))
            roles.update(role_codes)
            units.update(unit_codes)

        for grant_type, (role_codes, unit_codes) in merged.items():
            cur.execute(
                """INSERT INTO nav_page_grants (page_code, grant_type, is_active)
                   VALUES (%s, %s, TRUE) RETURNING grant_id""",
                (entry["page_code"], grant_type),
            )
            grant_id = cur.fetchone()["grant_id"]
            for role_code in sorted(role_codes):
                cur.execute(
                    "INSERT INTO nav_page_grant_roles (grant_id, role_code) VALUES (%s, %s)",
                    (grant_id, role_code),
                )
            for unit_code in sorted(unit_codes):
                cur.execute(
                    "INSERT INTO nav_page_grant_units (grant_id, unit_code) VALUES (%s, %s)",
                    (grant_id, unit_code),
                )


def seed_clubs(cur) -> None:
    category_ids: dict[str, int] = {}
    for name in D.CLUB_CATEGORIES:
        cur.execute(
            "INSERT INTO club_categories (name, active) VALUES (%s, TRUE) RETURNING club_category_id",
            (name,),
        )
        category_ids[name] = cur.fetchone()["club_category_id"]

    admin = fetch_one(cur, "SELECT user_id FROM users WHERE email = %s", ("club.admin@demo.apu.edu.my",))
    for club_name, description, president_email, categories in D.CLUBS:
        president = fetch_one(cur, "SELECT user_id FROM users WHERE email = %s", (president_email,))
        if not president or not admin:
            continue
        cur.execute(
            """INSERT INTO clubs (user_id, club_name, description, created_by_user_id, active)
               VALUES (%s, %s, %s, %s, TRUE) RETURNING club_id""",
            (president["user_id"], club_name, description, admin["user_id"]),
        )
        club_id = cur.fetchone()["club_id"]
        for category in categories:
            cur.execute(
                "INSERT INTO club_category_links (club_id, club_category_id) VALUES (%s, %s)",
                (club_id, category_ids[category]),
            )
        # The President is a member of their own club.
        cur.execute(
            "INSERT INTO club_members (club_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (club_id, president["user_id"]),
        )


# --- Entry point ----------------------------------------------------------
def run(*, reset: bool, force: bool, password: str) -> None:
    with transaction() as cur:
        if reset:
            wipe(cur)
        else:
            existing = fetch_one(cur, "SELECT count(*) AS c FROM users")
            if existing and existing["c"] and not force:
                raise SystemExit(
                    f"Database already has {existing['c']} user(s). "
                    "Use --reset to wipe seedable tables first, or --force to insert anyway."
                )

        seed_units(cur)
        seed_roles(cur)
        seed_role_units(cur)
        accounts = seed_users(cur, password)
        seed_catalogues(cur)
        seed_options(cur)
        seed_nav(cur)
        seed_clubs(cur)

        counts = {
            table: fetch_one(cur, f"SELECT count(*) AS c FROM {table}")["c"]
            for table in ("unit", "role", "role_unit", "users", "user_unit_roles",
                          "nav_page", "nav_page_grants", "event_requirements",
                          "fmb_options", "clubs", "config")
        }

    _report(accounts, counts, password)


def _report(accounts, counts, password: str) -> None:
    print("\n" + "=" * 78)
    print("SEED COMPLETE")
    print("=" * 78)
    for table, count in counts.items():
        print(f"  {table:<20} {count:>5}")

    print("\n" + "-" * 78)
    print(f"DEMO ACCOUNT PASSWORD:  {password}")
    print("-" * 78)
    print("Every seeded account shares this password. It is printed once, here -")
    print("only the bcrypt hash is stored, so it cannot be recovered later.")
    print("Re-run with --reset --password <value> to set a different one.\n")
    print("To enable the login page's demo-user picker (testing only):")
    print(f"  Set DEMO_PASSWORD={password} and DEMO_MODE=true in backend/.env\n")

    width = max(len(email) for email, _, _ in accounts)
    for email, display_name, roles in accounts:
        print(f"  {email:<{width}}  {display_name:<22} {roles}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the EMS database with system data.")
    parser.add_argument("--reset", action="store_true", help="wipe seedable tables first")
    parser.add_argument("--force", action="store_true", help="seed even if data already exists")
    parser.add_argument(
        "--password",
        default=None,
        help="password for every demo account (default: a generated one, printed at the end)",
    )
    args = parser.parse_args()

    configure_logging(config.log_level, config.log_format)
    config.validate()
    init_pool()

    password = args.password or ("Demo-" + secrets.token_urlsafe(9))
    run(reset=args.reset, force=args.force, password=password)


if __name__ == "__main__":
    main()
