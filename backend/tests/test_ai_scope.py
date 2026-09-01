"""The AI assistant's ENFORCEMENT layers.

Scope is exactly what it claims: suggest and answer about events, suggest and answer about clubs,
explain a page, explain how to do something, say who the asker is. Nothing else - and the tests
here prove the layers underneath actually hold that line rather than merely describing it.

WHAT THIS FILE COVERS, and why each part exists:

  PAGE GATING
    Every answer is released by scope.can_reach, which resolves an internal page against Page
    Visibility, live. Revoking a page must narrow the assistant on the very next request, in every
    place at once - the steps, the navigation card, the topic and the capability sentence.

  THE SQL GUARD
    The generated query is never trusted. These tests assert the guard rejects what it claims to -
    writes, multiple statements, unknown tables and columns, excluded columns, and above all a
    query that omits its required scope predicate, which is the check that stops the model
    retrieving broadly and filtering afterwards.

  ROW SCOPE
    That the predicates handed to the guard encode the app's own rules: a guest gets the guest
    visibility tier, a signed-in caller gets theirs, and the two people-tables carry the count-only
    marker for everybody - because who registered and who is a member are not questions this
    assistant answers for anyone.

  THE SCOPE BOUNDARY ITSELF
    Regression tests for the shapes that used to slip through: the users table being enumerated, a
    resolved how-to being answered with a list of clubs, a refusal offering something to click.

Tests asserting an LLM's exact output are absent by design - classification is a model call, and
asserting the weather is not a test. What is covered here is the DETERMINISTIC half, which is the
half that actually enforces anything.

Runs against the real seeded database, like tests/test_scope_definition.py.
"""
from __future__ import annotations

import pytest

from app.ai import cards, recommendation, schema_catalog, scope, scope_rules, sql_guard, topic_access
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
    """Minimal stand-in - topic_access, scope and scope_rules read .assignments, .user_id,
    .is_external and .has_role() off a principal."""

    def __init__(self, assignments, user_id: int = 1, *, is_external: bool = False):
        self.assignments = assignments
        self.user_id = user_id
        self.is_external = is_external
        self.full_name = "Test Caller"
        self.email = "test@example.com"

    def has_role(self, *role_codes: str) -> bool:
        return bool({role for role, _ in self.assignments} & set(role_codes))


def _student():
    return _FakePrincipal((("student", _representative_unit("student")),))


# --- gating is dynamic: revoking a page withholds everything behind it ----------------------------

def test_steps_are_withheld_when_their_page_is_revoked(monkeypatch):
    """The whole point: Page Visibility decides, live. Revoking Discover Clubs must stop the
    join-a-club steps on the very next answer, and must not touch any other function."""
    principal = _student()
    assert scope.can_use(principal, "join_club") is True

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    assert scope.can_use(principal, "join_club") is False
    # Scoped, not a blanket wipe - an unrelated function survives.
    assert scope.can_use(principal, "register_event") is True


def test_the_topic_goes_with_the_page(monkeypatch):
    """The same revocation must also stop the assistant ANSWERING about clubs, not merely explaining
    how to join one. Those two used to be gated separately and could disagree."""
    principal = _student()
    assert topic_access.topic_allowed(principal, "clubs") is True

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    assert topic_access.topic_allowed(principal, "clubs") is False
    assert "find clubs" not in topic_access.capability_document(principal)
    assert topic_access.denied_topics(principal, {"clubs", "events"}) == ["clubs"]


def test_navigation_card_disappears_with_the_page(monkeypatch):
    """A card must never point somewhere the caller cannot open, so it is built from the same grant
    check that releases the steps."""
    principal = _student()
    assert topic_access.function_cards(principal, "join_club"), "expected a card while granted"

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    assert topic_access.function_cards(principal, "join_club") == []


def test_guest_gets_only_the_public_how_to():
    """A guest holds no assignments, so every internal grant check fails by construction.
    Registering for a Public event is genuinely open to them; everything else is behind a page."""
    assert scope.can_use(None, "register_event") is True
    assert scope.can_use(None, "join_club") is False
    assert scope.can_use(None, "submit_proposal") is False


def test_an_unknown_function_is_refused():
    """An unmapped key USED to be allowed, on the reasoning that a coding gap should not withhold a
    real answer. It withheld nothing - the endpoint answered from the whole platform overview
    instead, and an external account that had just been refused every topic was handed working
    steps for saving an event. A function nobody has written has no steps to give."""
    assert scope.can_use(None, "no_such_function") is False


# --- the removed scope stays removed --------------------------------------------------------------

_REMOVED_INTENTS = (
    "cafeteria", "proposals_mine", "proposals_review", "admin_settings", "admin_ai_denials",
    "my_registrations", "event_organiser", "event_organiser_decisions", "clubs_mine",
    "clubs_admin", "president_change", "role_capability", "system_capability", "askable",
    "self_capability",
)


@pytest.mark.parametrize("removed", _REMOVED_INTENTS)
def test_removed_intents_are_gone(removed: str):
    """The assistant does seven things. An intent left half-deleted in one map but not another is
    how the old drift started - and every name here was a real class that answered a question the
    assistant no longer covers."""
    from app.ai import query_router

    assert removed not in query_router.INTENT_DESCRIPTIONS
    assert removed not in scope.TOPICS
    assert removed not in topic_access.TOPIC_LABEL


def test_every_intent_is_routed_to_exactly_one_answer_path():
    """An intent in neither set is answered by nothing; one in both is ambiguous. Either is a silent
    gap, since api/ai.py picks its path by set membership."""
    from app.ai import classifier, query_router

    both = classifier.KNOWLEDGE_INTENTS & classifier.DATA_INTENTS
    neither = set(query_router.INTENT_DESCRIPTIONS) - classifier.KNOWLEDGE_INTENTS - classifier.DATA_INTENTS
    assert not both, f"intents in both answer paths: {sorted(both)}"
    assert not neither, f"intents in neither answer path: {sorted(neither)}"


def test_every_data_intent_has_tables_and_a_page_gate():
    """A data intent the schema catalog cannot map to tables would generate SQL against an empty
    allow-list (rejected every time); one with no topic would be UNGATED - answered from the
    database with no page check at all, which is the serious direction of the two."""
    from app.ai import classifier

    for intent in sorted(classifier.DATA_INTENTS):
        topic = classifier.INTENT_TOPIC.get(intent)
        assert topic in scope.TOPICS, f"{intent} reads the database but is not page-gated"
        assert schema_catalog.tables_for_topics({topic}), f"{intent} maps to no tables"


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


