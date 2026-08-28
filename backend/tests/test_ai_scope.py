"""The AI assistant's scope and its authorization layers.

Scope is exactly what it claims: clubs, events, how the app works, and what the asker's own
account can do - with every how-to gated on the page its action lives on, and every generated SQL
query gated on the caller's real row-level scope.

WHAT THIS FILE COVERS, and why each part exists:

  PAGE GATING (unchanged by the Text-to-SQL refactor, and the reason it survived it untouched)
    topic_access maps a topic to the nav pages its data lives behind, and the answer is released
    only if Page Visibility grants one of them. Two historical defects motivated these tests:
    `how_to` was ungated, so "how do I join a club" also classified as {clubs, clubs_mine} and
    wrote two spurious denial rows for a purely procedural question; and topic_access named a page
    (`created-by-me`) that seed/nav.py never creates, which fails closed and so did nothing,
    silently, forever.

  SQL GUARD (new)
    The generated query is never trusted. These tests assert the guard actually rejects the things
    it claims to - writes, multiple statements, unknown tables and columns, excluded columns, and
    above all a query that omits its required scope predicate, which is the check that stops the
    model retrieving broadly and filtering afterwards.

  SCOPE RULES (new)
    That the predicates handed to the guard actually encode the app's own rules: a guest gets the
    guest visibility tier, a signed-in caller gets theirs plus their own events, and a non-admin
    can only reach their own club rows.

Tests that needed the deleted regex router (classify() returning an exact set for a fixed phrase)
are gone: classification is now a model call, and asserting an LLM's exact output in a unit test
would be asserting the weather. What replaced them is coverage of the DETERMINISTIC layers, which
are the ones that actually enforce anything.

Runs against the real seeded database, like tests/test_role_capabilities.py, and follows that
file's patterns (parametrize over the map, monkeypatch has_page_access to prove revocation works).
"""
from __future__ import annotations

import pytest

from app.ai import query_router, schema_catalog, scope_rules, sql_guard, topic_access
from app.ai.knowledge_base import HOW_TO_GUIDES, HOW_TO_LABEL, HOW_TO_PAGES
from app.db import query
from app.services import identity


def _live_pages() -> set[str]:
    return {row["page_code"] for row in query("SELECT page_code FROM nav_page")}


def _representative_unit(role_code: str) -> str | None:
    """A unit this role can legally be paired with, or None for a flat role - a unit-scoped role
    checked with unit_code=None fails every unit_role grant and wrongly looks access-less."""
    rows = query("SELECT unit_code FROM role_unit WHERE role_code = %s ORDER BY unit_code LIMIT 1", (role_code,))
    return rows[0]["unit_code"] if rows else None


class _FakePrincipal:
    """Minimal stand-in - topic_access and scope_rules only read .assignments, .user_id and
    .has_role() off a principal."""

    def __init__(self, assignments, user_id: int = 1):
        self.assignments = assignments
        self.user_id = user_id
        self.full_name = "Test Caller"
        self.email = "test@example.com"

    def has_role(self, *role_codes: str) -> bool:
        return bool({role for role, _ in self.assignments} & set(role_codes))


# --- the action -> page map is complete and real -------------------------------------------------

def test_every_guide_has_a_backing_page():
    """A guide with no page_code would be ungated - the exact hole this gating closed."""
    assert set(HOW_TO_PAGES) == set(HOW_TO_GUIDES), (
        f"guides without a page: {set(HOW_TO_GUIDES) - set(HOW_TO_PAGES)}; "
        f"pages without a guide: {set(HOW_TO_PAGES) - set(HOW_TO_GUIDES)}"
    )


def test_every_guide_has_a_label():
    """The label is what a refusal message and the audit row say instead of the raw key."""
    assert set(HOW_TO_LABEL) == set(HOW_TO_GUIDES)


@pytest.mark.parametrize("guide_key", sorted(HOW_TO_PAGES))
def test_every_how_to_page_exists(guide_key: str):
    """A typo'd or unseeded page_code fails closed forever, silently withholding a guide from
    everyone with no error - this is how `created-by-me` hid in topic_access for so long."""
    live = _live_pages()
    for page_code in HOW_TO_PAGES[guide_key]:
        assert page_code in live, f"{guide_key} names unknown page '{page_code}'"


def test_every_topic_page_exists():
    """Same check for the data-topic map - a dead page_code there silently narrows a whole topic."""
    live = _live_pages()
    for topic, pages in topic_access.TOPIC_PAGES.items():
        for page_code in pages:
            assert page_code in live, f"TOPIC_PAGES[{topic!r}] names unknown page '{page_code}'"


# --- gating is dynamic: revoking a page withholds the guide ---------------------------------------

