"""Family E - demand and forecast (M40-M47).

M40 is committed work, not a prediction, and it is the more useful of the two.
M41 is a deliberately naive seasonal projection: explainable to a department
head in one sentence, measurable against M40 as reality arrives, and needing no
library the project does not already have. It is always rendered dashed and
labelled projected, never merged into the committed series.
"""
from __future__ import annotations

import datetime as dt
import statistics
from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import NON_COMMITTED_STATUSES, DepartmentSpec, requirement_label

# Weeks of history the naive forecast needs before it will produce a number.
# Below this it renders "insufficient history" rather than a flat line at zero,
# which would read as a confident prediction of nothing.
FORECAST_HISTORY_WEEKS = 8


def forward_demand(cur, scope: Scope, spec: DepartmentSpec, horizon: int | None = None) -> list[dict[str, Any]]:
    """M40 - committed rows per day over the forward horizon."""
    horizon = horizon or scope.config.horizon_days(scope.unit_code)
    quantity = f"sum(a.{spec.quantity_column})" if spec.quantity_column else "0"
    rows = fetch_all(
        cur,
        f"""
        SELECT a."date" AS day, count(*) AS n, {quantity} AS quantity
          FROM {spec.table} a
          JOIN request r ON r.request_id = a.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s
           AND a."date" < %(today)s::date + %(horizon)s
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), horizon=horizon),
    )
    return [
        {"x": r["day"].isoformat(), "y": int(r["n"]), "quantity": num(r["quantity"]) or 0.0}
        for r in rows
    ]


def _daily_history(cur, scope: Scope, spec: DepartmentSpec, weeks: int) -> dict[dt.date, int]:
    rows = fetch_all(
        cur,
        f"""
        SELECT a."date" AS day, count(*) AS n
          FROM {spec.table} a
          JOIN request r ON r.request_id = a.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s::date - (%(weeks)s * 7)
           AND a."date" < %(today)s
      GROUP BY 1
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), weeks=weeks),
    )
    return {r["day"]: int(r["n"]) for r in rows}


