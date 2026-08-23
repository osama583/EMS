"""Published events: discovery, registration, saved events, reminders.

    GET  /events                       every published event, unfiltered (public)
    GET  /events/search                published events, filtered/paginated (public, see search_events)
    GET  /events/{id}                  one published event
    GET  /events/{id}/registrations    organiser-only attendee list
    POST /events/{id}/registrations    register
    GET  /events/{id}/registrations/mine     my registration for this event
    GET  /events/me/registration-statuses    my registration status for many events at once
    DELETE /events/{id}/registrations/mine   cancel my registration
    POST /events/{id}/registrations/{rid}/decision   approve|reject (organiser)
    GET  /events/me/registrations      my registrations (?scope=active|history)
    GET  /events/me/pending-approvals  registrations awaiting my decision
    GET  /events/me/organized          events I proposed that are now published
    GET/PUT /events/me/saved/{id}      save / unsave
    GET/PUT /events/me/reminders       notification preferences

An event is "published" when its proposal reached completed_approved with public
visibility - there is no separate events table, which is why this reads from
`request`.

Discovery is deliberately open (no auth): a public events listing is public.
Everything under /me and the attendee list require a token.
"""
from __future__ import annotations

import uuid
from datetime import date

from flask import Blueprint, g, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound, WorkflowError
from ..extensions import limiter
from ..security import authenticate_optional, require_auth
from ..security.passwords import hash_password
from ..security.principal import current_principal
from ..services import workflow as wf
from ._helpers import body, required

bp = Blueprint("events", __name__, url_prefix="/events")

# One definition of "published", used by every query below so the list and the
# detail view can never disagree about what is visible.
#
# 'Public' and 'Club Only' are visible to anyone (guests included) - Club Only additionally
# requires real club membership, enforced client-side today (see explore-events.ts's
# canSeeClubOnlyFilter) since there is no server-side membership check on read yet.
# 'Internal' is visible to any authenticated internal user, guests excluded - it exists for
# events that should reach the whole APU community but not the public web.
# 'Private' is never returned here at all - it has no discovery surface.
_GUEST_VISIBLE = "('Public', 'Club Only')"
_INTERNAL_VISIBLE = "('Public', 'Club Only', 'Internal')"


def _published_clause(include_internal: bool, owner_clause: str | None = None) -> str:
    visible = _INTERNAL_VISIBLE if include_internal else _GUEST_VISIBLE
    status_and_visibility = f"r.status = 'completed_approved' AND r.event_visibility IN {visible}"
    if not owner_clause:
        return status_and_visibility
    # my_organized_events() is the one caller that passes owner_clause: the event's own
    # creator/co-owner must see it on their organiser dashboard even when event_visibility is
    # 'Private' (which has no discovery surface for anyone else - see the module comment above).
    # Still requires completed_approved, same as every other viewer - an owner doesn't get to see
    # their own event before/without it actually being published.
    return f"r.status = 'completed_approved' AND (r.event_visibility IN {visible} OR ({owner_clause}))"


# Column list matches the frontend's PublishedEvent model field for field, so
# no client-side remapping is needed. Registration counts are computed here
# rather than shipping the registration rows for the browser to count.
def _event_select(include_internal: bool, owner_clause: str | None = None) -> str:
    return f"""
    SELECT r.request_id::text AS id,
           r.event_title AS "eventTitle",
           r.short_introduction AS "shortIntroduction",
           r.goals_objectives AS goals,
           r.expected_benefits AS "expectedBenefits",
           r.event_visibility AS "eventVisibility",
           r.promotion_publicity_method AS "promotionMethod",
           r.event_format_snapshot AS "eventFormat",
           r.event_image AS "eventImageUrl",
           r.applicant_department_or_school AS "schoolDepartment",
           r.applicant_name AS organiser,
           r.total_pax AS "totalExpectedPax",
           r.max_pax AS "maxPax",
           r.registration_approval AS "registrationMode",
           r.cost_amount AS cost,
           r.bank_account_name AS "bankAccountName",
           r.bank_account_number AS "bankAccountNumber",
           (SELECT count(*) FROM event_registration er
             WHERE er.request_id = r.request_id AND er.status = 'registered')
             AS "confirmedRegistrationCount",
           (SELECT count(*) FROM event_registration er
             WHERE er.request_id = r.request_id AND er.status = 'pending_approval')
             AS "pendingRegistrationCount",
           (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id)
             AS "firstDate"
      FROM request r
     WHERE {_published_clause(include_internal, owner_clause)}
"""


