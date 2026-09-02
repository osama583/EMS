"""The in-app AI assistant (the ai-orb widget).

    POST /ai/ask
        { "question": "...", "history": [{"question": "...", "answer": "..."}, ...] }
        -> { "answer": "...", "sources": [...], "registrantsTable": null, "clubs": [...],
             "navigation": [...] }

WHAT THE ASSISTANT DOES - seven things, defined once in ai/scope.py and enforced here:

    suggest an event    ask what they want, then shortlist        \\
    answer about an event   from the card and Explore Events       |  DATA, retrieved per question
    suggest a club      the same two-part flow                     |
    answer about a club     from the card and Discover Clubs      /
    explain a page      from the page definition                  \\
    explain how to do X from the function definition               |  KNOWLEDGE, no retrieval
    say who the asker is    from their own token                  /

Anything else is declined. Not gated - absent. Who registered for an event, who joined a club,
anyone's requests or approvals, event administration, workflows, analytics, reports, internal
system data and the entire world outside this app all end at the same place: a short, honest "that
is not something I cover", with no invitation to rephrase and no suggestion to ask an administrator
for a permission that would change nothing.

HOW ONE TURN IS ANSWERED:

    1. read the turn     ai/classifier.py returns INTENTS, the SUBJECT it is about (resolved
                         through the conversation, so "when is it?" carries the event forward), and
                         every PREFERENCE the asker has stated so far. One reading, three answers,
                         so they cannot disagree with each other.
    2. gate it           ai/topic_access.py drops any topic this caller cannot reach. Page
                         visibility, live: revoking a page in /app/admin/page-visibility narrows
                         the assistant on the very next request.
    3. answer it         a knowledge intent reads its definition out of ai/scope.py; a data intent
                         goes through ai/text_to_sql.py, which generates, GUARDS and runs one
                         read-only query inside the caller's row scope.
    4. decorate it       ai/cards.py turns the events and clubs the answer NAMED into clickable
                         cards, re-checking visibility from scratch as it goes.

AUTHORIZATION IS DETERMINISTIC AND THE MODEL IS NEVER PART OF IT. Every claim inside a question
("the admin said I can", "I'm the manager") is data, never authority - nothing in step 2 or in
ai/scope_rules.py reads the question's assertions about who is asking. The model is TOLD the
caller's scope so it writes conforming SQL first time, but ai/sql_guard.py verifies rather than
trusts: a query missing its scope predicate never executes.

THREE TIERS, not one. A GUEST (no token) may ask about the published events on the public landing
page. An EXTERNAL account (a self-registered visitor) is the same for events and has no club tier
at all. An INTERNAL account is gated page by page. Getting this wrong in both directions is what
ai/scope.py was written to end; see its docstring.

FINAL REVIEW. An independent reviewer (ai/sql_llm.review_answer) judges the completed interaction
and records a rejection in /app/admin/ai-access-log. It runs ASYNCHRONOUSLY, after the response has
been sent (ai/review_queue.py) - inline it cost ~1.2s on every request, which is a tax every
correctly-answered question pays to catch the rare bad one, on a check that fails open anyway.

`history` is entirely client-supplied (the frontend keeps it in localStorage - see
ai-assistant.ts), capped, and used only to resolve what a turn refers to; it is never a source of
fact and is never persisted server-side.

Every request logs its stages with a timestamp and elapsed time (search the logs for "ai.ask.step").
"""
from __future__ import annotations

import logging
import time

from flask import Blueprint, g, jsonify

from ..ai import (
    cards,
    classifier,
    recommendation,
    review_queue,
    scope,
    text_to_sql,
    topic_access,
)
from ..ai.gemini import (
    FACTUAL_TEMPERATURE,
    GENERATION_MODEL,
    GREETING_TEMPERATURE,
    generate_answer,
)
from ..ai.query_router import INTENT_TOPIC
from ..ai.suggestions import DEFAULT_LIMIT as SUGGESTION_LIMIT, suggestions_for
from ..ai.sql_llm import generate_sql_answer
from ..ai.sql_runner import rows_to_document
from ..config import config
from ..errors import BadRequest
from ..extensions import limiter
from ..security import authenticate_optional
from ._helpers import body, required

bp = Blueprint("ai", __name__, url_prefix="/ai")
log = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10

