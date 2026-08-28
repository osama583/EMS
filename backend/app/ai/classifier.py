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

FAILURE MODE: an API failure returns an empty set, and an empty set means "nothing matched", which
api/ai.py already handles as the honest out-of-scope path (refuse, log, do not retrieve). A
classifier outage therefore degrades to refusing rather than to answering something unverified.
"""
from __future__ import annotations

import json
import logging

from google.genai import types

from .gemini import GENERATION_MODEL, _generate_content
from .query_router import CLASS_DESCRIPTIONS, how_to_topic, named_role  # noqa: F401 - re-exported

log = logging.getLogger(__name__)

__all__ = ["CLASS_DESCRIPTIONS", "classify", "how_to_topic", "named_role"]


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
        "",
        "If the question is a short follow-up that carries no topic of its own ('is it active', "
        "'what about that one', 'yes', 'show me the list'), classify it against what the RECENT "
        "CONVERSATION was actually about.",
        "",
        "CLASSES:",
    ]
    lines += [f"- {name}: {description}" for name, description in CLASS_DESCRIPTIONS.items()]
    return "\n".join(lines)


# Classes answered entirely from knowledge_base.py's hand-written content - no database query, no
# SQL generation. Static narrative text about the app itself: what it does, what a role can do,
# how to perform an action, and what the asker may ask about. These deliberately did NOT move to
# Text-to-SQL: there are no rows behind "how do I submit a proposal", and reconstructing a
# procedure from the schema every time would be both slower and less reliable than the curated
# text that already exists.
KNOWLEDGE_BASE_CLASSES: frozenset[str] = frozenset({
    "self_capability",
    "askable",
    "role_capability",
    "system_capability",
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


def classify(question: str, history: list[dict] | None = None) -> set[str]:
    """Every class this question touches, resolved against the recent conversation.

    Never raises: any failure (API error, malformed JSON) returns an empty set, which api/ai.py
    treats as "no topic matched" - the honest refuse-and-log path, never a silent guess."""
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
        return _suppress_incidental_how_to_topics(question, resolved)
    except Exception as exc:  # noqa: BLE001 - see docstring: a classifier failure refuses, never guesses
        log.warning("ai.classify.failed", extra={"error": str(exc)})
        return set()