# Back-compat default (guest-visible only) for the few call sites that only ever run
# unauthenticated - kept as a plain string so they read exactly as before.
_EVENT_SELECT = _event_select(include_internal=False)


def _decorate(cur, event: dict) -> dict:
    """Add the child collections and derived flags the model declares."""
    event_id = int(event["id"])
    event["schedule"] = [
        {
            "date": str(row["date"]),
            "start": str(row["start_time"])[:5],
            "end": str(row["end_time"])[:5],
            "location": row["location"],
        }
        for row in fetch_all(
            cur,
            'SELECT "date", start_time, end_time, location FROM event_schedule '
            "WHERE request_id = %s ORDER BY event_schedule_id",
            (event_id,),
        )
    ]
    event["categories"] = [
        row["category_name"]
        for row in fetch_all(
            cur, "SELECT category_name FROM request_categories WHERE request_id = %s", (event_id,)
        )
    ]
    # The model expects an image ASSET, not a bare URL.
    url = event.pop("eventImageUrl", None)
    event["eventImage"] = (
        {"url": url, "fileName": "", "mimeType": "", "sizeBytes": 0, "status": "uploaded"}
        if url
        else None
    )
    cost = event.get("cost")
    event["cost"] = float(cost) if cost is not None else None
    event["isFree"] = not event["cost"]
    # Audience is not modelled in the schema; the guest breakdown is the nearest
    # equivalent the proposal form collects.
    event["audience"] = [
        row["guest_type"]
        for row in fetch_all(
            cur, "SELECT DISTINCT guest_type FROM general_guest WHERE request_id = %s", (event_id,)
        )
    ]
    return event


def _load_published(cur, event_id: int, include_internal: bool = False) -> dict:
    row = fetch_one(cur, _event_select(include_internal) + " AND r.request_id = %s", (event_id,))
    if row is None:
        raise NotFound("Event not found.")
    return row


_HOUR_EXPR = "EXTRACT(HOUR FROM es.start_time)"
_TIME_PERIODS = {
    # Mirrors explore-events.ts's timePeriodFor(): bucketed off the FIRST schedule row's start hour.
    "Morning": f"{_HOUR_EXPR} < 12",
    "Afternoon": f"{_HOUR_EXPR} >= 12 AND {_HOUR_EXPR} < 17",
    "Evening": f"{_HOUR_EXPR} >= 17",
}


