"""Recommendation questions - "what fits me", "what do you suggest", "any good events?"

These are NOT fact lookups, and treating them as one is what made the assistant read as a database
with a chat box bolted on. Observed in a real session:

    > can u suggest event for me
    You might be interested in these upcoming events:
    School of Computing Research Symposium: ...
    Business Society Networking Lunch: ...
    Annual Hackathon Kickoff: ...
    (five items, no reason, no question, the same five for every asker)

Three separate faults in that one reply, each fixed in a different place:

  1. IT NEVER ASKED. "What fits me" is a preference question and the assistant does not know the
     asker's preferences - nobody has ever told it. Dumping the catalogue is what you do when you
     have not bothered to find out. FIRST such question in a conversation asks; only after they
     answer does it recommend. This module decides which of those two situations applies
     (`stage_for`), and the prompt in sql_llm.py enforces the behaviour.

  2. IT ANSWERED THE WRONG QUESTION. "What can you suggest for me?" names neither events nor clubs.
     The classifier guessed `events` and the assistant committed to that guess silently. An
     ambiguous recommendation asks which they meant rather than picking one.

  3. IT DUMPED EVERYTHING. A recommendation is a SHORTLIST with reasons. Nobody asks "what fits me"
     wanting nine rows back. Scoped to MAX_SUGGESTIONS, upcoming-only, and every item has to carry
     a statable reason.

WHAT THE ASSISTANT MAY USE AS A REASON. Only two things: what the asker has actually TOLD it in
this conversation, and their real history rows (past registrations, past join requests). Never
their school, their department, their name, or the title of the thing being recommended - inferring
"you're in Computing so you'll like the hackathon" is a fabrication dressed as personalisation, and
the old system prompt had a whole paragraph about it because the model kept doing exactly that.

HISTORY IS NOT A SUBSTITUTE FOR ASKING. Attending one thing says nothing about wanting more of it.
History shapes what the assistant asks and supports a reason once given; it never skips the ask.
"""
from __future__ import annotations

import logging
import re

from ..db import query

log = logging.getLogger(__name__)

# A recommendation names at most this many things. The number is the point: a shortlist with
# reasons is a recommendation, a list of nine is a search result.
MAX_SUGGESTIONS = 3

# History rows fetched for the model to reason from. Enough to show a pattern, few enough that they
# cannot crowd out the actual candidates in the prompt.
_HISTORY_LIMIT = 8


# "Recommend", "suggest", "what fits me", "what should I", "anything good" - the shapes a
# preference question takes. Deliberately generous: a false positive costs one clarifying question
# (mildly annoying), a false negative costs the whole ask-first flow (the bug being fixed).
_RECOMMENDATION = re.compile(
    r"\b(recommend|recommendation|suggest|suggestion)\b"
    r"|\b(fits?|suits?|good for|best for)\s+me\b"
    r"|\bwhich.{0,25}\bshould i\b"
    r"|\bwhat should i (join|attend|go to|do)\b"
    r"|\banything (good|interesting|fun|worth)\b"
    r"|\bbest (event|club)s?\b.{0,15}\bfor me\b"
    r"|\bfor me\b.{0,20}\b(event|club)s?\b",
    re.IGNORECASE,
)

# Does the question itself say WHICH domain? "Suggest an event" is unambiguous; "what do you
# suggest" is not, and guessing is how the real session ended up answering about events when the
# asker may well have meant clubs.
_NAMES_EVENTS = re.compile(r"\bevents?\b|\bworkshops?\b|\btalks?\b|\bcompetitions?\b|\bactivit(y|ies)\b", re.IGNORECASE)
_NAMES_CLUBS = re.compile(r"\bclubs?\b|\bsociet(y|ies)\b|\bjoin\b", re.IGNORECASE)


def is_recommendation(question: str) -> bool:
    return bool(_RECOMMENDATION.search(question))


def named_domain(question: str) -> str | None:
    """'events' | 'clubs' | None. None means the asker did not say, and the assistant must ask
    rather than guess - the fault that produced an events answer to a domain-less question."""
    events, clubs = bool(_NAMES_EVENTS.search(question)), bool(_NAMES_CLUBS.search(question))
    if events and not clubs:
        return "events"
    if clubs and not events:
        return "clubs"
    return None


def _asker_already_stated_interests(history: list[dict] | None) -> bool:
    """Has the asker already answered the "what are you interested in" question earlier in THIS
    conversation? If so, asking again is the assistant not listening - which is its own kind of
    unhelpful, and was explicitly called out in the old flow.

    Detected by looking for a turn where the assistant ASKED about interests and the asker replied
    with something substantive, rather than by trying to parse interests out of free text."""
    if not history:
        return False
    for turn in history:
        answer = (turn.get("answer") or "").lower()
        asked = any(
            phrase in answer
            for phrase in ("interested in", "what kind of", "what sort of", "hobbies", "enjoy")
        )
        if asked:
            return True
    return False


def stage_for(question: str, history: list[dict] | None) -> str:
    """Which half of the two-part flow this question is in.

    "ask"       first recommendation request in the conversation, and the asker has not already
                said what they like. The reply is ONE question and nothing else.
    "clarify"   they want a recommendation but did not say events or clubs. Ask which.
    "recommend" they have told us enough; produce a shortlist with reasons.
    """
    if not is_recommendation(question):
        return "recommend"
    if _asker_already_stated_interests(history):
        return "recommend"
    if named_domain(question) is None:
        return "clarify"
    return "ask"


