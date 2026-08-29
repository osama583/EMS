"""Family H - risk and anomaly (M70-M78).

Every metric here is a **count of things to act on**, each drilling to a
filtered list. A risk figure that cannot be turned into a work list is a mood,
not a metric, and does not belong on a dashboard.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num
from .common import NON_COMMITTED_STATUSES, DepartmentSpec


# The Risk List's threshold, per department, in the unit its own deadline is
# naturally read in - minutes for a same-day dispatch job (transport, campus
# tour, photo/video), hours for food (prep starts shortly before serve, never
# ten hours out), a day for the rest, where the crew has genuine multi-day
# lead time. A single days-wide window (see at_risk_tasks above) would flag
# every transport job as "at risk" always, since none of them are ever booked
# more than a day out to begin with - the threshold has to match how far in
# advance the work is normally staffed, not one global number.
_RISK_THRESHOLD_MINUTES: dict[str, int] = {
    "transport_services": 10,
    "student_services": 10,
    "photography_services": 10,
    "food_beverage_services": 4 * 60,
}
_DEFAULT_RISK_THRESHOLD_MINUTES = 24 * 60  # everyone else: one day


def risk_list(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """The plain job-by-job Risk List: work that has not started (no row/task
    assignee yet) whose own deadline - date plus the department's start-time
    column - is inside this department's threshold, or has already passed.

    Deliberately independent of at_risk_tasks()/M70 above: that one metric is
    a fixed days-wide window shared by every department, which is exactly the
    wrong shape once thresholds are department-specific and mixed-unit
    (minutes for same-day dispatch work, hours for food, a day for the rest -
    see _RISK_THRESHOLD_MINUTES). Any hero/count reusing this list's `count`
    stays in sync with what the list itself shows by construction, since both
    read the same rows.
    """
    minutes = _RISK_THRESHOLD_MINUTES.get(spec.unit_code, _DEFAULT_RISK_THRESHOLD_MINUTES)
    # student_services (campus tours) carries no time-of-day column at all - the
    # date itself, at midnight, is the only deadline the schema has.
    deadline_expr = f'(d."date" + d.{spec.start_column})' if spec.start_column else 'd."date"::timestamp'
    rows = fetch_all(
        cur,
        f"""
        SELECT t.request_task_id AS task_id,
               t.request_id AS request_id,
               t.status AS status,
               min({deadline_expr}) AS deadline,
               r.event_title AS event_title,
               r.request_code AS request_code
          FROM request_task t
          JOIN request r ON r.request_id = t.request_id
          JOIN {spec.table} d ON d.request_id = t.request_id
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status NOT IN ('completed', 'cancelled')
           AND r.status <> ALL(%(non_committed)s)
           AND NOT EXISTS (
                SELECT 1 FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s AND ra.row_id = d.{spec.pk}
           )
           AND NOT EXISTS (
                SELECT 1 FROM task_assignment ta WHERE ta.request_task_id = t.request_task_id
           )
      GROUP BY 1, 2, 3, 5, 6
        HAVING min({deadline_expr}) <= now() + (%(minutes)s || ' minutes')::interval
      ORDER BY 4
         LIMIT 25
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), requirement=spec.requirement, minutes=minutes),
    )
    now = dt.datetime.now(r["deadline"].tzinfo) if rows and rows[0]["deadline"].tzinfo else dt.datetime.now()
    return {
        "count": len(rows),
        "thresholdMinutes": minutes,
        "items": [
            {
                "taskId": r["task_id"],
                "requestId": r["request_id"],
                "requestCode": r["request_code"],
                "status": r["status"],
                "date": r["deadline"].isoformat(),
                "eventTitle": r["event_title"],
                "late": r["deadline"] < now,
            }
            for r in rows
        ],
    }


def single_point_of_failure(cur, scope: Scope, *, unit: str | None = None) -> dict[str, Any]:
    """M73 - active staff in the lane, and what one absence costs.

    A structural fact worth a permanent tile rather than an occasional alert: on
    a two-person roster it reads 50%, and that changes how every other number on
    the page should be read.
    """
    row = fetch_one(
        cur,
        """
        SELECT count(*) AS n
          FROM user_unit_roles uur
          JOIN users u ON u.user_id = uur.user_id
         WHERE uur.unit_code = %(target_unit)s
           AND uur.role_code = 'staff'
           AND uur.is_active
           AND u.is_active AND u.archived_at IS NULL
        """,
        scope.params(target_unit=unit or scope.unit_code),
    )
    staff = int(row["n"]) if row else 0
    return {
        "staff": staff,
        "lossPerAbsence": round(1.0 / staff, 4) if staff else None,
        "isSpof": staff <= 1,
        "isFragile": staff <= 2,
    }