def _list_events_filters(args) -> tuple[str, list]:
    """Builds the WHERE-clause fragments + params for every Explore Events filter,
    mirroring explore-events.ts's getMatchingEvents()/matches()/matchesDate() exactly
    so query params are a drop-in replacement for the old client-side filtering."""
    clauses: list[str] = []
    params: list = []

    search = (args.get("q") or "").strip()
    if search:
        clauses.append(
            """(r.event_title ILIKE %s OR r.applicant_department_or_school ILIKE %s
                 OR r.event_format_snapshot ILIKE %s
                 OR EXISTS (SELECT 1 FROM request_categories rc
                             WHERE rc.request_id = r.request_id AND rc.category_name ILIKE %s)
                 OR EXISTS (SELECT 1 FROM event_schedule es
                             WHERE es.request_id = r.request_id AND es.location ILIKE %s))"""
        )
        like = f"%{search}%"
        params += [like, like, like, like, like]

    visibility = args.getlist("visibility")
    if visibility:
        clauses.append("r.event_visibility = ANY(%s)")
        params.append(visibility)

    category = args.getlist("category")
    if category:
        clauses.append(
            "EXISTS (SELECT 1 FROM request_categories rc "
            "WHERE rc.request_id = r.request_id AND rc.category_name = ANY(%s))"
        )
        params.append(category)

    school = args.getlist("school")
    if school:
        clauses.append("r.applicant_department_or_school = ANY(%s)")
        params.append(school)

    event_format = args.getlist("format")
    if event_format:
        clauses.append("r.event_format_snapshot = ANY(%s)")
        params.append(event_format)

    registration = args.getlist("registration")
    if registration:
        wants_required = "Registration Required" in registration
        wants_none = "No Registration Required" in registration
        if wants_required and not wants_none:
            clauses.append("r.registration_approval IN ('Automatic', 'Manual')")
        elif wants_none and not wants_required:
            clauses.append("(r.registration_approval IS NULL OR r.registration_approval NOT IN ('Automatic', 'Manual'))")

    cost = args.getlist("cost")
    if cost:
        wants_paid = "Paid" in cost
        wants_free = "Free" in cost
        if wants_paid and not wants_free:
            clauses.append("r.cost_amount > 0")
        elif wants_free and not wants_paid:
            clauses.append("(r.cost_amount IS NULL OR r.cost_amount = 0)")

    time_periods = [p for p in args.getlist("time") if p in _TIME_PERIODS]
    if time_periods:
        time_sql = " OR ".join(f"({_TIME_PERIODS[p]})" for p in time_periods)
        clauses.append(
            f"""EXISTS (
                SELECT 1 FROM event_schedule es
                 WHERE es.request_id = r.request_id
                   AND es.event_schedule_id = (
                         SELECT es2.event_schedule_id FROM event_schedule es2
                          WHERE es2.request_id = r.request_id
                       ORDER BY es2.event_schedule_id LIMIT 1)
                   AND ({time_sql})
            )"""
        )

    date_options = args.getlist("date")
    date_from = (args.get("dateFrom") or "").strip()
    date_to = (args.get("dateTo") or "").strip()
    if date_options:
        # "firstDate" is a SELECT-list alias (a scalar subquery in _EVENT_SELECT) - not visible to
        # a WHERE clause appended to that same query, so it is recomputed here inline instead.
        first_date = "(SELECT min(s.\"date\") FROM event_schedule s WHERE s.request_id = r.request_id)"
        date_clauses = []
        for option in date_options:
            if option == "Today":
                date_clauses.append(f"{first_date} = current_date")
            elif option == "Tomorrow":
                date_clauses.append(f"{first_date} = current_date + 1")
            elif option == "This Week":
                date_clauses.append(f"{first_date} BETWEEN current_date AND current_date + 7")
            elif option == "This Weekend":
                date_clauses.append(
                    f"({first_date} <= current_date + 10 AND EXTRACT(DOW FROM {first_date}) IN (0, 6))"
                )
            elif option == "This Month":
                date_clauses.append(
                    f"date_trunc('month', {first_date}) = date_trunc('month', current_date)"
                )
            elif option == "Custom Date Range":
                range_clause = f"{first_date} IS NOT NULL"
                if date_from:
                    range_clause += f" AND {first_date} >= %s::date"
                    params.append(date_from)
                if date_to:
                    range_clause += f" AND {first_date} <= %s::date"
                    params.append(date_to)
                date_clauses.append(f"({range_clause})")
        if date_clauses:
            clauses.append("(" + " OR ".join(date_clauses) + ")")

    return (" AND " + " AND ".join(clauses) if clauses else ""), params


@bp.get("")
@limiter.limit("120 per minute")
def list_events():
    """Public. No token required - this is the discovery page.

    Unfiltered, unpaginated - used by callers that want every published event
    (Happening Soon, the events calendar). Explore Events' filtered/paginated
    view is GET /events/search instead.
    """
    with transaction() as cur:
        rows = fetch_all(cur, _EVENT_SELECT + ' ORDER BY "firstDate" NULLS LAST, r.request_id DESC')
        return jsonify([_decorate(cur, row) for row in rows])


@bp.get("/search")
@limiter.limit("120 per minute")
def search_events():
    """Public. No token required. Optionally authenticated: a valid bearer
    token from an internal (non-guest) user also surfaces 'Internal'-visibility
    events, and excludes events the caller already registered for when
    ?excludeRegistered=1.

    Every Explore Events filter, the search box, and pagination are handled
    here - see _list_events_filters() for the filter-to-SQL mapping. Query
    params: q, visibility, category, school, format, time, registration, cost,
    date (repeatable), dateFrom, dateTo, excludeRegistered, page, pageSize.
    """
    authenticate_optional()
    principal = getattr(g, "principal", None)
    include_internal = principal is not None and not principal.is_external

    where, params = _list_events_filters(request.args)

    if request.args.get("excludeRegistered") and principal is not None:
        where += (
            """ AND NOT EXISTS (
                    SELECT 1 FROM event_registration er
                     WHERE er.request_id = r.request_id AND er.user_id = %s
                       AND er.status IN ('registered', 'pending_approval')
                )"""
        )
        params.append(principal.user_id)

    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(60, max(1, int(request.args.get("pageSize", 9))))
    except ValueError:
        page_size = 9
    offset = (page - 1) * page_size

    event_select = _event_select(include_internal)
    with transaction() as cur:
        total = fetch_one(cur, f"SELECT count(*) AS n FROM ({event_select}{where}) AS matched", params)["n"]
        rows = fetch_all(
            cur,
            f'{event_select}{where} ORDER BY "firstDate" NULLS LAST, r.request_id DESC LIMIT %s OFFSET %s',
            [*params, page_size, offset],
        )
        items = [_decorate(cur, row) for row in rows]

    return jsonify({"items": items, "total": total, "page": page, "pageSize": page_size})