def demand_forecast(cur, scope: Scope, spec: DepartmentSpec, *, days: int = 30) -> dict[str, Any]:
    """M41 - trailing same-weekday mean multiplied by a four-week trend factor.

        forecast(d) = mean(demand on same weekday, last 8 weeks) x (1 + trend)
        trend       = (mean last 4 weeks - mean prior 4 weeks) / mean prior 4 weeks

    The p10-p90 band is the observed spread of the same-weekday samples, not a
    parametric interval - with eight observations a normal assumption would be
    decoration. When there is not enough history the function says so and returns
    no points; the widget renders that sentence rather than a flat zero line.
    """
    history = _daily_history(cur, scope, spec, FORECAST_HISTORY_WEEKS)
    if not history:
        return {"available": False, "reason": "No history yet", "weeksAvailable": 0, "points": []}

    span_days = (scope.today - min(history)).days
    weeks_available = max(0, span_days // 7)
    if weeks_available < FORECAST_HISTORY_WEEKS:
        return {
            "available": False,
            "reason": f"Needs {FORECAST_HISTORY_WEEKS} weeks of history - {weeks_available} available",
            "weeksAvailable": weeks_available,
            "points": [],
        }

    def window_mean(start_offset: int, end_offset: int) -> float:
        lo = scope.today - dt.timedelta(days=start_offset)
        hi = scope.today - dt.timedelta(days=end_offset)
        values = [v for d, v in history.items() if hi <= d < lo]
        return statistics.fmean(values) if values else 0.0

    recent = window_mean(28, 0)
    prior = window_mean(56, 28)
    trend = ((recent - prior) / prior) if prior else 0.0
    # A trend factor computed from two four-week means is noisy at these data
    # volumes. Clamped to +/-50% so one quiet fortnight cannot project a
    # department out of existence or double its work.
    trend = max(-0.5, min(0.5, trend))

    by_weekday: dict[int, list[int]] = {}
    for day, count in history.items():
        by_weekday.setdefault(day.weekday(), []).append(count)

    points = []
    for offset in range(days):
        day = scope.today + dt.timedelta(days=offset)
        samples = by_weekday.get(day.weekday(), [])
        if not samples:
            continue
        base = statistics.fmean(samples)
        ordered = sorted(samples)
        points.append(
            {
                "x": day.isoformat(),
                "y": round(base * (1 + trend), 2),
                "low": round(ordered[0] * (1 + trend), 2),
                "high": round(ordered[-1] * (1 + trend), 2),
            }
        )
    return {
        "available": True,
        "trend": round(trend, 4),
        "weeksAvailable": weeks_available,
        "points": points,
        "method": "Same-weekday mean over the last 8 weeks, adjusted by a 4-week trend",
    }


def requirement_mix(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M42 - share of proposals selecting each requirement.

    On a school dashboard this is the school's demand fingerprint; on the CFO's
    it is the institutional one.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT er.requirement_name AS requirement,
               count(DISTINCT ar.request_id) AS n
          FROM application_requirements ar
          JOIN event_requirements er ON er.requirement_id = ar.requirement_id
          JOIN request r ON r.request_id = ar.request_id
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {request_filter}
      GROUP BY 1
      ORDER BY 2 DESC
        """,
        scope.params(**(extra or {})),
    )
    total = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n FROM request r
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {request_filter}
        """,
        scope.params(**(extra or {})),
    )
    denominator = int(total["n"]) if total else 0
    return [
        {
            "requirement": r["requirement"],
            "label": requirement_label(r["requirement"]),
            "value": int(r["n"]),
            "share": ratio(r["n"], denominator),
        }
        for r in rows
    ]


def mean_requirements_per_proposal(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> dict[str, Any]:
    row = fetch_one(
        cur,
        f"""
        SELECT avg(cnt) AS mean_count, count(*) AS n FROM (
            SELECT count(ar.requirement_id) AS cnt
              FROM request r
              LEFT JOIN application_requirements ar ON ar.request_id = r.request_id
             WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
               {request_filter}
          GROUP BY r.request_id
        ) s
        """,
        scope.params(**(extra or {})),
    )
    return {"mean": num(row["mean_count"]) if row else None, "sample": int(row["n"]) if row else 0}


def pipeline_conversion(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M43 - proposals entering each stage against those leaving it approved."""
    rows = fetch_all(
        cur,
        f"""
        SELECT h.new_status AS stage,
               count(DISTINCT h.request_id) AS entered
          FROM workflow_history h
          JOIN request r ON r.request_id = h.request_id
         WHERE h.created_at >= %(from)s AND h.created_at < %(to)s
           AND h.new_status IN ('submitted', 'hos_hod_review', 'fmb_review',
                                'cfo_review', 'department_review', 'completed_approved')
           {request_filter}
      GROUP BY 1
        """,
        scope.params(**(extra or {})),
    )
    order = ["submitted", "hos_hod_review", "fmb_review", "cfo_review", "department_review", "completed_approved"]
    found = {r["stage"]: int(r["entered"]) for r in rows}
    return [{"stage": stage, "value": found.get(stage, 0)} for stage in order]


def event_calendar_density(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M45 - approved events per day. The institutional load curve every
    department's demand ultimately derives from."""
    rows = fetch_all(
        cur,
        f"""
        SELECT es."date" AS day, count(DISTINCT es.request_id) AS n, sum(r.total_pax) AS pax
          FROM event_schedule es
          JOIN request r ON r.request_id = es.request_id
         WHERE r.status = 'completed_approved'
           AND es."date" >= %(today)s
           AND es."date" < %(today)s::date + %(horizon)s
           {request_filter}
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(**(extra or {})),
    )
    return [
        {"x": r["day"].isoformat(), "y": int(r["n"]), "pax": num(r["pax"]) or 0.0}
        for r in rows
    ]


def registration_conversion(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M46 - registrations against capacity for the caller's approved events.

    Counts only. Attendee identity is out of scope for every dashboard
    (`backend/docs/security.md` records the attendee list as organiser-only),
    and the divergence between the two series is the whole signal anyway.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('month', coalesce(r.submitted_at, r.created_at))::date AS bucket,
               sum(r.max_pax) AS capacity,
               count(reg.event_registration_id) FILTER (WHERE reg.status <> 'cancelled') AS registered
          FROM request r
          LEFT JOIN event_registration reg ON reg.request_id = r.request_id
         WHERE r.status = 'completed_approved'
           AND coalesce(r.submitted_at, r.created_at) >= %(from)s
           AND coalesce(r.submitted_at, r.created_at) < %(to)s
           {request_filter}
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(**(extra or {})),
    )
    return [
        {
            "x": r["bucket"].isoformat(),
            "capacity": num(r["capacity"]) or 0.0,
            "registered": int(r["registered"]),
            "fill": ratio(r["registered"], r["capacity"]),
        }
        for r in rows
    ]


def lead_time_distribution(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> list[dict[str, Any]]:
    """M47 - submission to the earliest event date, in days.

    Falling lead time is the leading indicator of every downstream SLA breach in
    Family B, which is why it belongs on a dashboard rather than in a report.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT width_bucket(days, 0, 90, 9) AS bucket,
               min(days) AS low, max(days) AS high, count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM (es.first_date - r.submitted_at::date)) / 86400.0 AS days
              FROM request r
              JOIN LATERAL (
                    SELECT min("date") AS first_date FROM event_schedule
                     WHERE request_id = r.request_id
              ) es ON TRUE
             WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
               AND es.first_date IS NOT NULL
               {request_filter}
          ) s
         WHERE days >= 0
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(**(extra or {})),
    )
    return [
        {"bucket": int(r["bucket"]), "low": num(r["low"]), "high": num(r["high"]), "value": int(r["n"])}
        for r in rows
    ]
