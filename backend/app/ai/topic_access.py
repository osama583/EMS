"""The ONE place that decides whether a caller may ask about a given topic.

Every chat topic (query_router class) maps to the nav page(s) that topic's data
lives behind. A caller may ask about a topic if Page Visibility
(nav_page_grants, edited at /app/admin/page-visibility) grants them ANY of that
topic's pages - so the same table that shows/hides a page in the sidebar also
decides what the assistant will answer, with nothing to keep in sync by hand.

Why this replaced the old per-domain role checks: api/ai.py used to gate club
analytics on `principal.has_role("club-admin")`, cafeteria data on
`is_cafeteria_admin(principal)`, and admin facts on `principal.is_admin`. Those
are hardcoded role names, so a CUSTOM role granted the Manage Clubs page in
Page Visibility still got refused by the chat (the UI said yes, the chat said
no), and revoking a page from club-admin still left the chat answering. Both
directions of that drift are gone: the role check is not consulted at all here,
only the live grant.

MULTI-ROLE: has_page_access() takes the caller's whole assignment tuple and
returns true if ANY assignment satisfies ANY grant on the page, so a
Student+Club Admin account is allowed whenever EITHER role would be - the union,
never the intersection.

NO ADMIN BYPASS: a System Admin is checked exactly like everyone else. If
system-admin is not on a page's grant list, the assistant refuses that topic for
them too - Page Visibility is the single source of truth, or it is not the
source of truth at all. An admin who locks themselves out re-grants the page to
themselves at /app/admin/page-visibility.

A topic absent from TOPIC_PAGES is UNGATED - deliberately, not by omission:
greeting/self_capability/system_capability/role_capability answer from
knowledge_base.py's static text about the app itself and expose no one's data.

how_to IS GATED, but per-GUIDE rather than per-topic, because a how-to's real
subject is the ACTION it describes, not the class it was routed to. See
how_to_allowed() and knowledge_base.HOW_TO_PAGES: each guide names the page its
action happens on, and the steps are withheld unless Page Visibility grants that
page. It used to be ungated here, which produced the exact bug this pairing
fixes - "how do I join a club" also classifies as {clubs, clubs_mine}, so an
ungranted caller had those topics denied and two ai_access_denial rows written
for a question that never asked for club data (query_router.classify now stops
emitting those incidental classes for a resolved how-to).

GUEST_OPEN_TOPICS are the exception in the other direction: gated for a
signed-in caller (whose sidebar is the truth about what they may see) but open
to a signed-out guest, because guest event browsing is a real, intended tier of
this app (see api/ai.py's module docstring). `events` is the only such topic -
it was previously left out of TOPIC_PAGES entirely to keep guests working, which
also meant a SIGNED-IN caller with no Events page still got event suggestions
from the assistant. Being explicit here fixes that without breaking guests.
"""
from __future__ import annotations

import logging

from ..services import identity

log = logging.getLogger(__name__)

# topic (query_router class) -> nav page_codes that grant it. ANY page in the
# list is enough (see module docstring). Codes must match seed/nav.py's.
TOPIC_PAGES: dict[str, tuple[str, ...]] = {
    # Clubs: any of the three club pages lets someone ask about clubs at all.
    "clubs": ("clubs-discover", "clubs-my", "clubs-manage"),
    "clubs_mine": ("clubs-my", "clubs-discover"),
    "clubs_admin": ("clubs-manage", "club-category"),
    "president_change": ("clubs-my", "clubs-manage"),
    # Whether the assistant itself has refused any question, and why - gated behind its OWN page
    # (not the general admin_settings umbrella above), matching /app/admin/ai-access-log exactly.
    "admin_ai_denials": ("admin-ai-access-log",),
    # The caller's own registrations/organiser views live under My Events.
    "my_registrations": ("my-events", "explore-events"),
    "event_organiser": ("my-events",),
    "event_organiser_decisions": ("history", "my-events"),
    # Browsing the published catalogue - Explore Events. Also in
    # GUEST_OPEN_TOPICS below, so a signed-out guest still gets it.
    "events": ("explore-events", "my-events"),
}

# Topics a signed-out GUEST may ask about even though they are gated for a signed-in caller.
GUEST_OPEN_TOPICS: frozenset[str] = frozenset({"events"})

# The how-to equivalent of GUEST_OPEN_TOPICS.
GUEST_OPEN_HOW_TO: frozenset[str] = frozenset({"register_event"})

# Human-readable topic names for the denial message and the audit log, so a
# refusal says "clubs" rather than "clubs_mine".
TOPIC_LABEL: dict[str, str] = {
    "clubs": "clubs", "clubs_mine": "clubs", "clubs_admin": "club administration",
    "president_change": "club president changes",
    "my_registrations": "your event registrations",
    "event_organiser": "event organising", "event_organiser_decisions": "event registration decisions",
    "admin_ai_denials": "the AI access log",
}


