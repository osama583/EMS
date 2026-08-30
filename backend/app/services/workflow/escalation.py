"""Decides what is late: proposals awaiting a decision, and department tasks.

WHY TIME IS THE TRIGGER. Everything in stages.py/tasks.py happens because a
person clicked something. Nothing in this module does. A proposal does not
become urgent because anyone acted - it becomes urgent because the event got
closer while nobody did. That makes this the workflow's counterpart to
services/email/reminders.py, and like that module it is driven by a job
(scripts/process_escalations.py) rather than by a request cycle.

URGENCY IS MEASURED AGAINST THE EVENT, NOT AGAINST THE QUEUE. "How long has
this sat here" is the wrong question: a proposal waiting three weeks for an
event in March is fine, and one waiting two days for an event tomorrow is a
crisis. Every threshold here is therefore days-until-event.

MULTI-DAY EVENTS USE THE FIRST DATE, for both the warnings and the overdue
decision. An event running 3-5 March has already failed on 3 March if it was
never approved; waiting for the 5th to admit that would be dishonest, and would
keep a dead proposal in an approver's inbox for two extra days.

TASK DEADLINES HAVE FOUR SHAPES, because the departments genuinely differ (see
DEPARTMENT_SPEC in services/dashboard/metrics/common.py) and one rule would be
wrong for most of them:

    window     start_time + end_time   A/V, Logistics, Photography
               Judged on the END. Work booked 09:00-17:00 is not late at 09:06;
               it is late if it is not finished by 17:00 (+grace).

    start_only moving_time             Transport
               Judged on STARTING. A driver has to move at the moving time;
               there is no defined finish to be late for.

    moment     serve_time              F&B
               Judged on completion AT that instant. Food for 12:30 is late at
               12:36 whether or not anyone has "started".

    all_day    date only               Campus Tour
               No time column exists, so the only honest deadline is the end of
               that day.

GRACE absorbs the ordinary gap between doing the work and recording it, so a
staff member who finishes at 17:00 and taps Complete at 17:03 is not marked
late by the recording delay alone.
"""
from __future__ import annotations

import datetime as dt
import logging

from ...db import fetch_all, fetch_one
from ..dashboard.metrics.common import DEPARTMENT_SPEC
from .constants import (
    approval_urgent_days,
    approval_urgent_email_days,
    approval_warning_days,
    approval_warning_email_days,
    task_grace_minutes,
)

logger = logging.getLogger(__name__)

# Stage -> the status recorded when that stage let the event date pass.
# department_review collapses to one value because the stage blocks as a unit;
# which departments actually failed is recorded separately (see
# pending_department_labels below), so the ones that answered on time are not
# named alongside the ones that did not.
OVERDUE_STATUS = {
    "hos_hod_review": "overdue_hos_hod",
    "fmb_review": "overdue_fmb",
    "cfo_review": "overdue_cfo",
    "department_review": "overdue_department",
}

# Stages that can go overdue. 'submitted' is deliberately absent: it is a
# transient state the workflow moves out of immediately, not somewhere a
# proposal waits on a person.
ESCALATABLE_STAGES = tuple(OVERDUE_STATUS)

WARNING = "warning"
URGENT = "urgent"
OVERDUE = "overdue"
NORMAL = "normal"


# --- Proposals --------------------------------------------------------------

def first_event_date(cur, request_id: int) -> dt.date | None:
    """The earliest scheduled day. None when a proposal has no schedule yet."""
    row = fetch_one(
        cur,
        'SELECT min("date") AS d FROM event_schedule WHERE request_id = %s',
        (request_id,),
    )
    return row["d"] if row and row["d"] else None


def tier_for(days_until_event: int | None, warning_days: int, urgent_days: int) -> str:
    """Which band a proposal sits in. Order matters - overdue and urgent are
    both "small number of days", so the past-date test has to come first."""
    if days_until_event is None:
        return NORMAL
    if days_until_event < 0:
        return OVERDUE
    if days_until_event <= urgent_days:
        return URGENT
    if days_until_event <= warning_days:
        return WARNING
    return NORMAL


