"""VISIBILITY ENFORCEMENT, and every sentence the assistant says about what it can and cannot do.

ONE RULE, APPLIED EVERYWHERE: page visibility is the source of truth. scope.can_reach() answers it
for a page; everything in this module is that answer applied to something the asker can see.

    a topic          may only be answered if the caller can stand on a page that owns it
    a function       may only be explained if the caller can perform it
    a page           may only be described in full if the caller can open it
    a suggestion     may only name events or clubs from a topic the caller can reach
    "what can you do" may only claim capabilities the caller actually has

The last one is not a courtesy. Every capability sentence here is COMPUTED from the same live
grants that gate the answers, so the assistant cannot offer something it would refuse a second
later. A hand-written "I can help with clubs and events" paragraph was doing exactly that: it was
told to a Club Admin who cannot browse clubs to join, and to a visitor account with no club access
at all, and both went on to be refused the thing they had just been offered.

A REFUSAL IS WORDED FOR THE TIER. "An administrator has not granted your role that page" is true
for a university account, misleading for a visitor account (which is working exactly as designed)
and meaningless to a guest, who has no account and no administrator. Every refusal document below
branches on scope.tier_of() for that reason.

WHAT IS OUT OF SCOPE IS NOT "DENIED". A question about who registered for an event, an approval
workflow, or a report is not something a grant could unlock - the assistant does not do it for
anybody. Those get out_of_scope_document(), which says so plainly and does not send anyone to an
administrator for a permission that would change nothing.

Everything refused is written to ai_access_denial, so /app/admin/ai-access-log can tell a
permissions problem (fix a grant) from a capability gap (build the thing) at a glance.
"""
from __future__ import annotations

import logging

from . import scope
from .scope import TOPICS

log = logging.getLogger(__name__)

TOPIC_LABEL: dict[str, str] = {key: topic.label for key, topic in TOPICS.items()}


# --- The gate ----------------------------------------------------------------------------------

def topic_allowed(principal, topic: str) -> bool:
    """May this caller ask about `topic`? True only if they can stand on a page that owns it."""
    if topic not in TOPICS:
        return False
    return scope.can_reach_topic(principal, topic)


def denied_topics(principal, topics: set[str]) -> list[str]:
    """Every requested topic this caller may NOT ask about, in stable order so the log and the
    refusal read the same way every time."""
    return sorted(topic for topic in topics if not topic_allowed(principal, topic))


def allowed_topics(principal) -> list[str]:
    """Every topic this caller may ask about at all, in definition order."""
    return [key for key in TOPICS if topic_allowed(principal, key)]


def has_events(principal) -> bool:
    return topic_allowed(principal, "events")


def has_clubs(principal) -> bool:
    return topic_allowed(principal, "clubs")


# --- Navigation cards --------------------------------------------------------------------------

def page_card(principal, page_code: str) -> dict | None:
    """A navigation card pointing at `page_code`, or None if this caller cannot reach it.

    Built from the SAME reachability check that gates the answer, so a card can never offer
    somewhere the caller would be bounced out of.

    Internal pages read their label and route LIVE from nav_page, so renaming or re-routing a page
    in the database is reflected without touching this module. Visitor pages have no nav_page row -
    they are sections of the public landing page - so they card from the Page definition itself. A
    page whose visibility comes from another page's grant (Created by Me) has no nav_page row
    either, and cards from its definition for the same reason.
    """
    if not scope.can_reach(principal, page_code):
        return None
    page = scope.PAGES[page_code]
    if page.reach != scope.PAGE or page.gates != (page.code,):
        return {"pageCode": page.code, "label": page.name, "routePath": page.route} if page.route else None

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
    # nav_page.icon holds a full inline SVG document, not a Material Symbols ligature name, so it is
    # deliberately NOT returned: the assistant's card renders an icon font, and handing it raw SVG
    # markup would print the markup as text. The card uses its own fixed icon instead.
    return {"pageCode": row["page_code"], "label": row["label"], "routePath": row["route_path"]}


def function_cards(principal, function_key: str) -> list[dict]:
    """The "take me there" cards under a how-to answer - the page the steps happen on. Empty when
    the caller cannot reach it, which is also when the steps are withheld."""
    fn = scope.FUNCTIONS.get(function_key)
    cards = [page_card(principal, page) for page in (fn.pages if fn else ())]
    return [card for card in cards if card][:2]