def test_the_private_activity_tables_are_gone_from_the_catalog():
    """THE scope change, pinned at the level where it cannot be argued around.

    Saved events, join requests and president-change requests are somebody's private activity, and
    the assistant does not answer about that for anyone. They are not filtered out at answer time -
    they are absent from the allow-list, so no generated query can name them however the question
    is phrased."""
    for table in ("saved_event", "club_join_requests", "club_president_change_requests", "co_owners"):
        assert table not in schema_catalog.ALLOWED_TABLES, f"{table} is queryable again"
    document = schema_catalog.document_for_topics({"events", "clubs"})
    for table in ("saved_event", "club_join_requests"):
        assert f"TABLE {table}" not in document


def test_only_what_the_card_shows_is_describable():
    """The assistant answers from the event card and the club card. `request` carries plenty the
    card never prints - internal proposal fields, the organiser's cap, the bank details - and those
    are excluded outright rather than left to the prompt to decline."""
    columns = schema_catalog.allowed_columns()
    for column in ("goals_objectives", "expected_benefits", "promotion_publicity_method",
                   "max_pax", "bank_account_number"):
        assert column not in columns["request"], f"request.{column} is not on the card"
    # ...and the fields that ARE on it stay reachable.
    for column in ("event_title", "short_introduction", "event_visibility", "total_pax",
                   "cost_amount", "registration_approval", "event_format_snapshot"):
        assert column in columns["request"], f"request.{column} is on the card and must be readable"


def test_a_club_question_cannot_reach_event_tables():
    """Table selection is per-QUESTION, not per-app: both domains are individually in scope, but a
    club question must not be able to read event registrations."""
    club_tables = schema_catalog.tables_for_topics({"clubs"})
    assert "event_registration" not in club_tables
    assert "clubs" in club_tables


# --- the SQL guard rejects what it claims to ------------------------------------------------------

def _guest_scope():
    return scope_rules.build_scope(None, {"events"})


def _student_scope(user_id: int = 42):
    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=user_id)
    return scope_rules.build_scope(principal, {"events", "clubs"})


def _validate(sql: str, scope_, topics=("events",)):
    return sql_guard.validate(
        sql, allowed_tables=schema_catalog.tables_for_topics(set(topics)), scope=scope_
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
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT users.password FROM users", _student_scope(), topics=("clubs",))


def test_guard_rejects_a_column_the_card_does_not_show():
    """The same mechanism, applied to the scope boundary rather than to credentials: an internal
    proposal field is rejected on the bare word, so "what are this event's objectives" cannot be
    answered by reaching for a column the page never prints."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    with pytest.raises(sql_guard.SqlRejected):
        _validate(f"SELECT request.goals_objectives FROM request WHERE {predicate}", scope_)


def test_guard_rejects_an_unknown_table():
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate("SELECT x.id FROM secret_table x", _guest_scope())
    assert excinfo.value.repairable, "a wrong table name is worth one regeneration attempt"


def test_guard_rejects_an_unknown_column():
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate(
            "SELECT request.nonexistent_column FROM request WHERE "
            "request.status = 'completed_approved' AND request.event_visibility = 'Public'",
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
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    sql = f"SELECT request.event_title FROM request WHERE {predicate} LIMIT 5"
    assert _validate(sql, scope_) == sql


def test_predicate_matching_survives_reformatting():
    """The model reformatting a required predicate across lines is not a security event; matching is
    whitespace-normalised so a valid query is not rejected over layout."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    reflowed = predicate.replace(" AND ", "\n      AND\n   ")
    sql = f"SELECT request.event_title\n  FROM request\n WHERE {reflowed}"
    assert _validate(sql, scope_)


def test_guard_rejects_a_forbidden_table_outright():
    """A guest has no club access at all, so scope_rules gives those tables an EMPTY predicate tuple
    - meaning "no query may touch this", not "any predicate will do"."""
    scope_ = scope_rules.build_scope(None, {"events", "clubs"})
    assert scope_.predicates_for("clubs") == ()
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate("SELECT clubs.club_name FROM clubs", scope_, topics=("events", "clubs"))
    assert not excinfo.value.repairable, "an authorization violation must never be retried"


def test_a_guest_can_count_registrations_but_not_name_them():
    """The count is public to guests too - it is rendered on the Explore Events cards a signed-out
    visitor can already browse."""
    scope_ = _guest_scope()
    assert scope_.predicates_for("event_registration") == ("PUBLIC_COUNT_ONLY",)
    assert _validate("SELECT COUNT(*) FROM event_registration WHERE PUBLIC_COUNT_ONLY", scope_)
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT event_registration.registrant_name FROM event_registration", scope_)


# --- the scope predicates encode the app's own rules ----------------------------------------------

def test_guest_visibility_matches_the_events_endpoint():
    """Mirrors api/events.py's _GUEST_VISIBLE exactly: Public only, published only. A guest must
    never reach Internal or Private - nor 'Club Only', which is addressed to specific clubs and
    requires a membership a guest cannot have."""
    predicate = _guest_scope().predicates_for("request")[0]
    assert "completed_approved" in predicate
    assert "'Public'" in predicate
    assert "Club Only" not in predicate
    assert "Internal" not in predicate
    assert "Private" not in predicate


def test_a_signed_in_caller_gets_the_explore_events_tier_and_no_more():
    """Mirrors _INTERNAL_VISIBLE: Public and Internal, plus a Club Only event addressed to a club
    they belong to. NOT their own Private events - Explore Events does not show those either, and
    the assistant answers about the catalogue, not about anyone's private copy of it."""
    predicate = _student_scope(user_id=42).predicates_for("request")[0]
    assert "'Public', 'Internal'" in predicate
    assert "applicant_user_id" not in predicate, "the organiser's own-events branch is not the catalogue"
    assert "co_owners" not in predicate


def test_club_only_events_need_membership_not_just_a_login():
    """'Club Only' is not a tier every signed-in user can read. Being logged in is not enough: the
    predicate must resolve the asker's membership against the clubs the event actually names, or
    the assistant answers questions about events the asker cannot see in the UI."""
    predicate = _student_scope(user_id=42).predicates_for("request")[0]
    assert "'Club Only'" in predicate, "the tier is reachable - but only via membership"
    assert "request_clubs" in predicate, "the event's named audience"
    assert "club_members" in predicate, "the asker's actual membership"
    # Asserted on the ALIAS the clause defines rather than a bare `cm`, because the short names are
    # exactly the ones the outer query wants: a suggestion joins request_categories as `rc` and the
    # model then has to rename the clause's own `rc`, which used to fail the guard. Suffixed
    # aliases keep both halves collision-free.
    assert "cm_request.user_id = 42" in predicate


def test_nobody_can_read_a_row_about_anyone_but_themselves():
    """The change that took rosters out of scope, asserted as an absence of any other path.

    There is no caller - not an organiser, not a president, not an administrator - for whom either
    people-table gets a condition that returns a row about somebody ELSE. Exactly two conditions are
    permitted on each, and no third:

      PUBLIC_COUNT_ONLY               the number printed on the card, which sql_guard then proves
                                      means aggregate-and-no-identifying-columns
      <table>.user_id = <the asker>   their OWN row - the "Registered" badge on their own event
                                      card, and the flag Discover Clubs hides their own clubs by

    The second is what stops the assistant recommending somebody the club they already run. It is
    scoped to the caller's own id by construction, so it can never widen into a roster."""
    for principal in (None, _student(), _FakePrincipal((("club-admin", None),), user_id=8)):
        scope_ = scope_rules.build_scope(principal, {"events", "clubs"})
        user_id = getattr(principal, "user_id", None)
        own_row = {
            "event_registration": f"event_registration.user_id = {user_id}",
            "club_members": f"club_members.user_id = {user_id}",
        }
        for table, mine in own_row.items():
            for predicate in scope_.predicates_for(table):
                assert predicate in ("PUBLIC_COUNT_ONLY", mine), (
                    f"{table} gained a condition that is neither a public count nor the asker's "
                    f"own row: {predicate}"
                )


def test_a_guest_has_no_own_row_to_read():
    """The own-row condition needs an asker. A guest has no id, so they get the count and nothing
    else - and must never be handed a predicate with 'None' interpolated into it."""
    scope_ = scope_rules.build_scope(None, {"events", "clubs"})
    assert scope_.predicates_for("event_registration") == ("PUBLIC_COUNT_ONLY",)
    assert scope_.predicates_for("club_members") == ()
    for predicates in scope_.required_predicates.values():
        for predicate in predicates:
            assert "None" not in predicate, predicate


def test_a_guest_has_no_club_access_at_all():
    """Clubs have no public tier - Discover Clubs is an internal page - so every club table is
    forbidden, not merely filtered."""
    scope_ = scope_rules.build_scope(None, {"clubs"})
    for table in ("clubs", "club_members"):
        assert scope_.predicates_for(table) == (), f"{table} must be forbidden for a guest"


def test_scope_document_states_its_conditions_verbatim():
    """The model is given the exact text the guard will look for. If these two ever disagreed, every
    query would be rejected for a reason nobody could see."""
    scope_ = _guest_scope()
    document = scope_rules.document(scope_)
    for predicate in scope_.predicates_for("request"):
        assert predicate in document


# --- the guard cannot forbid what the guard requires ----------------------------------------------
#
# THE OUTAGE THESE COVER. Migration 029 gave 'Club Only' events a real audience, so the mandated
# `request` visibility predicate grew an EXISTS over request_clubs JOIN club_members - and neither
# table was in schema_catalog's events group. Rule 4 then forbade exactly what rule 7 demanded:
# carry the predicate and the table allow-list rejected it, drop it and the predicate check rejected
# it. Three attempts, then "I don't have that information available right now" - for EVERY event
# question from EVERY signed-in user. Only guests were spared, their visibility predicate having no
# membership branch, which is why the guest-based fixtures above never caught it.

def test_every_table_a_required_predicate_names_is_queryable():
    """A required predicate may never join through a table nobody has reasoned about.

    Stated so it cannot be satisfied trivially: a table a predicate joins through must EITHER be in
    the question's own table group, OR carry a scope entry of its own - a predicate saying which of
    its rows may be read, or an empty tuple forbidding it."""
    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=42)
    for topics in ({"events"}, {"clubs"}, {"events", "clubs"}):
        for caller in (None, principal):
            scope_ = scope_rules.build_scope(caller, topics)
            in_group = {t.lower() for t in schema_catalog.tables_for_topics(topics)}
            declared = {t.lower() for t in scope_.required_predicates}
            for table, predicates in scope_.required_predicates.items():
                for predicate in predicates:
                    for named in sql_guard._TABLE_REF.findall(predicate):
                        assert named.lower() in in_group or named.lower() in declared, (
                            f"the '{table}' predicate joins '{named}', which for {sorted(topics)} "
                            "is neither queryable nor scoped - no query can satisfy rule 4 and rule 7"
                        )


