"""The scope DEFINITION (app/ai/scope.py): the page and function knowledge bases, who may ask what,
and how each refusal is worded.

The assistant does seven things and declines everything else. The two knowledge bases behind that -
PAGES and FUNCTIONS - are hand-written, and a hand-written table's failure mode is silence: a
function pointing at a page that does not exist fails closed and narrows itself to nobody, forever,
with no error anywhere. Most of this file is that class of check.

The rest pins shut the defects the 2026-09-01 role sweep found, all of them one table disagreeing
with another:

  - The external account was told it had no assigned roles and should contact an administrator, for
    every question including ones about the landing-page sections it was reading - and was then
    handed working instructions for saving an event.
  - The guest was told it had "no access to a personal calendar" while the public Event Calendar
    was on screen, and advised to contact an administrator about an account it does not have.
  - A capability was offered and then refused one question later, because the sentence promising it
    and the gate refusing it were maintained separately.

tests/test_ai_scope.py covers the ENFORCEMENT layers (the SQL guard, the row predicates, the page
gate itself); this file covers the definition those layers read.

Runs against the real seeded database, like tests/test_ai_scope.py.
"""
from __future__ import annotations

import pytest

from app.ai import scope, topic_access
from app.db import query


def _live_pages() -> set[str]:
    return {row["page_code"] for row in query("SELECT page_code FROM nav_page")}


def _representative_unit(role_code: str) -> str | None:
    """A unit this role can legally be paired with, or None for a flat role - a unit-scoped role
    checked with unit_code=None fails every unit_role grant and wrongly looks access-less."""
    rows = query("SELECT unit_code FROM role_unit WHERE role_code = %s ORDER BY unit_code LIMIT 1", (role_code,))
    return rows[0]["unit_code"] if rows else None


class _FakePrincipal:
    """Minimal stand-in - scope and topic_access read .assignments, .user_id and .is_external."""

    def __init__(self, assignments, *, is_external: bool = False):
        self.assignments = assignments
        self.is_external = is_external
        self.user_id = 1
        self.full_name = "Test Caller"
        self.email = "test@example.com"

    def has_role(self, *role_codes: str) -> bool:
        return bool({role for role, _ in self.assignments} & set(role_codes))


def _guest():
    return None


def _external():
    return _FakePrincipal((("external-user", None),), is_external=True)


def _club_admin():
    return _FakePrincipal((("club-admin", None),))


def _student():
    return _FakePrincipal((("student", _representative_unit("student")),))




# --- the definition is internally complete -------------------------------------------------------

def test_there_are_exactly_two_data_topics():
    """The assistant answers about events and clubs, and nothing else has rows behind it. A third
    topic appearing here without scope.py's docstring changing means somebody widened the scope by
    accident."""
    assert set(scope.TOPICS) == {"events", "clubs"}


def test_every_topic_names_real_pages():
    """A Topic pointing at a page that does not exist fails closed and silently narrows the topic to
    nobody - the same failure mode `created-by-me` once had, one level up."""
    for key, topic in scope.TOPICS.items():
        assert topic.pages, f"topic {key!r} names no page and would be ungated"
        for page_code in topic.pages:
            assert page_code in scope.PAGES, f"topic {key!r} names unknown page '{page_code}'"
        assert topic.fields, f"topic {key!r} lists no answerable fields"


def test_every_function_names_real_pages():
    for key, fn in scope.FUNCTIONS.items():
        assert fn.pages, f"function {key!r} names no page and would be ungated"
        for page_code in (*fn.pages, *fn.requires):
            assert page_code in scope.PAGES, f"function {key!r} names unknown page '{page_code}'"