@bp.get("/<int:event_id>")
@limiter.limit("120 per minute")
def get_event(event_id: int):
    """Public. No token required. Optionally authenticated: an internal
    (non-guest) caller can also load an 'Internal'-visibility event."""
    authenticate_optional()
    principal = getattr(g, "principal", None)
    include_internal = principal is not None and not principal.is_external
    with transaction() as cur:
        event = _decorate(cur, _load_published(cur, event_id, include_internal))
    return jsonify(event)


def _guest_user_id(cur, name: str, email: str) -> int:
    """Find-or-create the users row backing an anonymous registration.

    event_registration.user_id is NOT NULL (see 001_initial_schema.sql), so an
    unauthenticated registration still needs a real users row rather than a
    truly guest-less record. Reused across repeat visits by email, exactly like
    an account, except it holds a random unusable password hash - it grants no
    login capability, only an identity to attach registrations to. This is a
    separate concept from POST /auth/register's guest signup (a real password
    account); a visitor who later signs up for real with the same email will
    get auth.py's "That email address cannot be registered" conflict, which is
    an accepted trade-off rather than something this endpoint tries to solve.
    """
    existing = fetch_one(cur, "SELECT user_id FROM users WHERE lower(email) = %s", (email,))
    if existing:
        return existing["user_id"]

    cur.execute(
        """INSERT INTO users (full_name, email, password, is_active)
           VALUES (%s, %s, %s, TRUE) RETURNING user_id""",
        (name, email, hash_password(uuid.uuid4().hex)),
    )
    user_id = cur.fetchone()["user_id"]
    cur.execute(
        "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, NULL, %s)",
        (user_id, "external-user"),
    )
    return user_id


# --- Registration ---------------------------------------------------------
@bp.post("/<int:event_id>/registrations")
def register(event_id: int):
    """Register for an event - open to a signed-in caller or an anonymous guest.

    A public event needs no account to attend: an anonymous caller supplies
    name/email in the body and is registered under a lazily created (or
    reused, by email) account with no login capability - see _guest_user_id().
    A signed-in caller registers under their own identity as before.

    Capacity and duplicate checks run inside the transaction. The partial unique
    index on (request_id, user_id) WHERE status <> 'cancelled' is the real
    guard - the check below is only there to return a friendly message.
    """
    authenticate_optional()
    principal = getattr(g, "principal", None)
    # Not the shared body() helper: an authenticated caller registering for a free,
    # automatic-approval event may send no JSON body at all (nothing required of them), which
    # body() would reject outright. A guest still gets validated below via the name/email check.
    payload = request.get_json(silent=True) or {}

    if principal is not None:
        user_id, full_name, email = principal.user_id, principal.full_name, principal.email
    else:
        full_name = str(payload.get("name") or "").strip()
        email = str(payload.get("email") or "").strip().lower()
        if not full_name or not email:
            raise BadRequest("Name and email are required to register.")

    with transaction() as cur:
        include_internal = principal is not None and not principal.is_external
        event = _load_published(cur, event_id, include_internal)

        if principal is None:
            user_id = _guest_user_id(cur, full_name, email)

        existing = fetch_one(
            cur,
            "SELECT event_registration_id, status FROM event_registration "
            "WHERE request_id = %s AND user_id = %s AND status <> 'cancelled'",
            (event_id, user_id),
        )
        if existing:
            raise Conflict("You are already registered for this event.")

        if event["maxPax"] is not None and event["confirmedRegistrationCount"] >= event["maxPax"]:
            raise WorkflowError("This event is full.", code="event_full")

        # Manual approval puts the registration in the organiser's queue.
        manual = (event["registrationMode"] or "").lower() == "manual"
        status = "pending_approval" if manual else "registered"
        paid = (event["cost"] or 0) > 0
        reason = str(payload.get("reason") or "") if manual else None
        if manual and not reason.strip():
            raise WorkflowError("This event asks why you would like to attend.")

        payment_status = "pending_review" if paid else "not_required"
        proof_url = str(payload.get("paymentProofUrl") or "") or None if paid else None
        proof_file_name = str(payload.get("paymentProofFileName") or "") or None if paid else None
        if paid and not proof_url:
            raise WorkflowError("This event requires proof of payment.")

        cur.execute(
            """INSERT INTO event_registration
                   (request_id, user_id, registrant_name, registrant_email,
                    reason_for_attending, status, payment_status,
                    payment_proof_url, payment_proof_file_name)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING event_registration_id, status""",
            (
                event_id,
                user_id,
                full_name,
                email,
                reason,
                status,
                payment_status,
                proof_url,
                proof_file_name,
            ),
        )
        row = dict(cur.fetchone())
    return jsonify(
        {
            "status": "pending" if row["status"] == "pending_approval" else "confirmed",
            "message": (
                "Your registration is pending approval."
                if row["status"] == "pending_approval"
                else "You're registered for this event."
            ),
        }
    ), 201


