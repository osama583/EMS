"""Rich cards for the events and clubs an answer actually names.

WHY THIS HAD TO COME BACK. The old retrieval layer built these from its vector matches; deleting
it deleted the cards too, and `sources`/`clubs` went out empty on every response. The frontend
still renders cards (ai-assistant.html iterates `message.sources` and `message.clubs`), so the
visible result was a suggestion arriving as a wall of plain text where it used to arrive as
clickable cards with images, dates and locations. That is a straight regression, not a design
change.

THE RELEVANCE RULE, which is the whole reason this is not just "return every row". A card is built
only for an entity the ANSWER TEXT actually names. A query legitimately returns rows the reply
never mentions - the model was given nine events and picked three - and carding all nine would put
six cards under an answer that never brought them up. Matching on the answer means the cards are
always exactly what the reader is looking at.

WHY NOT CARD FROM THE SQL RESULT DIRECTLY. Two reasons. The result's shape is unpredictable (the
model chooses its own columns and aliases, so there may be no id column at all), and the rows are
the model's INPUT, not its conclusion. Re-reading the named entities from the primary database
gives a stable shape and fresh data, and re-applies the visibility check rather than trusting a
row that has been round-tripped through a prompt.

SECURITY. Every lookup here re-checks visibility from scratch:
  - events: the same published-and-visible rule api/events.py enforces (guest -> Public/Club Only,
    signed-in -> + Internal, owner -> their own at any visibility);
  - clubs: active and non-archived only.
So a card can never surface something the asker could not already see, even if a title somehow
appeared in an answer it should not have. The card layer is not a second authorization boundary -
it just refuses to be a way around the first one.
"""
from __future__ import annotations

import logging
import re
from datetime import date

from ..db import query

log = logging.getLogger(__name__)

# A cap, because a chat bubble with a dozen cards under it is a list, not a suggestion. Slightly
# above recommendation.MAX_SUGGESTIONS so an ordinary browse answer ("what's on this month") can
# still card everything it named.
MAX_CARDS = 6


# Everything that is not a letter or a digit collapses to a single space, so a title matches the
# way a reader would judge it to match rather than byte-for-byte.
#
# WHY, concretely. The old match escaped the title and required \b on both sides, which meant the
# reply had to reproduce every apostrophe, hyphen, ampersand and run of spaces exactly as the
# database stored them. Models do not: they write "APUs Hackathon" for "APU's Hackathon", "Tech -
# Symposium" for "Tech – Symposium" (en dash to hyphen), and single-space a title stored with a
# double space. Every one of those is the event the reader is looking at, and every one of them
# silently produced no card - which is how a correct answer naming a real event ends up decorated
# with a page link instead of that event's own card. Worse, \b is defined against word characters,
# so a title ending in ")" or "!" could never match at all.
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
# Apostrophes are DELETED rather than collapsed to a space, and the order matters. Collapsing turns
# "APU's Hackathon" into "apu s hackathon" while the model's "APUs Hackathon" becomes "apus
# hackathon" - still two different strings, so the exact mismatch this normalisation exists to
# absorb would survive it. Deleting first lands both on "apus hackathon".
_APOSTROPHE = re.compile(r"['’ʼ`]")


def _normalise(text: str) -> str:
    return _NON_ALNUM.sub(" ", _APOSTROPHE.sub("", text.lower())).strip()


