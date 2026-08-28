"""Family B - SLA and latency (M10-M19).

Every latency here is reported as **median and p90**, never a bare mean. A mean
is dominated by the single item nobody picked up, and that item is the one you
already know about; the p90 is what tells a head whether the tail is one bad
week or the shape of the lane.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import NON_COMMITTED_STATUSES, DepartmentSpec, iso_week_start

# A department whose detail rows carry a start but no end has no "until when"
# in the schema, so punctuality is measured against the start instant plus this
# grace. Five minutes is the tolerance a coach pulling away or a serving window
# opening is actually judged on - anything tighter measures clock-rounding, and
# anything looser stops being "on time".
START_ONLY_GRACE_MINUTES = 5

# The two department-level decisions a head can take on a task. There is no
# 'send_back' action in this codebase - services/workflow/tasks.py writes
# 'resubmit' with new_status='resubmitted' - and a query looking for the former
# silently measures nothing.
DECISION_ACTIONS = ("approve", "resubmit")

# The first-decision timestamp per task, as a lateral join. Shared by M10 and
# M12 so the two cannot disagree about when a decision happened.
_FIRST_DECISION = """
    LEFT JOIN LATERAL (
        SELECT min(h.created_at) AS first_at
          FROM workflow_history h
         WHERE h.request_task_id = t.request_task_id
           AND h.action IN ('approve', 'resubmit')
    ) d ON TRUE
"""


def _pair(row: dict | None, p50_key: str = "p50", p90_key: str = "p90") -> dict[str, Any]:
    return {
        "median": num(row.get(p50_key)) if row else None,
        "p90": num(row.get(p90_key)) if row else None,
        "sample": int(row.get("n") or 0) if row else 0,
    }


def decision_latency(cur, scope: Scope, *, previous: bool = False) -> dict[str, Any]:
    """M10 - task created to its first approve/send-back, in hours.

    The department head's own responsiveness, and the one segment of the lane
    they personally control.
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM d.first_at - t.created_at) / 3600.0 AS hours
              FROM request_task t
              {_FIRST_DECISION}
             WHERE t.assigned_unit_code = %(unit)s
               AND t.created_at >= %({lo})s AND t.created_at < %({hi})s
               AND d.first_at IS NOT NULL
          ) s
        """,
        scope.base_params,
    )
    return _pair(row)


def decision_latency_by_week(cur, scope: Scope, weeks: int | None = None) -> list[dict[str, Any]]:
    weeks = weeks or scope.config.trend_weeks()
    rows = fetch_all(
        cur,
        f"""
        SELECT week,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               count(*) AS n
          FROM (
            SELECT {iso_week_start('t.created_at')} AS week,
                   EXTRACT(epoch FROM d.first_at - t.created_at) / 3600.0 AS hours
              FROM request_task t
              {_FIRST_DECISION}
             WHERE t.assigned_unit_code = %(unit)s
               AND t.created_at >= (date_trunc('week', %(today)s::date) - (%(weeks)s || ' weeks')::interval)
               AND d.first_at IS NOT NULL
          ) s
      GROUP BY week
      ORDER BY week
        """,
        scope.params(weeks=weeks),
    )
    return [{"x": r["week"].isoformat(), "y": num(r["p50"]), "sample": int(r["n"])} for r in rows]


def fulfilment_cycle_time(cur, scope: Scope) -> dict[str, Any]:
    """M11 - created to resolved on completed tasks. End-to-end lane time."""
    row = fetch_one(
        cur,
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM t.resolved_at - t.created_at) / 3600.0 AS hours
              FROM request_task t
             WHERE t.assigned_unit_code = %(unit)s
               AND t.status = 'completed'
               AND t.resolved_at IS NOT NULL
               AND t.resolved_at >= %(from)s AND t.resolved_at < %(to)s
          ) s
        """,
        scope.base_params,
    )
    return _pair(row)