def pending_proposals(cur) -> list[dict]:
    """Every proposal still awaiting a decision, with the days left until its
    event and the band that puts it in.

    One query rather than per-proposal lookups: the job runs over the whole
    table daily, and N+1 here would be N+1 every morning forever.
    """
    warning_days = approval_warning_days(cur)
    urgent_days = approval_urgent_days(cur)

    rows = fetch_all(
        cur,
        """
        SELECT r.request_id,
               r.request_code,
               r.event_title,
               r.status,
               r.applicant_user_id,
               r.applicant_name,
               s.first_date,
               (s.first_date - current_date) AS days_until_event
          FROM request r
          JOIN LATERAL (
                SELECT min("date") AS first_date
                  FROM event_schedule
                 WHERE request_id = r.request_id
               ) s ON TRUE
         WHERE r.status = ANY(%s)
           AND s.first_date IS NOT NULL
         ORDER BY s.first_date ASC
        """,
        (list(ESCALATABLE_STAGES),),
    )

    for row in rows:
        row["tier"] = tier_for(row["days_until_event"], warning_days, urgent_days)
    return rows


def pending_department_labels(cur, request_id: int) -> list[str]:
    """Names of the departments that had NOT responded, for a proposal going
    overdue at department_review.

    Only the ones still pending. A department that approved on time must not
    appear in the status line of a proposal another department stalled - that
    would record a failure against people who did their job.
    """
    rows = fetch_all(
        cur,
        """
        SELECT DISTINCT t.assigned_unit_code AS unit
          FROM request_task t
         WHERE t.request_id = %s
           AND t.stage_code = 'department_review'
           AND t.status NOT IN ('completed', 'cancelled')
           AND t.assigned_unit_code IS NOT NULL
        """,
        (request_id,),
    )
    labels = []
    for row in rows:
        spec = DEPARTMENT_SPEC.get(row["unit"])
        labels.append(spec.label if spec else row["unit"])
    return sorted(labels)


# --- Tasks ------------------------------------------------------------------

# How each department's rows are judged. Derived from DEPARTMENT_SPEC's actual
# columns rather than restated, so a spec that gains an end_time cannot silently
# keep being judged on its start.
def deadline_shape(spec) -> str:
    if spec.start_column and spec.end_column:
        return "window"
    if spec.end_column:
        return "moment"
    if spec.start_column:
        # F&B's serve_time is a moment (be ready BY then); Transport's
        # moving_time is a start (be moving AT then). Both are start-only
        # columns, so the distinction is per-department, not structural.
        return "moment" if spec.unit_code == "food_beverage_services" else "start_only"
    return "all_day"


def _deadline_expression(spec) -> str:
    """SQL for the moment a row is due, as a timestamp.

    all_day has no time column at all, so the honest deadline is the end of the
    day - anything earlier would invent a time the requester never gave.
    """
    shape = deadline_shape(spec)
    if shape == "window":
        return f'(d."date" + d.{spec.end_column})'
    if shape == "moment":
        column = spec.end_column or spec.start_column
        return f'(d."date" + d.{column})'
    if shape == "start_only":
        return f'(d."date" + d.{spec.start_column})'
    return 'd."date"::timestamp + interval \'1 day\''


def overdue_open_tasks(cur) -> list[dict]:
    """Open tasks whose earliest unfinished row is past its deadline + grace.

    THE EARLIEST row, not the last: a task holding a 09:00 setup and an 18:00
    teardown is already late at 09:06, and telling the staff member otherwise
    until 18:06 would hide the thing they can still fix.

    Tasks stay actionable while the event is still running (the caller decides
    that); this only reports which ones have slipped.
    """
    grace = task_grace_minutes(cur)
    results: list[dict] = []

    for unit_code, spec in DEPARTMENT_SPEC.items():
        deadline = _deadline_expression(spec)
        rows = fetch_all(
            cur,
            f"""
            SELECT t.request_task_id,
                   t.request_id,
                   t.status,
                   t.is_overdue,
                   r.request_code,
                   r.event_title,
                   min({deadline}) AS due_at,
                   max(d."date")    AS last_event_date
              FROM request_task t
              JOIN {spec.table} d ON d.request_id = t.request_id
              JOIN request r      ON r.request_id = t.request_id
             WHERE t.assigned_unit_code = %(unit)s
               AND t.status NOT IN ('completed', 'cancelled')
               AND r.status NOT IN ('cancelled', 'draft')
             GROUP BY t.request_task_id, t.request_id, t.status, t.is_overdue,
                      r.request_code, r.event_title
            HAVING min({deadline}) + make_interval(mins => %(grace)s) < now()
            """,
            {"unit": unit_code, "grace": grace},
        )
        for row in rows:
            row["unit_code"] = unit_code
            row["department"] = spec.label
            row["shape"] = deadline_shape(spec)
            results.append(row)

    return results