def test_guide_is_withheld_when_its_page_is_revoked(monkeypatch):
    """The whole point: Page Visibility decides, live. Revoking Discover Clubs must stop the
    join-a-club steps on the very next answer, and must not touch any other guide."""
    principal = _FakePrincipal((("student", _representative_unit("student")),))
    assert topic_access.how_to_allowed(principal, "join_club") is True

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    assert topic_access.how_to_allowed(principal, "join_club") is False
    # Scoped, not a blanket wipe - an unrelated guide survives.
    assert topic_access.how_to_allowed(principal, "register_event") is True


def test_navigation_card_disappears_with_the_page(monkeypatch):
    """A card must never point somewhere the caller cannot open, so it is built from the same
    grant check that releases the steps."""
    principal = _FakePrincipal((("student", _representative_unit("student")),))
    assert topic_access.how_to_cards(principal, "join_club"), "expected a card while granted"

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    assert topic_access.how_to_cards(principal, "join_club") == []


def test_guest_gets_only_the_public_how_to():
    """A guest holds no assignments, so every grant check fails by construction. Registering for a
    Public event is genuinely open to them; everything else is behind a signed-in page."""
    assert topic_access.how_to_allowed(None, "register_event") is True
    assert topic_access.how_to_allowed(None, "join_club") is False
    assert topic_access.how_to_allowed(None, "submit_proposal") is False


def test_unknown_guide_is_not_refused():
    """An unmapped key is a coding gap (caught above), not a reason to refuse a real caller."""
    assert topic_access.how_to_allowed(None, "no_such_guide") is True


# --- the removed scope stays removed --------------------------------------------------------------

_REMOVED_CLASSES = ("cafeteria", "proposals_mine", "proposals_review", "admin_settings")


@pytest.mark.parametrize("removed", _REMOVED_CLASSES)
def test_removed_classes_are_gone(removed: str):
    """Scope is Clubs + Events + how the app works. A class left half-deleted in one map but not
    another is how the old drift started."""
    assert removed not in query_router.CLASS_DESCRIPTIONS
    assert removed not in topic_access.TOPIC_PAGES
    assert removed not in topic_access.TOPIC_LABEL
    assert removed not in topic_access.TOPIC_ASK_DESCRIPTION


def test_every_class_is_routed_to_exactly_one_answer_path():
    """A class in neither set is answered by nothing; a class in both is ambiguous. Either is a
    silent gap, since api/ai.py picks its path by set membership."""
    from app.ai import classifier

    both = classifier.KNOWLEDGE_BASE_CLASSES & classifier.DATA_CLASSES
    neither = set(query_router.CLASS_DESCRIPTIONS) - classifier.KNOWLEDGE_BASE_CLASSES - classifier.DATA_CLASSES
    assert not both, f"classes in both answer paths: {sorted(both)}"
    assert not neither, f"classes in neither answer path: {sorted(neither)}"


def test_every_data_class_has_tables_and_a_page_gate():
    """A data class the schema catalog cannot map to tables would generate SQL against an empty
    allow-list (rejected every time); one absent from TOPIC_PAGES would be UNGATED - answered from
    the database with no page check at all, which is the serious direction of the two."""
    from app.ai import classifier

    for cls in sorted(classifier.DATA_CLASSES):
        assert schema_catalog.tables_for_topics({cls}), f"{cls} maps to no tables"
        assert cls in topic_access.TOPIC_PAGES, f"{cls} reads the database but is not page-gated"


# --- the schema catalog exposes only what it should -----------------------------------------------

def test_credentials_are_not_in_the_catalog():
    """users.password must be unreachable: absent from what the model is shown AND from the guard's
    allow-list, so no generated query can select or filter on it."""
    columns = schema_catalog.allowed_columns()
    assert "password" not in columns.get("users", ())
    document = schema_catalog.document_for_topics({"clubs"})
    assert "password" not in document.lower()


def test_out_of_scope_tables_are_not_described():
    """The allow-list is the point: describing the whole database would waste the prompt and invite
    the model to reach for tables the assistant has no business in."""
    document = schema_catalog.document_for_topics({"events", "clubs"})
    for table in ("password_reset_tokens", "cafeteria_staff_requests", "request_funding_purchase"):
        assert f"TABLE {table}" not in document
        assert table not in schema_catalog.ALLOWED_TABLES


def test_a_club_question_cannot_reach_event_tables():
    """Table selection is per-QUESTION, not per-app: both domains are individually in scope, but a
    club question must not be able to read event registrations."""
    club_tables = schema_catalog.tables_for_topics({"clubs", "clubs_mine"})
    assert "event_registration" not in club_tables
    assert "clubs" in club_tables


# --- the SQL guard rejects what it claims to ------------------------------------------------------

def _guest_scope():
    return scope_rules.build_scope(None, {"events"})


