"""Photography Services — the delivery-pipeline dashboard.

The only department that accumulates work **after** the event. Every
forward-looking panel shows a shoot as done — the event happened, the calendar
is clear — while the actual deliverable has not shipped. That backlog is
invisible everywhere else in the application, so it is the hero here.

A funnel and not a timeline: A/V's question is *when within the day*, so it gets
a timeline. Photography's question is *how far along*, and progression through
stages is what a funnel is for. The two departments look alike in the schema and
need different instruments.
"""
from __future__ import annotations

from typing import Any

from ..metrics import capacity, people, risk, sla
from ..scope import Scope, status_for
from .base import FMT_COUNT, FMT_DAYS, FMT_HOURS, FMT_PERCENT, drill, hero, kpi, panel, series, table, widget
from .department import spec


@widget("pho_delivery_backlog")
def delivery_backlog(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    result = risk.delivery_backlog(cur, scope, department)
    return hero(
        label="Post-event delivery backlog",
        value=result["count"],
        fmt=FMT_COUNT,
        caption=(
            f"median age {result['medianAgeDays']:.0f} days · oldest {result['oldestAgeDays']:.0f}"
            if result["medianAgeDays"] is not None
            else "nothing outstanding after its event date"
        ),
        target={"max": 3, "label": "target <= 3 shoots, median age <= 7 days"},
        status="critical" if result["count"] > 3 else ("warning" if result["count"] else "good"),
        definition="Shoots whose event date has passed and whose row assignment is not complete",
        empty="No shoot is outstanding after its event date.",
        drill_to=drill("/app/ongoing/requests", requestKind=department.requirement, phase="post-event"),
    )


@widget("pho_delivery_backlog_kpi")
def delivery_backlog_kpi(cur, scope: Scope) -> dict[str, Any]:
    """The hero's figure as a tile, for the mobile ordering — where the alerts
    rail comes first and the hero is one card among several."""
    department = spec(scope)
    result = risk.delivery_backlog(cur, scope, department)
    return kpi(
        label="Undelivered backlog",
        value=result["count"],
        fmt=FMT_COUNT,
        secondary=f"median {result['medianAgeDays']:.0f}d" if result["medianAgeDays"] is not None else None,
        status="critical" if result["count"] > 3 else ("warning" if result["count"] else "good"),
        definition="Shoots past their event date with work still open",
        drill_to=drill("/app/ongoing/requests", requestKind=department.requirement, phase="post-event"),
    )


@widget("pho_coverage_gap")
def coverage_gap(cur, scope: Scope) -> dict[str, Any]:
    """With two photographers, the third simultaneous shoot on any day is simply
    not happening, and the gap is knowable now."""
    department = spec(scope)
    window = scope.config.risk_window_days(scope.unit_code)
    rows = capacity.collision_rows(cur, scope, department, horizon=window)
    unassigned = [r for r in rows if r["assignees"] == 0]
    staff = capacity.active_staff_count(cur, scope)
    over = [r for r in rows if staff and r["overlap"] > staff]
    return kpi(
        label=f"Coverage gap · next {window} days",
        value=len(unassigned),
        fmt=FMT_COUNT,
        secondary=f"{len(over)} beyond the {staff}-person roster" if over else None,
        caption=f"first {unassigned[0]['date']}" if unassigned else "every forward shoot has a photographer",
        target={"max": 0, "label": "target 0"},
        status="critical" if unassigned else "good",
        definition="Forward shoots with zero assignees inside the risk window",
        drill_to=drill("#panel-pho_shoot_calendar"),
    )


@widget("pho_turnaround")
def turnaround(cur, scope: Scope) -> dict[str, Any]:
    """Event date to completion — distinct from M11, which starts at task
    creation and so mixes the wait *before* the event into the delivery figure.
    This is the number the requester experiences."""
    department = spec(scope)
    result = risk.post_event_turnaround(cur, scope, department)
    return kpi(
        label="Turnaround",
        value=result["median"],
        fmt=FMT_DAYS,
        secondary=f"p90 {result['p90']:.0f}d" if result["p90"] is not None else None,
        caption=f"{result['sample']} shoots delivered in period",
        target={"max": 7, "label": "target <= 7 days"},
        status=status_for(result["median"], warn=7, critical=14),
        definition="Event date → completion, not task creation → completion",
        drill_to=drill("#panel-pho_turnaround_distribution"),
    )


@widget("pho_double_booked")
def double_booked(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    conflicts = people.double_booked(cur, scope, department)
    return kpi(
        label="Double-booked photographer",
        value=len(conflicts),
        fmt=FMT_COUNT,
        caption="unlimited assignees per row means nothing stops an over-assignment",
        target={"max": 0, "label": "target 0"},
        status="critical" if conflicts else "good",
        definition="One person holding two rows with overlapping windows",
        drill_to=drill("#panel-pho_photographer_load"),
    )


@widget("pho_roster_resilience")
def roster_resilience(cur, scope: Scope) -> dict[str, Any]:
    """A structural fact worth a permanent tile rather than an occasional alert:
    it changes how every other number on the page should be read."""
    result = risk.single_point_of_failure(cur, scope)
    loss = result["lossPerAbsence"]
    return kpi(
        label="Roster resilience",
        value=result["staff"],
        fmt=FMT_COUNT,
        secondary=f"one absence removes {loss:.0%} of capacity" if loss else None,
        caption="informational — no action from this tile",
        target={"min": 3, "label": "target >= 3 staff"},
        status="critical" if result["isSpof"] else ("warning" if result["isFragile"] else "good"),
        definition="M73 — active staff in the lane",
    )


@widget("pho_pipeline")
def pipeline(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — five stages, each with a count and a median age badge.

    The department's whole state on one line, including the stage no other
    department has. "Shot but not delivered" is where the real backlog lives.
    """
    department = spec(scope)
    stages = risk.photography_pipeline(cur, scope, department)
    return panel(
        title="Assignment-to-delivery pipeline",
        subtitle="Requested → Approved → Assigned → Shot → Delivered",
        chart="funnel",
        data={"stages": stages},
        table_view=table(
            [
                {"key": "stage", "label": "Stage", "format": "text"},
                {"key": "value", "label": "Shoots", "format": FMT_COUNT},
                {"key": "share", "label": "Of requested", "format": FMT_PERCENT},
                {"key": "medianAgeDays", "label": "Median age (d)", "format": FMT_DAYS},
            ],
            stages,
        ),
        caption="The gap between Shot and Delivered is the backlog no forward-looking panel can show.",
        empty="No shoots have been requested in this period.",
        filters=["period", "service", "photographer"],
        drill_to=drill("/app/ongoing/requests", requestKind=department.requirement),
        signature=True,
        mobile="stacked-bars",
    )


@widget("pho_shoot_calendar")
def shoot_calendar(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    staff = capacity.active_staff_count(cur, scope)
    rows = capacity.collision_rows(cur, scope, department, horizon=14)
    lanes: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        lanes.setdefault(row["date"], []).append(row)
    return panel(
        title="Shoot coverage calendar",
        subtitle=f"Next 14 days · ceiling at {staff} active photographers",
        chart="timeline-chart",
        data={
            "lanes": [
                {
                    "key": day,
                    "label": day,
                    "peak": max(item["overlap"] for item in items),
                    "breached": bool(staff and max(item["overlap"] for item in items) > staff),
                    "bars": items,
                }
                for day, items in sorted(lanes.items())
            ],
            "ceiling": staff,
        },
        axes={"x": {"type": "time", "label": "Hour of day"}, "y": {"type": "category", "label": "Date"}},
        annotations=[{"type": "threshold", "value": staff, "label": "photographer ceiling"}] if staff else [],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "start", "label": "From", "format": "time"},
                {"key": "end", "label": "To", "format": "time"},
                {"key": "label", "label": "Service", "format": "text"},
                {"key": "location", "label": "Location", "format": "text"},
                {"key": "assignees", "label": "Assigned", "format": FMT_COUNT},
            ],
            rows,
        ),
        caption="Shoots with no assignee carry a status ring and an icon — never colour alone.",
        empty="No shoots are booked in the next 14 days.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement),
        mobile="time-list",
    )


@widget("pho_turnaround_distribution")
def turnaround_distribution(cur, scope: Scope) -> dict[str, Any]:
    """A distribution and not a mean: one shoot sitting at 40 days is the story,
    and a mean of 9 hides it."""
    department = spec(scope)
    points = risk.turnaround_distribution(cur, scope, department)
    summary = risk.post_event_turnaround(cur, scope, department)
    p90 = summary["p90"]
    return panel(
        title="Turnaround distribution",
        subtitle="Days from event date to completion",
        chart="dot-plot",
        series_list=[
            series(
                "shoots",
                "Delivered shoots",
                1,
                [
                    {
                        "x": p["x"],
                        "requestId": p["requestId"],
                        "label": p["eventTitle"] if p90 and p["x"] and p["x"] > p90 else None,
                    }
                    for p in points
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Days", "format": FMT_DAYS}},
        annotations=[
            {"type": "reference", "axis": "x", "value": summary["median"], "label": "median"},
            {"type": "reference", "axis": "x", "value": p90, "label": "p90"},
        ],
        table_view=table(
            [
                {"key": "eventTitle", "label": "Event", "format": "text"},
                {"key": "x", "label": "Days to deliver", "format": FMT_DAYS},
            ],
            points,
        ),
        caption="Shoots beyond p90 are direct-labelled — those are the ones a mean would hide.",
        empty="No shoots have been delivered in this period.",
        drill_to=drill("/app/history/requests", requestKind=department.requirement),
        mobile="ranked-list",
    )


@widget("pho_photographer_load")
def photographer_load(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    staff = people.assignments_per_staff(cur, scope, department)
    balance = people.workload_balance(staff)
    conflicts = people.double_booked(cur, scope, department)
    return panel(
        title="Photographer load & conflicts",
        subtitle="Assignments per photographer this period",
        chart="dot-plot",
        series_list=[
            series("staff", "Photographers", 1, [{"x": s["value"], "label": s["name"], "userId": s["userId"]} for s in staff])
        ],
        axes={"x": {"type": "linear", "label": "Assignments", "format": FMT_COUNT}},
        annotations=(
            [{"type": "reference", "axis": "x", "value": balance["median"], "label": "median"}]
            if balance["median"]
            else []
        ),
        data={"conflicts": conflicts},
        table_view=table(
            [
                {"key": "name", "label": "Photographer", "format": "text"},
                {"key": "value", "label": "Assignments", "format": FMT_COUNT},
                {"key": "completed", "label": "Completed", "format": FMT_COUNT},
                {"key": "medianHours", "label": "Median handling (h)", "format": FMT_HOURS},
            ],
            staff,
        ),
        caption=(
            "With two staff a Gini coefficient is not meaningful and is suppressed; the raw counts and the "
            "conflict list carry it."
            if balance["giniSuppressed"]
            else None
        ),
        empty="This unit has no active photographer assignments in the period.",
        mobile="ranked-list",
    )


@widget("pho_lane_time")
def lane_time(cur, scope: Scope) -> dict[str, Any]:
    """**Four segments, not three.** The extra segment — post-event turnaround —
    is the whole point of this department, and it makes the bar non-comparable
    with the other five, which the caption states rather than leaving to be
    discovered.
    """
    department = spec(scope)
    rows = sla.lane_time_breakdown(cur, scope)
    turnaround_median = risk.post_event_turnaround(cur, scope, department)["median"] or 0.0
    # Execution here is split: the wait until the event happens, then the
    # turnaround after it. The post-event median is a period figure rather than
    # a per-week one, so it is applied uniformly and labelled as such.
    enriched = []
    for row in rows:
        post = min(turnaround_median * 24.0, row["execution"])
        enriched.append({**row, "preEvent": max(0.0, row["execution"] - post), "postEvent": post})
    return panel(
        title="Where the lane time goes",
        subtitle="Median hours per week: decision, assignment lag, pre-event wait, post-event turnaround",
        chart="stacked-bar",
        series_list=[
            series("decision", "Decision", 1, [{"x": r["x"], "y": r["decision"]} for r in enriched]),
            series("assignment", "Assignment lag", 2, [{"x": r["x"], "y": r["assignment"]} for r in enriched]),
            series("preEvent", "Pre-event wait", 3, [{"x": r["x"], "y": r["preEvent"]} for r in enriched]),
            series("postEvent", "Post-event turnaround", 4, [{"x": r["x"], "y": r["postEvent"]} for r in enriched]),
        ],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Hours", "format": FMT_HOURS}},
        table_view=table(
            [
                {"key": "x", "label": "Week", "format": "date"},
                {"key": "decision", "label": "Decision (h)", "format": FMT_HOURS},
                {"key": "assignment", "label": "Assignment lag (h)", "format": FMT_HOURS},
                {"key": "preEvent", "label": "Pre-event (h)", "format": FMT_HOURS},
                {"key": "postEvent", "label": "Post-event (h)", "format": FMT_HOURS},
            ],
            enriched,
        ),
        caption="Four segments rather than three, so this bar is not comparable with the other five departments.",
        empty="No shoots have completed a full cycle in this period yet.",
        drill_to=drill("/app/history/requests", requestKind=department.requirement),
    )