def test_the_guard_accepts_the_event_queries_the_model_actually_writes():
    """Three shapes, all rejected in production, all correct SQL.

    The third is the subtle one: the predicate declares `FROM request_clubs rc_request`, and a
    suggestion joins request_categories - naturally aliased `rc` - so the model must rename the
    inner alias to keep the SQL valid. Rule 7 used to expand the PREDICATE's aliases using the
    QUERY's map, turning its `rc.` into request_categories, and rejected a query reading exactly the
    right tables. It now compares real table names on both sides."""
    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=1065)
    scope_ = scope_rules.build_scope(principal, {"events"})
    predicate = scope_.predicates_for("request")[0]

    # 1. plain, unaliased
    assert _validate(
        "SELECT request.event_title AS t, request.short_introduction AS about FROM request "
        f"WHERE ({predicate}) LIMIT 20",
        scope_,
    )
    # 2. the model aliases the outer tables
    assert _validate(
        "SELECT r.event_title AS t, es.date AS d FROM request r JOIN event_schedule es "
        f"ON es.request_id = r.request_id WHERE ({predicate}) LIMIT 20",
        scope_,
    )
    # 3. the model renames the predicate's OWN alias, because `rc` is taken
    renamed = predicate.replace("rc_request", "rc_sub").replace("cm_request", "cm_alt")
    assert renamed != predicate, "expected the clause to declare aliases of its own"
    assert _validate(
        "SELECT request.event_title AS t, rc.category_name AS cat FROM request "
        "LEFT JOIN request_categories rc ON request.request_id = rc.request_id "
        f"WHERE {renamed} LIMIT 20",
        scope_,
    )


def test_the_event_audience_tables_grant_no_rows():
    """Admitting a table to the allow-list must not admit its ROWS.

    request_clubs and club_members are reachable from an events question ONLY because the visibility
    condition joins through them, so each carries a condition of its own: the audience only as part
    of a request already carrying its own condition, membership only as the asker's own row or a
    bare count. Otherwise fixing the outage would have opened who-is-in-which-club to every events
    question. A guest, whose predicate has no membership branch at all, is refused both outright."""
    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=42)
    scope_ = scope_rules.build_scope(principal, {"events"})
    assert scope_.predicates_for("club_members") == ("club_members.user_id = 42", "PUBLIC_COUNT_ONLY")

    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT club_members.user_id AS m FROM club_members WHERE club_members.club_id = 3",
            scope_,
        )
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT request_clubs.club_name AS c FROM request_clubs LIMIT 20", scope_)

    guest = _guest_scope()
    assert guest.predicates_for("request_clubs") == ()
    assert guest.predicates_for("club_members") == ()
    for table in ("request_clubs", "club_members"):
        with pytest.raises(sql_guard.SqlRejected):
            _validate(f"SELECT {table}.club_id AS c FROM {table} LIMIT 5", guest)


