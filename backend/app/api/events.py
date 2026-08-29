"""Published events: discovery, registration, saved events, reminders.

    GET  /events                       every published, not-yet-ended event, unfiltered (public)
    GET  /events/happening-soon        published events in the next 10 days, capped at 5 (public)
    GET  /events/calendar              published events in [start, end], ended included (public)
    GET  /events/search                published events, filtered/paginated (public, see search_events)
    GET  /events/schools               distinct schools/departments among published events (public)
    GET  /events/{id}                  one published event
    GET  /events/master-calendar       master calendar grid feed for one range (tier 1)
    GET  /events/master-calendar/day   one day's list rows (tier 2)
    GET  /events/master-calendar/{id}  one event's detail dialog payload (tier 3)
    GET  /events/{id}/registrations    organiser-only attendee list
    POST /events/{id}/registrations    register
    GET  /events/{id}/registrations/mine     my registration for this event
    GET  /events/me/registration-statuses    my registration status for many events at once
    DELETE /events/{id}/registrations/mine   cancel my registration
    POST /events/{id}/registrations/{rid}/decision   approve|reject (organiser)
    GET  /events/me/registrations      my registrations (?scope=active|history)
    GET  /events/me/registration-history  resolved registrations, mine and decided-by-me (History > Events)
    GET  /events/me/pending-approvals  registrations awaiting my decision
    GET  /events/me/organized          events I proposed that are now published, searched/filtered/paginated (Created by Me)
    GET/PUT /events/me/saved/{id}      save / unsave
    GET  /events/me/saved/search       my saved events, paginated (My Events > Saved)
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
from ._helpers import body, date_order, paged, pagination, required

bp = Blueprint("events", __name__, url_prefix="/events")

# One definition of "published", used by every query below so the list and the detail view can never
# disagree about what is visible.
_GUEST_VISIBLE = "('Public')"
_INTERNAL_VISIBLE = "('Public', 'Internal')"

# 'Club Only' is deliberately absent from BOTH tuples above.
_CLUB_MEMBER_VISIBLE = """(
        r.event_visibility = 'Club Only'
        AND EXISTS (
            SELECT 1
              FROM request_clubs rc
              JOIN club_members cm ON cm.club_id = rc.club_id
             WHERE rc.request_id = r.request_id
               AND cm.user_id = %(user_id)s
        )
    )"""


def _viewer_params(include_internal: bool, principal) -> dict:
    """The parameter(s) a query built with _event_select/_published_clause needs.

    _CLUB_MEMBER_VISIBLE references %(user_id)s, but only when include_internal is
    true - a guest query never contains the placeholder, and psycopg would reject an
    unused key in some paramstyles, so this returns {} in that case. Call sites merge
    it into their own parameter dict.
    """
    if not include_internal:
        return {}
    return {"user_id": principal.user_id}


def _published_clause(include_internal: bool, owner_clause: str | None = None) -> str:
    visible = _INTERNAL_VISIBLE if include_internal else _GUEST_VISIBLE
    # Club Only is only ever reachable by an authenticated caller, and include_internal is precisely
    # "authenticated and not external" - the same population that can hold a club membership (see
    # isEligibleForClub: students and lecturers).
    tiers = f"r.event_visibility IN {visible}"
    if include_internal:
        tiers = f"({tiers} OR {_CLUB_MEMBER_VISIBLE})"
    status_and_visibility = f"r.status = 'completed_approved' AND {tiers}"
    if not owner_clause:
        return status_and_visibility
    # my_organized_events() is the one caller that passes owner_clause: this is the caller's own
    # organiser dashboard, so ownership is REQUIRED, not merely one way in among others - otherwise
    # every other public/club/internal event in the system would show up on it too.
    return f"r.status = 'completed_approved' AND ({owner_clause})"


# Column list matches the frontend's PublishedEvent model field for field, so no client-side remapping
# is needed.
_NOT_ENDED = """NOT EXISTS (
        SELECT 1 FROM request r2
         WHERE r2.request_id = r.request_id
           AND (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r2.request_id) < current_date
    )"""


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


def _load_published(cur, event_id: int, include_internal: bool = False, principal=None) -> dict:
    # principal is required whenever include_internal is true: the Club Only branch
    # of the visibility clause binds the viewer's id (see _viewer_params).
    params = {**_viewer_params(include_internal, principal), "event_id": event_id}
    row = fetch_one(cur, _event_select(include_internal) + " AND r.request_id = %(event_id)s", params)
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


def _list_events_filters(args) -> tuple[str, dict]:
    """Builds the WHERE-clause fragments + params for every Explore Events filter,
    mirroring explore-events.ts's getMatchingEvents()/matches()/matchesDate() exactly
    so query params are a drop-in replacement for the old client-side filtering.

    Named parameters (%(f0)s, %(f1)s, ...) rather than positional: the visibility
    clause these filters are appended to now binds %(user_id)s by name, and psycopg
    cannot mix the two styles in one query. `_p()` mints a fresh key per value so
    the numbering stays correct however many filters are active.
    """
    clauses: list[str] = []
    params: dict = {}

    def _p(value) -> str:
        key = f"f{len(params)}"
        params[key] = value
        return f"%({key})s"

    search = (args.get("q") or "").strip()
    if search:
        like = _p(f"%{search}%")
        clauses.append(
            f"""(r.event_title ILIKE {like} OR r.applicant_department_or_school ILIKE {like}
                 OR r.event_format_snapshot ILIKE {like}
                 OR EXISTS (SELECT 1 FROM request_categories rc
                             WHERE rc.request_id = r.request_id AND rc.category_name ILIKE {like})
                 OR EXISTS (SELECT 1 FROM event_schedule es
                             WHERE es.request_id = r.request_id AND es.location ILIKE {like}))"""
        )

    visibility = args.getlist("visibility")
    if visibility:
        clauses.append(f"r.event_visibility = ANY({_p(visibility)})")

    category = args.getlist("category")
    if category:
        clauses.append(
            "EXISTS (SELECT 1 FROM request_categories rc "
            f"WHERE rc.request_id = r.request_id AND rc.category_name = ANY({_p(category)}))"
        )

    school = args.getlist("school")
    if school:
        clauses.append(f"r.applicant_department_or_school = ANY({_p(school)})")

    event_format = args.getlist("format")
    if event_format:
        clauses.append(f"r.event_format_snapshot = ANY({_p(event_format)})")

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
                    range_clause += f" AND {first_date} >= {_p(date_from)}::date"
                if date_to:
                    range_clause += f" AND {first_date} <= {_p(date_to)}::date"
                date_clauses.append(f"({range_clause})")
        if date_clauses:
            clauses.append("(" + " OR ".join(date_clauses) + ")")

    # Explore Events is discovery, not a records page - an event nobody can still attend has no
    # business showing up here, so this is unconditional rather than another opt-in filter.
    clauses.append(_NOT_ENDED)

    return (" AND " + " AND ".join(clauses) if clauses else ""), params


@bp.get("")
@limiter.limit("120 per minute")
def list_events():
    """Public. No token required - this is the discovery page.

    Unfiltered, unpaginated - every published, not-yet-ended event. Happening Soon and the
    events calendar have their own narrower/scoped endpoints below instead (GET
    /events/happening-soon, GET /events/calendar). Explore Events' filtered/paginated view is
    GET /events/search instead.
    """
    with transaction() as cur:
        rows = fetch_all(
            cur, _EVENT_SELECT + f' AND {_NOT_ENDED} ORDER BY "firstDate" NULLS LAST, r.request_id DESC'
        )
        return jsonify([_decorate(cur, row) for row in rows])


@bp.get("/happening-soon")
@limiter.limit("120 per minute")
def happening_soon():
    """Public. No token required - the landing page's Happening Soon carousel.

    Published events with a first schedule date in the next 10 days, capped at 5. Falls back to
    the soonest not-yet-ended events overall when that window is empty, so the carousel is never
    blank just because nothing happens to land in the next 10 days.
    """
    with transaction() as cur:
        rows = fetch_all(
            cur,
            _EVENT_SELECT + f"""
               AND {_NOT_ENDED}
               AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id)
                   BETWEEN current_date AND current_date + 10
            ORDER BY "firstDate" NULLS LAST, r.request_id DESC
            LIMIT 5""",
        )
        if not rows:
            rows = fetch_all(
                cur,
                _EVENT_SELECT + f' AND {_NOT_ENDED} ORDER BY "firstDate" NULLS LAST, r.request_id DESC LIMIT 5',
            )
        return jsonify([_decorate(cur, row) for row in rows])


@bp.get("/calendar")
@limiter.limit("120 per minute")
def calendar_events():
    """Public. No token required - the landing page's events calendar.

    Published events with at least one schedule date inside [start, end] (both required query
    params, 'YYYY-MM-DD'). Unlike every other discovery endpoint this deliberately does NOT
    exclude ended events - the calendar shows a full month/week including days already past, and
    the caller must still be able to see what happened on them. Registration itself is what stays
    blocked for an ended event (see register()), not visibility here.
    """
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    if not start or not end:
        raise BadRequest("start and end are required.")

    authenticate_optional()
    principal = getattr(g, "principal", None)
    include_internal = principal is not None and not principal.is_external

    with transaction() as cur:
        rows = fetch_all(
            cur,
            _event_select(include_internal) + """
               AND EXISTS (
                     SELECT 1 FROM event_schedule s
                      WHERE s.request_id = r.request_id
                        AND s."date" BETWEEN %(start)s::date AND %(end)s::date
                   )
            ORDER BY "firstDate" NULLS LAST, r.request_id DESC""",
            {**_viewer_params(include_internal, principal), "start": start, "end": end},
        )
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
    date (repeatable), dateFrom, dateTo, excludeRegistered, countOnly, page, pageSize.

    ?countOnly=1 skips the row fetch and _decorate() entirely (each row needs three extra
    sub-queries: schedule, categories, audience) and returns `items: []` with only `total`
    populated - for the filter dialog's live "N events match" preview (explore-events.ts's
    draftPreviewRequests), which only ever reads response.total and previously paid for a full
    decorated event (bank details, event image, ...) just to report a count.
    """
    authenticate_optional()
    principal = getattr(g, "principal", None)
    include_internal = principal is not None and not principal.is_external

    where, params = _list_events_filters(request.args)

    if request.args.get("excludeRegistered") and principal is not None:
        where += (
            """ AND NOT EXISTS (
                    SELECT 1 FROM event_registration er
                     WHERE er.request_id = r.request_id AND er.user_id = %(excl_user_id)s
                       AND er.status IN ('registered', 'pending_approval')
                )"""
        )
        params["excl_user_id"] = principal.user_id

    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(60, max(1, int(request.args.get("pageSize", 9))))
    except ValueError:
        page_size = 9
    offset = (page - 1) * page_size

    count_only = str(request.args.get("countOnly", "")).lower() in ("1", "true", "yes")

    event_select = _event_select(include_internal)
    # The visibility clause's parameter precedes every filter parameter, matching
    # its position at the head of the WHERE clause.
    params = {**_viewer_params(include_internal, principal), **params}
    with transaction() as cur:
        total = fetch_one(cur, f"SELECT count(*) AS n FROM ({event_select}{where}) AS matched", params)["n"]
        if count_only:
            items = []
        else:
            rows = fetch_all(
                cur,
                f'{event_select}{where} ORDER BY "firstDate" NULLS LAST, r.request_id DESC '
                f'LIMIT %(limit)s OFFSET %(offset)s',
                {**params, "limit": page_size, "offset": offset},
            )
            items = [_decorate(cur, row) for row in rows]

    return jsonify({"items": items, "total": total, "page": page, "pageSize": page_size})