def _names_in(answer: str, titles: dict[str, int]) -> list[int]:
    """The ids whose titles appear in `answer`, longest title first.

    Longest-first matters: a club called "1" (there is one in the seed data) would otherwise match
    the digit in every date and time in the reply. Word boundaries still apply - "Coding Society"
    must appear as those words, not as a fragment of something else - but they are enforced by
    padding both sides with a space after normalisation rather than by \\b, which is both stricter
    about punctuation and undefined at a non-word character."""
    # Padded, so " coding society " can only match on whole-word edges - the normalised equivalent
    # of the \b anchors this replaced.
    haystack = f" {_normalise(answer)} "
    found: list[tuple[int, int]] = []
    for title, entity_id in titles.items():
        needle = _normalise(title)
        if len(needle) < 2:
            # A one-character title cannot be matched reliably against prose; skipping it costs a
            # card, where a false match puts a completely unrelated card under the answer.
            continue
        if f" {needle} " in haystack:
            found.append((len(needle), entity_id))
    # Longest first, so the more specific title leads when one contains another ("APU Coding
    # Society" over "Coding").
    return [entity_id for _length, entity_id in sorted(found, key=lambda pair: -pair[0])][:MAX_CARDS]


def _occurrence_rank(row: dict, today: date) -> tuple[int, int, int]:
    """Sort key putting the occurrence an ANSWER means first: soonest upcoming, then most recent
    past, then anything with no schedule at all. request_id breaks ties so the order is total.

    `firstDate` already encodes the same convention WITHIN one event (next sitting on or after
    today, else the earliest), so a row whose firstDate is in the past is an event that is over."""
    raw = row.get("firstDate")
    if not raw:
        return (2, 0, row["request_id"])
    when = date.fromisoformat(raw)
    if when >= today:
        return (0, when.toordinal(), row["request_id"])
    return (1, -when.toordinal(), row["request_id"])


def _best_row_per_title(rows: list[dict]) -> dict[str, int]:
    """title -> the request_id a card for that title should point at.

    TITLES ARE NOT UNIQUE, and this used to be a dict comprehension that pretended they were: two
    published events both called "APU Hackathon 2026" collapsed to whichever the database happened
    to return last, with no ORDER BY anywhere to make even that repeatable. The assistant answered
    "the APU Hackathon 2026... thirty-six hours, three sponsor challenge tracks" about the 25
    September one, correctly, and the card underneath it read 10 June - a different event, already
    past, that the reply had never mentioned. Clicking it opened the wrong event.

    Matching on the answer TEXT cannot disambiguate this (the text names a title, and both rows
    have it), so the tie is broken the way the rest of this module already breaks it: an answer
    recommending an event means a FUTURE one. Same rule as `firstDate`, applied across same-titled
    events rather than within one.

    A dropped duplicate is logged rather than silently discarded - two published events sharing a
    title is a data problem, and it is the thing to look at first if a card ever looks wrong."""
    today = date.today()
    by_title: dict[str, int] = {}
    for row in sorted(rows, key=lambda r: _occurrence_rank(r, today)):
        title = row["event_title"]
        if title in by_title:
            log.info(
                "ai.cards.duplicate_title",
                extra={"title": title, "kept": by_title[title], "dropped": row["request_id"]},
            )
            continue
        by_title[title] = row["request_id"]
    return by_title