def _student_scope(user_id: int = 42):
    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=user_id)
    return scope_rules.build_scope(principal, {"events", "clubs", "clubs_mine"})


def _validate(sql: str, scope, topics=("events",)):
    return sql_guard.validate(
        sql, allowed_tables=schema_catalog.tables_for_topics(set(topics)), scope=scope
    )


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM request",
        "UPDATE request SET event_title = 'x'",
        "INSERT INTO users (full_name) VALUES ('x')",
        "DROP TABLE clubs",
        "TRUNCATE event_registration",
        "GRANT ALL ON users TO public",
        "CREATE TABLE evil (id int)",
        "ALTER TABLE users ADD COLUMN backdoor text",
    ],
)
def test_guard_rejects_every_write_operation(sql: str):
    """Read-only is not negotiable, and is enforced here as well as by the read-only transaction -
    if either has a hole, the other still holds."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate(sql, _guest_scope())


def test_guard_rejects_a_second_statement():
    """A stray semicolon is the whole of the classic injection payload."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT 1; DROP TABLE users", _guest_scope())


def test_guard_rejects_a_write_hidden_behind_a_comment():
    """Comments are stripped before every other rule runs, so a payload cannot hide past a naive
    keyword scan by wearing a `--`."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT 1 --\nDROP TABLE users", _guest_scope())


def test_guard_rejects_reading_the_catalog():
    """A query asking the database to describe itself is either confused or probing; the schema is
    served from schema_catalog, never from a generated query."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT table_name FROM information_schema.tables", _guest_scope())


def test_guard_rejects_an_excluded_column():
    """Qualified or bare, the credential column is rejected on the word alone."""
    scope = _student_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT users.password FROM users", scope, topics=("clubs",))


def test_guard_rejects_an_unknown_table():
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate("SELECT x.id FROM secret_table x", _guest_scope())
    assert excinfo.value.repairable, "a wrong table name is worth one regeneration attempt"


def test_guard_rejects_an_unknown_column():
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate(
            "SELECT request.nonexistent_column FROM request WHERE "
            "request.status = 'completed_approved' AND request.event_visibility IN ('Public', 'Club Only')",
            _guest_scope(),
        )
    assert excinfo.value.repairable


# --- THE central check: a query without its scope predicate never runs ----------------------------

def test_guard_rejects_a_query_missing_its_scope_predicate():
    """This is what stops the model retrieving everything and filtering afterwards. A bare SELECT
    over `request` reads unpublished proposals and Private events; without this rule, nothing in
    code would prevent it."""
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate("SELECT request.event_title FROM request", _guest_scope())
    assert "access condition" in excinfo.value.reason


def test_guard_accepts_a_query_carrying_its_scope_predicate():
    """The positive case - the guard must not be so strict that a correct query is unanswerable."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    sql = f"SELECT request.event_title FROM request WHERE {predicate} LIMIT 5"
    assert _validate(sql, scope) == sql


def test_predicate_matching_survives_reformatting():
    """The model reformatting a required predicate across lines is not a security event; matching
    is whitespace-normalised so a valid query is not rejected over layout."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    reflowed = predicate.replace(" AND ", "\n      AND\n   ")
    sql = f"SELECT request.event_title\n  FROM request\n WHERE {reflowed}"
    assert _validate(sql, scope)


def test_guard_rejects_a_forbidden_table_outright():
    """A guest has no saved events at all, so scope_rules gives that table an EMPTY predicate tuple
    - meaning "no query may touch this", not "any predicate will do".

    event_registration is deliberately NOT the example here any more: a guest CAN ask how many
    people registered for a published event, because that number is on the event's own card for
    everyone (see the public-count tests below). saved_event has no such public half."""
    scope = _guest_scope()
    assert scope.predicates_for("saved_event") == ()
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate("SELECT saved_event.request_id FROM saved_event", scope)
    assert not excinfo.value.repairable, "an authorization violation must never be retried"


def test_a_guest_can_count_registrations_but_not_name_them():
    """The count is public to guests too - it is rendered on the Explore Events cards a signed-out
    visitor can already browse."""
    scope = _guest_scope()
    assert scope.predicates_for("event_registration") == ("PUBLIC_COUNT_ONLY",)
    assert _validate("SELECT COUNT(*) FROM event_registration WHERE PUBLIC_COUNT_ONLY", scope)
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT event_registration.registrant_name FROM event_registration", scope)


# --- the scope predicates encode the app's own rules ----------------------------------------------

def test_guest_visibility_matches_the_events_endpoint():
    """Mirrors api/events.py's _GUEST_VISIBLE exactly: Public and Club Only, published only. A
    guest must never reach Internal or Private."""
    predicate = _guest_scope().predicates_for("request")[0]
    assert "completed_approved" in predicate
    assert "'Public', 'Club Only'" in predicate
    assert "Internal" not in predicate
    assert "Private" not in predicate


