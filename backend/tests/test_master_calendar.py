"""Master event calendar tests that need no database.

Same rationale as test_dashboard.py: these check the properties that decide who
sees WHAT, which is exactly the class of bug that fails silently and is worst
when it fails. A fake cursor stands in for psycopg2 so the visibility rules can
be driven directly, one tier at a time, without seeding a database.

The rules under test (app/api/events.py):
  * only department_review and completed_approved reach the calendar, so a
    cancelled or rejected proposal disappears from it with no extra bookkeeping
  * Public/Internal  -> full detail
  * Club Only        -> full detail for a member; a redacted placeholder for
                        everyone else, carrying dates but no identifying field
  * Private          -> never returned as a row in any form, only counted
  * CFO / F&B head   -> bypass all of the above
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.api.events import (  # noqa: E402
    _MASTER_CALENDAR_STATUSES,
    _MASTER_OPEN_TIERS,
    _decorate_master,
    _redact_for_viewer,
    _sees_all_events,
)
from app.security.principal import Principal  # noqa: E402
from app.services.workflow.constants import (  # noqa: E402
    CANCELLED,
    COMPLETED_APPROVED,
    COMPLETED_REJECTED,
    DEPARTMENT_REVIEW,
    FMB_UNIT_CODE,
    HOS_HOD_REVIEW,
)


class FakeCursor:
    """Returns fixed child rows for the decorate step; records nothing else."""

    def __init__(self, schedule=None, categories=None, clubs=None):
        self._schedule = schedule if schedule is not None else [
            {"date": "2026-09-10", "start_time": "09:00:00", "end_time": "11:00:00", "location": "Lab 4"}
        ]
        self._categories = categories if categories is not None else [{"category_name": "Workshop"}]
        self._clubs = clubs if clubs is not None else []
        self._last = None

    def execute(self, sql, params=None):
        lowered = " ".join(sql.split()).lower()
        if "from event_schedule" in lowered:
            self._last = self._schedule
        elif "request_categories" in lowered:
            self._last = self._categories
        elif "request_clubs" in lowered:
            self._last = self._clubs
        else:
            self._last = []

    def fetchall(self):
        return self._last or []

    def fetchone(self):
        rows = self._last or []
        return rows[0] if rows else None


def make_row(visibility="Public", *, status=COMPLETED_APPROVED, is_member=False, row_id="1"):
    return {
        "id": row_id,
        "eventTitle": "Robotics Workshop",
        "shortIntroduction": "Hands-on session.",
        "eventVisibility": visibility,
        "eventFormat": "Physical",
        "schoolDepartment": "School of Computing",
        "organiser": "Aisha Rahman",
        "proposalStatus": status,
        "totalExpectedPax": 40,
        "maxPax": 60,
        "registrationMode": "Automatic",
        "cost": None,
        "eventImageUrl": None,
        "confirmedRegistrationCount": 12,
        "firstDate": "2026-09-10",
        "is_club_member": is_member,
    }


def principal_with(*assignments):
    return Principal(
        user_id=7, full_name="Test", email="t@apu.edu.my", is_active=True, assignments=tuple(assignments)
    )


# --- which statuses reach the calendar at all -------------------------------
def test_only_post_approval_statuses_reach_the_calendar():
    """The gate is 'has reached department_review', which both the normal and the
    high-pax route converge on - so no pax comparison is needed here, and a
    cancellation or rejection drops off with no extra bookkeeping."""
    assert DEPARTMENT_REVIEW in _MASTER_CALENDAR_STATUSES
    assert COMPLETED_APPROVED in _MASTER_CALENDAR_STATUSES
    for excluded in (CANCELLED, COMPLETED_REJECTED, HOS_HOD_REVIEW, "draft", "submitted", "fmb_review", "cfo_review"):
        assert excluded not in _MASTER_CALENDAR_STATUSES, excluded


# --- who bypasses visibility ------------------------------------------------
def test_cfo_and_fnb_head_see_everything():
    assert _sees_all_events(principal_with(("cfo", None))) is True
    assert _sees_all_events(principal_with(("head-of-department", FMB_UNIT_CODE))) is True


@pytest.mark.parametrize(
    "assignments",
    [
        (("student", None),),
        (("lecturer", "school_of_computing"),),
        (("head-of-school", "school_of_computing"),),
        # A head of some OTHER department is not the F&B head.
        (("head-of-department", "transport_services"),),
    ],
)
def test_ordinary_roles_do_not_bypass_visibility(assignments):
    assert _sees_all_events(principal_with(*assignments)) is False


def test_a_guest_has_no_bypass():
    assert _sees_all_events(None) is False


# --- tier by tier -----------------------------------------------------------
@pytest.mark.parametrize("visibility", list(_MASTER_OPEN_TIERS))
def test_public_and_internal_are_shown_in_full(visibility):
    event = _redact_for_viewer(FakeCursor(), make_row(visibility), sees_all=False)
    assert event is not None
    assert event["restricted"] is False
    assert event["eventTitle"] == "Robotics Workshop"
    assert event["schedule"][0]["location"] == "Lab 4"


def test_club_only_is_shown_in_full_to_a_member():
    event = _redact_for_viewer(FakeCursor(), make_row("Club Only", is_member=True), sees_all=False)
    assert event["restricted"] is False
    assert event["eventTitle"] == "Robotics Workshop"


def test_club_only_is_redacted_for_a_non_member():
    event = _redact_for_viewer(FakeCursor(), make_row("Club Only", is_member=False), sees_all=False)
    assert event is not None
    assert event["restricted"] is True
    assert event["restrictedLabel"] == "Restricted Club Event"
    # The date survives so the day still reads as occupied; nothing else does.
    assert event["schedule"] == [{"date": "2026-09-10", "start": "", "end": "", "location": ""}]
    for leaked in ("eventTitle", "organiser", "shortIntroduction", "schoolDepartment", "categories"):
        assert leaked not in event, leaked


def test_private_is_never_returned_as_a_row():
    assert _redact_for_viewer(FakeCursor(), make_row("Private"), sees_all=False) is None


def test_private_is_returned_in_full_to_cfo_and_fnb():
    """Requirement 4: the two higher-authority roles see every tier, private included."""
    event = _redact_for_viewer(FakeCursor(), make_row("Private"), sees_all=True)
    assert event is not None
    assert event["restricted"] is False
    assert event["eventTitle"] == "Robotics Workshop"


def test_club_only_is_full_for_cfo_even_without_membership():
    event = _redact_for_viewer(FakeCursor(), make_row("Club Only", is_member=False), sees_all=True)
    assert event["restricted"] is False


# --- decoration -------------------------------------------------------------
def test_decorate_shapes_the_visible_event():
    cursor = FakeCursor(clubs=[{"club_name": "Robotics Club"}])
    event = _decorate_master(cursor, make_row("Club Only", is_member=True))
    assert event["categories"] == ["Workshop"]
    assert event["clubs"] == ["Robotics Club"]
    assert event["isFree"] is True
    assert event["cost"] is None
    assert event["eventImage"] is None


def test_decorate_converts_cost_and_free_flag():
    row = make_row()
    row["cost"] = 15
    event = _decorate_master(FakeCursor(), row)
    assert event["cost"] == 15.0
    assert event["isFree"] is False


def test_a_multi_session_event_keeps_every_schedule_row():
    cursor = FakeCursor(schedule=[
        {"date": "2026-09-10", "start_time": "09:00:00", "end_time": "11:00:00", "location": "Lab 4"},
        {"date": "2026-09-11", "start_time": "14:00:00", "end_time": "16:00:00", "location": "Lab 5"},
    ])
    event = _decorate_master(cursor, make_row())
    assert [entry["date"] for entry in event["schedule"]] == ["2026-09-10", "2026-09-11"]
    assert event["schedule"][0]["start"] == "09:00"


def test_a_redacted_multi_session_event_discloses_only_its_dates():
    cursor = FakeCursor(schedule=[
        {"date": "2026-09-10", "start_time": "09:00:00", "end_time": "11:00:00", "location": "Lab 4"},
        {"date": "2026-09-11", "start_time": "14:00:00", "end_time": "16:00:00", "location": "Lab 5"},
    ])
    event = _redact_for_viewer(cursor, make_row("Club Only", is_member=False), sees_all=False)
    assert [entry["date"] for entry in event["schedule"]] == ["2026-09-10", "2026-09-11"]
    assert all(entry["location"] == "" and entry["start"] == "" for entry in event["schedule"])


def test_a_department_review_event_is_marked_as_such():
    """The client needs this to flag the event provisional rather than final."""
    event = _redact_for_viewer(FakeCursor(), make_row(status=DEPARTMENT_REVIEW), sees_all=False)
    assert event["proposalStatus"] == DEPARTMENT_REVIEW
