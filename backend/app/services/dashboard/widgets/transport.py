"""Transport Services — the two-ceiling dashboard.

The only department with two independent ceilings: vehicles
(`transportation_options.available_vehicle_count`) and drivers (active staff,
one per row under `MAX_ASSIGNEES_PER_ROW['transportation'] = 1`).

A single ratio is a lie in a two-ceiling department. Reading "1.5" without
knowing whether it means *no bus* or *no driver* sends the head to the wrong
meeting — so the hero names which ceiling binds, and the label is half the
metric.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..metrics import capacity, demand
from ..scope import Scope, fold_tail, num, ratio, status_for
from .base import FMT_COUNT, FMT_PERCENT, FMT_RATIO, drill, hero, kpi, panel, series, table, widget
from .department import spec


def _daily_ceilings(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    """Per forward day: vehicles required against the fleet, trips against
    drivers, and which of the two binds first."""
    rows = capacity.transport_commitment(cur, scope, horizon)
    drivers = capacity.active_staff_count(cur, scope)
    fleet_total = 0
    seen_types: set[Any] = set()
    for row in rows:
        if row["optionId"] not in seen_types:
            seen_types.add(row["optionId"])
            fleet_total += int(row["available"] or 0)

    by_day: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"trips": 0, "vehicles": 0, "pax": 0.0, "types": []}
    )
    for row in rows:
        day = by_day[row["date"]]
        day["trips"] += row["trips"]
        day["vehicles"] += row["trips"]  # one row is one vehicle
        day["pax"] += row["pax"] or 0.0
        day["types"].append(row)

    out = []
    for date, day in sorted(by_day.items()):
        vehicle_ratio = ratio(day["vehicles"], fleet_total)
        driver_ratio = ratio(day["trips"], drivers)
        binding = "vehicles"
        value = vehicle_ratio
        if driver_ratio is not None and (vehicle_ratio is None or driver_ratio > vehicle_ratio):
            binding, value = "drivers", driver_ratio
        out.append(
            {
                "date": date,
                "trips": day["trips"],
                "vehicles": day["vehicles"],
                "pax": day["pax"],
                "vehicleRatio": vehicle_ratio,
                "driverRatio": driver_ratio,
                "binding": binding,
                "ratio": value,
                "types": day["types"],
            }
        )
    return out


@widget("trn_binding_constraint")
def binding_constraint(cur, scope: Scope) -> dict[str, Any]:
    days = _daily_ceilings(cur, scope)
    drivers = capacity.active_staff_count(cur, scope)
    warn = scope.config.capacity_warn(scope.unit_code)
    peak = max((d for d in days if d["ratio"] is not None), key=lambda d: d["ratio"], default=None)
    return hero(
        label="Binding constraint · peak forward day",
        value=peak["ratio"] if peak else None,
        fmt=FMT_RATIO,
        caption=(
            f"{peak['date']} · bound by {peak['binding']} "
            f"({peak['trips']} trips, {drivers} drivers)"
            if peak
            else "nothing booked in the forward horizon"
        ),
        target={"max": warn, "label": f"target <= {warn:.2f}"},
        status=status_for(peak["ratio"] if peak else None, warn=warn, critical=1.0),
        sparkline=[{"x": d["date"], "y": d["ratio"]} for d in days if d["ratio"] is not None],
        definition="max(vehicles required ÷ fleet, trips ÷ active drivers) per day — the label names the argmax",
        empty="No trips are booked in the forward horizon.",
        drill_to=drill("#panel-trn_roster_board", date=peak["date"] if peak else None),
    )


@widget("trn_seat_fill")
def seat_fill(cur, scope: Scope) -> dict[str, Any]:
    """A fleet running at 40% fill is short of vehicles it does not actually
    need. This is the only department that can see its own waste, and the figure
    is the argument against the next purchase request.

    The target is a *band*: above 0.95 there is no margin for a late addition.
    """
    result = capacity.seat_fill(cur, scope)
    value = result["median"]
    band_status = "unknown"
    if value is not None:
        band_status = "good" if 0.60 <= value <= 0.95 else ("critical" if value < 0.40 else "warning")
    return kpi(
        label="Seat-fill efficiency",
        value=value,
        fmt=FMT_PERCENT,
        secondary=f"p10 {result['p10']:.0%}" if result["p10"] is not None else None,
        caption=f"{result['sample']} trips in period",
        target={"min": 0.60, "max": 0.95, "label": "target band 60–95%"},
        status=band_status,
        definition="M32 — requested pax ÷ the chosen vehicle's passenger capacity",
        drill_to=drill("#panel-trn_seat_fill_distribution"),
    )


@widget("trn_driver_bound_days")
def driver_bound_days(cur, scope: Scope) -> dict[str, Any]:
    days = _daily_ceilings(cur, scope)
    driver_bound = [d for d in days if (d["driverRatio"] or 0) > 1.0]
    vehicle_bound = [d for d in days if (d["vehicleRatio"] or 0) > 1.0]
    drivers = capacity.active_staff_count(cur, scope)
    return kpi(
        label="Driver-bound days",
        value=len(driver_bound),
        fmt=FMT_COUNT,
        secondary=f"{len(vehicle_bound)} vehicle-bound",
        caption=f"{drivers} active drivers · a third simultaneous trip is not happening",
        target={"max": 0, "label": "target 0"},
        status="critical" if driver_bound else ("warning" if vehicle_bound else "good"),
        definition="Forward days where trip count exceeds active drivers",
        drill_to=drill("#panel-trn_roster_board", bound="driver"),
    )


@widget("trn_consolidation")
def consolidation(cur, scope: Scope) -> dict[str, Any]:
    candidates = capacity.consolidation_candidates(cur, scope)
    return kpi(
        label="Consolidation opportunities",
        value=len(candidates),
        fmt=FMT_COUNT,
        caption="same date, same route, both under half full, combined pax fits one vehicle",
        status="good" if not candidates else "warning",
        definition="A saving that is arithmetic, not judgement — the count is a work list",
        drill_to=drill("#panel-trn_route_concentration"),
    )


@widget("trn_roster_board")
def roster_board(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — one column per forward day, stacked by vehicle type,
    with **two** ceiling rules.

    Two rules on one plot, not two y-axes. Both ceilings are counts of the same
    kind (units of the thing plotted), so a single axis is correct — the
    distinction is worth stating because it looks superficially like the
    dual-axis anti-pattern and is not.
    """
    days = _daily_ceilings(cur, scope)
    drivers = capacity.active_staff_count(cur, scope)
    fleet = 0
    seen: set[Any] = set()
    totals: dict[str, float] = defaultdict(float)
    for day in days:
        for row in day["types"]:
            totals[row["label"]] += row["trips"]
            if row["optionId"] not in seen:
                seen.add(row["optionId"])
                fleet += int(row["available"] or 0)

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
                    {"x": day["date"], "y": sum(t["trips"] for t in day["types"] if t["label"] == label)}
                    for day in days
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
                    {"x": day["date"], "y": sum(t["trips"] for t in day["types"] if t["label"] not in kept_labels)}
                    for day in days
                ],
            )
        )

    return panel(
        title="Fleet & driver roster board",
        subtitle=f"Forward trips by vehicle type · fleet {fleet}, drivers {drivers}",
        chart="column-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Trips", "format": FMT_COUNT}},
        annotations=[
            {"type": "threshold", "value": fleet, "label": "fleet ceiling", "style": "solid"},
            {"type": "threshold", "value": drivers, "label": "driver ceiling", "style": "long-dash"},
        ],
        data={"days": days},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "trips", "label": "Trips", "format": FMT_COUNT},
                {"key": "vehicleRatio", "label": "Fleet ratio", "format": FMT_RATIO},
                {"key": "driverRatio", "label": "Driver ratio", "format": FMT_RATIO},
                {"key": "binding", "label": "Binds on", "format": "text"},
            ],
            days,
        ),
        caption=(
            "The only view showing both constraints on one time axis — so September binding on drivers and "
            "October binding on vehicles are distinguishable."
        ),
        empty="No trips are booked in the forward horizon.",
        filters=["horizon", "vehicleType", "breachesOnly"],
        drill_to=drill("/app/inbox/requests", requestKind="transportation"),
        signature=True,
        mobile="scroll",
    )


