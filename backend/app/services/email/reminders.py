"""Decides who is due an event reminder, and records that it was sent.

Three reminders, each opt-out per reader (notification_preference, set from
My Events > Saved / Registered):

  saved_capacity       a SAVED event passed SAVED_CAPACITY_PERCENT full and the
                       reader has not registered
  saved_starting       a SAVED event is within EVENT_REMINDER_LEAD_DAYS and the
                       reader has not registered
  registered_starting  an event the reader IS registered for is within
                       EVENT_REMINDER_LEAD_DAYS

WHY THIS IS SEPARATE FROM dispatch.py. Everything in dispatch is triggered by a
person doing something, inside that request's transaction. These three are
triggered by TIME (or by a counter someone else moved), so they are driven by a
job instead - see scripts/send_event_reminders.py.

IDEMPOTENCY IS THE WHOLE DESIGN. A daily job that re-reads the same rows would
re-send the same emails, so every send is recorded in event_reminder_sent and
every query excludes what is already there. Running the job twice in a day, or
twice in a minute, sends nothing the second time. The insert happens BEFORE the
send: a crash mid-run then costs one missed email rather than a repeated one,
which is the better failure for a mailbox.

MUTUAL EXCLUSION. A person who has registered is never in the saved-list
queries, even if they also saved the event - "you have not registered" would be
false, and "this is filling up" is irrelevant to someone holding a place.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from ...db import fetch_all
from . import notifications

logger = logging.getLogger(__name__)

CAPACITY = "saved_capacity"
SAVED_STARTING = "saved_starting"
REGISTERED_STARTING = "registered_starting"

# Column in notification_preference that switches each reminder off. A missing
# row means "all on" - absence is a valid state (see the LEFT JOIN below), so a
# reader who never touched the toggles still gets reminders.
_TOGGLE = {
    CAPACITY: "saved_capacity_reminder",
    SAVED_STARTING: "saved_starting_reminder",
    REGISTERED_STARTING: "registered_starting_reminder",
}


def _config(cur, code: str, default: int) -> int:
    rows = fetch_all(cur, "SELECT number FROM config WHERE code = %s", (code,))
    if not rows or rows[0]["number"] is None:
        return default
    value = rows[0]["number"]
    return int(value) if isinstance(value, (int, Decimal)) else default


def capacity_percent(cur) -> int:
    return _config(cur, "SAVED_CAPACITY_PERCENT", 70)


def lead_days(cur) -> int:
    return _config(cur, "EVENT_REMINDER_LEAD_DAYS", 3)


# The event columns every reminder needs, plus the date/venue of its first
# session. Only completed_approved events are ever reminded about: an event
# still in review has no place being announced to attendees.
_EVENT_FIELDS = """
           r.request_id,
           r.event_title,
           r.applicant_name AS organiser,
           r.max_pax,
           (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) AS first_date,
           (SELECT s.location FROM event_schedule s WHERE s.request_id = r.request_id
             ORDER BY s.event_schedule_id LIMIT 1) AS venue,
           (SELECT s.start_time FROM event_schedule s WHERE s.request_id = r.request_id
             ORDER BY s.event_schedule_id LIMIT 1) AS start_time,
           (SELECT s.end_time FROM event_schedule s WHERE s.request_id = r.request_id
             ORDER BY s.event_schedule_id LIMIT 1) AS end_time,
           (SELECT count(*) FROM event_registration er
             WHERE er.request_id = r.request_id AND er.status = 'registered') AS taken
