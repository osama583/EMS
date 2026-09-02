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

import datetime as dt
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from ..db import fetch_all, fetch_one
from ..errors import NotFound, ValidationError
from .workflow.constants import (
    TABLE_FOR_REQUIREMENT,
    max_event_categories,
    min_event_lead_days,
    stage_for_client,
)
# Straight from the module rather than the workflow package, and safe from a cycle:
# nothing under services/workflow imports this module back.
from .workflow.tasks import unallocated_row_count

# Cleared and rebuilt on every content save, children first.
CHILD_TABLES = (
    "request_categories",
    "request_clubs",
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

EVENT_VISIBILITIES = ("Private", "Public", "Club Only", "Internal")
REGISTRATION_MODES = ("Automatic", "Manual")

# Where each requirement-row select field's value ("{kind}:{n}", see app.api.options.option_id)
# resolves to: its catalogue table, primary key column, and label column.
_OPTION_CATALOGUES: dict[str, tuple[str, str]] = {
    "logistics": ("logistics_options", "logistics_option_id"),
    "transportation": ("transportation_options", "transportation_option_id"),
    "photoVideo": ("media_options", "media_option_id"),
    "soundLight": ("sound_light_options", "sound_light_option_id"),
    "fmb": ("fmb_options", "fmb_option_id"),
    "campusTourStart": ("campus_tour_start_options", "campus_tour_start_option_id"),
    "campusTourType": ("campus_tour_type_options", "campus_tour_type_option_id"),
    "fundingMain": ("funding_main_options", "funding_main_option_id"),
    "fundingSub": ("funding_sub_options", "funding_sub_option_id"),
    "venue": ("venue_options", "venue_option_id"),
}

# The two location shapes a row can carry. 'outside' is only ever legal on the
# event schedule - the four delivery requests are venue-only by requirement.
INSIDE, OUTSIDE = "inside", "outside"

# Requirements whose location must be a catalogue venue, never free text, with the label the applicant
# sees for each.
VENUE_ONLY_REQUIREMENTS = {
    "logistics": "Logistics",
    "soundLight": "Sound & Light",
    "fmb": "Food",
    "waterNormal": "Mineral Water",
    "photoVideo": "Photography / Videography",
}


def _venue_ref(venue_option_id: int | None) -> str:
    """The "venue:{n}" composite id the client selects by (app.api.options.option_id).
    Empty string for a row whose venue was never resolved, which is what an
    unselected dropdown sends back."""
    return f"venue:{venue_option_id}" if venue_option_id else ""


def _resolve_location(cur, row: dict, *, allow_outside: bool = False) -> tuple[int | None, str, str]:
    """Resolve a row's location to (venue_option_id, frozen label, kind).

    The label is frozen onto the row exactly like every other catalogue pick in
    this file: venue_option_id is the live link a dropdown re-selects from, and
    `location` is what the record displays for the rest of its life. That is
    what lets the CFO archive or rename a venue without rewriting the history
    of every proposal that used it.

    An unresolvable venueId degrades to the typed text rather than failing, the
    same way _resolve_option treats a deleted option - a venue archived between
    opening the form and saving must not cost the applicant their draft.
    """
    if allow_outside and str(row.get("locationKind") or "").strip().lower() == OUTSIDE:
        return None, str(row.get("location") or "").strip(), OUTSIDE
    venue_id, label, _ = _resolve_option(cur, row.get("venueId"), "venue")
    if venue_id is None:
        # No usable venue reference: keep whatever text the row already carried
        # so nothing is silently blanked, and report it as the kind it is.
        text = str(row.get("location") or "").strip()
        return None, text, (INSIDE if not allow_outside else (INSIDE if text else OUTSIDE))
    return venue_id, label, INSIDE


def _resolve_option(cur, value: Any, kind: str) -> tuple[int | None, str, dict[str, Any]]:
    """Resolve a "{kind}:{n}" select value to (option_id, frozen label, row).

    Falls back to (None, str(value), {}) for anything that doesn't parse or
    doesn't exist, the same way _resolve_format treats an unresolvable value as
    a freeform label rather than a hard failure - a catalogue entry archived or
    deleted after the applicant picked it should not block saving the draft.
    """
    table, pk = _OPTION_CATALOGUES[kind]
    raw = str(value or "")
    _, _, number = raw.partition(":")
    if not number.isdigit():
        return None, raw, {}
    row = fetch_one(cur, f"SELECT * FROM {table} WHERE {pk} = %s", (int(number),))
    if row is None:
        return None, raw, {}
    return row[pk], row["label"], row


# --- Validation -----------------------------------------------------------
def _text(payload: dict, key: str) -> str:
    return str(payload.get(key) or "").strip()


def _club_id_list(payload: dict) -> list[int]:
    """The selected club ids, de-duplicated, order preserved.

    Tolerant of what the wire actually carries: the picker sends strings, older
    drafts may send numbers, and a half-filled row can send an empty value.
    Anything non-numeric is dropped here rather than blowing up on int().
    """
    seen: set[int] = set()
    out: list[int] = []
    for value in payload.get("eventClubs") or []:
        text = str(value).strip()
        if not text.isdigit():
            continue
        club_id = int(text)
        if club_id not in seen:
            seen.add(club_id)
            out.append(club_id)
    return out


def _unpresided_clubs(cur, applicant_user_id: int | None, club_ids: list[int]) -> list[str]:
    """Names of the requested clubs this user does NOT preside over.

    Presidency is clubs.user_id (see SECTION 4 of the initial schema) - the same
    fact that feeds AuthUser.presidentOfClubIds. Resolved server-side because the
    dropdown is a convenience, not a permission: a crafted payload naming another
    club's id must be refused here.

    An id that matches no live club comes back as "#<id>" rather than being
    ignored, so a stale or bogus selection surfaces as an error instead of
    silently narrowing the audience.
    """
    if not club_ids:
        return []
    rows = fetch_all(
        cur,
        "SELECT club_id, club_name, user_id FROM clubs WHERE club_id = ANY(%s) AND active",
        (club_ids,),
    )
    by_id = {row["club_id"]: row for row in rows}
    bad: list[str] = []
    for club_id in club_ids:
        row = by_id.get(club_id)
        if row is None:
            bad.append(f"#{club_id}")
        elif applicant_user_id is None or row["user_id"] != applicant_user_id:
            bad.append(row["club_name"])
    return bad


def validate(cur, payload: dict, *, draft: bool, applicant: dict | None = None) -> None:
    """Collect every problem before raising, so the form can show them all at once.

    A draft is held to a much lower bar - it is work in progress. Only a real
    submission has to be complete.
    """
    errors: list[str] = []

    if not draft:
        if not _text(payload, "eventTitle"):
            errors.append("An event title is required.")
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
            outside = str(row.get("locationKind") or "").strip().lower() == OUTSIDE
            # Inside University means a venue from the catalogue; Outside means a typed address.
            located = bool(str(row.get("location") or "").strip()) if outside else bool(row.get("venueId"))
            if not (row.get("date") and row.get("start") and row.get("end") and located):
                what = "an external location" if outside else "a venue"
                errors.append(f"Schedule row {index} needs a date, start time, end time and {what}.")
            elif str(row["end"]) <= str(row["start"]):
                errors.append(f"Schedule row {index} ends before it starts.")

        # MIN_EVENT_LEAD_DAYS. The picker disables these dates client-side; this
        # is the same rule where it cannot be bypassed. Checked against the
        # earliest row only - that is the day the notice is measured from.
        lead_days = min_event_lead_days(cur)
        earliest_allowed = dt.date.today() + dt.timedelta(days=max(0, lead_days))
        for index, row in enumerate(schedule, start=1):
            event_day = _as_date(row.get("date"))
            if event_day is None or event_day >= earliest_allowed:
                continue
            if lead_days > 0:
                errors.append(
                    f"Schedule row {index} starts sooner than the {lead_days}-day minimum notice. "
                    f"The earliest available date is {earliest_allowed:%d %b %Y}."
                )
            else:
                errors.append(f"Schedule row {index} cannot be in the past.")

        # The four university-delivered requests are venue-only by requirement (migration 032): there
        # is nowhere to deliver a stage or a tray of food but a university venue, and free text there
        # is what used to send Logistics to a place they could not find.
        request_rows = payload.get("requestRows")
        request_rows = request_rows if isinstance(request_rows, dict) else {}
        for requirement, label in VENUE_ONLY_REQUIREMENTS.items():
            for index, row in enumerate(_rows(request_rows, requirement), start=1):
                if not row.get("venueId"):
                    errors.append(f"{label} row {index} needs a university venue.")

        total_pax = payload.get("totalPax")
        if total_pax is None or _as_int(total_pax, default=-1) <= 0:
            errors.append("Total expected pax must be at least one.")

    visibility = _text(payload, "eventVisibility")
    if visibility and visibility not in EVENT_VISIBILITIES:
        errors.append("Event visibility must be one of: " + ", ".join(EVENT_VISIBILITIES) + ".")

    mode = _text(payload, "registrationMode")
    if mode and mode not in REGISTRATION_MODES:
        errors.append("Registration approval must be Automatic or Manual.")

    # --- Club Only audience -----------------------------------------------
    # "Club Only" used to be a bare string with no club behind it, which made it unenforceable: a
    # president of two clubs produced a row that named neither, so both clubs' members saw the event
    # (and, since no server-side check existed at all, so did everyone else).
    applicant_user_id = (applicant or {}).get("user_id")
    club_ids = _club_id_list(payload)
    if visibility == "Club Only":
        if not draft and not club_ids:
            errors.append("A Club Only event must be addressed to at least one club.")
        unauthorised = _unpresided_clubs(cur, applicant_user_id, club_ids)
        if unauthorised:
            errors.append(
                "You can only address an event to a club you are the President of: "
                + ", ".join(unauthorised)
                + "."
            )
    elif club_ids:
        # Selecting clubs then switching visibility away leaves stale ids in the
        # payload; they are meaningless outside Club Only, so reject rather than
        # silently storing an audience that nothing will ever read.
        errors.append("Clubs can only be selected when Event Visibility is Club Only.")

    categories = payload.get("eventCategories") or []
    limit = max_event_categories(cur)
    if len(categories) > limit:
        errors.append(f"Choose at most {limit} event categor{'y' if limit == 1 else 'ies'}.")

    max_pax = payload.get("maxPax")
    if max_pax not in (None, ""):
        if _as_int(max_pax, default=-1) <= 0:
            errors.append("Max Registered Pax must be greater than zero.")
        elif visibility == "Internal":
            errors.append("Max Registered Pax is not available for Internal events.")

    cost = payload.get("costAmount")
    if cost not in (None, "") and _as_decimal(cost) > 0:
        if not _text(payload, "bankAccountName") or not _text(payload, "bankAccountNumber"):
            errors.append(
                "A paid event needs both a bank account name and number so attendees can pay."
            )

    if not draft:
        # Mineral water is typed in rather than picked (migration 028), so the count is now free text
        # from a number input and has to be checked here.
        water_rows = (payload.get("requestRows") or {}).get("waterNormal")
        for index, row in enumerate(water_rows if isinstance(water_rows, list) else [], start=1):
            raw = (row or {}).get("quantity")
            if raw in (None, ""):
                continue
            if _as_int(raw, default=-1) <= 0:
                errors.append(
                    f"Mineral water row {index}: enter how many bottles you need, as a whole "
                    "number greater than zero."
                )

    if errors:
        raise ValidationError(errors[0], details={"errors": errors})


def _as_date(raw: Any) -> dt.date | None:
    """A schedule row's `date` as a date, or None when it is absent or unparseable.

    Unparseable is left to the "needs a date" check above rather than reported
    twice as two different problems.
    """
    if isinstance(raw, dt.date):
        return raw
    try:
        return dt.date.fromisoformat(str(raw).strip()[:10])
    except (ValueError, TypeError):
        return None


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


def _event_image_url(value: Any) -> str | None:
    """event_image is VARCHAR(255) — it can only ever hold the uploaded file's URL
    (see uploads.py), never the full EventImageAsset object the client works with
    (url/fileName/mimeType/sizeBytes/status/storageKey). Accepts either shape so a
    stale client payload doesn't silently write a JSON blob into the column."""
    if isinstance(value, dict):
        url = value.get("url")
        return str(url) if url else None
    return str(value) if value else None


_IMAGE_MIME_BY_EXTENSION = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
}


