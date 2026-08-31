"""Intent/topic classification, by the model rather than by regex.

WHAT REPLACED WHAT. query_router.py's classify() was ~450 lines of hand-tuned regex plus a fuzzy
typo fallback, with gemini.classify_llm() as a rescue path for the cases regex missed or matched
too weakly. That arrangement had a structural problem the patterns themselves could not fix: every
new phrasing needed a new pattern, and the recurring failure was never "matched nothing" (safe -
an empty CONTEXT produces "I don't have that") but "a BROAD pattern caught a question a SPECIFIC
one missed", which loads the wrong domain's data and answers confidently from it. The regexes'
own comments record several of those. So the ordering is inverted here: the model classifies, and
the parts of query_router.py that are genuinely lookups rather than guesses are kept.

KEPT FROM query_router.py, unchanged and imported (not copied):
  CLASS_DESCRIPTIONS  the class vocabulary. It is the contract shared by topic_access.TOPIC_PAGES,
                      schema_catalog._TOPIC_GROUPS and this module, and it was already written as
                      prose descriptions - exactly what a classifier prompt needs.
  named_role()        which ROLE a "what can {role} do" question names. A dictionary lookup
                      against knowledge_base's real role table, not a guess - asking the model to
                      re-derive a role_code it could get subtly wrong would be strictly worse.
  how_to_topic()      which HOW_TO_GUIDES key a procedural question is about. Same reasoning: the
                      guide keys are a fixed, small, known set.

WHAT IS NEW: history-aware classification is now the model's job rather than a separate
inheritance pass. api/ai.py used to re-classify the previous turn's question with regex and union
the result in, because a bare follow-up ("is it active", "what about that one") carries no topic
words. The model is given the recent turns directly and resolves the reference itself, which is
the thing it is actually good at.

FAILURE MODE: an outage refuses rather than guesses - but it refuses AS AN OUTAGE. Returning an
empty set on an API error used to conflate "the classifier could not run" with "the classifier ran
and matched nothing"; api/ai.py can only read the latter, so a rate-limited call told the asker
their ordinary question was outside what the assistant covers, and filed it in the AI access log as
an unsupported capability gap. Failure now raises ClassificationUnavailable; only a real empty
result returns an empty set.
"""
from __future__ import annotations

import json
import logging

from google.genai import types

from .gemini import GENERATION_MODEL, _generate_content
from .query_router import (  # noqa: F401 - re-exported
    CLASS_DESCRIPTIONS,
    area_named,
    how_to_topic,
    named_role,
)

log = logging.getLogger(__name__)

__all__ = [
    "CLASS_DESCRIPTIONS", "ClassificationUnavailable", "area_named", "classify", "how_to_topic",
    "named_role",
]


class ClassificationUnavailable(RuntimeError):
    """The classifier could not run at all - a rate limit, a network fault, a malformed response.

    Distinct from "the classifier ran and matched nothing", which is a real answer meaning the
    question is out of scope. Conflating the two reported an infrastructure outage to the user as
    a judgement about their question."""


def _system_instruction() -> str:
    lines = [
        "You are the intent classifier for a university event and club management app's chat "
        "assistant. Given a QUESTION, decide which topic classes it touches.",
        "",
        "A question can touch MORE THAN ONE class - return every class that genuinely applies. "
        "Return an EMPTY list when none apply: small talk unrelated to the app, general knowledge, "
        "or anything this app has nothing to do with. Never invent a class outside this list.",
        "",
        "Be precise rather than generous. Returning an extra class is not harmless - it makes the "
        "assistant load and answer from the wrong kind of data. In particular:",
        "- A question about the asker's OWN registrations is my_registrations, NOT events. "
        "'events' is for browsing the public catalogue.",
        "- A question about the asker's OWN clubs/memberships is clubs_mine, NOT clubs_admin. "
        "clubs_admin is only for system-wide club administration and analytics.",
        "- 'What can I do here' is self_capability; 'what can you help me with' is askable; "
        "'what can {some named role} do' is role_capability. These are three different questions.",
        "- A step-by-step 'how do I...' is how_to ALONE, even when it mentions clubs or events. "
        "'How do I join a club' wants instructions, not a list of clubs - do not also return the "
        "topic it happens to name.",
        "- 'What is <page or section> FOR' is page_purpose ALONE, and it is not a data question. "
        "'What is the Event Calendar for', 'what does Happening Soon do', 'what is the point of "
        "Explore Events' all ask what part of the app that is - answer them from the app's own "
        "description of the page, so do NOT also return `events` or `clubs` and send the question "
        "to the database. The moment they ask what is ON the page ('what's on the calendar in "
        "October') it becomes the data class instead.",
        "- WHO HOLDS A STAFF OR ORGANISATIONAL POSITION matches NO class - return an empty list. "
        "'Who is the head of logistics', 'who manages the IT department', 'who is in charge of "
        "facilities', 'who is the dean', staff or student directories, contact details, and user "
        "headcounts are all the university's org chart and people directory, which this app does "
        "not hold and this assistant does not expose. Returning a club/event class for one of "
        "these is the specific mistake to avoid: it sends an unanswerable question down the "
        "database path, which then fails and tells the asker to rephrase - so they rephrase a "
        "question that has no answer here, and the loop repeats. An empty list gets them a "
        "straight 'you don't have access to that' instead.",
        "  THE TWO EXCEPTIONS, because these are club/event facts rather than org-chart facts: a "
        "club's PRESIDENT ('who is the president of the Photography Club') is clubs/clubs_mine, "
        "and an event's ORGANISER ('who is running the hackathon') is events. Both are real "
        "columns in this app and stay answerable.",
        "",
        "If the question is a short follow-up that carries no topic of its own ('is it active', "
        "'what about that one', 'yes', 'show me the list'), classify it against what the RECENT "
        "CONVERSATION was actually about.",
        "",
        "CLASSES:",
    ]
    lines += [f"- {name}: {description}" for name, description in CLASS_DESCRIPTIONS.items()]
    return "\n".join(lines)


