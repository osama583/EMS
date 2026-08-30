"""Seed realistic event/proposal data by driving the real workflow state machine.

    python -m seed.seed_events

Every proposal here is created via `app.services.proposals.create` and moved
through `app.services.workflow` exactly the way the API and the test suite do
it (see tests/test_workflow_e2e.py) - never a raw INSERT into request,
request_task, request_fmb_selection, or workflow_history. That's the only way
a seeded row ends up with a correct audit trail, correct department tasks,
and correct derived state for dashboards/analytics.

This script ADDS to whatever is already in the database. It never truncates
or deletes - `seed/run.py --reset` refuses once real proposals exist, and the
same caution applies here. Existing rows (including the handful of manually
created test proposals already present) are left alone.

Mix produced (>= 16 requests):
  - Public events, fully approved and published, spanning different routes:
    low-pax straight-to-department, high-pax via F&B->CFO, self-review skips
    (HOS/HOD applicant, CFO applicant), club-run public events, an FMB order
    walked all the way to "fulfilled", a funding-only proposal that
    auto-completes with no department tasks.
  - Private approved events (organiser-only, not on the public Explore page).
  - Club Only approved events.
  - In-flight proposals sitting at every stage: hos_hod_review, fmb_review,
    cfo_review, department_review (with a live pending task), and one
    resubmission_required (sent back with a comment).
  - A rejected proposal and a cancelled proposal, to populate the "reasons a
    proposal doesn't become an event" side of the audit trail.
  - A couple of registrations on published events, exercising both automatic
    and manual-approval registration modes, so dashboards have attendee data.

Every requirement value, status value, role, and table used below already
exists in the schema and in seed/data.py - nothing new is introduced.
"""
from __future__ import annotations

import logging
import pathlib
import sys
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config  # noqa: E402
from app.db import fetch_all, fetch_one, init_pool, transaction  # noqa: E402
from app.security.principal import Principal  # noqa: E402
from app.services import proposals  # noqa: E402
from app.services import workflow as wf  # noqa: E402

log = logging.getLogger("seed.events")

ATRIUM = "cafeteria__atrium_cafeteria"
FOOD_COURT = "cafeteria__level_3_food_court"


# --- Helpers reused from tests/test_workflow_e2e.py -----------------------
def principal_for(cur, email: str) -> Principal:
    user = fetch_one(cur, "SELECT * FROM users WHERE email = %s", (email,))
    if not user:
        raise SystemExit(f"seed account missing: {email} - run `python -m seed.run` first")
    cur.execute(
        "SELECT role_code, unit_code FROM user_unit_roles WHERE user_id = %s", (user["user_id"],)
    )
    assignments = tuple((r["role_code"], r["unit_code"]) for r in cur.fetchall())
    return Principal(
        user_id=user["user_id"],
        full_name=user["full_name"],
        email=user["email"],
        is_active=True,
        assignments=assignments,
    )