def _event_image_asset(stored: str | None) -> dict[str, Any] | None:
    """Inverse of _event_image_url: only the URL is ever stored (as of this fix), so this
    rebuilds the EventImageAsset shape event-image-upload.ts expects (it reads .url plus
    .fileName/.sizeBytes for its own "currently selected" preview panel) from that URL alone.

    Proposals saved before this fix have the OLD bug's output sitting in the column instead:
    the full object was json.dumps()'d into a VARCHAR(255), so `stored` may itself be a JSON
    string (occasionally truncated at 255 chars if the filename was long). Recovers the real
    url/fileName/etc. from that blob when it parses; a still-truncated blob's `url` field is
    intact far more often than not, since it's serialized first — the object is only cut off
    partway through the LATER fields."""
    if not stored:
        return None
    url = stored
    legacy: dict[str, Any] = {}
    if stored.lstrip().startswith("{"):
        try:
            legacy = json.loads(stored)
        except json.JSONDecodeError:
            # Truncated mid-string — url is serialized first, so recover it with a regex
            # rather than giving up and showing a broken image for every pre-fix proposal.
            match = re.search(r'"url"\s*:\s*"((?:[^"\\]|\\.)*)"', stored)
            if match:
                url = match.group(1)
        else:
            url = str(legacy.get("url") or stored)
    file_name = str(legacy.get("fileName") or url.rsplit("/", 1)[-1])
    extension = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    return {
        "url": url,
        "fileName": file_name,
        "mimeType": str(legacy.get("mimeType") or _IMAGE_MIME_BY_EXTENSION.get(extension, "application/octet-stream")),
        "sizeBytes": int(legacy.get("sizeBytes") or 0),
        "status": "uploaded",
    }