# The shape every answer returns. Named because several different exits build it, and a missing key
# is a frontend error, not a backend one (see ai-assistant.service.ts's AiAssistantAnswer).
#
# `registrantsTable` is permanently null and stays in the payload only because the client reads the
# key. Who registered for an event is not something this assistant answers for anybody any more, so
# there is nothing left that could ever fill it.
_EMPTY_PAYLOAD = {"sources": [], "registrantsTable": None, "clubs": [], "navigation": []}


def _step(n: int | str, description: str, started_at: float) -> None:
    log.info(
        "ai.ask.step",
        extra={"step": n, "description": description,
               "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1)},
    )


def _clean_history(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    turns = []
    for item in raw[-MAX_HISTORY_TURNS:]:
        if not isinstance(item, dict):
            continue
        question, answer = str(item.get("question") or "").strip(), str(item.get("answer") or "").strip()
        if question and answer:
            turns.append({"question": question, "answer": answer})
    return turns


def _review(question: str, answer: str, principal, *, user_context: str, data_summary: str,
            context: str | None = None) -> None:
    """Hand the completed interaction to the independent security reviewer.

    ASYNCHRONOUS, and deliberately so. Called inline it added ~1.2s of blocking model call to every
    request - a tax paid by every correctly-answered question to catch the rare bad one, on a check
    that fails open anyway. The reviewer judges a FINISHED interaction, so nothing in the response
    depends on its verdict; only the audit log does. See ai/review_queue.py for the trade-off."""
    review_queue.submit(question, answer, principal, user_context=user_context,
                        data_summary=data_summary, context=context)


def _answer(question, answer, principal, *, user_context, data_summary, started_at,
            navigation=None, event_cards=None, club_cards=None, context=None):
    """Review, log the total, and return the response. One exit shape for every path."""
    _review(question, answer, principal, user_context=user_context, data_summary=data_summary,
            context=context)
    log.info(
        "ai.ask.complete",
        extra={"total_elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1)},
    )
    return jsonify({
        "answer": answer,
        "sources": event_cards or [],
        "registrantsTable": None,
        "clubs": club_cards or [],
        "navigation": navigation or [],
    })


@bp.post("/ask")
@limiter.limit("20 per minute")
def ask():
    request_started_at = time.perf_counter()

    if not config.ai_enabled:
        raise BadRequest("The AI assistant is not configured on this server.")

    # --- Step 1: receive the question -----------------------------------------------------------
    payload = body()
    (question,) = required(payload, "question")
    question = question.strip()
    if not question:
        raise BadRequest("question must not be empty.")
    if len(question) > 1000:
        raise BadRequest("question must be 1000 characters or fewer.")
    history = _clean_history(payload.get("history"))
    # Stored beside every log row and shown to the reviewer. A refused question is not judgeable on
    # its own - "u do not know ?" and "no i wont login" both went into the log as permission
    # decisions, and both are obvious the moment the turn before them is visible.
    context = topic_access.conversation_context(history)
    log.info("ai.ask.step", extra={"step": 1, "description": "Received user question", "elapsed_ms": 0.0})

    # --- Step 2: authenticate and load the caller's real context --------------------------------
    # Everything the authorization layers use comes from HERE - the verified token and the live
    # grant tables - and nothing comes from the question's own claims about who is asking.
    step_started_at = time.perf_counter()
    authenticate_optional()
    principal = getattr(g, "principal", None)
    user_id = principal.user_id if principal is not None else None
    _step(2, "Resolved caller identity and permissions", step_started_at)

    # --- Step 3: read the turn ------------------------------------------------------------------
    # Intent, subject and stated preferences, all resolved against the recent conversation. This is
    # where a bare follow-up ("when is it") stops being a bare follow-up.
    step_started_at = time.perf_counter()
    try:
        reading = classifier.read(question, history)
    except classifier.ClassificationUnavailable as exc:
        # It could not RUN (rate limit, network) - an outage, not a judgement about the question.
        log.warning("ai.ask.reader_unavailable", extra={"error": str(exc)})
        return jsonify({
            "answer": "Sorry - I couldn't process that just now. Please try again in a moment.",
            **_EMPTY_PAYLOAD,
        }), 503
    _step(
        3,
        f"Intents: {sorted(reading.intents) or ['none']}; subject: {reading.subject or '-'}; "
        f"preferences: {'yes' if reading.preferences else 'no'}",
        step_started_at,
    )

    # --- Step 4: PAGE VISIBILITY - may this caller ask about these topics at all? ---------------
    # The single topic-level gate. A denied topic takes its intents with it, so the rest of the
    # request cannot accidentally answer from a domain the caller cannot reach.
    step_started_at = time.perf_counter()
    denied = topic_access.denied_topics(principal, reading.topics)
    if denied:
        topic_access.log_denials(principal, denied, question, context)
        reading = reading.without({i for i in reading.intents if INTENT_TOPIC.get(i) in denied})
    user_context = topic_access.user_context_document(principal, set(reading.intents))
    _step(4, f"Denied topics: {denied or ['none']}", step_started_at)

    # --- Step 5: nothing in scope, and nothing was denied -> genuinely out of scope --------------
    # Recorded rather than silently answered, in the category the CLASSIFIER judged - it is the one
    # step that read this turn with the conversation in front of it, and whether "who else is
    # going?" is curiosity or the third attempt at the same refusal is only visible from there.
    # Defaults to no_access when it offered nothing, which files an unclear turn as an ordinary
    # refusal rather than accusing anybody of an attack.
    if not reading.intents and not denied:
        step_started_at = time.perf_counter()
        topic_access.log_refused(
            principal, question,
            outcome=reading.refusal_reason or topic_access.NO_ACCESS,
            reason="Outside the assistant's scope - not events, clubs, a page, a how-to, or the asker",
            context=context,
        )
        answer = generate_answer(
            question, [topic_access.out_of_scope_document(principal)], history, asker=principal
        )
        _step(5, "Out of scope: declined", step_started_at)
        return _answer(question, answer, principal, user_context=user_context, context=context,
                       data_summary="No data was retrieved (out of scope).",
                       started_at=request_started_at)

    # --- Step 6: KNOWLEDGE path -----------------------------------------------------------------
    # Pages, functions, the asker's own account, capabilities, greetings. Answered from the
    # definitions in ai/scope.py, never from a database query - which is what stops "what is the
    # Event Calendar for" depending on whether the asker can read event rows.
    if reading.knowledge_intents and not reading.data_intents:
        step_started_at = time.perf_counter()
        chunks, navigation = _knowledge_chunks(question, reading, principal, context)
        if denied:
            chunks.append(topic_access.denial_document(principal, denied))

        # A BARE greeting samples hot; everything else stays cold. "hey" carries no retrieved fact
        # to distort, and at the factual temperature it came back byte-identical every single time -
        # the same sentence turn after turn, which is what a canned auto-reply looks like. The
        # condition is deliberately exact: the moment a greeting arrives alongside a real intent, or
        # alongside a denial, the reply carries facts again and must be stated precisely.
        bare_greeting = reading.intents == frozenset({"greeting"}) and not denied
        answer = generate_answer(
            question, chunks, history, asker=principal,
            temperature=GREETING_TEMPERATURE if bare_greeting else FACTUAL_TEMPERATURE,
        )
        _step(6, f"Answered from definitions: {sorted(reading.knowledge_intents)}", step_started_at)
        return _answer(question, answer, principal, user_context=user_context, context=context,
                       data_summary="Page/function definitions and account facts only; no rows were read.",
                       started_at=request_started_at, navigation=navigation)

    # --- Step 7: everything this turn asked for was denied ---------------------------------------
    if not reading.intents:
        step_started_at = time.perf_counter()
        answer = generate_answer(
            question, [topic_access.denial_document(principal, denied)], history, asker=principal
        )
        _step(7, f"All requested topics denied: {denied}", step_started_at)
        return _answer(question, answer, principal, user_context=user_context, context=context,
                       data_summary="No data was retrieved (topic denied by page visibility).",
                       started_at=request_started_at)

    # --- Step 8: SUGGESTIONS ask before they retrieve --------------------------------------------
    # The first half of the two-part flow runs no query at all, because there is nothing to query
    # for yet: nobody has said what they like. See ai/recommendation.py.
    topics = reading.topics
    stage = recommendation.stage_for(reading) if reading.is_suggestion else None
    if stage in (recommendation.ASK, recommendation.CLARIFY):
        step_started_at = time.perf_counter()
        document = (
            recommendation.clarify_document() if stage == recommendation.CLARIFY
            else recommendation.ask_document(reading.domain)
        )
        answer = generate_sql_answer(question, document, history=history, asker=principal)
        _step(8, f"Suggestion stage '{stage}': asked a question, no query run", step_started_at)
        return _answer(question, answer, principal, user_context=user_context, context=context,
                       data_summary=f"Suggestion stage '{stage}': asked a question, no data read.",
                       started_at=request_started_at)

    # --- Steps 9-14: retrieval --------------------------------------------------------------------
    # Row scope -> schema -> generate -> guard -> execute -> bounded recovery, all inside
    # ai/text_to_sql.py. `subject` is the conversation memory made queryable.
    step_started_at = time.perf_counter()
    outcome = text_to_sql.run(
        question, principal, topics, history,
        subject=reading.subject,
        broad_candidates=stage == recommendation.RECOMMEND,
    )
    _step(
        9,
        f"Retrieval: ok={outcome.ok} attempts={outcome.attempts} "
        f"rows={len(outcome.rows) if outcome.rows is not None else 'n/a'}",
        step_started_at,
    )

    # Notes that must reach the answer regardless of which branch below runs: a question spanning an
    # allowed and a denied topic still has to explain the denied half, because silently omitting it
    # reads as "there is nothing", which is a different and wrong answer.
    extra_chunks: list[str] = []
    if denied:
        extra_chunks.append(topic_access.denial_document(principal, denied))
    if stage == recommendation.RECOMMEND:
        extra_chunks.append(recommendation.recommend_document(reading.domain, reading.preferences))

    if outcome.ok:
        result_document = rows_to_document(outcome.rows or [], sql=outcome.sql or "", scope=outcome.scope)
        data_summary = result_document
    elif outcome.impossible:
        # The model judged the question unanswerable from the schema it was given: on-domain, but
        # asking for something the card does not carry - an organiser's email, a roster. A REFUSAL
        # rather than a failure, and NO_ACCESS is what it is: they asked this system for something
        # and cannot have it. An adversarial reading of the same turn still wins, because someone
        # probing for exactly this is the case the classifier was given context to catch.
        topic_access.log_refused(
            principal, question,
            outcome=reading.refusal_reason or topic_access.NO_ACCESS,
            reason="About events or clubs, but asks for something the card and details do not show",
            context=context,
        )
        result_document = topic_access.out_of_scope_document(principal)
        data_summary = "No data retrieved: the question is not expressible against what the card shows."
    else:
        # Generation or validation never converged. The precise reason (which can name tables and
        # columns) goes to the log only; the asker gets a vague, honest failure.
        log.warning(
            "ai.ask.retrieval_failed",
            extra={"reason": outcome.failure_reason, "attempts": outcome.attempts},
        )
        topic_access.log_system_failure(
            principal, question, reason=f"Retrieval failed: {outcome.failure_reason}", context=context
        )
        result_document = topic_access.unanswerable_document()
        data_summary = "No data retrieved: the query could not be generated or validated."

    # --- Step 15: generate the final answer from the actual rows ---------------------------------
    step_started_at = time.perf_counter()
    answer = generate_sql_answer(
        question, result_document, context_chunks=extra_chunks, history=history, asker=principal
    )
    _step(15, f"Generated the final answer with {GENERATION_MODEL}", step_started_at)

    # --- Step 16: cards for the events and clubs the answer actually NAMES -----------------------
    # A suggestion is only useful if you can act on it, and a card is what makes it clickable: an
    # event card opens the details dialog with its Register button, a club card lands on Discover
    # Clubs with that club's join dialog already open.
    step_started_at = time.perf_counter()
    # ONLY A REAL RESULT GETS CARDED, for the same reason the navigation fallback below is
    # suppressed on a refusal - and it is the same `outcome.ok`. A refusal names no event and no
    # club, so anything matched out of its prose is a coincidence rather than a mention: "I can't
    # help with that, as it's outside what I cover" carded a club literally named "as". Building
    # cards from text that was never about an entity is how an answer acquires an illustration it
    # does not have.
    event_cards, club_cards = (
        cards.build(answer, topics, user_id=user_id) if outcome.ok else ([], [])
    )
    # A page card is the "take me there" fallback for an answer with nothing clickable in it -
    # "where do I find events" is prose otherwise. It is suppressed in three cases:
    #
    #   an entity card exists    a specific event's card beats a link to the page listing every one
    #   the answer is a refusal  a refusal offers nothing to click, and a card under one asserts the
    #                            answer is on that page, sending someone to look for what was never
    #                            there
    #   the turn has a SUBJECT   a follow-up about the event already being discussed ("when is it?",
    #                            "is it free?") is a one-line fact, and two page cards under it are
    #                            noise - they answer a question about where things live, which is
    #                            not the one being asked
    navigation = (
        topic_access.topic_cards(principal, topics)
        if outcome.ok and not denied and not reading.subject and not (event_cards or club_cards)
        else []
    )
    _step(16, f"Cards: {len(event_cards)} event(s), {len(club_cards)} club(s), {len(navigation)} nav",
          step_started_at)

    # THE REVIEWER SEES EVERY CHUNK THE ANSWER SAW, not just the query result. It judges whether a
    # claim was grounded, so anything the answering model was given and it is not shown reads to it
    # as invented. False flags are not free: they bury the real incidents in a log an administrator
    # is supposed to be able to trust.
    return _answer(question, answer, principal, user_context=user_context, context=context,
                   data_summary="\n\n---\n\n".join([data_summary, *extra_chunks]),
                   started_at=request_started_at, navigation=navigation,
                   event_cards=event_cards, club_cards=club_cards)


def _knowledge_chunks(question: str, reading, principal,
                      context: str | None = None) -> tuple[list[str], list[dict]]:
    """The CONTEXT for a knowledge turn, and the navigation cards that go under it.

    Every branch reads a DEFINITION out of ai/scope.py. None of them improvises, and none of them
    touches a database row - which is the point: improvising a page description is what produced a
    confident account of a "personal calendar" this app has never had, and a how-to composed from
    the general system overview is what once handed an account with no access at all a working
    procedure for an action nobody had checked it could take.
    """
    chunks: list[str] = []
    navigation: list[dict] = []

    if "greeting" in reading.intents:
        # A bare "hey" gets a short casual reply, not the enumerated capability list below - the
        # hint only says which topics are safe to mention, computed from the same live grants.
        chunks.append(topic_access.greeting_hint_document(principal))

    if "assistant_capability" in reading.intents:
        # "What can you do" gets the complete list, built live from this caller's access, so it can
        # never offer something the assistant would refuse a second later.
        chunks.append(topic_access.capability_document(principal))

    if "who_am_i" in reading.intents:
        chunks.append(topic_access.who_am_i_document(principal))

    if "page_purpose" in reading.intents:
        # A page purpose is not anybody's data, so it is told to a caller who cannot open the page
        # too - what is withheld is the page's CONTENTS. Refusing to describe the app to the person
        # using it is what turned an external account's every question into a dead end.
        #
        # Up to TWO pages, because "what is the difference between Discover Clubs and My Clubs" is
        # an ordinary question, and answering it from one definition answers half of it.
        page_codes = scope.pages_named(question)
        if not page_codes:
            chunks.append(scope.unknown_page_document(question))
            topic_access.log_system_failure(
                principal, question,
                reason="Asked what a page is for, but the name matches no page in scope.PAGES",
                context=context,
            )
        for page_code in page_codes:
            chunks.append(scope.page_definition_document(principal, page_code))
            card = topic_access.page_card(principal, page_code)
            if card:
                navigation.append(card)

    if "how_to" in reading.intents:
        # Three-way, because a how-to is gated on where its ACTION happens. NO RESOLVABLE FUNCTION
        # NOW REFUSES rather than improvising: a function that does not exist is a function that
        # does not exist, and the log row (`system_failure`) names the one somebody should write.
        function_key = scope.function_named(question)
        if function_key is None:
            chunks.append(scope.unknown_function_document(principal))
            topic_access.log_system_failure(
                principal, question,
                reason="How-to question matching no function in scope.FUNCTIONS",
                context=context,
            )
        elif scope.can_use(principal, function_key):
            chunks.append(scope.function_definition_document(principal, function_key))
            navigation.extend(topic_access.function_cards(principal, function_key))
        else:
            chunks.append(scope.function_denied_document(principal, function_key))
            topic_access.log_function_denial(principal, function_key, question, context)

    return chunks, navigation


@bp.get("/suggestions")
@limiter.limit("60 per minute")
def suggestions():
    """The opening suggestion cards, chosen for whoever is asking.

    Deliberately its own endpoint rather than a field on /ask: the panel needs these before any
    question exists, and the list is a function of the caller's page grants alone.

    Open to guests (authenticate_optional), who get the cards for the pages a visitor can actually
    reach - the same scope.can_reach check that releases the answer behind each card. Never returns
    an empty array; see suggestions_for().
    """
    authenticate_optional()
    principal = getattr(g, "principal", None)
    return jsonify({"suggestions": suggestions_for(principal, limit=SUGGESTION_LIMIT)})