def test_signed_in_caller_gets_internal_plus_their_own_events():
    """Mirrors _INTERNAL_VISIBLE plus my_organized_events' owner clause: the shared tiers, or their
    OWN event at any visibility - which is the only way a Private event is ever reachable."""
    predicate = _student_scope(user_id=42).predicates_for("request")[0]
    assert "'Public', 'Club Only', 'Internal'" in predicate
    assert "request.applicant_user_id = 42" in predicate
    assert "co_owners" in predicate, "co-ownership is part of ownership (workflow.is_proposal_owner)"


def test_a_non_admin_can_only_reach_their_own_club_rows():
    """Page access to Clubs is not permission to read every club's membership. A non-admin's
    predicates must be self-or-president-of-that-club, never club-wide."""
    scope = _student_scope(user_id=42)
    assert scope.is_club_admin is False
    predicates = scope.predicates_for("club_members")
    assert predicates, "club_members must be constrained for a non-admin"
    assert any("club_members.user_id = 42" in p for p in predicates)
    assert any("c_pres.user_id = 42" in p for p in predicates), "the president-of-this-club case"


def test_club_admin_scope_comes_from_the_page_grant_not_the_role_name():
    """The clubs_admin TOPIC surviving the page gate is what makes someone an admin here - never
    principal.has_role('club-admin'). That is the exact drift topic_access was written to remove:
    a custom role granted Manage Clubs was refused, and a club-admin whose page was revoked was
    still answered."""
    student = _FakePrincipal((("student", _representative_unit("student")),), user_id=7)
    assert scope_rules.build_scope(student, {"clubs", "clubs_mine"}).is_club_admin is False
    # Same principal, same roles - only the topic differs, because the page gate already passed it.
    assert scope_rules.build_scope(student, {"clubs", "clubs_admin"}).is_club_admin is True


def test_a_guest_has_no_club_access_at_all():
    """Clubs have no public tier (api/ai.py's module docstring) - every club table is forbidden,
    not merely filtered."""
    scope = scope_rules.build_scope(None, {"clubs", "clubs_mine"})
    for table in ("clubs", "club_members", "club_join_requests"):
        assert scope.predicates_for(table) == (), f"{table} must be forbidden for a guest"


def test_scope_document_states_its_conditions_verbatim():
    """The model is given the exact text the guard will look for. If these two ever disagreed,
    every query would be rejected for a reason nobody could see."""
    scope = _guest_scope()
    document = scope_rules.document(scope)
    for predicate in scope.predicates_for("request"):
        assert predicate in document


# --- nothing imports a deleted module -------------------------------------------------------------

def test_no_module_imports_a_deleted_module():
    """The vector store and its retrieval layer are gone (ai_db, sync, backfill, retrieval,
    club_retrieval). An import left behind is an ImportError at request time, not at test time,
    unless something asserts it here."""
    import app.ai.classifier as classifier_module
    import app.ai.text_to_sql as tts_module
    import app.api.ai as ai_module

    banned = ("ai_db", "club_retrieval", "from .sync", "from .retrieval", "from .backfill")
    for module in (ai_module, classifier_module, tts_module):
        source = open(module.__file__, encoding="utf-8").read()
        # Only import STATEMENTS matter - prose in a docstring explaining what was removed is fine.
        import_lines = [
            line for line in source.splitlines()
            if line.startswith(("import ", "from ")) or line.strip().startswith(("import ", "from "))
        ]
        for line in import_lines:
            for name in banned:
                assert name not in line, f"{module.__name__} still imports {name}: {line}"


def test_the_vector_database_is_gone():
    """The separate AI/vector database was deleted with this refactor: no second pool, no second
    DSN, no embedding sync. A leftover config field would suggest a store that no longer exists."""
    import os.path

    from app.config import config

    assert not hasattr(config, "ai_database_url")
    ai_dir = os.path.dirname(__import__("app.ai", fromlist=["_"]).__file__)
    for removed in ("ai_db.py", "sync.py", "backfill.py", "retrieval.py", "club_retrieval.py"):
        assert not os.path.exists(os.path.join(ai_dir, removed)), f"{removed} should have been deleted"


# --- the users table cannot be enumerated ---------------------------------------------------------
# Regression tests for a real hole found by smoke-testing the finished pipeline: `users` had no
# required predicate, on the reasoning that it is "only ever joined". That was a hope, not a rule.
# `SELECT users.full_name, users.email FROM users` touched no other table, so no other table's
# predicate applied, and users had none of its own - the whole staff-and-student directory, from a
# guest account, past a guard that reported no problem. The AI reviewer caught it, but the reviewer
# is the second line of defence; the deterministic layer has to hold on its own.

