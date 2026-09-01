"""THE INTENT VOCABULARY - the nine things a question can be, and nothing else.

This is the single definition of what the assistant recognises. It is shared three ways so no two
layers can drift apart:

    classifier.py       feeds INTENT_DESCRIPTIONS verbatim into the classifier prompt
    topic_access.py     keys authorization off the two DATA intents
    api/ai.py           routes each intent to exactly one answer path

NINE INTENTS, FOR SEVEN CAPABILITIES. The seven the assistant is defined by (see scope.py) plus
two conversational ones - a bare greeting, and "what can you do?" - which are not capabilities but
still have to be answered rather than dropped into the out-of-scope refusal.

An EMPTY intent set is a real answer, not a failure: it means the question is outside everything
above, and the honest reply is that this is not something the assistant covers. That is the whole
of the scope boundary. There is no "close enough" intent, no catch-all, and no fallback that reads
data for a question that matched nothing - the previous design's recurring bug was a broad class
catching what a specific one missed and answering confidently from the wrong domain.

SUGGESTION AND INFORMATION ARE SEPARATE INTENTS, per domain, because they are answered completely
differently: a suggestion asks about preferences before it retrieves anything, and an information
question retrieves immediately. Collapsing them into one "events" class is what made a preference
question come back as a list of twenty rows.
"""
from __future__ import annotations

from .scope import function_named, page_named  # noqa: F401 - re-exported: the two name lookups

Intent = str

# --- The DATA intents: answered from event/club rows, restricted to what the page displays -----

EVENT_INTENTS: frozenset[str] = frozenset({"event_suggestion", "event_info"})
CLUB_INTENTS: frozenset[str] = frozenset({"club_suggestion", "club_info"})
DATA_INTENTS: frozenset[str] = EVENT_INTENTS | CLUB_INTENTS

# --- The KNOWLEDGE intents: answered from scope.py's definitions and the caller's own token ----

KNOWLEDGE_INTENTS: frozenset[str] = frozenset({
    "page_purpose", "how_to", "who_am_i", "assistant_capability", "greeting",
})

# Which domain each suggestion/information intent belongs to. Used to carry a conversation's
# subject forward and to switch it when the asker changes topic.
INTENT_DOMAIN: dict[str, str] = {
    "event_suggestion": "events",
    "event_info": "events",
    "club_suggestion": "clubs",
    "club_info": "clubs",
}

# The topic (scope.TOPICS key) each data intent needs page access to.
INTENT_TOPIC: dict[str, str] = dict(INTENT_DOMAIN)


INTENT_DESCRIPTIONS: dict[Intent, str] = {
    "event_suggestion": (
        "Asking the assistant to CHOOSE an event for them - 'suggest an event', 'what should I go "
        "to', 'recommend something for the weekend', 'anything good coming up for me'. A "
        "preference question: they want a shortlist picked to fit them, not the catalogue. ALSO "
        "the turn where they ANSWER the assistant's question about what they enjoy ('I like coding "
        "and competitive things') while an event suggestion is in progress - that answer carries no "
        "recommendation wording of its own but is the same request continuing."
    ),
    "event_info": (
        "A question about an event or events as FACT - what is on, when, where, what it costs, "
        "what category it is, how many have registered, what it is about, which is biggest or "
        "soonest, does it need approval. Includes a question naming an event directly, and a "
        "follow-up about the event already being discussed ('when is it', 'is it free', 'what "
        "venue'). A question with its own objective criterion ('the event with the most "
        "registrations', 'the cheapest one') is INFORMATION, not a suggestion - the asker already "
        "said how to pick.\n"
        "  ALSO 'AM I REGISTERED FOR <this event>?', because that badge is printed on the event's "
        "own card to the person looking at it. It is a fact about ONE named event, so it is "
        "event_info. 'What am I registered for?' is NOT - that is a list across the My Events "
        "page rather than a flag on a card, and it is out of scope: return an empty list."
    ),
    "club_suggestion": (
        "Asking the assistant to CHOOSE a club for them - 'suggest a club', 'what club should I "
        "join', 'recommend a club for someone who likes volunteering'. The club counterpart of "
        "event_suggestion, including the turn where they answer the assistant's question about "
        "their interests while a club suggestion is in progress."
    ),
    "club_info": (
        "A question about a club or clubs as FACT - what a club does, its category, its "
        "description, who its President is, how many members it has, which club is biggest. "
        "Includes a question naming a club directly, and a follow-up about the club already being "
        "discussed ('what category is it', 'what do they do', 'how many members').\n"
        "  ALSO 'AM I IN <this club>?' / 'am I a member of <this club>?', because Discover Clubs "
        "computes exactly that flag for every card it shows. It is a fact about ONE named club, so "
        "it is club_info. 'Which clubs am I a member of?' is NOT - that is the My Clubs page, a "
        "list rather than a flag, and it is out of scope: return an empty list."
    ),
    "page_purpose": (
        "What a NAMED page or section of this app IS or is FOR - 'what is Explore Events', 'what "
        "does Discover Clubs do', 'what is the Event Calendar for', 'why would I use My Events', "
        "'explain Inbox', 'what is the difference between Discover Clubs and My Clubs'. A question "
        "about the app's own structure, answered from the app's definition of that page. It is NOT "
        "a request for what is currently ON the page: 'what is the Event Calendar for' is this "
        "intent, 'what is on the calendar next week' is event_info.\n"
        "  SEVERAL PAGE NAMES ALSO READ AS ORDINARY CONCEPTS, and naming one is still a page "
        "question. Page Visibility, Users, Roles, Units, Reports, Dashboard, Inbox, History, "
        "Ongoing, Drafts, Proposal, Event Categories, Event Formats, Venue Management, Manage "
        "Clubs, Club Category, AI Access Log and Created by Me are all real pages of this app. "
        "'What is Page Visibility?' asks what that PAGE is - it is page_purpose, NOT a question "
        "about permissions in general and NOT out of scope. Whether the asker can open the page is "
        "somebody else's decision, not yours: describe the intent, and let the answer path work "
        "out what they may see."
    ),
    "how_to": (
        "A procedural 'how do I do X' - how to register, save an event, join a club, submit a "
        "proposal, grant a page. Wants the steps and the page they happen on, NOT a list of "
        "things: 'how do I join a club' is this intent alone and must not also return club_info. "
        "'How can I find an event' and 'how do I discover clubs that match my interests' are how-to "
        "questions about using the app, not requests for a suggestion."
    ),
    "who_am_i": (
        "A question about the ASKER themselves - 'who am I', 'what is my name', 'what role do I "
        "have', 'what can I access', 'what pages can I see', 'am I a student'. Their own identity, "
        "roles and access. It is NOT 'what can YOU do' (that is assistant_capability) and NOT "
        "'what can some other role do', which this assistant does not answer at all. It is also "
        "NOT 'am I in <a named club>' or 'am I registered for <a named event>' - those are facts "
        "on that club's or event's card, so they are club_info and event_info."
    ),
    "assistant_capability": (
        "What the ASSISTANT can help with - 'what can you do', 'what can I ask you', 'how can you "
        "help me', 'what are you for'. About the assistant's own capabilities, never about the "
        "app's features or the asker's permissions."
    ),
    "greeting": (
        "A bare greeting or small talk carrying no question at all - 'hi', 'hey', 'yo', 'thanks', "
        "'ok'. The moment it carries a real question it is that question's intent instead."
    ),
}

ALL_INTENTS: frozenset[str] = frozenset(INTENT_DESCRIPTIONS)
