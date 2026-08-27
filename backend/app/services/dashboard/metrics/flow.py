"""Family A - flow and throughput (M01-M08).

How much work arrives at a lane, how much leaves, and what is left standing.
Every function takes an open cursor and a Scope; none of them reads a request
parameter, and all of them return plain Python numbers ready to serialise.
"""
from __future__ import annotations

from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import iso_week_start


def intake_volume(cur, scope: Scope, *, previous: bool = False) -> int:
    """M01 - tasks entering the lane in the period. The denominator for Family C."""
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.created_at >= %({lo})s AND t.created_at < %({hi})s
        """,
        scope.base_params,
    )
    return int(row["n"]) if row else 0


def clearance_rate(cur, scope: Scope, *, previous: bool = False) -> float | None:
    """M02 - resolved divided by created in the same window.

    Above 1.0 the backlog is shrinking. This is the honest one-number answer to
    "are we keeping up", which a raw approvals count cannot give: 40 approvals
    against 60 arrivals is a lane falling behind, and both cards read "40".
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE t.resolved_at >= %({lo})s AND t.resolved_at < %({hi})s) AS resolved,
               count(*) FILTER (WHERE t.created_at  >= %({lo})s AND t.created_at  < %({hi})s) AS created
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
        """,
        scope.base_params,
    )
    return ratio(row["resolved"], row["created"]) if row else None


def open_backlog(cur, scope: Scope) -> int:
    """M03 - open tasks in the lane, at this instant. Not period-scoped: a
    backlog is a state, not a flow."""
    row = fetch_one(
        cur,
        """
        SELECT count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status NOT IN ('completed', 'cancelled')
        """,
        scope.base_params,
    )
    return int(row["n"]) if row else 0


_AGE_BUCKETS = ("0-1d", "1-3d", "3-7d", "7-14d", ">14d")


def backlog_age_profile(cur, scope: Scope) -> list[dict[str, Any]]:
    """M04 - open tasks bucketed by age.

    A distribution rather than a mean, deliberately: a mean of four days hides
    the one task that has been sitting for thirty, and that task is the whole
    reason to look.
    """
    rows = fetch_all(
        cur,
        """
        SELECT CASE
                 WHEN now() - t.created_at < interval '1 day'   THEN '0-1d'
                 WHEN now() - t.created_at < interval '3 days'  THEN '1-3d'
                 WHEN now() - t.created_at < interval '7 days'  THEN '3-7d'
                 WHEN now() - t.created_at < interval '14 days' THEN '7-14d'
                 ELSE '>14d'
               END AS bucket,
               count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status NOT IN ('completed', 'cancelled')
      GROUP BY 1
        """,
        scope.base_params,
    )
    found = {row["bucket"]: int(row["n"]) for row in rows}
    # Every bucket is emitted even at zero: an age profile with the middle
    # missing reads as a gap in the data rather than a gap in the backlog.
    return [{"bucket": b, "value": found.get(b, 0)} for b in _AGE_BUCKETS]


def throughput_by_week(cur, scope: Scope, weeks: int | None = None) -> list[dict[str, Any]]:
    """M05 - tasks reaching `completed` per ISO week."""
    weeks = weeks or scope.config.trend_weeks()
    rows = fetch_all(
        cur,
        f"""
        SELECT {iso_week_start('t.resolved_at')} AS week, count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status = 'completed'
           AND t.resolved_at >= (date_trunc('week', %(today)s::date) - (%(weeks)s || ' weeks')::interval)
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(weeks=weeks),
    )
    return [{"x": row["week"].isoformat(), "y": int(row["n"])} for row in rows]


def work_in_progress(cur, scope: Scope) -> int:
    """M06 - accepted and being worked, distinct from M03's untouched pending."""
    row = fetch_one(
        cur,
        """
        SELECT count(*) AS n
          FROM request_task t
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status IN ('approved', 'preparing')
        """,
        scope.base_params,
    )
    return int(row["n"]) if row else 0


def stage_transit_volume(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M07 - proposals entering each workflow status in the period.

    `request_filter` narrows to a school's applicants or a gate; it is composed
    from module constants only, never from a request parameter (rule R2).
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT h.new_status AS status, count(DISTINCT h.request_id) AS n
          FROM workflow_history h
          JOIN request r ON r.request_id = h.request_id
         WHERE h.created_at >= %(from)s AND h.created_at < %(to)s
           AND h.new_status IS NOT NULL
           {request_filter}
      GROUP BY 1
      ORDER BY 2 DESC
        """,
        scope.params(**(extra or {})),
    )
    return [{"status": row["status"], "value": int(row["n"])} for row in rows]


def order_volume(cur, scope: Scope, *, previous: bool = False) -> int:
    """M08 - cafeteria orders created for the caller's outlets in the period.

    Reads `created_at` directly now that migration 018 added it; rows predating
    the migration carry the backfilled approximation, which the widget labels.
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n
          FROM request_fmb_selection sel
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND sel.created_at >= %({lo})s AND sel.created_at < %({hi})s
        """,
        scope.base_params,
    )
    return int(row["n"]) if row else 0


def order_volume_by_week(cur, scope: Scope, weeks: int | None = None) -> list[dict[str, Any]]:
    weeks = weeks or scope.config.trend_weeks()
    rows = fetch_all(
        cur,
        f"""
        SELECT {iso_week_start('sel.created_at')} AS week,
               count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY sel.quantity) AS median_qty
          FROM request_fmb_selection sel
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND sel.created_at >= (date_trunc('week', %(today)s::date) - (%(weeks)s || ' weeks')::interval)
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(weeks=weeks),
    )
    return [
        {"x": row["week"].isoformat(), "y": int(row["n"]), "medianQuantity": num(row["median_qty"])}
        for row in rows
    ]