def days_out(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


# --- Venues ---------------------------------------------------------------
# "Inside University" is a CFO-managed catalogue (venue_options), not free text:
# every venue-backed request field renders a dropdown built from it (see
# event-proposal.ts's buildRequirementDefinitions, where `location` is a
# `venueId` select). So a seeded row must send `venueId`, exactly as the form
# would - the service then freezes the matching label onto the row's `location`
# column from the id (proposals.py's _resolve_location).
#
# Writing a bare `location` string here instead was the bug this replaces: it
# left venue_option_id NULL, so the dropdown had nothing to re-select and the
# row showed a label that was not in the catalogue at all (or, worse, a raw id
# like "11" typed into the text box).
#
# Resolved by LABEL against the live table rather than by hardcoded id, because
# ids are assigned by the catalogue seed and a literal here would silently rot
# the moment that order changed.
_VENUE_IDS: dict[str, int] = {}


def load_venues(cur) -> None:
    """Cache the live venue catalogue once per run."""
    _VENUE_IDS.clear()
    for row in fetch_all(cur, "SELECT venue_option_id, label FROM venue_options WHERE active"):
        _VENUE_IDS[row["label"]] = row["venue_option_id"]
    if not _VENUE_IDS:
        raise SystemExit("no active venues - run `python -m seed.run` first")


def venue(label: str) -> str:
    """The "venue:{id}" reference the proposal form submits for `label`.

    Fails loudly on an unknown label: a typo that silently fell through to free
    text is precisely what produced the bad rows this function exists to prevent.
    """
    if label not in _VENUE_IDS:
        raise SystemExit(
            f"unknown venue {label!r} - it must exist in venue_options. "
            f"Known: {', '.join(sorted(_VENUE_IDS))}"
        )
    return f"venue:{_VENUE_IDS[label]}"


def placeholder_image(seed_text: str) -> str:
    """A short, deterministic placeholder image URL - event_image is VARCHAR(255),
    so this must stay well under that limit (see proposals.py's _event_image_url)."""
    label = "".join(ch for ch in seed_text if ch.isalnum())[:24] or "Event"
    return f"https://placehold.co/800x450?text={label}"


def make_payload(**overrides) -> dict:
    day = days_out(60)
    payload = {
        "eventTitle": "Untitled Event",
        "shortIntroduction": "An introduction.",
        "goals": "Some goals.",
        "benefits": "Some benefits.",
        "eventVisibility": "Private",
        "registrationMode": "Automatic",
        "eventImage": placeholder_image(str(overrides.get("eventTitle") or "Event")),
        "totalPax": 20,
        "scheduleRows": [{"date": day, "start": "09:00", "end": "17:00", "venueId": venue("Auditorium")}],
        "selectedRequirements": ["logistics"],
        "requestRows": {"logistics": [{"item": "logistics:1", "quantity": 10, "date": day,
                                        "start": "08:00", "end": "18:00", "venueId": venue("Auditorium"),
                                        "notes": "Setup two hours before doors open."}]},
    }
    payload.update(overrides)
    return payload


def create_proposal(cur, applicant_email: str, **overrides) -> int:
    principal = principal_for(cur, applicant_email)
    applicant = proposals.load_applicant(cur, principal.user_id)
    return proposals.create(cur, applicant, make_payload(**overrides), draft=False)


def status_of(cur, request_id: int) -> str:
    return fetch_one(cur, "SELECT status FROM request WHERE request_id = %s", (request_id,))["status"]


def approve_all_department_tasks(cur, request_id: int) -> None:
    """Approve + progress every task on a request to 'completed', the way a
    department would actually work it: approve+assign, then preparing, then
    completed. Mirrors what the frontend's task board does."""
    for task in wf.tasks_for_request(cur, request_id):
        requirement_name = task["requirement_name"]
        head_email = _HEAD_EMAIL_FOR_REQUIREMENT.get(requirement_name)
        staff_email = _STAFF_EMAIL_FOR_REQUIREMENT.get(requirement_name)
        head = principal_for(cur, head_email)
        staff = principal_for(cur, staff_email)

        wf.approve_task(cur, request_id, requirement_name, head.user_id)
        task = wf.find_task(cur, request_id, requirement_name)
        if task["status"] in ("completed", "cancelled"):
            continue
        wf.assign_staff(cur, task["request_task_id"], staff.user_id, head.user_id)
        wf.update_task_status(cur, task["request_task_id"], "preparing", staff.user_id)
        wf.update_task_status(cur, task["request_task_id"], "completed", staff.user_id)


_HEAD_EMAIL_FOR_REQUIREMENT = {
    "logistics": "logistics.manager@demo.apu.edu.my",
    "transportation": "transport.manager@demo.apu.edu.my",
    "photoVideo": "photography.manager@demo.apu.edu.my",
    "soundLight": "av.manager@demo.apu.edu.my",
    "campusTour": "student.services.manager@demo.apu.edu.my",
    "fmb": "fmb@demo.apu.edu.my",
}
_STAFF_EMAIL_FOR_REQUIREMENT = {
    "logistics": "logistics.staff@demo.apu.edu.my",
    "transportation": "transport.staff@demo.apu.edu.my",
    "photoVideo": "photographer@demo.apu.edu.my",
    "soundLight": "av.technician@demo.apu.edu.my",
    "campusTour": "student.services.member@demo.apu.edu.my",
    "fmb": "fmb.staff@demo.apu.edu.my",
}


def register_for(cur, request_id: int, user_email: str, *, manual: bool = False, reason: str | None = None) -> None:
    principal = principal_for(cur, user_email)
    status = "pending_approval" if manual else "registered"
    cur.execute(
        """INSERT INTO event_registration
               (request_id, user_id, registrant_name, registrant_email,
                reason_for_attending, status, payment_status)
           VALUES (%s, %s, %s, %s, %s, %s, 'not_required')""",
        (request_id, principal.user_id, principal.full_name, principal.email, reason, status),
    )


# --- Scenario builders ------------------------------------------------------
def scenario_low_pax_public_approved(cur) -> int:
    """Student applicant, low pax, one department (logistics), straight to
    department_review, approved end to end -> published Public event."""
    request_id = create_proposal(
        cur, "student.computing@demo.apu.edu.my",
        eventTitle="AI & Data Science Career Fair",
        shortIntroduction="Meet employers hiring in AI, data, and software roles.",
        goals="Connect Computing students with industry recruiters.",
        benefits="Direct access to internship and graduate roles.",
        eventVisibility="Public", registrationMode="Automatic",
        # Below HIGH_PAX_THRESHOLD (config, currently 30) so this routes straight from
        # HOS/HOD to department_review - which is what this scenario asserts.
        totalPax=25, eventCategories=[1, 2],
        scheduleRows=[{"date": days_out(45), "start": "10:00", "end": "16:00", "venueId": venue("Main Hall")}],
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_high_pax_public_approved(cur) -> int:
    """High pax routes hos_hod_review -> fmb_review -> cfo_review ->
    department_review with two requirements (soundLight + campusTour)."""
    day = days_out(50)
    request_id = create_proposal(
        cur, "student.computing2@demo.apu.edu.my",
        eventTitle="APU Cultural Night",
        shortIntroduction="An evening of performances celebrating campus diversity.",
        goals="Showcase student talent across cultures.",
        benefits="Builds community and campus spirit.",
        eventVisibility="Public", registrationMode="Automatic",
        totalPax=300, eventCategories=[4, 6],
        scheduleRows=[{"date": day, "start": "18:00", "end": "22:00", "venueId": venue("Grand Hall")}],
        selectedRequirements=["soundLight", "campusTour"],
        requestRows={
            "soundLight": [{"item": "soundLight:2", "date": day, "start": "16:00", "end": "22:30",
                             "venueId": venue("Grand Hall"), "notes": "Full stage sound with engineer on site."}],
            "campusTour": [{"startPoint": "campusTourStart:1", "tourType": "campusTourType:1",
                             "date": day, "pax": 40, "notes": "Pre-event campus tour for visiting performers."}],
        },
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "hos_hod_review"
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "fmb_review"
    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "cfo_review"
    wf.approve(cur, request_id, principal_for(cur, "cfo@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_hoshod_self_review_skip_approved(cur) -> int:
    """Applicant heads their own School -> skips hos_hod_review entirely."""
    request_id = create_proposal(
        cur, "hoshod@demo.apu.edu.my",
        eventTitle="School of Computing Research Symposium",
        shortIntroduction="Faculty and postgraduate research showcase.",
        goals="Share ongoing research across the School.",
        benefits="Cross-disciplinary collaboration opportunities.",
        eventVisibility="Public", registrationMode="Manual",
        # Skipping hos_hod_review does NOT skip the pax gate - stage_after_hos_hod still
        # routes >HIGH_PAX_THRESHOLD to fmb_review. Kept below it so the skip lands
        # directly in department_review, which is what this scenario asserts.
        totalPax=22, eventCategories=[1],
        scheduleRows=[{"date": days_out(40), "start": "09:00", "end": "17:00", "venueId": venue("Seminar Room 2")}],
        selectedRequirements=["logistics", "photoVideo"],
        requestRows={
            "logistics": [{"item": "logistics:2", "quantity": 15, "date": days_out(40),
                            "start": "08:00", "end": "17:30", "venueId": venue("Seminar Room 2")}],
            "photoVideo": [{"service": "photoVideo:1", "date": days_out(40),
                             "start": "09:00", "end": "17:00", "venueId": venue("Seminar Room 2")}],
        },
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_cfo_self_review_skip_private_approved(cur) -> int:
    """CFO applicant, high pax -> still skips the whole reviewer chain
    (they'd be reviewing themselves at the CFO gate)."""
    request_id = create_proposal(
        cur, "cfo@demo.apu.edu.my",
        eventTitle="Finance Office Town Hall",
        shortIntroduction="Quarterly budget update for finance staff.",
        goals="Communicate budget priorities for next semester.",
        benefits="Transparency across finance operations.",
        eventVisibility="Private", registrationMode="Automatic",
        totalPax=150,
        scheduleRows=[{"date": days_out(35), "start": "14:00", "end": "16:00", "venueId": venue("Boardroom A")}],
        selectedRequirements=["logistics"],
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_funding_only_auto_completes(cur) -> int:
    """fundingPurchase is NON_WORKFLOW - no department task is ever created,
    so once it reaches department_review it auto-completes immediately."""
    request_id = create_proposal(
        cur, "lecturer.computing@demo.apu.edu.my",
        eventTitle="Departmental Equipment Purchase",
        shortIntroduction="One-off purchase of lab equipment, no live event.",
        goals="Replace ageing lab hardware.",
        benefits="Improves teaching lab reliability.",
        eventVisibility="Private", registrationMode="Automatic",
        totalPax=1,
        scheduleRows=[{"date": days_out(20), "start": "09:00", "end": "10:00", "venueId": venue("Innovation Lab")}],
        selectedRequirements=["fundingPurchase"],
        requestRows={"fundingPurchase": [{"mainItem": "fundingMain:5", "subItem": "fundingSub:9",
                                           "quantity": 4, "unit": "1200.00",
                                           "notes": "4x wireless presenter units for lecture halls."}]},
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "hos_hod_review"
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    # fundingPurchase is NON_WORKFLOW - no department task is created, so the
    # proposal auto-completes the instant it reaches department_review.
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_fmb_order_fulfilled_public(cur) -> int:
    """Food-heavy event: department review includes an F&B task whose
    request_fmb_selection order is walked all the way to 'fulfilled'."""
    day = days_out(30)
    request_id = create_proposal(
        cur, "student.business@demo.apu.edu.my",
        eventTitle="Business Society Networking Lunch",
        shortIntroduction="Catered lunch mixer for Business students and alumni.",
        goals="Connect current students with alumni mentors.",
        benefits="Career guidance and networking.",
        eventVisibility="Public", registrationMode="Automatic",
        # Below HIGH_PAX_THRESHOLD (config, currently 30) so this routes straight from
        # HOS/HOD to department_review - which is what this scenario asserts.
        totalPax=28, eventCategories=[1, 6],
        scheduleRows=[{"date": day, "start": "12:00", "end": "14:00", "venueId": venue("Grand Hall")}],
        selectedRequirements=["fmb"],
        requestRows={"fmb": [{"foodType": "fmb:1", "quantity": 40, "date": day,
                               "start": "12:00", "venueId": venue("Grand Hall"),
                               "notes": "Halal set, allow 30 min setup."}]},
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hos.business@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"

    fmb_head = principal_for(cur, "fmb@demo.apu.edu.my")
    selection = wf.create_selection(
        cur, request_id, fmb_head.user_id,
        cafeteria_unit_code=ATRIUM, fmb_option_id=1, quantity=40,
    )
    selection_id = selection["id"]

    manager = principal_for(cur, "cafeteria.manager@demo.apu.edu.my")
    wf.approve_selection(cur, selection_id, manager.user_id)

    staff = principal_for(cur, "cafeteria.staff2@demo.apu.edu.my")
    wf.claim_selection(cur, selection_id, staff.user_id)
    wf.mark_selection_ready(cur, selection_id, staff.user_id)
    wf.fulfil_selection(cur, selection_id, staff.user_id, delivery_photo_url="https://example.invalid/delivery/proof-1.jpg")

    assert status_of(cur, request_id) == "completed_approved"
    return request_id


_HOS_HOD_EMAIL_FOR_APPLICANT = {
    "student.computing@demo.apu.edu.my": "hoshod@demo.apu.edu.my",
    "student.computing2@demo.apu.edu.my": "hoshod@demo.apu.edu.my",
    "lecturer.computing@demo.apu.edu.my": "hoshod@demo.apu.edu.my",
    "student.business@demo.apu.edu.my": "hos.business@demo.apu.edu.my",
    "lecturer.business@demo.apu.edu.my": "hos.business@demo.apu.edu.my",
}


def scenario_club_public_event(cur, club_name: str, president_email: str, title: str, category_ids: list[int]) -> int:
    """A club president runs a Public event (club-scope is expressed purely
    via event_visibility - there is no club_id on request)."""
    day = days_out(55)
    request_id = create_proposal(
        cur, president_email,
        eventTitle=title,
        shortIntroduction=f"An event organised by {club_name}.",
        goals=f"Deliver {club_name}'s flagship activity for the semester.",
        benefits="Open participation for all interested students.",
        eventVisibility="Public", registrationMode="Automatic",
        # Below HIGH_PAX_THRESHOLD (config, currently 30) so this routes straight from
        # HOS/HOD to department_review - which is what this scenario asserts.
        totalPax=28, eventCategories=category_ids,
        scheduleRows=[{"date": day, "start": "13:00", "end": "18:00", "venueId": venue("Level 6 Multipurpose Hall")}],
        selectedRequirements=["logistics", "soundLight"],
        requestRows={
            "logistics": [{"item": "logistics:3", "quantity": 60, "date": day,
                            "start": "12:00", "end": "18:30", "venueId": venue("Level 6 Multipurpose Hall")}],
            "soundLight": [{"item": "soundLight:1", "date": day, "start": "12:30",
                             "end": "18:30", "venueId": venue("Level 6 Multipurpose Hall")}],
        },
    )
    wf.submit(cur, request_id)
    hos_hod_email = _HOS_HOD_EMAIL_FOR_APPLICANT[president_email]
    wf.approve(cur, request_id, principal_for(cur, hos_hod_email))
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_club_only_event(cur) -> int:
    """A Club Only-visibility event - approved and published, but only
    discoverable via the 'Club Only' visibility filter."""
    request_id = scenario_club_public_event(
        cur, "APU Photography Club", "student.computing2@demo.apu.edu.my",
        "Members-Only Photowalk Briefing", [5],
    )
    cur.execute("UPDATE request SET event_visibility = 'Club Only' WHERE request_id = %s", (request_id,))
    # "Club Only" is not just a label - it names the clubs whose members may see the event
    # (request_clubs, migration 029), and the read path enforces it.
    cur.execute(
        """INSERT INTO request_clubs (request_id, club_id, club_name)
           SELECT %s, c.club_id, c.club_name FROM clubs c
            WHERE c.club_name = %s AND c.active
            ON CONFLICT DO NOTHING""",
        (request_id, "APU Photography Club"),
    )
    return request_id


def scenario_private_approved_simple(cur) -> int:
    request_id = create_proposal(
        cur, "lecturer.business@demo.apu.edu.my",
        eventTitle="Staff Development Workshop",
        shortIntroduction="Internal workshop on new teaching tools.",
        goals="Upskill teaching staff on the new LMS.",
        benefits="Consistent LMS usage across the School.",
        eventVisibility="Private", registrationMode="Automatic",
        totalPax=25,
        scheduleRows=[{"date": days_out(25), "start": "09:00", "end": "12:00", "venueId": venue("Seminar Room 1")}],
        selectedRequirements=["logistics"],
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hos.business@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"
    approve_all_department_tasks(cur, request_id)
    assert status_of(cur, request_id) == "completed_approved"
    return request_id


def scenario_pending_hos_hod_review(cur) -> int:
    request_id = create_proposal(
        cur, "student.business@demo.apu.edu.my",
        eventTitle="Entrepreneurship Pitch Night",
        shortIntroduction="Student startup pitches judged by faculty.",
        goals="Encourage entrepreneurial thinking.",
        benefits="Exposure and feedback for student founders.",
        eventVisibility="Public", registrationMode="Automatic",
        totalPax=70, eventCategories=[1],
        scheduleRows=[{"date": days_out(48), "start": "17:00", "end": "20:00", "venueId": venue("Auditorium")}],
    )
    wf.submit(cur, request_id)
    assert status_of(cur, request_id) == "hos_hod_review"
    return request_id


def scenario_pending_fmb_review(cur) -> int:
    request_id = create_proposal(
        cur, "student.computing@demo.apu.edu.my",
        eventTitle="Freshers' Welcome Carnival",
        shortIntroduction="Large welcome event for new intake students.",
        goals="Orient new students to campus life.",
        benefits="Stronger sense of belonging from day one.",
        eventVisibility="Public", registrationMode="Automatic",
        totalPax=400, eventCategories=[6],
        scheduleRows=[{"date": days_out(70), "start": "10:00", "end": "16:00", "venueId": venue("Sports Complex")}],
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "fmb_review"
    return request_id


def scenario_pending_cfo_review(cur) -> int:
    request_id = create_proposal(
        cur, "student.computing2@demo.apu.edu.my",
        eventTitle="Tech Innovation Expo",
        shortIntroduction="Showcase of final-year student tech projects.",
        goals="Give final-year students an industry-facing showcase.",
        benefits="Industry exposure and recruiter interest.",
        eventVisibility="Public", registrationMode="Automatic",
        totalPax=250, eventCategories=[1, 2],
        scheduleRows=[{"date": days_out(65), "start": "09:00", "end": "17:00", "venueId": venue("Atrium Concourse")}],
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "cfo_review"
    return request_id


def scenario_pending_department_review(cur) -> int:
    """Left with a live, unresolved logistics task - useful for exercising
    the department inbox / task board with real pending work."""
    day = days_out(52)
    request_id = create_proposal(
        cur, "student.computing@demo.apu.edu.my",
        eventTitle="Inter-School Debate Championship",
        shortIntroduction="Annual debate competition between Schools.",
        goals="Promote critical thinking and public speaking.",
        benefits="Inter-school engagement and school pride.",
        eventVisibility="Public", registrationMode="Manual",
        totalPax=90, eventCategories=[1],
        scheduleRows=[{"date": day, "start": "10:00", "end": "17:00", "venueId": venue("Seminar Room 1")}],
        selectedRequirements=["logistics", "transportation"],
        requestRows={
            "logistics": [{"item": "logistics:1", "quantity": 20, "date": day,
                            "start": "08:00", "end": "17:30", "venueId": venue("Seminar Room 1")}],
            "transportation": [{"type": "transportation:2", "requestedPax": 18,
                                 "pickup": "School of Business", "dropoff": "Debate Hall",
                                 "date": day, "start": "08:30"}],
        },
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    wf.approve(cur, request_id, principal_for(cur, "fmb@demo.apu.edu.my"))
    wf.approve(cur, request_id, principal_for(cur, "cfo@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"
    # Resolve transportation only, leave logistics pending.
    transport_head = principal_for(cur, "transport.manager@demo.apu.edu.my")
    wf.approve_task(cur, request_id, "transportation", transport_head.user_id)
    return request_id


def scenario_resubmission_required(cur) -> int:
    """HOS/HOD sends the whole proposal back with a comment; left sitting
    at resubmission_required for the applicant to act on."""
    request_id = create_proposal(
        cur, "student.business@demo.apu.edu.my",
        eventTitle="Alumni Homecoming Dinner",
        shortIntroduction="Formal dinner reconnecting alumni with the School.",
        goals="Strengthen alumni relationships.",
        benefits="Potential donor and mentorship pipeline.",
        eventVisibility="Private", registrationMode="Manual",
        totalPax=120, eventCategories=[4],
        scheduleRows=[{"date": days_out(75), "start": "18:30", "end": "22:00", "venueId": venue("Grand Hall")}],
    )
    wf.submit(cur, request_id)
    wf.send_back(
        cur, request_id, principal_for(cur, "hos.business@demo.apu.edu.my"),
        comment="Please add a budget breakdown for the venue hire before resubmitting.",
    )
    assert status_of(cur, request_id) == "resubmission_required"
    return request_id


def scenario_rejected(cur) -> int:
    request_id = create_proposal(
        cur, "student.computing@demo.apu.edu.my",
        eventTitle="Off-Campus Beach Party",
        shortIntroduction="Unofficial off-campus social gathering.",
        goals="Informal student social event.",
        benefits="Student morale.",
        eventVisibility="Public", registrationMode="Automatic",
        totalPax=200, eventCategories=[6],
        scheduleRows=[{"date": days_out(38), "start": "11:00", "end": "20:00",
                       # Deliberately outside the university: free text is the correct shape
                       # here, and locationKind is what tells the form to read it that way.
                       "locationKind": "outside", "location": "Port Dickson Beach Resort"}],
    )
    wf.submit(cur, request_id)
    wf.reject(
        cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"),
        reason="Off-campus events without an approved venue partner are outside policy.",
    )
    assert status_of(cur, request_id) == "completed_rejected"
    return request_id


def scenario_cancelled(cur) -> int:
    request_id = create_proposal(
        cur, "lecturer.computing@demo.apu.edu.my",
        eventTitle="Guest Lecture Series: Distributed Systems",
        shortIntroduction="External speaker series, later cancelled by the organiser.",
        goals="Expose students to industry practitioners.",
        benefits="Real-world perspective on distributed systems.",
        eventVisibility="Public", registrationMode="Automatic",
        # Below HIGH_PAX_THRESHOLD (config, currently 30) so this routes straight from
        # HOS/HOD to department_review - which is what this scenario asserts.
        totalPax=24, eventCategories=[1],
        scheduleRows=[{"date": days_out(90), "start": "14:00", "end": "16:00", "venueId": venue("Lecture Theatre 3")}],
    )
    wf.submit(cur, request_id)
    wf.approve(cur, request_id, principal_for(cur, "hoshod@demo.apu.edu.my"))
    assert status_of(cur, request_id) == "department_review"
    principal = principal_for(cur, "lecturer.computing@demo.apu.edu.my")
    wf.cancel(cur, request_id, principal)
    assert status_of(cur, request_id) == "cancelled"
    return request_id


def scenario_draft_only(cur) -> int:
    """A draft never enters the workflow - exercises 'my drafts' with a
    realistic, mostly-filled-in proposal rather than an empty shell."""
    principal = principal_for(cur, "student.computing2@demo.apu.edu.my")
    applicant = proposals.load_applicant(cur, principal.user_id)
    payload = make_payload(
        eventTitle="Sustainability Awareness Week (Draft)",
        shortIntroduction="Draft proposal, not yet submitted.",
        eventVisibility="Public", totalPax=100,
        scheduleRows=[{"date": days_out(80), "start": "09:00", "end": "17:00", "venueId": venue("Campus Green")}],
    )
    return proposals.create(cur, applicant, payload, draft=True)


# --- Registrations on published events -------------------------------------
def seed_registrations(cur, auto_event_id: int, manual_event_id: int) -> None:
    for email in ("student.computing@demo.apu.edu.my", "student.computing2@demo.apu.edu.my",
                  "student.business@demo.apu.edu.my", "lecturer.computing@demo.apu.edu.my"):
        register_for(cur, auto_event_id, email)
    register_for(cur, manual_event_id, "student.computing@demo.apu.edu.my",
                 manual=True, reason="I'm on the organising committee for a related club.")
    register_for(cur, manual_event_id, "student.business@demo.apu.edu.my",
                 manual=True, reason="Interested in the debate topics this year.")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config.validate()
    init_pool()

    created: list[tuple[str, int]] = []
    with transaction() as cur:
        # Every scenario below submits venueId references, so the catalogue has to
        # be loaded before the first one runs.
        load_venues(cur)
        created.append(("public/low-pax/approved", scenario_low_pax_public_approved(cur)))
        created.append(("public/high-pax/fmb+cfo/approved", scenario_high_pax_public_approved(cur)))
        created.append(("public/hoshod-self-skip/approved", scenario_hoshod_self_review_skip_approved(cur)))
        created.append(("private/cfo-self-skip/approved", scenario_cfo_self_review_skip_private_approved(cur)))
        created.append(("private/funding-only/auto-approved", scenario_funding_only_auto_completes(cur)))
        fmb_event_id = scenario_fmb_order_fulfilled_public(cur)
        created.append(("public/fmb-order-fulfilled/approved", fmb_event_id))

        created.append(("club-public/coding-society/approved", scenario_club_public_event(
            cur, "APU Coding Society", "student.computing@demo.apu.edu.my",
            "Annual Hackathon Kickoff", [2, 5],
        )))
        created.append(("club-public/business-leaders/approved", scenario_club_public_event(
            cur, "Business Leaders Circle", "student.business@demo.apu.edu.my",
            "Case Competition Finals", [1, 5],
        )))
        created.append(("club-only/photography-club/approved", scenario_club_only_event(cur)))

        created.append(("private/approved", scenario_private_approved_simple(cur)))

        pending_dept_id = scenario_pending_department_review(cur)
        created.append(("public/pending/hos-hod-review", scenario_pending_hos_hod_review(cur)))
        created.append(("public/pending/fmb-review", scenario_pending_fmb_review(cur)))
        created.append(("public/pending/cfo-review", scenario_pending_cfo_review(cur)))
        created.append(("public/pending/department-review", pending_dept_id))
        created.append(("private/resubmission-required", scenario_resubmission_required(cur)))

        created.append(("public/rejected", scenario_rejected(cur)))
        created.append(("public/cancelled", scenario_cancelled(cur)))
        created.append(("public/draft", scenario_draft_only(cur)))

        seed_registrations(cur, auto_event_id=created[0][1], manual_event_id=pending_dept_id)

        log.info("seed_events.done", extra={"request_count": len(created)})

    for label, request_id in created:
        print(f"  {label:45s} request_id={request_id}")
    print(f"\n{len(created)} requests created.")


if __name__ == "__main__":
    main()
