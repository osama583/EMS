"""The topic vocabulary, and the two lookups that are genuinely lookups rather than guesses.

WHAT THIS MODULE USED TO BE, and why most of it is gone. It was a ~700-line keyword/regex router:
classify() matched a question against per-class patterns, a fuzzy pass rescued typos, and
needs_llm_verification() decided when a match was too weak to trust and a model call should
override it. gemini.classify_llm() existed only as the rescue path for what the patterns missed.

That arrangement had a problem the patterns themselves could not fix. Failing to match was always
SAFE - an empty class set produces "I don't have that information". The recurring bug was the other
direction: a SPECIFIC pattern missed and a BROAD one caught the question instead, so real data for
the wrong domain was loaded and answered from confidently. The removed code's own comments record
several ("what event catagories are inactive" caught by a bare `event` match; "what is the folder of
the page ongoing" caught by the word "ongoing"). Every new phrasing needed a new pattern, and each
broad pattern added made that failure mode likelier rather than rarer.

So classification is now the model's job (ai/classifier.py), and this module keeps only the parts
that were never guesses:

    CLASS_DESCRIPTIONS  the class vocabulary. Still the single source of truth, now shared three
                        ways: classifier.py feeds it verbatim into the classifier prompt,
                        topic_access.TOPIC_PAGES keys authorization off it, and
                        schema_catalog._TOPIC_GROUPS keys table selection off it. One definition,
                        no drift.
    named_role()        a dictionary lookup against knowledge_base's real role table. Asking the
                        model to re-derive a role_code it could get subtly wrong would be strictly
                        worse than matching the known list.
    how_to_topic()      which HOW_TO_GUIDES key a procedural question is about - a small, fixed,
                        known set of guides, matched by name. Same reasoning.

Both are only meaningful once the classifier has actually returned role_capability / how_to for
the question; they answer "which one", never "is it this kind of question at all".
"""
from __future__ import annotations

import re

Class = str

# Single source of truth for what each class MEANS. Fed verbatim into the classifier's prompt (see
# ai/classifier.py), so the model is describing the SAME classes topic_access and schema_catalog
# key off, never a drifted second definition.
CLASS_DESCRIPTIONS: dict[Class, str] = {
    "events": (
        "Browsing or asking about published events in general (not the caller's own "
        "registrations/organising). ALSO covers HOW MANY people registered for an event, how "
        "popular or full an event is, and which event has the most sign-ups - those counts are "
        "public information shown on every event's own card, so they belong here and NOT to "
        "event_organiser, which is about seeing WHO registered."
    ),
    "my_registrations": "The caller's own registrations/requests to attend events, or events they've saved.",
    "event_organiser": (
        "WHO has registered - attendee names/lists - or pending approvals, for events the caller "
        "organises (not yet decided). A bare COUNT question is NOT this class: 'how many "
        "registered' is public and belongs to `events`; only asking who they ARE lands here."
    ),
    "event_organiser_decisions": "Registrations the caller has ALREADY approved/rejected as organiser - a resolved decision log, not a live roster.",
    "clubs": (
        "Browsing/discovering clubs, or a fact about clubs in general (categories, a specific "
        "club's details). ALSO covers HOW MANY members a club has, including which club has the "
        "most or fewest and which are above/below a size - member counts are public, shown on "
        "Discover Clubs to every signed-in user, so they belong here and NOT to clubs_admin, "
        "which is about seeing WHO the members are."
    ),
    "clubs_mine": "The caller's own club membership, presidency, or join requests.",
    "clubs_admin": "Club-admin-only system-wide analytics (category counts, inactive/archived clubs, president-replacement leaderboard) - NOT a plain 'what category is club X in' question, and NOT a member-COUNT question ('which club has the most members', 'any club under 20'), which is public and belongs to `clubs`.",
    "president_change": "President-change requests specifically (handing over/stepping down as President).",
    "self_capability": "What the caller themselves can do/access in this app, given their own role(s).",
    "askable": "What the ASSISTANT can help with / what topics the caller may ask it about ('what can I ask about', 'what can you help me with') - not what they can DO in the app, which is self_capability.",
    "role_capability": "What a NAMED role (not the asker) can generally do/access - 'what can Cafeteria Staff access', 'is Club Admin able to...'.",
    "system_capability": "What the app/platform does in general, independent of who's asking.",
    "admin_ai_denials": "System-Admin-only: whether the AI assistant itself has refused to answer any question, who was refused, what topic, and why - the live audit log at /app/admin/ai-access-log. Not a question about what a role/page CAN access in general (that is role_capability); specifically about past REFUSALS the assistant already made.",
    "how_to": "A step-by-step 'how do I do X' procedural question.",
    "greeting": "A bare greeting or small talk with no real question ('hi', 'hey', 'help').",
}


# Which HOW_TO_GUIDES key a procedural question is about. First match wins, so more specific
# patterns come first where two could both apply.
_HOW_TO_TOPICS: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r"\bpropos(e|al)|\bsubmit.*(event|request)", re.IGNORECASE), "submit_proposal"),
    (re.compile(r"\bjoin.*club", re.IGNORECASE), "join_club"),
    (re.compile(r"\bpresident\b", re.IGNORECASE), "become_president"),
    (re.compile(r"\bregist(er|ration).*event|\battend.*event", re.IGNORECASE), "register_event"),
    (re.compile(r"\bresubmit|\bsent back|\bchanges? requested", re.IGNORECASE), "resubmit_proposal"),
    (re.compile(r"\bcancel", re.IGNORECASE), "cancel_proposal"),
    (re.compile(r"\breview.*proposal|\bapprove.*proposal|\bdecide.*proposal", re.IGNORECASE), "review_proposal"),
)


def named_role(question: str) -> str | None:
    """The role_code this question names, if any - resolved against knowledge_base's real role
    table, never guessed. Only meaningful when the classifier returned role_capability."""
    from .knowledge_base import resolve_role_name

    return resolve_role_name(question)


def how_to_topic(question: str) -> str | None:
    """Which HOW_TO_GUIDES key this how-to is about, or None.

    None means the question IS a how-to but matches no specific guide, so api/ai.py answers from
    the general system overview instead of a wrong or guessed procedure - and records it as
    `unsupported`, which is the most actionable row in the access log: it names the guide somebody
    should write."""
    for pattern, topic in _HOW_TO_TOPICS:
        if pattern.search(question):
            return topic
    return None