# What each topic means to the ASKER, for answering "what can I ask about?".
TOPIC_ASK_DESCRIPTION: dict[str, str] = {
    "events": "Published events - what's on, when and where, and finding one by topic",
    "my_registrations": "Your own event registrations and saved events",
    "event_organiser": "Who has registered for events you organise, and approvals waiting on you",
    "event_organiser_decisions": "Registrations you've already approved or rejected as an organiser",
    "clubs": "Clubs - what exists, what they do, and their categories",
    "clubs_mine": "Your own club memberships, join requests and presidency",
    "clubs_admin": "Club administration - category breakdowns, inactive clubs, president changes",
    "president_change": "Club president-change requests",
    "admin_ai_denials": "The AI access log - which questions the assistant itself has refused, who asked, and why",
}


def askable_topics_document(principal) -> str:
    """The CONTEXT block answering "what can I ask about?" - built live from the same
    nav_page_grants check that gates every answer, so it can never promise something the assistant
    would then refuse, nor omit something it would happily answer.

    Returns only topics this caller actually passes. An account that reaches nothing gated still
    gets a truthful minimal answer rather than an empty block, since general/how-to questions are
    ungated and always available."""
    seen: set[str] = set()
    lines: list[str] = []
    for topic, description in TOPIC_ASK_DESCRIPTION.items():
        if description in seen or not topic_allowed(principal, topic):
            continue
        seen.add(description)
        lines.append(f"- {description}")

    if not lines:
        return (
            "This asker has not been granted any data topic in this app, so the assistant can only "
            "help with general questions about how the app works and what their account is for. "
            "Say that plainly and suggest they contact an administrator if they expected more."
        )
    return (
        "The topics THIS asker can ask about, computed live from their current page access. This "
        "is the complete list - do not add, invent, or imply any other topic, and do not mention "
        "anything absent from it (they would be refused if they asked):\n"
        + "\n".join(lines)
        + "\nThey can also ask general questions about how the app works. Present this as a short, "
          "friendly list of what you can help with."
    )


def greeting_hint_document(principal) -> str:
    """The CONTEXT line for a BARE greeting ("hey", "hi") - a one-line steer, not the full
    enumerated capability list askable_topics_document() above returns for "what can you help me
    with". A greeting deserves a short, casual reply, not a menu; this only tells the model
    whether it's safe to casually mention clubs and/or events, computed from the same live
    Page Visibility grants so it can never offer a topic the asker would then be refused."""
    has_clubs = topic_allowed(principal, "clubs") or topic_allowed(principal, "clubs_mine")
    has_events = topic_allowed(principal, "events") or topic_allowed(principal, "my_registrations")
    if has_clubs and has_events:
        return "This asker can ask about both clubs and events - casually offer help with either."
    if has_clubs:
        return "This asker can ask about clubs but not events - casually offer help with clubs only."
    if has_events:
        return "This asker can ask about events but not clubs - casually offer help with events only."
    return (
        "This asker has no clubs or events access - casually offer help with the app/their account "
        "instead, not clubs or events."
    )


def how_to_allowed(principal, guide_key: str) -> bool:
    """May this caller be given the STEPS for `guide_key`?

    The how-to half of the same Action -> Page -> Visibility rule topic_allowed() applies to data
    topics: a guide is gated on the page its action actually happens on (knowledge_base.HOW_TO_PAGES),
    so revoking that page in /app/admin/page-visibility stops the instructions on the very next
    answer, and re-granting it restores them - no restart, no hardcoded role anywhere.

    An UNKNOWN key returns True rather than refusing: a guide missing from HOW_TO_PAGES is a coding
    gap, caught by tests/test_ai_scope.py, and failing closed at runtime would silently drop a
    perfectly good answer instead of surfacing the gap.

    GUESTS: allowed only for GUEST_OPEN_HOW_TO, matching topic_allowed()'s treatment of
    GUEST_OPEN_TOPICS - a guest holds no assignments, so every grant check fails by construction."""
    from .knowledge_base import HOW_TO_PAGES

    pages = HOW_TO_PAGES.get(guide_key)
    if pages is None:
        return True
    if principal is None:
        return guide_key in GUEST_OPEN_HOW_TO
    return any(identity.has_page_access(principal.assignments, page) for page in pages)


