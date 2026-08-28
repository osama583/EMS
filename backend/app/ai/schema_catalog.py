"""The data dictionary handed to the SQL-generating model, built by INSPECTING the live
PostgreSQL database rather than by hand.

WHY INSPECTED, NOT HARDCODED: a hand-written schema block is a second copy of the database that
drifts the moment a migration lands, and the failure mode is the worst kind - the model writes SQL
against a column that no longer exists, the query errors, and the answer becomes "something went
wrong" for a question the database could have answered. Reading pg_catalog/information_schema makes
the description true by construction.

WHY ONLY SOME TABLES: this database has ~60 tables (cafeteria orders, workflow tasks, funding,
logistics options, password reset tokens...). The assistant answers about EVENTS and CLUBS only
(see api/ai.py's four question types), so only those tables are described. Handing the model the
whole database would (a) waste most of the prompt on tables it must never touch, and (b) invite it
to reach for `users.password` or `password_reset_tokens` when a question gets vague. The allow-list
below is also what sql_guard.py validates against, so a table absent from here is not merely
undescribed - it is unqueryable.

COLUMN-LEVEL EXCLUSION: `users` is in scope (every event/club row joins to it for a name), but
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
# Grouped by the topic that needs them, because the SQL prompt only ever ships the groups the
# classified topic actually requires (see document_for_topics) - a club question is not given the
# event tables to get confused by.
TABLE_GROUPS: dict[str, tuple[str, ...]] = {
    "events": (
        "request",
        "event_schedule",
        "request_categories",
        "event_registration",
        "saved_event",
        "co_owners",
        "users",
    ),
    "clubs": (
        "clubs",
        "club_members",
        "club_join_requests",
        "club_categories",
        "club_category_links",
        "club_president_change_requests",
        "users",
    ),
    # Always available, because every answer names people and every scope predicate expresses "the
    # asker" through one of these. Deliberately the MINIMUM that achieves that: `users` to resolve
    # a name, `student` because club membership is students-only (a rule a query must be able to
    # express), and `staff` because co-ownership of an event is matched through staff_id.
    #
    # role/unit/user_unit_roles are NOT here. Describing them would let a question drift into "who
    # holds which role", which is the admin directory - explicitly outside this assistant's scope
    # (see api/ai.py's scope statement), and something Page Visibility gates as a page rather than
    # as rows. A caller's own roles are already in the prompt as authenticated context; they never
    # need to be queried for.
    "identity": (
        "users",
        "student",
        "staff",
    ),
}

ALLOWED_TABLES: frozenset[str] = frozenset(t for group in TABLE_GROUPS.values() for t in group)

# Columns that exist on an allowed table but must never reach the model or a generated query.
#
# users.password is the obvious one - a credential, and an assistant that can read it is an
# account-takeover tool.
#
# users.email is here for a less obvious but equally real reason: no answer this assistant gives
# needs it. Every question it supports is answered with a person's NAME ("Aina Rahman organises
# that event", "you're a member of three clubs"), and the asker's own email is already in the
# prompt as authenticated context. Leaving the column queryable bought nothing and made the whole
# staff-and-student directory one careless join away - "list the organisers of every public event"
# is a legitimate-looking question that would have returned a contact list. Excluding the column
# outright is a stronger guarantee than any instruction telling the model not to select it.
EXCLUDED_COLUMNS: dict[str, frozenset[str]] = {
    "users": frozenset({"password", "email"}),
}

# Hand-written meaning for columns whose NAME does not explain them. Introspection gives types and
# keys; it cannot say that `request` holds proposals AND published events distinguished only by
# `status`, which is precisely the fact a wrong query gets wrong. Keyed "table.column".
COLUMN_NOTES: dict[str, str] = {
    "request.status": (
        "Proposal workflow state. Only 'completed_approved' means the event is PUBLISHED and "
        "visible as a real event. Every other value ('draft', 'submitted', 'hos_hod_review', "
        "'fmb_review', 'cfo_review', 'department_review', 'resubmission_required', "
        "'completed_rejected', 'cancelled') is an in-flight or dead PROPOSAL and must never be "
        "presented as an event."
    ),
    "request.event_visibility": (
        "'Public' | 'Club Only' | 'Internal' | 'Private'. Controls who may see the event - see the "
        "VISIBILITY RULES in the instructions; never widen it."
    ),
    "request.applicant_user_id": "The event's OWNER/organiser (users.user_id).",
    "request.registration_approval": "'Automatic' or 'Manual'. Manual means the organiser approves each registrant.",
    "request.max_pax": "Organiser-set registration cap; NULL means uncapped.",
    "request.cost_amount": "NULL or 0 means a free event.",
    "request.request_code": "Human-facing reference code for the proposal, e.g. 'REQ-0001'.",
    "event_registration.user_id": "The REGISTRANT (the attendee), not the organiser.",
    "event_registration.status": (
        "'registered' (confirmed) | 'pending_approval' | 'rejected' | 'cancelled'. Exclude "
        "'cancelled' from every count and list unless explicitly asked for cancellations."
    ),
    "event_registration.decided_by_user_id": "Which organiser approved/rejected this registration.",
    "event_schedule.date": "One row per day an event runs; a multi-day event has several rows.",
    "clubs.user_id": "The club's current PRESIDENT (users.user_id). Presidency is public information.",
    "clubs.created_by_user_id": "The Club Admin who created the club, NOT the president.",
    "clubs.active": "FALSE means the club is deactivated and must not be offered as joinable.",
    "club_members.user_id": "A member of the club. Membership is PRIVATE - see the SCOPE RULES.",
    "club_join_requests.status": "'pending' | 'approved' | 'rejected'.",
    "club_join_requests.requester_user_id": "Who asked to join. Private to the requester, the club's president, and Club Admins.",
    "club_join_requests.resolved_by_user_id": "The president/admin who decided the request.",
    "club_president_change_requests.status": "'pending' | 'approved' | 'rejected'.",
    "users.full_name": "Display name. Match people by this, never by guessing an id.",
    "co_owners.staff_email": "Co-owners are matched by staff_id OR by lower(trim(staff_email)) = the user's email.",
}

# Relationships worth stating explicitly because they are NOT expressible as a foreign key, or
# because the FK alone does not say which direction the join must run for a correct answer.
JOIN_NOTES: tuple[str, ...] = (
    "request.request_id = event_schedule.request_id  -- an event's dates/times/locations (1 row per day)",
    "request.request_id = event_registration.request_id  -- who registered for an event",
    "request.request_id = request_categories.request_id  -- an event's category labels (use request_categories.category_name, the frozen snapshot, NOT a join to event_category)",
    "request.applicant_user_id = users.user_id  -- the event's organiser",
    "request.request_id = co_owners.request_id  -- additional owners; a user co-owns when co_owners.staff_id maps to their staff row OR lower(trim(co_owners.staff_email)) equals their email",
    "clubs.user_id = users.user_id  -- the club president",
    "clubs.club_id = club_members.club_id  -- club membership",
    "clubs.club_id = club_join_requests.club_id  -- requests to join a club",
    "clubs.club_id = club_category_links.club_id AND club_category_links.club_category_id = club_categories.club_category_id  -- a club's categories (many-to-many, 1-3 per club)",
    "users.user_id = student.user_id  -- present only for students; only students may join clubs",
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
    "Registrations: event_registration.status = 'cancelled' rows are withdrawn and must be "
    "excluded from counts and lists.",
    "Club membership is students-only: only a user with a `student` row (or a lecturer, per the "
    "join-request flow) can hold club_members/club_join_requests rows.",
    "Club presidency (clubs.user_id) is PUBLIC information visible to any signed-in user. Club "
    "MEMBERSHIP, JOIN REQUESTS and PRESIDENT-CHANGE REQUESTS are private - see SCOPE RULES.",
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


# query_router class -> which TABLE_GROUPS it needs. Kept beside the groups rather than in
# topic_access.py because this is a DATA question ("which tables"), not an authorization one
# ("which pages") - the two are deliberately separate concerns even though both are keyed by topic.
_TOPIC_GROUPS: dict[str, str] = {
    "events": "events",
    "my_registrations": "events",
    "event_organiser": "events",
    "event_organiser_decisions": "events",
    "clubs": "clubs",
    "clubs_mine": "clubs",
    "clubs_admin": "clubs",
    "president_change": "clubs",
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
