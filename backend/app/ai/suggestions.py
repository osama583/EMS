"""The assistant's opening suggestion cards, chosen for the person reading them.

The panel used to show one fixed list of eight cards to everybody. All eight were
about submitting and tracking an event proposal, so what "What would you like to
know?" offered was accurate only for the roles that write proposals. A Cafeteria
Manager was invited to ask about approval timelines for a form they cannot open;
a Club Admin got nothing about clubs at all; a System Admin was offered "Who can
apply?" and nothing about the system they administer. Worse, several cards led
straight into a refusal - the topics behind them are gated, so clicking one asked
a question the assistant then declined and logged as an access denial.

The fix is to build the list from the SAME rule that decides whether an answer is
allowed. Every card names the scope.py AREA(s) its subject lives in, and a card
is offered only when the reader can actually reach one of them (scope.can_reach,
exactly as topic_access.topic_allowed and topic_access.how_to_allowed do). So:

  - a card can never invite a question the assistant would refuse, because the
    check that releases the answer is the check that shows the card;
  - revoking a page in /app/admin/page-visibility removes its cards on the next
    open, with nothing to keep in sync by hand;
  - a new role needs no code here at all - it gets the cards its grants imply.

UNGATED cards carry `pages = ()` and are shown to everyone including signed-out
guests: they ask about the app itself or about the reader's own access, which
knowledge_base answers from static text and which exposes nobody's data.

VISITORS - guests and external accounts alike - are served by the same mechanism
rather than by a special case. Cards about browsing and saving events name both
the internal page and the public landing section, so each tier matches the copy
it can open. This replaced a `guest_open=True` flag, a hand-maintained second
opinion about the guest tier that could drift from topic_access and that had no
way to express an external account at all: those held no nav page, matched no
card, and opened the panel on the three ungated cards and nothing else.

A CARD IS NOT A ROLE CHECK. Several pages are granted far more widely than their
name suggests (`inbox` reaches nine roles, not just reviewers), so a card gated on
one has to be worded for everyone who holds it. Cards phrased as though the reader
reviews proposals were wrong for most of the people who could see them; the two
that survive say "in my inbox" and "requests I am tracking" instead.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import scope

# How many cards the panel asks for. Four to a page, two pages - matching the
# panel's own pagination dots.
DEFAULT_LIMIT = 8


@dataclass(frozen=True)
class Suggestion:
    """One card. `prompt` is what gets sent when it is clicked; `title` and
    `description` only have to make that question worth clicking."""

    icon: str
    title: str
    description: str
    prompt: str
    # The scope.py AREAS that release this card. Empty = ungated (see module docstring).
    pages: tuple[str, ...] = ()

    def as_json(self) -> dict:
        return {
            "icon": self.icon,
            "title": self.title,
            "description": self.description,
            "prompt": self.prompt,
        }


def _card(icon, title, description, prompt, pages=()) -> Suggestion:
    return Suggestion(icon=icon, title=title, description=description, prompt=prompt, pages=pages)


# --- The catalogue -----------------------------------------------------------
# ORDER IS PRIORITY, and it runs narrowest audience first. That costs the broad
# roles nothing - a student matches none of the admin cards, so those never take
# one of their eight slots - while guaranteeing that a role with only a handful of
# applicable cards sees all of them, rather than having them pushed off the end by
# cards half the app can also ask.
#
# `pages` is checked against the LIVE grant table, so the audience noted beside
# each group is what the seed currently grants, not a rule this file enforces.
CATALOGUE: tuple[Suggestion, ...] = (
    # --- System Admin only -------------------------------------------------
    _card("manage_accounts", "Accounts and Roles", "See how many accounts hold each role.",
          "How many user accounts are there, and what roles do they hold?", ("admin-users",)),
    _card("visibility", "Page Visibility", "Check which roles can reach which pages.",
          "Which roles can see which pages?", ("admin-page-visibility",)),
    _card("gpp_maybe", "Refused Questions", "Review what the assistant has declined to answer, and why.",
          "Which questions has the assistant refused recently, and why?", ("admin-ai-access-log",)),

    # --- Cafeteria Admin only ----------------------------------------------
    _card("storefront", "Outlets and Managers", "See every cafeteria and who runs it.",
          "Which cafeterias are set up and who manages each one?", ("cafeteria-manage",)),
    _card("assignment_ind", "Staff Assignments", "Check how staff are spread across outlets.",
          "Which cafeteria staff are assigned to which outlet?", ("cafeteria-staff-assignments",)),

    # --- Cafeteria Manager only --------------------------------------------
    _card("restaurant_menu", "My Menu", "Review what your outlet currently offers.",
          "What is on my cafeteria menu?", ("menu",)),
    _card("badge", "My Staff", "See who is posted to your outlet right now.",
          "Who works at my cafeteria?", ("cafeteria-my-staff",)),

    # --- Club Admin only ---------------------------------------------------
    _card("groups", "Club Overview", "See how many clubs sit in each category.",
          "How many clubs are there in each category?", ("clubs-manage", "club-category")),
    _card("toggle_off", "Inactive Clubs", "Find clubs that are no longer active.",
          "Which clubs are inactive?", ("clubs-manage",)),
    _card("swap_horiz", "President Changes", "Check president-change requests awaiting a decision.",
          "Which president-change requests are still pending?", ("clubs-manage",)),

    # --- Cafeteria oversight (Admin, plus one other role each) -------------
    _card("menu_book", "Menus Across Outlets", "Compare what the different cafeterias offer.",
          "What do the different cafeterias have on their menus?", ("cafeteria-menu-oversight",)),
    _card("history_edu", "Staff Action History", "Look back at hires, suspensions and removals.",
          "What staff changes have been made at the cafeterias recently?",
          ("cafeteria-staff-requests-history",)),

    # --- Anyone with a dashboard (Head of Department, CFO, Cafeteria Manager) --
    _card("insights", "My Overview", "Get a summary of the activity you are responsible for.",
          "Give me an overview of the activity I am responsible for.", ("dashboard",)),

    # --- Students (the only role granted the club pages) --------------------
    _card("workspace_premium", "My Clubs", "See the clubs you belong to or preside over.",
          "Which clubs am I a member of?", ("clubs-my",)),
    _card("diversity_3", "Clubs I Could Join", "Discover clubs that are open for membership.",
          "What clubs can I join?", ("clubs-discover",)),

    # --- Anyone who can create an event ------------------------------------
    # `created-by-me` used to gate this card - a page_code seed/nav.py has never created, so the
    # card was dead for every role in the app. The organiser's real grant is the proposal form.
    _card("how_to_reg", "Who Registered", "See who has signed up for the events you created.",
          "Who has registered for the events I created?", ("proposal-form",)),

    # --- Anyone who attends events -----------------------------------------
    # Two areas each, internal and visitor, so one card serves a student and a visitor account
    # without either being offered the other's page.
    _card("bookmark", "My Events", "Check what you have registered for or saved.",
          "Which events am I registered for?", ("my-events", "public-my-events")),
    _card("event", "What Is Coming Up", "See which events are happening soon.",
          "What events are coming up?",
          ("explore-events", "event-calendar", "public-happening-soon")),

    # --- Anyone who submits proposals --------------------------------------
    _card("chat", "Submit Through Chat", "Let the assistant walk you through creating a proposal.",
          "Can you guide me through creating and submitting an event proposal?", ("proposal-form",)),

    # --- Anyone with an inbox or a request to track ------------------------
    _card("inbox", "In My Inbox", "See what has landed with you and needs action.",
          "What is in my inbox right now?", ("inbox",)),
    _card("timeline", "Where My Requests Stand", "Track what you have submitted and how far it has got.",
          "What is the status of the requests I am tracking?", ("ongoing", "my-requests")),

    # --- Club how-tos -------------------------------------------------------
    _card("group_add", "How to Join a Club", "Learn how a join request is made and decided.",
          "How do I join a club?", ("clubs-discover",)),
    _card("military_tech", "Becoming President", "Find out how the President role is handed over.",
          "How do I become a club President?", ("clubs-my",)),

    # --- General proposal and event knowledge ------------------------------
    _card("description", "Required Information", "Find out what you need before you start.",
          "What information and documents do I need before submitting a proposal?", ("proposal-form",)),
    _card("event_available", "Submission Deadline", "Check how early a proposal has to go in.",
          "How long before my event should I submit the proposal?", ("proposal-form",)),
    _card("help", "The Approval Process", "Understand the full route a proposal takes.",
          "Can you explain the complete event approval process?", ("proposal-form", "my-requests")),
    _card("schedule", "Approval Timeline", "See how long approval usually takes.",
          "How long does the approval process typically take?", ("my-requests", "proposal-form")),
    _card("hub", "Department Responsibilities", "Learn which department handles what.",
          "Which departments are involved in a proposal, and what is each responsible for?",
          ("my-requests", "proposal-form")),
    _card("confirmation_number", "How to Register", "Learn how registering for an event works.",
          "How do I register for an event?", ("explore-events", "public-explore-events")),
    _card("bookmark_add", "How to Save an Event", "Keep an event to come back to later.",
          "How do I save an event?", ("my-events", "public-my-events")),

    # --- Ungated: the app itself, and the reader's own access ---------------
    _card("quiz", "What Can I Ask?", "See the topics you can ask about with your access.",
          "What can I ask you about?"),
    _card("account_circle", "What Can I Do Here?", "Find out what your account lets you do.",
          "What can I do in this app with my account?"),
    _card("info", "About This App", "Understand what the platform is for.",
          "What is this app for and what can it do?"),
    _card("help_center", "What Is This Page For?", "Ask what any part of the app does.",
          "What is the Event Calendar for?"),
)


def _visible(suggestion: Suggestion, principal) -> bool:
    """The SAME reachability check that releases the answer behind the card.

    `guest_open` is gone. It was a hand-maintained second opinion about which cards a signed-out
    visitor may see, kept in sync with topic_access by hand and therefore able to drift from it.
    A guest now passes a card because they can actually reach the area behind it - which is also
    what makes the visitor cards below work for an EXTERNAL account, a tier the old flag had no way
    to express at all (it offered them nothing but the three ungated cards)."""
    if not suggestion.pages:
        return True
    return any(scope.can_reach(principal, area) for area in suggestion.pages)


def suggestions_for(principal, *, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """The cards this caller should be offered, in catalogue (priority) order.

    Never empty: the three ungated cards at the tail always survive, so an
    account that reaches nothing still opens the panel on something real to
    click rather than on a bare prompt with no examples under it.
    """
    chosen: list[dict] = []
    seen: set[str] = set()
    for suggestion in CATALOGUE:
        if len(chosen) >= limit:
            break
        if suggestion.prompt in seen or not _visible(suggestion, principal):
            continue
        seen.add(suggestion.prompt)
        chosen.append(suggestion.as_json())
    return chosen