def test_an_empty_catalogue_search_is_a_real_zero():
    """Nothing the assistant reads is narrowed to one person any more, so "no rows" has exactly one
    meaning: there are none. Reporting it as an access problem instead - which the old scoped-empty
    branch did whenever the visibility clause dragged a personal table in - turned "what's on this
    month" into "I can't see that information"."""
    from app.ai.sql_runner import rows_to_document

    principal = _FakePrincipal((("student", _representative_unit("student")),), user_id=1065)
    scope_ = scope_rules.build_scope(principal, {"events"})
    browse = (
        "SELECT r.event_title AS t FROM request r JOIN event_schedule es "
        f"ON es.request_id = r.request_id WHERE ({scope_.predicates_for('request')[0]})"
    )
    empty = rows_to_document([], sql=browse, scope=scope_)
    assert "real, final, correct answer" in empty
    assert "lack access" not in empty.lower().split("do not say")[0]


def test_the_prompts_only_name_columns_that_exist():
    """`request` has short_introduction, not description. Both the topical-search rule and the
    suggestion rule once asked for `description` by name - a rejected query, one of only three
    attempts spent, and on a suggestion a shortlist with titles and no blurb to reason from."""
    import inspect

    from app.ai import sql_llm, text_to_sql as t2s

    columns = schema_catalog.allowed_columns()
    assert "short_introduction" in columns["request"]
    assert "description" not in columns["request"], "request grew a `description` - revisit the prompts"
    assert "description" in columns["clubs"]

    assert "request.short_introduction" in sql_llm._SQL_SYSTEM_INSTRUCTION
    assert "`request` has NO column of that name" in sql_llm._SQL_SYSTEM_INSTRUCTION
    assert "request.short_introduction for events" in inspect.getsource(t2s.run)


# --- the assistant's own boundary, stated in its prompts ------------------------------------------

def test_the_system_prompt_names_the_seven_capabilities_and_no_more():
    """The prompt is the last line of defence when a question slips past classification. It must
    describe the same seven things scope.py does, and must name the refusals explicitly - a generic
    "stay in scope" is what let "who registered for this?" be attempted."""
    from app.ai.gemini import _SYSTEM_INSTRUCTION

    assert "WHAT YOU DO. Exactly seven things" in _SYSTEM_INSTRUCTION
    for refusal in ("who registered for an event", "who joined a club", "approval workflows",
                    "analytics, reports", "general knowledge"):
        assert refusal in _SYSTEM_INSTRUCTION, f"the prompt does not name {refusal!r} as out of scope"
    assert "THE CARD IS THE CEILING" in _SYSTEM_INSTRUCTION


def test_the_asker_s_own_badge_is_inside_the_ceiling_and_their_lists_are_not():
    """THE line, and it has to read the same in all three prompts that state it.

    The card shows its viewer "Registered" / "Pending Approval", and Discover Clubs hides the clubs
    they are already in - so whether THEY are in a particular club or event is card data. Whether
    anyone else is, is not; and "what am I registered for" is the My Events PAGE, a list rather than
    a card flag, so it stays out.

    Getting this inconsistent is not hypothetical: the three prompts disagreed, and the assistant
    volunteered "you're already a member of the APU Coding Society" while refusing to answer "am I
    in the APU Coding Society?" one question later."""
    from app.ai.gemini import _SYSTEM_INSTRUCTION
    from app.ai.query_router import INTENT_DESCRIPTIONS

    # The answering prompt permits the badge and excludes the list.
    assert "THE ASKER'S OWN BADGE IS ON THE CARD TOO" in _SYSTEM_INSTRUCTION
    assert "anybody ELSE's membership" in _SYSTEM_INSTRUCTION
    assert "which clubs am I in" in _SYSTEM_INSTRUCTION

    # The intent vocabulary routes the singular question to the card's own intent, and says plainly
    # that the plural one is not routed anywhere.
    assert "AM I REGISTERED FOR <this event>?" in INTENT_DESCRIPTIONS["event_info"]
    assert "AM I IN <this club>?" in INTENT_DESCRIPTIONS["club_info"]
    for description in (INTENT_DESCRIPTIONS["event_info"], INTENT_DESCRIPTIONS["club_info"]):
        assert "out of scope" in description, "the list half of the line must be stated too"
    # ...and "who am I" must not swallow it, which is what it did before.
    assert "am I in <a named club>" in INTENT_DESCRIPTIONS["who_am_i"]


def test_the_own_row_condition_is_scoped_to_the_asker_and_nothing_else():
    """The predicate that makes the badge readable is the narrowest thing that can work: one
    equality against the caller's own id, interpolated from the authenticated principal. It can
    never widen into a roster, because there is no other row it matches."""
    scope_ = _student_scope(user_id=42)
    assert "event_registration.user_id = 42" in scope_.predicates_for("event_registration")
    assert "club_members.user_id = 42" in scope_.predicates_for("club_members")
    for table in ("event_registration", "club_members"):
        for predicate in scope_.predicates_for(table):
            assert predicate == "PUBLIC_COUNT_ONLY" or predicate.endswith("= 42"), predicate


def test_both_prompts_hold_the_card_ceiling():
    """The knowledge path and the data path answer different questions from different context, so
    the ceiling has to be stated in both - a rule present in one prompt is a rule absent whenever
    the other is used."""
    from app.ai.gemini import _SYSTEM_INSTRUCTION
    from app.ai.sql_llm import _SQL_ANSWER_SYSTEM_INSTRUCTION

    for prompt in (_SYSTEM_INSTRUCTION, _SQL_ANSWER_SYSTEM_INSTRUCTION):
        assert "CARD IS THE CEILING" in prompt


def test_the_prompt_keeps_the_conversation_subject():
    """"Suggest an event" then "when is it?" is the whole of the memory requirement. The prompt must
    say the subject carries forward, and must say it moves when the asker changes topic - a sticky
    subject is as wrong as no subject."""
    from app.ai.gemini import _SYSTEM_INSTRUCTION

    assert "KEEP THE SUBJECT until they change it" in _SYSTEM_INSTRUCTION
    assert "NEVER ASK SOMETHING YOU HAVE ALREADY BEEN TOLD" in _SYSTEM_INSTRUCTION


def test_the_sql_prompt_refuses_a_roster_rather_than_attempting_one():
    """There is no permission tier that unlocks a roster, so the generation prompt must say
    IMPOSSIBLE rather than trying and being rejected by the guard three times over."""
    from app.ai.sql_llm import _SQL_SYSTEM_INSTRUCTION

    assert "There is no query for \"who registered\"" in _SQL_SYSTEM_INSTRUCTION
    assert "Return IMPOSSIBLE" in _SQL_SYSTEM_INSTRUCTION


# --- the Gemini key chain is however many keys the environment carries ----------------------------

