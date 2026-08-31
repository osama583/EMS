"""The ONE place that decides whether a caller may ask about a given topic.

WHAT DECIDES: ai/scope.py's Area table. Every topic names the AREAS that own its data, and a caller
may ask if they can stand in any of them - which for an internal page is Page Visibility
(nav_page_grants, edited at /app/admin/page-visibility), exactly as before, and for the public
landing page and the visitor's own My Events is the tier the app's route guards already enforce.

WHY THE AREA TABLE REPLACED A PAGE LIST HERE. This module used to map a topic straight onto
nav_page codes, with a hand-maintained GUEST_OPEN_TOPICS set bolted on the side for the one topic
guests were allowed. That model has one surface where the app has three, and it produced the two
opposite failures the 2026-09-01 sweep found:

  TOO MUCH  `event_organiser_decisions` was mapped onto `history`, a shared hub nine roles hold for
            nine different reasons. A Club Admin holds it to see decided president-change requests,
            so the assistant offered them "the registration decisions you've made as an organiser"
            - a role that cannot organise an event - and then had nothing to show. Every topic now
            names the page that OWNS its data (organiser topics: `proposal-form`, the grant the UI
            itself checks before showing the Registrations tab), never a hub that merely displays a
            tab of it.
  TOO LITTLE An external account holds NO nav pages, by design - external accounts never enter the
            /app shell, they use the public landing page and /my-events. Keying everything off
            nav_page therefore refused them every question, including questions about the very
            sections they were looking at. Their surface is now described (scope.VISITOR /
            scope.EXTERNAL_ONLY areas) instead of being absent.

STILL TRUE, and deliberately unchanged:

  NO ADMIN BYPASS      a System Admin is checked exactly like everyone else. If system-admin is not
                       on a page's grant list, the assistant refuses that topic for them too.
  NO ROLE NAMES        nothing here reads has_role(). A CUSTOM role granted Manage Clubs in Page
                       Visibility gets the club-admin answers with no code change, and revoking a
                       page stops the answers on the very next request.
  MULTI-ROLE           has_page_access() takes the whole assignment tuple, so a Student + Club
                       Admin is allowed whatever EITHER role allows - the union, never the
                       intersection.
  UNGATED CLASSES      a class absent from scope.TOPICS is ungated deliberately, not by omission:
                       greeting / self_capability / askable / system_capability / role_capability /
                       page_purpose answer from static text about the app itself and expose no
                       one's data. tests/test_ai_scope.py asserts every DATA class is gated.

REFUSALS ARE WORDED BY TIER, which is the other half of the same fix. "An administrator has not
granted your role that page" is true for an internal account, misleading for an external one (whose
account is working exactly as intended), and nonsense for a guest (who has no account and no
administrator). All three sentences now come from the caller's tier - see denial_document().
"""
from __future__ import annotations

import logging

from . import scope
from .scope import (  # noqa: F401 - re-exported: these ARE the topic map, now derived from scope
    TOPIC_ASK_DESCRIPTION,
    TOPIC_LABEL,
    TOPIC_PAGES,
)

log = logging.getLogger(__name__)


def topic_allowed(principal, topic: str) -> bool:
    """May this caller ask about `topic`? True for an ungated topic (one with no entry in
    scope.TOPICS) and for any topic with an area this caller can actually stand in."""
    areas = scope.topic_areas(topic)
    if topic not in scope.TOPICS:
        return True
    return any(scope.can_reach(principal, area) for area in areas)


def denied_topics(principal, classes: set[str]) -> list[str]:
    """Every classified topic this caller may NOT ask about, in stable order so the log and the
    denial message read the same way every time."""
    return sorted(topic for topic in classes if not topic_allowed(principal, topic))


def how_to_allowed(principal, guide_key: str) -> bool:
    """May this caller be given the STEPS for `guide_key`?

    The how-to half of the same Area rule topic_allowed() applies to data topics: a guide is gated
    on where its action actually happens (scope.GUIDES[...].areas), so revoking that page stops the
    instructions on the very next answer and re-granting it restores them.

    An UNKNOWN key returns False, and that is a change. It used to return True so that a guide
    missing from the map was not silently withheld - but api/ai.py then answered the question from
    the general system overview, which is how an external account that had just been refused every
    topic was handed working steps for saving an event. A key absent from scope.GUIDES is a guide
    nobody has written; the honest answer is that the assistant has no instructions for it, and
    tests/test_ai_scope.py fails on the coding gap rather than leaving it to leak at runtime.
    """
    guide = scope.GUIDES.get(guide_key)
    if guide is None:
        return False
    if not all(scope.can_reach(principal, area) for area in guide.requires):
        return False
    return any(scope.can_reach(principal, area) for area in guide.areas)