def assignment_lag(cur, scope: Scope) -> dict[str, Any]:
    """M12 - approved to first assignment, in hours.

    Isolates "the head approved but nobody was put on it" from "the staff member
    was slow", which M11 conflates into one number with two different fixes.
    Reads both assignment tables: the five row-assignable requirements write
    request_row_assignment (migration 012), the rest still write task_assignment,
    and counting only one of them undercounts badly.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM a.assigned_at - d.first_at) / 3600.0 AS hours
              FROM request_task t
              {_FIRST_DECISION}
              JOIN LATERAL (
                    SELECT min(assigned_at) AS assigned_at FROM (
                        SELECT ra.assigned_at FROM request_row_assignment ra
                         WHERE ra.request_task_id = t.request_task_id
                        UNION ALL
                        SELECT ta.assigned_at FROM task_assignment ta
                         WHERE ta.request_task_id = t.request_task_id
                    ) both_tables
              ) a ON TRUE
             WHERE t.assigned_unit_code = %(unit)s
               AND t.created_at >= %(from)s AND t.created_at < %(to)s
               AND d.first_at IS NOT NULL
               AND a.assigned_at IS NOT NULL
               AND a.assigned_at >= d.first_at
          ) s
        """,
        scope.base_params,
    )
    return _pair(row)


def execution_time(cur, scope: Scope) -> dict[str, Any]:
    """M13 - first assignment to completion. The staff-side segment."""
    row = fetch_one(
        cur,
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM t.resolved_at - a.assigned_at) / 3600.0 AS hours
              FROM request_task t
              JOIN LATERAL (
                    SELECT min(assigned_at) AS assigned_at FROM (
                        SELECT ra.assigned_at FROM request_row_assignment ra
                         WHERE ra.request_task_id = t.request_task_id
                        UNION ALL
                        SELECT ta.assigned_at FROM task_assignment ta
                         WHERE ta.request_task_id = t.request_task_id
                    ) both_tables
              ) a ON TRUE
             WHERE t.assigned_unit_code = %(unit)s
               AND t.status = 'completed'
               AND t.resolved_at IS NOT NULL
               AND t.resolved_at >= %(from)s AND t.resolved_at < %(to)s
               AND a.assigned_at IS NOT NULL
               AND t.resolved_at >= a.assigned_at
          ) s
        """,
        scope.base_params,
    )
    return _pair(row)


def lane_time_breakdown(cur, scope: Scope, weeks: int | None = None) -> list[dict[str, Any]]:
    """The three-segment weekly bar every department dashboard carries.

    decision (M10) + assignment lag (M12) + execution (M13) = cycle time (M11).
    Deliberately identical across the six departments so a Head of School or the
    CFO comparing two lanes is comparing the same decomposition. Photography
    overrides it with a four-segment variant and says so on the panel.
    """
    weeks = weeks or scope.config.trend_weeks()
    rows = fetch_all(
        cur,
        f"""
        SELECT {iso_week_start('t.created_at')} AS week,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM d.first_at - t.created_at) / 3600.0
               ) AS decision_h,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM a.assigned_at - d.first_at) / 3600.0
               ) AS assign_h,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM t.resolved_at - a.assigned_at) / 3600.0
               ) AS execute_h,
               count(*) AS n
          FROM request_task t
          {_FIRST_DECISION}
          LEFT JOIN LATERAL (
                SELECT min(assigned_at) AS assigned_at FROM (
                    SELECT ra.assigned_at FROM request_row_assignment ra
                     WHERE ra.request_task_id = t.request_task_id
                    UNION ALL
                    SELECT ta.assigned_at FROM task_assignment ta
                     WHERE ta.request_task_id = t.request_task_id
                ) both_tables
          ) a ON TRUE
         WHERE t.assigned_unit_code = %(unit)s
           AND t.created_at >= (date_trunc('week', %(today)s::date) - (%(weeks)s || ' weeks')::interval)
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(weeks=weeks),
    )
    out = []
    for row in rows:
        # A negative segment means the timestamps interleaved (an assignment made
        # before the formal approval, which the workflow permits). Clamped rather
        # than dropped: the week still happened, and a stacked bar cannot render
        # a negative segment without lying about the total.
        out.append(
            {
                "x": row["week"].isoformat(),
                "decision": max(0.0, num(row["decision_h"]) or 0.0),
                "assignment": max(0.0, num(row["assign_h"]) or 0.0),
                "execution": max(0.0, num(row["execute_h"]) or 0.0),
                "sample": int(row["n"]),
            }
        )
    return out


