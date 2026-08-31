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
    "page_purpose": (
        "What a NAMED page or section of this app is FOR - 'what is the Event Calendar for', "
        "'what does Manage Clubs do', 'what is the point of Happening Soon', 'what is Explore "
        "Events'. A question about the app's own structure, answered from the app's definition of "
        "that page. It is NOT a request for what is currently ON the page: 'what is the Event "
        "Calendar for' is this class, 'what's on the calendar next week' is `events`."
    ),
    "admin_ai_denials": "System-Admin-only: whether the AI assistant itself has refused to answer any question, who was refused, what topic, and why - the live audit log at /app/admin/ai-access-log. Not a question about what a role/page CAN access in general (that is role_capability); specifically about past REFUSALS the assistant already made.",
    "how_to": "A step-by-step 'how do I do X' procedural question.",
    "greeting": "A bare greeting or small talk with no real question ('hi', 'hey', 'help').",
}


# Which scope.GUIDES key a procedural question is about. FIRST MATCH WINS, so the order is
# specific-to-general and every pattern here is deliberately narrow.
#
# ORDERING IS THE WHOLE DESIGN, and the previous order had it backwards: `\bpropos(e|al)` sat
# first, so "how do I review a proposal" and "how do I cancel a proposal" both resolved to
# submit_proposal and answered with the wrong procedure. A general pattern placed above a specific
# one silently swallows it, which is the same failure mode that removed the regex CLASSIFIER - the
# difference is that a guide set is small, fixed and known, so matching a name against it is a
# lookup rather than a guess.
#
# NO MATCH IS A REAL ANSWER, not a fallback: it means the assistant has no guide for this, and
# api/ai.py now says so instead of improvising from the system overview.
_HOW_TO_TOPICS: tuple[tuple[re.Pattern, str], ...] = (
    # --- Attending an event: the visitor-tier actions, most specific first ---------------------
    (re.compile(r"\bcancel\w*\b[^.?]*\b(registration|registered|booking|sign[- ]?up|place|spot|ticket)"
                r"|\bunregister|\bun-?enrol", re.IGNORECASE), "cancel_registration"),
    (re.compile(r"\bproof of payment|\bpayment proof|\breceipt\b|\b(upload|attach)\w*\b[^.?]*\bpay",
                re.IGNORECASE), "upload_payment_proof"),
    (re.compile(r"\bsav(e|ing)\b[^.?]*\bevent|\bbookmark|\bfavou?rite|\bheart\b|\bwish ?list",
                re.IGNORECASE), "save_event"),
    # --- Deciding somebody else's request: always more specific than making one ----------------
    (re.compile(r"\b(approve|reject|decline|decide|action|handle)\w*\b[^.?]*\bpresident",
                re.IGNORECASE), "decide_president_change"),
    (re.compile(r"\b(approve|reject|decline|decide|action|handle)\w*\b[^.?]*\b(join|membership) request",
                re.IGNORECASE), "decide_join_request"),
    (re.compile(r"\b(approve|reject|decline|decide|action|handle)\w*\b[^.?]*"
                r"\b(registration|registrant|attendee|sign[- ]?up)", re.IGNORECASE), "decide_registration"),
    # --- Proposals: the three that must outrank the bare "proposal" pattern below --------------
    (re.compile(r"\bresubmit|\bsent back|\bchanges? requested", re.IGNORECASE), "resubmit_proposal"),
    (re.compile(r"\b(review|approve|reject|decline|decide)\w*\b[^.?]*\bproposal", re.IGNORECASE),
     "review_proposal"),
    (re.compile(r"\bcancel\w*\b[^.?]*\b(proposal|event)", re.IGNORECASE), "cancel_proposal"),
    # --- Clubs: administering one outranks joining one, which outranks presidency --------------
    (re.compile(r"\b(create|add|set ?up|start|edit|update|rename|delete|remove|deactivate|archive|manage)"
                r"\w*\b[^.?]*\bclub", re.IGNORECASE), "manage_clubs"),
    (re.compile(r"\bjoin\b[^.?]*\bclub|\bclub\b[^.?]*\bjoin", re.IGNORECASE), "join_club"),
    (re.compile(r"\bpresident\b", re.IGNORECASE), "become_president"),
    # --- The two general ones, last ------------------------------------------------------------
    (re.compile(r"\bpropos(e|al)|\bsubmit\b[^.?]*\b(event|request)", re.IGNORECASE), "submit_proposal"),
    (re.compile(r"\bregist(er|ration)|\battend\b[^.?]*\bevent", re.IGNORECASE), "register_event"),
)


def named_role(question: str) -> str | None:
    """The role_code this question names, if any - resolved against knowledge_base's real role
    table, never guessed. Only meaningful when the classifier returned role_capability."""
    from .knowledge_base import resolve_role_name

    return resolve_role_name(question)


def how_to_topic(question: str) -> str | None:
    """Which scope.GUIDES key this how-to is about, or None.

    None means the question IS a how-to but matches no guide the app has written, so api/ai.py says
    it has no instructions for that - and records it as `unsupported`, the most actionable row in
    the access log: it names the guide somebody should write. It used to answer from the general
    system overview instead, which is how "how do I save an event" reached a caller as a confident,
    unverified procedure."""
    for pattern, topic in _HOW_TO_TOPICS:
        if pattern.search(question):
            return topic
    return None


def area_named(question: str) -> str | None:
    """Which page or section of the app a `page_purpose` question names, or None.

    A dictionary lookup against scope.AREAS - the same reasoning as named_role() above, and for the
    same reason: the app's page list is finite and written down, so matching against it beats
    asking a model to re-derive a page's purpose (which is exactly how a "personal calendar" this
    app has never had came to be described to a guest)."""
    from .scope import area_named as _area_named

    return _area_named(question)