# --- Navigation cards -------------------------------------------------------------------------

def page_card(principal, area_code: str) -> dict | None:
    """A navigation card pointing at `area_code`, or None if this caller cannot reach it.

    Built from the SAME reachability check that gates the answer, so a card can never offer
    somewhere the caller would be bounced out of.

    Internal pages read their label and route LIVE from nav_page, so renaming or re-routing a page
    in the database is reflected without touching this module. Visitor areas have no nav_page row -
    they are sections of the public landing page - so they card from the Area definition itself.
    """
    if not scope.can_reach(principal, area_code):
        return None
    area = scope.AREAS[area_code]
    if area.reach != scope.PAGE:
        return {"pageCode": area.code, "label": area.label, "routePath": area.route} if area.route else None

    from ..db import query_one

    row = query_one(
        """
        SELECT page_code, label, route_path
          FROM nav_page
         WHERE page_code = %s AND is_active AND archived_at IS NULL
        """,
        (area_code,),
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
    guide = scope.GUIDES.get(guide_key)
    cards = [page_card(principal, area) for area in (guide.areas if guide else ())]
    return [card for card in cards if card]


def topic_cards(principal, topics: set[str], limit: int = 2) -> list[dict]:
    """"Take me there" cards for the areas a set of DATA topics lives in.

    The how-to equivalent (how_to_cards) has always existed; this is the same idea for a data
    answer, because "where can I find my registrations" classifies as DATA (my_registrations), not
    a how-to, so it resolved no guide and got no card at all - a location question answered with
    prose and nothing to click.

    Capped, because a question touching three topics does not need three navigation cards under a
    two-sentence reply.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for topic in sorted(topics):
        for area_code in scope.topic_areas(topic):
            if area_code in seen:
                continue
            seen.add(area_code)
            card = page_card(principal, area_code)
            if card:
                out.append(card)
                if len(out) >= limit:
                    return out
    return out


# --- The documents handed to the model ---------------------------------------------------------

def askable_topics_document(principal) -> str:
    """The CONTEXT block answering "what can I ask about?" - built live from the same reachability
    check that gates every answer, so it can never promise something the assistant would then
    refuse, nor omit something it would happily answer.

    This is the block that mis-sold a Club Admin "registration decisions you've made as an
    organiser". The list itself was always computed correctly; what was wrong was the topic map
    underneath it, now fixed in scope.py.
    """
    seen: set[str] = set()
    lines: list[str] = []
    for topic, description in TOPIC_ASK_DESCRIPTION.items():
        if description in seen or not topic_allowed(principal, topic):
            continue
        seen.add(description)
        lines.append(f"- {description}")

    if not lines:
        return _no_topics_document(principal)
    return (
        "The topics THIS asker can ask about, computed live from what they can actually reach. "
        "This is the complete list - do not add, invent, or imply any other topic, and do not "
        "mention anything absent from it (they would be refused if they asked):\n"
        + "\n".join(lines)
        + "\nThey can also ask what any part of the app is for, and how to do the things they have "
          "access to. Present this as a short, friendly list of what you can help with."
    )


def _no_topics_document(principal) -> str:
    """"What can you help me with" from an account that reaches no data topic at all.

    Three different truths, because the three tiers are in genuinely different situations, and
    saying the internal one to the other two is how a guest was told to contact an administrator
    about an account they do not have.
    """
    tier = scope.tier_of(principal)
    if tier == scope.GUEST:
        return (
            "This asker is NOT SIGNED IN and reaches no personal data at all - the ordinary state "
            "for a visitor, not a broken account. They can still ask what any part of this app is "
            "for and how it works. Say what you can help with in that framing, and mention signing "
            "in for anything personal. Never suggest contacting an administrator."
        )
    if tier == scope.EXTERNAL:
        return (
            "This asker holds a VISITOR ACCOUNT (external, not a university account). Their account "
            "is working exactly as intended - it is for browsing published events, registering for "
            "them, and keeping saved events - and it deliberately has no access to clubs, "
            "proposals, or any internal university page. Say what you can help with, and never "
            "suggest their account is misconfigured or that they should contact an administrator."
        )
    return (
        "This asker's role has not been granted any data topic in this app, so the assistant can "
        "only help with general questions about how the app works and what their account is for. "
        "Say that plainly and suggest they contact an administrator if they expected more."
    )


def greeting_hint_document(principal) -> str:
    """The CONTEXT line for a BARE greeting ("hey", "hi") - a one-line steer, not the full
    enumerated capability list askable_topics_document() returns. A greeting deserves a short,
    casual reply, not a menu; this only tells the model which topics are safe to mention, computed
    from the same live checks, so a greeting can never offer something the asker would be refused.
    """
    # The hint names the permitted TOPICS and deliberately supplies no sentence to copy: a greeting
    # arriving word-for-word identical on every "hey" reads as a canned auto-reply, and the surest
    # way to produce one is to hand the model a phrase to reuse.
    vary = " Word the reply differently from any greeting already in the conversation history."
    has_clubs = any(topic_allowed(principal, t) for t in ("clubs", "clubs_mine", "clubs_admin"))
    has_events = any(topic_allowed(principal, t) for t in ("events", "my_registrations", "event_organiser"))
    if has_clubs and has_events:
        return "This asker can ask about both clubs and events - casually offer help with either." + vary
    if has_clubs:
        return "This asker can ask about clubs but not events - casually offer help with clubs only." + vary
    if has_events:
        return "This asker can ask about events but not clubs - casually offer help with events only." + vary
    return (
        "This asker has no clubs or events access - casually offer help with the app itself and "
        "what their account is for, not clubs or events." + vary
    )


def denial_document(principal, denied: list[str]) -> str:
    """Told to the model when the gate refused one or more of a question's topics, so the answer
    says plainly what it cannot cover instead of silently omitting it - an omission reads as "there
    is nothing", which is a different and wrong answer.

    The REASON is chosen by tier. The old single sentence ("an administrator has not granted your
    role the pages that information lives on") was told to a signed-out guest asking about saved
    events, who was then advised to contact an administrator about an account they do not have.
    """
    labels = sorted({TOPIC_LABEL.get(t, t) for t in denied})
    listed = labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + f" and {labels[-1]}"
    tier = scope.tier_of(principal)
    if tier == scope.GUEST:
        reason = (
            f"The asker is NOT SIGNED IN, so {listed} does not exist for them - there is no account "
            "holding it. Tell them plainly that this needs an account and point them at signing in "
            "or creating one. Do NOT say a page is unavailable 'for their role', do NOT suggest "
            "contacting an administrator, and do NOT imply anything is wrong - a visitor without an "
            "account is the ordinary case, not a fault."
        )
    elif tier == scope.EXTERNAL:
        reason = (
            f"The asker holds a VISITOR ACCOUNT, which does not include {listed} - that part of the "
            "app is for university staff and students. Say so plainly as a fact about what a "
            "visitor account is for. Do NOT frame it as a missing permission, do NOT suggest "
            "contacting an administrator, and do NOT imply their account is misconfigured."
        )
    else:
        reason = (
            f"This asker does not have access to {listed} - an administrator has not granted their "
            "role the pages that information lives on (Page Visibility). Tell them plainly they do "
            "not have access to that, and that an administrator would have to grant it."
        )
    return (
        reason
        + " Do not answer that part of their question, and do not invent, guess, or substitute any "
          "detail for it. If their question ALSO covers something they do have access to, answer "
          "that part normally."
    )


def how_to_denial_document(principal, guide_key: str) -> str:
    """The refusal for a how-to whose ACTION this caller cannot perform.

    Deliberately distinct from denial_document above: that one names a data TOPIC ("you cannot see
    clubs"), which is the wrong explanation for a procedural question. Here the caller asked how to
    DO something, and the honest reason is that the action is not theirs to take.
    """
    guide = scope.GUIDES.get(guide_key)
    label = guide.label if guide else guide_key.replace("_", " ")
    tier = scope.tier_of(principal)
    if tier == scope.GUEST:
        why = ("That needs an account - point them at signing in or creating one, and never at an "
               "administrator.")
    elif tier == scope.EXTERNAL:
        why = ("A visitor account cannot do that; it is for university staff and students. Say so "
               "as a fact about the account, not as a missing permission, and never suggest "
               "contacting an administrator.")
    else:
        why = ("Their role has not been granted the page that action happens on, so an "
               "administrator would have to grant it.")
    return (
        f"This asker cannot do this: {label}. {why} Tell them plainly that this is not something "
        "they can do, and do NOT give the steps, describe the screen, or suggest a workaround."
    )


def unsupported_how_to_document(principal) -> str:
    """A "how do I..." this assistant has no guide for.

    It used to fall through to the whole system overview, which is how an account with no access to
    anything was handed real, working instructions for an action nobody had checked it could take.
    A missing guide is a missing guide: say so, and offer the ones that exist for this caller.
    """
    available = sorted({
        guide.label for guide in scope.GUIDES.values()
        if any(scope.can_reach(principal, area) for area in guide.areas)
    })
    offer = (
        "The things you CAN give step-by-step instructions for, for this asker: "
        + "; ".join(available)
        + ". Offer one or two of these if any of them is close to what they asked."
        if available else
        "There is nothing this asker can be given step-by-step instructions for."
    )
    return (
        "The asker wants step-by-step instructions for something this assistant has no written "
        "guide for. Say plainly that you don't have instructions for that. Do NOT improvise steps, "
        "name buttons, describe screens, or infer a procedure from how similar apps work - a "
        "made-up procedure sends someone looking for a control that does not exist. " + offer
    )


def out_of_scope_document(principal) -> str:
    """The single scope statement for a question this assistant does not cover.

    Built from the caller's OWN reachable areas rather than from a fixed paragraph, so the "here is
    what I can help with" half is true for the person reading it. The fixed paragraph named clubs
    and registrations to every asker, including the two tiers that have neither.
    """
    can_do = sorted({
        topic.ask_description for key, topic in scope.TOPICS.items() if topic_allowed(principal, key)
    })
    covered = ("\n".join(f"- {line}" for line in can_do) if can_do else
               "- (no data topics: this asker can ask about the app itself and their own account only)")
    return (
        "This question is outside what the assistant covers. What it CAN help this particular "
        f"asker with:\n{covered}\n"
        "- what any part of this app is for, and how to do the things they have access to\n"
        "It does NOT answer questions about cafeteria menus and food, system administration, user "
        "directories, the university's staff or org chart, or anything outside this app. Say "
        "briefly and politely that this is outside what you can help with, name a couple of things "
        "from the list above that you CAN help with, and do not attempt an answer, a guess, or a "
        "general-knowledge response."
    )


def user_context_document(principal, topics: set[str]) -> str:
    """Who is asking, in the form the SQL generator and the reviewer both need.

    Assembled from AUTHENTICATED backend data only - the token's principal and the live
    reachability checks - never from anything the question claims about itself. That is the entire
    point: "I am the manager" in a question changes nothing here, because nothing here reads the
    question.

    Shared by both callers deliberately. The reviewer judging an answer against a DIFFERENT account
    summary than the one the SQL was generated under would be reviewing a fiction.
    """
    tier = scope.tier_of(principal)
    if principal is None:
        return (
            "The asker is a GUEST (not signed in). They have no user_id, no roles and no account. "
            "They browse the public landing page only: Happening Soon, Explore Events and the "
            "Event Calendar, all of which show published Public events. They have no saved events, "
            "no registrations they can look up, no clubs, no memberships, and no personal data of "
            "any kind."
        )
    roles = sorted({code for code, _unit in principal.assignments or ()})
    granted = sorted({topic for topic in scope.TOPICS if topic_allowed(principal, topic)})
    reachable = [area.label for area in scope.reachable_areas(principal)]
    lines = [
        f"Asker: {principal.full_name} (user_id={principal.user_id}, email={principal.email}).",
        f"Account type: {scope.TIER_LABEL[tier]}.",
        f"Roles: {', '.join(roles) or 'none'}.",
        f"Areas of the app they can actually open: {', '.join(reachable) or 'none'}.",
        f"Topics they may ask about: {', '.join(granted) or 'none'}.",
        f"Topics this question was classified as: {', '.join(sorted(topics)) or 'none'}.",
    ]
    return "\n".join(lines)


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
    log_how_to_denial() and log_unanswerable().

    Each row is (outcome, topic, topic_label, required_pages, reason). `outcome` is what turns this
    from a pure page-denial log into the "why did the assistant not answer" log the admin page needs:
      page_denied         - the caller cannot reach any area the topic's data lives in
      how_to_page_denied  - the caller cannot perform the ACTION they asked how to perform
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
    """A data topic was refused because the caller can reach none of the areas it lives in."""
    _log_refusals(
        principal,
        [
            ("page_denied", t, TOPIC_LABEL.get(t, t), ", ".join(scope.topic_areas(t)), None)
            for t in topics
        ],
        question,
    )


def log_how_to_denial(principal, guide_key: str, question: str) -> None:
    """The caller asked HOW to do something they cannot do."""
    guide = scope.GUIDES.get(guide_key)
    _log_refusals(
        principal,
        [(
            "how_to_page_denied",
            f"how_to:{guide_key}",
            guide.label if guide else guide_key.replace("_", " "),
            ", ".join(guide.areas) if guide else None,
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