def stage_dwell(cur, scope: Scope, *, status: str | None = None, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M14 - hours between consecutive workflow_history rows for a request,
    attributed to the status being *left*. The input to bottleneck detection."""
    rows = fetch_all(
        cur,
        f"""
        SELECT previous_status AS status,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90,
               count(*) AS n
          FROM (
            SELECT h.previous_status,
                   EXTRACT(epoch FROM (
                       h.created_at - lag(h.created_at) OVER (PARTITION BY h.request_id ORDER BY h.created_at)
                   )) / 3600.0 AS hours
              FROM workflow_history h
              JOIN request r ON r.request_id = h.request_id
             WHERE h.created_at >= %(from)s AND h.created_at < %(to)s
               {request_filter}
          ) s
         WHERE hours IS NOT NULL AND previous_status IS NOT NULL
           {"AND previous_status = %(dwell_status)s" if status else ""}
      GROUP BY 1
      ORDER BY p50 DESC NULLS LAST
        """,
        scope.params(dwell_status=status, **(extra or {})),
    )
    return [
        {"status": r["status"], "median": num(r["p50"]), "p90": num(r["p90"]), "sample": int(r["n"])}
        for r in rows
    ]


def sla_compliance(cur, scope: Scope) -> dict[str, Any]:
    """M15 - share of tasks decided inside the unit's target, with the breach
    count beside it. The count is the actionable half; the rate is the trend."""
    target = scope.config.decision_sla_hours(scope.unit_code)
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE hours <= %(target)s) AS within,
               count(*) AS total
          FROM (
            SELECT EXTRACT(epoch FROM d.first_at - t.created_at) / 3600.0 AS hours
              FROM request_task t
              {_FIRST_DECISION}
             WHERE t.assigned_unit_code = %(unit)s
               AND t.created_at >= %(from)s AND t.created_at < %(to)s
               AND d.first_at IS NOT NULL
          ) s
        """,
        scope.params(target=target),
    )
    total = int(row["total"]) if row else 0
    within = int(row["within"]) if row else 0
    return {
        "rate": ratio(within, total),
        "breaches": total - within,
        "sample": total,
        "targetHours": target,
    }


def preparation_runway(cur, scope: Scope, spec: DepartmentSpec, *, previous: bool = False) -> dict[str, Any]:
    """M16 - task created to the earliest date in the requirement's own detail
    table, in days.

    Separates "we are slow" from "we were given three days". A department can be
    fast on every measure in this family and still fail, and only this metric
    says which of the two is happening.
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS p50,
               percentile_cont(0.1) WITHIN GROUP (ORDER BY days) AS p10,
               count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM (x.first_date - t.created_at::date)) / 86400.0 AS days
              FROM request_task t
              JOIN LATERAL (
                    SELECT min(d."date") AS first_date
                      FROM {spec.table} d
                     WHERE d.request_id = t.request_id
              ) x ON TRUE
             WHERE t.assigned_unit_code = %(unit)s
               AND t.created_at >= %({lo})s AND t.created_at < %({hi})s
               AND x.first_date IS NOT NULL
          ) s
        """,
        scope.base_params,
    )
    return {
        "median": num(row["p50"]) if row else None,
        "p10": num(row["p10"]) if row else None,
        "sample": int(row["n"]) if row else 0,
    }


