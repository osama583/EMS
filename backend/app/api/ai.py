"""The in-app AI assistant (the ai-orb widget). Two answer paths, one authorization model.

    POST /ai/ask
        { "question": "...", "history": [{"question": "...", "answer": "..."}, ...] }
        -> { "answer": "...", "sources": [...], "registrantsTable": ..., "clubs": [...],
             "navigation": [...] }

ARCHITECTURE (2026-08 refactor - Text-to-SQL replaced vector retrieval for structured data):

    STATIC / NARRATIVE  ->  knowledge_base.py           unchanged, hand-written
    STRUCTURED RECORDS  ->  text_to_sql.py              new; was pgvector + ~20 scoped SQL functions

The knowledge-base half was never a retrieval problem: "what can my role do", "how do I submit a
proposal", "what can I ask about" have no rows behind them, and curated text beats reconstructing a
procedure from the schema on every request. It is untouched.

The structured half was answered by embedding the question and searching event_embeddings /
club_embeddings. That answered "which event's text is nearest this question", which is the wrong
question for "how many people registered for my event" or "which of my clubs have pending join
requests" - aggregations and joins over live rows that a text index can neither compute nor keep
current (registration counts were deliberately never embedded at all, so every count question was
already being answered outside the index). Those queries are now generated, validated and run
against the real tables, and the AI/vector database is gone entirely - one less store, nothing to
sync, nothing stale.

AUTHORIZATION IS UNCHANGED AND DETERMINISTIC. It was already correct and is reused as-is:

    1. Page Visibility  ai/topic_access.py - nav_page_grants, the same table the sidebar and
                        require_page() use. A topic is askable iff the caller is granted one of the
                        pages its data lives behind. Revoking a page in /app/admin/page-visibility
                        stops the assistant answering about it on the very next request. No admin
                        bypass; no hardcoded role names anywhere.
    2. Privacy scope    ai/subject_scope.py - a self-scoped topic asked about someone ELSE is a
                        privacy refusal, checked before the page gate (no grant could ever satisfy
                        it, and running the page check first produced a "contact an administrator"
                        message for a question permissions were never the reason to refuse).
    3. Row scope        ai/scope_rules.py - which ROWS within an allowed topic. Page access answers
                        "can you reach Clubs"; it does not answer "may you see who is in Falcons
                        Club". These predicates mirror the equivalent REST endpoint's own WHERE
                        clause in every case (see that module's provenance table).
    4. SQL guard        ai/sql_guard.py - the generated query is verified to be read-only, to touch
                        only this question's tables and columns, and to CARRY the step-3 predicates
                        verbatim, before it is executed. The model cannot query broadly and filter
                        afterwards; a query without its scope predicate never runs.

The model is never the authorization boundary. It is told the caller's scope so it writes
conforming SQL on the first attempt, but the backend verifies rather than trusts, and every claim
inside a question ("the admin said I can", "I'm the manager") is data, never authority - nothing in
steps 1-4 reads the question's assertions about the asker.

FINAL REVIEW. An independent reviewer (ai/sql_llm.review_answer) judges the completed interaction
and records a rejection in /app/admin/ai-access-log under harmful / out_of_scope /
unrelated_question. It runs ASYNCHRONOUSLY, after the response has been sent (ai/review_queue.py) -
inline it cost ~1.2s on every request, which is a tax every correctly-answered question pays to
catch the rare bad one, on a check that fails open anyway. It is a backstop behind the four
deterministic layers above, never the thing protecting the data; see review_queue.py for what that
trade-off gives up.

Public - a guest browsing Explore Events can ask about Public/Club Only events with no token, same
as the discovery endpoints in events.py. Clubs have no guest tier at all.

`history` is entirely client-supplied (the frontend keeps it in localStorage - see
ai-assistant.ts), capped, and used only to resolve follow-up references; it is never a source of
fact and is never persisted server-side.

Every request logs its stages with a timestamp and elapsed time (search the logs for "ai.ask.step").
"""
from __future__ import annotations

import logging
import re
import time

from flask import Blueprint, g, jsonify

