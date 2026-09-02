"""The data dictionary handed to the SQL-generating model, built by INSPECTING the live
PostgreSQL database rather than by hand.

WHY INSPECTED, NOT HARDCODED: a hand-written schema block is a second copy of the database that
drifts the moment a migration lands, and the failure mode is the worst kind - the model writes SQL
against a column that no longer exists, the query errors, and the answer becomes "something went
wrong" for a question the database could have answered. Reading pg_catalog/information_schema makes
the description true by construction.

WHY ONLY SOME TABLES: this database has ~60 tables (cafeteria orders, workflow tasks, funding,
logistics options, password reset tokens...). The assistant answers about EVENTS and CLUBS only,
and about those only as far as the EVENT CARD and the CLUB CARD display them, so only those tables
are described. Handing the model the whole database would (a) waste most of the prompt on tables it
must never touch, and (b) invite it to reach for `users.password` or `password_reset_tokens` when a
question gets vague. The allow-list below is also what sql_guard.py validates against, so a table
absent from here is not merely undescribed - it is unqueryable.

THE CARD IS THE BOUNDARY, and it is why several tables that ARE about events and clubs are absent:
saved_event, club_join_requests and club_president_change_requests hold nobody's card data - they
hold somebody's private activity, which this assistant does not cover for anyone. They are not
omitted for tidiness; they are omitted because there is no question in scope that needs them, and a
table nobody can query is a table nobody can be talked into querying.

COLUMN-LEVEL EXCLUSION: `users` is in scope (every event and club row joins to it for a name), but
users.password is not. EXCLUDED_COLUMNS strips such columns from the description AND from the
guard's allow-list, so no generated SQL can select or filter on them.

CACHING: introspection is ~4 queries and the result is stable between migrations, so it is built
once per process and reused (see cached_schema_document()). Invalidated by:
  1. a migration/version change - schema_fingerprint() hashes the introspected structure itself,
     so ANY DDL change produces a different fingerprint (no migration-table bookkeeping needed);
  2. sql_runner.py calling invalidate() after a schema-shaped SQL error (undefined table/column);
  3. an administrator POSTing /admin/ai-schema/refresh;
  4. process restart (the cache is in-memory only - deliberately: a stale on-disk cache
     surviving a deploy is a worse failure than a few hundred ms of introspection at boot).
"""
from __future__ import annotations

import hashlib
import logging
import threading

from ..db import query

log = logging.getLogger(__name__)

# Every table the assistant may read, and nothing else. sql_guard.py enforces this exact set.
TABLE_GROUPS: dict[str, tuple[str, ...]] = {
    "events": (
        "request",
        "event_schedule",
        "request_categories",
        # The audience of a 'Club Only' event (migration 029). Listed here because the events
        # visibility condition scope_rules.py mandates joins through it, so it is part of the
        # events domain whether or not a question ever names it - and a table absent from
        # ALLOWED_TABLES is never introspected, which would leave rule 5 unable to check a single
        # one of its columns. club_members, the other half of that condition, is deliberately NOT
        # here: it belongs to the clubs group, and describing it under an events question would
        # invite membership queries the events topic has no business answering. It reaches the
        # guard's allow-list through sql_guard._predicate_tables instead, restricted to the
        # asker's own row.
        "request_clubs",
        # For the registration COUNT the card prints, and for nothing else - scope_rules.py gives
        # this table the count-only marker as its ONLY permitted condition, for every caller.
        "event_registration",
        "users",
    ),
    "clubs": (
        "clubs",
        # Same as event_registration: the member count on the club card, never who the members are.
        "club_members",
        "club_categories",
        "club_category_links",
        "users",
    ),
    # Always available, because every answer names people: the event's organiser and the club's
    # president are both printed on the card, and both resolve through here.
    "identity": (
        "users",
    ),
}

ALLOWED_TABLES: frozenset[str] = frozenset(t for group in TABLE_GROUPS.values() for t in group)