def test_every_internal_page_is_a_real_nav_page():
    """An internal page IS a nav_page row - that is what makes Page Visibility able to gate it. A
    typo here fails closed for everyone, forever, with no error anywhere.

    A page gated by ANOTHER page (Created by Me, released by the proposal form) is exempt: it has no
    nav entry of its own, which is exactly why it names a different gate."""
    live = _live_pages()
    for code, page in scope.PAGES.items():
        if page.reach != scope.PAGE:
            continue
        for gate in page.gates:
            assert gate in live, f"page '{code}' is gated on '{gate}', which nav_page does not have"


def test_every_page_has_the_five_fields():
    """Page Name / Purpose / What Users Can Do / Related Functions / Visibility Rules. `purpose` is
    what "what is this page for" is answered FROM; a page without one sends the question back to the
    model to improvise, which is the behaviour this replaces."""
    for code, page in scope.PAGES.items():
        assert page.name.strip(), f"page '{code}' has no name"
        assert page.purpose.strip().endswith("."), f"page '{code}' has no complete purpose sentence"
        assert len(page.purpose) > 40, f"page '{code}' purpose is too thin to answer from"
        assert page.actions, f"page '{code}' lists nothing users can do on it"
        assert page.visibility.strip(), f"page '{code}' states no visibility rule"


def test_every_function_has_the_five_fields():
    """Function Name / Page / Purpose / User Steps / Visibility Rules. The steps are the ONLY thing
    a how-to may be answered from, so a function without them would be answered by improvising."""
    for key, fn in scope.FUNCTIONS.items():
        assert fn.name.strip(), f"function {key!r} has no name"
        assert fn.purpose.strip().endswith("."), f"function {key!r} has no complete purpose"
        assert len(fn.steps) >= 2, f"function {key!r} has fewer than two steps"
        assert fn.page_name, f"function {key!r} resolves to no page name"
        assert fn.visibility.strip(), f"function {key!r} states no visibility rule"


def test_related_functions_are_derived_not_written():
    """A page reads its function list out of FUNCTIONS. The two cannot be edited into disagreeing,
    which is the whole reason `functions` is a property rather than a field."""
    for key, fn in scope.FUNCTIONS.items():
        for page_code in fn.pages:
            assert fn in scope.PAGES[page_code].functions, (
                f"function {key!r} names page '{page_code}' but that page does not list it back"
            )


# THERE IS DELIBERATELY NO "every function is reachable by somebody" TEST, though it looks like the
# obvious next one to write. It would have to read nav_page_grants, and whether a role currently
# holds a page is ADMINISTRATION, not a code invariant: `reports` has exactly one grant row and an
# administrator has switched it off, so no role can reach Reports today. That is the design working
# - revoking a page withholds its function - and a test asserting otherwise would fail the build
# every time somebody used the Page Visibility screen.
#
# What IS a code invariant is covered above: a function names real pages, and an internal page is a
# real nav_page row. Those two cannot be fixed from the admin UI, which is what makes them tests.


def test_no_topic_is_owned_by_a_shared_hub():
    """Inbox, Ongoing, History and the My Requests folder are hubs: many roles hold each of them for
    unrelated reasons, and which tabs appear depends entirely on who is looking. Mapping a topic
    onto one asserts "anybody holding this page owns this data", which is false by construction."""
    hubs = {"inbox", "ongoing", "history", "my-requests"}
    for key, topic in scope.TOPICS.items():
        overlap = hubs & set(topic.pages)
        assert not overlap, (
            f"topic {key!r} is gated on the shared hub(s) {sorted(overlap)}. Name the page that "
            f"OWNS this data instead - holding a hub says nothing about owning a tab on it."
        )


def test_a_page_question_never_touches_the_database():
    """"What is the Event Calendar for" is a question about the app's structure. Routing it to the
    data path made the SAME question return a description for a guest and a permission refusal for
    an external account, and let the model describe a "personal calendar" this app never had."""
    from app.ai import classifier

    assert "page_purpose" in classifier.KNOWLEDGE_INTENTS
    assert "page_purpose" not in classifier.DATA_INTENTS
    assert "page_purpose" not in classifier.INTENT_TOPIC, (
        "page_purpose must stay ungated: a page's PURPOSE is not anybody's data"
    )


