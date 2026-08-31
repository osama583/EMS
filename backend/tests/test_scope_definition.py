"""The scope DEFINITION (app/ai/scope.py): who may ask what, and how each refusal is worded.

Written after the 2026-09-01 sweep of the assistant as a guest, an external account and a Club
Admin, which found the same class of defect three times over: the several tables describing WHO CAN
ASK WHAT disagreed with each other and with the app itself.

  - The Club Admin was offered "the registration decisions you've made as an organiser" and then
    told the assistant did not have that information, because the topic was gated on `history` - a
    shared hub nine roles hold for nine unrelated reasons. It was also offered help finding a club
    to join, and recommended two it could never join.
  - The external account was told it had no assigned roles and should contact an administrator, for
    every question including ones about the landing-page sections it was reading - and was then
    handed working instructions for saving an event.
  - The guest was told it had "no access to a personal calendar" while the public Event Calendar
    was on screen, and advised to contact an administrator about an account it does not have.

Each test below pins one of those shut. tests/test_ai_scope.py continues to cover the enforcement
layers (the SQL guard, the row predicates, the page gate itself); this file covers the definition
those layers read.

Runs against the real seeded database, like tests/test_ai_scope.py.
"""
from __future__ import annotations

import pytest

from app.ai import query_router, scope, topic_access
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

def test_every_topic_names_real_areas():
    """A Topic pointing at an area that does not exist fails closed and silently narrows the topic
    to nothing - the same failure mode `created-by-me` had, one level up."""
    for key, topic in scope.TOPICS.items():
        assert topic.areas, f"topic {key!r} names no area and would be ungated"
        for area_code in topic.areas:
            assert area_code in scope.AREAS, f"topic {key!r} names unknown area '{area_code}'"


def test_every_guide_names_real_areas():
    for key, guide in scope.GUIDES.items():
        assert guide.areas, f"guide {key!r} names no area and would be ungated"
        for area_code in (*guide.areas, *guide.requires):
            assert area_code in scope.AREAS, f"guide {key!r} names unknown area '{area_code}'"


def test_every_page_area_is_a_real_nav_page():
    """A PAGE area IS a nav_page row - that is what makes Page Visibility able to gate it. A typo
    here fails closed for everyone, forever, with no error anywhere."""
    live = _live_pages()
    for code, area in scope.AREAS.items():
        if area.reach == scope.PAGE:
            assert code in live, f"area '{code}' is declared a nav page but nav_page has no such row"


def test_every_area_has_a_purpose():
    """`purpose` is what "what is this page for" is answered FROM. An area without one sends the
    question back to the model to improvise, which is the behaviour being replaced."""
    for code, area in scope.AREAS.items():
        assert area.purpose.strip().endswith("."), f"area '{code}' has no complete purpose sentence"
        assert len(area.purpose) > 40, f"area '{code}' purpose is too thin to answer from"


def test_no_topic_is_owned_by_a_shared_hub():
    """THE Club Admin regression, pinned.

    Inbox, Ongoing, History and the My Requests folder are hubs: many roles hold each of them for
    unrelated reasons, and which tabs appear depends entirely on who is looking. Mapping a topic
    onto one asserts "anybody holding this page owns this data", which is false by construction -
    and it is how a Club Admin came to be offered registration decisions it had made as an
    organiser, a thing it has never been able to be."""
    hubs = {"inbox", "ongoing", "history", "my-requests"}
    for key, topic in scope.TOPICS.items():
        overlap = hubs & set(topic.areas)
        assert not overlap, (
            f"topic {key!r} is gated on the shared hub(s) {sorted(overlap)}. Name the page that "
            f"OWNS this data instead - holding a hub says nothing about owning a tab on it."
        )


def test_page_purpose_is_answered_without_touching_the_database():
    """"What is the Event Calendar for" is a question about the app's structure. Routing it to the
    data path made the SAME question return a description for a guest and a permission refusal for
    an external account, and let the model describe a "personal calendar" this app never had."""
    from app.ai import classifier

    assert "page_purpose" in classifier.KNOWLEDGE_BASE_CLASSES
    assert "page_purpose" not in classifier.DATA_CLASSES
    assert "page_purpose" not in topic_access.TOPIC_PAGES, (
        "page_purpose must stay ungated: a page's PURPOSE is not anybody's data"
    )


# --- the three tiers get exactly their own surface ------------------------------------------------