# Columns that exist on an allowed table but must never reach the model or a generated query.
#
# `request` carries far more than its card and details dialog show, and the assistant's scope is
# the card, not the row. goals_objectives, expected_benefits and promotion_publicity_method are
# internal proposal fields that no viewer of Explore Events ever sees; max_pax is only rendered on
# the organiser's own page; the bank details are shown inside the payment panel but have no place
# in a chat reply. Excluding them here removes them from the description AND from the guard's
# allow-list, so "only what the page shows" is enforced rather than merely requested.
EXCLUDED_COLUMNS: dict[str, frozenset[str]] = {
    "users": frozenset({"password", "email"}),
    "request": frozenset({
        "goals_objectives", "expected_benefits", "promotion_publicity_method", "max_pax",
        "bank_account_name", "bank_account_number",
    }),
}

# Hand-written meaning for columns whose NAME does not explain them. Introspection gives types and
# keys; it cannot say that `request` holds proposals AND published events distinguished only by
# `status`, which is precisely the fact a wrong query gets wrong. Keyed "table.column".
COLUMN_NOTES: dict[str, str] = {
    "request.status": (
        "Proposal workflow state. 'implementation' (every department approved and assigned, "
        "staff carrying the work out) and 'completed_approved' both mean the event is PUBLISHED "
        "and visible as a real event. Every other value ('draft', 'submitted', 'hos_hod_review', "
        "'fmb_review', 'cfo_review', 'department_review', 'resubmission_required', "
        "'completed_rejected', 'cancelled') is an in-flight or dead PROPOSAL and must never be "
        "presented as an event."
    ),
    "request.event_visibility": (
        "'Public' | 'Club Only' | 'Internal' | 'Private'. Controls who may see the event - see the "
        "VISIBILITY RULES in the instructions; never widen it."
    ),
    "request.applicant_user_id": "The event's OWNER/organiser (users.user_id).",
    "request.applicant_name": "The organiser's name as printed on the event's details dialog.",
    "request.applicant_department_or_school": (
        "The school or department behind the event, as printed on the details dialog. This is what "
        "'organised by the School of Computing' / 'from Student Services' means - match it with "
        "ILIKE on one distinctive word."
    ),
    "request.event_format_snapshot": (
        "THE EVENT'S FORMAT as printed on the details dialog - this is what 'on campus', 'outside "
        "campus', 'physical', 'virtual' and 'hybrid' refer to. Match it with ILIKE, never with '='."
    ),
    "request.event_image": "The event's picture. A URL for display only - never describe it.",
    # `request` has NO column called `description`, and both the topical-search rule and the
    # recommendation rule in sql_llm.py used to ask for one by that name. A non-existent column is
    # a rejected query and a wasted attempt out of three; worse, on a recommendation it left the
    # answering step with nothing but a title to reason from, and a title is not a reason.
    "request.short_introduction": (
        "THE EVENT'S DESCRIPTION - its public blurb, and the only prose that says what actually "
        "happens at it. This table has no column named `description`; this is that column. Select "
        "it whenever the answer needs to say what an event IS (a recommendation always does), and "
        "search it for a TOPICAL question ('events about AI') alongside request.event_title."
    ),
    "request.total_pax": (
        "EXPECTED ATTENDANCE, as printed on the details dialog - the number the organiser declared, "
        "NOT how many have actually registered (that is a COUNT over event_registration). "
        "'Expected attendance above 200', 'the highest expected attendance' and 'a small event' all "
        "mean this column; 'how many registered' means the count."
    ),
    "request_clubs.club_id": (
        "The club a 'Club Only' event is addressed to (its audience). Only meaningful for "
        "event_visibility = 'Club Only', and only reachable as part of the required visibility "
        "condition - never as a free-standing lookup."
    ),
    "request_clubs.club_name": "Frozen club name at submission time, for display. Not re-resolved from clubs.",
    "request.registration_approval": (
        "'Automatic' or 'Manual', as printed on the details dialog. Automatic means anyone can join "
        "straight away; Manual means the organiser approves each registration individually."
    ),
    "request.cost_amount": "The fee, as printed on the details dialog. NULL or 0 means a FREE event.",
    "request.request_code": "Human-facing reference code, e.g. 'REQ-0001'.",
    "event_registration.status": (
        "'registered' (confirmed) | 'pending_approval' | 'rejected' | 'cancelled'. The 'N "
        "registered' printed on every event card counts the 'registered' rows only."
    ),
    "event_schedule.date": "One row per day an event runs; a multi-day event has several rows.",
    "event_schedule.location": "THE VENUE, as printed on the card and the details dialog.",
    "clubs.club_name": "The club's name, as printed on its card.",
    "clubs.description": (
        "THE CLUB'S DESCRIPTION - its card blurb, and the only prose saying what the club actually "
        "does. Select it whenever the answer needs to say what a club IS (a suggestion always "
        "does), and search it for a topical question ('clubs about photography') alongside "
        "clubs.club_name."
    ),
    "clubs.user_id": (
        "The club's current PRESIDENT (users.user_id), printed on the club's card and therefore "
        "answerable."
    ),
    "clubs.created_by_user_id": "The Club Admin who created the club, NOT the president.",
    "clubs.active": "FALSE means the club is deactivated and does not appear on Discover Clubs at all.",
    "club_members.user_id": (
        "One member of a club. Two uses and no others: the member COUNT printed on every club "
        "card, and an EXISTS test for whether THE ASKER THEMSELVES is in a club - which is the "
        "flag Discover Clubs computes per card and hides the viewer's own clubs by. Listing WHO "
        "the members are is not something this assistant answers. See the SCOPE RULES."
    ),
    "event_registration.user_id": (
        "The REGISTRANT. Readable only as an EXISTS test for whether THE ASKER THEMSELVES is "
        "registered - the 'Registered' / 'Pending Approval' badge their own event card shows them. "
        "Never a list, and never anybody else's row."
    ),
    "users.full_name": "Display name. Match people by this, never by guessing an id.",
}