_STATUS_TO_REGISTRATION_STATUS = {
    "registered": "confirmed",
    "pending_approval": "pending",
    "rejected": "rejected",
}


@bp.get("/<int:event_id>/registrations/mine")
@require_auth
def my_registration(event_id: int):
    """The caller's own (non-cancelled) registration for one event, or null."""
    principal = current_principal()
    row = query(
        """SELECT event_registration_id AS id, request_id::text AS "eventId",
                  registrant_email AS email, registrant_name AS name,
                  coalesce(reason_for_attending, '') AS reason,
                  registered_at AS "registeredAt", status,
                  payment_proof_url AS "paymentProofUrl",
                  payment_proof_file_name AS "paymentProofFileName",
                  payment_status AS "paymentStatus"
             FROM event_registration
            WHERE request_id = %s AND user_id = %s AND status <> 'cancelled'""",
        (event_id, principal.user_id),
    )
    if not row:
        return jsonify(None)
    record = dict(row[0])
    record["status"] = _STATUS_TO_REGISTRATION_STATUS.get(record["status"], record["status"])
    return jsonify(record)


@bp.get("/me/registration-statuses")
@require_auth
def my_registration_statuses():
    """My (non-cancelled) registration status for many events at once, as {eventId: status}.

    Explore Events used to call GET /{id}/registrations/mine once per card on the page (N
    requests for N cards, refired on every filter/search/page change) purely to know which
    events to badge/exclude - this collapses that into one query. Missing events (no
    registration, or none of the given ids exist) are simply absent from the response.
    """
    principal = current_principal()
    raw_ids = request.args.get("eventIds", "")
    try:
        event_ids = [int(part) for part in raw_ids.split(",") if part.strip()]
    except ValueError:
        raise BadRequest("eventIds must be a comma-separated list of integers.")
    if not event_ids:
        return jsonify({})

    rows = query(
        """SELECT request_id::text AS "eventId", status
             FROM event_registration
            WHERE user_id = %s AND request_id = ANY(%s) AND status <> 'cancelled'""",
        (principal.user_id, event_ids),
    )
    return jsonify({row["eventId"]: _STATUS_TO_REGISTRATION_STATUS.get(row["status"], row["status"]) for row in rows})


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
        _load_published(cur, event_id, include_internal=True)
        if not wf.is_proposal_owner(cur, event_id, principal.user_id) and not principal.is_admin:
            raise Forbidden("Only the event's organiser can see who has registered.")
        rows = fetch_all(
            cur,
            """SELECT event_registration_id AS id, registrant_name AS name,
                      registrant_email AS email, reason_for_attending AS reason,
                      status, payment_status AS "paymentStatus",
                      payment_proof_url AS "paymentProofUrl",
                      payment_proof_file_name AS "paymentProofFileName",
                      registered_at AS "registeredAt"
                 FROM event_registration WHERE request_id = %s ORDER BY registered_at""",
            (event_id,),
        )
    for row in rows:
        row["status"] = _STATUS_TO_REGISTRATION_STATUS.get(row["status"], row["status"])
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
        approve = decision == "approve"
        # Approving admits the registrant AND clears a payment that was awaiting review -
        # there is no separate payment-approval step for the organiser to remember.
        cur.execute(
            """UPDATE event_registration
                  SET status = %s,
                      payment_status = CASE WHEN %s AND payment_status = 'pending_review'
                                            THEN 'approved' ELSE payment_status END
                WHERE event_registration_id = %s AND request_id = %s AND status = 'pending_approval'
            RETURNING event_registration_id, status""",
            ("registered" if approve else "rejected", approve, registration_id, event_id),
        )
        row = cur.fetchone()
        if row is None:
            raise NotFound("No pending registration with that id for this event.")
    return jsonify(dict(row))