def test_a_guest_gets_the_public_landing_page_and_nothing_else():
    """A guest reads the landing page: Happening Soon, Explore Events, the Event Calendar. They
    were previously told they had "no access to a personal calendar" while looking at it."""
    assert topic_access.topic_allowed(_guest(), "events") is True
    assert topic_access.topic_allowed(_guest(), "my_registrations") is False
    assert topic_access.topic_allowed(_guest(), "clubs") is False
    assert scope.can_reach(_guest(), "public-event-calendar") is True
    assert scope.can_reach(_guest(), "event-calendar") is False


def test_an_external_account_gets_the_visitor_surface_plus_its_own_events():
    """The external account held no nav page and was therefore refused everything, including
    questions about the sections it was looking at. Its capabilities are real; they are just not
    nav pages."""
    external = _external()
    assert topic_access.topic_allowed(external, "events") is True
    assert topic_access.topic_allowed(external, "my_registrations") is True
    # Clubs and proposals are university-account territory, by design rather than by permission.
    assert topic_access.topic_allowed(external, "clubs") is False
    assert topic_access.topic_allowed(external, "clubs_mine") is False
    assert topic_access.topic_allowed(external, "event_organiser") is False
    assert topic_access.how_to_allowed(external, "save_event") is True
    assert topic_access.how_to_allowed(external, "join_club") is False


def test_an_internal_user_is_not_given_the_visitor_surface():
    """publicLandingGuard redirects an internal account off the landing page, so pointing one at a
    landing-page section would send them somewhere they get bounced out of."""
    student = _student()
    assert scope.can_reach(student, "public-explore-events") is False
    assert scope.can_reach(student, "public-my-events") is False
    assert scope.can_reach(student, "explore-events") is True


def test_a_club_admin_is_scoped_to_club_administration():
    """The reported case, end to end. A Club Admin administers clubs: it does not browse or join
    them, and has nothing to do with events. Every one of these was allowed before."""
    admin = _club_admin()
    assert topic_access.topic_allowed(admin, "clubs_admin") is True
    assert topic_access.topic_allowed(admin, "president_change") is True
    # Discovering/joining a club is a member's action; a Club Admin is not a member.
    assert topic_access.topic_allowed(admin, "clubs") is False
    assert topic_access.topic_allowed(admin, "clubs_mine") is False
    # No event surface at all - this is what "registration decisions you've made as an organiser"
    # was offered on the strength of.
    assert topic_access.topic_allowed(admin, "events") is False
    assert topic_access.topic_allowed(admin, "my_registrations") is False
    assert topic_access.topic_allowed(admin, "event_organiser") is False
    assert topic_access.topic_allowed(admin, "event_organiser_decisions") is False


def test_a_club_admin_is_not_told_how_to_review_a_proposal():
    """A Club Admin holds the Inbox - for president-change requests - and proposal review happens
    in the Inbox too. `requires` is what keeps the shared hub from leaking the guide."""
    admin = _club_admin()
    assert topic_access.how_to_allowed(admin, "decide_president_change") is True
    assert topic_access.how_to_allowed(admin, "review_proposal") is False
    assert topic_access.how_to_allowed(admin, "resubmit_proposal") is False
    assert topic_access.how_to_allowed(_student(), "review_proposal") is True


def test_what_can_i_ask_never_offers_what_the_gate_would_refuse():
    """The opening promise and the gate are computed from one table, so they cannot disagree - the
    defect being that a Club Admin was offered organiser decisions and then told, one question
    later, that the assistant did not have that information."""
    for principal in (_guest(), _external(), _club_admin(), _student()):
        document = topic_access.askable_topics_document(principal)
        for key, topic in scope.TOPICS.items():
            if not topic_access.topic_allowed(principal, key):
                assert topic.ask_description not in document, (
                    f"{scope.tier_of(principal)}: offered {key!r}, which it would then be refused"
                )


# --- refusals are worded for the person reading them ---------------------------------------------

@pytest.mark.parametrize("principal_factory", [_guest, _external])
def test_a_visitor_is_never_sent_to_an_administrator(principal_factory):
    """A guest has no account for an administrator to fix, and an external account is working
    exactly as designed. Both were told "that page isn't available for your role" and advised to
    contact an administrator."""
    principal = principal_factory()
    documents = (
        topic_access.denial_document(principal, ["clubs"]),
        topic_access.how_to_denial_document(principal, "join_club"),
        topic_access.askable_topics_document(principal),
        topic_access.out_of_scope_document(principal),
    )
    for document in documents:
        assert "contact an administrator" not in document.lower(), document


