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
                        everyone else, carrying a date but no identifying field
  * Private          -> never returned as a row in any form, only counted
  * CFO / F&B head   -> bypass all of the above

And the SHAPE rules the three-tier split adds, which are a privacy property as
much as a payload one - the grid tier cannot leak a field it never selects:
  * tier 1 (grid)   -> date, time, title, category, provisional. No venue, no
                       organiser, no description, no pax, no cost.
  * tier 2 (day)    -> tier 1 + venue + organiser, for ONE day.
  * a redacted row  -> a date and an unaddressable occurrence id, at every tier.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.api.events import (  # noqa: E402
    _MASTER_CALENDAR_STATUSES,
    _MASTER_OPEN_TIERS,
    _day_occurrence,
    _is_redacted,
    _membership_expr,
    _occurrence_rows,
    _sees_all_events,
    _summary_occurrence,
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


class RecordingCursor:
    """Records the statement and params it was handed; returns fixed rows."""

    def __init__(self, rows=None):
        self._rows = rows or []
        self.sql = ""
        self.params = None

    def execute(self, sql, params=None):
        self.sql = " ".join(sql.split())
        self.params = params

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


def make_row(visibility="Public", *, is_member=False, provisional=False, occurrence_id="11"):
    """One row as _occurrence_rows returns it, before shaping."""
    return {
        "occurrenceId": occurrence_id,
        "eventId": "1",
        "date": "2026-09-10",
        "start": "09:00",
        "end": "11:00",
        "title": "Robotics Workshop",
        "organiser": "Aisha Rahman",
        "venue": "Lab 4",
        "visibility": visibility,
        "provisional": provisional,
        "category": "Workshop",
        "isClubMember": is_member,
    }


def principal_with(*assignments):
    """Principal.assignments is (role_code, unit_code | None) pairs, exactly as stored."""
    return Principal(
        user_id=7, full_name="Test", email="t@apu.edu.my", is_active=True, assignments=tuple(assignments)
    )


# --- which statuses reach the calendar at all -------------------------------
def test_only_post_approval_statuses_reach_the_calendar():
    """The gate is 'has reached department_review', which both the normal and the
    high-pax route converge on - so no pax comparison is needed here, and a
    cancellation or rejection drops off with no extra bookkeeping."""
    assert set(_MASTER_CALENDAR_STATUSES) == {DEPARTMENT_REVIEW, COMPLETED_APPROVED}
    for status in (HOS_HOD_REVIEW, CANCELLED, COMPLETED_REJECTED):
        assert status not in _MASTER_CALENDAR_STATUSES


# --- who bypasses visibility tiering ----------------------------------------
def test_cfo_and_fnb_head_see_everything():
    cfo = principal_with(("cfo", None))
    fnb = principal_with(("head-of-department", FMB_UNIT_CODE))
    assert _sees_all_events(cfo) is True
    assert _sees_all_events(fnb) is True


@pytest.mark.parametrize(
    "assignments",
    [
        (("student", None),),
        (("head-of-school", "soc"),),
        (("lecturer", "soc"),),
    ],
)
def test_ordinary_roles_do_not_bypass_visibility(assignments):
    assert _sees_all_events(principal_with(*assignments)) is False


def test_a_guest_has_no_bypass():
    assert _sees_all_events(None) is False


# --- the tier rules ----------------------------------------------------------
@pytest.mark.parametrize("visibility", _MASTER_OPEN_TIERS)
def test_public_and_internal_are_shown_in_full(visibility):
    occurrence = _summary_occurrence(make_row(visibility))
    assert occurrence["restricted"] is False
    assert occurrence["title"] == "Robotics Workshop"


def test_club_only_is_shown_in_full_to_a_member():
    occurrence = _summary_occurrence(make_row("Club Only", is_member=True))
    assert occurrence["restricted"] is False
    assert occurrence["title"] == "Robotics Workshop"


def test_club_only_is_redacted_for_a_non_member():
    occurrence = _summary_occurrence(make_row("Club Only", is_member=False))
    assert occurrence["restricted"] is True
    # The date survives so the day still reads as occupied. Nothing else does -
    # and with the tiering, that now includes the event id, so a redacted row
    # cannot even be used to ask the detail endpoint about the event.
    assert occurrence["date"] == "2026-09-10"
    assert set(occurrence) == {"occurrenceId", "date", "restricted"}


def test_club_only_is_full_for_cfo_even_without_membership():
    """A full-visibility viewer's membership expression is a literal true, so the
    redaction step never fires for them regardless of actual membership."""
    assert _membership_expr(sees_all=True) == "true"
    assert _is_redacted(make_row("Club Only", is_member=True)) is False


def test_private_never_leaves_the_database_for_an_ordinary_viewer():
    """Private is excluded in SQL rather than filtered out after the fact, so no
    title, organiser or venue is ever read for it in the first place."""
    cursor = RecordingCursor()
    _occurrence_rows(cursor, "2026-09-01", "2026-09-30", principal_with(), "")
    assert "r.event_visibility <> 'Private'" in cursor.sql


def test_private_is_not_excluded_for_cfo_and_fnb():
    cursor = RecordingCursor()
    cfo = principal_with(("cfo", None))
    _occurrence_rows(cursor, "2026-09-01", "2026-09-30", cfo, "")
    assert "r.event_visibility <> 'Private'" not in cursor.sql
    # ...and with no membership subquery to run per row either.
    assert "club_members" not in cursor.sql


# --- what each tier actually ships ------------------------------------------
def test_the_grid_tier_ships_no_venue_no_organiser_and_no_detail():
    """The point of the split: a field the grid never sends is a field the grid
    cannot leak, and a payload it never builds is one it never pays for."""
    occurrence = _summary_occurrence(make_row())
    assert set(occurrence) == {
        "occurrenceId",
        "eventId",
        "date",
        "start",
        "end",
        "title",
        "category",
        "provisional",
        "restricted",
    }


def test_the_day_tier_adds_venue_and_organiser_and_nothing_else():
    occurrence = _day_occurrence(make_row())
    assert occurrence["venue"] == "Lab 4"
    assert occurrence["organiser"] == "Aisha Rahman"
    assert set(occurrence) == set(_summary_occurrence(make_row())) | {"venue", "organiser"}


def test_a_redacted_row_stays_bare_even_at_the_day_tier():
    occurrence = _day_occurrence(make_row("Club Only", is_member=False))
    assert set(occurrence) == {"occurrenceId", "date", "restricted"}


def test_a_department_review_event_is_marked_as_such():
    assert _summary_occurrence(make_row(provisional=True))["provisional"] is True
    assert _summary_occurrence(make_row(provisional=False))["provisional"] is False


# --- the range query does its own filtering ---------------------------------
def test_the_range_query_filters_by_date_status_and_search_server_side():
    cursor = RecordingCursor()
    _occurrence_rows(cursor, "2026-09-01", "2026-09-30", principal_with(), "robot")
    assert 's."date" BETWEEN %(start)s::date AND %(end)s::date' in cursor.sql
    assert "r.status = ANY(%(statuses)s)" in cursor.sql
    # Search is a predicate, not a post-filter: narrowing the calendar narrows
    # the result set rather than the part of it the client chooses to draw.
    assert "occ.title ILIKE %(like)s" in cursor.sql
    assert "occ.venue ILIKE %(like)s" in cursor.sql
    assert cursor.params["like"] == "%robot%"
    assert cursor.params["start"] == "2026-09-01"


def test_a_search_drops_redacted_rows_since_they_cannot_match():
    cursor = RecordingCursor()
    _occurrence_rows(cursor, "2026-09-01", "2026-09-30", principal_with(), "robot")
    assert "occ.\"isClubMember\" OR occ.visibility <> 'Club Only'" in cursor.sql


def test_one_statement_expands_a_multi_day_event_onto_each_of_its_dates():
    """The join IS the expansion - a multi-day event arrives as one row per
    session, so no per-event schedule query is needed to place it on the grid."""
    cursor = RecordingCursor()
    _occurrence_rows(cursor, "2026-09-01", "2026-09-30", principal_with(), "")
    assert "JOIN event_schedule s ON s.request_id = r.request_id" in cursor.sql
    # The N+1 this replaced: no per-row schedule/categories/clubs lookups.
    assert cursor.sql.count("SELECT") <= 4
