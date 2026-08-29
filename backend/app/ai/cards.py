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

from ..db import query

log = logging.getLogger(__name__)

# A cap, because a chat bubble with a dozen cards under it is a list, not a suggestion. Slightly
# above recommendation.MAX_SUGGESTIONS so an ordinary browse answer ("what's on this month") can
# still card everything it named.
MAX_CARDS = 6


def _names_in(answer: str, titles: dict[str, int]) -> list[int]:
    """The ids whose titles appear in `answer`, longest title first.

    Longest-first matters: a club called "1" (there is one in the seed data) would otherwise match
    the digit in every date and time in the reply. Requiring a word boundary on both sides handles
    the rest - "Coding Society" must appear as those words, not as a fragment of something else."""
    found: list[int] = []
    for title, entity_id in sorted(titles.items(), key=lambda pair: -len(pair[0])):
        if len(title.strip()) < 2:
            # A one-character title cannot be matched reliably against prose; skipping it costs a
            # card, where a false match puts a completely unrelated card under the answer.
            continue
        if re.search(rf"\b{re.escape(title)}\b", answer, re.IGNORECASE):
            found.append(entity_id)
    return found[:MAX_CARDS]


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
               (SELECT min(s.date)::text FROM event_schedule s WHERE s.request_id = r.request_id) AS "firstDate",
               (SELECT string_agg(DISTINCT es.location, ', ') FROM event_schedule es
                 WHERE es.request_id = r.request_id) AS location,
               (SELECT es.start_time::text FROM event_schedule es
                 WHERE es.request_id = r.request_id ORDER BY es.date LIMIT 1) AS "startTime",
               (SELECT es.end_time::text FROM event_schedule es
                 WHERE es.request_id = r.request_id ORDER BY es.date LIMIT 1) AS "endTime"
          FROM request r
         WHERE r.status = 'completed_approved' AND {visibility}
        """,
        {"user_id": user_id} if user_id is not None else {},
    )
    by_title = {row["event_title"]: row["request_id"] for row in rows}
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
        if topics & {"events", "my_registrations", "event_organiser", "event_organiser_decisions"}:
            events = event_cards(answer, user_id=user_id)
        if topics & {"clubs", "clubs_mine", "clubs_admin", "president_change"}:
            clubs = club_cards(answer)
    except Exception as exc:  # noqa: BLE001 - decoration must never break a correct answer
        log.warning("ai.cards.failed", extra={"error": str(exc)})
    return events, clubs