# The two data domains a question can land in. A question that lands in BOTH without naming
# either is not a question yet - it is a fragment whose antecedent is missing.
_CLUB_CLASSES = frozenset({"clubs", "clubs_mine", "clubs_admin", "president_change"})
_EVENT_CLASSES = frozenset({"events", "my_registrations", "event_organiser", "event_organiser_decisions"})


# Referents that point at something said earlier and carry no meaning without it. Kept to phrases
# that are unresolvable BY CONSTRUCTION - "this or that" names two things while identifying
# neither - so a question containing one with no conversation behind it cannot have been answered,
# only guessed at. Bare "which one" is deliberately absent: it already reaches the no-topic path
# and clarifies there, and catching it here would fire on "which one has the most members".
_DANGLING_REFERENT = re.compile(
    r"\bthis or that\b|\bthe other one\b|\bthat one\b|\bthis one\b|\bthe one with\b",
    re.IGNORECASE,
)


def domain_ambiguous(question: str, history: list[dict] | None, data_classes: set[str]) -> bool:
    """Should this question be answered with a clarifying question instead of a query?

    True only for the genuinely unanswerable shape: a question with NO conversation behind it that
    lands in both the club and the event domain while naming neither. "which one got nobody" is the
    real example - it classified as {clubs, events}, was queried across both, and came back as
    "I don't have access to information about event attendance or registration counts", which is
    false twice over (registration counts are public, and the asker was never told which domain the
    assistant had picked). Guessing produced a wrong answer; asking costs one short sentence.

    Deliberately narrow. History present means the antecedent is resolvable and the classifier has
    already used it, and naming either domain means there is nothing to disambiguate - so an
    ordinary question like "how many events have nobody registered" never reaches this.
    """
    if history:
        return False
    # A dangling referent is unanswerable even inside ONE domain: "which has more ppl this or that"
    # classifies cleanly as events, and was answered by comparing two events the asker never named.
    if _DANGLING_REFERENT.search(question):
        return True
    if not (data_classes & _CLUB_CLASSES and data_classes & _EVENT_CLASSES):
        return False
    return named_domain(question) is None


def history_document(user_id: int | None) -> str | None:
    """The asker's REAL history - events they registered for, clubs they asked to join.

    Handed to the model as background it reasons from, never as something to recite back. It exists
    so a recommendation can be grounded in something true ("you went to two coding events") instead
    of the invented rationale the old system kept producing ("based on your interest in
    technology", said to someone who had never mentioned technology).

    Scoped to the asker's OWN rows only, by user_id, so this adds no new visibility: these are
    exactly the rows /events/me/registrations and /clubs/join-requests/mine already return to them.
    """
    if user_id is None:
        return None

    registrations = query(
        """
        SELECT r.event_title AS title,
               (SELECT string_agg(rc.category_name, ', ') FROM request_categories rc
                 WHERE rc.request_id = r.request_id) AS categories
          FROM event_registration er
          JOIN request r ON r.request_id = er.request_id
         WHERE er.user_id = %(user_id)s AND er.status <> 'cancelled'
      ORDER BY er.registered_at DESC
         LIMIT %(limit)s
        """,
        {"user_id": user_id, "limit": _HISTORY_LIMIT},
    )
    join_requests = query(
        """
        SELECT c.club_name AS title, jr.status
          FROM club_join_requests jr
          JOIN clubs c ON c.club_id = jr.club_id
         WHERE jr.requester_user_id = %(user_id)s
      ORDER BY jr.created_at DESC
         LIMIT %(limit)s
        """,
        {"user_id": user_id, "limit": _HISTORY_LIMIT},
    )

    if not registrations and not join_requests:
        return (
            "WHAT YOU KNOW ABOUT THIS ASKER: nothing yet - they have no past event registrations "
            "and no club join requests. You have NO basis for guessing what they like, so you must "
            "ask them before recommending anything."
        )

    lines = [
        "WHAT YOU KNOW ABOUT THIS ASKER (background for YOUR reasoning only - never recite these "
        "rows back to them, and never present this as a list):"
    ]
    if registrations:
        lines.append("  Events they have registered for before:")
        lines += [
            f"    - {row['title']}" + (f" [{row['categories']}]" if row["categories"] else "")
            for row in registrations
        ]
    if join_requests:
        lines.append("  Clubs they have asked to join before:")
        lines += [f"    - {row['title']} ({row['status']})" for row in join_requests]
    lines.append(
        "  Their stated interests and hobbies are NOT KNOWN. Do not claim they told you something "
        "they did not, and do not infer an interest from their school, department, name, or from "
        "the title of anything you are recommending."
    )
    return "\n".join(lines)


def in_recommendation_thread(question: str, history: list[dict] | None) -> bool:
    """Is this turn part of a recommendation conversation, even if the question itself does not say
    so?

    The follow-up that ANSWERS the assistant's "what are you interested in?" is the important case:
    "I like coding and building things" contains no recommendation wording of its own, so
    is_recommendation() is false for it - yet it is precisely the turn where the broad candidate
    retrieval matters. Without this the follow-up ran a narrow query, matched the literal word
    "coding" against nothing, and the assistant reported there were no events for them while a
    hackathon sat in the table.

    True when this turn asks for a recommendation OR the assistant asked about interests in the
    immediately preceding turn (the same signal _asker_already_stated_interests reads, restricted
    to the LAST turn so an old recommendation thread does not keep widening every later query).
    """
    if is_recommendation(question):
        return True
    if not history:
        return False
    last_answer = (history[-1].get("answer") or "").lower()
    return any(
        phrase in last_answer
        for phrase in ("interested in", "what kind of", "what sort of", "hobbies", "enjoy")
    )
