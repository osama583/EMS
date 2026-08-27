"""Student Services — the guide-demand dashboard.

The only department whose capacity requirement is a **computed** number rather
than an observed one. A day that looks like three tours can be eleven guides,
and the head has no other way to find that out before the morning.

A stacked column and not a heatmap: the reader's question is "how many people do
I need that day", which is a magnitude with a ceiling, and a bar against a rule
answers it directly. Logistics gets the heatmap because its question is per-item,
and this department has one resource, not many.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..metrics import capacity
from ..scope import Scope, fold_tail, ratio, status_for
from .base import FMT_COUNT, FMT_RATIO, drill, hero, kpi, panel, series, table, widget


def _guide_days(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    rows = capacity.guide_demand(cur, scope, horizon)
    by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"guides": 0.0, "tours": 0, "pax": 0.0, "uncapped": 0, "splits": 0, "points": []}
    )
    for row in rows:
        day = by_day[row["date"]]
        day["guides"] += row["guides"]
        day["tours"] += row["tours"]
        day["pax"] += row["pax"] or 0.0
        day["uncapped"] += row["uncappedTours"]
        day["splits"] += row["splitTours"]
        day["points"].append(row)
    return [{"date": date, **values} for date, values in sorted(by_day.items())]


@widget("sts_guide_coverage")
def guide_coverage(cur, scope: Scope) -> dict[str, Any]:
    days = _guide_days(cur, scope)
    staff = capacity.active_staff_count(cur, scope)
    warn = scope.config.capacity_warn(scope.unit_code)
    for day in days:
        day["ratio"] = ratio(day["guides"], staff)
    peak = max((d for d in days if d["ratio"] is not None), key=lambda d: d["ratio"], default=None)
    uncapped_total = sum(d["uncapped"] for d in days)
    return hero(
        label="Guide demand vs roster · peak forward day",
        value=peak["ratio"] if peak else None,
        fmt=FMT_RATIO,
        caption=(
            f"{peak['date']} · {peak['guides']:.0f} guides required from {staff} active"
            if peak
            else "no tours are booked in the forward horizon"
        ),
        target={"max": warn, "label": f"target <= {warn:.2f}"},
        status=status_for(peak["ratio"] if peak else None, warn=warn, critical=1.0),
        sparkline=[{"x": d["date"], "y": d["ratio"]} for d in days if d["ratio"] is not None],
        caveat=(
            f"{uncapped_total} tour(s) start from a point with no group cap and are excluded — "
            "the real figure is higher."
            if uncapped_total
            else None
        ),
        definition="M33 over M35 — Σ ceil(pax ÷ max_group_size) ÷ active guides",
        empty="No campus tours are booked in the forward horizon.",
        drill_to=drill("#panel-sts_guide_demand", date=peak["date"] if peak else None),
    )


@widget("sts_tours_needing_split")
def tours_needing_split(cur, scope: Scope) -> dict[str, Any]:
    rows = capacity.guide_demand(cur, scope)
    splits = sum(r["splitTours"] for r in rows)
    worst = max(
        (r for r in rows if r["splitTours"] and r["cap"]),
        key=lambda r: (r["pax"] or 0) / (r["cap"] or 1),
        default=None,
    )
    return kpi(
        label="Tours needing a split",
        value=splits,
        fmt=FMT_COUNT,
        secondary=(
            f"largest ×{(worst['pax'] / worst['cap']):.1f} at {worst['startPoint']}" if worst else None
        ),
        caption="each is a staffing decision the applicant does not know is coming",
        status="warning" if splits else "good",
        definition="Forward tours where pax exceeds the start point's max_group_size",
        drill_to=drill("/app/inbox/requests", requestKind="campusTour", split="true"),
    )


@widget("sts_start_point_congestion")
def start_point_congestion(cur, scope: Scope) -> dict[str, Any]:
    rows = capacity.start_point_congestion(cur, scope)
    limit = scope.config.integer("START_POINT_MAX_TOURS", 2)
    crowded = [r for r in rows if r["tours"] > limit]
    return kpi(
        label="Start-point congestion",
        value=len(crowded),
        fmt=FMT_COUNT,
        caption=f"more than {limit} tours at one point on one day",
        target={"max": 0, "label": "target 0"},
        status="critical" if crowded else "good",
        definition="meeting_instructions assume one group at the meeting point",
        drill_to=drill("#panel-sts_start_point_heatmap"),
    )


@widget("sts_uncapped_start_points")
def uncapped_start_points(cur, scope: Scope) -> dict[str, Any]:
    """A data-quality tile that directly governs whether the hero can be
    trusted: each uncapped point silently under-states guide demand."""
    rows = capacity.uncapped_start_points(cur, scope)
    return kpi(
        label="Uncapped start points",
        value=len(rows),
        fmt=FMT_COUNT,
        secondary=f"{sum(r['tours'] for r in rows)} tours affected" if rows else None,
        caption="each one under-states the headline guide figure",
        target={"max": 0, "label": "target 0"},
        status="warning" if rows else "good",
        definition="Active start points with max_group_size IS NULL that received a tour",
        drill_to=drill("/app/dropdown-options/campusTourStart"),
    )


@widget("sts_guide_demand")
def guide_demand_panel(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — guides required per forward day, stacked by start point.

    The value is *guides*, not tours: converting a tour schedule into a staffing
    requirement is the arithmetic that separates a manageable day from an
    impossible one. Uncapped tours sit in a hatched band labelled "no cap set"
    and are excluded from the stack total rather than counted as one guide each.
    """
    days = _guide_days(cur, scope)
    staff = capacity.active_staff_count(cur, scope)
    totals: dict[str, float] = defaultdict(float)
    for day in days:
        for point in day["points"]:
            totals[point["startPoint"]] += point["guides"]
    ranked = sorted(({"label": k, "value": v} for k, v in totals.items()), key=lambda r: -r["value"])
    kept = fold_tail(scope, ranked, limit=3)
    kept_labels = [r["label"] for r in kept if not r.get("isOther")]

    series_list = []
    for index, label in enumerate(kept_labels, start=1):
        series_list.append(
            series(
                label,
                label,
                index,
                [
                    {"x": d["date"], "y": sum(p["guides"] for p in d["points"] if p["startPoint"] == label)}
                    for d in days
                ],
            )
        )
    if any(r.get("isOther") for r in kept):
        series_list.append(
            series(
                "other",
                "Other",
                4,
                [
                    {"x": d["date"], "y": sum(p["guides"] for p in d["points"] if p["startPoint"] not in kept_labels)}
                    for d in days
                ],
            )
        )

    uncapped = sum(d["uncapped"] for d in days)
    return panel(
        title="Guide demand & group-split planner",
        subtitle=f"Guides required per day · ceiling at {staff} active guides",
        chart="column-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Guides", "format": FMT_COUNT}},
        annotations=[{"type": "threshold", "value": staff, "label": "guide ceiling"}] if staff else [],
        data={"days": days, "uncappedTours": uncapped},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "tours", "label": "Tours", "format": FMT_COUNT},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
                {"key": "guides", "label": "Guides required", "format": FMT_COUNT},
                {"key": "splits", "label": "Splits", "format": FMT_COUNT},
                {"key": "uncapped", "label": "Uncapped", "format": FMT_COUNT},
            ],
            days,
        ),
        caption=(
            f"{uncapped} tour(s) come from an uncapped start point and are excluded from the stack — set a cap to "
            "bring them in."
            if uncapped
            else "Every tour in the window starts from a capped point."
        ),
        empty="No campus tours are booked in the forward horizon.",
        filters=["horizon", "startPoint", "splitsOnly"],
        drill_to=drill("/app/inbox/requests", requestKind="campusTour"),
        signature=True,
        mobile="scroll",
    )