@widget("trn_seat_fill_distribution")
def seat_fill_distribution(cur, scope: Scope) -> dict[str, Any]:
    trips = capacity.seat_fill_distribution(cur, scope)
    summary = capacity.seat_fill(cur, scope)
    return panel(
        title="Seat-fill efficiency",
        subtitle="One dot per trip · target band 60–95%",
        chart="dot-plot",
        series_list=[
            series(
                "trips",
                "Trips",
                1,
                [
                    {
                        "x": t["fill"],
                        "label": t["route"] if (t["fill"] or 1) < 0.35 else None,
                        "requestId": t["requestId"],
                        "vehicle": t["vehicle"],
                    }
                    for t in trips
                    if t["fill"] is not None
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Seat fill", "format": FMT_PERCENT}},
        annotations=[
            {"type": "band", "axis": "x", "from": 0.60, "to": 0.95, "label": "target"},
            {"type": "reference", "axis": "x", "value": summary["median"], "label": "median"},
            {"type": "reference", "axis": "x", "value": summary["p10"], "label": "p10"},
        ],
        table_view=table(
            [
                {"key": "route", "label": "Route", "format": "text"},
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
                {"key": "seats", "label": "Seats", "format": FMT_COUNT},
                {"key": "fill", "label": "Fill", "format": FMT_PERCENT},
            ],
            trips,
        ),
        caption="Trips below 35% carry their route as a direct label — those are the consolidation candidates.",
        empty="No trips fall in this period.",
        mobile="ranked-list",
    )


@widget("trn_route_concentration")
def route_concentration(cur, scope: Scope) -> dict[str, Any]:
    trips = capacity.seat_fill_distribution(cur, scope)
    candidates = capacity.consolidation_candidates(cur, scope)
    counts: dict[str, int] = defaultdict(int)
    for trip in trips:
        counts[trip["route"]] += 1
    ranked = sorted(({"label": k, "value": v} for k, v in counts.items()), key=lambda r: -r["value"])
    return panel(
        title="Route concentration & consolidation",
        subtitle="Normalised pickup → dropoff pairs by trip count",
        chart="bar-chart",
        series_list=[series("routes", "Trips", 1, [{"x": r["value"], "label": r["label"]} for r in ranked])],
        axes={"x": {"type": "linear", "label": "Trips", "format": FMT_COUNT}},
        data={"opportunities": candidates},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "route", "label": "Route", "format": "text"},
                {"key": "combinedPax", "label": "Combined pax", "format": FMT_COUNT},
                {"key": "seats", "label": "Vehicle seats", "format": FMT_COUNT},
                {"key": "vehicle", "label": "Vehicle", "format": "text"},
            ],
            candidates,
        ),
        caption=f"{len(candidates)} pair(s) could share one vehicle. Routes are free text, normalised by lower-case and trim.",
        empty="No trips fall in this period.",
        mobile="ranked-list",
    )