# --- the three tiers get exactly their own surface ------------------------------------------------

def test_a_guest_gets_the_public_landing_page_and_nothing_else():
    """A guest reads the landing page: Happening Soon, Explore Events, the Event Calendar. They were
    previously told they had "no access to a personal calendar" while looking at it."""
    assert topic_access.topic_allowed(_guest(), "events") is True
    assert topic_access.topic_allowed(_guest(), "clubs") is False
    assert scope.can_reach(_guest(), "public-event-calendar") is True
    assert scope.can_reach(_guest(), "event-calendar") is False


def test_an_external_account_keeps_the_visitor_surface():
    """The external account held no nav page and was therefore refused everything, including
    questions about the sections it was looking at. Its capabilities are real; they are just not nav
    pages. Clubs are university-account territory, by design rather than by permission."""
    external = _external()
    assert topic_access.topic_allowed(external, "events") is True
    assert topic_access.topic_allowed(external, "clubs") is False
    assert scope.can_use(external, "save_event") is True
    assert scope.can_use(external, "join_club") is False


def test_an_internal_user_is_not_given_the_visitor_surface():
    """publicLandingGuard redirects an internal account off the landing page, so pointing one at a
    landing-page section would send them somewhere they get bounced out of."""
    student = _student()
    assert scope.can_reach(student, "public-explore-events") is False
    assert scope.can_reach(student, "public-my-events") is False
    assert scope.can_reach(student, "explore-events") is True


def test_a_club_admin_administers_clubs_but_does_not_browse_them():
    """A Club Admin administers clubs: it does not browse or join them, and has nothing to do with
    events. It was previously offered help finding a club to join, and recommended two it could
    never join."""
    admin = _club_admin()
    # Discovering a club is a member's action, and Discover Clubs is what owns the clubs topic.
    assert topic_access.topic_allowed(admin, "clubs") is False
    assert topic_access.topic_allowed(admin, "events") is False
    # It can still be told how to do its own job.
    assert scope.can_use(admin, "manage_clubs") is True
    assert scope.can_use(admin, "decide_president_change") is True
    assert scope.can_use(admin, "join_club") is False


def test_a_club_admin_is_not_told_how_to_review_a_proposal():
    """A Club Admin holds the Inbox - for president-change requests - and proposal review happens in
    the Inbox too. `requires` is what keeps the shared hub from leaking the steps."""
    admin = _club_admin()
    assert scope.can_use(admin, "review_proposal") is False
    assert scope.can_use(admin, "resubmit_proposal") is False
    assert scope.can_use(_student(), "review_proposal") is True


# --- "what can you do" is computed, never written -------------------------------------------------

def test_what_can_you_do_never_offers_what_the_gate_would_refuse():
    """The opening promise and the gate are computed from one table, so they cannot disagree - the
    defect being a capability offered and then refused one question later."""
    for principal in (_guest(), _external(), _club_admin(), _student()):
        document = topic_access.capability_document(principal)
        if not topic_access.has_clubs(principal):
            assert "find clubs" not in document, f"{scope.tier_of(principal)}: offered clubs"
        if not topic_access.has_events(principal):
            assert "suggest events" not in document, f"{scope.tier_of(principal)}: offered events"


def test_what_can_you_do_claims_nothing_outside_the_seven():
    """It must never OFFER a capability the assistant does not have for anybody. These are the ones
    the previous version advertised.

    Checked against the offered lines only. The document also spells several of these out as things
    to refuse, and a whole-document substring check cannot tell an offer from a prohibition."""
    for principal in (_guest(), _external(), _club_admin(), _student()):
        offered = [
            line.lower() for line in topic_access.capability_document(principal).splitlines()
            if line.strip().startswith("- You can")
        ]
        assert offered, "the capability list must never be empty"
        for line in offered:
            for absent in ("proposal", "registrant", "who registered", "report", "analytic",
                           "cafeteria", "approval"):
                assert absent not in line, f"capability list offers {absent!r}: {line}"