def page_card(principal, page_code: str) -> dict | None:
    """A navigation card pointing at `page_code`, or None if this caller cannot reach it.

    Built from the SAME grant check that gates the answer, so a card can never offer a page the
    caller would be bounced out of - and an admin hiding the page removes the card on the next
    answer, exactly like the instructions themselves.

    Reads label/route/icon live from nav_page rather than hardcoding them, so renaming or re-routing
    a page in the database is reflected without touching this module."""
    if principal is None or not identity.has_page_access(principal.assignments, page_code):
        return None
    from ..db import query_one

    row = query_one(
        """
        SELECT page_code, label, route_path
          FROM nav_page
         WHERE page_code = %s AND is_active AND archived_at IS NULL
        """,
        (page_code,),
    )
    if not row or not row.get("route_path"):
        return None
    # nav_page.icon holds a full inline SVG document, not a Material Symbols ligature name, so it
    # is deliberately NOT returned: the assistant's card renders an icon font, and handing it raw
    # SVG markup would print the markup as text. The card uses its own fixed icon instead.
    return {
        "pageCode": row["page_code"],
        "label": row["label"],
        "routePath": row["route_path"],
    }


def how_to_cards(principal, guide_key: str) -> list[dict]:
    """Every reachable navigation card for a guide - the "take me there" half of a how-to answer.
    Empty when the caller cannot reach the page, which is also when the steps are withheld."""
    from .knowledge_base import HOW_TO_PAGES

    cards = [page_card(principal, page) for page in HOW_TO_PAGES.get(guide_key, ())]
    return [card for card in cards if card]