@widget("trn_fleet_utilisation")
def fleet_utilisation(cur, scope: Scope) -> dict[str, Any]:
    """Vehicle types by committed vehicle-days over available vehicle-days, each
    annotated with its median seat fill.

    A type at 95% utilisation and 40% fill is the wrong vehicle bought in the
    right quantity, and that reading is only available with both figures
    together.
    """
    horizon = scope.config.horizon_days(scope.unit_code)
    rows = capacity.transport_commitment(cur, scope, horizon)
    per_type: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = per_type.setdefault(
            row["label"], {"label": row["label"], "optionId": row["optionId"], "trips": 0, "pax": 0.0, "seats": row["seats"], "available": row["available"]}
        )
        entry["trips"] += row["trips"]
        entry["pax"] += row["pax"] or 0.0
    ranked = []
    for entry in per_type.values():
        vehicle_days = (entry["available"] or 0) * horizon
        ranked.append(
            {
                **entry,
                "value": ratio(entry["trips"], vehicle_days),
                "medianFill": ratio(entry["pax"], entry["trips"] * (entry["seats"] or 0)) if entry["trips"] else None,
            }
        )
    ranked.sort(key=lambda r: -(r["value"] or 0))
    return panel(
        title="Fleet utilisation by type",
        subtitle=f"Committed vehicle-days ÷ available vehicle-days over {horizon} days",
        chart="bar-chart",
        series_list=[
            series(
                "utilisation",
                "Utilisation",
                1,
                [
                    {"x": r["value"], "label": r["label"], "optionId": r["optionId"], "annotation": (f"{r['medianFill']:.0%} fill" if r["medianFill"] is not None else None)}
                    for r in ranked
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Utilisation", "format": FMT_PERCENT}},
        table_view=table(
            [
                {"key": "label", "label": "Vehicle type", "format": "text"},
                {"key": "trips", "label": "Trips", "format": FMT_COUNT},
                {"key": "available", "label": "Fleet", "format": FMT_COUNT},
                {"key": "value", "label": "Utilisation", "format": FMT_PERCENT},
                {"key": "medianFill", "label": "Median fill", "format": FMT_PERCENT},
            ],
            ranked,
        ),
        caption="Utilisation and fill together: high utilisation at low fill means the wrong vehicle in the right quantity.",
        empty="No trips are booked in the forward horizon.",
        drill_to=drill("/app/dropdown-options/transportation"),
        mobile="ranked-list",
    )


@widget("trn_forward_demand")
def forward_demand(cur, scope: Scope) -> dict[str, Any]:
    """Trips and vehicles required on **one axis** — both counts of the same
    kind. Divergence means trips are increasingly needing more than one vehicle.
    """
    days = _daily_ceilings(cur, scope)
    return panel(
        title="Forward demand",
        subtitle="Trips and vehicles required per day",
        chart="line-chart",
        series_list=[
            series("trips", "Trips", 1, [{"x": d["date"], "y": d["trips"]} for d in days]),
            series("vehicles", "Vehicles required", 2, [{"x": d["date"], "y": d["vehicles"]} for d in days]),
        ],
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Count", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "trips", "label": "Trips", "format": FMT_COUNT},
                {"key": "vehicles", "label": "Vehicles", "format": FMT_COUNT},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
            ],
            days,
        ),
        caption="Both series are counts of the same kind, so one axis is correct here.",
        empty="No trips are booked in the forward horizon.",
        drill_to=drill("/app/inbox/requests", requestKind="transportation", sort="schedule"),
    )
