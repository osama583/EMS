"""Logistics and Facilities — the inventory-heatmap dashboard.

The only department whose scarce resource is consumable stock with a real
capacity column (`logistics_options.available_quantity`), and the only one that
can detect a venue turnaround conflict, because it is the only one holding both
the venue and the setup window.

A heatmap here and a timeline for A/V, deliberately: for stock the constraint is
the **day total**, since an item issued in the morning is not back by the
afternoon.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from ..metrics import capacity, quality, risk
from ..scope import Scope, status_for
from .base import FMT_COUNT, FMT_MINUTES, FMT_RATIO, drill, hero, kpi, panel, series, table, widget
from .department import spec


def _cells(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    return capacity.logistics_commitment(cur, scope, horizon)


@widget("log_peak_commitment")
def peak_commitment(cur, scope: Scope) -> dict[str, Any]:
    """Hero — the highest committed-to-available ratio for any item on any
    forward date.

    Above 1.0 is a promise that cannot be kept, and it is knowable weeks ahead.
    Every other logistics failure is downstream of this one.
    """
    cells = _cells(cur, scope)
    warn = scope.config.capacity_warn(scope.unit_code)
    worst = max((c for c in cells if c["ratio"] is not None), key=lambda c: c["ratio"], default=None)
    by_day: dict[str, float] = {}
    for cell in cells:
        if cell["ratio"] is not None:
            by_day[cell["date"]] = max(by_day.get(cell["date"], 0.0), cell["ratio"])
    return hero(
        label="Peak stock commitment",
        value=worst["ratio"] if worst else None,
        fmt=FMT_RATIO,
        caption=(
            f"{worst['label']} on {worst['date']} · {worst['committed']:.0f} of "
            f"{worst['available']:.0f} {worst['unit']}"
            if worst
            else "nothing committed in the forward horizon"
        ),
        target={"max": warn, "label": f"target <= {warn:.2f}"},
        status=status_for(worst["ratio"] if worst else None, warn=warn, critical=1.0),
        sparkline=[{"x": day, "y": value} for day, value in sorted(by_day.items())],
        definition="M30 — committed quantity ÷ available quantity, per item per date",
        empty="No catalogue items are committed in the forward horizon.",
        drill_to=drill("#panel-log_inventory_heatmap", date=worst["date"] if worst else None),
    )


@widget("log_items_over_capacity")
def items_over_capacity(cur, scope: Scope) -> dict[str, Any]:
    """The hero names the worst cell; this names the workload. One item
    breaching for a week is one conversation; six items breaching once each is
    six."""
    cells = _cells(cur, scope)
    breaches = [c for c in cells if (c["ratio"] or 0) > 1.0]
    nearest = min((c["date"] for c in breaches), default=None)
    return kpi(
        label="Items over capacity",
        value=len(breaches),
        fmt=FMT_COUNT,
        secondary=f"{len({c['label'] for c in breaches})} distinct items" if breaches else None,
        caption=f"nearest breach {nearest}" if nearest else "no item exceeds its stock",
        target={"max": 0, "label": "target 0"},
        status="critical" if breaches else "good",
        definition="M30 — distinct item × date cells above 1.0 in the horizon",
        drill_to=drill("#panel-log_inventory_heatmap", breaches="true"),
    )


@widget("log_venue_conflicts")
def venue_conflicts(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    conflicts = risk.venue_conflicts(cur, scope, department)
    gap = scope.config.integer("VENUE_TEARDOWN_MINUTES", 60)
    return kpi(
        label="Venue turnaround conflicts",
        value=len(conflicts),
        fmt=FMT_COUNT,
        caption=f"gap under {gap} minutes at one location",
        target={"max": 0, "label": "target 0"},
        status="critical" if conflicts else "good",
        definition="Pairs of rows at the same normalised location inside the teardown window",
        caveat="Locations are free text and normalised by lower-case and trim; a controlled place catalogue would do better.",
        drill_to=drill("#panel-log_venue_turnaround"),
    )


@widget("log_inventory_heatmap")
def inventory_heatmap(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — items × days, cell = commitment ratio.

    Rows sort by peak ratio so the worst item is the top row. Off-catalogue rows
    have no stock level at all and are excluded, with the count stated in the
    caption rather than dropped silently.
    """
    department = spec(scope)
    horizon = scope.config.horizon_days(scope.unit_code)
    cells = _cells(cur, scope, horizon)
    off = quality.off_catalogue_rate(cur, scope, department)
    peaks: dict[str, float] = {}
    for cell in cells:
        peaks[cell["label"]] = max(peaks.get(cell["label"], 0.0), cell["ratio"] or 0.0)
    ordered_items = [label for label, _ in sorted(peaks.items(), key=lambda kv: kv[1], reverse=True)]
    days = sorted({cell["date"] for cell in cells})
    return panel(
        title="Inventory commitment heatmap",
        subtitle=f"Next {horizon} days · sequential blue mapped 0 → 1.0",
        chart="heatmap",
        data={
            "rows": ordered_items,
            "columns": days,
            "cells": cells,
            "threshold": 1.0,
            "warn": scope.config.capacity_warn(scope.unit_code),
        },
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "category", "label": "Item"}},
        annotations=[{"type": "threshold", "value": 1.0, "label": "capacity"}],
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "committed", "label": "Committed", "format": FMT_COUNT},
                {"key": "available", "label": "Available", "format": FMT_COUNT},
                {"key": "ratio", "label": "Ratio", "format": FMT_RATIO},
            ],
            cells,
        ),
        caption=(
            f"Off-catalogue rows are excluded — they carry no stock level. {off['count']} of {off['sample']} rows "
            f"({off['rate']:.0%}) were typed in rather than picked."
            if off["rate"] is not None
            else "Off-catalogue rows are excluded — they carry no stock level."
        ),
        empty="No catalogue items are committed in the forward horizon.",
        filters=["horizon", "breachesOnly"],
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement),
        signature=True,
        mobile="breach-list",
    )


