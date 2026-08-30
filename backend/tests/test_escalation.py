"""Escalation: urgency bands, task deadline shapes, and overdue marking.

The pure decision functions are tested directly (no database): they are where
the policy actually lives, and a wrong boundary here is the difference between
an approver being chased a day late and not at all.

The database-backed parts run inside a transaction that is ROLLED BACK, so the
suite never leaves overdue proposals or flagged tasks behind in the dev data.
"""
from __future__ import annotations

import datetime as dt

import psycopg2.extras
import pytest

from app.db import get_connection
from app.services.dashboard.metrics.common import DEPARTMENT_SPEC
from app.services.workflow import escalation


# --- Bands ------------------------------------------------------------------

@pytest.mark.parametrize(
    "days,expected",
    [
        (365, "normal"),
        (8, "normal"),
        (7, "warning"),   # inclusive: exactly on the threshold is already amber
        (3, "warning"),
        (2, "urgent"),    # inclusive here too
        (1, "urgent"),
        (0, "urgent"),    # the event is today and nobody has decided
        (-1, "overdue"),
        (-30, "overdue"),
    ],
)
def test_band_boundaries_are_inclusive(days, expected):
    assert escalation.tier_for(days, 7, 2) == expected


def test_a_proposal_with_no_schedule_has_no_urgency():
    """A draft with no dates yet cannot be late for anything."""
    assert escalation.tier_for(None, 7, 2) == "normal"


def test_overdue_wins_over_urgent():
    """Both tests match a small number of days, so order matters: an event that
    has already happened must never be reported as merely urgent."""
    assert escalation.tier_for(-1, 7, 2) == "overdue"


# --- Task deadline shapes ---------------------------------------------------

def test_every_department_maps_to_a_known_shape():
    shapes = {code: escalation.deadline_shape(spec) for code, spec in DEPARTMENT_SPEC.items()}
    assert shapes == {
        "a_v_services": "window",
        "logistics_and_facilities": "window",
        "photography_services": "window",
        "transport_services": "start_only",
        "food_beverage_services": "moment",
        "student_services": "all_day",
    }


def test_a_window_task_is_judged_on_its_end_time():
    """Work booked 09:00-17:00 is not late at 09:06 - only past 17:00."""
    spec = DEPARTMENT_SPEC["a_v_services"]
    assert spec.end_column in escalation._deadline_expression(spec)
    assert spec.start_column not in escalation._deadline_expression(spec)


def test_a_transport_task_is_judged_on_its_moving_time():
    """There is no end column to be late for; the driver must simply move."""
    spec = DEPARTMENT_SPEC["transport_services"]
    assert "moving_time" in escalation._deadline_expression(spec)


def test_an_all_day_task_is_due_at_the_end_of_its_day():
    """Campus Tour has no time column at all, so anything earlier than the end
    of the day would invent a deadline the requester never gave."""
    spec = DEPARTMENT_SPEC["student_services"]
    assert "1 day" in escalation._deadline_expression(spec)


# --- Actionability ----------------------------------------------------------

TODAY = dt.date(2026, 8, 30)


@pytest.mark.parametrize(
    "last_event_date,actionable",
    [
        (dt.date(2026, 8, 29), False),  # event finished yesterday
        (dt.date(2026, 8, 30), True),   # last day, still running
        (dt.date(2026, 9, 1), True),    # multi-day event, mid-run
        (None, True),                   # undated, never auto-retired
    ],
)
def test_a_late_task_stays_workable_until_its_event_ends(last_event_date, actionable):
    """A day-one task on a three-day event can still be completed on day three -
    retiring it at a fixed 'one day late' would take the work away while the
    event it belongs to is still happening."""
    assert escalation.task_is_actionable(last_event_date, TODAY) is actionable


# --- Database-backed --------------------------------------------------------

@pytest.fixture
def cur():
    """A cursor whose work is always rolled back."""
    with get_connection() as conn:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cursor
        finally:
            conn.rollback()


def test_pending_proposals_only_returns_undecided_ones(cur):
    for proposal in escalation.pending_proposals(cur):
        assert proposal["status"] in escalation.ESCALATABLE_STAGES


def test_every_pending_proposal_gets_a_band(cur):
    for proposal in escalation.pending_proposals(cur):
        assert proposal["tier"] in {"normal", "warning", "urgent", "overdue"}


def test_a_dry_run_changes_nothing(cur):
    before = _snapshot(cur)
    escalation.run(cur, dry_run=True)
    assert _snapshot(cur) == before


def test_overdue_marking_names_the_stage_that_held_it(cur):
    overdue = [p for p in escalation.pending_proposals(cur) if p["tier"] == "overdue"]
    if not overdue:
        pytest.skip("no overdue proposals in this dataset")
    proposal = overdue[0]
    status = escalation.mark_proposal_overdue(cur, proposal)
    assert status == escalation.OVERDUE_STATUS[proposal["status"]]


def test_overdue_at_department_review_names_only_the_departments_still_pending(cur):
    """A department that responded on time must not be listed alongside the one
    that stalled - that would record a failure against people who did their job."""
    overdue = [
        p for p in escalation.pending_proposals(cur)
        if p["tier"] == "overdue" and p["status"] == "department_review"
    ]
    if not overdue:
        pytest.skip("no overdue department-review proposals in this dataset")

    proposal = overdue[0]
    pending = escalation.pending_department_labels(cur, proposal["request_id"])
    cur.execute(
        """SELECT DISTINCT assigned_unit_code AS unit FROM request_task
            WHERE request_id = %s AND stage_code = 'department_review'
              AND status IN ('completed', 'cancelled') AND assigned_unit_code IS NOT NULL""",
        (proposal["request_id"],),
    )
    settled = {
        DEPARTMENT_SPEC[r["unit"]].label
        for r in cur.fetchall()
        if r["unit"] in DEPARTMENT_SPEC
    }
    assert settled.isdisjoint(pending)


def test_marking_a_task_overdue_leaves_its_status_alone(cur):
    """is_overdue is a fact about the work, not a stage in its lifecycle: a task
    that is later completed must still read as completed AND late."""
    tasks = escalation.overdue_open_tasks(cur)
    if not tasks:
        pytest.skip("no late tasks in this dataset")

    task = tasks[0]
    before = task["status"]
    escalation.mark_task_overdue(cur, task)
    cur.execute(
        "SELECT status, is_overdue FROM request_task WHERE request_task_id = %s",
        (task["request_task_id"],),
    )
    row = cur.fetchone()
    assert row["status"] == before
    assert row["is_overdue"] is True


def test_marking_a_task_overdue_twice_is_a_no_op(cur):
    tasks = escalation.overdue_open_tasks(cur)
    if not tasks:
        pytest.skip("no late tasks in this dataset")
    task = tasks[0]
    assert escalation.mark_task_overdue(cur, task) is True
    task["is_overdue"] = True
    assert escalation.mark_task_overdue(cur, task) is False


def _snapshot(cur) -> tuple:
    cur.execute("SELECT count(*) AS c FROM request WHERE status LIKE 'overdue%'")
    overdue = cur.fetchone()["c"]
    cur.execute("SELECT count(*) AS c FROM request_task WHERE is_overdue")
    flagged = cur.fetchone()["c"]
    cur.execute("SELECT count(*) AS c FROM proposal_escalation_sent")
    ledger = cur.fetchone()["c"]
    return (overdue, flagged, ledger)
