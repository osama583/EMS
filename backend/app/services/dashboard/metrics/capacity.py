"""Family D - capacity and utilisation (M30-M39).

This is the family that makes the six department dashboards genuinely different
rather than differently titled. Three departments have a catalogue capacity
column and can forecast a stock-out; two have none at all and can only forecast
*people* shortages; one has both plus a downstream supply chain. The functions
below are not interchangeable, and the ones that do not apply to a unit are not
called for it.
"""
from __future__ import annotations

from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import NON_COMMITTED_STATUSES, DepartmentSpec


def _horizon_params(scope: Scope, horizon: int | None = None) -> dict[str, Any]:
    return scope.params(
        non_committed=list(NON_COMMITTED_STATUSES),
        horizon=horizon or scope.config.horizon_days(scope.unit_code),
    )


# --- M30 · Stock commitment ratio ----------------------------------------
# Only defined where the catalogue carries a capacity column. A/V and
# Photography deliberately have none (gap G3) - their managers allocate at
# review time - so those two dashboards use M31/M34/M35 instead, which is the
# reason their signature panels are a timeline and a funnel rather than a
# heatmap.


def logistics_commitment(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    """M30, logistics variant - committed quantity per item per date, over the
    item's available quantity."""
    rows = fetch_all(
        cur,
        """
        SELECT l."date" AS day,
               o.logistics_option_id AS option_id,
               o.label AS label,
               o.quantity_unit AS unit,
               sum(l.quantity) AS committed,
               o.available_quantity AS available,
               sum(l.quantity)::numeric / NULLIF(o.available_quantity, 0) AS ratio
          FROM request_logistics l
          JOIN logistics_options o ON o.logistics_option_id = l.option_id
          JOIN request r ON r.request_id = l.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND l."date" >= %(today)s
           AND l."date" < %(today)s::date + %(horizon)s
      GROUP BY 1, 2, 3, 4, 6
      ORDER BY 1, 3
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {
            "date": r["day"].isoformat(),
            "optionId": r["option_id"],
            "label": r["label"],
            "unit": r["unit"],
            "committed": num(r["committed"]),
            "available": num(r["available"]),
            "ratio": num(r["ratio"]),
        }
        for r in rows
    ]


def transport_commitment(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    """M30, transport variant - trips per vehicle type per date against the
    fleet, carrying seat fill so Panel D can read utilisation and fill together.

    A type at 95% utilisation and 40% fill is the wrong vehicle bought in the
    right quantity, and that reading is only available with both figures side by
    side.
    """
    rows = fetch_all(
        cur,
        """
        SELECT t."date" AS day,
               o.transportation_option_id AS option_id,
               o.label AS label,
               count(*) AS trips,
               o.available_vehicle_count AS available,
               o.passenger_capacity AS seats,
               sum(t.requested_pax) AS pax,
               count(*)::numeric / NULLIF(o.available_vehicle_count, 0) AS ratio
          FROM request_transportation t
          JOIN transportation_options o ON o.transportation_option_id = t.option_id
          JOIN request r ON r.request_id = t.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND t."date" >= %(today)s
           AND t."date" < %(today)s::date + %(horizon)s
      GROUP BY 1, 2, 3, 5, 6
      ORDER BY 1, 3
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {
            "date": r["day"].isoformat(),
            "optionId": r["option_id"],
            "label": r["label"],
            "trips": int(r["trips"]),
            "available": num(r["available"]),
            "seats": num(r["seats"]),
            "pax": num(r["pax"]),
            "ratio": num(r["ratio"]),
        }
        for r in rows
    ]


# --- M31 · Concurrency load ----------------------------------------------


def concurrency_by_day(cur, scope: Scope, spec: DepartmentSpec, horizon: int | None = None) -> list[dict[str, Any]]:
    """M31 - rows per forward day and the maximum simultaneous overlap in it.

    A proper interval self-join, not a window function: two four-hour rigs at
    the same hour is a breach even when the day's total hours look comfortable,
    and only an overlap count catches that. For A/V and Photography this *is*
    the capacity metric, because neither has any stock to run out of.
    """
    if not spec.has_window:
        return []
    rows = fetch_all(
        cur,
        f"""
        SELECT day, count(*) AS rows_that_day, max(overlap) AS peak
          FROM (
            SELECT a."date" AS day,
                   (SELECT count(*) FROM {spec.table} b
                      JOIN request rb ON rb.request_id = b.request_id
                     WHERE b."date" = a."date"
                       AND rb.status <> ALL(%(non_committed)s)
                       AND b.{spec.start_column} < a.{spec.end_column}
                       AND b.{spec.end_column} > a.{spec.start_column}
                   ) AS overlap
              FROM {spec.table} a
              JOIN request ra ON ra.request_id = a.request_id
             WHERE ra.status <> ALL(%(non_committed)s)
               AND a."date" >= %(today)s
               AND a."date" < %(today)s::date + %(horizon)s
          ) s
      GROUP BY day
      ORDER BY day
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {"date": r["day"].isoformat(), "rows": int(r["rows_that_day"]), "peak": int(r["peak"])}
        for r in rows
    ]


def collision_rows(cur, scope: Scope, spec: DepartmentSpec, horizon: int | None = None) -> list[dict[str, Any]]:
    """Every forward row with its overlap depth, for the collision timeline.

    Carries request_id because the caller *can* open these - a task routed to
    their unit is clause 6 of `_VISIBLE_SQL`, permanent. This is in-scope detail,
    not an R7 aggregate, and the drill-down lands on a page they may read.
    """
    if not spec.has_window:
        return []
    rows = fetch_all(
        cur,
        f"""
        SELECT a.{spec.pk} AS row_id,
               a.request_id AS request_id,
               a."date" AS day,
               a.{spec.start_column} AS start_time,
               a.{spec.end_column} AS end_time,
               a.{spec.label_column} AS label,
               a.{spec.location_column} AS location,
               r.event_title AS event_title,
               r.request_code AS request_code,
               (SELECT count(*) FROM {spec.table} b
                  JOIN request rb ON rb.request_id = b.request_id
                 WHERE b."date" = a."date"
                   AND rb.status <> ALL(%(non_committed)s)
                   AND b.{spec.start_column} < a.{spec.end_column}
                   AND b.{spec.end_column} > a.{spec.start_column}
               ) AS overlap,
               (SELECT count(*) FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s AND ra.row_id = a.{spec.pk}
               ) AS assignees
          FROM {spec.table} a
          JOIN request r ON r.request_id = a.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s
           AND a."date" < %(today)s::date + %(horizon)s
      ORDER BY a."date", a.{spec.start_column}
        """,
        _horizon_params(scope, horizon) | {"requirement": spec.requirement},
    )
    return [
        {
            "rowId": r["row_id"],
            "requestId": r["request_id"],
            "requestCode": r["request_code"],
            "date": r["day"].isoformat(),
            "start": r["start_time"].isoformat() if r["start_time"] else None,
            "end": r["end_time"].isoformat() if r["end_time"] else None,
            "label": r["label"],
            "location": r["location"],
            "eventTitle": r["event_title"],
            "overlap": int(r["overlap"]),
            "assignees": int(r["assignees"]),
        }
        for r in rows
    ]


# --- M32 · Seat-fill efficiency (Transport only) --------------------------


def seat_fill(cur, scope: Scope) -> dict[str, Any]:
    row = fetch_one(
        cur,
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fill) AS p50,
               percentile_cont(0.1) WITHIN GROUP (ORDER BY fill) AS p10,
               count(*) AS n
          FROM (
            SELECT t.requested_pax::numeric / NULLIF(o.passenger_capacity, 0) AS fill
              FROM request_transportation t
              JOIN transportation_options o ON o.transportation_option_id = t.option_id
              JOIN request r ON r.request_id = t.request_id
             WHERE r.status <> ALL(%(non_committed)s)
               AND t."date" >= %(from)s AND t."date" < %(to)s
          ) s
         WHERE fill IS NOT NULL
        """,
        _horizon_params(scope),
    )
    return {
        "median": num(row["p50"]) if row else None,
        "p10": num(row["p10"]) if row else None,
        "sample": int(row["n"]) if row else 0,
    }


def seat_fill_distribution(cur, scope: Scope) -> list[dict[str, Any]]:
    rows = fetch_all(
        cur,
        """
        SELECT t.request_transportation_id AS row_id,
               t.request_id AS request_id,
               t.requested_pax AS pax,
               o.passenger_capacity AS seats,
               o.label AS vehicle,
               t.pickup AS pickup,
               t.dropoff AS dropoff,
               t."date" AS day,
               t.requested_pax::numeric / NULLIF(o.passenger_capacity, 0) AS fill
          FROM request_transportation t
          JOIN transportation_options o ON o.transportation_option_id = t.option_id
          JOIN request r ON r.request_id = t.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND t."date" >= %(from)s AND t."date" < %(to)s
      ORDER BY fill
        """,
        _horizon_params(scope),
    )
    return [
        {
            "rowId": r["row_id"],
            "requestId": r["request_id"],
            "pax": int(r["pax"]),
            "seats": num(r["seats"]),
            "vehicle": r["vehicle"],
            "route": f"{r['pickup']} to {r['dropoff']}",
            "date": r["day"].isoformat(),
            "fill": num(r["fill"]),
        }
        for r in rows
    ]


def consolidation_candidates(cur, scope: Scope) -> list[dict[str, Any]]:
    """Same-date, same-route trip pairs both under half full whose combined pax
    fits one vehicle.

    A saving that is arithmetic rather than judgement, and invisible on every
    existing screen. Routes are normalised by lowercasing and trimming, which is
    as far as free-text pickup/dropoff can honestly be taken - a controlled place
    catalogue would do better and is out of scope.
    """
    rows = fetch_all(
        cur,
        """
        SELECT a.request_transportation_id AS a_id, a.request_id AS a_request,
               b.request_transportation_id AS b_id, b.request_id AS b_request,
               a."date" AS day,
               lower(trim(a.pickup)) || ' to ' || lower(trim(a.dropoff)) AS route,
               a.requested_pax + b.requested_pax AS combined_pax,
               o.passenger_capacity AS seats,
               o.label AS vehicle
          FROM request_transportation a
          JOIN request_transportation b
            ON b."date" = a."date"
           AND b.request_transportation_id > a.request_transportation_id
           AND lower(trim(b.pickup)) = lower(trim(a.pickup))
           AND lower(trim(b.dropoff)) = lower(trim(a.dropoff))
          JOIN transportation_options o ON o.transportation_option_id = a.option_id
          JOIN request ra ON ra.request_id = a.request_id
          JOIN request rb ON rb.request_id = b.request_id
         WHERE ra.status <> ALL(%(non_committed)s)
           AND rb.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s
           AND a.requested_pax::numeric / NULLIF(o.passenger_capacity, 0) < 0.5
           AND b.requested_pax::numeric / NULLIF(o.passenger_capacity, 0) < 0.5
           AND a.requested_pax + b.requested_pax <= o.passenger_capacity
      ORDER BY a."date"
        """,
        _horizon_params(scope),
    )
    return [
        {
            "date": r["day"].isoformat(),
            "route": r["route"],
            "combinedPax": int(r["combined_pax"]),
            "seats": num(r["seats"]),
            "vehicle": r["vehicle"],
            "requestIds": [r["a_request"], r["b_request"]],
        }
        for r in rows
    ]


# --- M33 · Group-split requirement (Student Services only) ---------------


def guide_demand(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    """M33 - guides required per forward day, per start point.

    `ceil(pax / max_group_size)` is the arithmetic that separates a manageable
    day from an impossible one, and the applicant does not know it is coming. A
    day that looks like three tours can be eleven guides.

    Tours whose start point has no cap are counted separately, never folded into
    the total: an uncapped tour would otherwise be silently worth one guide and
    under-state the day.
    """
    rows = fetch_all(
        cur,
        """
        SELECT ct."date" AS day,
               coalesce(sp.campus_tour_start_option_id, 0) AS start_point_id,
               coalesce(sp.label, ct.start_point, 'Unspecified') AS start_point,
               sp.max_group_size AS cap,
               count(*) AS tours,
               sum(ct.pax) AS pax,
               sum(CASE WHEN sp.max_group_size IS NULL THEN 0
                        ELSE ceil(ct.pax::numeric / sp.max_group_size) END) AS guides,
               count(*) FILTER (WHERE sp.max_group_size IS NULL) AS uncapped_tours,
               count(*) FILTER (WHERE sp.max_group_size IS NOT NULL
                                  AND ct.pax > sp.max_group_size) AS split_tours
          FROM request_campus_tour ct
          LEFT JOIN campus_tour_start_options sp
                 ON sp.campus_tour_start_option_id = ct.start_point_option_id
          JOIN request r ON r.request_id = ct.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND ct."date" >= %(today)s
           AND ct."date" < %(today)s::date + %(horizon)s
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 3
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {
            "date": r["day"].isoformat(),
            "startPointId": int(r["start_point_id"]) or None,
            "startPoint": r["start_point"],
            "cap": num(r["cap"]),
            "tours": int(r["tours"]),
            "pax": num(r["pax"]),
            "guides": num(r["guides"]) or 0.0,
            "uncappedTours": int(r["uncapped_tours"]),
            "splitTours": int(r["split_tours"]),
        }
        for r in rows
    ]


def uncapped_start_points(cur, scope: Scope) -> list[dict[str, Any]]:
    """Active start points with no `max_group_size` that received a tour.

    A data-quality figure promoted to a KPI because it directly governs whether
    the hero number can be trusted: each uncapped point silently under-states
    guide demand.
    """
    rows = fetch_all(
        cur,
        """
        SELECT sp.campus_tour_start_option_id AS option_id,
               sp.label AS label,
               count(ct.request_campus_tour_id) AS tours
          FROM campus_tour_start_options sp
          LEFT JOIN request_campus_tour ct
                 ON ct.start_point_option_id = sp.campus_tour_start_option_id
                AND ct."date" >= %(from)s
          WHERE sp.active AND sp.archived_at IS NULL AND sp.max_group_size IS NULL
       GROUP BY 1, 2
         HAVING count(ct.request_campus_tour_id) > 0
       ORDER BY 3 DESC
        """,
        scope.base_params,
    )
    return [{"optionId": r["option_id"], "label": r["label"], "tours": int(r["tours"])} for r in rows]


def start_point_congestion(cur, scope: Scope, horizon: int | None = None) -> list[dict[str, Any]]:
    """Tours per start point per day. `meeting_instructions` assume one group at
    the meeting point; three groups converging there at the same hour is a real
    failure the schema makes visible and nothing currently checks."""
    rows = fetch_all(
        cur,
        """
        SELECT ct."date" AS day,
               coalesce(sp.label, ct.start_point, 'Unspecified') AS start_point,
               sp.campus_tour_start_option_id AS option_id,
               sp.meeting_instructions AS instructions,
               count(*) AS tours
          FROM request_campus_tour ct
          LEFT JOIN campus_tour_start_options sp
                 ON sp.campus_tour_start_option_id = ct.start_point_option_id
          JOIN request r ON r.request_id = ct.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND ct."date" >= %(today)s
           AND ct."date" < %(today)s::date + %(horizon)s
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {
            "date": r["day"].isoformat(),
            "startPoint": r["start_point"],
            "optionId": r["option_id"],
            "instructions": r["instructions"],
            "tours": int(r["tours"]),
        }
        for r in rows
    ]


def group_sizes(cur, scope: Scope) -> list[dict[str, Any]]:
    """Every tour's pax against its start point's cap, for the calibration
    dot-plot. A cap every tour exceeds is set too low; a cap no tour approaches
    is not doing anything."""
    rows = fetch_all(
        cur,
        """
        SELECT ct.request_campus_tour_id AS row_id,
               ct.request_id AS request_id,
               ct.pax AS pax,
               ct."date" AS day,
               coalesce(sp.label, ct.start_point, 'Unspecified') AS start_point,
               sp.max_group_size AS cap
          FROM request_campus_tour ct
          LEFT JOIN campus_tour_start_options sp
                 ON sp.campus_tour_start_option_id = ct.start_point_option_id
          JOIN request r ON r.request_id = ct.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND ct."date" >= %(from)s
      ORDER BY ct.pax
        """,
        _horizon_params(scope),
    )
    return [
        {
            "rowId": r["row_id"],
            "requestId": r["request_id"],
            "pax": int(r["pax"]),
            "date": r["day"].isoformat(),
            "startPoint": r["start_point"],
            "cap": num(r["cap"]),
        }
        for r in rows
    ]


# --- M34 / M35 · Service-hour demand and staff coverage ------------------


def active_staff_count(cur, scope: Scope, unit: str | None = None) -> int:
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
    return int(row["n"]) if row else 0


def service_hour_demand(cur, scope: Scope, spec: DepartmentSpec, horizon: int | None = None) -> list[dict[str, Any]]:
    """M34 - summed row duration per forward day.

    Undefined for Transport (one `moving_time`, no end) and Student Services
    (times dropped from the tour form) - those use M31 and M33 instead. Returning
    an empty list rather than zeros keeps the difference visible.
    """
    if not spec.has_window:
        return []
    rows = fetch_all(
        cur,
        f"""
        SELECT a."date" AS day,
               sum(EXTRACT(epoch FROM (a.{spec.end_column} - a.{spec.start_column})) / 3600.0) AS hours,
               count(*) AS rows_that_day
          FROM {spec.table} a
          JOIN request r ON r.request_id = a.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s
           AND a."date" < %(today)s::date + %(horizon)s
      GROUP BY 1
      ORDER BY 1
        """,
        _horizon_params(scope, horizon),
    )
    return [
        {"date": r["day"].isoformat(), "hours": num(r["hours"]) or 0.0, "rows": int(r["rows_that_day"])}
        for r in rows
    ]


def staff_coverage(cur, scope: Scope, spec: DepartmentSpec, *, days: int = 14) -> dict[str, Any]:
    """M35 - peak forward day's hour demand as a fraction of roster capacity.

    Above 1.0 the day cannot be delivered by this roster no matter how well it
    is scheduled. It is the only number that distinguishes "busy" from
    "impossible", and it is the number that justifies a hire.

    The denominator assumes a uniform shift length (`STAFF_SHIFT_HOURS`) because
    the schema has no roster or availability model - gap G2. The assumption is
    returned with the figure so the widget can state it inline rather than in a
    footnote.
    """
    staff = active_staff_count(cur, scope)
    shift = scope.config.shift_hours(scope.unit_code)
    capacity = staff * shift
    demand = service_hour_demand(cur, scope, spec, horizon=days)
    peak = max(demand, key=lambda d: d["hours"], default=None)
    return {
        "ratio": ratio(peak["hours"], capacity) if peak and capacity else None,
        "peakDate": peak["date"] if peak else None,
        "peakHours": peak["hours"] if peak else None,
        "staff": staff,
        "shiftHours": shift,
        "capacityHours": capacity,
        "series": [{"x": d["date"], "y": ratio(d["hours"], capacity)} for d in demand],
        "assumption": f"Assumes a uniform {shift:g}h shift for {staff} active staff",
    }


def peak_day_concentration(cur, scope: Scope, spec: DepartmentSpec) -> float | None:
    """M36 - share of the period's demand falling on its three busiest days.

    Read against M35: high concentration with a manageable total means the
    problem is scheduling, not headcount, and the two have opposite remedies.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT a."date" AS day, count(*) AS n
          FROM {spec.table} a
          JOIN request r ON r.request_id = a.request_id
         WHERE r.status <> ALL(%(non_committed)s)
           AND a."date" >= %(from)s AND a."date" < %(to)s
      GROUP BY 1
        """,
        _horizon_params(scope),
    )
    counts = sorted((int(r["n"]) for r in rows), reverse=True)
    if not counts:
        return None
    return ratio(sum(counts[:3]), sum(counts))


# --- M37 · Catalogue utilisation -----------------------------------------


def catalogue_usage(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """M37 - active options ranked by selections in the period.

    Zero-selection active options are returned, not filtered out: dead weight in
    the catalogue lengthens the applicant's form for nothing, and it is only
    visible when it is on the chart.
    """
    if not spec.option_table or not spec.option_pk:
        return []
    unit_filter = "AND o.unit_code = ANY(%(outlets)s)" if spec.option_table == "fmb_options" else ""
    rows = fetch_all(
        cur,
        f"""
        SELECT o.{spec.option_pk} AS option_id,
               o.label AS label,
               count(d.{spec.pk}) AS selections
          FROM {spec.option_table} o
          LEFT JOIN {spec.table} d
                 ON d.{spec.option_fk} = o.{spec.option_pk}
          LEFT JOIN request r ON r.request_id = d.request_id
                 AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
         WHERE o.active AND o.archived_at IS NULL
           {unit_filter}
      GROUP BY 1, 2
      ORDER BY 3 DESC, 2
        """,
        scope.base_params,
    )
    return [
        {"optionId": r["option_id"], "label": r["label"], "value": int(r["selections"])}
        for r in rows
    ]


def dead_catalogue_entries(cur, scope: Scope, spec: DepartmentSpec, *, days: int = 90) -> list[dict[str, Any]]:
    """M76 - active options with no selection in the trailing window."""
    if not spec.option_table or not spec.option_pk:
        return []
    rows = fetch_all(
        cur,
        f"""
        SELECT o.{spec.option_pk} AS option_id, o.label AS label
          FROM {spec.option_table} o
         WHERE o.active AND o.archived_at IS NULL
           AND NOT EXISTS (
                SELECT 1 FROM {spec.table} d
                  JOIN request r ON r.request_id = d.request_id
                 WHERE d.{spec.option_fk} = o.{spec.option_pk}
                   AND r.submitted_at >= %(today)s::date - %(days)s
           )
      ORDER BY o.label
        """,
        scope.params(days=days),
    )
    return [{"optionId": r["option_id"], "label": r["label"]} for r in rows]


# --- M38 / M39 · F&B and cafeteria -------------------------------------


def menu_dietary_coverage(cur, scope: Scope, *, outlets: list[str] | None = None) -> dict[str, Any]:
    """M38 - dietary tags represented in each outlet's active menu.

    A cafeteria with no vegetarian item cannot serve a large share of the events
    routed to it, and nothing else in the application surfaces that. Reads the
    many-to-many table from migration 006, not the dropped single-tag column.
    """
    targets = outlets if outlets is not None else list(scope.outlets)
    tags = fetch_all(
        cur,
        """
        SELECT dietary_information_option_id AS id, label
          FROM dietary_information_options
         WHERE active AND archived_at IS NULL
      ORDER BY label
        """,
    )
    rows = fetch_all(
        cur,
        """
        SELECT o.unit_code AS code,
               coalesce(u.description, u.code) AS label,
               link.dietary_information_option_id AS tag_id,
               count(DISTINCT o.fmb_option_id) AS items
          FROM fmb_options o
          JOIN unit u ON u.code = o.unit_code
          LEFT JOIN fmb_option_dietary_information link ON link.fmb_option_id = o.fmb_option_id
         WHERE o.active AND o.archived_at IS NULL
           AND (%(all_outlets)s OR o.unit_code = ANY(%(target_outlets)s))
      GROUP BY 1, 2, 3
        """,
        scope.params(all_outlets=not targets, target_outlets=targets or [""]),
    )
    outlet_labels: dict[str, str] = {}
    cells: dict[tuple[str, int], int] = {}
    for r in rows:
        outlet_labels[r["code"]] = r["label"]
        if r["tag_id"] is not None:
            cells[(r["code"], int(r["tag_id"]))] = int(r["items"])
    return {
        "tags": [{"id": int(t["id"]), "label": t["label"]} for t in tags],
        "outlets": [{"code": code, "label": label} for code, label in sorted(outlet_labels.items())],
        "cells": [
            {"outlet": code, "tag": tag_id, "value": value}
            for (code, tag_id), value in sorted(cells.items())
        ],
    }


def outlet_load_balance(cur, scope: Scope) -> list[dict[str, Any]]:
    """M39 - order share per outlet per week.

    F&B chooses which outlet fulfils each order, so a lopsided split is a
    decision rather than weather, and a drift is worth seeing.
    """
    rows = fetch_all(
        cur,
        """
        SELECT date_trunc('week', sel.created_at)::date AS week,
               sel.unit_code AS code,
               coalesce(u.description, u.code) AS label,
               count(*) AS n
          FROM request_fmb_selection sel
          JOIN unit u ON u.code = sel.unit_code
         WHERE sel.created_at >= %(from)s AND sel.created_at < %(to)s
      GROUP BY 1, 2, 3
      ORDER BY 1, 3
        """,
        scope.base_params,
    )
    return [
        {"week": r["week"].isoformat(), "code": r["code"], "label": r["label"], "value": int(r["n"])}
        for r in rows
    ]


def order_pipeline_by_outlet(cur, scope: Scope, *, outlets: list[str] | None = None) -> list[dict[str, Any]]:
    """The F&B fan-out board: one row per outlet, counts across the lifecycle.

    `cancelled` is excluded from the bar and reported separately - a cancelled
    order is not a stage anything passes through, and stacking it would inflate
    every outlet's apparent volume.
    """
    targets = outlets if outlets is not None else list(scope.outlets)
    rows = fetch_all(
        cur,
        """
        SELECT sel.unit_code AS code,
               coalesce(u.description, u.code) AS label,
               count(*) FILTER (WHERE sel.status = 'pending')     AS pending,
               count(*) FILTER (WHERE sel.status = 'approved')    AS approved,
               count(*) FILTER (WHERE sel.status = 'preparing')   AS preparing,
               count(*) FILTER (WHERE sel.status = 'ready')       AS ready,
               count(*) FILTER (WHERE sel.status = 'fulfilled')   AS fulfilled,
               count(*) FILTER (WHERE sel.status = 'resubmitted') AS resubmitted,
               count(*) FILTER (WHERE sel.status = 'cancelled')   AS cancelled,
               count(*) AS total
          FROM request_fmb_selection sel
          JOIN unit u ON u.code = sel.unit_code
         WHERE sel.created_at >= %(from)s AND sel.created_at < %(to)s
           AND (%(all_outlets)s OR sel.unit_code = ANY(%(target_outlets)s))
      GROUP BY 1, 2
      ORDER BY 2
        """,
        scope.params(all_outlets=not targets, target_outlets=targets or [""]),
    )
    return [
        {
            "code": r["code"],
            "label": r["label"],
            "pending": int(r["pending"]),
            "approved": int(r["approved"]),
            "preparing": int(r["preparing"]),
            "ready": int(r["ready"]),
            "fulfilled": int(r["fulfilled"]),
            "resubmitted": int(r["resubmitted"]),
            "cancelled": int(r["cancelled"]),
            "total": int(r["total"]),
        }
        for r in rows
    ]