def event_cards(answer: str, *, user_id: int | None) -> list[dict]:
    """Card data for every published event the answer names, re-read live and re-checked against
    the same visibility rule the discovery endpoints apply."""
    # 'Club Only' is a membership test, not a tier anyone signed-in can read - it resolves
    # against request_clubs/club_members exactly as api/events.py _published_clause does.
    visibility = (
        "r.event_visibility = 'Public'"
        if user_id is None
        else """(r.event_visibility IN ('Public', 'Internal')
                 OR (r.event_visibility = 'Club Only' AND EXISTS (
                       SELECT 1 FROM request_clubs rc
                         JOIN club_members cm ON cm.club_id = rc.club_id
                        WHERE rc.request_id = r.request_id AND cm.user_id = %(user_id)s))
                 OR r.applicant_user_id = %(user_id)s)"""
    )
    rows = query(
        f"""
        SELECT r.request_id, r.event_title,
               r.event_image AS "eventImageUrl",
               (SELECT string_agg(rc.category_name, ', ') FROM request_categories rc
                 WHERE rc.request_id = r.request_id) AS category,
               -- THE NEXT date on or after today, falling back to the earliest when the whole
               -- event is in the past - not min(date) unconditionally.
               --
               -- WHY IT DIFFERS from api/events.py's own "firstDate" (a plain min). A card here
               -- sits directly beneath a sentence the assistant just wrote about that event, and
               -- the answer is virtually always about what is COMING UP - so a multi-day or
               -- recurring event whose first sitting has passed produced a visible contradiction:
               -- the text said "Beach Clean-Up on 2026-09-11" over a card reading 2026-04-05, and
               -- "Deepavali Open House from 2026-09-06" over a card reading 2026-11-06. Same
               -- event, same reply, two different dates, and nothing on screen to explain it.
               -- A page of cards can afford a "starts on" convention; a card captioned by a
               -- sentence cannot disagree with the sentence.
               (SELECT s.date::text FROM event_schedule s
                 WHERE s.request_id = r.request_id
                 ORDER BY (s.date < CURRENT_DATE), s.date LIMIT 1) AS "firstDate",
               (SELECT string_agg(DISTINCT es.location, ', ') FROM event_schedule es
                 WHERE es.request_id = r.request_id) AS location,
               -- Times come from the SAME sitting the date does, for the same reason.
               (SELECT es.start_time::text FROM event_schedule es
                 WHERE es.request_id = r.request_id
                 ORDER BY (es.date < CURRENT_DATE), es.date LIMIT 1) AS "startTime",
               (SELECT es.end_time::text FROM event_schedule es
                 WHERE es.request_id = r.request_id
                 ORDER BY (es.date < CURRENT_DATE), es.date LIMIT 1) AS "endTime"
          FROM request r
         WHERE r.status = 'completed_approved' AND {visibility}
        """,
        {"user_id": user_id} if user_id is not None else {},
    )
    by_title = _best_row_per_title(rows)
    named = set(_names_in(answer, by_title))
    return [
        {
            "eventId": str(row["request_id"]),
            "eventTitle": row["event_title"],
            # The frontend's model carries `similarity` from the vector era.
            "similarity": 1.0,
            "eventImageUrl": row["eventImageUrl"],
            "firstDate": row["firstDate"],
            "location": row["location"],
            "startTime": row["startTime"],
            "endTime": row["endTime"],
            "category": row["category"],
        }
        for row in rows
        if row["request_id"] in named
    ]


def club_cards(answer: str) -> list[dict]:
    """Card data for every active club the answer names. Club identity/description is public to any
    signed-in caller (the same information a club's own page shows); membership is not, and none is
    returned here."""
    rows = query(
        """
        SELECT c.club_id, c.club_name AS "clubName", c.description, c.image_url AS "imageUrl",
               (SELECT string_agg(cc.name, ', ') FROM club_category_links l
                 JOIN club_categories cc ON cc.club_category_id = l.club_category_id
                WHERE l.club_id = c.club_id) AS categories
          FROM clubs c
         WHERE c.active AND c.archived_at IS NULL
        """
    )
    by_title = {row["clubName"]: row["club_id"] for row in rows}
    named = set(_names_in(answer, by_title))
    return [
        {
            "clubId": str(row["club_id"]),
            "clubName": row["clubName"],
            "description": row["description"],
            "imageUrl": row["imageUrl"],
            "categories": row["categories"],
        }
        for row in rows
        if row["club_id"] in named
    ]


def build(answer: str, topics: set[str], *, user_id: int | None) -> tuple[list[dict], list[dict]]:
    """(event_cards, club_cards) for this answer, restricted to the topics the question was
    actually about - so a club answer does not sprout event cards because it happened to mention a
    word that matches an event title."""
    events: list[dict] = []
    clubs: list[dict] = []
    try:
        if "events" in topics:
            events = event_cards(answer, user_id=user_id)
        if "clubs" in topics:
            clubs = club_cards(answer)
    except Exception as exc:  # noqa: BLE001 - decoration must never break a correct answer
        log.warning("ai.cards.failed", extra={"error": str(exc)})
    return events, clubs