def test_the_capability_list_always_has_something_in_it():
    """A page explanation and a how-to exist for every reader, including one who reaches no topic at
    all - so the assistant never has to answer "what can you do" with "nothing"."""
    for principal in (_guest(), _external(), _club_admin(), _student()):
        document = topic_access.capability_document(principal)
        assert "explain what any page" in document
        assert "how to perform an action" in document


def test_a_club_only_account_is_offered_clubs_and_not_events():
    """The three cases the spec calls out, on the one account that actually distinguishes them: an
    account with clubs but no events must be offered exactly one of the two."""
    student = _student()
    document = topic_access.capability_document(student)
    assert topic_access.has_clubs(student) == ("find clubs" in document)
    assert topic_access.has_events(student) == ("suggest events" in document)


# --- refusals are worded for the person reading them ---------------------------------------------

@pytest.mark.parametrize("principal_factory", [_guest, _external])
def test_a_visitor_is_never_sent_to_an_administrator(principal_factory):
    """A guest has no account for an administrator to fix, and an external account is working
    exactly as designed. Both were told "that page isn't available for your role" and advised to
    contact an administrator."""
    principal = principal_factory()
    documents = (
        topic_access.denial_document(principal, ["clubs"]),
        scope.function_denied_document(principal, "join_club"),
        topic_access.capability_document(principal),
        topic_access.out_of_scope_document(principal),
    )
    for document in documents:
        # Not mentioned at all, not even to be forbidden. Naming a thing in order to prohibit it is
        # how it ends up in the reply anyway, so these branches say what IS true instead.
        assert "administrator" not in document.lower(), document


def test_an_internal_refusal_still_names_the_administrator():
    """The opposite error would be just as wrong: for a university account whose ROLE lacks a grant,
    the honest reason IS a missing grant, and an administrator is who fixes it."""
    assert "administrator" in topic_access.denial_document(_club_admin(), ["events"]).lower()


def test_an_out_of_scope_refusal_never_names_an_administrator():
    """The distinction that matters most. A denial is a permissions decision; being out of scope is
    not one, and no grant would change it - so sending someone to an administrator over "who
    registered for this event" asks them to request a permission that does not exist."""
    for principal in (_guest(), _external(), _club_admin(), _student()):
        assert "administrator" not in topic_access.out_of_scope_document(principal).lower()


def test_the_out_of_scope_reply_offers_only_what_this_asker_can_have():
    """The fixed paragraph named clubs and events to everybody, including the tiers that have
    neither - so a refusal advertised a topic the next question would be refused for."""
    admin_document = topic_access.out_of_scope_document(_club_admin())
    assert "suggest events" not in admin_document
    assert "suggest clubs" not in admin_document
    assert "explain what a page" in admin_document

    guest_document = topic_access.out_of_scope_document(_guest())
    assert "suggest events" in guest_document
    assert "suggest clubs" not in guest_document


# --- resolving what a question names -------------------------------------------------------------

@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("what is the Event Calendar for", "public-event-calendar"),
        ("what is the point of the page Happening Soon?", "public-happening-soon"),
        ("can I view the section Explore Events?", "public-explore-events"),
        ("what does the page Manage Clubs do", "clubs-manage"),
        ("what is Discover Clubs", "clubs-discover"),
        ("what is the Page Visibility page for", "admin-page-visibility"),
        ("what is Proposal used for", "proposal-form"),
        ("explain Created By Me", "created-by-me"),
        ("what does Venue Management do", "dropdown-venue"),
        ("what is Reports for", "reports"),
        ("what is the Whatsit page for", None),
    ],
)
def test_a_page_question_resolves_to_a_defined_page(question: str, expected):
    """A dictionary lookup against the real page list, never a guess. Longest name first, so
    'Explore Events' is not swallowed by 'Events' and 'Discover Clubs' not by 'Clubs'."""
    assert scope.page_named(question) == expected