def topic_cards(principal, topics: set[str], limit: int = 2) -> list[dict]:
    """"Take me there" cards for the pages a set of data topics lives on.

    A location answer - "where do I find events" - is prose with nothing to click otherwise. Capped,
    because a two-sentence reply does not need three navigation cards under it.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for topic in sorted(topics):
        for page_code in scope.topic_pages(topic):
            if page_code in seen:
                continue
            seen.add(page_code)
            card = page_card(principal, page_code)
            if card:
                out.append(card)
                if len(out) >= limit:
                    return out
    return out


# --- "What can you do?" ------------------------------------------------------------------------

# The four capability sentences, in the order they are offered. The first two are gated on live
# topic access; the last two are ungated because a page definition and a function definition exist
# for every caller - what varies is WHICH pages and functions, which the answer path already
# filters. An account that reaches nothing at all still gets the last two, which is why this list
# is never empty and the assistant never has to say it can do nothing.
_CAPABILITY_CLUBS = "find clubs that match their interests, and answer questions about a club"
_CAPABILITY_EVENTS = "suggest events that fit what they are looking for, and answer questions about an event"
_CAPABILITY_PAGES = "explain what any page of this app is used for"
_CAPABILITY_HOW_TO = "show them how to perform an action in the system, step by step"
_CAPABILITY_SELF = "tell them who they are signed in as, what role they hold, and what they can access"


def capability_document(principal) -> str:
    """The CONTEXT for "what can you do?" - computed from THIS caller's live access, never a fixed
    paragraph.

    The three cases the spec calls out fall straight out of the two topic checks: clubs and events,
    events but not clubs, neither. There is no branch for them here because there does not need to
    be - the list is assembled from whatever is true, and a capability the caller does not have is
    simply not in it.
    """
    capabilities: list[str] = []
    if has_clubs(principal):
        capabilities.append(_CAPABILITY_CLUBS)
    if has_events(principal):
        capabilities.append(_CAPABILITY_EVENTS)
    capabilities.append(_CAPABILITY_PAGES)
    capabilities.append(_CAPABILITY_HOW_TO)
    if principal is not None:
        capabilities.append(_CAPABILITY_SELF)
    return "\n".join([
        "WHAT YOU CAN DO FOR THIS PARTICULAR ASKER. This list is computed from their live access "
        "and is COMPLETE and EXHAUSTIVE:",
        *(f"  - You can {line}." for line in capabilities),
        "State these naturally, in one or two short sentences, as things you can help with. Do NOT "
        "add, generalise, imply or hint at any capability that is not on this list - anything "
        "missing would be refused the moment they asked for it, so offering it is a broken "
        "promise. In particular, never offer to look up who is registered for an event, who is in "
        "a club, anybody's requests or approvals, reports, or anything else about this app or the "
        "world beyond the lines above.",
    ])


def greeting_hint_document(principal) -> str:
    """The CONTEXT line for a BARE greeting ("hey", "hi") - a one-line steer, not the enumerated
    capability list. A greeting deserves a short, casual reply, not a menu; this only says which
    topics are safe to mention, from the same live checks, so a greeting can never offer something
    the asker would then be refused.

    It deliberately supplies no sentence to copy: a greeting arriving word-for-word identical on
    every "hey" reads as a canned auto-reply, and the surest way to produce one is to hand the model
    a phrase to reuse.
    """
    vary = " Word the reply differently from any greeting already in this conversation."
    clubs, events = has_clubs(principal), has_events(principal)
    if clubs and events:
        return "This asker can ask about both clubs and events - casually offer help with either." + vary
    if clubs:
        return "This asker can ask about clubs but not events - casually offer help with clubs only." + vary
    if events:
        return "This asker can ask about events but not clubs - casually offer help with events only." + vary
    return (
        "This asker can ask about neither clubs nor events - casually offer help with finding your "
        "way around the app and how to do things in it, and mention nothing else." + vary
    )


# --- Refusals ----------------------------------------------------------------------------------

def denial_document(principal, denied: list[str]) -> str:
    """A topic the caller could have asked about, but their role cannot reach.

    Distinct from out_of_scope_document below: this one IS a permissions decision, so it is the one
    place an administrator is the right thing to mention - and only for an internal account, where
    a grant genuinely exists to be given.
    """
    labels = " and ".join(TOPIC_LABEL.get(topic, topic) for topic in denied) or "that"
    tier = scope.tier_of(principal)
    # THE WORD "ADMINISTRATOR" APPEARS IN EXACTLY ONE BRANCH, and the other two do not mention it
    # even to forbid it. Naming a thing in order to prohibit it is how it ends up in the reply
    # anyway; the branches where an administrator is the wrong answer simply say what IS true.
    if tier == scope.GUEST:
        reason = (
            f"The asker is NOT SIGNED IN, and {labels} is not available to a signed-out visitor. "
            "Say so plainly and point them at signing in. They hold no account, so there is nobody "
            "for them to ask about access and nothing to be fixed."
        )
    elif tier == scope.EXTERNAL:
        reason = (
            f"The asker holds a VISITOR ACCOUNT, which does not cover {labels} - that is what the "
            "account is for, not a fault in it. Say so plainly, as a fact about the account rather "
            "than a missing permission. Their account is working correctly and there is nobody for "
            "them to ask to change it."
        )
    else:
        reason = (
            f"The asker's role has not been granted the pages {labels} lives on, so the assistant "
            "cannot cover it for them. Say plainly that they do not have access to that, and that "
            "an administrator would have to grant it if they think that is wrong."
        )
    return (
        reason
        + " Do not answer that part of their question, and do not invent, guess or substitute any "
          "detail for it. If their question ALSO covers something they do have access to, answer "
          "that part normally in the same reply."
    )


def out_of_scope_document(principal) -> str:
    """A question outside everything the assistant does - the ordinary refusal, and the one that
    must NOT mention permissions.

    Nothing here is gated: no grant would unlock who registered for an event, an approval workflow,
    a report, or the capital of France. Telling someone to contact an administrator about a
    capability the assistant does not have for anybody sends them to ask for something that cannot
    be given, so this document says plainly that it is not something the assistant covers, and
    offers what it does.
    """
    can_do: list[str] = []
    if has_events(principal):
        can_do.append("- suggest events, and answer questions about an event")
    if has_clubs(principal):
        can_do.append("- suggest clubs, and answer questions about a club")
    can_do.append("- explain what a page of this app is for")
    can_do.append("- walk them through how to do something they have access to")
    if principal is not None:
        can_do.append("- tell them who they are signed in as and what they can access")
    return "\n".join([
        "This question is OUTSIDE what the assistant does. Not blocked, not a permissions problem - "
        "simply not something it covers for anyone. So do NOT imply that a permission, a grant or "
        "somebody's approval would unlock it, do NOT point them at anyone to ask, and do NOT invite "
        "them to rephrase, since no wording of it has an answer here.",
        "What the assistant CAN do for this particular asker:",
        *can_do,
        "Say briefly and politely that this is outside what you can help with, name one or two "
        "things from the list above instead, and attempt no answer, no guess, and no "
        "general-knowledge response - not even partially, and not 'just this once'.",
    ])


def unanswerable_document() -> str:
    """The lookup ran and could not produce anything - a transient failure on the retrieval side.

    Deliberately vague to the asker (the real reason names tables and columns, which is exactly what
    a prober wants) while the precise reason goes to the log. It does NOT ask for a rewording: this
    is reached for questions the retrieval step could not express, where the wording was not the
    problem, and suggesting a fix that cannot work sends the asker round the same loop.
    """
    return (
        "The assistant could not look this up. Say briefly and plainly that you don't have that "
        "information available right now. Do NOT guess at an answer, do NOT state that they have "
        "none of something, and do not mention databases, queries or errors. Do NOT suggest they "
        "rephrase or reword - the wording was not the problem."
    )


# --- Who is asking ------------------------------------------------------------------------------

def who_am_i_document(principal) -> str:
    """The CONTEXT for "who am I / what role do I have / what can I access".

    Every line comes from the AUTHENTICATED token and the live grant tables - never from anything
    the question claims about itself. "I'm the manager" in a question changes nothing here, because
    nothing here reads the question.

    Pages and functions are listed as the ANSWER to "what can I access", so it is their real,
    current access rather than a role description frozen at deploy time.
    """
    if principal is None:
        return "\n".join([
            "WHO IS ASKING: nobody signed in. They are a visitor browsing without an account - the "
            "ordinary state, not a broken one - there is nothing wrong for anyone to fix.",
            "What they can reach: " + ", ".join(
                page.name for page in scope.reachable_pages(principal)
            ) + ".",
            "They hold no account, no name, no role and no personal data here. Signing in adds "
            "saved events and their own registrations under My Events. Tell them plainly that they "
            "are not signed in, say what they can still do, and offer signing in for the rest.",
        ])
    roles = sorted({code for code, _unit in principal.assignments or ()})
    units = sorted({unit for _code, unit in principal.assignments or () if unit})
    pages = [page.name for page in scope.reachable_pages(principal)]
    functions = [fn.name for fn in scope.usable_functions(principal)]
    lines = [
        "WHO IS ASKING, from their signed-in account. Answer only from these lines, and only about "
        "the parts they asked about - a 'who am I' does not need the whole list read out:",
        f"Name: {principal.full_name}",
        f"Email: {principal.email}",
        f"Account type: {scope.TIER_LABEL[scope.tier_of(principal)]}",
        f"Role(s) held: {', '.join(roles) or 'none'}",
    ]
    if units:
        lines.append(f"Scoped to: {', '.join(units)}")
    lines.append(f"Pages they can open ({len(pages)}): {', '.join(pages) or 'none'}")
    lines.append(f"Actions they can perform: {', '.join(functions) or 'none'}")
    lines.append(
        "This list is their COMPLETE current access - anything absent is something they genuinely "
        "cannot reach. Keep the reply short: answer what was asked, and offer to go through the "
        "rest rather than listing everything at once."
    )
    return "\n".join(lines)


def user_context_document(principal, intents: set[str]) -> str:
    """Who is asking, in the form the retrieval step and the reviewer both need.

    Shared by both deliberately: a reviewer judging an answer against a DIFFERENT account summary
    than the one the retrieval ran under would be reviewing a fiction.
    """
    if principal is None:
        return (
            "The asker is a GUEST (not signed in). They have no user_id, no roles and no account. "
            "They browse the public landing page only - Happening Soon, Explore Events and the "
            "Event Calendar - which show published Public events. They have no clubs, no "
            "memberships, no registrations to look up, and no personal data of any kind."
        )
    roles = sorted({code for code, _unit in principal.assignments or ()})
    return "\n".join([
        f"Asker: {principal.full_name} (user_id={principal.user_id}).",
        f"Account type: {scope.TIER_LABEL[scope.tier_of(principal)]}.",
        f"Roles: {', '.join(roles) or 'none'}.",
        f"Topics they may ask about: {', '.join(allowed_topics(principal)) or 'none'}.",
        f"This turn was read as: {', '.join(sorted(intents)) or 'nothing in scope'}.",
    ])


# --- The audit log ------------------------------------------------------------------------------

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


def _log_refusals(principal, rows: list[tuple[str, str | None, str | None, str | None, str | None]], question: str) -> None:
    """Write refusal rows to ai_access_denial - the shared body behind log_denials(),
    log_function_denial() and log_unanswerable().

    Each row is (outcome, topic, topic_label, required_pages, reason). `outcome` is what turns this
    from a pure page-denial log into the "why did the assistant not answer" log the admin page needs:
      page_denied         - the caller cannot reach any page the topic's data lives on
      how_to_page_denied  - the caller cannot perform the ACTION they asked how to perform
      out_of_scope        - the question is outside the seven things this assistant does
      unsupported         - an in-scope shape with no definition behind it yet (the actionable one:
                            it names the page or function somebody should write)

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
        # One transaction for every topic this question was refused for - a write, so transaction()
        # (which commits); query() runs in read_cursor() and rolls back, which would silently
        # discard the row.
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
    """A data topic was refused because the caller can reach none of the pages it lives on."""
    _log_refusals(
        principal,
        [
            ("page_denied", t, TOPIC_LABEL.get(t, t), ", ".join(scope.topic_pages(t)), None)
            for t in topics
        ],
        question,
    )


def log_function_denial(principal, function_key: str, question: str) -> None:
    """The caller asked HOW to do something they cannot do."""
    fn = scope.FUNCTIONS.get(function_key)
    _log_refusals(
        principal,
        [(
            "how_to_page_denied",
            f"how_to:{function_key}",
            fn.name if fn else function_key.replace("_", " "),
            ", ".join(fn.pages) if fn else None,
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