@pytest.mark.parametrize(
    "sql",
    [
        "SELECT users.full_name, users.email FROM users",
        "SELECT users.full_name FROM users",
        "SELECT COUNT(*) FROM users",
        "SELECT users.full_name FROM users ORDER BY users.full_name LIMIT 100",
    ],
)
@pytest.mark.parametrize("signed_in", [False, True])
def test_the_user_directory_cannot_be_enumerated(sql: str, signed_in: bool):
    """A bare read of `users` is the admin directory, which this assistant does not cover - for a
    signed-in caller exactly as much as for a guest."""
    scope = _student_scope() if signed_in else _guest_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate(sql, scope, topics=("events",) if not signed_in else ("events", "clubs"))


def test_email_is_never_readable():
    """No supported question needs anyone's email - a name is always the answer, and the asker's own
    address is already in the prompt as authenticated context. Excluding the column outright is a
    stronger guarantee than instructing the model not to select it."""
    assert "email" in schema_catalog.EXCLUDED_COLUMNS["users"]
    assert "email" not in schema_catalog.allowed_columns()["users"]
    assert "email" not in schema_catalog.document_for_topics({"events"}).lower().split("users")[-1][:400]


def test_a_name_can_still_be_resolved_through_an_authorised_row():
    """The guard must stop enumeration WITHOUT breaking the ordinary question it was never meant to
    touch. "Who organises this event" joins users to an event the caller may already see, and that
    join is itself the required condition."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title, users.full_name FROM request "
        "JOIN users ON users.user_id = request.applicant_user_id "
        f"WHERE {predicate}"
    )
    assert _validate(sql, scope)


def test_users_joins_are_offered_only_for_reachable_tables():
    """Advertising a club join in an events-only question would hand the model a route the table
    allow-list then rejects - a guaranteed wasted regeneration round trip."""
    events_only = scope_rules.build_scope(None, {"events"})
    assert all("clubs" not in p for p in events_only.predicates_for("users"))


def test_no_scope_predicate_reads_an_excluded_column():
    """A required condition that reads an excluded column would be rejected by the guard on the
    bare word - making every valid query unrunnable, since the condition is mandatory. The caller's
    own email is substituted as a literal for exactly this reason."""
    scope = _student_scope()
    for table, predicates in scope.required_predicates.items():
        for predicate in predicates:
            for column in schema_catalog.EXCLUDED_COLUMNS.get("users", ()):
                assert f"users.{column}" not in predicate, f"{table} predicate reads users.{column}"
            # `(SELECT ... email ... FROM users)` would trip the guard's bare-word check too.
            assert "FROM users" not in predicate, f"{table} predicate sub-selects from users"


def test_scope_predicates_escape_a_quote_in_the_email():
    """The caller's email is interpolated into a predicate as a literal. It comes from the
    authenticated principal, never from the question - but a predicate built by concatenation is
    the one place this design could reintroduce injection, so the quoting is asserted rather than
    assumed."""
    class _Odd:
        user_id = 9
        full_name = "O'Brien"
        email = "o'brien@example.com"
        assignments = (("student", None),)

        def has_role(self, *codes):
            return "student" in codes

    predicate = scope_rules.build_scope(_Odd(), {"events"}).predicates_for("request")[0]
    assert "''brien" in predicate, "a single quote must be doubled, not left to terminate the literal"


# --- string literals are not identifiers ----------------------------------------------------------

def test_a_dotted_string_literal_is_not_read_as_a_column():
    """Regression: the column rule read `'student.computing@demo.apu.edu.my'` as student.computing
    and rejected the query for a column "computing" on table "student". Two of the first real
    questions put through the pipeline burned all three retry attempts on this, so it was a live
    false rejection rather than a hypothetical one."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title FROM request "
        f"WHERE {predicate} AND request.applicant_email = 'student.computing@demo.apu.edu.my'"
    )
    assert _validate(sql, scope)


