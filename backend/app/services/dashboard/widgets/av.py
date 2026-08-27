"""A/V Services — the collision-timeline dashboard.

A/V has no stock. `sound_light_options` carries a `technical_description` and
nothing else; `available_quantity` was deliberately dropped because the Sound &
Light manager decides allocation at review time. So there is nothing to forecast
a stock-out for, and the only failure mode that matters is two rigs needing the
same crew at the same hour.

That is why the signature panel is a timeline and Logistics gets a heatmap: for
consumable stock the constraint is the day total, because an item issued in the
morning is not back by the afternoon. Here the constraint is the hour, because a
crew that finishes at noon is free at one. The chart form follows the physics.
"""
from __future__ import annotations

from typing import Any

from ..metrics import capacity, demand
from ..scope import Scope, status_for
from .base import FMT_COUNT, FMT_HOURS, FMT_RATIO, drill, hero, kpi, panel, series, table, widget
from .department import spec


@widget("av_crew_coverage")
def crew_coverage(cur, scope: Scope) -> dict[str, Any]:
    """Hero — the busiest forthcoming day's technician-hour demand as a fraction
    of what the roster can physically deliver.

    Above 1.0 the day cannot be delivered by this roster no matter how well it
    is scheduled. It is the only number that distinguishes "busy" from
    "impossible", and it is the number that justifies a hire.
    """
    department = spec(scope)
    result = capacity.staff_coverage(cur, scope, department, days=14)
    warn = scope.config.capacity_warn(scope.unit_code)
    return hero(
        label="Crew coverage ratio · next 14 days",
        value=result["ratio"],
        fmt=FMT_RATIO,
        caption=(
            f"peak {result['peakDate']} · {result['peakHours']:.1f} crew-hours against "
            f"{result['capacityHours']:.0f} available"
            if result["peakDate"]
            else "nothing booked in the next 14 days"
        ),
        target={"max": warn, "label": f"target <= {warn:.2f}"},
        status=status_for(result["ratio"], warn=warn, critical=1.0),
        sparkline=result["series"],
        caveat=result["assumption"] + " — the schema carries no roster or availability model (gap G2).",
        definition="M35 — peak daily service-hour demand ÷ (active staff × shift hours)",
        empty="No sound & light rows are booked in the next 14 days.",
        drill_to=drill(
            "/app/inbox/requests",
            requestKind=department.requirement,
            sort="schedule",
            date=result["peakDate"],
        ),
    )


@widget("av_rig_collisions")
def rig_collisions(cur, scope: Scope) -> dict[str, Any]:
    """Forward dates whose peak simultaneous overlap exceeds technician headcount.

    Coverage ratio is a daily *total*; two four-hour rigs at the same hour can
    breach while the day's total looks comfortable. This catches what the hero
    misses, which is why both are on the page.
    """
    department = spec(scope)
    staff = capacity.active_staff_count(cur, scope)
    days = capacity.concurrency_by_day(cur, scope, department, horizon=14)
    breaches = [d for d in days if staff and d["peak"] > staff]
    return kpi(
        label="Rig collisions · next 14 days",
        value=len(breaches),
        fmt=FMT_COUNT,
        secondary=f"{staff} active technicians",
        caption=f"first breach {breaches[0]['date']}" if breaches else "no date exceeds the crew",
        target={"max": 0, "label": "target 0"},
        status="critical" if breaches else "good",
        definition="M31 — peak simultaneous overlap against active technician headcount",
        drill_to=drill("#panel-av_collision_timeline", date=breaches[0]["date"] if breaches else None),
    )


@widget("av_collision_timeline")
def collision_timeline(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — one lane per day, each rig a bar from start to end.

    Answers "can we cover this?" at a glance, and shows *why* not: which two
    rigs collide, at what hour, in which venue. A heatmap cell would only say
    "this day is busy", and this department's problem is when within the day.
    """
    department = spec(scope)
    staff = capacity.active_staff_count(cur, scope)
    rows = capacity.collision_rows(cur, scope, department, horizon=14)
    lanes: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        lanes.setdefault(row["date"], []).append(row)
    breach_days = sorted(day for day, items in lanes.items() if staff and max(i["overlap"] for i in items) > staff)
    return panel(
        title="Rig collision timeline",
        subtitle=f"Next 14 days · ceiling at {staff} active technicians",
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
        annotations=[{"type": "threshold", "value": staff, "label": "crew ceiling"}] if staff else [],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "start", "label": "From", "format": "time"},
                {"key": "end", "label": "To", "format": "time"},
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "location", "label": "Venue", "format": "text"},
                {"key": "overlap", "label": "Simultaneous", "format": FMT_COUNT},
                {"key": "assignees", "label": "Assigned", "format": FMT_COUNT},
            ],
            rows,
        ),
        caption=(
            f"{len(breach_days)} day(s) exceed the crew ceiling. Bars above it carry a ring and a warning glyph, "
            "never colour alone."
            if breach_days
            else "No day in the window exceeds the crew ceiling."
        ),
        empty="No sound & light rows are booked in the next 14 days.",
        filters=["window", "option", "assigned"],
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement),
        signature=True,
        mobile="time-list",
    )


@widget("av_hour_demand")
def hour_demand(cur, scope: Scope) -> dict[str, Any]:
    """Technician-hour demand per day against roster capacity, 30 days forward,
    with the projected tail dashed and labelled."""
    department = spec(scope)
    staff = capacity.active_staff_count(cur, scope)
    shift = scope.config.shift_hours(scope.unit_code)
    ceiling = staff * shift
    daily = capacity.service_hour_demand(cur, scope, department, horizon=30)
    forecast = demand.demand_forecast(cur, scope, department, days=30)
    points = [{"x": d["date"], "y": d["hours"]} for d in daily]
    series_list = [series("hours", "Crew-hours committed", 1, points)]
    if forecast["available"]:
        # Projected rows converted to hours at the observed mean duration, so
        # the two series are the same unit and can share one axis.
        mean_hours = (sum(d["hours"] for d in daily) / sum(d["rows"] for d in daily)) if any(d["rows"] for d in daily) else 0
        series_list.append(
            series(
                "projected",
                "Projected",
                1,
                [{"x": p["x"], "y": round(p["y"] * mean_hours, 2)} for p in forecast["points"]],
                dashed=True,
            )
        )
    return panel(
        title="Technician-hour demand vs capacity",
        subtitle=f"Roster capacity {ceiling:.0f}h/day ({staff} staff × {shift:g}h)",
        chart="column-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Hours", "format": FMT_HOURS}},
        annotations=[{"type": "threshold", "value": ceiling, "label": "roster capacity"}] if ceiling else [],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "hours", "label": "Crew-hours", "format": FMT_HOURS},
                {"key": "rows", "label": "Rigs", "format": FMT_COUNT},
            ],
            daily,
        ),
        caption=forecast.get("method") if forecast["available"] else forecast.get("reason"),
        empty="Nothing is booked in the next 30 days.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, sort="schedule"),
        mobile="scroll",
    )