@bp.get("/schools")
@limiter.limit("120 per minute")
def list_event_schools():
    """Explore Events' school-filter facet: every distinct school/department among
    published events the caller may see, computed here rather than the browser
    downloading every published event's full payload just to dedupe one column.

    Public, same visibility rule as search_events(): a valid bearer token from an
    internal (non-guest) user also surfaces schools that only appear on
    'Internal'-visibility events.
    """
    authenticate_optional()
    principal = getattr(g, "principal", None)
    include_internal = principal is not None and not principal.is_external
    rows = query(
        f"""SELECT DISTINCT r.applicant_department_or_school AS school
              FROM request r
             WHERE {_published_clause(include_internal)}
               AND r.applicant_department_or_school IS NOT NULL
               AND r.applicant_department_or_school <> ''
          ORDER BY 1""",
        _viewer_params(include_internal, principal),
    )
    return jsonify([row["school"] for row in rows])


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

        ended = fetch_one(
            cur,
            'SELECT max(s."date") < current_date AS ended FROM event_schedule s WHERE s.request_id = %s',
            (event_id,),
        )
        if ended and ended["ended"]:
            raise WorkflowError("This event has already ended.", code="event_ended")

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


_PENDING_APPROVALS_SELECT = """
    SELECT er.event_registration_id::text AS id, er.request_id::text AS "eventId",
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
"""