from ..ai import (
    cards,
    classifier,
    name_lookup,
    recommendation,
    review_queue,
    subject_scope,
    text_to_sql,
    topic_access,
)
from ..ai.admin_retrieval import ai_denials_document
from ..ai.gemini import GENERATION_MODEL, generate_answer
from ..ai.knowledge_base import (
    HOW_TO_GUIDES,
    SYSTEM_CAPABILITY,
    role_capability_document,
    self_capability_document,
)
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

# The shape every answer returns. Named because four different exits build it, and a missing key
# is a frontend error, not a backend one (see ai-assistant.service.ts's AiAssistantAnswer).
_EMPTY_PAYLOAD = {"sources": [], "registrantsTable": None, "clubs": [], "navigation": []}


def _step(n: int | str, description: str, started_at: float) -> None:
    log.info(
        "ai.ask.step",
        extra={"step": n, "description": description, "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1)},
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


# Told to the model when the page gate refused one or more of a question's topics, so the answer
# says plainly what it cannot cover instead of silently omitting it (an omission reads as "there is
# nothing", which is a different and wrong answer). Authorization itself lives in
# ai/topic_access.py; this is only how the already-made decision is worded.
def _denied_document(denied_topics: list[str]) -> str:
    labels = sorted({topic_access.TOPIC_LABEL.get(t, t) for t in denied_topics})
    listed = labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + f" and {labels[-1]}"
    return (
        f"This asker does not have access to {listed} - an administrator has not granted their "
        f"role the pages that information lives on (Page Visibility). Tell them plainly they do "
        f"not have access to that, and do not answer that part of their question or invent, guess, "
        f"or substitute any detail for it. If their question ALSO covers something they do have "
        f"access to, answer that part normally."
    )


# The single scope statement for a question this assistant does not cover. Written as CONTEXT (the
# same mechanism every other answer uses) rather than returned verbatim, so the model can decline
# naturally and in the asker's own framing instead of emitting a canned sentence.
_OUT_OF_SCOPE_DOCUMENT = (
    "This question is outside what the assistant covers. It can help with: published EVENTS and the "
    "asker's own registrations; CLUBS and the asker's own memberships; what the asker's account and "
    "role let them do; and step-by-step guidance for actions they have access to. It does NOT answer "
    "questions about cafeteria menus, food, system administration, user directories, or anything "
    "outside this app. Say briefly and politely that this is outside what you can help with, name a "
    "couple of things from the list above that you CAN help with, and do not attempt an answer, a "
    "guess, or a general-knowledge response."
)

# What the asker is told when the SQL pipeline could not produce a query it was willing to run.
# Deliberately vague to the USER (the real reason names tables and columns, which is exactly what a
# prober wants) while the precise reason goes to the log.
_SQL_FAILED_DOCUMENT = (
    "The assistant could not look this up right now. Say briefly that you weren't able to retrieve "
    "that at the moment and suggest they try rephrasing or asking something more specific. Do NOT "
    "guess at an answer, do NOT state that they have none of something, and do not mention "
    "databases, queries, or errors."
)

def _how_to_denied_document(guide_key: str) -> str:
    """The refusal for a how-to whose ACTION page this caller cannot reach.

    Deliberately distinct from _denied_document above: that one names a data TOPIC ("you cannot see
    clubs"), which is the wrong explanation for a procedural question. Here the caller asked how to
    DO something, and the honest reason is that the page the action happens on is not theirs - so
    the message names the action, not a data domain."""
    from ..ai.knowledge_base import HOW_TO_LABEL, HOW_TO_PAGES

    label = HOW_TO_LABEL.get(guide_key, guide_key.replace("_", " "))
    pages = ", ".join(HOW_TO_PAGES.get(guide_key, ())) or "the relevant page"
    return (
        f"This asker cannot reach the page where {label} happens - an administrator has not granted "
        f"their role {pages} in Page Visibility. Tell them plainly that they do not have access to "
        f"that part of the app, and do NOT give the steps, describe the screen, or suggest a "
        f"workaround. Suggest they contact an administrator if they believe they should have it."
    )


# Best-effort "is there a person's name in this question" detector, feeding subject_scope's privacy
# check - a capitalized two-or-more-word run ("Ahmad Firdaus"), the same shape full_name is stored
# in. Deliberately conservative: find_user_by_name() only proceeds on an EXACT, UNAMBIGUOUS match,
# so a false-positive candidate here just fails to resolve rather than picking the wrong person.
_NAME_CANDIDATE = re.compile(r"\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)\b")
# Sentence-initial question words are also capitalized ("Is Siti Nurhaliza...", "Has Ahmad...") and
# would otherwise be swept into the name itself - stripped from a candidate's leading position.
_LEADING_STOPWORDS = {"is", "has", "does", "did", "was", "were", "can", "could", "will", "would", "the"}


def _name_candidates(question: str) -> list[str]:
    candidates = []
    for match in _NAME_CANDIDATE.findall(question):
        words = match.split()
        while len(words) > 1 and words[0].lower() in _LEADING_STOPWORDS:
            words = words[1:]
        if len(words) >= 2:
            candidates.append(" ".join(words))
    return candidates


def _review(question: str, answer: str, principal, *, user_context: str, data_summary: str) -> None:
    """Step 17: hand the completed interaction to the independent security reviewer.

    ASYNCHRONOUS, and deliberately so. Called inline first, it added ~1.2s of blocking model call
    to every request - a tax paid by every correctly-answered question to catch the rare bad one,
    on a check that fails open anyway. The reviewer judges a FINISHED interaction, so nothing in
    the response depends on its verdict; only the audit log does. See ai/review_queue.py for the
    full trade-off, including what this gives up.

    Returns nothing: the answer is already final by the time this is called."""
    review_queue.submit(
        question, answer, principal, user_context=user_context, data_summary=data_summary
    )


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
    log.info("ai.ask.step", extra={"step": 1, "description": "Received user question", "elapsed_ms": 0.0})

    # --- Step 2: authenticate and load the caller's real context --------------------------------
    # Everything the authorization layers use comes from HERE - the verified token and the live
    # grant tables - and nothing comes from the question's own claims about who is asking.
    step_started_at = time.perf_counter()
    authenticate_optional()
    principal = getattr(g, "principal", None)
    user_id = principal.user_id if principal is not None else None
    _step(2, "Resolved caller identity and permissions", step_started_at)

    # --- Step 3: classify the question ----------------------------------------------------------
    # LLM classification, with the recent turns supplied so a bare follow-up ("is it active") is
    # resolved against what was actually being discussed. Replaces the old regex router (see
    # ai/classifier.py's docstring for why); named_role/how_to_topic remain lookups against known
    # fixed sets rather than model guesses.
    step_started_at = time.perf_counter()
    classes = classifier.classify(question, history)
    role = classifier.named_role(question) if "role_capability" in classes else None
    if "role_capability" in classes and role is None and history:
        # A bare follow-up ("its role", "what about that role") names no role of its own; walk
        # history newest-first for the most recent question that did.
        for prior_turn in reversed(history):
            role = classifier.named_role(prior_turn["question"])
            if role:
                break
    _step(3, f"Classified as: {sorted(classes) or ['unmatched']}", step_started_at)

    # --- Step 4: PRIVACY scope - whose data is this? --------------------------------------------
    # Checked BEFORE the page gate, deliberately. Page access answers "may you reach this topic"; it
    # does not answer "is this data yours". A self-scoped topic asked about someone else can never
    # be satisfied by any grant, so citing page permissions would misdescribe the reason - and
    # running the page check first strips the self-scoped class before this can see it, which
    # produced exactly that wrong message.
    step_started_at = time.perf_counter()
    third_party = subject_scope.third_party_subject(
        question,
        caller_user_id=user_id,
        name_candidates=_name_candidates(question),
        resolve_name=name_lookup.find_user_by_name,
        resolve_name_fuzzy=name_lookup.find_user_by_name_fuzzy,
    )
    self_scoped_hit = classes & subject_scope.SELF_SCOPED_CLASSES
    privacy_document: str | None = None
    if third_party and self_scoped_hit:
        privacy_document = subject_scope.denial_document(third_party, self_scoped_hit)
        # Drop the whole DOMAIN, not just the self-scoped class within it - otherwise the sibling
        # class survives to be refused by the page gate as well, and the answer carries two
        # contradictory reasons for one question (see subject_scope.classes_to_drop).
        classes -= subject_scope.classes_to_drop(self_scoped_hit)
        log.info("ai.ask.third_party_refused", extra={"subject": third_party, "classes": sorted(self_scoped_hit)})

    # --- Step 5: PAGE VISIBILITY - may this caller ask about these topics at all? ---------------
    # The single topic-level authorization gate (ai/topic_access.py), unchanged by this refactor. A
    # denied topic is DROPPED rather than failing the whole request, so a question spanning an
    # allowed and a denied topic still answers the part they may see, with the denial note telling
    # the model to say plainly what it cannot cover.
    denied = topic_access.denied_topics(principal, classes)
    if denied:
        topic_access.log_denials(principal, denied, question)
        classes -= set(denied)
    _step(5, f"Denied topics: {denied or ['none']}; third-party: {third_party or 'no'}", step_started_at)

    # The caller's authenticated context, built once and shared by the SQL generator and the
    # reviewer - reviewing an answer against a different account summary than the one it was
    # generated under would be reviewing a fiction.
    user_context = topic_access.user_context_document(principal, classes)

    # --- Step 6: nothing matched and nothing was refused -> genuinely out of scope ---------------
    # Recorded rather than silently answered: /app/admin/ai-access-log needs to distinguish
    # "blocked by permissions" (fix a grant) from "never supported" (build the feature).
    if not classes and not denied and not privacy_document:
        topic_access.log_unanswerable(
            principal, question, reason="No topic matched - outside clubs, events, and app guidance"
        )
        answer = generate_answer(question, [_OUT_OF_SCOPE_DOCUMENT], history, asker=principal)
        _review(
            question, answer, principal,
            user_context=user_context, data_summary="No data was retrieved (out of scope).",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD})

    # --- Step 7: KNOWLEDGE-BASE path ------------------------------------------------------------
    # Static/narrative topics, answered from knowledge_base.py's curated text - never Text-to-SQL,
    # never vector search. There are no rows behind "how do I submit a proposal" or "what can my
    # role do", and reconstructing a procedure from the schema every request would be slower and
    # less reliable than the hand-written text that already exists.
    #
    # Also handles `not classes and (denied or privacy_document)` - every topic was refused, so
    # there is nothing to query and no reason to run the SQL pipeline; the answer comes from the
    # refusal note itself.
    kb_classes = classes & classifier.KNOWLEDGE_BASE_CLASSES
    data_classes = classes & classifier.DATA_CLASSES
    if (not classes and (denied or privacy_document)) or (kb_classes and not data_classes):
        step_started_at = time.perf_counter()
        kb_chunks: list[str] = []
        # Navigation cards accompany a how-to the caller CAN reach - the "take me there" half of the
        # answer, built from the same grant check that released the steps, so a card can never point
        # at a page they would be bounced out of.
        navigation_cards: list[dict] = []
        if "self_capability" in classes:
            # "What can I DO in the app" - role capabilities. A different question from what the
            # assistant can ANSWER (see "askable" below).
            kb_chunks.append(self_capability_document(principal.assignments if principal else ()))
        if "greeting" in classes or "askable" in classes:
            # Both answer "what can I ask about", built live from this caller's page grants (the
            # same nav_page_grants check that gates every other answer), so it can never offer a
            # topic the assistant would immediately refuse. Deliberately not gated itself - asking
            # what you may ask is always allowed, and the answer is already limited to what the
            # caller passes.
            kb_chunks.append(topic_access.askable_topics_document(principal))
        if "role_capability" in classes and role:
            kb_chunks.append(role_capability_document(role))
        if "system_capability" in classes:
            kb_chunks.append(SYSTEM_CAPABILITY)
        if "how_to" in classes:
            # Three-way, because a how-to is gated on the page its ACTION happens on:
            #   no resolvable guide -> a general "how does this work" question, answered from the
            #       system overview. Never gated: it names no action and exposes no one's data.
            #   guide + page access -> the steps, plus a navigation card to that page.
            #   guide, no page access -> refuse THIS guide only; other kb_chunks still answer.
            topic = classifier.how_to_topic(question)
            if topic is None:
                kb_chunks.append(SYSTEM_CAPABILITY)
                topic_access.log_unanswerable(
                    principal, question,
                    reason="How-to question with no matching guide in HOW_TO_GUIDES",
                    unsupported=True,
                )
            elif topic_access.how_to_allowed(principal, topic):
                kb_chunks.append(HOW_TO_GUIDES[topic])
                navigation_cards.extend(topic_access.how_to_cards(principal, topic))
            else:
                kb_chunks.append(_how_to_denied_document(topic))
                topic_access.log_how_to_denial(principal, topic, question)
        if "admin_ai_denials" in classes:
            # Gated behind its own page (admin-ai-access-log) - reaching this line already means
            # step 5 passed the caller.
            kb_chunks.append(ai_denials_document())
        if denied:
            kb_chunks.append(_denied_document(denied))
        if privacy_document:
            kb_chunks.append(privacy_document)

        answer = generate_answer(question, kb_chunks, history, asker=principal)
        _step(7, "Answered from the knowledge base", step_started_at)
        _review(
            question, answer, principal,
            user_context=user_context,
            data_summary="Static knowledge-base content only; no database records were read.",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD, "navigation": navigation_cards})

    # --- Step 7b: RECOMMENDATION questions ------------------------------------------------------
    # "What fits me" is a preference question, and the assistant does not know the asker's
    # preferences - nobody has told it. Answering it by listing rows is what produced the reply
    # that motivated this: five events, no reason, no question, identical for every asker.
    #
    # The "ask" and "clarify" stages return WITHOUT querying at all: there is nothing to look up
    # yet, because the thing that decides what to look up has not been established. Running the SQL
    # pipeline first and then asking a question would waste two model calls to produce a reply that
    # never uses their result.
    recommendation_stage = recommendation.stage_for(question, history)
    if recommendation_stage in ("ask", "clarify"):
        step_started_at = time.perf_counter()
        chunks = [f"RECOMMENDATION STAGE: {recommendation_stage}"]
        # History shapes WHAT is asked (a student who has been to two coding events gets a
        # different question from one with no history at all) without ever being read back to them.
        profile = recommendation.history_document(user_id)
        if profile:
            chunks.append(profile)
        answer = generate_sql_answer(
            question,
            "No data was retrieved yet - you are asking the asker a question, not answering one.",
            context_chunks=chunks,
            history=history,
            asker=principal,
        )
        _step("7b", f"Recommendation stage: {recommendation_stage} (asked, no query run)", step_started_at)
        _review(
            question, answer, principal,
            user_context=user_context,
            data_summary=f"Recommendation stage '{recommendation_stage}': asked a clarifying question, no data read.",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD})

    # --- Steps 8-14: TEXT-TO-SQL path -----------------------------------------------------------
    # Row scope -> schema -> generate -> guard -> execute -> bounded recovery, all inside
    # ai/text_to_sql.py. `data_classes` has already been through the privacy and page gates, so
    # every topic here is one the caller may reach; the pipeline narrows from there to which ROWS.
    step_started_at = time.perf_counter()
    outcome = text_to_sql.run(
        question, principal, data_classes, history,
        broad_candidates=recommendation_stage == "recommend"
        and recommendation.in_recommendation_thread(question, history),
    )
    _step(
        8,
        f"Text-to-SQL: ok={outcome.ok} attempts={outcome.attempts} "
        f"rows={len(outcome.rows) if outcome.rows is not None else 'n/a'}",
        step_started_at,
    )

    # Notes that must reach the answer regardless of which branch below runs: a question spanning an
    # allowed and a denied topic still has to explain the denied half.
    extra_chunks: list[str] = []
    if denied:
        extra_chunks.append(_denied_document(denied))
    if privacy_document:
        extra_chunks.append(privacy_document)
    # A recommendation that reached here is stage "recommend": they have already told us what they
    # like (or named the domain), so there is something real to ground a suggestion in. The stage
    # line and their history both go to the model, which is what lets it give a REASON per item
    # instead of listing whatever the query returned.
    if recommendation_stage == "recommend" and recommendation.is_recommendation(question):
        extra_chunks.append(
            f"RECOMMENDATION STAGE: recommend. Name at most {recommendation.MAX_SUGGESTIONS} "
            "things, each with a real reason drawn from what they told you or their actual "
            "history. Never list everything you were given."
        )
        profile = recommendation.history_document(user_id)
        if profile:
            extra_chunks.append(profile)

    if outcome.ok:
        result_document = rows_to_document(outcome.rows or [], sql=outcome.sql or "")
        data_summary = result_document
    elif outcome.impossible:
        # The model judged the question unanswerable from the schema it was given: on-domain, but
        # not something this assistant can currently retrieve. The most actionable kind of log row -
        # it names a capability gap rather than a permissions problem.
        topic_access.log_unanswerable(
            principal, question,
            reason="On-domain question the assistant has no way to answer from the available data",
            unsupported=True,
        )
        result_document = _OUT_OF_SCOPE_DOCUMENT
        data_summary = "No data retrieved: the question could not be expressed against the available schema."
    else:
        # Generation or validation never converged. The precise reason (which can name tables and
        # columns) goes to the log only; the asker gets a vague, honest failure.
        log.warning(
            "ai.ask.sql_pipeline_failed",
            extra={"reason": outcome.failure_reason, "attempts": outcome.attempts},
        )
        topic_access.log_unanswerable(
            principal, question, reason=f"SQL pipeline failed: {outcome.failure_reason}"
        )
        result_document = _SQL_FAILED_DOCUMENT
        data_summary = "No data retrieved: the query could not be generated or validated."

    # --- Steps 15-16: generate the final answer from the actual rows ----------------------------
    step_started_at = time.perf_counter()
    answer = generate_sql_answer(
        question, result_document, context_chunks=extra_chunks, history=history, asker=principal
    )
    _step(16, f"Generated the final answer with {GENERATION_MODEL}", step_started_at)

    # --- Steps 17-18: independent review, then release or refuse+log ----------------------------
    step_started_at = time.perf_counter()
    _review(
        question, answer, principal, user_context=user_context, data_summary=data_summary
    )
    _step(18, "Security review queued", step_started_at)

    # --- Step 19: cards for the events/clubs the answer actually NAMES --------------------------
    # A suggestion is only useful if you can act on it, and a card is what makes it clickable: an
    # event card opens the details popup with its Register button, a club card lands on Discover
    # Clubs with that club's join dialog already open. Without these the assistant answers a
    # "suggest something for me" question with a wall of text and no way to act on it, which is
    # what it was doing after the vector retrieval that used to build them was removed.
    #
    # Matched on the ANSWER, not the query result: the model was given nine events and named three,
    # and carding all nine would put six cards under a reply that never mentioned them. See
    # ai/cards.py for the relevance rule and the visibility re-check.
    event_cards, club_cards = cards.build(answer, data_classes, user_id=user_id)

    # A "take me there" card for the topic's own page, but only when there is no entity card
    # already: "where can I find my registrations" is a LOCATION question that classifies as data
    # (my_registrations), resolves no how-to guide, and so used to get prose and nothing to click.
    # Suppressed when entity cards exist, because those are the better destination - a card for the
    # actual event beats a card for the page that lists it.
    navigation_cards = (
        [] if (event_cards or club_cards) else topic_access.topic_cards(principal, data_classes)
    )
    _step(
        19,
        f"Cards: {len(event_cards)} event(s), {len(club_cards)} club(s), {len(navigation_cards)} nav",
        step_started_at,
    )

    log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
    return jsonify({
        "answer": answer,
        "sources": event_cards,
        "registrantsTable": None,
        "clubs": club_cards,
        "navigation": navigation_cards,
    })
