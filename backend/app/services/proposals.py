"""Proposal content: validation, persistence, and projection.

Splits cleanly from the workflow package. This module owns WHAT a proposal
says; workflow/ owns WHERE it is in the approval chain. The only overlap is
that saving content and changing stage happen in the same transaction when the
API does both.

Child rows are replace-on-write: every save clears this request's child tables
and rebuilds them from the payload. The alternative - diffing rows the client
sends against rows already stored - needs stable client-side ids the proposal
form does not have, and gets a repeated save subtly wrong.

Snapshot columns (`*_label`, `*_snapshot`, `category_name`, `menu_item_label`)
freeze catalogue text at save time on purpose. Renaming or retiring an option
later must not silently rewrite what a submitted proposal said.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from ..db import fetch_all, fetch_one
from ..errors import NotFound, ValidationError
from .workflow.constants import max_event_categories

# Cleared and rebuilt on every content save, children first.
CHILD_TABLES = (
    "request_categories",
    "application_requirements",
    "event_schedule",
    "co_owners",
    "organizers",
    "important_people",
    "general_guest",
    "brief_agenda",
    "request_discussion_topics",
    "request_logistics",
    "request_transportation",
    "request_photography_videography",
    "request_sound_light",
    "request_fmb",
    "request_campus_tour",
    "request_mineral_water",
    "request_funding_purchase",
)

EVENT_VISIBILITIES = ("Private", "Public", "Club Only")
REGISTRATION_MODES = ("Automatic", "Manual")


# --- Validation -----------------------------------------------------------
def _text(payload: dict, key: str) -> str:
    return str(payload.get(key) or "").strip()


def validate(cur, payload: dict, *, draft: bool) -> None:
    """Collect every problem before raising, so the form can show them all at once.

    A draft is held to a much lower bar - it is work in progress. Only a real
    submission has to be complete.
    """
    errors: list[str] = []

    if not _text(payload, "eventTitle"):
        errors.append("An event title is required.")

    if not draft:
        for key, label in (
            ("shortIntroduction", "short introduction"),
            ("goals", "goals and objectives"),
            ("benefits", "expected benefits"),
        ):
            if not _text(payload, key):
                errors.append(f"A {label} is required.")

        schedule = payload.get("scheduleRows") or []
        if not schedule:
            errors.append("Add at least one scheduled date, time and location.")
        for index, row in enumerate(schedule, start=1):
            if not (row.get("date") and row.get("start") and row.get("end") and row.get("location")):
                errors.append(f"Schedule row {index} needs a date, start time, end time and location.")
            elif str(row["end"]) <= str(row["start"]):
                errors.append(f"Schedule row {index} ends before it starts.")

        total_pax = payload.get("totalPax")
        if total_pax is None or _as_int(total_pax, default=-1) <= 0:
            errors.append("Total expected pax must be at least one.")

    visibility = _text(payload, "eventVisibility")
    if visibility and visibility not in EVENT_VISIBILITIES:
        errors.append("Event visibility must be one of: " + ", ".join(EVENT_VISIBILITIES) + ".")

    mode = _text(payload, "registrationMode")
    if mode and mode not in REGISTRATION_MODES:
        errors.append("Registration approval must be Automatic or Manual.")

    categories = payload.get("eventCategories") or []
    limit = max_event_categories(cur)
    if len(categories) > limit:
        errors.append(f"Choose at most {limit} event categor{'y' if limit == 1 else 'ies'}.")

    max_pax = payload.get("maxPax")
    if max_pax not in (None, "") and _as_int(max_pax, default=-1) < 0:
        errors.append("Registration capacity must be zero or more.")

    cost = payload.get("costAmount")
    if cost not in (None, "") and _as_decimal(cost) > 0:
        if not _text(payload, "bankAccountName") or not _text(payload, "bankAccountNumber"):
            errors.append(
                "A paid event needs both a bank account name and number so attendees can pay."
            )

    if errors:
        raise ValidationError(errors[0], details={"errors": errors})


def _as_int(value: Any, *, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(0)


def _nullable_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    return _as_decimal(value)


def _nullable_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return _as_int(value)


# --- Persistence ----------------------------------------------------------
def clear_children(cur, request_id: int) -> None:
    for table in CHILD_TABLES:
        cur.execute(f"DELETE FROM {table} WHERE request_id = %s", (request_id,))


def _resolve_format(cur, value: Any) -> tuple[int | None, str]:
    """Accept an id or a name. Older drafts stored the name; the picker now sends
    the id. Returns (id, frozen label)."""
    if value in (None, ""):
        return None, "On Campus"
    row = None
    if str(value).isdigit():
        row = fetch_one(
            cur, "SELECT event_format_id, name FROM event_format WHERE event_format_id = %s", (int(value),)
        )
    if row is None:
        row = fetch_one(cur, "SELECT event_format_id, name FROM event_format WHERE name = %s", (str(value),))
    if row is None:
        return None, str(value)
    return row["event_format_id"], row["name"]


def write_scalars(cur, request_id: int, payload: dict, applicant: dict) -> None:
    format_id, format_label = _resolve_format(cur, payload.get("eventFormat"))
    cur.execute(
        """
        UPDATE request SET
            applicant_name = %s, applicant_email = %s, applicant_department_or_school = %s,
            event_title = %s, short_introduction = %s, goals_objectives = %s,
            expected_benefits = %s, event_visibility = %s, event_format_id = %s,
            event_format_snapshot = %s, registration_approval = %s,
            promotion_publicity_method = %s, event_image = %s, total_pax = %s, max_pax = %s,
            cost_amount = %s, bank_account_name = %s, bank_account_number = %s,
            updated_at = now()
         WHERE request_id = %s
        """,
        (
            applicant["full_name"],
            applicant["email"],
            _text(payload, "applicantDepartment") or None,
            _text(payload, "eventTitle"),
            _text(payload, "shortIntroduction"),
            _text(payload, "goals"),
            _text(payload, "benefits"),
            _text(payload, "eventVisibility") or "Private",
            format_id,
            format_label,
            _text(payload, "registrationMode") or "Automatic",
            _text(payload, "publicity") or None,
            payload.get("eventImage") or None,
            _as_int(payload.get("totalPax")),
            _nullable_int(payload.get("maxPax")),
            _nullable_decimal(payload.get("costAmount")),
            _text(payload, "bankAccountName") or None,
            _text(payload, "bankAccountNumber") or None,
            request_id,
        ),
    )


def _rows(payload: dict, key: str) -> list[dict]:
    value = payload.get(key)
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def write_children(cur, request_id: int, payload: dict) -> None:
    # --- Categories: freeze the name alongside the id ---------------------
    for name in payload.get("eventCategories") or []:
        row = fetch_one(cur, "SELECT event_category_id, name FROM event_category WHERE name = %s", (name,))
        if row is None:
            continue
        cur.execute(
            "INSERT INTO request_categories (request_id, category_id, category_name) VALUES (%s, %s, %s)",
            (request_id, row["event_category_id"], row["name"]),
        )

    # --- Selected requirements: what routes into department review --------
    for requirement_name in payload.get("selectedRequirements") or []:
        row = fetch_one(
            cur,
            "SELECT requirement_id FROM event_requirements WHERE requirement_name = %s",
            (requirement_name,),
        )
        if row is None:
            continue
        cur.execute(
            "INSERT INTO application_requirements (request_id, requirement_id) VALUES (%s, %s)",
            (request_id, row["requirement_id"]),
        )

    for row in _rows(payload, "scheduleRows"):
        if not (row.get("date") and row.get("start") and row.get("end")):
            continue
        cur.execute(
            'INSERT INTO event_schedule (request_id, "date", start_time, end_time, location) '
            "VALUES (%s, %s, %s, %s, %s)",
            (request_id, row["date"], row["start"], row["end"], row.get("location") or ""),
        )

    for row in _rows(payload, "coOwners"):
        if not row.get("email"):
            continue
        cur.execute(
            """INSERT INTO co_owners
                   (request_id, staff_id, staff_first_name, staff_last_name, staff_email, staff_role)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                request_id,
                _nullable_int(row.get("staffId")),
                row.get("firstName") or "",
                row.get("lastName") or "",
                row["email"],
                row.get("role"),
            ),
        )

    for row in _rows(payload, "organizers"):
        if not row.get("email"):
            continue
        cur.execute(
            """INSERT INTO organizers
                   (request_id, staff_id, staff_first_name, staff_last_name, staff_email, staff_role, note)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                request_id,
                _nullable_int(row.get("staffId")),
                row.get("firstName") or "",
                row.get("lastName") or "",
                row["email"],
                row.get("role"),
                row.get("note"),
            ),
        )

    for row in _rows(payload, "importantPeople"):
        if not row.get("name"):
            continue
        cur.execute(
            """INSERT INTO important_people (request_id, name, type, organization, designation)
               VALUES (%s, %s, %s, %s, %s)""",
            (
                request_id,
                row["name"],
                row.get("type") or "Guest",
                row.get("organization"),
                row.get("designation"),
            ),
        )

    for row in _rows(payload, "guests"):
        if not row.get("guestType"):
            continue
        cur.execute(
            "INSERT INTO general_guest (request_id, guest_type, count, notes) VALUES (%s, %s, %s, %s)",
            (request_id, row["guestType"], _as_int(row.get("count")), row.get("notes")),
        )

    for row in _rows(payload, "agenda"):
        if not (row.get("time") and row.get("activity")):
            continue
        cur.execute(
            'INSERT INTO brief_agenda (request_id, "time", activity, location, pic, notes) '
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (
                request_id,
                row["time"],
                row["activity"],
                row.get("location") or "",
                row.get("pic") or "",
                row.get("notes"),
            ),
        )

    for topic in payload.get("discussions") or []:
        text = topic.get("topic") if isinstance(topic, dict) else topic
        if not text:
            continue
        cur.execute(
            "INSERT INTO request_discussion_topics (request_id, discussion_topic) VALUES (%s, %s)",
            (request_id, text),
        )

    _write_requirement_rows(cur, request_id, payload)


def _write_requirement_rows(cur, request_id: int, payload: dict) -> None:
    """The seven per-requirement detail tables."""
    for row in _rows(payload, "logistics"):
        if not row.get("item"):
            continue
        cur.execute(
            """INSERT INTO request_logistics
                   (request_id, option_id, item, quantity, "date", start_time, end_time, location, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["item"], _as_int(row.get("quantity")),
             row.get("date"), row.get("start"), row.get("end"), row.get("location") or "", row.get("notes")),
        )

    for row in _rows(payload, "transportation"):
        if not row.get("type"):
            continue
        cur.execute(
            """INSERT INTO request_transportation
                   (request_id, option_id, type, requested_pax, pickup, dropoff, "date", moving_time, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["type"], _as_int(row.get("pax")),
             row.get("pickup") or "", row.get("dropoff") or "", row.get("date"),
             row.get("movingTime"), row.get("notes")),
        )

    for row in _rows(payload, "photoVideo"):
        if not row.get("service"):
            continue
        cur.execute(
            """INSERT INTO request_photography_videography
                   (request_id, option_id, service, "date", start_time, end_time, location, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["service"], row.get("date"),
             row.get("start"), row.get("end"), row.get("location") or "", row.get("notes")),
        )

    for row in _rows(payload, "soundLight"):
        if not row.get("item"):
            continue
        cur.execute(
            """INSERT INTO request_sound_light
                   (request_id, option_id, item, "date", start_time, end_time, location, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["item"], row.get("date"),
             row.get("start"), row.get("end"), row.get("location") or "", row.get("notes")),
        )

    for row in _rows(payload, "fmb"):
        if not row.get("foodType"):
            continue
        cur.execute(
            """INSERT INTO request_fmb
                   (request_id, option_id, food_type, pax, "date", serve_time, location, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["foodType"], _as_int(row.get("pax")),
             row.get("date"), row.get("serveTime"), row.get("location") or "", row.get("notes")),
        )

    for row in _rows(payload, "campusTour"):
        if not row.get("startPoint"):
            continue
        cur.execute(
            """INSERT INTO request_campus_tour
                   (request_id, "date", pax, start_point_option_id, start_point,
                    tour_type_option_id, tour_type, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, row.get("date"), _as_int(row.get("pax")),
             _nullable_int(row.get("startPointOptionId")), row["startPoint"],
             _nullable_int(row.get("tourTypeOptionId")), row.get("tourType") or "", row.get("notes")),
        )

    for row in _rows(payload, "mineralWater"):
        if not row.get("optionLabel"):
            continue
        cur.execute(
            """INSERT INTO request_mineral_water
                   (request_id, option_id, option_label, quantity, with_logo, "date",
                    start_time, end_time, location, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("optionId")), row["optionLabel"],
             _as_int(row.get("quantity")), bool(row.get("withLogo")), row.get("date"),
             row.get("start"), row.get("end"), row.get("location") or "", row.get("notes")),
        )

    for row in _rows(payload, "fundingPurchase"):
        if not (row.get("mainItem") and row.get("subItem")):
            continue
        cur.execute(
            """INSERT INTO request_funding_purchase
                   (request_id, main_option_id, main_item, sub_option_id, sub_item,
                    quantity, unit_price_rm, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, _nullable_int(row.get("mainOptionId")), row["mainItem"],
             _nullable_int(row.get("subOptionId")), row["subItem"],
             _as_int(row.get("quantity")), _as_decimal(row.get("unitPrice")), row.get("notes")),
        )


def create(cur, applicant: dict, payload: dict, *, draft: bool) -> int:
    """Insert a request row in 'draft' and fill it from the payload. Returns its id.

    Callers submit it separately (workflow.submit) so "save a draft" and
    "submit for review" share one code path up to the point they diverge.
    """
    validate(cur, payload, draft=draft)
    cur.execute(
        """INSERT INTO request
               (request_code, applicant_user_id, applicant_name, applicant_email,
                event_title, short_introduction, goals_objectives, expected_benefits,
                event_visibility, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'draft')
           RETURNING request_id""",
        (
            # Placeholder; replaced below with a code derived from the real id so
            # it is stable, readable and never collides.
            "TMP",
            applicant["user_id"],
            applicant["full_name"],
            applicant["email"],
            _text(payload, "eventTitle") or "Untitled",
            _text(payload, "shortIntroduction"),
            _text(payload, "goals"),
            _text(payload, "benefits"),
            _text(payload, "eventVisibility") or "Private",
        ),
    )
    request_id = cur.fetchone()["request_id"]
    cur.execute(
        "UPDATE request SET request_code = %s WHERE request_id = %s",
        (f"EVT-{request_id:05d}", request_id),
    )
    write_scalars(cur, request_id, payload, applicant)
    write_children(cur, request_id, payload)
    return request_id


def save_content(cur, request_id: int, applicant: dict, payload: dict, *, draft: bool) -> None:
    """Replace a proposal's content. Never touches status, resume_stage or reviewer_comment."""
    validate(cur, payload, draft=draft)
    clear_children(cur, request_id)
    write_scalars(cur, request_id, payload, applicant)
    write_children(cur, request_id, payload)


def delete_draft(cur, request_id: int) -> None:
    clear_children(cur, request_id)
    cur.execute("DELETE FROM workflow_history WHERE request_id = %s", (request_id,))
    cur.execute("DELETE FROM request WHERE request_id = %s", (request_id,))


def load_applicant(cur, user_id: int) -> dict:
    row = fetch_one(
        cur, "SELECT user_id, full_name, email FROM users WHERE user_id = %s", (user_id,)
    )
    if row is None:
        raise NotFound("Applicant not found.")
    return row


# --- Projection -----------------------------------------------------------
def project(cur, request: dict, *, include_children: bool = True) -> dict[str, Any]:
    """One proposal, shaped for the client."""
    request_id = request["request_id"]
    categories = [
        r["category_name"]
        for r in fetch_all(
            cur, "SELECT category_name FROM request_categories WHERE request_id = %s", (request_id,)
        )
    ]
    schedule = fetch_all(
        cur,
        'SELECT "date", start_time, end_time, location FROM event_schedule '
        "WHERE request_id = %s ORDER BY event_schedule_id",
        (request_id,),
    )
    initials = "".join(part[0] for part in (request["applicant_name"] or "").split()[:2]).upper()

    projected: dict[str, Any] = {
        "id": request_id,
        "proposalId": request["request_code"],
        "eventTitle": request["event_title"],
        "applicant": request["applicant_name"],
        "applicantInitials": initials,
        "applicantEmail": request["applicant_email"],
        "applicantDepartment": request["applicant_department_or_school"],
        "shortIntroduction": request["short_introduction"],
        "goals": request["goals_objectives"],
        "benefits": request["expected_benefits"],
        "totalPax": request["total_pax"],
        "maxPax": request["max_pax"],
        "status": request["status"],
        "category": categories[0] if categories else "",
        "eventCategories": categories,
        "eventVisibility": request["event_visibility"],
        "eventFormat": request["event_format_snapshot"],
        "registrationMode": request["registration_approval"],
        "publicity": request["promotion_publicity_method"] or "",
        "eventImage": request["event_image"],
        "cost": float(request["cost_amount"]) if request["cost_amount"] is not None else None,
        "bankAccountName": request["bank_account_name"],
        "bankAccountNumber": request["bank_account_number"],
        "createdAt": request["created_at"],
        "updatedAt": request["updated_at"],
        "submittedAt": request["submitted_at"],
        "scheduleRows": [
            {
                "date": str(r["date"]),
                "start": str(r["start_time"]),
                "end": str(r["end_time"]),
                "location": r["location"],
            }
            for r in schedule
        ],
        "schedule": "; ".join(
            f"{r['date']} · {r['start_time']}-{r['end_time']} · {r['location']}" for r in schedule
        ),
        "workflow": {
            "stage": request["status"],
            "resumeStage": request["resume_stage"],
            "reviewerComment": request["reviewer_comment"],
        },
    }

    if include_children:
        projected["selectedRequirements"] = [
            r["requirement_name"]
            for r in fetch_all(
                cur,
                """SELECT er.requirement_name FROM application_requirements ar
                     JOIN event_requirements er ON er.requirement_id = ar.requirement_id
                    WHERE ar.request_id = %s""",
                (request_id,),
            )
        ]
        projected["coOwners"] = fetch_all(
            cur,
            """SELECT staff_id AS "staffId", staff_first_name AS "firstName",
                      staff_last_name AS "lastName", staff_email AS email, staff_role AS role
                 FROM co_owners WHERE request_id = %s ORDER BY co_owner_id""",
            (request_id,),
        )
        projected["organizers"] = fetch_all(
            cur,
            """SELECT staff_id AS "staffId", staff_first_name AS "firstName",
                      staff_last_name AS "lastName", staff_email AS email,
                      staff_role AS role, note
                 FROM organizers WHERE request_id = %s ORDER BY organizer_id""",
            (request_id,),
        )
        projected["importantPeople"] = fetch_all(
            cur,
            "SELECT name, type, organization, designation FROM important_people "
            "WHERE request_id = %s ORDER BY important_person_id",
            (request_id,),
        )
        projected["guests"] = fetch_all(
            cur,
            'SELECT guest_type AS "guestType", count, notes FROM general_guest '
            "WHERE request_id = %s ORDER BY general_guest_id",
            (request_id,),
        )
        projected["agenda"] = fetch_all(
            cur,
            'SELECT "time", activity, location, pic, notes FROM brief_agenda '
            "WHERE request_id = %s ORDER BY brief_agenda_id",
            (request_id,),
        )
        projected["discussions"] = [
            r["discussion_topic"]
            for r in fetch_all(
                cur,
                "SELECT discussion_topic FROM request_discussion_topics "
                "WHERE request_id = %s ORDER BY request_discussion_topic_id",
                (request_id,),
            )
        ]

    return projected
