"""Family C - quality and rework (M20-M27).

A high send-back rate on a form the department does not control is a signal to
change the *form*, not to work harder. That is the reading this family exists to
make available, and it is why comment depth (M24) and off-catalogue rate (M27)
sit here beside the rate itself rather than in a data-quality appendix.
"""
from __future__ import annotations

from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import DepartmentSpec, iso_week_start


def send_back_rate(cur, scope: Scope, *, previous: bool = False) -> dict[str, Any]:
    """M20 - tasks that ever reached `resubmitted`, over tasks created."""
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT count(DISTINCT t.request_task_id) FILTER (WHERE h.request_task_id IS NOT NULL) AS sent_back,
               count(DISTINCT t.request_task_id) AS total
          FROM request_task t
          LEFT JOIN workflow_history h
                 ON h.request_task_id = t.request_task_id
                AND h.new_status = 'resubmitted'
         WHERE t.assigned_unit_code = %(unit)s
           AND t.created_at >= %({lo})s AND t.created_at < %({hi})s
        """,
        scope.base_params,
    )
    return {
        "rate": ratio(row["sent_back"], row["total"]) if row else None,
        "count": int(row["sent_back"]) if row else 0,
        "sample": int(row["total"]) if row else 0,
    }


def send_backs_by_week(cur, scope: Scope, weeks: int | None = None) -> list[dict[str, Any]]:
    weeks = weeks or scope.config.trend_weeks()
    rows = fetch_all(
        cur,
        f"""
        SELECT {iso_week_start('h.created_at')} AS week, count(*) AS n
          FROM workflow_history h
          JOIN request_task t ON t.request_task_id = h.request_task_id
         WHERE t.assigned_unit_code = %(unit)s
           AND h.new_status = 'resubmitted'
           AND h.created_at >= (date_trunc('week', %(today)s::date) - (%(weeks)s || ' weeks')::interval)
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(weeks=weeks),
    )
    return [{"x": r["week"].isoformat(), "y": int(r["n"])} for r in rows]


def rework_loops(cur, scope: Scope) -> float | None:
    """M21 - mean `resubmitted` transitions per task that had at least one.

    Two lanes can share a 20% send-back rate while one resolves in a single loop
    and the other takes four. The rate says how often; this says how badly.
    """
    row = fetch_one(
        cur,
        """
        SELECT avg(loops) AS mean_loops FROM (
            SELECT count(*) AS loops
              FROM workflow_history h
              JOIN request_task t ON t.request_task_id = h.request_task_id
             WHERE t.assigned_unit_code = %(unit)s
               AND h.new_status = 'resubmitted'
               AND h.created_at >= %(from)s AND h.created_at < %(to)s
          GROUP BY h.request_task_id
        ) s
        """,
        scope.base_params,
    )
    return num(row["mean_loops"]) if row else None


def gate_outcome_mix(cur, scope: Scope, *, stage: str, request_filter: str = "", extra: dict | None = None) -> dict[str, Any]:
    """M22 + M20 at a reviewer stage - approved, rejected, sent back.

    Undefined for the four non-F&B service HODs: `chk_task_status` has no
    `rejected` value for departments, so this must not appear on their
    dashboards, and the profile definitions do not name it there.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE h.action = 'approve') AS approved,
               count(*) FILTER (WHERE h.action = 'reject') AS rejected,
               count(*) FILTER (WHERE h.action = 'resubmit') AS sent_back
          FROM workflow_history h
          JOIN request r ON r.request_id = h.request_id
         WHERE h.previous_status = %(stage)s
           AND h.created_at >= %(from)s AND h.created_at < %(to)s
           {request_filter}
        """,
        scope.params(stage=stage, **(extra or {})),
    )
    approved = int(row["approved"]) if row else 0
    rejected = int(row["rejected"]) if row else 0
    sent_back = int(row["sent_back"]) if row else 0
    total = approved + rejected + sent_back
    return {
        "approved": approved,
        "rejected": rejected,
        "sentBack": sent_back,
        "total": total,
        "approvedShare": ratio(approved, total),
        "rejectedShare": ratio(rejected, total),
        "sentBackShare": ratio(sent_back, total),
    }


def gate_outcomes_by_period(
    cur,
    scope: Scope,
    *,
    stage: str,
    grain: str = "week",
    request_filter: str = "",
    extra: dict | None = None,
) -> list[dict[str, Any]]:
    bucket = "week" if grain == "week" else "month"
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('{bucket}', h.created_at)::date AS bucket,
               count(*) FILTER (WHERE h.action = 'approve')   AS approved,
               count(*) FILTER (WHERE h.action = 'reject')    AS rejected,
               count(*) FILTER (WHERE h.action = 'resubmit')  AS sent_back
          FROM workflow_history h
          JOIN request r ON r.request_id = h.request_id
         WHERE h.previous_status = %(stage)s
           AND h.created_at >= %(from)s AND h.created_at < %(to)s
           {request_filter}
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(stage=stage, **(extra or {})),
    )
    return [
        {
            "x": r["bucket"].isoformat(),
            "approved": int(r["approved"]),
            "rejected": int(r["rejected"]),
            "sentBack": int(r["sent_back"]),
        }
        for r in rows
    ]