def topic_cards(principal, topics: set[str], limit: int = 2) -> list[dict]:
    """"Take me there" cards for the pages a set of DATA topics lives on.

    The how-to equivalent (how_to_cards) has always existed; this is the same idea for a data
    answer, added because "where can I find my registrations" classifies as a DATA question
    (my_registrations), not a how-to, so it resolved no guide and got no card at all - a
    location question answered with prose and nothing to click.

    Uses page_card(), so every card is behind the same grant check that released the answer and
    can never point somewhere the caller would be bounced out of. Capped, because a question
    touching three topics does not need three navigation cards under a two-sentence reply.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for topic in sorted(topics):
        for page_code in TOPIC_PAGES.get(topic, ()):
            if page_code in seen:
                continue
            seen.add(page_code)
            card = page_card(principal, page_code)
            if card:
                out.append(card)
                if len(out) >= limit:
                    return out
    return out


def topic_allowed(principal, topic: str) -> bool:
    """May this caller ask about `topic`? True for an ungated topic (not in
    TOPIC_PAGES) and for any topic whose pages Page Visibility grants them.

    A guest (principal None) is allowed ungated topics plus GUEST_OPEN_TOPICS;
    every other gated topic needs a real account, matching what the pages
    themselves require."""
    pages = TOPIC_PAGES.get(topic)
    if pages is None:
        return True
    if principal is None:
        return topic in GUEST_OPEN_TOPICS
    return any(identity.has_page_access(principal.assignments, page) for page in pages)


def denied_topics(principal, classes: set[str]) -> list[str]:
    """Every classified topic this caller may NOT ask about, in stable order so
    the log and the denial message read the same way every time."""
    return sorted(topic for topic in classes if not topic_allowed(principal, topic))


def log_review_rejection(principal, question: str, answer: str, *, flag: str, reason: str | None) -> None:
    """The AI security reviewer refused an already-generated answer (see sql_llm.review_answer).

    Distinct from every other writer here in that the answer EXISTS - the refusal happened after
    generation, not instead of it - so `ai_response` is recorded alongside the question. That column
    is the whole point of the row: an administrator cannot judge "should this answer have gone out"
    from the question alone.

    Roles are snapshotted rather than re-read at display time, for the same reason user_email
    already is: an assignment revoked next week must not silently rewrite what this row says was
    true when the question was asked."""
    user_id = getattr(principal, "user_id", None)
    email = getattr(principal, "email", None)
    roles = ", ".join(sorted({code for code, _unit in getattr(principal, "assignments", ()) or ()})) or None
    try:
        from ..db import transaction

        with transaction() as cur:
            cur.execute(
                """
                INSERT INTO ai_access_denial
                       (user_id, user_email, user_roles, topic, topic_label, required_pages,
                        question, ai_response, outcome, reason)
                VALUES (%s, %s, %s, NULL, NULL, NULL, %s, %s, %s, %s)
                """,
                (user_id, email, roles, question[:1000], answer[:2000], flag, reason),
            )
    except Exception as exc:  # noqa: BLE001 - an audit write must never break ask(); see _log_refusals
        log.warning("ai.review_rejection.log_failed", extra={"flag": flag, "error": str(exc)})
    log.info("ai.review_rejected", extra={"user_id": user_id, "flag": flag})


def user_context_document(principal, topics: set[str]) -> str:
    """Who is asking, in the form the SQL generator and the reviewer both need.

    Assembled from AUTHENTICATED backend data only - the token's principal and the live
    nav_page_grants check - never from anything the question claims about itself. That is the
    entire point: "I am the manager" in a question changes nothing here, because nothing here reads
    the question.

    Shared by both callers deliberately. The reviewer judging an answer against a DIFFERENT account
    summary than the one the SQL was generated under would be reviewing a fiction, and keeping the
    two in sync by hand is exactly the kind of drift topic_access.py exists to eliminate."""
    if principal is None:
        return (
            "The asker is a GUEST (not signed in). They have no user_id, no roles, and no page "
            "access. They may only see published Public and Club Only events. They have no "
            "registrations, no clubs, no memberships, and no personal data of any kind."
        )
    roles = sorted({code for code, _unit in principal.assignments or ()})
    granted = sorted({topic for topic in TOPIC_PAGES if topic_allowed(principal, topic)})
    lines = [
        f"Asker: {principal.full_name} (user_id={principal.user_id}, email={principal.email}).",
        f"Roles: {', '.join(roles) or 'none'}.",
        f"Topics their Page Visibility grants: {', '.join(granted) or 'none'}.",
        f"Topics this question was classified as: {', '.join(sorted(topics)) or 'none'}.",
    ]
    return "\n".join(lines)


def _log_refusals(principal, rows: list[tuple[str, str | None, str | None, str | None, str | None]], question: str) -> None:
    """Write refusal rows to ai_access_denial - the shared body behind log_denials(),
    log_how_to_denial() and log_unanswerable().

    Each row is (outcome, topic, topic_label, required_pages, reason). `outcome` is what turns this
    from a pure page-denial log into the "why did the assistant not answer" log the admin page needs:
      page_denied         - Page Visibility does not grant the caller the topic's pages
      how_to_page_denied  - the caller cannot reach the page the requested ACTION happens on
      out_of_scope        - nothing matched; the question is outside clubs/events/system/how-to
      unsupported         - a how-to shape the assistant has no guide for yet (the actionable one:
                            it names the guide somebody should write)

    Never raises: an audit-log write failing must not turn a correctly-refused question into a 500 -
    the refusal itself already happened and is what actually protects the data, so a lost log row is
    degraded observability, not a security hole. Logged to the app log too, so a DB write failure is
    still visible somewhere."""
    if not rows:
        return
    from ..db import transaction

    user_id = getattr(principal, "user_id", None)
    email = getattr(principal, "email", None)
    try:
        # One transaction for every topic this question was refused for - a
        # write, so transaction() (which commits); query() runs in read_cursor()
        # and rolls back, which would silently discard the row.
        with transaction() as cur:
            for outcome, topic, topic_label, required_pages, reason in rows:
                cur.execute(
                    """
                    INSERT INTO ai_access_denial
                           (user_id, user_email, topic, topic_label, required_pages, question,
                            outcome, reason)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, email, topic, topic_label, required_pages, question[:1000], outcome, reason),
                )
    except Exception as exc:  # noqa: BLE001 - see docstring: audit write must never break ask()
        log.warning("ai.access_denial.log_failed", extra={"rows": len(rows), "error": str(exc)})
    log.info("ai.access_denied", extra={"user_id": user_id, "outcomes": [r[0] for r in rows]})


def log_denials(principal, topics: list[str], question: str) -> None:
    """A data topic was refused because Page Visibility does not grant its pages."""
    _log_refusals(
        principal,
        [("page_denied", t, TOPIC_LABEL.get(t, t), ", ".join(TOPIC_PAGES.get(t, ())), None) for t in topics],
        question,
    )


def log_how_to_denial(principal, guide_key: str, question: str) -> None:
    """The caller asked HOW to do something they cannot reach the page for."""
    from .knowledge_base import HOW_TO_LABEL, HOW_TO_PAGES

    _log_refusals(
        principal,
        [(
            "how_to_page_denied",
            f"how_to:{guide_key}",
            HOW_TO_LABEL.get(guide_key, guide_key.replace("_", " ")),
            ", ".join(HOW_TO_PAGES.get(guide_key, ())),
            None,
        )],
        question,
    )


def log_unanswerable(principal, question: str, *, reason: str, unsupported: bool = False) -> None:
    """Nothing was refused - the assistant simply has no answer. Recorded so the admin page can
    distinguish "blocked by access" from "we never built this", which is the difference between a
    permissions fix and a backlog item."""
    _log_refusals(
        principal,
        [("unsupported" if unsupported else "out_of_scope", None, None, None, reason)],
        question,
    )