@bp.get("/me/pending-approvals")
@require_auth
def pending_approvals():
    """Registrations awaiting MY decision, across every event I organise.

    Searched/filtered/paginated in SQL, same convention as clubs.py's
    join_requests_inbox() - ?q= searches name/email/reason/event, ?event=
    narrows to one event title (the Inbox's event dropdown), ?page/?pageSize
    cap what one response can hand back so an organiser with a very large
    inbox can't pull it all in one request by mistake.
    """
    principal = current_principal()
    where = ["er.status = 'pending_approval'", "r.applicant_user_id = %s"]
    params: list = [principal.user_id]

    event_filter = (request.args.get("event") or "").strip()
    if event_filter:
        where.append("r.event_title = %s")
        params.append(event_filter)

    search = (request.args.get("q") or "").strip()
    if search:
        where.append(
            "(er.registrant_name ILIKE %s OR er.registrant_email ILIKE %s "
            "OR er.reason_for_attending ILIKE %s OR r.event_title ILIKE %s OR r.request_code ILIKE %s)"
        )
        params.extend([f"%{search}%"] * 5)

    where_sql = " AND ".join(where)
    with transaction() as cur:
        total = fetch_one(
            cur,
            f"SELECT count(*) AS c FROM event_registration er JOIN request r ON r.request_id = er.request_id WHERE {where_sql}",
            params,
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"{_PENDING_APPROVALS_SELECT} WHERE {where_sql} "
            f"ORDER BY {date_order('er.registered_at', 'asc')}, er.event_registration_id ASC LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    return jsonify(paged(rows, total))


@bp.get("/me/pending-approvals/events")
@require_auth
def pending_approval_event_options():
    """Distinct event titles with at least one pending registration, for the
    Inbox's event filter dropdown. Its own small, unpaginated query rather
    than derived from a page of pending_approvals(): the dropdown must list
    every matching event regardless of which page the caller is viewing."""
    principal = current_principal()
    rows = query(
        """SELECT DISTINCT r.event_title AS "eventTitle"
             FROM event_registration er
             JOIN request r ON r.request_id = er.request_id
            WHERE er.status = 'pending_approval' AND r.applicant_user_id = %s
         ORDER BY r.event_title""",
        (principal.user_id,),
    )
    return jsonify([row["eventTitle"] for row in rows])


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


# Requester bucket: 'me' when the viewer is the person who registered (their own request, whether or
# not they also happened to decide it themself as organiser of their own event), 'other' when the
# viewer decided someone ELSE's request as organiser/co-owner.
_HISTORY_UNION_SQL = """
    WITH history AS (
        -- The viewer's OWN registrations that reached a final outcome: confirmed-and-ended, or
        -- rejected. Mirrors my_registrations()'s scope='history' branch (status <> 'pending',
        -- and a confirmed one only counts once its event's last date has passed) but selects
        -- only the columns this page actually renders instead of the full decorated event.
        SELECT 'me:' || r.request_id::text AS key,
               'me' AS requester,
               r.event_title AS "eventTitle",
               r.request_code AS "eventCode",
               CASE er.status WHEN 'registered' THEN 'confirmed' ELSE 'rejected' END AS outcome,
               coalesce(
                   (SELECT min(s."date")::timestamp FROM event_schedule s WHERE s.request_id = r.request_id),
                   er.registered_at
               ) AS "registeredAt",
               NULL::text AS "registrantName",
               NULL::text AS "registrantEmail",
               NULL::text AS reason,
               NULL::text AS "decidedByName",
               NULL::text AS "decidedByRole",
               NULL::boolean AS "decidedByIsViewer"
          FROM event_registration er
          JOIN request r ON r.request_id = er.request_id
         WHERE er.user_id = %(user_id)s
           AND er.status IN ('registered', 'rejected')
           AND (
                 er.status = 'rejected'
              OR (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) < current_date
               )

        UNION ALL

        -- Registrations to the viewer's OWN events (owner or co-owner) that the viewer or a
        -- fellow co-owner has already decided. Skips a row that IS the viewer's own registration
        -- to their own event - that is the exact same real-world request as its `history` branch
        -- counterpart above, previously de-duplicated client-side by email+event-id match.
        SELECT 'decided:' || er.event_registration_id::text AS key,
               'other' AS requester,
               r.event_title AS "eventTitle",
               r.request_code AS "eventCode",
               CASE er.status WHEN 'registered' THEN 'confirmed' ELSE 'rejected' END AS outcome,
               er.registered_at AS "registeredAt",
               er.registrant_name AS "registrantName",
               er.registrant_email AS "registrantEmail",
               coalesce(er.reason_for_attending, '') AS reason,
               decider.full_name AS "decidedByName",
               CASE WHEN er.decided_by_user_id = r.applicant_user_id THEN 'Owner' ELSE 'Co-owner' END
                   AS "decidedByRole",
               (er.decided_by_user_id = %(user_id)s) AS "decidedByIsViewer"
          FROM event_registration er
          JOIN request r ON r.request_id = er.request_id
          LEFT JOIN users decider ON decider.user_id = er.decided_by_user_id
         WHERE er.status IN ('registered', 'rejected')
           AND r.registration_approval = 'Manual'
           AND lower(trim(er.registrant_email)) <> (SELECT lower(trim(email)) FROM users WHERE user_id = %(user_id)s)
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
    )
    SELECT * FROM history
"""


@bp.get("/me/registration-history")
@require_auth
def registration_history():
    """History > Events: every resolved registration decision, server-side
    searched/filtered/paginated - the merged, re-bucketed replacement for
    separately fetching me/registrations?scope=history (up to 200 rows) and
    the entirely unpaginated me/decided-registrations and combining/filtering
    them client-side (hub-history-events.ts). That endpoint had no limit at
    all; this one is capped like every other list endpoint.

    ?q filters by event title. ?requester=me|other matches the bucket
    documented on _HISTORY_UNION_SQL above. ?decidedBy=me|co-owner further
    narrows 'other' rows by who actually made the decision - meaningless for
    'me' rows (nobody decided FOR the viewer via this axis), so it implicitly
    excludes them, matching hub-history-events.ts's own filter predicate.
    """
    principal = current_principal()
    params: dict = {"user_id": principal.user_id}
    where = ["1 = 1"]

    search = (request.args.get("q") or "").strip()
    if search:
        where.append('"eventTitle" ILIKE %(q)s')
        params["q"] = f"%{search}%"

    requester_filter = (request.args.get("requester") or "").strip()
    if requester_filter in ("me", "other"):
        where.append("requester = %(requester)s")
        params["requester"] = requester_filter

    decided_by_filter = (request.args.get("decidedBy") or "").strip()
    if decided_by_filter in ("me", "co-owner"):
        where.append('requester = \'other\' AND "decidedByIsViewer" = %(decided_by_is_viewer)s')
        params["decided_by_is_viewer"] = decided_by_filter == "me"

    where_sql = " AND ".join(where)
    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS c FROM ({_HISTORY_UNION_SQL}) u WHERE {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"""SELECT * FROM ({_HISTORY_UNION_SQL}) u WHERE {where_sql}
                ORDER BY {date_order('"registeredAt"')}
                LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": limit, "offset": offset},
        )
    return jsonify(paged(rows, total))


@bp.get("/me/organized")
@require_auth
def my_organized_events():
    """Events I proposed (or co-own) that reached completed_approved and are
    published - my own organiser dashboard (Created by Me), server-side
    searched/filtered/paginated - the same predicate created-by-me.ts used to
    apply in the browser over the ENTIRE unbounded result (this endpoint had
    no limit at all) now runs in SQL instead, so it cannot hand back every
    organised event in one response.

    Mirrors my_registrations()'s {items, page, pageSize, total, totalPages}
    envelope, but each item is just the event: there is no per-caller
    "status" here the way there is for a registration, since the caller
    organised it rather than registered for it. Ownership matches
    list_registrations()'s own gate (wf.is_proposal_owner: applicant or
    co-owner) so anyone who can see the attendee list also sees the event
    here.

    Ownership (via _event_select's owner_clause) REPLACES the visibility filter
    here rather than being OR'd alongside it: this is the caller's own organiser
    dashboard, so every row must be something they created or co-own, full stop.
    OR'ing ownership in next to "event_visibility IN (...)" (as an earlier version
    of this endpoint did) let every Public/Club Only/Internal event in the system
    through regardless of who owned it, since that visibility check alone is
    already true for most published events. Ownership still bypasses the
    visibility check itself (rather than being AND'ed with it) so a 'Private'
    event - which has no discovery surface for anyone else (see
    _GUEST_VISIBLE/_INTERNAL_VISIBLE above) - still reaches its own creator/co-owner.

    ?q searches the event title. ?status=upcoming|ended splits on the event's
    LAST scheduled date vs today, the same "ended" rule my_registrations()'s
    scope=history branch already uses (an event with several sessions has not
    ended until its final one has passed).
    """
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
    event_select = _event_select(include_internal=not principal.is_external, owner_clause=owner_clause)
    where = ["1 = 1"]
    params: dict = {"user_id": principal.user_id}

    search = (request.args.get("q") or "").strip()
    if search:
        where.append('"eventTitle" ILIKE %(q)s')
        params["q"] = f"%{search}%"

    status = (request.args.get("status") or "").strip().lower()
    if status in ("upcoming", "ended"):
        ended_clause = (
            '(SELECT max(s."date") FROM event_schedule s WHERE s.request_id = id::bigint) < current_date'
        )
        where.append(ended_clause if status == "ended" else f"NOT ({ended_clause})")

    where_sql = " AND ".join(where)

    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(60, max(1, int(request.args.get("pageSize", 9))))
    except ValueError:
        page_size = 9
    offset = (page - 1) * page_size

    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS n FROM ({event_select}) AS matched WHERE {where_sql}", params
        )["n"]
        rows = fetch_all(
            cur,
            f"""SELECT * FROM ({event_select}) AS matched WHERE {where_sql}
             ORDER BY "firstDate" NULLS LAST, id::bigint DESC LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": page_size, "offset": offset},
        )
        items = [_decorate(cur, row) for row in rows]

    return jsonify({
        "items": items, "page": page, "pageSize": page_size, "total": total,
        "totalPages": max(1, -(-total // page_size)),
    })


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


@bp.get("/me/saved/search")
@require_auth
def search_saved():
    """Paginated counterpart to list_saved() above, for the /my-events/saved list view -
    page/pageSize LIMIT/OFFSET and the total count happen in SQL, matching
    my_registrations()'s own {items, page, pageSize, total, totalPages} shape
    (SavedEventsResponse) rather than list_saved()'s unpaginated {items, total}, which still
    backs the app-wide "is this saved" heart-icon state and needs the complete id set.
    """
    principal = current_principal()
    event_select = _event_select(include_internal=not principal.is_external)
    where = """ AND EXISTS (
                      SELECT 1 FROM saved_event se
                       WHERE se.request_id = r.request_id AND se.user_id = %(user_id)s
                    )"""
    params = {"user_id": principal.user_id}

    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(60, max(1, int(request.args.get("pageSize", 9))))
    except ValueError:
        page_size = 9
    offset = (page - 1) * page_size

    with transaction() as cur:
        total = fetch_one(cur, f"SELECT count(*) AS n FROM ({event_select}{where}) AS matched", params)["n"]
        rows = fetch_all(
            cur,
            f"""{event_select}{where}
             ORDER BY (SELECT saved_at FROM saved_event
                        WHERE request_id = r.request_id AND user_id = %(user_id)s) DESC
                LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": page_size, "offset": offset},
        )
        items = [_decorate(cur, row) for row in rows]

    return jsonify({
        "items": items, "page": page, "pageSize": page_size, "total": total,
        "totalPages": max(1, -(-total // page_size)),
    })


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


# ============================================================================
# Master event calendar The university-wide calendar (/app/event-calendar).
_MASTER_CALENDAR_STATUSES = ("department_review", "completed_approved")

# Roles that see everything regardless of the event's visibility tier.
_FULL_VISIBILITY_ROLES = ("cfo",)

# How the four tiers resolve for an ordinary (non-CFO/F&B) viewer of the master calendar.
_MASTER_OPEN_TIERS = ("Public", "Internal")


def _sees_all_events(principal) -> bool:
    """CFO and the F&B head bypass visibility tiering entirely (requirement 4)."""
    if principal is None:
        return False
    if principal.has_role(*_FULL_VISIBILITY_ROLES):
        return True
    # F&B is identified the same way the workflow identifies it - heading the
    # food_beverage_services unit - rather than by a bare role name, so it stays
    # consistent with stage_after_hos_hod()/authorize_stage_action().
    return principal.heads_unit(wf.constants.FMB_UNIT_CODE)


# ---------------------------------------------------------------------------
# The master calendar is served in THREE tiers, deliberately.

# Appended to the range query for everyone except CFO/F&B. A Private event is
# excluded in SQL rather than filtered out afterwards, so nothing about it ever
# leaves the database for a viewer who is not entitled to it.
_EXCLUDE_PRIVATE_SQL = """         AND r.event_visibility <> 'Private'
"""


def _membership_expr(sees_all: bool) -> str:
    """SQL predicate for "the viewer belongs to this event's club(s)".

    Evaluated per row so a Club Only event the viewer is in can be told from one
    they are not without a second round trip. A full-visibility viewer
    short-circuits to a literal, which lets Postgres drop the subquery entirely
    rather than run it once per row for someone who bypasses the tier anyway.
    """
    if sees_all:
        return "true"
    return """EXISTS (
                        SELECT 1 FROM request_clubs rc
                          JOIN club_members cm ON cm.club_id = rc.club_id
                         WHERE rc.request_id = r.request_id AND cm.user_id = %(user_id)s
                    )"""


def _occurrence_rows(cur, start: str, end: str, principal, search: str = "") -> list[dict]:
    """Every session in [start, end] the viewer may be shown, in one statement.

    One row per (event, session) rather than per event: the grid draws a
    multi-day event once on each of its dates, so that expansion belongs in SQL
    beside the date filter rather than in the client after the payload has
    already crossed the wire.

    Every filter is server-side - the date window, the status gate, the Private
    exclusion and the free-text search are all predicates here. Narrowing the
    calendar therefore transfers a narrowed result set instead of a whole month
    that the client then hides most of.

    Only ONE category is resolved (the event's first, by category_id) because
    that is all any calendar surface uses: the chip colour and the legend. The
    full category list is tier 3's business.
    """
    sees_all = _sees_all_events(principal)
    params = {
        "statuses": list(_MASTER_CALENDAR_STATUSES),
        "start": start,
        "end": end,
        "provisional_status": wf.constants.DEPARTMENT_REVIEW,
        "q": search,
        "like": f"%{search}%",
    }
    if not sees_all:
        params["user_id"] = principal.user_id

    sql = (
        """
    SELECT occ.* FROM (
      SELECT s.event_schedule_id::text AS "occurrenceId",
             r.request_id::text AS "eventId",
             s."date"::text AS "date",
             to_char(s.start_time, 'HH24:MI') AS "start",
             to_char(s.end_time, 'HH24:MI') AS "end",
             r.event_title AS title,
             r.applicant_name AS organiser,
             s.location AS venue,
             r.event_visibility AS visibility,
             (r.status = %(provisional_status)s) AS provisional,
             coalesce(cat.category_name, '') AS category,
             """
        + _membership_expr(sees_all)
        + """ AS "isClubMember"
        FROM request r
        JOIN event_schedule s ON s.request_id = r.request_id
        LEFT JOIN LATERAL (
               SELECT rc.category_name FROM request_categories rc
                WHERE rc.request_id = r.request_id
                ORDER BY rc.category_id LIMIT 1
             ) cat ON true
       WHERE r.status = ANY(%(statuses)s)
         AND s."date" BETWEEN %(start)s::date AND %(end)s::date
"""
        + ("" if sees_all else _EXCLUDE_PRIVATE_SQL)
        + """    ) occ
     WHERE %(q)s = ''
        OR (
             -- A redacted row has nothing to match on. It survives an empty
             -- search (the date really is occupied) but is dropped the moment
             -- the viewer narrows, rather than sitting among the hits as an
             -- unexplained placeholder.
             (occ."isClubMember" OR occ.visibility <> 'Club Only')
             AND (occ.title ILIKE %(like)s OR occ.organiser ILIKE %(like)s
                  OR occ.venue ILIKE %(like)s OR occ.category ILIKE %(like)s)
           )
     ORDER BY occ."date", occ."start", occ.title
    """
    )
    return fetch_all(cur, sql, params)


def _is_redacted(row: dict) -> bool:
    """Club Only and the viewer is not a member: the date is occupied, full stop.

    Public/Internal are open tiers, and a full-visibility viewer's isClubMember
    is a literal true, so both fall through to the visible shape.
    """
    return row["visibility"] not in _MASTER_OPEN_TIERS and not row["isClubMember"]


def _summary_occurrence(row: dict) -> dict:
    """Tier 1 shape: exactly what a grid cell paints, and nothing else.

    A redacted row carries neither a title nor an event id - only an
    occurrenceId, which is a schedule row id that no endpoint accepts, so it
    addresses nothing and identifies nobody. The client supplies the placeholder
    label itself; it is a constant and there is no reason to send it 40 times.
    """
    if _is_redacted(row):
        return {"occurrenceId": row["occurrenceId"], "date": row["date"], "restricted": True}
    return {
        "occurrenceId": row["occurrenceId"],
        "eventId": row["eventId"],
        "date": row["date"],
        "start": row["start"],
        "end": row["end"],
        "title": row["title"],
        "category": row["category"],
        "provisional": bool(row["provisional"]),
        "restricted": False,
    }


def _day_occurrence(row: dict) -> dict:
    """Tier 2 shape: tier 1 plus the two extra fields a day-list row shows."""
    occurrence = _summary_occurrence(row)
    if occurrence["restricted"]:
        return occurrence
    return {**occurrence, "venue": row["venue"], "organiser": row["organiser"]}


def _master_schedule_rows(cur, request_id: int) -> list[dict]:
    return [
        {
            "date": str(entry["date"]),
            "start": str(entry["start_time"])[:5],
            "end": str(entry["end_time"])[:5],
            "location": entry["location"],
        }
        for entry in fetch_all(
            cur,
            'SELECT "date", start_time, end_time, location FROM event_schedule '
            "WHERE request_id = %s ORDER BY event_schedule_id",
            (request_id,),
        )
    ]


def _private_counts(cur, start: str, end: str) -> dict[str, int]:
    """Per-date count of Private events, keyed 'YYYY-MM-DD'.

    Counted DISTINCT per (date, request) so a private event with two sessions on
    the same day counts once for that day, matching how a viewer would say "3
    private events are on today". No identifying column is selected at all, so
    there is nothing here that could leak even by accident.

    Deliberately NOT narrowed by the search term: a count that responded to `q`
    would be an oracle for the very titles it exists to withhold.
    """
    rows = fetch_all(
        cur,
        """SELECT s."date" AS on_date, count(DISTINCT r.request_id) AS total
             FROM request r
             JOIN event_schedule s ON s.request_id = r.request_id
            WHERE r.status = ANY(%(statuses)s)
              AND r.event_visibility = 'Private'
              AND s."date" BETWEEN %(start)s::date AND %(end)s::date
            GROUP BY s."date" """,
        {"statuses": list(_MASTER_CALENDAR_STATUSES), "start": start, "end": end},
    )
    return {str(row["on_date"]): int(row["total"]) for row in rows}


@bp.get("/master-calendar")
@require_auth
def master_calendar():
    """Tier 1 - the university-wide master calendar's grid feed for one range.

    ?start=YYYY-MM-DD&end=YYYY-MM-DD[&q=free text]

    Requires a token: this is an internal page (page-visibility gated), not a
    public discovery surface. Guests never reach it.

    Returns {"occurrences": [...], "privateCounts": {"YYYY-MM-DD": n}}, where an
    occurrence is one session of one event on one date carrying only what a cell
    draws. No description, image, expected pax, cost, registration count or club
    audience is sent here - the dialog owns those and asks for them when it
    opens (see master_calendar_event).

    A Club Only event the viewer is not in comes back as
    {occurrenceId, date, restricted: true}: the day still reads as occupied and
    nothing else, not even the event id, is disclosed. A Private event
    contributes ONLY to privateCounts and is excluded in SQL, so no title,
    organiser, venue or id is transmitted for it in any form.
    """
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    if not start or not end:
        raise BadRequest("start and end are required.")
    search = (request.args.get("q") or "").strip()

    principal = current_principal()
    sees_all = _sees_all_events(principal)

    with transaction() as cur:
        rows = _occurrence_rows(cur, start, end, principal, search)
        # CFO/F&B see private events as real rows (requirement 4), so surfacing a
        # count for them as well would double-count the same event on the grid.
        private_counts = {} if sees_all else _private_counts(cur, start, end)
        occurrences = [_summary_occurrence(row) for row in rows]
        return jsonify({"occurrences": occurrences, "privateCounts": private_counts})


@bp.get("/master-calendar/day")
@require_auth
def master_calendar_day():
    """Tier 2 - one day's list rows, fetched when the viewer opens that day.

    ?date=YYYY-MM-DD[&q=free text] -> {"occurrences": [...], "privateCount": n}

    The same rows tier 1 sent for that date plus venue and organiser, which a
    day-list row shows and a month chip does not. Kept off tier 1 so that
    opening one day does not mean having carried 42 days of venues to get there.
    """
    date_key = (request.args.get("date") or "").strip()
    if not date_key:
        raise BadRequest("date is required.")
    search = (request.args.get("q") or "").strip()

    principal = current_principal()
    sees_all = _sees_all_events(principal)

    with transaction() as cur:
        rows = _occurrence_rows(cur, date_key, date_key, principal, search)
        private_count = 0 if sees_all else _private_counts(cur, date_key, date_key).get(date_key, 0)
        occurrences = [_day_occurrence(row) for row in rows]
        return jsonify({"occurrences": occurrences, "privateCount": private_count})


@bp.get("/master-calendar/<int:event_id>")
@require_auth
def master_calendar_event(event_id: int):
    """Tier 3 - one event's full detail, fetched when its dialog opens.

    The same population and the same visibility rules as tier 1, so an event
    still at department_review resolves here - GET /events/{id} would not, since
    that endpoint serves published events under discovery's rules instead.

    An event the viewer may not see answers 404 rather than 403, so the status
    code does not confirm that it exists. The three child queries below are per
    event and bounded; they are exactly what tier 1 refuses to run per row.
    """
    principal = current_principal()
    sees_all = _sees_all_events(principal)

    params = {"statuses": list(_MASTER_CALENDAR_STATUSES), "event_id": event_id}
    if not sees_all:
        params["user_id"] = principal.user_id

    sql = (
        """
    SELECT r.request_id::text AS id,
           r.event_title AS "eventTitle",
           r.short_introduction AS "shortIntroduction",
           r.event_visibility AS "eventVisibility",
           r.event_format_snapshot AS "eventFormat",
           r.applicant_department_or_school AS "schoolDepartment",
           r.applicant_name AS organiser,
           r.status AS "proposalStatus",
           r.total_pax AS "totalExpectedPax",
           r.max_pax AS "maxPax",
           r.registration_approval AS "registrationMode",
           r.cost_amount AS cost,
           (SELECT count(*) FROM event_registration er
             WHERE er.request_id = r.request_id AND er.status = 'registered')
             AS "confirmedRegistrationCount",
           r.event_visibility AS visibility,
           """
        + _membership_expr(sees_all)
        + """ AS "isClubMember"
      FROM request r
     WHERE r.request_id = %(event_id)s AND r.status = ANY(%(statuses)s)
    """
    )

    with transaction() as cur:
        row = fetch_one(cur, sql, params)
        if row is None or _is_redacted(row):
            raise NotFound("That event is not on your calendar.")
        row.pop("isClubMember", None)
        row.pop("visibility", None)
        row["schedule"] = _master_schedule_rows(cur, event_id)
        row["categories"] = [
            entry["category_name"]
            for entry in fetch_all(
                cur,
                "SELECT category_name FROM request_categories WHERE request_id = %s ORDER BY category_id",
                (event_id,),
            )
        ]
        # The frozen display snapshot (migration 029) - shown as the event's
        # audience on a Club Only event the viewer is entitled to see.
        row["clubs"] = [
            entry["club_name"]
            for entry in fetch_all(
                cur, "SELECT club_name FROM request_clubs WHERE request_id = %s", (event_id,)
            )
        ]
        cost = row.get("cost")
        row["cost"] = float(cost) if cost is not None else None
        row["isFree"] = not row["cost"]
        row["confirmedRegistrationCount"] = int(row["confirmedRegistrationCount"] or 0)
        return jsonify(row)


@bp.get("/date-counts")
@require_auth
def event_date_counts():
    """Lightweight per-date event counts for the proposal form's conflict warning.

    ?dates=YYYY-MM-DD&dates=... (repeatable) -> {"YYYY-MM-DD": n}. Returns counts
    ONLY - no event data of any kind - which is what lets it count every event on
    the master calendar regardless of the caller's visibility tier without
    disclosing anything. A date the caller asks about that has no events comes
    back as 0 rather than omitted, so the client needs no fallback.

    Counts the same population the master calendar shows (department_review and
    completed_approved, cancellations excluded), so the number the organiser is
    warned about matches what they would actually see on that date.
    """
    dates = [value.strip() for value in request.args.getlist("dates") if value.strip()]
    if not dates:
        raise BadRequest("dates is required.")
    if len(dates) > 31:
        raise BadRequest("At most 31 dates may be counted at once.")

    with transaction() as cur:
        rows = fetch_all(
            cur,
            """SELECT s."date" AS on_date, count(DISTINCT r.request_id) AS total
                 FROM request r
                 JOIN event_schedule s ON s.request_id = r.request_id
                WHERE r.status = ANY(%(statuses)s)
                  AND s."date" = ANY(%(dates)s::date[])
                GROUP BY s."date" """,
            {"statuses": list(_MASTER_CALENDAR_STATUSES), "dates": dates},
        )
        counts = {str(row["on_date"]): int(row["total"]) for row in rows}
        return jsonify({date: counts.get(date, 0) for date in dates})