@bp.get("/me/registrations")
@require_auth
def my_registrations():
    """My registrations, as full published-event records paired with my status.

    ?scope=active restricts to confirmed registrations for events that have not
    ended yet; ?scope=pending restricts to manual-approval registrations still
    awaiting the organiser's decision; ?scope=history returns everything else
    (past confirmed events, and any rejected registration). Cancelled
    registrations never appear.
    """
    principal = current_principal()
    scope = request.args.get("scope")
    with transaction() as cur:
        rows = fetch_all(
            cur,
            f"""{_event_select(include_internal=not principal.is_external).rstrip()}
                  AND EXISTS (
                        SELECT 1 FROM event_registration er
                         WHERE er.request_id = r.request_id AND er.user_id = %(user_id)s
                           AND er.status <> 'cancelled'
                      )
             ORDER BY "firstDate" NULLS LAST, r.request_id DESC""",
            {"user_id": principal.user_id},
        )
        my_status_by_event = {
            row["request_id"]: row["status"]
            for row in fetch_all(
                cur,
                """SELECT request_id, status FROM event_registration
                    WHERE user_id = %s AND status <> 'cancelled'""",
                (principal.user_id,),
            )
        }
        events = [_decorate(cur, row) for row in rows]

    today = date.today().isoformat() if scope in ("active", "history") else None

    items = []
    for event in events:
        raw_status = my_status_by_event.get(int(event["id"]), "registered")
        status = _STATUS_TO_REGISTRATION_STATUS.get(raw_status, raw_status)
        ended = bool(event["schedule"]) and max(row["date"] for row in event["schedule"]) < today if today else False
        if scope == "active" and (status != "confirmed" or ended):
            continue
        if scope == "pending" and status != "pending":
            continue
        if scope == "history" and status == "pending":
            continue
        if scope == "history" and status == "confirmed" and not ended:
            continue
        items.append({"event": event, "status": status})

    return jsonify({"items": items, "total": len(items)})


@bp.get("/me/pending-approvals")
@require_auth
def pending_approvals():
    """Registrations awaiting MY decision, across every event I organise."""
    principal = current_principal()
    rows = query(
        """SELECT er.event_registration_id::text AS id, er.request_id::text AS "eventId",
                  r.event_title AS "eventTitle", r.request_code AS "eventCode",
                  er.registrant_name AS name, er.registrant_email AS email,
                  coalesce(er.reason_for_attending, '') AS reason,
                  'pending' AS status,
                  er.payment_proof_url AS "paymentProofUrl",
                  er.payment_proof_file_name AS "paymentProofFileName",
                  er.payment_status AS "paymentStatus",
                  (r.cost_amount IS NOT NULL AND r.cost_amount > 0) AS "paymentRequired",
                  er.registered_at AS "registeredAt"
             FROM event_registration er
             JOIN request r ON r.request_id = er.request_id
            WHERE er.status = 'pending_approval' AND r.applicant_user_id = %s
         ORDER BY er.registered_at""",
        (principal.user_id,),
    )
    return jsonify(rows)