@widget("sts_start_point_heatmap")
def start_point_heatmap(cur, scope: Scope) -> dict[str, Any]:
    rows = capacity.start_point_congestion(cur, scope)
    limit = scope.config.integer("START_POINT_MAX_TOURS", 2)
    points = sorted({r["startPoint"] for r in rows})
    days = sorted({r["date"] for r in rows})
    return panel(
        title="Start-point congestion",
        subtitle=f"Tours per start point per day · comfortable maximum {limit}",
        chart="heatmap",
        data={
            "rows": points,
            "columns": days,
            "cells": [
                {
                    "label": r["startPoint"],
                    "date": r["date"],
                    "ratio": ratio(r["tours"], limit),
                    "committed": r["tours"],
                    "available": limit,
                    "instructions": r["instructions"],
                    "optionId": r["optionId"],
                }
                for r in rows
            ],
            "threshold": 1.0,
        },
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "category", "label": "Start point"}},
        annotations=[{"type": "threshold", "value": 1.0, "label": "comfortable maximum"}],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "startPoint", "label": "Start point", "format": "text"},
                {"key": "tours", "label": "Tours", "format": FMT_COUNT},
            ],
            rows,
        ),
        caption="Meeting instructions appear on hover — the instruction text is usually what makes two groups at one point unworkable.",
        empty="No campus tours are booked in the forward horizon.",
        drill_to=drill("/app/inbox/requests", requestKind="campusTour"),
        mobile="breach-list",
    )