def lead_time_distribution(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """The runway figure as a distribution, for the panel behind the KPI."""
    rows = fetch_all(
        cur,
        f"""
        SELECT EXTRACT(epoch FROM (x.first_date - t.created_at::date)) / 86400.0 AS days,
               count(*) AS n
          FROM request_task t
          JOIN LATERAL (
                SELECT min(d."date") AS first_date FROM {spec.table} d
                 WHERE d.request_id = t.request_id
          ) x ON TRUE
         WHERE t.assigned_unit_code = %(unit)s
           AND t.created_at >= %(from)s AND t.created_at < %(to)s
           AND x.first_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
        """,
        scope.base_params,
    )
    return [{"x": num(r["days"]), "y": int(r["n"])} for r in rows]


# --- Cafeteria latencies (M17-M19) ---------------------------------------
# These read the migration-018 timestamps. Rows created before that migration
# carry a backfilled approximation derived from request-scoped history, which
# cannot distinguish sibling orders on one proposal - every widget using them
# renders the "approximate for orders before <date>" caption rather than
# presenting the figure as measured.


def task_deadline_sql(spec: DepartmentSpec, alias: str = "d") -> tuple[str, str]:
    """A department's own "done by when", and the sentence that explains it.

    The six departments record time three different ways, so one hardcoded
    deadline column would be wrong for four of them:

    - **A start and an end** (A/V, Logistics, Photography). The commitment runs
      until the end of the booked window, so that is the deadline.
    - **A start only** (Transport's `moving_time`, F&B's `serve_time`). There is
      no "until when" in the schema at all, so the instant itself plus
      `START_ONLY_GRACE_MINUTES` is the deadline - a coach that leaves five
      minutes after its moving time left on time.
    - **Neither** (Student Services; campus tours dropped their time columns).
      The event date is all there is, so the deadline is the end of that day.
      Midnight *at* the date would be the alternative and it would report every
      tour on the books as late, which is a measurement artefact, not a fact
      about the department.

    Returns `(sql_expression, human_basis)`; the second is printed on the tile
    so a head reads what their own number is measured against rather than
    assuming it matches the department next door.
    """
    if spec.end_column:
        return f'({alias}."date" + {alias}.{spec.end_column})', "the end of each booked window"
    if spec.start_column:
        return (
            f'({alias}."date" + {alias}.{spec.start_column} '
            f"+ interval '{START_ONLY_GRACE_MINUTES} minutes')",
            f"{spec.start_column.replace('_', ' ')} plus {START_ONLY_GRACE_MINUTES} min",
        )
    return f'({alias}."date"::timestamp + interval \'1 day\')', "the end of the event day"


def task_punctuality(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """On-time completion - the department twin of M19.

    A task counts once, against the **earliest** commitment among its own detail
    rows: a job holding a 9am room and a 2pm room is late the moment the 9am one
    is missed, and taking the latest would report it on time. This is the same
    `min(deadline)` rule the Risk List ranks by, so the tile and that list
    cannot disagree about which job was late.

    Denominator is tasks *completed* in the period, not tasks created: an open
    job has not failed yet, and counting it as a miss would make the rate fall
    every time the department accepts work.
    """
    deadline_expr, basis = task_deadline_sql(spec)
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE resolved_at <= deadline) AS on_time,
               count(*) AS completed,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM resolved_at - deadline) / 60.0
               ) AS median_minutes
          FROM (
            SELECT t.request_task_id,
                   t.resolved_at AS resolved_at,
                   min({deadline_expr}) AS deadline
              FROM request_task t
              JOIN request r ON r.request_id = t.request_id
              JOIN {spec.table} d ON d.request_id = t.request_id
             WHERE t.assigned_unit_code = %(unit)s
               AND t.status = 'completed'
               AND t.resolved_at IS NOT NULL
               AND t.resolved_at >= %(from)s AND t.resolved_at < %(to)s
               AND r.status <> ALL(%(non_committed)s)
          GROUP BY 1, 2
          ) s
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES)),
    )
    completed = int(row["completed"]) if row else 0
    on_time = int(row["on_time"]) if row else 0
    return {
        "rate": ratio(on_time, completed) if row else None,
        "completed": completed,
        "late": completed - on_time,
        "medianMinutes": num(row["median_minutes"]) if row else None,
        "basis": basis,
    }


def delivery_punctuality(cur, scope: Scope, *, outlet: str | None = None) -> dict[str, Any]:
    """M19 - on-time share plus median minutes early or late.

    On-time means delivered on or before `request_fmb."date" + serve_time`. Food
    that arrives after the session it was ordered for did not happen, whatever
    the order status says.
    """
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE sel.delivered_at <= (f."date" + f.serve_time)) AS on_time,
               count(*) AS delivered,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM sel.delivered_at - (f."date" + f.serve_time)) / 60.0
               ) AS median_minutes
          FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND (%(outlet)s IS NULL OR sel.unit_code = %(outlet)s)
           AND sel.delivered_at IS NOT NULL
           AND sel.delivered_at >= %(from)s AND sel.delivered_at < %(to)s
        """,
        scope.params(outlet=outlet),
    )
    return {
        "rate": ratio(row["on_time"], row["delivered"]) if row else None,
        "delivered": int(row["delivered"]) if row else 0,
        "late": (int(row["delivered"]) - int(row["on_time"])) if row else 0,
        "medianMinutes": num(row["median_minutes"]) if row else None,
    }


# Two lengths of the same caveat. A KPI tile is one column wide and a six-line
# note swamps the number it qualifies, so the tile gets the short form and the
# panel behind it carries the explanation.
_G1_SHORT = "Approximate for orders placed before the lifecycle timestamps were added."
_G1_LONG = (
    "Acceptance and claim times for orders placed before the lifecycle timestamps were added are "
    "derived from request-level history, which cannot tell sibling orders on one proposal apart. "
    "Newer orders are measured directly."
)


def month_floor(day: dt.date) -> dt.date:
    return day.replace(day=1)