def task_is_actionable(last_event_date: dt.date | None, today: dt.date) -> bool:
    """A late task stays workable until its event has finished.

    On a three-day event a day-one task can still be completed on day three -
    retiring it at a fixed "one day late" would take the work away from the
    staff while the event it belongs to is still running.
    """
    if last_event_date is None:
        return True
    return last_event_date >= today


# --- Marking (the only functions here that WRITE) ---------------------------

def mark_proposal_overdue(cur, proposal: dict) -> str:
    """Record that a proposal's event date passed with no decision.

    The new status names the STAGE that was holding it, which is the whole
    accountability point: "overdue_cfo" answers "who was this waiting on"
    without a join, in every list, filter and export the app already has.

    Nothing is deleted and no decision is invented. The proposal keeps its
    schedule, its content and its full history; it simply stops pretending to
    be a live approval. Auto-approving here would manufacture a decision nobody
    made - for a CFO budget gate that is a real financial liability - and
    auto-rejecting would blame the applicant for someone else's delay.

    Returns the status written.
    """
    from . import history  # local: history imports constants, which imports this

    stage = proposal["status"]
    new_status = OVERDUE_STATUS[stage]

    note = f"No decision was recorded before the event date ({proposal['first_date']:%d %b %Y})."
    if stage == "department_review":
        pending = pending_department_labels(cur, proposal["request_id"])
        if pending:
            note += " Still awaiting: " + ", ".join(pending) + "."

    cur.execute(
        "UPDATE request SET status = %s, reviewer_comment = %s, updated_at = now() "
        "WHERE request_id = %s",
        (new_status, note, proposal["request_id"]),
    )
    # actor_user_id=None makes history.record() stamp actor_role='system',
    # which is what distinguishes this from a person's decision.
    history.record(
        cur,
        proposal["request_id"],
        action="overdue",
        actor_user_id=None,
        actor_role="system",
        previous_status=stage,
        new_status=new_status,
        comment=note,
    )
    logger.info(
        "escalation.proposal_overdue",
        extra={"request_id": proposal["request_id"], "stage": stage, "status": new_status},
    )
    return new_status


def mark_task_overdue(cur, task: dict) -> bool:
    """Flag a task as late, leaving its status alone.

    is_overdue is a fact about the WORK, not a stage in its lifecycle. A task
    that is still open stays open (and stays actionable while the event runs),
    and one that is later completed stays 'completed' - carrying is_overdue so
    the record keeps both "it was done" and "it was done late". Overwriting
    status here would destroy the first of those.

    Returns True when this call actually changed something.
    """
    if task["is_overdue"]:
        return False
    cur.execute(
        "UPDATE request_task SET is_overdue = TRUE, overdue_at = now() "
        "WHERE request_task_id = %s AND NOT is_overdue",
        (task["request_task_id"],),
    )
    return cur.rowcount > 0


def close_unactionable_tasks(cur, today: dt.date) -> int:
    """Retire late tasks whose event has finished.

    Until the event ends a late task stays open and workable - on a three-day
    event a day-one task can still be completed on day three. Once the event is
    over there is nothing left to do, so the task stops occupying a staff
    member's list and becomes a record instead.
    """
    closed = 0
    for task in overdue_open_tasks(cur):
        if task_is_actionable(task["last_event_date"], today):
            continue
        cur.execute(
            "UPDATE request_task "
            "   SET status = 'cancelled', is_overdue = TRUE, "
            "       overdue_at = COALESCE(overdue_at, now()) "
            " WHERE request_task_id = %s AND status NOT IN ('completed', 'cancelled')",
            (task["request_task_id"],),
        )
        closed += cur.rowcount
    return closed