def cancellation_rate(cur, scope: Scope) -> dict[str, Any]:
    """M23 - cancelled over submitted, split on whether the cancellation landed
    after department tasks were created. Cancelling after fan-out wastes work
    that was already committed, and the split is what makes the two visible."""
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE r.status = 'cancelled') AS cancelled,
               count(*) FILTER (
                   WHERE r.status = 'cancelled'
                     AND EXISTS (SELECT 1 FROM request_task t WHERE t.request_id = r.request_id)
               ) AS after_fanout,
               count(*) AS submitted
          FROM request r
         WHERE r.submitted_at IS NOT NULL
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
        """,
        scope.base_params,
    )
    return {
        "rate": ratio(row["cancelled"], row["submitted"]) if row else None,
        "afterFanOut": int(row["after_fanout"]) if row else 0,
        "cancelled": int(row["cancelled"]) if row else 0,
        "sample": int(row["submitted"]) if row else 0,
    }


def send_back_comment_depth(cur, scope: Scope) -> dict[str, Any]:
    """M24 - share of send-backs whose comment is under 40 characters.

    The comment is the entire message to the applicant. A one-word comment
    guarantees another loop, which is why this sits beside the rate rather than
    in a report nobody runs. A quality proxy, and labelled as one on the widget.
    """
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE length(coalesce(h.comment, '')) < 40) AS terse,
               count(*) AS total
          FROM workflow_history h
          JOIN request_task t ON t.request_task_id = h.request_task_id
         WHERE t.assigned_unit_code = %(unit)s
           AND h.new_status = 'resubmitted'
           AND h.created_at >= %(from)s AND h.created_at < %(to)s
        """,
        scope.base_params,
    )
    return {
        "terseShare": ratio(row["terse"], row["total"]) if row else None,
        "terse": int(row["terse"]) if row else 0,
        "sample": int(row["total"]) if row else 0,
    }


def order_pushback_rate(cur, scope: Scope, *, outlets_from_scope: bool = True) -> dict[str, Any]:
    """M25 - orders reaching `resubmitted` over orders placed.

    Read from both sides. For F&B it means "my orders get bounced"; for a
    Cafeteria Manager it means "I bounce orders" - the same number, the opposite
    action, and the two dashboards label it accordingly.
    """
    outlet_clause = "sel.unit_code = ANY(%(outlets)s)" if outlets_from_scope else "TRUE"
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE sel.status = 'resubmitted') AS bounced,
               count(*) AS total
          FROM request_fmb_selection sel
         WHERE {outlet_clause}
           AND sel.created_at >= %(from)s AND sel.created_at < %(to)s
        """,
        scope.base_params,
    )
    return {
        "rate": ratio(row["bounced"], row["total"]) if row else None,
        "count": int(row["bounced"]) if row else 0,
        "sample": int(row["total"]) if row else 0,
    }


def pushback_by_outlet(cur, scope: Scope) -> list[dict[str, Any]]:
    """M25 split by outlet, for the F&B side. Names which outlet bounces."""
    rows = fetch_all(
        cur,
        """
        SELECT sel.unit_code AS code,
               coalesce(u.description, u.code) AS label,
               count(*) FILTER (WHERE sel.status = 'resubmitted') AS bounced,
               count(*) AS total
          FROM request_fmb_selection sel
          JOIN unit u ON u.code = sel.unit_code
         WHERE sel.created_at >= %(from)s AND sel.created_at < %(to)s
      GROUP BY 1, 2
      ORDER BY 3 DESC
        """,
        scope.base_params,
    )
    return [
        {
            "code": r["code"],
            "label": r["label"],
            "count": int(r["bounced"]),
            "sample": int(r["total"]),
            "rate": ratio(r["bounced"], r["total"]),
        }
        for r in rows
    ]


def first_pass_yield(cur, scope: Scope) -> float | None:
    """M26 - tasks completed with zero send-backs, over tasks completed."""
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM workflow_history h
                    WHERE h.request_task_id = t.request_task_id
                      AND h.new_status = 'resubmitted'
               )) AS clean,
               count(*) AS total
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status = 'completed'
           AND t.resolved_at >= %(from)s AND t.resolved_at < %(to)s
        """,
        scope.base_params,
    )
    return ratio(row["clean"], row["total"]) if row else None


def off_catalogue_rate(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """M27 - detail rows typed in rather than picked from the catalogue.

    An off-catalogue row has no stock level and no capacity, so it is invisible
    to every forecast on the page. A rising rate means the forecast is quietly
    covering less of the real demand, which is worse than a forecast that is
    obviously wrong.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE d.{spec.option_fk} IS NULL) AS off_catalogue,
               count(*) AS total
          FROM {spec.table} d
          JOIN request r ON r.request_id = d.request_id
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
        """,
        scope.base_params,
    )
    return {
        "rate": ratio(row["off_catalogue"], row["total"]) if row else None,
        "count": int(row["off_catalogue"]) if row else 0,
        "sample": int(row["total"]) if row else 0,
    }
