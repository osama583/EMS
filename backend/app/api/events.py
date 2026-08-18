"""Published events: discovery, registration, saved events, reminders.

    GET  /events                       published events (public)
    GET  /events/{id}                  one published event
    GET  /events/{id}/registrations    organiser-only attendee list
    POST /events/{id}/registrations    register
    DELETE /events/{id}/registrations/mine   cancel my registration
    POST /events/{id}/registrations/{rid}/decision   approve|reject (organiser)
    GET  /events/me/registrations      my registrations
    GET/PUT /events/me/saved/{id}      save / unsave
    GET/PUT /events/me/reminders       notification preferences

An event is "published" when its proposal reached completed_approved with public
visibility - there is no separate events table, which is why this reads from
`request`.

Discovery is deliberately open (no auth): a public events listing is public.
Everything under /me and the attendee list require a token.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import Conflict, Forbidden, NotFound, WorkflowError
from ..extensions import limiter
from ..security import require_auth
from ..security.principal import current_principal
from ..services import workflow as wf
from ._helpers import body, required

bp = Blueprint("events", __name__, url_prefix="/events")

# One definition of "published", used by every query below so the list and the
# detail view can never disagree about what is visible.
_PUBLISHED = "r.status = 'completed_approved' AND r.event_visibility IN ('Public', 'Club Only')"

_EVENT_SELECT = f"""
    SELECT r.request_id AS id, r.request_code AS "eventCode", r.event_title AS title,
           r.short_introduction AS summary, r.event_image AS "imageUrl",
           r.event_visibility AS visibility, r.event_format_snapshot AS format,
           r.registration_approval AS "registrationMode", r.max_pax AS "maxPax",
           r.cost_amount AS cost, r.applicant_name AS organiser,
           r.applicant_department_or_school AS "organiserUnit",
           (SELECT count(*) FROM event_registration er
             WHERE er.request_id = r.request_id AND er.status = 'registered')
             AS "confirmedRegistrations",
           (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id)
             AS "firstDate"
      FROM request r
     WHERE {_PUBLISHED}