@widget("log_stock_runway")
def stock_runway(cur, scope: Scope) -> dict[str, Any]:
    """Items ranked by days until first breach.

    Items with no breach in the horizon are shown at full length in the
    de-emphasis tint with a "clear" label — present so the head sees what is
    *fine*, which is how a heatmap alone misleads.
    """
    cells = _cells(cur, scope)
    horizon = scope.config.horizon_days(scope.unit_code)
    first_breach: dict[str, str] = {}
    known: dict[str, dict[str, Any]] = {}
    for cell in cells:
        known.setdefault(cell["label"], cell)
        if (cell["ratio"] or 0) > 1.0:
            existing = first_breach.get(cell["label"])
            if existing is None or cell["date"] < existing:
                first_breach[cell["label"]] = cell["date"]
    rows = []
    for label, cell in known.items():
        breach = first_breach.get(label)
        days = (dt.date.fromisoformat(breach) - scope.today).days if breach else None
        rows.append(
            {
                "label": label,
                "optionId": cell["optionId"],
                "value": days if days is not None else horizon,
                "breachDate": breach,
                "clear": breach is None,
            }
        )
    rows.sort(key=lambda r: (r["clear"], r["value"]))
    return panel(
        title="Stock runway by item",
        subtitle="Days until the first date this item is over-committed",
        chart="bar-chart",
        series_list=[
            series(
                "runway",
                "Days to breach",
                1,
                [{"x": r["value"], "label": r["label"], "optionId": r["optionId"], "muted": r["clear"]} for r in rows],
            )
        ],
        axes={"x": {"type": "linear", "label": "Days"}},
        table_view=table(
            [
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "value", "label": "Days to breach", "format": FMT_COUNT},
                {"key": "breachDate", "label": "First breach", "format": "date"},
            ],
            rows,
        ),
        caption="Items with no breach in the horizon render clear at full length — what is fine is worth seeing too.",
        empty="No catalogue items are committed in the forward horizon.",
        drill_to=drill("/app/dropdown-options/logistics"),
        mobile="ranked-list",
    )


@widget("log_venue_turnaround")
def venue_turnaround(cur, scope: Scope) -> dict[str, Any]:
    """One lane per location, bars from start to end, with sub-teardown gaps
    drawn as a critical connector labelled in minutes."""
    department = spec(scope)
    conflicts = risk.venue_conflicts(cur, scope, department)
    rows = capacity.collision_rows(cur, scope, department, horizon=scope.config.horizon_days(scope.unit_code))
    lanes: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["location"]:
            lanes.setdefault(row["location"].strip().lower(), []).append(row)
    # Locations with a single booking cannot have a turnaround problem, and
    # showing them turns a conflict panel into a booking list.
    lanes = {name: items for name, items in lanes.items() if len(items) > 1}
    gap = scope.config.integer("VENUE_TEARDOWN_MINUTES", 60)
    return panel(
        title="Venue turnaround",
        subtitle=f"Locations with more than one booking · teardown window {gap} minutes",
        chart="timeline-chart",
        data={
            "lanes": [
                {"key": name, "label": name, "bars": sorted(items, key=lambda i: (i["date"], i["start"] or ""))}
                for name, items in sorted(lanes.items())
            ],
            "conflicts": conflicts,
            "ceiling": None,
        },
        axes={"x": {"type": "time", "label": "Hour of day"}, "y": {"type": "category", "label": "Location"}},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "location", "label": "Location", "format": "text"},
                {"key": "gapMinutes", "label": "Gap (min)", "format": FMT_MINUTES},
            ],
            conflicts,
        ),
        caption=f"{len(conflicts)} pair(s) leave less than {gap} minutes between bookings at one location.",
        empty="No location has more than one booking in the horizon.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement),
        mobile="time-list",
    )