def test_the_failover_chain_reads_every_numbered_key(monkeypatch):
    """A third key must need an .env line and nothing else. The chain used to be two named fields,
    so GEMINI_API_KEY_3 would have sat in .env doing nothing, silently."""
    from app.config import config

    for name in ("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEY_4"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "one")
    monkeypatch.setenv("GEMINI_API_KEY_2", "two")
    monkeypatch.setenv("GEMINI_API_KEY_3", "three")
    assert config.gemini_api_keys == ("one", "two", "three")

    # A GAP stops the scan, so a commented-out _3 cannot silently orphan a live _4...
    monkeypatch.delenv("GEMINI_API_KEY_3")
    monkeypatch.setenv("GEMINI_API_KEY_4", "four")
    assert config.gemini_api_keys == ("one", "two")

    # ...while a DUPLICATE is merely dropped - one exhausted quota is not a failover - not a gap.
    monkeypatch.setenv("GEMINI_API_KEY_3", "one")
    assert config.gemini_api_keys == ("one", "two", "four")


def test_failover_walks_the_chain_on_a_429_and_only_on_a_429(monkeypatch):
    """It tries every remaining key, sticks to the working one for the rest of the process, and does
    NOT burn the chain on a 503 - that is the model being busy rather than the key being spent, so
    it would fail identically on every key and turn one slow request into N."""
    from google.genai import errors as genai_errors

    from app.ai import gemini

    class _Key:
        def __init__(self, name, error=None):
            self.name, self.error, self.calls = name, error, 0

        @property
        def models(self):
            owner = self

            class _Models:
                def generate_content(self, **_):
                    owner.calls += 1
                    if owner.error:
                        raise owner.error
                    return owner.name

            return _Models()

    def _quota():
        return genai_errors.ClientError(429, {"error": {"message": "quota"}})

    chain = [_Key("k1", _quota()), _Key("k2", _quota()), _Key("k3")]
    monkeypatch.setattr(gemini, "_generation_clients_cache", chain)
    monkeypatch.setattr(gemini, "_active_generation_client_index", 0)
    assert gemini._generate_content() == "k3"
    assert gemini._active_generation_client_index == 2, "the working key becomes the default"
    assert gemini._generate_content() == "k3"
    assert chain[0].calls == 1, "the exhausted key must not be retried on every later call"

    # A busy MODEL is retried once on the same key and never spends the chain. Two consecutive turns
    # of a real conversation died on a 503 because nothing retried it.
    monkeypatch.setattr(gemini, "_BUSY_RETRY_DELAY_SECONDS", 0)
    busy = genai_errors.ServerError(503, {"error": {"message": "high demand"}})
    chain = [_Key("k1", busy), _Key("k2"), _Key("k3")]
    monkeypatch.setattr(gemini, "_generation_clients_cache", chain)
    monkeypatch.setattr(gemini, "_active_generation_client_index", 0)
    with pytest.raises(Exception):
        gemini._generate_content()
    assert [k.calls for k in chain] == [2, 0, 0], "one retry on this key, and no key after it"


# --- nothing imports a module the refactor removed -------------------------------------------------

def test_no_module_imports_a_deleted_module():
    """The vector store and its retrieval layer are gone, and so are the modules the narrowed scope
    retired: the role-capability knowledge base, the third-party privacy check, the name lookup it
    fed, and the admin analytics retrieval. An import left behind is an ImportError at request time,
    not at test time, unless something asserts it here."""
    import app.ai.classifier as classifier_module
    import app.ai.text_to_sql as tts_module
    import app.api.ai as ai_module

    banned = ("ai_db", "club_retrieval", "knowledge_base", "subject_scope", "name_lookup",
              "admin_retrieval", "from .sync", "from .retrieval", "from .backfill")
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


def test_the_retired_modules_are_actually_gone():
    """Deleted, not merely unimported. A file left on disk is a file the next person wires back in."""
    import os.path

    from app.config import config

    assert not hasattr(config, "ai_database_url")
    ai_dir = os.path.dirname(__import__("app.ai", fromlist=["_"]).__file__)
    removed = ("ai_db.py", "sync.py", "backfill.py", "retrieval.py", "club_retrieval.py",
               "knowledge_base.py", "subject_scope.py", "name_lookup.py", "admin_retrieval.py")
    for name in removed:
        assert not os.path.exists(os.path.join(ai_dir, name)), f"{name} should have been deleted"


# --- the users table cannot be enumerated ---------------------------------------------------------
# Regression tests for a real hole found by smoke-testing the finished pipeline: `users` had no
# required predicate, on the reasoning that it is "only ever joined".

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
    scope_ = _student_scope() if signed_in else _guest_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate(sql, scope_, topics=("events", "clubs") if signed_in else ("events",))


def test_email_is_never_readable():
    """No supported question needs anyone's email - a name is always the answer, and the asker's own
    address is already in the prompt as authenticated context. Excluding the column outright is a
    stronger guarantee than instructing the model not to select it."""
    assert "email" in schema_catalog.EXCLUDED_COLUMNS["users"]
    assert "email" not in schema_catalog.allowed_columns()["users"]


def test_a_name_can_still_be_resolved_through_an_authorised_row():
    """The guard must stop enumeration WITHOUT breaking the ordinary question it was never meant to
    touch. "Who organises this event" joins users to an event the caller may already see, and that
    join is itself the required condition."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title, users.full_name FROM request "
        "JOIN users ON users.user_id = request.applicant_user_id "
        f"WHERE {predicate}"
    )
    assert _validate(sql, scope_)


def test_users_joins_are_offered_only_for_reachable_tables():
    """Advertising a club join in an events-only question would hand the model a route the table
    allow-list then rejects - a guaranteed wasted regeneration round trip."""
    events_only = scope_rules.build_scope(None, {"events"})
    assert all("clubs" not in p for p in events_only.predicates_for("users"))


def test_no_scope_predicate_reads_an_excluded_column():
    """A required condition that reads an excluded column would be rejected by the guard on the bare
    word - making every valid query unrunnable, since the condition is mandatory."""
    scope_ = _student_scope()
    for table, predicates in scope_.required_predicates.items():
        for predicate in predicates:
            for column in schema_catalog.EXCLUDED_COLUMNS.get("users", ()):
                assert f"users.{column}" not in predicate, f"{table} predicate reads users.{column}"
            assert "FROM users" not in predicate, f"{table} predicate sub-selects from users"


# --- string literals are not identifiers ----------------------------------------------------------

def test_a_dotted_string_literal_is_not_read_as_a_column():
    """Regression: the column rule read `'student.computing@demo.apu.edu.my'` as student.computing
    and rejected the query for a column "computing" on table "student". Two of the first real
    questions put through the pipeline burned all three retry attempts on this."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title FROM request "
        f"WHERE {predicate} AND request.applicant_email = 'student.computing@demo.apu.edu.my'"
    )
    assert _validate(sql, scope_)