"""


def _load_published(cur, event_id: int) -> dict:
    row = fetch_one(cur, _EVENT_SELECT + " AND r.request_id = %s", (event_id,))
    if row is None:
        raise NotFound("Event not found.")
    return row


@bp.get("")
@limiter.limit("120 per minute")
def list_events():
    """Public. No token required - this is the discovery page."""
    rows = query(_EVENT_SELECT + ' ORDER BY "firstDate" NULLS LAST, r.request_id DESC')
    return jsonify(rows)


@bp.get("/<int:event_id>")
@limiter.limit("120 per minute")
def get_event(event_id: int):
    with transaction() as cur:
        event = _load_published(cur, event_id)
        event["schedule"] = fetch_all(
            cur,
            'SELECT "date", start_time AS "startTime", end_time AS "endTime", location '
            "FROM event_schedule WHERE request_id = %s ORDER BY event_schedule_id",
            (event_id,),
        )
        event["categories"] = [
            r["category_name"]
            for r in fetch_all(
                cur, "SELECT category_name FROM request_categories WHERE request_id = %s", (event_id,)
            )
        ]
    return jsonify(event)


# --- Registration ---------------------------------------------------------
@bp.post("/<int:event_id>/registrations")
@require_auth
def register(event_id: int):
    """Register for an event.

    Capacity and duplicate checks run inside the transaction. The partial unique
    index on (request_id, user_id) WHERE status <> 'cancelled' is the real
    guard - the check below is only there to return a friendly message.
    """
    principal = current_principal()
    with transaction() as cur:
        event = _load_published(cur, event_id)

        existing = fetch_one(
            cur,
            "SELECT event_registration_id, status FROM event_registration "
            "WHERE request_id = %s AND user_id = %s AND status <> 'cancelled'",
            (event_id, principal.user_id),
        )
        if existing:
            raise Conflict("You are already registered for this event.")

        if event["maxPax"] is not None and event["confirmedRegistrations"] >= event["maxPax"]:
            raise WorkflowError("This event is full.", code="event_full")

        # Manual approval puts the registration in the organiser's queue.
        manual = (event["registrationMode"] or "").lower() == "manual"
        status = "pending_approval" if manual else "registered"
        payload = body() if manual else {}
        reason = str(payload.get("reason") or "") if manual else None
        if manual and not reason.strip():
            raise WorkflowError("This event asks why you would like to attend.")

        payment_status = "pending_review" if (event["cost"] or 0) > 0 else "not_required"
        cur.execute(
            """INSERT INTO event_registration
                   (request_id, user_id, registrant_name, registrant_email,
                    reason_for_attending, status, payment_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               RETURNING event_registration_id, status""",
            (
                event_id,
                principal.user_id,
                principal.full_name,
                principal.email,
                reason,
                status,
                payment_status,
            ),
        )
        row = dict(cur.fetchone())
    return jsonify(row), 201


@bp.delete("/<int:event_id>/registrations/mine")
@require_auth
def cancel_registration(event_id: int):
    principal = current_principal()
    with transaction() as cur:
        cur.execute(
            "UPDATE event_registration SET status = 'cancelled' "
            "WHERE request_id = %s AND user_id = %s AND status <> 'cancelled' "
            "RETURNING event_registration_id",
            (event_id, principal.user_id),
        )
        if cur.fetchone() is None:
            raise NotFound("You are not registered for this event.")
    return "", 204


@bp.get("/<int:event_id>/registrations")
@require_auth
def list_registrations(event_id: int):
    """The attendee list. Organiser only.

    The mock exposed this to any caller, handing out every registrant's name and
    email for any event id.
    """
    principal = current_principal()
    with transaction() as cur:
        _load_published(cur, event_id)
        if not wf.is_proposal_owner(cur, event_id, principal.user_id) and not principal.is_admin:
            raise Forbidden("Only the event's organiser can see who has registered.")
        rows = fetch_all(
            cur,
            """SELECT event_registration_id AS id, registrant_name AS name,
                      registrant_email AS email, reason_for_attending AS reason,
                      status, payment_status AS "paymentStatus", registered_at AS "registeredAt"
                 FROM event_registration WHERE request_id = %s ORDER BY registered_at""",
            (event_id,),
        )
    return jsonify(rows)


REGISTRATION_DECISIONS = ("approve", "reject")


@bp.post("/<int:event_id>/registrations/<int:registration_id>/decision")
@require_auth
def decide_registration(event_id: int, registration_id: int):
    """Organiser approves or rejects a manual-approval registration."""
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in REGISTRATION_DECISIONS:
        raise WorkflowError("Decision must be approve or reject.")

    with transaction() as cur:
        if not wf.is_proposal_owner(cur, event_id, principal.user_id) and not principal.is_admin:
            raise Forbidden("Only the event's organiser can decide registrations.")
        cur.execute(
            "UPDATE event_registration SET status = %s "
            "WHERE event_registration_id = %s AND request_id = %s AND status = 'pending_approval' "
            "RETURNING event_registration_id, status",
            ("registered" if decision == "approve" else "rejected", registration_id, event_id),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("No pending registration with that id for this event.")
    return jsonify(dict(row))


@bp.get("/me/registrations")
@require_auth
def my_registrations():
    principal = current_principal()
    return jsonify(
        query(
            """SELECT er.event_registration_id AS id, er.request_id AS "eventId",
                      r.event_title AS title, r.request_code AS "eventCode",
                      er.status, er.payment_status AS "paymentStatus",
                      er.registered_at AS "registeredAt",
                      (SELECT min(s."date") FROM event_schedule s
                        WHERE s.request_id = r.request_id) AS "firstDate"
                 FROM event_registration er
                 JOIN request r ON r.request_id = er.request_id
                WHERE er.user_id = %s ORDER BY er.registered_at DESC""",
            (principal.user_id,),
        )
    )


@bp.get("/me/pending-approvals")
@require_auth
def pending_approvals():
    """Registrations awaiting MY decision, across every event I organise."""
    principal = current_principal()
    return jsonify(
        query(
            """SELECT er.event_registration_id AS id, er.request_id AS "eventId",
                      r.event_title AS title, er.registrant_name AS name,
                      er.registrant_email AS email, er.reason_for_attending AS reason,
                      er.registered_at AS "registeredAt"
                 FROM event_registration er
                 JOIN request r ON r.request_id = er.request_id
                WHERE er.status = 'pending_approval' AND r.applicant_user_id = %s
             ORDER BY er.registered_at""",
            (principal.user_id,),
        )
    )


# --- Saved events and reminders ------------------------------------------
@bp.get("/me/saved")
@require_auth
def list_saved():
    principal = current_principal()
    return jsonify(
        query(
            """SELECT se.request_id AS "eventId", r.event_title AS title,
                      r.request_code AS "eventCode", se.saved_at AS "savedAt"
                 FROM saved_event se JOIN request r ON r.request_id = se.request_id
                WHERE se.user_id = %s ORDER BY se.saved_at DESC""",
            (principal.user_id,),
        )
    )


@bp.put("/me/saved/<int:event_id>")
@require_auth
def save_event(event_id: int):
    principal = current_principal()
    with transaction() as cur:
        _load_published(cur, event_id)
        cur.execute(
            "INSERT INTO saved_event (user_id, request_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (principal.user_id, event_id),
        )
    return jsonify({"eventId": event_id, "saved": True})


@bp.delete("/me/saved/<int:event_id>")
@require_auth
def unsave_event(event_id: int):
    principal = current_principal()
    with transaction() as cur:
        cur.execute(
            "DELETE FROM saved_event WHERE user_id = %s AND request_id = %s",
            (principal.user_id, event_id),
        )
    return "", 204


DEFAULT_REMINDERS = {"registrationClosingReminder": True, "eventStartingReminder": True}


@bp.get("/me/reminders")
@require_auth
def get_reminders():
    """Absence of a row is a valid state meaning "defaults", so this never 404s."""
    principal = current_principal()
    row = query(
        """SELECT registration_closing_reminder AS "registrationClosingReminder",
                  event_starting_reminder AS "eventStartingReminder"
             FROM notification_preference WHERE lower(email) = lower(%s)""",
        (principal.email,),
    )
    return jsonify(row[0] if row else DEFAULT_REMINDERS)


@bp.put("/me/reminders")
@require_auth
def set_reminders():
    """Merges over the existing row, so saving one toggle never resets the other."""
    principal = current_principal()
    payload = body()
    with transaction() as cur:
        existing = fetch_one(
            cur, "SELECT * FROM notification_preference WHERE lower(email) = lower(%s)",
            (principal.email,),
        )
        closing = bool(
            payload.get(
                "registrationClosingReminder",
                existing["registration_closing_reminder"] if existing else True,
            )
        )
        starting = bool(
            payload.get(
                "eventStartingReminder",
                existing["event_starting_reminder"] if existing else True,
            )
        )
        if existing:
            cur.execute(
                """UPDATE notification_preference
                      SET registration_closing_reminder = %s, event_starting_reminder = %s
                    WHERE lower(email) = lower(%s)""",
                (closing, starting, principal.email),
            )
        else:
            cur.execute(
                """INSERT INTO notification_preference
                       (email, registration_closing_reminder, event_starting_reminder)
                   VALUES (%s, %s, %s)""",
                (principal.email, closing, starting),
            )
    return jsonify(
        {"registrationClosingReminder": closing, "eventStartingReminder": starting}
    )