def cancellation_window_exposure(cur, scope: Scope) -> int:
    """M74 - approved proposals now inside the cancellation lock that still
    carry open tasks. They can no longer be cancelled, so the work must be
    delivered whether or not the department has capacity for it."""
    lock_days = scope.config.integer("CANCELLATION_DEADLINE_DAYS", 3)
    row = fetch_one(
        cur,
        """
        SELECT count(DISTINCT r.request_id) AS n
          FROM request r
          JOIN request_task t ON t.request_id = r.request_id
          JOIN LATERAL (
                SELECT min("date") AS first_date FROM event_schedule
                 WHERE request_id = r.request_id
          ) es ON TRUE
         WHERE r.status = 'completed_approved'
           AND t.assigned_unit_code = %(unit)s
           AND t.status NOT IN ('completed', 'cancelled')
           AND es.first_date >= %(today)s
           AND es.first_date <= %(today)s::date + %(lock_days)s
        """,
        scope.params(lock_days=lock_days),
    )
    return int(row["n"]) if row else 0


def stranded_at_gate(cur, scope: Scope, *, unit: str | None = None) -> list[dict[str, Any]]:
    """M78 - proposals at `hos_hod_review` with no actor who qualifies.

    `_skips_hos_hod()` does not skip when the applicant belongs to any unit, but
    `is_hos_hod_for_applicant()` additionally requires a School - so a proposal
    from someone whose only unit is a service department is stranded with no
    error message. This is a detector, not a fix; the fix is a one-line change to
    `_skips_hos_hod()` and belongs in its own change.

    Returns counts and unit labels only. The proposals themselves are not
    readable by most of the roles this surfaces on, and naming them would be the
    leak R7 exists to prevent.
    """
    rows = fetch_all(
        cur,
        """
        SELECT coalesce(u.description, 'No unit') AS unit_label,
               applicant_unit.unit_code AS unit_code,
               count(*) AS n,
               min(r.submitted_at) AS oldest
          FROM request r
          LEFT JOIN LATERAL (
                SELECT min(uur.unit_code) AS unit_code
                  FROM user_unit_roles uur
                 WHERE uur.user_id = r.applicant_user_id AND uur.is_active
          ) applicant_unit ON TRUE
          LEFT JOIN unit u ON u.code = applicant_unit.unit_code
         WHERE r.status = 'hos_hod_review'
           AND NOT EXISTS (
                SELECT 1
                  FROM user_unit_roles applicant_role
                  JOIN user_unit_roles head ON head.unit_code = applicant_role.unit_code
                 WHERE applicant_role.user_id = r.applicant_user_id
                   AND applicant_role.is_active
                   AND head.role_code = 'head-of-school'
                   AND head.is_active
           )
           AND (%(unit_filter)s IS NULL OR applicant_unit.unit_code = %(unit_filter)s)
      GROUP BY 1, 2
      ORDER BY 3 DESC
        """,
        scope.params(unit_filter=unit),
    )
    return [
        {
            "unitCode": r["unit_code"],
            "unitLabel": r["unit_label"],
            "count": int(r["n"]),
            "oldest": r["oldest"].isoformat() if r["oldest"] else None,
        }
        for r in rows
    ]


def orders_at_risk(cur, scope: Scope, *, outlets: list[str] | None = None) -> dict[str, Any]:
    """Live orders whose serve time falls inside the risk window, split by state.

    The split names the action: `pending` needs the manager to accept, `approved`
    needs someone to claim, `preparing` needs a nudge. One combined count would
    say something is wrong without saying who to call.
    """
    targets = outlets if outlets is not None else list(scope.outlets)
    hours = scope.config.risk_window_days() * 24
    rows = fetch_all(
        cur,
        """
        SELECT s.status AS status, count(*) AS n, min(f."date" + f.serve_time) AS soonest
          FROM request_fmb_selection s
          JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
         WHERE s.status IN ('pending', 'approved', 'preparing')
           AND r.status NOT IN ('cancelled', 'completed_rejected', 'draft')
           AND (f."date" + f.serve_time) >= now()
           AND (f."date" + f.serve_time) < now() + (%(hours)s || ' hours')::interval
           AND (%(all_outlets)s OR s.unit_code = ANY(%(target_outlets)s))
      GROUP BY 1
        """,
        scope.params(hours=hours, all_outlets=not targets, target_outlets=targets or [""]),
    )
    by_status = {r["status"]: int(r["n"]) for r in rows}
    soonest = min((r["soonest"] for r in rows if r["soonest"]), default=None)
    return {
        "count": sum(by_status.values()),
        "pending": by_status.get("pending", 0),
        "approved": by_status.get("approved", 0),
        "preparing": by_status.get("preparing", 0),
        "windowHours": hours,
        "soonest": soonest.isoformat() if soonest else None,
    }