@bp.get("/me/decided-registrations")
@require_auth
def decided_registrations():
    """Registrations I have already approved or rejected, across every event I
    organise (or co-own) - the resolved counterpart to pending_approvals().

    status='registered' alone can't tell an organiser's approval apart from an
    automatic-mode registration that was never reviewed by anyone, so this is
    restricted to manual-approval events - the only ones where a registration
    ever passes through an organiser decision at all. Unlike pending_approvals()
    (applicant-only), ownership here also covers co-owners, matching
    my_organized_events()'s broader check.
    """
    principal = current_principal()
    rows = query(
        """SELECT er.event_registration_id::text AS id, er.request_id::text AS "eventId",
                  r.event_title AS "eventTitle", r.request_code AS "eventCode",
                  er.registrant_name AS name, er.registrant_email AS email,
                  coalesce(er.reason_for_attending, '') AS reason,
                  er.status,
                  er.payment_proof_url AS "paymentProofUrl",
                  er.payment_proof_file_name AS "paymentProofFileName",
                  er.payment_status AS "paymentStatus",
                  (r.cost_amount IS NOT NULL AND r.cost_amount > 0) AS "paymentRequired",
                  er.registered_at AS "registeredAt"
             FROM event_registration er
             JOIN request r ON r.request_id = er.request_id
            WHERE er.status IN ('registered', 'rejected')
              AND r.registration_approval = 'Manual'
              AND (
                    r.applicant_user_id = %(user_id)s
                 OR EXISTS (
                      SELECT 1 FROM co_owners c
                 LEFT JOIN staff s ON s.staff_id = c.staff_id
                     WHERE c.request_id = r.request_id
                       AND (
                             s.user_id = %(user_id)s
                          OR lower(trim(c.staff_email)) = (SELECT lower(trim(email)) FROM users WHERE user_id = %(user_id)s)
                           )
                    )
                  )
         ORDER BY er.registered_at DESC""",
        {"user_id": principal.user_id},
    )
    for row in rows:
        row["status"] = _STATUS_TO_REGISTRATION_STATUS.get(row["status"], row["status"])
    return jsonify(rows)


@bp.get("/me/organized")
@require_auth
def my_organized_events():
    """Events I proposed (or co-own) that reached completed_approved and are
    published - my own organiser dashboard. Mirrors my_registrations()'s
    {items, total} envelope, but each item is just the event: there is no
    per-caller "status" here the way there is for a registration, since the
    caller organised it rather than registered for it. Ownership matches
    list_registrations()'s own gate (wf.is_proposal_owner: applicant or
    co-owner) so anyone who can see the attendee list also sees the event
    here.

    Ownership is OR'd into event_visibility (via _event_select's owner_clause),
    not AND'ed on afterwards: a 'Private' event has no discovery surface for
    anyone else (see _GUEST_VISIBLE/_INTERNAL_VISIBLE above), but its own
    creator/co-owner must still see it on their own organiser dashboard. AND'ing
    the ownership check onto the visibility filter would still require
    event_visibility IN (...) to hold too, which a Private event never
    satisfies - that was the bug."""
    principal = current_principal()
    owner_clause = """
        r.applicant_user_id = %(user_id)s
     OR EXISTS (
          SELECT 1 FROM co_owners c
     LEFT JOIN staff s ON s.staff_id = c.staff_id
         WHERE c.request_id = r.request_id
           AND (
                 s.user_id = %(user_id)s
              OR lower(trim(c.staff_email)) = (SELECT lower(trim(email)) FROM users WHERE user_id = %(user_id)s)
               )
        )
    """
    with transaction() as cur:
        rows = fetch_all(
            cur,
            f"""{_event_select(include_internal=not principal.is_external, owner_clause=owner_clause)}
             ORDER BY "firstDate" NULLS LAST, r.request_id DESC""",
            {"user_id": principal.user_id},
        )
        items = [_decorate(cur, row) for row in rows]
    return jsonify({"items": items, "total": len(items)})


# --- Saved events and reminders ------------------------------------------
@bp.get("/me/saved")
@require_auth
def list_saved():
    """My saved events, as full published-event records - mirrors my_registrations()'s
    {items, total} shape, since that's what SavedEventsResponse (the frontend model) expects."""
    principal = current_principal()
    with transaction() as cur:
        rows = fetch_all(
            cur,
            f"""{_event_select(include_internal=not principal.is_external).rstrip()}
                  AND EXISTS (
                        SELECT 1 FROM saved_event se
                         WHERE se.request_id = r.request_id AND se.user_id = %(user_id)s
                      )
             ORDER BY (SELECT saved_at FROM saved_event
                        WHERE request_id = r.request_id AND user_id = %(user_id)s) DESC""",
            {"user_id": principal.user_id},
        )
        items = [_decorate(cur, row) for row in rows]
    return jsonify({"items": items, "total": len(items)})


@bp.put("/me/saved/<int:event_id>")
@require_auth
def save_event(event_id: int):
    principal = current_principal()
    with transaction() as cur:
        _load_published(cur, event_id, include_internal=not principal.is_external)
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