# Classes answered entirely from knowledge_base.py's hand-written content - no database query, no SQL
# generation.
KNOWLEDGE_BASE_CLASSES: frozenset[str] = frozenset({
    "self_capability",
    "askable",
    "role_capability",
    "system_capability",
    "page_purpose",
    "how_to",
    "greeting",
    "admin_ai_denials",
})

# Classes answered by querying the database (Text-to-SQL). Everything with real rows behind it.
DATA_CLASSES: frozenset[str] = frozenset(CLASS_DESCRIPTIONS) - KNOWLEDGE_BASE_CLASSES


def _suppress_incidental_how_to_topics(question: str, classes: set[str]) -> set[str]:
    """A resolved how-to answers from its GUIDE, not from the database.

    "How do I join a club" names clubs, so the classifier returns {how_to, clubs} - both defensible
    in isolation, but the question wants instructions and the data class turns it into a list of
    clubs instead (observed exactly that way through the finished endpoint). The old regex router
    had a dedicated fix for this; the model needs the same one, because "which classes does this
    touch" and "what does the asker actually want" are different questions and only the first is
    the classifier's job.

    Applied ONLY when a specific guide resolves. A generic "how does the approval process work"
    (how_to_topic returns None) has no steps to give, so its data classes are the only thing that
    could answer it and are deliberately left alone.

    The prompt asks for this too. This is the deterministic backstop, because the consequence of
    the model not complying is a wrong-shaped answer on a common question, and a rule this crisp
    should not depend on prompt adherence."""
    if "how_to" not in classes or how_to_topic(question) is None:
        return classes
    return (classes - DATA_CLASSES) or {"how_to"}


def _suppress_incidental_page_topics(question: str, classes: set[str]) -> set[str]:
    """A resolved page_purpose answers from the page's DEFINITION, not from the database.

    The same backstop, for the same reason: "what is the Event Calendar for" names events, so the
    classifier returns {page_purpose, events} and the data path then answers a structural question
    with a list of what happens to be on next week. Worse, it made the answer depend on data access
    - which is why the identical question got a description for a guest and a flat refusal for an
    external account, when neither should ever have touched an event row.

    Applied ONLY when a real Area resolves. An unrecognised page name leaves the classes alone, so
    a question that merely sounds structural still has its data classes to fall back on.
    """
    if "page_purpose" not in classes or area_named(question) is None:
        return classes
    return (classes - DATA_CLASSES) or {"page_purpose"}


def classify(question: str, history: list[dict] | None = None) -> set[str]:
    """Every class this question touches, resolved against the recent conversation.

    An empty set means the classifier RAN and nothing matched - the honest out-of-scope path.
    Raises ClassificationUnavailable when it could not run at all, so the caller can say so instead
    of blaming the question. Never guesses in either case."""
    prior = ""
    if history:
        prior = (
            "RECENT CONVERSATION (for resolving what a vague follow-up refers to - never a source "
            "of facts):\n"
            + "\n".join(f"- Q: {turn['question']}" for turn in history[-3:])
            + "\n\n"
        )
    valid = list(CLASS_DESCRIPTIONS.keys())
    try:
        response = _generate_content(
            model=GENERATION_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=f"{prior}QUESTION:\n{question}")])],
            config=types.GenerateContentConfig(
                system_instruction=_system_instruction(),
                temperature=0.0,
                max_output_tokens=200,
                response_mime_type="application/json",
                response_schema=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "classes": types.Schema(
                            type=types.Type.ARRAY,
                            items=types.Schema(type=types.Type.STRING, enum=valid),
                        ),
                    },
                    required=["classes"],
                ),
            ),
        )
        parsed = json.loads(response.text or "{}")
        classes = parsed.get("classes") or []
        if not isinstance(classes, list):
            return set()
        # Defence in depth: response_schema's enum already constrains this, but a model can deviate
        # from schema on rare occasions, and an unrecognised class name would silently match nothing
        # downstream rather than erroring - masking the real problem.
        resolved = {c for c in classes if isinstance(c, str) and c in CLASS_DESCRIPTIONS}
        resolved = _suppress_incidental_how_to_topics(question, resolved)
        return _suppress_incidental_page_topics(question, resolved)
    except Exception as exc:  # noqa: BLE001 - see docstring: a classifier failure refuses, never guesses
        log.warning("ai.classify.failed", extra={"error": str(exc)})
        # Refusing is right; refusing with the WRONG REASON is not, and returning an empty set here
        # said "no class matched", which api/ai.py can only read as "genuinely outside what this
        # assistant covers".
        raise ClassificationUnavailable(str(exc)) from exc