def test_a_table_name_inside_a_literal_does_not_demand_a_predicate():
    """The other half of the same rule: a table NAME mentioned in a string must not make the guard
    demand that table's access condition for a query that never reads it."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    sql = (f"SELECT request.event_title FROM request WHERE {predicate} "
           "AND request.event_title LIKE '%club_members%'")
    assert _validate(sql, scope_)


def test_a_write_keyword_inside_a_literal_is_still_rejected():
    """The keyword rule deliberately keeps seeing literals. Nothing legitimate hides DROP TABLE in a
    string, so rejecting it costs nothing and closes an obvious evasion."""
    scope_ = _guest_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT request.event_title FROM request WHERE request.event_title = 'DROP TABLE users'",
            scope_,
        )


# --- aliases -------------------------------------------------------------------------------------
# Required predicates are written with real table names, but models naturally alias.

def test_an_aliased_query_still_satisfies_its_predicate():
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    aliased = (predicate.replace("request.request_id", "r.request_id")
                        .replace("request.status", "r.status")
                        .replace("request.event_visibility", "r.event_visibility"))
    sql = f"SELECT r.event_title FROM request r WHERE {aliased}"
    assert _validate(sql, scope_), "aliasing a table must not be read as omitting its access condition"


def test_aliasing_does_not_let_a_query_skip_its_predicate():
    """The other direction: expansion must not become a way to look like you satisfied a condition
    you never wrote."""
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT r.event_title FROM request r", _guest_scope())


def test_an_aliased_users_dump_is_still_rejected():
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT u.full_name FROM users u", _student_scope(), topics=("events", "clubs"))


# --- a resolved how-to answers from its definition, not the database -------------------------------

@pytest.mark.parametrize(
    "question,function_key",
    [
        ("how do I join a club", "join_club"),
        ("how do I register for an event", "register_event"),
        ("how do I submit an event proposal", "submit_proposal"),
    ],
)
def test_a_resolved_how_to_drops_incidental_data_intents(question: str, function_key: str):
    """THE regression test. "How do I join a club" names clubs, so a reading of {how_to, club_info}
    is defensible - and the endpoint routes to the retrieval path whenever any data intent is
    present, so the asker got a LIST OF CLUBS instead of the instructions they asked for. Observed
    exactly that way through the finished endpoint.

    Asserts the deterministic suppression, not the model: this calls the pure function directly, so
    it tests the backstop rather than whether the prompt happened to be obeyed on the day."""
    from app.ai.classifier import Reading, _suppress_incidental_data_intents

    assert scope.function_named(question) == function_key
    reading = Reading(intents=frozenset({"how_to", "club_info", "event_info"}))
    assert _suppress_incidental_data_intents(question, reading).intents == frozenset({"how_to"})


def test_a_resolved_page_question_drops_incidental_data_intents():
    """The same backstop for "what is Explore Events for", which made a structural question depend
    on data access - the identical question returned a description for a guest and a flat refusal
    for a visitor account, when neither should have touched an event row."""
    from app.ai.classifier import Reading, _suppress_incidental_data_intents

    question = "what is Explore Events for"
    reading = Reading(intents=frozenset({"page_purpose", "event_info"}))
    assert _suppress_incidental_data_intents(question, reading).intents == frozenset({"page_purpose"})


def test_a_generic_how_to_keeps_its_data_intents():
    """The guard on the guard: only a RESOLVED function is confidently procedural. "How does the
    approval process work" has no steps behind it, so its data intents are the only thing that could
    answer it and must survive."""
    from app.ai.classifier import Reading, _suppress_incidental_data_intents

    question = "how does the approval process work"
    assert scope.function_named(question) is None
    reading = Reading(intents=frozenset({"how_to", "event_info"}))
    assert _suppress_incidental_data_intents(question, reading).intents == frozenset({"how_to", "event_info"})


def test_suppression_never_empties_the_intent_set():
    """Dropping every intent would send a real how-to down the out-of-scope path - refused and
    logged as unsupported, which is the opposite of the intent."""
    from app.ai.classifier import Reading, _suppress_incidental_data_intents

    reading = Reading(intents=frozenset({"how_to"}))
    assert _suppress_incidental_data_intents("how do I join a club", reading).intents == frozenset({"how_to"})


# --- a predicate that is present but inert -------------------------------------------------------
# Rule 7 is a textual check: it proves the required condition is THERE, not that it BITES.

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
    scope_ = _guest_scope()
    sql = template.format(pred=scope_.predicates_for("request")[0])
    with pytest.raises(sql_guard.SqlRejected) as excinfo:
        _validate(sql, scope_)
    assert not excinfo.value.repairable, (
        "defeating an access condition is an authorization violation, not a mistake to retry"
    )


def test_ordinary_queries_are_not_caught_by_the_neutralisation_rules():
    """The rules must not become a tax on normal SQL - a date comparison, a join and a LIMIT are what
    almost every real query looks like."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    sql = (
        "SELECT request.event_title, event_schedule.date FROM request "
        "JOIN event_schedule ON event_schedule.request_id = request.request_id "
        f"WHERE {predicate} AND event_schedule.date >= CURRENT_DATE "
        "ORDER BY event_schedule.date LIMIT 10"
    )
    assert _validate(sql, scope_)


def test_a_union_cannot_smuggle_in_another_table():
    """UNION is the classic way to append a second result set. It does not escape rule 7: the second
    branch reads `users`, and users has its own required condition."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            f"SELECT request.event_title FROM request WHERE {predicate} "
            "UNION SELECT users.full_name FROM users",
            scope_,
        )


def test_a_scalar_subquery_cannot_leak_another_table():
    """A subselect in the column list is still a read of that table, and is checked as one."""
    scope_ = _guest_scope()
    predicate = scope_.predicates_for("request")[0]
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT request.event_title, (SELECT users.full_name FROM users LIMIT 1) "
            f"FROM request WHERE {predicate}",
            scope_,
        )


# --- suggestions ask before they suggest ----------------------------------------------------------
# From a real session: "can u suggest event for me" returned five events, no reason, no question, and
# the same five for every asker.

class _Reading:
    """The three fields recommendation.stage_for reads. Built by hand rather than by calling the
    model, so this tests the flow rather than the weather."""

    def __init__(self, domain, preferences=None):
        self.domain = domain
        self.preferences = preferences


def test_a_first_suggestion_request_asks_about_interests():
    """Nobody has said what they like, so there is nothing to suggest FROM. The question is the
    entire reply."""
    assert recommendation.stage_for(_Reading("events")) == recommendation.ASK
    assert recommendation.stage_for(_Reading("clubs")) == recommendation.ASK


def test_a_suggestion_naming_neither_domain_asks_which():
    """"What can you suggest for me" names neither events nor clubs. The old behaviour guessed
    events and committed silently."""
    assert recommendation.stage_for(_Reading(None)) == recommendation.CLARIFY


def test_stated_preferences_skip_the_question():
    """Once they have said what they are after - in this turn or four turns ago - asking again is not
    listening. This is why preferences are accumulated across the whole conversation rather than
    re-derived from the assistant's own last sentence."""
    reading = _Reading("events", preferences="likes competitive tech events, free, this month")
    assert recommendation.stage_for(reading) == recommendation.RECOMMEND