def test_an_internal_refusal_still_names_the_administrator():
    """The opposite error would be just as wrong: for a university account the honest reason IS a
    missing grant, and an administrator is who fixes it."""
    document = topic_access.denial_document(_club_admin(), ["events"])
    assert "administrator" in document.lower()


def test_the_out_of_scope_reply_offers_only_what_this_asker_can_have():
    """The fixed paragraph named clubs and registrations to everybody, including the two tiers that
    have neither - so a refusal advertised a topic the next question would be refused for."""
    admin_document = topic_access.out_of_scope_document(_club_admin())
    assert scope.TOPICS["clubs_admin"].ask_description in admin_document
    assert scope.TOPICS["events"].ask_description not in admin_document

    guest_document = topic_access.out_of_scope_document(_guest())
    assert scope.TOPICS["events"].ask_description in guest_document
    assert scope.TOPICS["clubs"].ask_description not in guest_document


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
        ("what is the Whatsit page for", None),
    ],
)
def test_a_page_question_resolves_to_a_defined_area(question: str, expected):
    """A dictionary lookup against the real page list, never a guess. Longest name first, so
    'Explore Events' is not swallowed by 'Events' and 'Discover Clubs' not by 'Clubs'."""
    assert scope.area_named(question) == expected


def test_an_unknown_page_name_is_refused_rather_than_described():
    """The honest answer for a page this app does not have. Improvising one is how a guest was
    given a confident description of a personal calendar."""
    document = scope.unknown_area_document("what is the Attendance Tracker page for").lower()
    assert "do not describe" in document


def test_a_page_purpose_is_described_even_when_it_cannot_be_opened():
    """A page's PURPOSE is not anybody's data. Refusing to say what a page is for - as the external
    account was told, four questions running - leaves someone unable to learn what the app even
    contains. What is withheld is the page's CONTENTS."""
    document = scope.area_purpose_document(_external(), "clubs-discover")
    assert "Discover Clubs" in document
    assert "CANNOT OPEN" in document
    assert "contact an administrator" not in document.lower()


def test_a_shared_page_name_resolves_to_the_copy_the_asker_has():
    """'Explore Events' and 'Event Calendar' each exist twice - once on the landing page, once
    inside the app. The name cannot say which; the asker's tier can."""
    internal = scope.area_purpose_document(_student(), "public-explore-events")
    assert "/app/events/explore-events" in internal
    visitor = scope.area_purpose_document(_guest(), "public-explore-events")
    assert "/#explore-events" in visitor


# --- the how-to matcher is ordered specific-to-general --------------------------------------------

@pytest.mark.parametrize(
    ("question", "expected"),
    [
        # The one that resolved nothing and was answered from the platform overview instead.
        ("how do I save an event?", "save_event"),
        ("can u tell me how to save event", "save_event"),
        ("how do I cancel my registration", "cancel_registration"),
        ("how do I upload proof of payment", "upload_payment_proof"),
        # These three were all swallowed by the bare `propos(e|al)` pattern sitting first.
        ("how do I review a proposal", "review_proposal"),
        ("how do I cancel a proposal", "cancel_proposal"),
        ("how do I resubmit a proposal that was sent back", "resubmit_proposal"),
        # And these two by the bare `president` pattern.
        ("how do I approve a president change request", "decide_president_change"),
        ("how do I become a club president", "become_president"),
        ("how do I create a club", "manage_clubs"),
        ("how do I join a club", "join_club"),
        ("how do I submit an event proposal", "submit_proposal"),
        ("how do I register for an event", "register_event"),
        # No guide is a real answer, not a fallback into the system overview.
        ("how do I change my password", None),
    ],
)
def test_a_how_to_resolves_to_the_right_guide(question: str, expected):
    assert query_router.how_to_topic(question) == expected


def test_an_unsupported_how_to_offers_only_this_askers_real_guides():
    """The reply for a guide nobody has written. It must not improvise steps, and the alternatives
    it offers have to be ones this particular asker can actually perform."""
    document = topic_access.unsupported_how_to_document(_guest())
    assert "improvise" in document.lower()
    assert "registering for an event" in document
    assert "joining a club" not in document