def test_a_table_name_inside_a_literal_does_not_demand_a_predicate():
    """The other half of the same rule: a table NAME mentioned in a string must not make the guard
    demand that table's access condition for a query that never reads it."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    sql = f"SELECT request.event_title FROM request WHERE {predicate} AND request.event_title LIKE '%club_members%'"
    assert _validate(sql, scope)


def test_a_write_keyword_inside_a_literal_is_still_rejected():
    """The keyword rule deliberately keeps seeing literals. Nothing legitimate hides DROP TABLE in
    a string, so rejecting it costs nothing and closes an obvious evasion."""
    scope = _guest_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT request.event_title FROM request WHERE request.event_title = 'DROP TABLE users'", scope)


# --- aliases -------------------------------------------------------------------------------------
# Required predicates are written with real table names, but models naturally alias
# (`FROM request r ... WHERE r.status = ...`). Matching the literal string would mean forbidding
# aliases outright, so both sides are alias-expanded before comparison. Getting that expansion
# one-sided broke EVERY event query - a total outage rather than a leak, but the reason both sides
# are now normalised the same way.

def test_an_aliased_query_still_satisfies_its_predicate():
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    aliased_predicate = predicate.replace("request.request_id", "r.request_id").replace(
        "request.status", "r.status"
    ).replace("request.event_visibility", "r.event_visibility")
    sql = f"SELECT r.event_title FROM request r WHERE {aliased_predicate}"
    assert _validate(sql, scope), "aliasing a table must not be read as omitting its access condition"


def test_aliasing_does_not_let_a_query_skip_its_predicate():
    """The other direction: expansion must not become a way to look like you satisfied a condition
    you never wrote."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT r.event_title FROM request r", _guest_scope())


def test_an_aliased_users_dump_is_still_rejected():
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT u.full_name FROM users u", _student_scope(), topics=("events", "clubs"))


# --- a resolved how-to answers from its guide, not the database -----------------------------------

@pytest.mark.parametrize(
    "question,guide",
    [
        ("how do I join a club", "join_club"),
        ("how do I register for an event", "register_event"),
        ("how do I submit a proposal", "submit_proposal"),
    ],
)
def test_a_resolved_how_to_drops_incidental_data_classes(question: str, guide: str):
    """THE regression test, in its Text-to-SQL form. "How do I join a club" names clubs, so the
    classifier legitimately returns {how_to, clubs} - and api/ai.py routes to the SQL path whenever
    any data class is present, so the asker got a LIST OF CLUBS instead of the instructions they
    asked for. Observed exactly that way through the finished endpoint.

    Asserts the deterministic suppression, not the model: this calls the pure function directly, so
    it tests the backstop rather than whether the prompt happened to be obeyed on the day."""
    from app.ai.classifier import _suppress_incidental_how_to_topics

    assert query_router.how_to_topic(question) == guide
    assert _suppress_incidental_how_to_topics(question, {"how_to", "clubs", "events"}) == {"how_to"}


def test_a_generic_how_to_keeps_its_data_classes():
    """The guard on the guard: only a RESOLVED guide is confidently procedural. "How does the
    approval process work" has no steps behind it, so its data classes are the only thing that
    could answer it and must survive."""
    from app.ai.classifier import _suppress_incidental_how_to_topics

    question = "how does the approval process work"
    assert query_router.how_to_topic(question) is None
    assert _suppress_incidental_how_to_topics(question, {"how_to", "events"}) == {"how_to", "events"}


def test_suppression_never_empties_the_class_set():
    """Dropping every class would send a real how-to down the out-of-scope path - refused and
    logged as unsupported, which is the opposite of the intent."""
    from app.ai.classifier import _suppress_incidental_how_to_topics

    assert _suppress_incidental_how_to_topics("how do I join a club", {"how_to"}) == {"how_to"}


# --- a predicate that is present but inert -------------------------------------------------------
# Rule 7 is a textual check: it proves the required condition is THERE, not that it BITES. Those
# are different claims, and adversarial testing of the finished guard found the gap between them -
# `WHERE CASE WHEN 1=1 THEN true ELSE (<predicate>) END` contains the predicate verbatim and
# passed cleanly while doing nothing. The fix rejects the constructs that make neutralisation
# possible, rather than trying to prove a boolean expression's effect.

@pytest.mark.parametrize(
    "template",
    [
        "SELECT request.event_title FROM request WHERE CASE WHEN 1=1 THEN true ELSE ({pred}) END",
        "SELECT request.event_title FROM request WHERE ({pred}) OR 1=1",
        "SELECT request.event_title FROM request WHERE ({pred}) OR TRUE",
        "SELECT request.event_title FROM request WHERE ({pred}) OR 'a' = 'a'",
    ],
)
def test_a_neutralised_predicate_is_rejected(template: str):
    scope = _guest_scope()
    sql = template.format(pred=scope.predicates_for("request")[0])
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate(sql, scope)
    assert not excinfo.value.repairable, (
        "defeating an access condition is an authorization violation, not a mistake to retry"
    )