def test_a_suggestion_is_a_shortlist():
    """A suggestion is a shortlist with reasons; a list of nine is a search result."""
    assert recommendation.MAX_SUGGESTIONS <= 3
    document = recommendation.recommend_document("events", "likes sport")
    assert "AT MOST 3" in document
    assert "likes sport" in document, "what they told you must reach the answering step"
    assert "NEVER INVENT A REASON" in document


def test_the_ask_turn_forbids_a_preview():
    """"But here are a few anyway" is how the ask-first flow quietly stops existing."""
    document = recommendation.ask_document("clubs")
    assert "ENTIRE REPLY" in document
    assert "no list" in document.lower()
    assert "here are a few anyway" in document.lower()


# --- cards are built for what the answer NAMES ----------------------------------------------------

def test_two_events_sharing_a_title_card_the_upcoming_one():
    """A card must not contradict the sentence above it.

    Titles are not unique: two published events are both called "APU Hackathon 2026", on 25 September
    and 10 June. The title map was a dict comprehension, so one silently overwrote the other - and
    with no ORDER BY in the query, which one won was whatever the database returned last. The
    assistant correctly suggested the September event and the card under it read 10 June, an event
    already past that the reply had never mentioned; clicking it opened the wrong one."""
    from datetime import date

    today = date(2026, 9, 1)
    rows = [
        {"request_id": 4471, "event_title": "APU Hackathon 2026", "firstDate": "2026-06-10"},
        {"request_id": 4272, "event_title": "APU Hackathon 2026", "firstDate": "2026-09-25"},
        {"request_id": 9, "event_title": "Never Scheduled", "firstDate": None},
    ]
    assert cards._best_row_per_title(rows)["APU Hackathon 2026"] == 4272
    # Order of arrival must not decide it - that was the whole defect.
    assert cards._best_row_per_title(list(reversed(rows)))["APU Hackathon 2026"] == 4272
    # All occurrences past: the most recent one is the least wrong card to show.
    past = [
        {"request_id": 1, "event_title": "Old Thing", "firstDate": "2026-01-05"},
        {"request_id": 2, "event_title": "Old Thing", "firstDate": "2026-04-05"},
    ]
    assert cards._best_row_per_title(past)["Old Thing"] == 2
    assert cards._occurrence_rank(rows[2], today)[0] == 2, "an unscheduled row sorts last"


def test_cards_match_only_what_the_answer_names():
    """A query returns rows the reply never mentions - the model was given twenty events and picked
    three. Carding all twenty would put seventeen cards under an answer that never brought them up."""
    titles = {"Annual Hackathon Kickoff": 1, "APU Cultural Night": 2, "Case Competition Finals": 3}
    assert cards._names_in("The Annual Hackathon Kickoff would suit you.", titles) == [1]


def test_a_one_character_title_never_matches():
    """The seed data contains a club literally named "1", which would otherwise match the digit in
    every date and time in a reply."""
    assert cards._names_in("It runs on 1 October at 1pm", {"1": 99}) == []


def test_a_longer_title_wins_over_a_substring():
    """Longest-first matching, so a club named "Coding" does not swallow "APU Coding Society"."""
    assert cards._names_in("Try the APU Coding Society.", {"APU Coding Society": 1, "Coding": 2})[0] == 1


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("The Annual Tech Symposium has 150 people signed up.", [7]),
        ("Try the Annual Tech Symposium!", [7]),        # trailing punctuation
        ("Check out Annual  Tech   Symposium.", [7]),    # collapsed whitespace
        ("APUs Hackathon is on Friday.", [8]),           # apostrophe dropped by the model
        ("APU's Hackathon is on Friday.", [8]),          # apostrophe kept
    ],
)
def test_a_card_is_built_however_the_model_punctuates_the_title(answer: str, expected: list[int]):
    """A correct answer naming a real event was decorated with a page link instead of that event's
    own card. The match required the reply to reproduce every apostrophe, hyphen and run of spaces
    exactly as stored, which models do not do - and a word-boundary anchor is undefined next to a
    non-word character, so a title ending in "!" or ")" could never match at all."""
    assert cards._names_in(answer, {"Annual Tech Symposium": 7, "APU's Hackathon": 8}) == expected


def test_cards_are_built_only_for_the_topic_asked_about():
    """A club answer must not sprout event cards because it happened to mention a word that matches
    an event title."""
    events, clubs = cards.build("nothing in particular", {"clubs"}, user_id=None)
    assert events == []


# --- navigation cards for location questions ------------------------------------------------------

def test_topic_cards_respect_page_visibility(monkeypatch):
    """A location answer - "where do I find events" - is prose with nothing to click otherwise. The
    card must still come from the same grant check."""
    principal = _student()
    assert topic_access.topic_cards(principal, {"events"}), "expected a card while granted"

    real = identity.has_page_access
    monkeypatch.setattr(identity, "has_page_access", lambda a, page_code: False)
    assert topic_access.topic_cards(principal, {"events"}) == []
    monkeypatch.setattr(identity, "has_page_access", real)


def test_topic_cards_are_capped():
    assert len(topic_access.topic_cards(_student(), {"events", "clubs"})) <= 2


# --- registration and membership COUNTS are public; identities are not ----------------------------
# The whole event_registration table was originally treated as private, so "how many people
# registered for the hackathon" answered 0 for a caller who organises nothing - while Explore Events
# displayed "5 registered" on that event's own card, to that same user.

def _cafeteria_manager_scope(topics=("events",)):
    """A caller who organises nothing and has registered for nothing. Every registration row is
    outside any private scope, so only the public count exemption can answer a count question."""
    class _P:
        user_id = 7
        full_name = "Siti Aminah"
        email = "cafeteria.manager@demo.apu.edu.my"
        assignments = (("cafeteria-manager", "cafeteria__atrium_cafeteria"),)

        def has_role(self, *codes):
            return "cafeteria-manager" in codes

    return scope_rules.build_scope(_P(), set(topics))


def test_a_public_count_query_is_allowed():
    scope_ = _cafeteria_manager_scope()
    sql = (
        "SELECT COUNT(event_registration.event_registration_id) FROM event_registration "
        "WHERE PUBLIC_COUNT_ONLY"
    )
    assert _validate(sql, scope_)


