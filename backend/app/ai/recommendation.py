"""SUGGESTION BEHAVIOUR - the two-part flow, and the rules a shortlist has to obey.

A suggestion is not a lookup, and answering one as a lookup is what made the assistant read as a
database with a chat box bolted on: "suggest a club for me" came back as every club in the
catalogue, which answers "what exists", a question nobody asked.

THE FLOW HAS TWO PARTS, and the first is the one that gets skipped:

    ask        the assistant does not know what this person likes, because nobody has told it.
               So it asks - what they enjoy, what kind of thing they are after - and that question
               is the ENTIRE reply. No list, no "but here are a few anyway".
    recommend  they have said enough. Now name AT MOST THREE, each with a real reason drawn from
               what they actually said.

    clarify    the third case, and it is a different question: they want a suggestion but never
               said whether they mean events or clubs. Ask which. Guessing produced an events
               answer to someone who meant clubs.

ASKING TWICE IS THE FAILURE THIS IS BUILT AROUND. Whether the asker has already told us is not
re-derived here by keyword-matching the assistant's own previous sentences - that read the shape of
the conversation rather than its content, and missed anything said more than a turn ago.
classifier.read() accumulates everything the asker has stated about what they want across the whole
conversation into Reading.preferences, and its presence is the entire stage decision. So an
interest mentioned four turns back still counts, and the assistant never asks a question it has
already been answered.

NOTHING HERE READS THE DATABASE. An earlier version fetched the asker's own past registrations and
join requests to ground a suggestion in. That is the asker's own registration history - not one of
the things this assistant covers - so preferences now come from the conversation and only from the
conversation. It also removes the failure mode that came with it: a reply opening "since you
previously attended the Campus Fun Run" to someone who had just said "something sporty" answered a
question they did not ask and buried the one thing they cared about.
"""
from __future__ import annotations

# A suggestion names at most this many things. The number is the point: a shortlist with reasons is
# a suggestion, a list of nine is a search result.
MAX_SUGGESTIONS = 3

# How many candidate rows the retrieval step returns for the model to choose from. Wide, because
# matching "I like building things" to a hackathon is judgement about meaning, and SQL cannot do it
# - a LIKE against the literal word "building" returns nothing while the hackathon sits in the
# table. Retrieve broadly, choose narrowly.
CANDIDATE_LIMIT = 20

ASK = "ask"
CLARIFY = "clarify"
RECOMMEND = "recommend"

_DOMAIN_WORD = {"events": "event", "clubs": "club"}


def stage_for(reading) -> str:
    """Which part of the flow this turn is in. Only ever called for a suggestion intent."""
    if reading.domain is None:
        return CLARIFY
    return RECOMMEND if reading.preferences else ASK


def clarify_document() -> str:
    """They asked for a suggestion without saying events or clubs."""
    return (
        "No data was retrieved, and none should be - you are asking the asker what they meant. "
        "They want a suggestion but have not said whether they mean EVENTS or CLUBS, and the two "
        "are different things. Ask which, warmly, in ONE short sentence. That question is your "
        "entire reply: do not guess, do not answer for both, and do not claim you lack access."
    )


def ask_document(domain: str) -> str:
    """The first suggestion request of a conversation: ask before retrieving anything."""
    thing = _DOMAIN_WORD.get(domain, "thing")
    examples = (
        "the kind of event they are after - talks, workshops, competitions, social, sports, "
        "cultural, volunteering - and roughly when they are free"
        if domain == "events" else
        "what they are into - academic, sports, cultural, volunteering, social, creative, "
        "professional - and what they want out of it"
    )
    return "\n".join([
        f"No data was retrieved yet, and none should be - you are asking a question, not answering "
        f"one. The asker wants a {thing} suggestion, and you do not know what they like, because "
        "nobody has told you.",
        f"Ask them, in one or two friendly sentences: what they enjoy, {examples}. Say briefly "
        "that it helps you pick the right one.",
        "THAT QUESTION IS YOUR ENTIRE REPLY. No list, no shortlist, no 'but here are a few "
        "anyway', no preview. Do not open by reciting their name, role or school back at them. "
        "Asking is not a delay - it is the difference between a suggestion and a catalogue.",
    ])


def recommend_document(domain: str, preferences: str | None) -> str:
    """They have told us enough - now suggest properly, and only from the candidates retrieved."""
    thing = _DOMAIN_WORD.get(domain, "thing")
    lines = [
        f"SUGGESTION TURN. The asker wants a {thing} suggestion and has already told you what they "
        "are after, so do NOT ask again - asking a question you have been answered reads as not "
        "listening.",
    ]
    if preferences:
        lines.append(f"WHAT THEY HAVE TOLD YOU, across this conversation: {preferences}")
    lines += [
        f"Name AT MOST {MAX_SUGGESTIONS} of the candidates you were given. Fewer is better: if "
        "exactly one genuinely fits, name that one and say why it stands out - a single well-matched "
        "suggestion beats three padded ones.",
        "EVERY ONE MUST CARRY A REAL REASON tied to what they actually said, drawn from the "
        "candidate's own description. 'It is on Friday' is not a reason. 'You said you like "
        "building things, and this one is a 24-hour build event' is.",
        "IF THEY CONSTRAINED THE TIMING - this weekend, this month, next week - state the DATE in "
        "the sentence, so they can see you honoured it.",
        "NEVER INVENT A REASON. You know only what they told you and what the candidate rows say. "
        "Do not infer an interest from their name, their school or department, or from the title of "
        "the thing you are suggesting.",
        "THE ASKER IS ALREADY IN SOME OF THESE, and the rows tell you which - a viewer_is_member, "
        "viewer_is_president or viewer_is_registered flag. Never suggest one of those as though it "
        "were new. Pitching somebody the club they already run reads as not knowing who you are "
        "talking to, and Discover Clubs would not even have shown it to them.",
        "  PREFER the ones they are NOT in. If a genuinely new match exists, that is the "
        "suggestion, and there is no need to mention the rest.",
        "  BUT IF THE ONLY THING THAT FITS IS ONE THEY ARE ALREADY IN, say so warmly instead of "
        "reporting that you found nothing - dropping it silently throws away the most relevant "
        "thing you have. Tell them there is nothing else in that line right now, name the one they "
        "are already part of AS one they are already part of, say what it does, and offer to widen "
        "the search or look at something adjacent. For example: there is nothing else on the "
        "coding-and-competition side at the moment, but that is the APU Coding Society you are "
        "already in - weekly hackathons and competitive programming - want me to look at something "
        "close to it instead?",
        "IF NOTHING GENUINELY FITS AT ALL, say so plainly and offer to widen the search or show "
        "what is on. Never pad the list, and never stretch a poor match to fill it.",
        "SKIP PLACEHOLDER ROWS. Real data contains test records - a club named '1', an event called "
        "'new test', anything with a meaningless title or no real description. You cannot give a "
        "genuine reason for one, so never suggest one.",
        "DO NOT USE A FIXED SENTENCE SKELETON. 'Since you are interested in X, you might consider "
        "Y', repeated every turn, reads as a form letter. React to what they said the way a person "
        "would, then bring the suggestion up naturally - lead with it sometimes, lead with the "
        "reaction other times.",
    ]
    return "\n".join(lines)