def test_ordinary_queries_are_not_caught_by_the_neutralisation_rules():
    """The rules must not become a tax on normal SQL - a date comparison, a join and a LIMIT are
    what almost every real query looks like."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title, event_schedule.date FROM request "
        "JOIN event_schedule ON event_schedule.request_id = request.request_id "
        f"WHERE {predicate} AND event_schedule.date >= CURRENT_DATE "
        "ORDER BY event_schedule.date LIMIT 10"
    )
    assert _validate(sql, scope)


def test_a_union_cannot_smuggle_in_another_table():
    """UNION is the classic way to append a second result set. It does not escape rule 7: the
    second branch reads `users`, and users has its own required condition."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            f"SELECT request.event_title FROM request WHERE {predicate} "
            "UNION SELECT users.full_name FROM users",
            scope,
        )


def test_a_scalar_subquery_cannot_leak_another_table():
    """A subselect in the column list is still a read of that table, and is checked as one."""
    scope = _guest_scope()
    predicate = scope.predicates_for("request")[0]
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT request.event_title, (SELECT users.full_name FROM users LIMIT 1) "
            f"FROM request WHERE {predicate}",
            scope,
        )


# --- recommendations ask before they suggest ------------------------------------------------------
# From a real session: "can u suggest event for me" returned five events, no reason, no question,
# and the same five for every asker. Three faults - it never asked what they liked, it guessed
# "events" for a question that named neither domain, and it dumped the catalogue instead of
# shortlisting. These test the deterministic half; the prompt enforces the wording.

@pytest.mark.parametrize(
    "question",
    [
        "can u suggest event for me",
        "what can you suggest for me",
        "what event is best fits me",
        "recommend a club",
        "what should I join",
        "anything good coming up",
    ],
)
def test_recommendation_questions_are_recognised(question: str):
    from app.ai import recommendation

    assert recommendation.is_recommendation(question)


@pytest.mark.parametrize(
    "question",
    ["how many events am I registered for", "who organises the hackathon", "what clubs exist"],
)
def test_plain_lookups_are_not_recommendations(question: str):
    """A false positive costs one clarifying question on a factual lookup, which is worse than
    unhelpful - it makes the assistant look like it did not understand."""
    from app.ai import recommendation

    assert not recommendation.is_recommendation(question)


def test_an_ambiguous_recommendation_asks_which_domain():
    """"What can you suggest for me" names neither events nor clubs. The old behaviour guessed
    events and committed silently."""
    from app.ai import recommendation

    assert recommendation.named_domain("what can you suggest for me") is None
    assert recommendation.stage_for("what can you suggest for me", []) == "clarify"


def test_a_domain_specific_first_request_asks_about_interests():
    from app.ai import recommendation

    assert recommendation.named_domain("suggest an event for me") == "events"
    assert recommendation.stage_for("suggest an event for me", []) == "ask"


def test_a_recommendation_after_the_interest_question_recommends():
    """Once the assistant has asked and they have answered, asking again is not listening."""
    from app.ai import recommendation

    history = [{"question": "suggest an event", "answer": "What kind of activities do you enjoy?"}]
    assert recommendation.stage_for("suggest an event for me", history) == "recommend"


def test_the_answer_to_the_interest_question_stays_in_the_thread():
    """"I like coding and building things" carries no recommendation wording, but it is exactly the
    turn where broad candidate retrieval matters. Without this it ran a narrow query, matched the
    literal word "coding" against nothing, and reported there were no events while a hackathon sat
    in the table."""
    from app.ai import recommendation

    history = [{"question": "suggest an event", "answer": "What kind of activities do you enjoy?"}]
    assert recommendation.in_recommendation_thread("I like coding and hands-on stuff", history)
    assert not recommendation.in_recommendation_thread("I like coding and hands-on stuff", [])


def test_a_recommendation_is_a_shortlist():
    """A recommendation is a shortlist with reasons; a list of nine is a search result."""
    from app.ai import recommendation

    assert recommendation.MAX_SUGGESTIONS <= 3


# --- cards are built for what the answer NAMES ----------------------------------------------------

def test_cards_match_only_what_the_answer_names():
    """A query returns rows the reply never mentions - the model was given nine events and picked
    three. Carding all nine would put six cards under an answer that never brought them up."""
    from app.ai.cards import _names_in

    titles = {"Annual Hackathon Kickoff": 1, "APU Cultural Night": 2, "Case Competition Finals": 3}
    named = _names_in("The Annual Hackathon Kickoff would suit you.", titles)
    assert named == [1]


def test_a_one_character_title_never_matches():
    """The seed data contains a club literally named "1", which would otherwise match the digit in
    every date and time in a reply."""
    from app.ai.cards import _names_in

    assert _names_in("It runs on 1 October at 1pm", {"1": 99}) == []


def test_a_longer_title_wins_over_a_substring():
    """Longest-first matching, so a club named "Coding" does not swallow "APU Coding Society"."""
    from app.ai.cards import _names_in

    titles = {"APU Coding Society": 1, "Coding": 2}
    assert _names_in("Try the APU Coding Society.", titles)[0] == 1