# Relationships worth stating explicitly because they are NOT expressible as a foreign key, or
# because the FK alone does not say which direction the join must run for a correct answer.
JOIN_NOTES: tuple[str, ...] = (
    "request.request_id = event_schedule.request_id  -- an event's dates/times/venues (1 row per day)",
    "request.request_id = event_registration.request_id  -- COUNT ONLY: how many have registered",
    "request.request_id = request_categories.request_id  -- an event's category labels (use request_categories.category_name, the frozen snapshot, NOT a join to event_category)",
    "request.request_id = request_clubs.request_id  -- which club(s) a 'Club Only' event is for; part of the required visibility condition, not a join to write yourself",
    "request.applicant_user_id = users.user_id  -- the event's organiser",
    "clubs.user_id = users.user_id  -- the club president",
    "clubs.club_id = club_members.club_id  -- COUNT ONLY: how many members a club has",
    "clubs.club_id = club_category_links.club_id AND club_category_links.club_category_id = club_categories.club_category_id  -- a club's categories (many-to-many, 1-3 per club)",
)

# Business rules the model cannot infer from structure and gets wrong without. These are
# DESCRIPTIVE (helping it write a correct query); the SCOPE predicates in scope_rules.py are what
# actually enforce authorization, and sql_guard.py verifies they are present.
BUSINESS_RULES: tuple[str, ...] = (
    "`request` is BOTH the proposal table and the published-event table. An event exists only "
    "where request.status = 'completed_approved'. EVERY query about events must include that "
    "condition - a proposal in review is not an event.",
    "Soft deletes: users, clubs, role, unit and nav_page rows carry archived_at. Always exclude "
    "archived rows (archived_at IS NULL) and, for users/clubs/role/unit, inactive ones "
    "(is_active / active = TRUE) unless the question is explicitly about deactivated records.",
    "The 'N registered' printed on an event card counts event_registration rows with "
    "status = 'registered'. Never count 'cancelled' or 'rejected' rows into it.",
    "event_registration and club_members exist here for their COUNTS and nothing else. A query "
    "that returns a name, an email, or one row per person from either is rejected - who registered "
    "and who is a member are not questions this assistant answers for anyone.",
    "Club presidency (clubs.user_id -> users.full_name) is printed on the club's own card, so it "
    "is answerable like any other card field.",
    "A club's categories come through club_category_links; a club has between 1 and 3.",
    "Dates: use CURRENT_DATE for 'upcoming'/'past'. An event is upcoming when it has an "
    "event_schedule row with date >= CURRENT_DATE.",
)