# --- Cadence ledger ---------------------------------------------------------

def _due_for_email(cur, request_id: int, kind: str, stage: str, every_days: int) -> bool:
    """Whether enough time has passed to (re-)send this kind of chase.

    every_days == 0 means "never email": a way to keep a tier's colour in the
    inbox while switching its mail off, without editing code.

    The ledger is keyed by STAGE as well as kind, so a proposal that moves from
    fmb_review to cfo_review starts the new approver's clock fresh instead of
    inheriting an already-expired one from the person before them.
    """
    if every_days <= 0:
        return False
    row = fetch_one(
        cur,
        "SELECT last_sent_at FROM proposal_escalation_sent "
        " WHERE request_id = %s AND kind = %s AND stage_code = %s",
        (request_id, kind, stage),
    )
    if row is None:
        return True
    return row["last_sent_at"] <= dt.datetime.now() - dt.timedelta(days=every_days)


def _record_email(cur, request_id: int, kind: str, stage: str) -> None:
    """Stamp the ledger. Written BEFORE the send, so a crash mid-run costs one
    missed email rather than a repeated one - the same trade-off
    services/email/reminders.py makes, and for the same reason."""
    cur.execute(
        """
        INSERT INTO proposal_escalation_sent (request_id, kind, stage_code, last_sent_at)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (request_id, kind, stage_code)
        DO UPDATE SET last_sent_at = now()
        """,
        (request_id, kind, stage),
    )


def run(cur, today: dt.date | None = None, *, dry_run: bool = False) -> dict[str, int]:
    """One pass: chase what is late, then retire what can no longer be saved.

    ORDER MATTERS. Warnings and urgent notices go out BEFORE anything is marked
    overdue, otherwise a proposal could be told "decide today" and be marked
    overdue in the same run - two contradictory emails from one job.
    """
    from ..email import dispatch  # local: dispatch imports workflow constants

    today = today or dt.date.today()
    warning_every = approval_warning_email_days(cur)
    urgent_every = approval_urgent_email_days(cur)
    counts = {"warning": 0, "urgent": 0, "overdue": 0, "tasks_flagged": 0, "tasks_closed": 0}

    proposals = pending_proposals(cur)

    # 1. Chase the live ones.
    for proposal in proposals:
        tier = proposal["tier"]
        if tier not in (WARNING, URGENT):
            continue
        every = urgent_every if tier == URGENT else warning_every
        if not _due_for_email(cur, proposal["request_id"], tier, proposal["status"], every):
            continue
        if dry_run:
            counts[tier] += 1
            continue
        _record_email(cur, proposal["request_id"], tier, proposal["status"])
        dispatch.escalation_decision_due(cur, proposal, urgent=(tier == URGENT))
        counts[tier] += 1

    # 2. Retire the ones whose event date has gone.
    for proposal in proposals:
        if proposal["tier"] != OVERDUE:
            continue
        if dry_run:
            counts["overdue"] += 1
            continue
        # Guard against re-notifying a proposal an earlier run already moved.
        if not _due_for_email(cur, proposal["request_id"], OVERDUE, proposal["status"], 1):
            continue
        _record_email(cur, proposal["request_id"], OVERDUE, proposal["status"])
        dispatch.escalation_proposal_overdue(cur, proposal)
        mark_proposal_overdue(cur, proposal)
        counts["overdue"] += 1

    # 3. Tasks: flag what has slipped, retire what the event has outrun.
    for task in overdue_open_tasks(cur):
        if dry_run:
            if not task["is_overdue"]:
                counts["tasks_flagged"] += 1
            continue
        if mark_task_overdue(cur, task):
            counts["tasks_flagged"] += 1

    if not dry_run:
        counts["tasks_closed"] = close_unactionable_tasks(cur, today)

    return counts
