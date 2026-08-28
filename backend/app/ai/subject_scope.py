"""Whose data is this question about - the asker's own, or somebody else's?

topic_access.py answers "may this caller reach this TOPIC at all" (page
grants). This module answers a different question the assistant was never
asking: "is the caller entitled to this data ABOUT THIS PERSON". Both must pass.

Why this exists. Several classes are defined as the caller's OWN rows -
proposals_mine, my_registrations, clubs_mine, event_organiser. The router
classifies purely on wording, so "do I have any proposals" and "what proposals
does Mei Yee have" both land on proposals_mine, and retrieval then runs scoped
to the CALLER either way. Two bad outcomes followed:

  1. The refusal reason was wrong. A caller without the page grant asking about
     Mei Yee was told "an administrator has not granted your role the pages..."
     - a page-visibility message for what is actually a privacy boundary. The
     answer is not "ask your admin for access"; no page grant would ever entitle
     them to another person's proposals.
  2. The only thing preventing a WRONG answer was the system prompt. With the
     page grant present, nothing in code stopped the caller's own proposals
     being retrieved and presented as the answer to a question about someone
     else. The model does currently catch it, but prompt-level defences are the
     layer that has failed repeatedly in this system (hallucinated clubs,
     invented roles). This makes it structural.

What counts as "about someone else": a person's name that resolves to a real
user other than the caller, or a third-person pronoun (her/his/their/she/he)
with no first-person framing. Deliberately conservative - an unresolvable name
is NOT treated as a third-party question, because refusing on a false positive
("what is the Annual Hackathon Kickoff about") is its own bug.

SELF-SCOPED_CLASSES are the only ones gated here. A question naming another
person is perfectly legitimate for public-ish facts - "is Priya the president
of any club" is answered for any signed-in caller (see
club_retrieval.presidencies_of) - so this must not fire for clubs/events
browsing, only for the classes that mean "MY rows".
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

# Classes whose retrieval is defined as "the caller's own rows". Asking one of
# these about another person is never satisfiable by that person's own data, so
# it is refused rather than silently answered with the caller's.
SELF_SCOPED_CLASSES: frozenset[str] = frozenset({
    "proposals_mine", "proposals_review", "my_registrations",
    "event_organiser", "event_organiser_decisions", "clubs_mine",
})

# Third-person pronouns - covers "what tasks in HER proposal does SHE have",
# which names nobody but is plainly about another person. Deliberately excludes
# "they/them", which are too often impersonal in this domain ("what do they
# require") to be a safe signal on their own.
_THIRD_PERSON = re.compile(r"\b(her|hers|his|she|he|him)\b", re.IGNORECASE)

# First-person framing anywhere in the question means the asker is talking about
# themselves, and any name present is likely context rather than the subject
# ("did I approve Ravi Chandran's registration" is the caller's OWN decision
# log - a legitimate self-scoped question that must not be refused).
_FIRST_PERSON = re.compile(r"\b(i|me|my|mine|myself|i'?ve|i'?m)\b", re.IGNORECASE)


def other_person_in_question(
    question: str,
    *,
    caller_user_id: int | None,
    name_candidates: list[str],
    resolve_name,
    resolve_name_fuzzy=None,
) -> str | None:
    """The full name of a person OTHER than the caller that this question is
    about, or None.

    `resolve_name` is club_retrieval.find_user_by_name (injected rather than
    imported so this module stays free of retrieval dependencies and is trivial
    to unit-test). It only resolves an exact, unambiguous match, so a
    false-positive candidate simply fails to resolve.

    `resolve_name_fuzzy` (club_retrieval.find_user_by_name_fuzzy) is consulted
    only when the exact lookup fails. That function's own docstring warns it must
    never be used to ANSWER about a person - correct, because guessing who was
    meant and then answering would be a real leak. Using it to REFUSE is the
    opposite: a partial name like "Mei Yee" for "Tan Mei Yee" still means the
    question is about a person, and erring toward refusal is the safe direction.
    Without it, a partial name silently produced no privacy refusal at all and
    the caller got a page-permission message for what is really a privacy
    boundary.

    Returns None when the question is first-person framed, even if it names
    someone - see _FIRST_PERSON."""
    if caller_user_id is None:
        return None
    # An EXACTLY resolved other person outranks first-person framing. The _FIRST_PERSON early-return
    # below exists so "what are MY clubs" is not read as a third-party question, but "is Mei Ling Tan
    # in any of MY clubs" satisfies it too - and that shape was observed answering in full, including
    # the negative "she is not in the Business Leaders Circle", which discloses another person's
    # membership either way. Whose data is being asked FOR is decided by the named subject, not by
    # whose possessive frames the sentence. Only the exact resolver is consulted here: the fuzzy one
    # would turn any first-person question containing a name-like word into a refusal.
    for candidate in name_candidates:
        target = resolve_name(candidate)
        if target is not None and target["user_id"] != caller_user_id:
            return target["full_name"]
    if _FIRST_PERSON.search(question):
        return None
    if resolve_name_fuzzy is not None:
        for candidate in name_candidates:
            near = resolve_name_fuzzy(candidate)
            if near:
                # Refuse against the closest real name. Never used to answer, so
                # picking the top candidate cannot disclose anything.
                return near[0]
    return None


def third_party_subject(
    question: str,
    *,
    caller_user_id: int | None,
    name_candidates: list[str],
    resolve_name,
    resolve_name_fuzzy=None,
) -> str | None:
    """Who this question is about, if not the caller: a resolved person's name,
    or the literal string "someone else" when only a third-person pronoun
    identifies them. None means the question is about the caller themselves.

    The pronoun path returns a placeholder rather than None so the refusal can
    still be specific ("you can only see your own proposals") instead of falling
    through to a page-access message that misdescribes the reason."""
    named = other_person_in_question(
        question,
        caller_user_id=caller_user_id,
        name_candidates=name_candidates,
        resolve_name=resolve_name,
        resolve_name_fuzzy=resolve_name_fuzzy,
    )
    if named:
        return named
    if caller_user_id is not None and not _FIRST_PERSON.search(question) and _THIRD_PERSON.search(question):
        return "someone else"
    return None


# Sibling classes that belong to the same DOMAIN as a self-scoped class. When a question is
# refused on privacy grounds, its whole domain has to go: "what proposals does Mei Yee have" hits
# proposals_mine (self-scoped) and can also pick up proposals_review from the LLM verification
# step. Dropping only the self-scoped one leaves the sibling for the page gate to refuse
# separately, producing an answer that gives a privacy reason AND a "contact an administrator"
# page reason for the same question - contradictory, and the page reason is not why it was refused.
_DOMAIN_SIBLINGS: dict[str, frozenset[str]] = {
    "proposals_mine": frozenset({"proposals_mine", "proposals_review"}),
    "proposals_review": frozenset({"proposals_mine", "proposals_review"}),
    "clubs_mine": frozenset({"clubs_mine"}),
    "my_registrations": frozenset({"my_registrations", "event_organiser", "event_organiser_decisions"}),
    "event_organiser": frozenset({"my_registrations", "event_organiser", "event_organiser_decisions"}),
    "event_organiser_decisions": frozenset({"my_registrations", "event_organiser", "event_organiser_decisions"}),
}


def classes_to_drop(self_scoped_hit: set[str]) -> set[str]:
    """Every class to remove for a privacy refusal - the self-scoped classes that matched, plus
    their same-domain siblings (see _DOMAIN_SIBLINGS)."""
    drop: set[str] = set(self_scoped_hit)
    for cls in self_scoped_hit:
        drop |= _DOMAIN_SIBLINGS.get(cls, frozenset())
    return drop


def denial_document(subject: str, classes: set[str]) -> str:
    """CONTEXT line telling the model to refuse on PRIVACY grounds, not page
    access. Worded so the model cannot mistake it for "no data found" (which it
    would phrase as "you have none") or for a page-visibility problem (which it
    would phrase as "ask your administrator")."""
    what = "proposals or requests" if classes & {"proposals_mine", "proposals_review"} else (
        "club membership" if "clubs_mine" in classes else "event registrations or tasks"
    )
    who = "another person's" if subject == "someone else" else f"{subject}'s"
    return (
        f"This question asks about {who} {what}, which belongs to someone other than the asker. "
        f"The asker may only ever see their OWN {what} in this app - this is a privacy rule, NOT a "
        f"page-permission problem, so do NOT tell them to contact an administrator and do NOT imply "
        f"access could be granted. Say plainly that you can only share their own {what}, and offer "
        f"to show those instead. Do not state, guess, or imply anything about "
        f"{'that person' if subject == 'someone else' else subject}."
    )