def _introspect() -> dict[str, list[dict]]:
    """Columns, types, nullability and defaults for every allowed table, straight from
    information_schema. Excluded columns are dropped here so nothing downstream can reintroduce
    them."""
    rows = query(
        """
        SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.character_maximum_length
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = ANY(%s)
      ORDER BY c.table_name, c.ordinal_position
        """,
        [sorted(ALLOWED_TABLES)],
    )
    by_table: dict[str, list[dict]] = {}
    for row in rows:
        if row["column_name"] in EXCLUDED_COLUMNS.get(row["table_name"], frozenset()):
            continue
        by_table.setdefault(row["table_name"], []).append(row)
    return by_table


def _primary_keys() -> dict[str, list[str]]:
    rows = query(
        """
        SELECT tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_name = ANY(%s)
      ORDER BY tc.table_name, kcu.ordinal_position
        """,
        [sorted(ALLOWED_TABLES)],
    )
    keys: dict[str, list[str]] = {}
    for row in rows:
        keys.setdefault(row["table_name"], []).append(row["column_name"])
    return keys


def _foreign_keys() -> dict[str, list[str]]:
    """"column -> other_table.other_column" per table, for the FKs whose BOTH ends are in scope.
    An FK pointing at an out-of-scope table is deliberately omitted: mentioning it would invite a
    join the guard then rejects."""
    rows = query(
        """
        SELECT tc.table_name, kcu.column_name,
               ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_name = ANY(%s)
      ORDER BY tc.table_name, kcu.column_name
        """,
        [sorted(ALLOWED_TABLES)],
    )
    fks: dict[str, list[str]] = {}
    for row in rows:
        if row["foreign_table"] not in ALLOWED_TABLES:
            continue
        fks.setdefault(row["table_name"], []).append(
            f"{row['column_name']} -> {row['foreign_table']}.{row['foreign_column']}"
        )
    return fks


def _check_constraints() -> dict[str, list[str]]:
    """CHECK clauses, which is where this schema keeps its enums (status/visibility value sets).
    Those value lists are exactly what a model otherwise invents ('approved' instead of
    'completed_approved'), so they are worth the extra query."""
    rows = query(
        """
        SELECT tc.table_name, cc.check_clause
          FROM information_schema.table_constraints tc
          JOIN information_schema.check_constraints cc
            ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
         WHERE tc.table_schema = 'public' AND tc.constraint_type = 'CHECK'
           AND tc.table_name = ANY(%s)
           AND cc.check_clause NOT LIKE '%%IS NOT NULL'
      ORDER BY tc.table_name
        """,
        [sorted(ALLOWED_TABLES)],
    )
    checks: dict[str, list[str]] = {}
    for row in rows:
        checks.setdefault(row["table_name"], []).append(" ".join(row["check_clause"].split()))
    return checks


def allowed_columns() -> dict[str, frozenset[str]]:
    """table -> the columns any generated SQL may reference. sql_guard.py's allow-list; built from
    the same introspection the model is shown, so the two can never disagree."""
    return {table: frozenset(c["column_name"] for c in cols) for table, cols in _catalog()["columns"].items()}


_cache: dict | None = None
_cache_lock = threading.Lock()


def _catalog() -> dict:
    """Introspected structure, cached per process. Thread-safe because Flask serves requests on
    several threads and two of them racing here would otherwise run introspection twice."""
    global _cache
    if _cache is None:
        with _cache_lock:
            if _cache is None:
                columns = _introspect()
                _cache = {
                    "columns": columns,
                    "primary_keys": _primary_keys(),
                    "foreign_keys": _foreign_keys(),
                    "checks": _check_constraints(),
                }
                _cache["fingerprint"] = _fingerprint(_cache)
                log.info(
                    "ai.schema_catalog.built",
                    extra={"tables": len(columns), "fingerprint": _cache["fingerprint"]},
                )
    return _cache