# --- navigation cards for location questions ------------------------------------------------------

def test_topic_cards_respect_page_visibility(monkeypatch):
    """"Where can I find my registrations" classifies as DATA, resolves no how-to guide, and used to
    get prose with nothing to click. The card must still come from the same grant check."""
    principal = _FakePrincipal((("student", _representative_unit("student")),))
    assert topic_access.topic_cards(principal, {"my_registrations"}), "expected a card while granted"

    real = identity.has_page_access
    monkeypatch.setattr(identity, "has_page_access", lambda a, page_code: False)
    assert topic_access.topic_cards(principal, {"my_registrations"}) == []
    monkeypatch.setattr(identity, "has_page_access", real)


def test_topic_cards_are_capped():
    principal = _FakePrincipal((("student", _representative_unit("student")),))
    assert len(topic_access.topic_cards(principal, {"events", "clubs", "my_registrations"})) <= 2


# --- registration COUNTS are public; registrant IDENTITIES are not --------------------------------
# The whole event_registration table was originally treated as private, so "how many people
# registered for the hackathon" answered 0 for a caller who organises nothing - while Explore
# Events displayed "5 registered" on that event's own card, to that same user. The count is shipped
# to every viewer by api/events.py's _event_select (confirmedRegistrationCount), so refusing to
# state it was never a privacy win; it just made the assistant look broken.

def _cafeteria_manager_scope():
    """A caller who organises nothing and has registered for nothing - the account the bug was
    found on. Every registration row is outside their private scope, so only the public count
    exemption can answer a count question for them."""
    class _P:
        user_id = 7
        full_name = "Siti Aminah"
        email = "cafeteria.manager@demo.apu.edu.my"
        assignments = (("cafeteria-manager", "cafeteria__atrium_cafeteria"),)

        def has_role(self, *codes):
            return "cafeteria-manager" in codes

    return scope_rules.build_scope(_P(), {"events"})


def test_a_public_count_query_is_allowed():
    scope = _cafeteria_manager_scope()
    sql = (
        "SELECT COUNT(event_registration.event_registration_id) FROM event_registration "
        "WHERE PUBLIC_COUNT_ONLY"
    )
    assert _validate(sql, scope)


@pytest.mark.parametrize(
    "column",
    ["registrant_name", "registrant_email", "reason_for_attending", "payment_status"],
)
def test_the_count_exemption_cannot_return_identities(column: str):
    """The marker must not become a way to read the attendee list of an event the caller has
    nothing to do with. A predicate is a row filter and cannot express "aggregate but do not
    project", so the guard enforces the column half."""
    scope = _cafeteria_manager_scope()
    sql = f"SELECT COUNT(*), event_registration.{column} FROM event_registration WHERE PUBLIC_COUNT_ONLY"
    with pytest.raises(sql_guard.SqlRejected):
        _validate(sql, scope)


def test_the_count_exemption_requires_an_aggregate():
    scope = _cafeteria_manager_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT event_registration.request_id FROM event_registration WHERE PUBLIC_COUNT_ONLY",
            scope,
        )


def test_a_roster_read_without_the_marker_is_still_refused():
    """The private half is unchanged: names still need ownership."""
    scope = _cafeteria_manager_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT event_registration.registrant_name FROM event_registration", scope)


def test_the_marker_is_stripped_before_execution():
    """PUBLIC_COUNT_ONLY is an instruction to the guard, not SQL - Postgres has no idea what it
    means, so it is rewritten to TRUE once the guard has proved the claim was honest."""
    from app.ai.sql_runner import _strip_markers

    stripped = _strip_markers("SELECT COUNT(*) FROM event_registration WHERE PUBLIC_COUNT_ONLY")
    assert "PUBLIC_COUNT_ONLY" not in stripped
    assert "TRUE" in stripped


# --- an empty SCOPED result is not a statement about the world ------------------------------------

def test_a_scoped_empty_result_never_claims_none_exist():
    """"Who registered for the Career Fair?" returned no rows - correctly, that roster is not this
    caller's to read - and the assistant answered "No one has registered", while the event's card
    showed 5. An empty scoped result says something about the ASKER'S ACCESS, not about the world."""
    from app.ai.sql_runner import rows_to_document

    document = rows_to_document([], sql="SELECT x FROM event_registration WHERE user_id = 7")
    assert "none exist" in document or "NOT 'none exist'" in document
    assert "access" in document.lower()


def test_a_genuinely_empty_public_result_still_states_zero():
    """The guard on the guard: a real zero over public data is a complete, correct answer, and
    refusing to state it is its own bug."""
    from app.ai.sql_runner import rows_to_document

    document = rows_to_document([], sql="SELECT COUNT(*) FROM request WHERE TRUE")
    assert "real, final, correct answer" in document
