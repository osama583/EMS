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
from ..ai.gemini import (
    FACTUAL_TEMPERATURE,
    GENERATION_MODEL,
    GREETING_TEMPERATURE,
    generate_answer,
)
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


# Told to the model when the page gate refused one or more of a question's topics, so the answer says
# plainly what it cannot cover instead of silently omitting it (an omission reads as "there is
# nothing", which is a different and wrong answer).
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
#
# IT NO LONGER ASKS FOR A REWORDING. It used to end "suggest they try rephrasing or asking
# something more specific", which is only honest advice when the wording was actually the problem.
# It usually was not: this document is reached for any question the pipeline cannot express, so
# "who is the head of logistics" - unanswerable at any level of specificity, because the app holds
# no org chart - was met with "could you try rephrasing your question or asking about something
# more specific?" The asker rephrased, hit the same wall, and rephrased again. Suggesting a fix
# that cannot work is worse than admitting there isn't one.
_SQL_FAILED_DOCUMENT = (
    "The assistant could not look this up right now. Say briefly and plainly that you don't have "
    "that information available. Do NOT guess at an answer, do NOT state that they have none of "
    "something, and do not mention databases, queries, or errors. Do NOT suggest they rephrase the "
    "question, reword it, or ask something more specific - the wording was not the problem, so a "
    "rewrite would only send them round the same loop."
)

# The refusal for a question whose ANSWER this app does not hold for anyone - overwhelmingly a
# staff or organisational-directory lookup ("who is the head of logistics", "who manages IT", "the
# dean's contact details"). This system knows about clubs, events and the asker's own account; it
# has never known the university's org chart, so there is no phrasing, no permission and no admin
# grant that would produce an answer.
#
# Separated from _SQL_FAILED_DOCUMENT above because the two failures deserve different sentences.
# "I couldn't retrieve that right now" implies a transient fault and invites a retry; the honest
# reply here is that the information is not something the asker has access to through this
# assistant, which is what the asker asked to be told plainly rather than deflected with.
_NO_ACCESS_DOCUMENT = (
    "The asker is asking for staff, personnel, or organisational-directory information - who holds "
    "a position, who manages a department, someone's contact details. This app does not hold that "
    "information and the assistant does not expose it to anyone. Tell them plainly and briefly "
    "that they do not have access to that information here, in one sentence. Do NOT ask them to "
    "rephrase, reword, or be more specific - no phrasing of this question has an answer, so "
    "inviting another attempt is misleading. Do NOT guess a name, invent a position holder, or "
    "substitute a club president or event organiser for the person they asked about. You may "
    "briefly offer what you CAN help with (clubs, events, their own account) if it fits naturally."
)


# Chooses the WORDING of an already-decided refusal. It never decides WHETHER to refuse: every
# caller has already established, through the deterministic layers above, that no answer is coming.
# The only open question at that point is which honest sentence to say - and "you don't have access
# to that" is the honest one for a directory lookup, where "try rephrasing" is not.
#
# Ordering the check this way is what makes a blunt regex safe here. Run as a GATE it would be a
# liability ("who is the president of the Photography Club" would trip `who is` and lose a
# perfectly answerable club question); run as a phrasing choice on a question already refused, its
# worst possible failure is a slightly-off sentence attached to a refusal that was correct anyway.
_PERSON_LOOKUP = re.compile(
    r"\bwho\s+(is|are|was|were|runs?|leads?|heads?|manages?|handles?)\b"
    r"|\b(head|manager|director|supervisor|dean|registrar|in charge of|responsible for)\b"
    r"|\b(staff|personnel|employees?|directory|contact details?|phone number)\b",
    re.IGNORECASE,
)


def _refusal_document(question: str, default: str) -> str:
    return _NO_ACCESS_DOCUMENT if _PERSON_LOOKUP.search(question) else default