def write_scalars(cur, request_id: int, payload: dict, applicant: dict) -> None:
    format_id, format_label = _resolve_format(cur, payload.get("eventFormat"))
    # Paid events must use manual approval so the organiser can verify payment before
    # confirming a registration - mirrors event-proposal.ts's requiresPayment() lock.
    registration_mode = "Manual" if _as_decimal(payload.get("costAmount") or 0) > 0 else (_text(payload, "registrationMode") or "Automatic")
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
            registration_mode,
            _text(payload, "publicity") or None,
            _event_image_url(payload.get("eventImage")),
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


def _resolve_category(cur, value: Any) -> dict | None:
    """Accept an id or a name, mirroring _resolve_format: the picker (categoryOptions in
    event-proposal.ts) sends catalog ids, but older drafts/callers may still send names."""
    row = None
    if str(value).isdigit():
        row = fetch_one(cur, "SELECT event_category_id, name FROM event_category WHERE event_category_id = %s", (int(value),))
    if row is None:
        row = fetch_one(cur, "SELECT event_category_id, name FROM event_category WHERE name = %s", (str(value),))
    return row


def write_children(cur, request_id: int, payload: dict) -> None:
    # --- Categories: freeze the name alongside the id ---------------------
    # request_categories' PK is (request_id, category_id) - a repeated value in the payload (e.g.
    seen_category_ids: set[int] = set()
    for value in payload.get("eventCategories") or []:
        row = _resolve_category(cur, value)
        if row is None or row["event_category_id"] in seen_category_ids:
            continue
        seen_category_ids.add(row["event_category_id"])
        cur.execute(
            "INSERT INTO request_categories (request_id, category_id, category_name) "
            "VALUES (%s, %s, %s) ON CONFLICT (request_id, category_id) DO NOTHING",
            (request_id, row["event_category_id"], row["name"]),
        )

    # --- Club Only audience: freeze the name, keep membership live -------
    # Only written for Club Only (validate() rejects clubs on any other tier), so switching visibility
    # away and re-saving drops the audience with the rest of the children.
    if _text(payload, "eventVisibility") == "Club Only":
        for club_id in _club_id_list(payload):
            row = fetch_one(
                cur, "SELECT club_id, club_name FROM clubs WHERE club_id = %s AND active", (club_id,)
            )
            if row is None:
                continue
            cur.execute(
                "INSERT INTO request_clubs (request_id, club_id, club_name) "
                "VALUES (%s, %s, %s) ON CONFLICT (request_id, club_id) DO NOTHING",
                (request_id, row["club_id"], row["club_name"]),
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
        venue_id, location, kind = _resolve_location(cur, row, allow_outside=True)
        cur.execute(
            'INSERT INTO event_schedule '
            '(request_id, "date", start_time, end_time, location, venue_option_id, location_kind) '
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (request_id, row["date"], row["start"], row["end"], location, venue_id, kind),
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
                row.get("name") or "",
                "",
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
                row.get("name") or "",
                "",
                row["email"],
                row.get("role"),
                row.get("notes"),
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
            'INSERT INTO brief_agenda (request_id, agenda_date, "time", activity, location, pic, notes) '
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                request_id,
                # Only multi-day events ask for a per-row date; a single-day agenda stores NULL.
                row.get("date") or None,
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
    """The eight per-requirement detail tables.

    The client sends these nested under `requestRows`, keyed by the same
    requirement names as `selectedRequirements` (event_requirements.requirement_name) -
    'waterNormal' for mineral water, not 'mineralWater'. Each row's select
    fields (item/type/service/foodType/startPoint/tourType/mainItem/subItem)
    hold a catalogue option id ("logistics:1"), not a label - _resolve_option
    looks up the real (option_id, label) pair to freeze onto the row, the same
    way write_children freezes category names.

    waterNormal's `quantity` is the exception and is NOT a catalogue id: it is
    the number of bottles the applicant typed (migration 028 removed the
    dropdown it used to pick from).
    """
    request_rows = payload.get("requestRows")
    request_rows = request_rows if isinstance(request_rows, dict) else {}

    for requirement_name, writer in _REQUIREMENT_ROW_WRITERS.items():
        writer(cur, request_id, _rows(request_rows, requirement_name))


def _write_logistics_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("item"):
            continue
        option_id, label, _ = _resolve_option(cur, row.get("item"), "logistics")
        venue_id, location, _ = _resolve_location(cur, row)
        cur.execute(
            """INSERT INTO request_logistics
                   (request_id, option_id, item, quantity, "date", start_time, end_time, location,
                    venue_option_id, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, option_id, label, _as_int(row.get("quantity")),
             row.get("date"), row.get("start"), row.get("end"), location, venue_id, row.get("notes")),
        )


def _write_transportation_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("type"):
            continue
        option_id, label, _ = _resolve_option(cur, row.get("type"), "transportation")
        cur.execute(
            """INSERT INTO request_transportation
                   (request_id, option_id, type, requested_pax, pickup, dropoff, "date", moving_time, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, option_id, label, _as_int(row.get("requestedPax")),
             row.get("pickup") or "", row.get("dropoff") or "", row.get("date"),
             row.get("start"), row.get("notes")),
        )


def _write_photo_video_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("service"):
            continue
        option_id, label, _ = _resolve_option(cur, row.get("service"), "photoVideo")
        venue_id, location, _ = _resolve_location(cur, row)
        cur.execute(
            """INSERT INTO request_photography_videography
                   (request_id, option_id, service, "date", start_time, end_time, location,
                    venue_option_id, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, option_id, label, row.get("date"),
             row.get("start"), row.get("end"), location, venue_id, row.get("notes")),
        )


def _write_sound_light_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("item"):
            continue
        option_id, label, _ = _resolve_option(cur, row.get("item"), "soundLight")
        venue_id, location, _ = _resolve_location(cur, row)
        cur.execute(
            """INSERT INTO request_sound_light
                   (request_id, option_id, item, "date", start_time, end_time, location,
                    venue_option_id, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, option_id, label, row.get("date"),
             row.get("start"), row.get("end"), location, venue_id, row.get("notes")),
        )


def _write_fmb_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("foodType"):
            continue
        option_id, label, _ = _resolve_option(cur, row.get("foodType"), "fmb")
        venue_id, location, _ = _resolve_location(cur, row)
        cur.execute(
            """INSERT INTO request_fmb
                   (request_id, option_id, food_type, pax, "date", serve_time, location,
                    venue_option_id, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, option_id, label, _as_int(row.get("quantity")),
             row.get("date"), row.get("start"), location, venue_id, row.get("notes")),
        )


def _write_campus_tour_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not row.get("startPoint"):
            continue
        start_option_id, start_label, _ = _resolve_option(cur, row.get("startPoint"), "campusTourStart")
        tour_option_id, tour_label, _ = _resolve_option(cur, row.get("tourType"), "campusTourType")
        cur.execute(
            """INSERT INTO request_campus_tour
                   (request_id, "date", pax, start_point_option_id, start_point,
                    tour_type_option_id, tour_type, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, row.get("date"), _as_int(row.get("pax")),
             start_option_id, start_label, tour_option_id, tour_label, row.get("notes")),
        )


def _write_water_normal_rows(cur, request_id: int, rows: list[dict]) -> None:
    """Mineral water: the applicant types how many bottles they want.

    This used to be a catalogue pick, and `quantity` arrived as "waterNormal:2"
    - an option id whose number_of_bottles was then copied in as the real
    figure. So the number stored was never the number asked for: it was
    whatever pack size the chosen row happened to carry, and an applicant who
    needed 200 bottles could only ask for one of three preset amounts. The
    catalogue is gone (migration 028) and the value is now the count itself.

    A row with no quantity is skipped rather than rejected, matching every other
    writer here - an empty repeat-row on a draft is unfinished work, not an
    error. Zero and negatives are caught by validate(); the column's own CHECK
    is the backstop for anything that bypasses the API.
    """
    for row in rows:
        quantity = _as_int(row.get("quantity"), default=0)
        if quantity <= 0:
            continue
        venue_id, location, _ = _resolve_location(cur, row)
        cur.execute(
            """INSERT INTO request_mineral_water
                   (request_id, quantity, with_logo, "date",
                    start_time, end_time, location, venue_option_id, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, quantity,
             str(row.get("withLogo") or "").strip().lower() == "yes", row.get("date"),
             row.get("start"), row.get("end"), location, venue_id, row.get("notes")),
        )


def _write_funding_purchase_rows(cur, request_id: int, rows: list[dict]) -> None:
    for row in rows:
        if not (row.get("mainItem") and row.get("subItem")):
            continue
        main_option_id, main_label, _ = _resolve_option(cur, row.get("mainItem"), "fundingMain")
        sub_option_id, sub_label, _ = _resolve_option(cur, row.get("subItem"), "fundingSub")
        cur.execute(
            """INSERT INTO request_funding_purchase
                   (request_id, main_option_id, main_item, sub_option_id, sub_item,
                    quantity, unit_price_rm, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (request_id, main_option_id, main_label, sub_option_id, sub_label,
             _as_int(row.get("quantity")), _as_decimal(row.get("unit")), row.get("notes")),
        )


# One writer + one child table per department requirement — keys match
# event_requirements.requirement_name and DepartmentRequestKind on the client.
_REQUIREMENT_ROW_WRITERS = {
    "logistics": _write_logistics_rows,
    "transportation": _write_transportation_rows,
    "photoVideo": _write_photo_video_rows,
    "soundLight": _write_sound_light_rows,
    "fmb": _write_fmb_rows,
    "campusTour": _write_campus_tour_rows,
    "waterNormal": _write_water_normal_rows,
    "fundingPurchase": _write_funding_purchase_rows,
}

def write_single_requirement_rows(cur, request_id: int, requirement_name: str, rows: list[dict]) -> None:
    """Replace ONE requirement's rows only - used when a single department sent its
    task back and the applicant is fixing just that department's request, not the
    whole proposal. Everything else (other departments' rows, already-approved
    content) is untouched, unlike save_content's clear_children + full rewrite."""
    table_and_pk = TABLE_FOR_REQUIREMENT.get(requirement_name)
    writer = _REQUIREMENT_ROW_WRITERS.get(requirement_name)
    if table_and_pk is None or writer is None:
        raise NotFound(f"'{requirement_name}' is not a department requirement.")
    table, _pk = table_and_pk
    cur.execute(f"DELETE FROM {table} WHERE request_id = %s", (request_id,))
    writer(cur, request_id, rows)


def create(cur, applicant: dict, payload: dict, *, draft: bool) -> int:
    """Insert a request row in 'draft' and fill it from the payload. Returns its id.

    Callers submit it separately (workflow.submit) so "save a draft" and
    "submit for review" share one code path up to the point they diverge.
    """
    validate(cur, payload, draft=draft, applicant=applicant)
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
    validate(cur, payload, draft=draft, applicant=applicant)
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


# A department_review task's status is "not yet settled" while pending (nobody
# has looked at it yet) or resubmitted (sent back to the applicant, still
# waiting on THEM) - everything else means the department has acted.
_UNCONFIRMED_TASK_STATUSES = ("pending", "resubmitted")


def _department_confirmations(
    cur, request_id: int, *, with_allocation: bool = False
) -> list[dict[str, Any]]:
    """One entry per department task, in the client's DepartmentConfirmation shape.

    Keyed off the task rows' stage_code, not the request status, so it keeps
    reporting through implementation - where every task is approved and the
    applicant is watching the staff work it down. Empty only when there are no
    task rows at all (nothing was routed, or the proposal never reached the
    departments).

    `with_allocation` adds `fullyAllocated`: whether every row this department
    was asked to fulfil actually has someone (or a cafeteria order) on it. A
    task can be confirmed and NOT fully allocated - that is the state a
    premature approval leaves behind, and the department view keeps its actions
    on screen for it rather than treating the department as finished. Costs one
    count per task, so only the single-proposal projection asks for it; the list
    pages have no use for it and would pay it per row.
    """
    return [
        {
            "department": row["requirement_name"],
            "confirmed": row["status"] not in _UNCONFIRMED_TASK_STATUSES,
            "status": row["status"],
            "comment": row["comment"],
            "confirmedAt": row["resolved_at"],
            **(
                {
                    "fullyAllocated": not unallocated_row_count(
                        cur, request_id, row["requirement_name"]
                    )
                }
                if with_allocation
                else {}
            ),
        }
        for row in fetch_all(
            cur,
            """SELECT t.status, t.comment, t.resolved_at, er.requirement_name
                 FROM request_task t
                 JOIN event_requirements er ON er.requirement_id = t.requirement_id
                WHERE t.request_id = %s AND t.stage_code = 'department_review'
             ORDER BY t.request_task_id""",
            (request_id,),
        )
    ]


# --- Projection -----------------------------------------------------------
def project_list_item(cur, request: dict) -> dict[str, Any]:
    """One proposal, shaped for the Inbox/Ongoing/History/Drafts TABLE rows only - every page
    list_proposals() backs (see api/proposals.py).

    hub-proposals.ts (Inbox/Ongoing/History) renders proposalId/eventTitle/applicant/schedule/
    totalPax/status as table cells, plus applicantInitials/applicantEmail and workflow.stage/
    departmentConfirmations for row logic (split-department rows, "is this my own proposal") - see
    that component's toRecord()/sharedRecords() and proposal-visibility.ts's
    userIsApplicantForProposal()/departmentsAwaitingApplicant(). records-page.ts (Drafts) renders
    proposalId/eventTitle/applicant/applicantInitials/schedule/status plus shortIntroduction
    (the 'introduction' cell) and category (its filter dropdown + search) - it never reads
    totalPax (hardcoded '—' there) or workflow.

    This is the union of both, still a fraction of the full project() shape: no bank details,
    agenda, discussions, event image, visibility, registration mode, publicity, requirements,
    co-owners, organizers, importantPeople, guests, etc. Full detail is only ever needed once the
    caller opens ONE proposal, via GET /proposals/{id} -> project()."""
    request_id = request["request_id"]
    schedule = fetch_all(
        cur,
        'SELECT "date", start_time, end_time, location FROM event_schedule '
        "WHERE request_id = %s ORDER BY event_schedule_id",
        (request_id,),
    )
    categories = fetch_all(
        cur, "SELECT category_name FROM request_categories WHERE request_id = %s", (request_id,)
    )
    initials = "".join(part[0] for part in (request["applicant_name"] or "").split()[:2]).upper()
    return {
        "id": request_id,
        "proposalId": request["request_code"],
        "eventTitle": request["event_title"],
        "applicant": request["applicant_name"],
        "applicantInitials": initials,
        "applicantEmail": request["applicant_email"],
        "shortIntroduction": request["short_introduction"],
        "category": categories[0]["category_name"] if categories else "",
        "totalPax": request["total_pax"],
        "status": request["status"],
        "schedule": "; ".join(
            f"{r['date']} · {r['start_time']}-{r['end_time']} · {r['location']}" for r in schedule
        ),
        # The same rows unjoined, so a list page can put the date, the time and the
        # location in three separate columns instead of parsing them back out of the
        # string above (which stays, for the readers that still show one line).
        "scheduleRows": [
            {
                "date": str(r["date"]),
                "start": str(r["start_time"]),
                "end": str(r["end_time"]),
                "location": r["location"],
            }
            for r in schedule
        ],
        "workflow": {
            "stage": stage_for_client(request["status"]),
            "departmentConfirmations": _department_confirmations(cur, request_id),
        },
    }


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
        'SELECT "date", start_time, end_time, location, venue_option_id, location_kind '
        "FROM event_schedule WHERE request_id = %s ORDER BY event_schedule_id",
        (request_id,),
    )
    # The Club Only audience.
    club_rows = fetch_all(
        cur,
        "SELECT club_id, club_name FROM request_clubs WHERE request_id = %s ORDER BY club_name",
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
        "eventClubs": [str(r["club_id"]) for r in club_rows],
        "eventClubNames": [r["club_name"] for r in club_rows],
        "eventFormat": request["event_format_snapshot"],
        "registrationMode": request["registration_approval"],
        "publicity": request["promotion_publicity_method"] or "",
        "eventImage": _event_image_asset(request["event_image"]),
        "costAmount": float(request["cost_amount"]) if request["cost_amount"] is not None else None,
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
                # `location` stays the frozen display text every existing reader
                # already uses; venueId/locationKind are what the form re-selects
                # from when a draft is reopened.
                "location": r["location"],
                "venueId": _venue_ref(r["venue_option_id"]),
                "locationKind": r["location_kind"] or INSIDE,
            }
            for r in schedule
        ],
        "schedule": "; ".join(
            f"{r['date']} · {r['start_time']}-{r['end_time']} · {r['location']}" for r in schedule
        ),
        "workflow": {
            "stage": stage_for_client(request["status"]),
            "resumeStage": stage_for_client(request["resume_stage"]),
            "reviewerComment": request["reviewer_comment"],
            "departmentConfirmations": _department_confirmations(
                cur, request_id, with_allocation=True
            ),
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
        projected["coOwners"] = [
            {
                "staffId": r["staffId"],
                "name": " ".join(part for part in (r["firstName"], r["lastName"]) if part) or r["email"],
                "email": r["email"], "role": r["role"],
            }
            for r in fetch_all(
                cur,
                """SELECT staff_id AS "staffId", staff_first_name AS "firstName",
                          staff_last_name AS "lastName", staff_email AS email, staff_role AS role
                     FROM co_owners WHERE request_id = %s ORDER BY co_owner_id""",
                (request_id,),
            )
        ]
        projected["organizers"] = [
            {
                "staffId": r["staffId"],
                "name": " ".join(part for part in (r["firstName"], r["lastName"]) if part) or r["email"],
                "email": r["email"], "role": r["role"], "notes": r["note"] or "",
            }
            for r in fetch_all(
                cur,
                """SELECT staff_id AS "staffId", staff_first_name AS "firstName",
                          staff_last_name AS "lastName", staff_email AS email,
                          staff_role AS role, note
                     FROM organizers WHERE request_id = %s ORDER BY organizer_id""",
                (request_id,),
            )
        ]
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
        projected["agenda"] = [
            {
                # "" not None: the form's Date column is a select whose options are the schedule's
                # dates, and it matches on the string value.
                "date": str(r["agenda_date"]) if r["agenda_date"] else "",
                "time": str(r["time"]), "activity": r["activity"], "location": r["location"],
                "pic": r["pic"], "notes": r["notes"] or "",
            }
            for r in fetch_all(
                cur,
                'SELECT agenda_date, "time", activity, location, pic, notes FROM brief_agenda '
                "WHERE request_id = %s ORDER BY brief_agenda_id",
                (request_id,),
            )
        ]
        projected["discussions"] = [
            {"topic": r["discussion_topic"]}
            for r in fetch_all(
                cur,
                "SELECT discussion_topic FROM request_discussion_topics "
                "WHERE request_id = %s ORDER BY request_discussion_topic_id",
                (request_id,),
            )
        ]
        projected["requestRows"] = _read_requirement_rows(cur, request_id)
        projected["requests"] = flatten_requests(cur, request_id)

    return projected


def flatten_requests(cur, request_id: int) -> list[dict[str, Any]]:
    """One row per per-requirement request, as the display-only ProposalDepartmentRequest
    the department hub (hub-requests.ts) shows - pre-joined text, not the editable
    id-referencing shape _read_requirement_rows() produces for the applicant's own form.

    Reads each table's frozen label column directly (item/type/service/food_type/
    option_label/main_item+sub_item) rather than resolving option refs again -
    this is a read-only summary, so the snapshot text IS the answer.
    """
    requests: list[dict[str, Any]] = []

    for r in fetch_all(
        cur, "SELECT * FROM request_logistics WHERE request_id = %s ORDER BY request_logistics_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_logistics_id"], "department": "logistics", "item": r["item"],
            "quantity": str(r["quantity"]),
            "schedule": f"{r['date']} · {str(r['start_time'])[:5]}-{str(r['end_time'])[:5]}",
            "location": r["location"], "notes": r["notes"] or "",
            "deadline": f"{r['date']}T{r['start_time']}",
        })
    for r in fetch_all(
        cur, "SELECT * FROM request_transportation WHERE request_id = %s ORDER BY request_transportation_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_transportation_id"], "department": "transportation", "item": r["type"],
            "quantity": f"{r['requested_pax']} pax", "schedule": f"{r['date']} · {str(r['moving_time'])[:5]}",
            "location": f"{r['pickup']} → {r['dropoff']}", "notes": r["notes"] or "",
            "deadline": f"{r['date']}T{r['moving_time']}",
        })
    for r in fetch_all(
        cur,
        "SELECT * FROM request_photography_videography WHERE request_id = %s "
        "ORDER BY request_photography_videography_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_photography_videography_id"], "department": "photoVideo", "item": r["service"],
            "quantity": "", "schedule": f"{r['date']} · {str(r['start_time'])[:5]}-{str(r['end_time'])[:5]}",
            "location": r["location"], "notes": r["notes"] or "",
            "deadline": f"{r['date']}T{r['start_time']}",
        })
    for r in fetch_all(
        cur, "SELECT * FROM request_sound_light WHERE request_id = %s ORDER BY request_sound_light_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_sound_light_id"], "department": "soundLight", "item": r["item"],
            "quantity": "", "schedule": f"{r['date']} · {str(r['start_time'])[:5]}-{str(r['end_time'])[:5]}",
            "location": r["location"], "notes": r["notes"] or "",
            "deadline": f"{r['date']}T{r['start_time']}",
        })
    for r in fetch_all(
        cur, "SELECT * FROM request_fmb WHERE request_id = %s ORDER BY request_fmb_id", (request_id,)
    ):
        requests.append({
            "id": r["request_fmb_id"], "department": "fmb", "item": r["food_type"],
            "quantity": f"{r['pax']} pax", "schedule": f"{r['date']} · {str(r['serve_time'])[:5]}",
            "location": r["location"], "notes": r["notes"] or "",
            "deadline": f"{r['date']}T{r['serve_time']}",
        })
    for r in fetch_all(
        cur, "SELECT * FROM request_campus_tour WHERE request_id = %s ORDER BY request_campus_tour_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_campus_tour_id"], "department": "campusTour",
            "item": f"{r['start_point']} · {r['tour_type']}" if r["tour_type"] else r["start_point"],
            "quantity": f"{r['pax']} pax", "schedule": str(r["date"]), "location": r["start_point"],
            "notes": r["notes"] or "",
            # No time column on this table - treat the whole day as the deadline window.
            "deadline": f"{r['date']}T23:59:59",
        })
    for r in fetch_all(
        cur, "SELECT * FROM request_mineral_water WHERE request_id = %s ORDER BY request_mineral_water_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_mineral_water_id"], "department": "waterNormal",
            # The catalogue that used to name this row is gone (migration 028); every row on
            # this table is mineral water, and the logo toggle is the only thing that varies.
            "item": "Mineral Water (with logo)" if r["with_logo"] else "Mineral Water",
            "quantity": f"{r['quantity']} bottles", "schedule": f"{r['date']} · {str(r['start_time'])[:5]}-{str(r['end_time'])[:5]}",
            "location": r["location"], "notes": r["notes"] or "",
        })
    for r in fetch_all(
        cur,
        "SELECT * FROM request_funding_purchase WHERE request_id = %s ORDER BY request_funding_purchase_id",
        (request_id,),
    ):
        requests.append({
            "id": r["request_funding_purchase_id"], "department": "fundingPurchase",
            "item": f"{r['main_item']} · {r['sub_item']}", "quantity": str(r["quantity"]),
            "schedule": "", "location": "", "notes": r["notes"] or "",
        })
    return requests