"""



def _schedule_line(row: dict) -> str:
    if not row.get("first_date"):
        return "To be confirmed"
    start = str(row.get("start_time") or "")[:5]
    end = str(row.get("end_time") or "")[:5]
    when = f"{row['first_date']:%d %b %Y}"
    return f"{when}, {start}-{end}" if start and end else when



def due_capacity_reminders(cur) -> list[dict]:
    """Saved, not registered, capped, and at/over the threshold."""
    percent = capacity_percent(cur)
    return fetch_all(
        cur,
        f"""
        SELECT recipient.email, recipient.full_name, {_EVENT_FIELDS}
          FROM saved_event se
          JOIN request r ON r.request_id = se.request_id
          JOIN users recipient ON recipient.user_id = se.user_id
          LEFT JOIN notification_preference np ON lower(np.email) = lower(recipient.email)
         WHERE r.status = 'completed_approved'
           AND r.max_pax IS NOT NULL AND r.max_pax > 0
           AND recipient.email IS NOT NULL
           AND COALESCE(np.saved_capacity_reminder, TRUE)
           -- Not yet happened: an event that has already run cannot fill up.
           AND (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) >= current_date
           -- Registered people are excluded: they already hold a place.
           AND NOT EXISTS (
                 SELECT 1 FROM event_registration er
                  WHERE er.request_id = r.request_id AND er.user_id = se.user_id
                    AND er.status <> 'cancelled'
               )
           AND (SELECT count(*) FROM event_registration er
                 WHERE er.request_id = r.request_id AND er.status = 'registered')
               >= (r.max_pax * %(percent)s / 100.0)
           AND NOT EXISTS (
                 SELECT 1 FROM event_reminder_sent es
                  WHERE es.request_id = r.request_id
                    AND lower(es.email) = lower(recipient.email)
                    AND es.kind = %(kind)s
               )
        """,
        {"percent": percent, "kind": CAPACITY},
    )


def due_saved_starting_reminders(cur) -> list[dict]:
    """Saved, still not registered, and starting within the lead window."""
    days = lead_days(cur)
    return fetch_all(
        cur,
        f"""
        SELECT recipient.email, recipient.full_name, {_EVENT_FIELDS}
          FROM saved_event se
          JOIN request r ON r.request_id = se.request_id
          JOIN users recipient ON recipient.user_id = se.user_id
          LEFT JOIN notification_preference np ON lower(np.email) = lower(recipient.email)
         WHERE r.status = 'completed_approved'
           AND recipient.email IS NOT NULL
           AND COALESCE(np.saved_starting_reminder, TRUE)
           AND NOT EXISTS (
                 SELECT 1 FROM event_registration er
                  WHERE er.request_id = r.request_id AND er.user_id = se.user_id
                    AND er.status <> 'cancelled'
               )
           -- Inside the window and not already past.
           AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id)
                 BETWEEN current_date AND current_date + %(days)s
           AND NOT EXISTS (
                 SELECT 1 FROM event_reminder_sent es
                  WHERE es.request_id = r.request_id
                    AND lower(es.email) = lower(recipient.email)
                    AND es.kind = %(kind)s
               )
        """,
        {"days": days, "kind": SAVED_STARTING},
    )


def due_registered_starting_reminders(cur) -> list[dict]:
    """Holding a live registration on an event starting within the window.

    Reads the registrant's own name/email off event_registration rather than
    users: a guest registers by email alone and may have no users row, and they
    need this reminder as much as anyone.
    """
    days = lead_days(cur)
    return fetch_all(
        cur,
        f"""
        SELECT er.registrant_email AS email,
               er.registrant_name  AS full_name,
               {_EVENT_FIELDS}
          FROM event_registration er
          JOIN request r ON r.request_id = er.request_id
          LEFT JOIN notification_preference np ON lower(np.email) = lower(er.registrant_email)
         WHERE r.status = 'completed_approved'
           AND er.status = 'registered'
           AND er.registrant_email IS NOT NULL
           AND COALESCE(np.registered_starting_reminder, TRUE)
           AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id)
                 BETWEEN current_date AND current_date + %(days)s
           AND NOT EXISTS (
                 SELECT 1 FROM event_reminder_sent es
                  WHERE es.request_id = r.request_id
                    AND lower(es.email) = lower(er.registrant_email)
                    AND es.kind = %(kind)s
               )
        """,
        {"days": days, "kind": REGISTERED_STARTING},
    )


def _mark_sent(cur, email: str, request_id: int, kind: str) -> None:
    """Recorded BEFORE the send - see the module docstring on why a missed
    email beats a repeated one."""
    cur.execute(
        "INSERT INTO event_reminder_sent (email, request_id, kind) VALUES (%s, %s, %s) "
        "ON CONFLICT DO NOTHING",
        (email, request_id, kind),
    )


def _days_away(row: dict, today) -> int:
    if not row.get("first_date"):
        return 0
    return max(0, (row["first_date"] - today).days)


def send_due_reminders(cur, today) -> dict[str, int]:
    """Send every reminder currently due. Returns a per-kind count.

    Safe to call repeatedly: anything already recorded in event_reminder_sent is
    excluded by the queries above, so a second run in the same day sends nothing.
    """
    sent = {CAPACITY: 0, SAVED_STARTING: 0, REGISTERED_STARTING: 0}

    percent = capacity_percent(cur)
    for row in due_capacity_reminders(cur):
        taken, cap = int(row["taken"] or 0), int(row["max_pax"] or 0)
        if cap <= 0:
            continue
        _mark_sent(cur, row["email"], row["request_id"], CAPACITY)
        notifications.saved_event_filling_up(
            email=row["email"],
            full_name=row["full_name"] or "there",
            event_title=row["event_title"],
            schedule=_schedule_line(row),
            venue=row["venue"] or "To be confirmed",
            percent_full=min(100, round(taken * 100 / cap)),
            places_left=max(0, cap - taken),
        )
        sent[CAPACITY] += 1

    for row in due_saved_starting_reminders(cur):
        _mark_sent(cur, row["email"], row["request_id"], SAVED_STARTING)
        notifications.saved_event_starting_soon(
            email=row["email"],
            full_name=row["full_name"] or "there",
            event_title=row["event_title"],
            schedule=_schedule_line(row),
            venue=row["venue"] or "To be confirmed",
            days_away=_days_away(row, today),
        )
        sent[SAVED_STARTING] += 1

    for row in due_registered_starting_reminders(cur):
        _mark_sent(cur, row["email"], row["request_id"], REGISTERED_STARTING)
        notifications.registered_event_starting_soon(
            email=row["email"],
            full_name=row["full_name"] or "there",
            event_title=row["event_title"],
            schedule=_schedule_line(row),
            venue=row["venue"] or "To be confirmed",
            organiser=row["organiser"] or "the organiser",
            days_away=_days_away(row, today),
        )
        sent[REGISTERED_STARTING] += 1

    logger.info("email.reminders_sent", extra=dict(sent))
    return sent