def _navigation_cards(principal, data_classes: set[str], *, answered: bool, has_entity_card: bool) -> list[dict]:
    """The "take me there" page cards that go under a DATA answer, if any.

    Two conditions, and the second one is the fix. A page card is for a LOCATION answer - "where can
    I find my registrations" classifies as data (my_registrations), resolves no how-to guide, and
    would otherwise be prose with nothing to click - so it is suppressed when an entity card is
    already there, because a specific event's card beats a link to the page listing every event.

    `answered` is the condition that was missing. The entity-card check alone let a card through
    under every refusal, since a refusal has no entity card either: a failed lookup, an impossible
    question, a page denial and a privacy refusal all picked one up. In a real session the asker
    asked who the head of logistics was, was told the assistant could not retrieve that, and got a
    My Events card underneath - which does not merely add noise, it asserts the answer is on that
    page and sends someone to look for something that was never there. A refusal offers nothing to
    click; "I don't have that" is the entire reply."""
    if not answered or has_entity_card:
        return []
    return topic_access.topic_cards(principal, data_classes)

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
# check - a capitalized two-or-more-word run ("Ahmad Firdaus"), the same shape full_name is stored in.
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
    # resolved against what was actually being discussed.
    step_started_at = time.perf_counter()
    try:
        classes = classifier.classify(question, history)
    except classifier.ClassificationUnavailable as exc:
        # The classifier could not RUN (rate limit, network).
        log.warning("ai.ask.classifier_unavailable", extra={"error": str(exc)})
        return jsonify({
            "answer": (
                "Sorry - I couldn't process that just now. Please try again in a moment."
            ),
            **_EMPTY_PAYLOAD,
        }), 503
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
    # does not answer "is this data yours".
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
    # The single topic-level authorization gate (ai/topic_access.py), unchanged by this refactor.
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
        answer = generate_answer(
            question, [_refusal_document(question, _OUT_OF_SCOPE_DOCUMENT)], history, asker=principal
        )
        _review(
            question, answer, principal,
            user_context=user_context, data_summary="No data was retrieved (out of scope).",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD})

    # --- Step 7: KNOWLEDGE-BASE path ------------------------------------------------------------
    # Static/narrative topics, answered from knowledge_base.py's curated text - never Text-to-SQL,
    # never vector search.
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
        if "greeting" in classes:
            # A bare "hey"/"hi" deserves a short, casual reply, not the full enumerated capability
            # list below - greeting_hint_document() only tells the model whether it's safe to casually
            # mention clubs and/or events (or, having neither, to offer help with the app/account
            # instead), computed live from the same page grants so it can never offer a topic the
            # asker would then be refused.
            kb_chunks.append(topic_access.greeting_hint_document(principal))
        if "askable" in classes:
            # "What can I ask about" gets the complete, exhaustive list - built live from this
            # caller's page grants (the same nav_page_grants check that gates every other answer), so
            # it can never offer a topic the assistant would immediately refuse.
            kb_chunks.append(topic_access.askable_topics_document(principal))
        if "role_capability" in classes and role:
            kb_chunks.append(role_capability_document(role))
        if "system_capability" in classes:
            kb_chunks.append(SYSTEM_CAPABILITY)
        if "how_to" in classes:
            # Three-way, because a how-to is gated on the page its ACTION happens on: no resolvable
            # guide -> a general "how does this work" question, answered from the system overview.
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

        # A BARE greeting samples hot, everything else stays cold. "hey" has no retrieved fact in it
        # to distort, and at the factual temperature it came back byte-identical every single time -
        # the same sentence, the same name, turn after turn, which is what a canned auto-reply looks
        # like. The condition is deliberately exact rather than `"greeting" in classes`: the moment a
        # greeting arrives alongside a real topic ("hey, what clubs are there") the reply carries
        # facts again, and so does any reply carrying a denial or privacy refusal - all of which must
        # be stated precisely, not creatively.
        bare_greeting = classes == {"greeting"} and not denied and not privacy_document
        answer = generate_answer(
            question,
            kb_chunks,
            history,
            asker=principal,
            temperature=GREETING_TEMPERATURE if bare_greeting else FACTUAL_TEMPERATURE,
        )
        _step(7, "Answered from the knowledge base", step_started_at)
        _review(
            question, answer, principal,
            user_context=user_context,
            data_summary="Static knowledge-base content only; no database records were read.",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD, "navigation": navigation_cards})

    # --- Step 7b: RECOMMENDATION questions ------------------------------------------------------
    # "What fits me" is a preference question, and the assistant does not know the asker's preferences
    # - nobody has told it.
    if recommendation.domain_ambiguous(question, history, data_classes):
        step_started_at = time.perf_counter()
        answer = generate_sql_answer(
            question,
            "No data was retrieved - you are asking the asker what they meant, not answering "
            "them. Their question refers to something that was never established: either it "
            "could mean clubs or events and says neither, or it points at 'this one'/'the other "
            "one' with nothing before it to point AT. Ask, in one short sentence, for the "
            "specific thing they mean - naming clubs vs events if that is the open question, or "
            "asking which items they are comparing if it is a dangling reference. Do not guess, "
            "do not answer for both, and do not claim you lack access.",
            history=history,
            asker=principal,
        )
        _step("7a", "Ambiguous domain: asked which, no query run", step_started_at)
        _review(
            question, answer, principal,
            user_context=user_context,
            data_summary="Ambiguous club/event fragment: asked which was meant, no data read.",
        )
        log.info("ai.ask.complete", extra={"total_elapsed_ms": round((time.perf_counter() - request_started_at) * 1000, 1)})
        return jsonify({"answer": answer, **_EMPTY_PAYLOAD})

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
    # ai/text_to_sql.py.
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
    # like (or named the domain), so there is something real to ground a suggestion in.
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
        result_document = _refusal_document(question, _OUT_OF_SCOPE_DOCUMENT)
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
        result_document = _refusal_document(question, _SQL_FAILED_DOCUMENT)
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
    # event card opens the details popup with its Register button, a club card lands on Discover Clubs
    # with that club's join dialog already open.
    event_cards, club_cards = cards.build(answer, data_classes, user_id=user_id)

    navigation_cards = _navigation_cards(
        principal,
        data_classes,
        answered=outcome.ok and not denied and not privacy_document,
        has_entity_card=bool(event_cards or club_cards),
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