def test_an_unknown_page_name_is_refused_rather_than_described():
    """The honest answer for a page this app does not have. Improvising one is how a guest was given
    a confident description of a personal calendar."""
    document = scope.unknown_page_document("what is the Attendance Tracker page for").lower()
    assert "do not describe" in document


def test_a_page_purpose_is_described_even_when_it_cannot_be_opened():
    """A page's PURPOSE is not anybody's data. Refusing to say what a page is for leaves someone
    unable to learn what the app even contains. What is withheld is the page's CONTENTS."""
    document = scope.page_definition_document(_external(), "clubs-discover")
    assert "Discover Clubs" in document
    assert "CANNOT OPEN" in document
    assert "contact an administrator" not in document.lower()


def test_a_reachable_page_definition_carries_all_five_fields():
    """What the model is handed for "what can I do on Explore Events" - the definition, not a
    paragraph to improvise from."""
    document = scope.page_definition_document(_student(), "explore-events")
    for field in ("Page Name:", "Purpose:", "What Users Can Do:", "Related Functions"):
        assert field in document, f"page definition is missing {field!r}"
    assert "Register for an event" in document


def test_a_shared_page_name_resolves_to_the_copy_the_asker_has():
    """'Explore Events' and 'Event Calendar' each exist twice - once on the landing page, once
    inside the app. The name cannot say which; the asker's tier can."""
    internal = scope.page_definition_document(_student(), "public-explore-events")
    assert "/app/events/explore-events" in internal
    visitor = scope.page_definition_document(_guest(), "public-explore-events")
    assert "/#explore-events" in visitor


# --- the how-to matcher is a lookup, ordered specific-to-general ----------------------------------

@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("how do I save an event?", "save_event"),
        ("can u tell me how to save event", "save_event"),
        ("how do I cancel my registration", "cancel_registration"),
        ("how do I upload proof of payment", "upload_payment_proof"),
        ("how can I find an event", "find_event"),
        ("how do I discover clubs that match my interests", "find_club"),
        # These three were all swallowed by a bare `propos(e|al)` pattern in the regex version.
        ("how do I review a proposal", "review_proposal"),
        ("how do I cancel a proposal", "cancel_proposal"),
        ("how do I resubmit a proposal that was sent back", "resubmit_proposal"),
        # And these two by a bare `president` pattern.
        ("how do I approve a president change", "decide_president_change"),
        ("how do I become a club president", "request_president_change"),
        # The specific name must beat the general one that contains it.
        ("how do I create a club", "manage_clubs"),
        ("how do I manage club categories", "manage_club_categories"),
        ("how do I join a club", "join_club"),
        ("how do I submit an event proposal", "submit_proposal"),
        ("how do I register for an event", "register_event"),
        ("how do I grant a page to a role", "set_page_visibility"),
        ("how do I add a venue", "manage_dropdown_options"),
        # No definition is a real answer, not a fallback into improvisation.
        ("how do I change my password", None),
    ],
)
def test_a_how_to_resolves_to_the_right_function(question: str, expected):
    assert scope.function_named(question) == expected


def test_a_function_definition_names_its_page_first():
    """"Which page" is half of what a how-to question is actually asking; steps with no location
    send someone hunting."""
    document = scope.function_definition_document(_student(), "join_club")
    assert "Page: Discover Clubs" in document
    assert "User Steps:" in document
    assert "1." in document


def test_an_unsupported_how_to_offers_only_this_askers_real_functions():
    """The reply for a function nobody has written. It must not improvise steps, and the
    alternatives it offers have to be ones this particular asker can perform."""
    document = scope.unknown_function_document(_guest())
    assert "improvise" in document.lower()
    assert "Register for an event" in document
    assert "Join a club" not in document