@widget("sts_group_sizes")
def group_sizes(cur, scope: Scope) -> dict[str, Any]:
    """Every tour's pax against its start point's cap.

    Shows cap calibration at a glance: a cap every tour exceeds is set too low;
    a cap no tour approaches is not doing anything.
    """
    tours = capacity.group_sizes(cur, scope)
    caps = {t["startPoint"]: t["cap"] for t in tours if t["cap"]}
    return panel(
        title="Group size against cap",
        subtitle="One dot per tour, with each start point's cap as a reference band",
        chart="dot-plot",
        series_list=[
            series(
                "tours",
                "Tours",
                1,
                [
                    {
                        "x": t["pax"],
                        "label": t["startPoint"],
                        "requestId": t["requestId"],
                        "over": bool(t["cap"] and t["pax"] > t["cap"]),
                    }
                    for t in tours
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Pax", "format": FMT_COUNT}},
        annotations=[
            {"type": "reference", "axis": "x", "value": cap, "label": f"{point} cap"}
            for point, cap in sorted(caps.items())
        ],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "startPoint", "label": "Start point", "format": "text"},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
                {"key": "cap", "label": "Cap", "format": FMT_COUNT},
            ],
            tours,
        ),
        empty="No campus tours fall in this period.",
        mobile="ranked-list",
    )


@widget("sts_tour_type_mix")
def tour_type_mix(cur, scope: Scope) -> dict[str, Any]:
    """Share per tour type per week.

    Student Services is the only department owning two catalogues, and type mix
    is the one it can influence by what it offers.
    """
    from ....db import fetch_all

    rows = fetch_all(
        cur,
        """
        SELECT date_trunc('week', ct."date")::date AS week,
               coalesce(tt.label, ct.tour_type, 'Unspecified') AS tour_type,
               count(*) AS n
          FROM request_campus_tour ct
          LEFT JOIN campus_tour_type_options tt
                 ON tt.campus_tour_type_option_id = ct.tour_type_option_id
          JOIN request r ON r.request_id = ct.request_id
         WHERE r.status NOT IN ('cancelled', 'completed_rejected', 'draft')
           AND ct."date" >= %(from)s AND ct."date" < %(to)s
      GROUP BY 1, 2
      ORDER BY 1
        """,
        scope.base_params,
    )
    weeks = sorted({r["week"].isoformat() for r in rows})
    totals: dict[str, int] = defaultdict(int)
    for r in rows:
        totals[r["tour_type"]] += int(r["n"])
    ranked = sorted(({"label": k, "value": v} for k, v in totals.items()), key=lambda r: -r["value"])
    kept = fold_tail(scope, ranked, limit=3)
    kept_labels = [r["label"] for r in kept if not r.get("isOther")]
    week_totals: dict[str, int] = defaultdict(int)
    for r in rows:
        week_totals[r["week"].isoformat()] += int(r["n"])

    def points_for(predicate) -> list[dict[str, Any]]:
        out = []
        for week in weeks:
            value = sum(int(r["n"]) for r in rows if r["week"].isoformat() == week and predicate(r["tour_type"]))
            out.append({"x": week, "y": ratio(value, week_totals[week])})
        return out

    series_list = [
        series(label, label, index, points_for(lambda t, want=label: t == want))
        for index, label in enumerate(kept_labels, start=1)
    ]
    if any(r.get("isOther") for r in kept):
        series_list.append(series("other", "Other", 4, points_for(lambda t: t not in kept_labels)))

    return panel(
        title="Tour type mix",
        subtitle="Share of tours per type, per week",
        chart="line-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Share", "format": "percent"}},
        table_view=table(
            [
                {"key": "week", "label": "Week", "format": "date"},
                {"key": "tour_type", "label": "Tour type", "format": "text"},
                {"key": "n", "label": "Tours", "format": FMT_COUNT},
            ],
            [{"week": r["week"].isoformat(), "tour_type": r["tour_type"], "n": int(r["n"])} for r in rows],
        ),
        empty="No campus tours fall in this period.",
        drill_to=drill("/app/history/requests", requestKind="campusTour"),
    )


@widget("sts_forward_demand")
def forward_demand(cur, scope: Scope) -> dict[str, Any]:
    """Tours and guides required on **one axis** — both counts of the same kind.

    Their divergence is the story: guides rising faster than tours means group
    sizes are growing.
    """
    days = _guide_days(cur, scope)
    return panel(
        title="Forward demand",
        subtitle="Tours and guides required per day",
        chart="line-chart",
        series_list=[
            series("tours", "Tours", 1, [{"x": d["date"], "y": d["tours"]} for d in days]),
            series("guides", "Guides required", 2, [{"x": d["date"], "y": d["guides"]} for d in days]),
        ],
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Count", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "tours", "label": "Tours", "format": FMT_COUNT},
                {"key": "guides", "label": "Guides", "format": FMT_COUNT},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
            ],
            days,
        ),
        caption="Guides rising faster than tours means group sizes are growing.",
        empty="No campus tours are booked in the forward horizon.",
        drill_to=drill("/app/inbox/requests", requestKind="campusTour", sort="schedule"),
    )