def delivery_backlog(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """Work outstanding after its event date.

    Photography's only invisible backlog: forward-looking panels show it as
    done - the event happened, the calendar is clear - while the deliverable has
    not shipped. No other department accumulates work *after* the event.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY %(today)s::date - d."date") AS median_age,
               max(%(today)s::date - d."date") AS oldest_age
          FROM {spec.table} d
          JOIN request_task t ON t.request_id = d.request_id
          JOIN request r ON r.request_id = d.request_id
         WHERE t.assigned_unit_code = %(unit)s
           AND r.status <> ALL(%(non_committed)s)
           AND d."date" < %(today)s
           AND EXISTS (
                SELECT 1 FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s
                   AND ra.row_id = d.{spec.pk}
                   AND ra.status <> 'completed'
           )
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), requirement=spec.requirement),
    )
    return {
        "count": int(row["n"]) if row else 0,
        "medianAgeDays": num(row["median_age"]) if row else None,
        "oldestAgeDays": num(row["oldest_age"]) if row else None,
    }


def post_event_turnaround(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """Event date to completion, in days.

    Distinct from M11, which starts at task creation and so folds the wait
    *before* the event into the delivery figure. This is the number the requester
    experiences.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS p90,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM (ra.resolved_at::date - d."date")) / 86400.0 AS days
              FROM request_row_assignment ra
              JOIN {spec.table} d ON d.{spec.pk} = ra.row_id
              JOIN request_task t ON t.request_task_id = ra.request_task_id
             WHERE ra.requirement_name = %(requirement)s
               AND ra.status = 'completed'
               AND ra.resolved_at IS NOT NULL
               AND t.assigned_unit_code = %(unit)s
               AND ra.resolved_at >= %(from)s AND ra.resolved_at < %(to)s
          ) s
         WHERE days >= 0
        """,
        scope.params(requirement=spec.requirement),
    )
    return {
        "median": num(row["p50"]) if row else None,
        "p90": num(row["p90"]) if row else None,
        "sample": int(row["n"]) if row else 0,
    }


def turnaround_distribution(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    rows = fetch_all(
        cur,
        f"""
        SELECT ra.row_id AS row_id,
               d.request_id AS request_id,
               r.event_title AS event_title,
               EXTRACT(epoch FROM (ra.resolved_at::date - d."date")) / 86400.0 AS days
          FROM request_row_assignment ra
          JOIN {spec.table} d ON d.{spec.pk} = ra.row_id
          JOIN request r ON r.request_id = d.request_id
          JOIN request_task t ON t.request_task_id = ra.request_task_id
         WHERE ra.requirement_name = %(requirement)s
           AND ra.status = 'completed'
           AND ra.resolved_at IS NOT NULL
           AND t.assigned_unit_code = %(unit)s
           AND ra.resolved_at >= %(from)s AND ra.resolved_at < %(to)s
      ORDER BY 4 DESC
        """,
        scope.params(requirement=spec.requirement),
    )
    return [
        {
            "rowId": r["row_id"],
            "requestId": r["request_id"],
            "eventTitle": r["event_title"],
            "x": num(r["days"]),
        }
        for r in rows
        if num(r["days"]) is not None and num(r["days"]) >= 0
    ]


def photography_pipeline(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """The five-stage funnel: requested, approved, assigned, shot, delivered.

    "Shot but not delivered" is the stage no other department has, and it is
    where the real backlog lives - which is why a funnel rather than a timeline.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS requested,
               count(*) FILTER (WHERE t.status IN ('approved', 'preparing', 'completed')) AS approved,
               count(*) FILTER (WHERE assigned.n > 0) AS assigned,
               count(*) FILTER (WHERE assigned.n > 0 AND d."date" < %(today)s) AS shot,
               count(*) FILTER (WHERE assigned.completed > 0) AS delivered,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY CASE WHEN d."date" < %(today)s THEN %(today)s::date - d."date" END
               ) AS median_age
          FROM {spec.table} d
          JOIN request_task t ON t.request_id = d.request_id
          JOIN request r ON r.request_id = d.request_id
          LEFT JOIN LATERAL (
                SELECT count(*) AS n, count(*) FILTER (WHERE ra.status = 'completed') AS completed
                  FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s AND ra.row_id = d.{spec.pk}
          ) assigned ON TRUE
         WHERE t.assigned_unit_code = %(unit)s
           AND r.status <> ALL(%(non_committed)s)
           AND coalesce(r.submitted_at, r.created_at) >= %(from)s
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), requirement=spec.requirement),
    )
    if not row:
        return []
    stages = [
        ("Requested", int(row["requested"])),
        ("Approved", int(row["approved"])),
        ("Assigned", int(row["assigned"])),
        ("Shot", int(row["shot"])),
        ("Delivered", int(row["delivered"])),
    ]
    first = stages[0][1] or 0
    return [
        {
            "stage": name,
            "value": value,
            "share": (value / first) if first else None,
            "medianAgeDays": num(row["median_age"]) if name == "Shot" else None,
        }
        for name, value in stages
    ]
