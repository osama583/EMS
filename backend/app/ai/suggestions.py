"""The assistant's opening suggestion cards, chosen for the person reading them.

EVERY CARD IS A QUESTION THE ASSISTANT CAN ACTUALLY ANSWER FOR THIS READER. That is the entire
design rule, and it is the one the old catalogue broke twice over: it offered proposal tracking,
cafeteria menus, registrant lists and admin analytics - none of which this assistant does any more
for anyone - and it gated them by hand rather than by the check that releases the answer.

So the catalogue is now exactly the seven things the assistant does (see scope.py), and each card
is released by `scope.can_reach` against the pages its answer lives behind - the SAME check the
answer path runs. A card can therefore never offer something the asker would be refused the moment
they clicked it, which is the failure a hand-maintained second opinion always eventually produces.

ORDER IS PRIORITY, and it runs narrowest audience first. That costs the broad roles nothing - an
account without clubs matches none of the club cards, so those never take one of its slots - while
guaranteeing that a reader with only a handful of applicable cards sees all of them rather than
having them pushed off the end.

The last three are ungated, and that is deliberate: a page definition, a how-to and "who am I" have
an answer for every reader, including a signed-out one. They are also why the list is never empty.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import scope

DEFAULT_LIMIT = 8


@dataclass(frozen=True)
class Suggestion:
    """One card. `prompt` is what gets sent when it is clicked; `title` and `description` only have
    to make that question worth clicking."""

    icon: str
    title: str
    description: str
    prompt: str
    # The scope.PAGES this card's answer lives behind. Empty = ungated (see the module docstring).
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


# The event and club pages, named once. Both tiers of each, so one card serves a university account
# and a visitor without either being offered the other's page.
_EVENT_PAGES = ("explore-events", "event-calendar", "public-explore-events",
                "public-happening-soon", "public-event-calendar")
_CLUB_PAGES = ("clubs-discover",)
_SAVED_PAGES = ("my-events", "public-my-events")


CATALOGUE: tuple[Suggestion, ...] = (
    # --- Clubs: the narrowest audience, so first --------------------------------------------
    _card("diversity_3", "Find Me a Club", "Get a club suggestion based on what you are into.",
          "Suggest a club for me.", _CLUB_PAGES),
    _card("groups", "About a Club", "Ask what a club does, who runs it, and how big it is.",
          "Tell me about the clubs I could join.", _CLUB_PAGES),
    _card("group_add", "How to Join a Club", "Learn how a join request is made and decided.",
          "How do I join a club?", _CLUB_PAGES),

    # --- Events ------------------------------------------------------------------------------
    _card("auto_awesome", "Suggest an Event", "Tell me what you enjoy and I'll pick a few.",
          "Suggest an event for me.", _EVENT_PAGES),
    _card("event", "What Is Coming Up", "See which events are happening soon.",
          "What events are coming up?", _EVENT_PAGES),
    _card("payments", "Free Events", "Find something on that costs nothing.",
          "Are there any free events coming up?", _EVENT_PAGES),
    _card("confirmation_number", "How to Register", "Learn how registering for an event works.",
          "How do I register for an event?", _EVENT_PAGES),
    _card("bookmark_add", "How to Save an Event", "Keep an event to come back to later.",
          "How do I save an event?", _SAVED_PAGES),

    # --- Ungated: the app itself, and the reader's own account -------------------------------
    # These are the fallback set. They sit last on purpose: with the gated cards above filling the
    # limit, a reader who holds clubs and events never sees them, and a reader who holds neither
    # opens the panel on these instead of on nothing.
    _card("help_center", "What Is This Page For?", "Ask what any part of the app does.",
          "What is Explore Events for?"),
    _card("account_circle", "Who Am I?", "Check your account, your role and what you can reach.",
          "Who am I and what can I access?"),
    _card("quiz", "What Can You Do?", "See what I can help you with.",
          "What can you help me with?"),
)


# The how-to half of the fallback pair, as (function key, card title). BUILT per caller rather than
# listed in CATALOGUE, because a how-to is only answerable when the caller can reach the page its
# action happens on - a static "How do I submit a proposal?" card shown to someone without the
# proposal form invites exactly the refusal this module exists to prevent, which is the same reason
# every other card here names its pages.
#
# First reachable one wins, so the card describes something the reader can actually go and do.
# Ordered widest-consequence first; the how-tos already in CATALOGUE sit at the tail, and a
# duplicate is dropped by the prompt de-dupe rather than by keeping two lists in step.
_FALLBACK_FUNCTIONS: tuple[str, ...] = (
    "submit_proposal",
    "review_proposal",
    "track_request",
    "manage_clubs",
    "decide_join_request",
    "cancel_proposal",
    "register_event",
    "join_club",
    "save_event",
)


def _how_to_card(principal) -> Suggestion | None:
    """A how-to card for a function THIS caller can actually perform, or None if they can perform
    none of them.

    `pages` is empty on the result because the reachability check has already happened here - the
    card is only built at all when scope.can_use() says the steps would be released."""
    for key in _FALLBACK_FUNCTIONS:
        if scope.can_use(principal, key):
            name = scope.FUNCTIONS[key].name
            return _card("menu_book", f"How to {name[0].lower() + name[1:]}",
                         f"The steps, and where it happens.", f"How do I {name[0].lower() + name[1:]}?")
    return None


def _visible(suggestion: Suggestion, principal) -> bool:
    """The SAME reachability check that releases the answer behind the card."""
    if not suggestion.pages:
        return True
    return any(scope.can_reach(principal, page) for page in suggestion.pages)


def suggestions_for(principal, *, limit: int = DEFAULT_LIMIT) -> list[dict]:
    """The cards this caller should be offered, in catalogue (priority) order.

    Never empty: the three ungated cards at the tail always survive, so an account that reaches
    nothing still opens the panel on something real to click rather than on a bare prompt.
    """
    how_to = _how_to_card(principal)
    catalogue = (*CATALOGUE, how_to) if how_to else CATALOGUE
    chosen: list[dict] = []
    seen: set[str] = set()
    for suggestion in catalogue:
        if len(chosen) >= limit:
            break
        if suggestion.prompt in seen or not _visible(suggestion, principal):
            continue
        seen.add(suggestion.prompt)
        chosen.append(suggestion.as_json())
    return chosen