@pytest.mark.parametrize(
    "column",
    ["registrant_name", "registrant_email", "reason_for_attending", "payment_status"],
)
def test_the_count_exemption_cannot_return_identities(column: str):
    """The marker must not become a way to read the attendee list. A predicate is a row filter and
    cannot express "aggregate but do not project", so the guard enforces the column half."""
    scope_ = _cafeteria_manager_scope()
    sql = f"SELECT COUNT(*), event_registration.{column} FROM event_registration WHERE PUBLIC_COUNT_ONLY"
    with pytest.raises(sql_guard.SqlRejected):
        _validate(sql, scope_)


def test_the_count_exemption_requires_an_aggregate():
    scope_ = _cafeteria_manager_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate(
            "SELECT event_registration.request_id FROM event_registration WHERE PUBLIC_COUNT_ONLY",
            scope_,
        )


def test_a_roster_read_without_the_marker_is_refused():
    """And there is no marker-free path either: the marker is the table's ONLY condition, so a
    roster read fails whether or not it carries one."""
    scope_ = _cafeteria_manager_scope()
    with pytest.raises(sql_guard.SqlRejected):
        _validate("SELECT event_registration.registrant_name FROM event_registration", scope_)


def test_the_marker_is_stripped_before_execution():
    """PUBLIC_COUNT_ONLY is an instruction to the guard, not SQL - Postgres has no idea what it
    means, so it is rewritten to TRUE once the guard has proved the claim was honest."""
    from app.ai.sql_runner import _strip_markers

    stripped = _strip_markers("SELECT COUNT(*) FROM event_registration WHERE PUBLIC_COUNT_ONLY")
    assert "PUBLIC_COUNT_ONLY" not in stripped
    assert "TRUE" in stripped


# --- a refusal says what is true, and offers nothing false ----------------------------------------

def test_no_refusal_document_invites_a_rephrasing():
    """"Could you try rephrasing your question or asking about something more specific?" is honest
    advice only when the wording was the problem. For "who is the head of logistics" it never was -
    the app holds no org chart, so no phrasing has an answer - and the asker rephrased, hit the same
    wall, and rephrased again. Every refusal document now forbids the invitation rather than issuing
    it, so the words may still appear, but only as a prohibition aimed at the model."""
    documents = (
        topic_access.unanswerable_document(),
        topic_access.out_of_scope_document(None),
        topic_access.out_of_scope_document(_FakePrincipal((("external-user", None),), is_external=True)),
        topic_access.out_of_scope_document(_student()),
        scope.unknown_function_document(_student()),
    )
    for document in documents:
        lowered = document.lower()
        for phrase in ("rephras", "reword", "more specific"):
            if phrase in lowered:
                prohibition = lowered.split(phrase)[0].rsplit(".", 1)[-1]
                assert "do not" in prohibition or "never" in prohibition, (
                    f"{phrase!r} reads as advice to the asker, not a prohibition: {document}"
                )


def test_an_out_of_scope_refusal_is_not_dressed_up_as_a_permission_problem():
    """The distinction the narrowed scope makes load-bearing. "Who registered for this event" is not
    gated - no grant unlocks it - so blaming permissions sends the asker to request something that
    does not exist, and implying a retry might work sends them round a loop."""
    document = topic_access.out_of_scope_document(_student())
    assert "Not blocked, not a permissions problem" in document
    assert "administrator" not in document.lower()


# --- a greeting is written, not assembled ---------------------------------------------------------

def test_the_greeting_prompt_hands_the_model_no_sentence_to_copy():
    """Every "hey" came back as the same sentence because the prompt contained a ready-made one -
    "need a hand with clubs or events?" - in quotes, and generation ran near-greedy. A model given a
    phrase at a low temperature will reuse it, so the fix is both halves: no copyable phrase, and
    room to vary. Without the first, the second only reshuffles the same words."""
    from app.ai.gemini import _SYSTEM_INSTRUCTION

    assert "need a hand with clubs" not in _SYSTEM_INSTRUCTION
    assert "WRITE A DIFFERENT GREETING EVERY TIME" in _SYSTEM_INSTRUCTION


def test_a_greeting_samples_hotter_than_a_fact():
    """A greeting has no retrieved fact in it to distort, so it can afford the variation. Anything
    that restates data must not - creative variation there is called a hallucination."""
    from app.ai.gemini import FACTUAL_TEMPERATURE, GREETING_TEMPERATURE

    assert GREETING_TEMPERATURE > FACTUAL_TEMPERATURE
    assert FACTUAL_TEMPERATURE <= 0.3


def test_the_greeting_hint_names_topics_without_supplying_wording(monkeypatch):
    """The hint's job is to say which topics are safe to mention, computed live from page access. It
    must not hand over a sentence - that is what produced the identical reply in the first place -
    and it must still refuse to offer a topic the asker would then be denied."""
    principal = _student()
    hint = topic_access.greeting_hint_document(principal)
    assert "Word the reply differently" in hint

    real = identity.has_page_access
    monkeypatch.setattr(identity, "has_page_access", lambda a, page_code: False)
    starved = topic_access.greeting_hint_document(principal)
    assert "neither clubs nor events" in starved
    monkeypatch.setattr(identity, "has_page_access", real)


# --- the opening suggestion cards offer only answerable questions ---------------------------------

def test_every_suggestion_card_is_a_question_the_assistant_answers(monkeypatch):
    """The catalogue used to offer proposal tracking, cafeteria menus and registrant lists - none of
    which the assistant does any more. A card is a promise, and an unanswerable one is a broken
    promise made before the conversation has even started."""
    from app.ai.suggestions import CATALOGUE

    forbidden = ("who registered", "registrants", "my inbox", "proposal", "cafeteria", "report",
                 "page visibility", "refused")
    for card in CATALOGUE:
        lowered = card.prompt.lower()
        for word in forbidden:
            assert word not in lowered, f"card {card.title!r} asks something out of scope: {card.prompt}"


def test_a_suggestion_card_is_released_by_the_page_that_answers_it(monkeypatch):
    """The same grant check that releases the answer. Revoking Discover Clubs must take the club
    cards with it, or the panel offers a question the next click refuses."""
    from app.ai.suggestions import suggestions_for

    principal = _student()
    granted = {card["prompt"] for card in suggestions_for(principal, limit=20)}
    assert "Suggest a club for me." in granted

    real = identity.has_page_access
    monkeypatch.setattr(
        identity, "has_page_access",
        lambda a, page_code: False if page_code == "clubs-discover" else real(a, page_code),
    )
    revoked = {card["prompt"] for card in suggestions_for(principal, limit=20)}
    assert "Suggest a club for me." not in revoked
    monkeypatch.setattr(identity, "has_page_access", real)


def test_the_suggestion_panel_is_never_empty():
    """An account that reaches nothing still opens the panel on something real to click, because a
    page explanation and a how-to have an answer for everyone."""
    from app.ai.suggestions import suggestions_for

    assert suggestions_for(None)