def _fingerprint(catalog: dict) -> str:
    """A hash of the introspected structure itself - the migration-detection mechanism. Any DDL
    that adds/removes/retypes a column in scope changes this, with no migration table to consult
    and nothing to remember to bump by hand."""
    parts = []
    for table in sorted(catalog["columns"]):
        for col in catalog["columns"][table]:
            parts.append(f"{table}.{col['column_name']}:{col['data_type']}:{col['is_nullable']}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def schema_fingerprint() -> str:
    return _catalog()["fingerprint"]


def invalidate() -> None:
    """Drop the cache so the next request re-introspects. Called after a schema-shaped SQL error
    (sql_runner.py) and by the admin refresh endpoint."""
    global _cache
    with _cache_lock:
        _cache = None
    log.info("ai.schema_catalog.invalidated")


def refresh() -> str:
    """Force a rebuild and return the new fingerprint - the admin refresh endpoint's operation."""
    invalidate()
    return schema_fingerprint()


def tables_for_topics(topics: set[str]) -> tuple[str, ...]:
    """The tables a classified question actually needs. Narrower than ALLOWED_TABLES on purpose:
    the guard rejects any table outside this set for THIS question, so a club question cannot
    read event registrations even though both are individually in scope."""
    tables: set[str] = set()
    for topic, group in _TOPIC_GROUPS.items():
        if topic in topics:
            tables |= set(TABLE_GROUPS[group])
    # identity is always available: every answer names people, and users/student are how a scope
    # predicate expresses "the asker".
    tables |= set(TABLE_GROUPS["identity"])
    return tuple(sorted(tables & ALLOWED_TABLES))


# scope.TOPICS key -> which TABLE_GROUPS it needs. Kept beside the groups rather than in
# topic_access.py because this is a DATA question ("which tables"), not an authorization one
# ("which pages") - the two are deliberately separate concerns even though both are keyed by topic.
#
# One entry each, and that is the whole map: there are exactly two topics, and a third would mean
# the assistant's scope had changed (see scope.py's docstring), not that a line was missing here.
_TOPIC_GROUPS: dict[str, str] = {
    "events": "events",
    "clubs": "clubs",
}


def document_for_topics(topics: set[str]) -> str:
    """The DATABASE section of the SQL-generation prompt: only the tables this question's topics
    need, each with its real columns, keys, constraints and hand-written meaning."""
    catalog = _catalog()
    tables = tables_for_topics(topics)
    lines = ["DATABASE SCHEMA (PostgreSQL). These are the ONLY tables and columns you may use:"]
    for table in tables:
        cols = catalog["columns"].get(table)
        if not cols:
            continue
        pk = ", ".join(catalog["primary_keys"].get(table, ())) or "none"
        lines.append(f"\nTABLE {table}  (primary key: {pk})")
        for col in cols:
            size = f"({col['character_maximum_length']})" if col["character_maximum_length"] else ""
            null = "" if col["is_nullable"] == "NO" else " NULL"
            note = COLUMN_NOTES.get(f"{table}.{col['column_name']}")
            lines.append(
                f"  - {col['column_name']}: {col['data_type']}{size}{null}"
                + (f"  -- {note}" if note else "")
            )
        for fk in catalog["foreign_keys"].get(table, ()):
            lines.append(f"  FK: {fk}")
        for check in catalog["checks"].get(table, ()):
            lines.append(f"  CHECK: {check}")

    lines.append("\nHOW THESE TABLES JOIN:")
    lines += [
        f"  {note}" for note in JOIN_NOTES
        if note.split(".")[0].strip() in tables or any(f" {t}." in note for t in tables)
    ]

    lines.append("\nBUSINESS RULES you must apply:")
    lines += [f"  - {rule}" for rule in BUSINESS_RULES]
    return "\n".join(lines)