def _option_ref(option_id: int | None, kind: str) -> str:
    return f"{kind}:{option_id}" if option_id is not None else ""


def _read_requirement_rows(cur, request_id: int) -> dict[str, list[dict[str, Any]]]:
    """The inverse of _write_requirement_rows: reload the eight per-requirement
    tables as the editor's EditableRow shape, so reopening a draft or a
    sent-back proposal shows every row exactly as it was entered."""
    rows: dict[str, list[dict[str, Any]]] = {}

    rows["logistics"] = [
        {
            "id": r["request_logistics_id"], "item": _option_ref(r["option_id"], "logistics"),
            "quantity": r["quantity"], "date": str(r["date"]), "start": str(r["start_time"]),
            "end": str(r["end_time"]), "location": r["location"],
            "venueId": _venue_ref(r["venue_option_id"]), "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur,
            'SELECT * FROM request_logistics WHERE request_id = %s ORDER BY request_logistics_id',
            (request_id,),
        )
    ]
    rows["transportation"] = [
        {
            "id": r["request_transportation_id"], "type": _option_ref(r["option_id"], "transportation"),
            "requestedPax": r["requested_pax"], "pickup": r["pickup"], "dropoff": r["dropoff"],
            "date": str(r["date"]), "start": str(r["moving_time"]), "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur,
            "SELECT * FROM request_transportation WHERE request_id = %s ORDER BY request_transportation_id",
            (request_id,),
        )
    ]
    rows["photoVideo"] = [
        {
            "id": r["request_photography_videography_id"], "service": _option_ref(r["option_id"], "photoVideo"),
            "date": str(r["date"]), "start": str(r["start_time"]), "end": str(r["end_time"]),
            "location": r["location"], "venueId": _venue_ref(r["venue_option_id"]),
            "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur,
            "SELECT * FROM request_photography_videography WHERE request_id = %s "
            "ORDER BY request_photography_videography_id",
            (request_id,),
        )
    ]
    rows["soundLight"] = [
        {
            "id": r["request_sound_light_id"], "item": _option_ref(r["option_id"], "soundLight"),
            "date": str(r["date"]), "start": str(r["start_time"]), "end": str(r["end_time"]),
            "location": r["location"], "venueId": _venue_ref(r["venue_option_id"]),
            "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur,
            "SELECT * FROM request_sound_light WHERE request_id = %s ORDER BY request_sound_light_id",
            (request_id,),
        )
    ]
    rows["fmb"] = [
        {
            "id": r["request_fmb_id"], "foodType": _option_ref(r["option_id"], "fmb"),
            "quantity": r["pax"], "date": str(r["date"]), "start": str(r["serve_time"]),
            "location": r["location"], "venueId": _venue_ref(r["venue_option_id"]),
            "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur, "SELECT * FROM request_fmb WHERE request_id = %s ORDER BY request_fmb_id", (request_id,)
        )
    ]
    rows["campusTour"] = [
        {
            "id": r["request_campus_tour_id"],
            "startPoint": _option_ref(r["start_point_option_id"], "campusTourStart"),
            "tourType": _option_ref(r["tour_type_option_id"], "campusTourType"),
            "date": str(r["date"]), "pax": r["pax"], "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur, "SELECT * FROM request_campus_tour WHERE request_id = %s ORDER BY request_campus_tour_id",
            (request_id,),
        )
    ]
    rows["waterNormal"] = [
        {
            "id": r["request_mineral_water_id"], "quantity": r["quantity"],
            "withLogo": "Yes" if r["with_logo"] else "No", "date": str(r["date"]),
            "start": str(r["start_time"]), "end": str(r["end_time"]),
            "location": r["location"], "venueId": _venue_ref(r["venue_option_id"]),
            "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur, "SELECT * FROM request_mineral_water WHERE request_id = %s ORDER BY request_mineral_water_id",
            (request_id,),
        )
    ]
    rows["fundingPurchase"] = [
        {
            "id": r["request_funding_purchase_id"], "mainItem": _option_ref(r["main_option_id"], "fundingMain"),
            "subItem": _option_ref(r["sub_option_id"], "fundingSub"), "quantity": r["quantity"],
            "unit": float(r["unit_price_rm"]) if r["unit_price_rm"] is not None else None,
            "notes": r["notes"] or "",
        }
        for r in fetch_all(
            cur,
            "SELECT * FROM request_funding_purchase WHERE request_id = %s ORDER BY request_funding_purchase_id",
            (request_id,),
        )
    ]
    return rows
