"""Cafeteria Manager — the shift dashboard.

The most-used of the ten and the only one whose hero is a live count rather
than a rate. A shift manager's lead number is not an efficiency ratio, it is
"what is about to go wrong", and the status split names the person to call:
`pending` needs the manager to accept, `approved` needs someone to claim,
`preparing` needs a nudge.

Scope is `units_for_role('cafeteria-manager')` (rule R5). A manager holding two
outlets gets **one** dashboard with an outlet switcher and a grouped view — not
two dashboards, never an average across outlets, and never another manager's
outlet.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ....db import fetch_all
from ..metrics import capacity, finance, flow, people, quality, risk, sla
from ..scope import Scope, ratio, status_for
from .base import (
    FMT_COUNT,
    FMT_CURRENCY,
    FMT_HOURS,
    FMT_PERCENT,
    drill,
    hero,
    kpi,
    panel,
    series,
    table,
    widget,
)


@widget("caf_orders_at_risk")
def orders_at_risk(cur, scope: Scope) -> dict[str, Any]:
    result = risk.orders_at_risk(cur, scope)
    return hero(
        label="Orders at risk right now",
        value=result["count"],
        fmt=FMT_COUNT,
        caption=(
            f"{result['pending']} to accept · {result['approved']} unclaimed · {result['preparing']} in the kitchen"
            + (f" · nearest {result['soonest']}" if result["soonest"] else "")
        ),
        target={"max": 0, "label": "0 pending, 0 unclaimed inside 4h of serve time"},
        status="critical" if result["pending"] or result["approved"] else ("warning" if result["count"] else "good"),
        definition="Live orders whose serve time falls inside the risk window, split by state",
        empty="Nothing is due inside the risk window.",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", risk="true"),
    )


@widget("caf_claim_latency")
def claim_latency(cur, scope: Scope) -> dict[str, Any]:
    """The shared pool's health, and the only number that distinguishes "my
    kitchen is slow" from "nobody picked it up". A manager cannot assign an
    order; they can only staff the pool and nudge."""
    result = sla.order_claim_latency(cur, scope)
    target = scope.config.number("SLA_ORDER_CLAIM_HOURS", 4)
    return kpi(
        label="Claim latency",
        value=result["median"],
        fmt=FMT_HOURS,
        secondary=f"p90 {result['p90']:.1f}h" if result["p90"] is not None else None,
        caption=f"{result['sample']} claimed orders in period",
        target={"max": target, "label": f"target <= {target:g}h"},
        status=status_for(result["median"], warn=target, critical=target * 3),
        definition="M18 — accepted → claimed out of the shared pool",
        caveat=sla.approximate_since(scope, short=True),
        drill_to=drill("#panel-caf_order_lifecycle"),
    )


@widget("caf_on_time")
def on_time(cur, scope: Scope) -> dict[str, Any]:
    """In combined mode, one figure per outlet, never an average — averaging two
    outlets hides the one that is failing."""
    combined = sla.delivery_punctuality(cur, scope)
    per_outlet = [
        {"outlet": code, "label": scope.outlet_labels.get(code, code), **sla.delivery_punctuality(cur, scope, outlet=code)}
        for code in scope.outlets
    ]
    worst = min(
        (o for o in per_outlet if o["rate"] is not None), key=lambda o: o["rate"], default=None
    )
    return kpi(
        label="On-time delivery",
        value=combined["rate"],
        fmt=FMT_PERCENT,
        secondary=(
            f"lowest: {worst['label']} at {worst['rate']:.0%}" if worst and len(per_outlet) > 1 else None
        ),
        caption=(
            f"median {abs(combined['medianMinutes']):.0f} min "
            f"{'late' if combined['medianMinutes'] and combined['medianMinutes'] > 0 else 'early'}"
            if combined["medianMinutes"] is not None
            else f"{combined['delivered']} delivered in period"
        ),
        target={"min": 0.95, "label": "target >= 95%"},
        status=status_for(combined["rate"], minimum=0.95, critical=0.85, higher_is_better=True),
        definition="M19 per outlet, grouped rather than averaged",
        drill_to=drill("/app/history/requests", requestKind="fmb", delivery="late"),
    )


@widget("caf_menu_readiness")
def menu_readiness(cur, scope: Scope) -> dict[str, Any]:
    """An unpriced item is an order the manager cannot value and F&B's cost
    figure cannot count. It is the manager's own data to fix, on a page they
    already own."""
    result = finance.price_coverage(cur, scope)
    return kpi(
        label="Menu readiness",
        value=result["coverage"],
        fmt=FMT_PERCENT,
        secondary=(
            f"{result['unpricedWithLiveOrders']} unpriced with live orders"
            if result["unpricedWithLiveOrders"]
            else None
        ),
        caption=f"{result['priced']} of {result['items']} active items priced",
        target={"min": 1.0, "label": "target 100%"},
        status=(
            "critical"
            if result["unpricedWithLiveOrders"]
            else status_for(result["coverage"], minimum=1.0, critical=0.8, higher_is_better=True)
        ),
        definition="M58 with M75",
        drill_to=drill("/app/menu", unpriced="true"),
    )


@widget("caf_staff_availability")
def staff_availability(cur, scope: Scope) -> dict[str, Any]:
    """The manager's staffing lever runs through Cafeteria Admin, and the wait
    is part of the plan."""
    result = people.staff_availability(cur, scope)
    return kpi(
        label="Staff availability",
        value=result["active"],
        fmt=FMT_COUNT,
        secondary=f"{result['suspended']} suspended" if result["suspended"] else None,
        caption=(
            f"{result['arrivals']} added · {result['departures']} suspended or removed this period"
            if result["arrivals"] or result["departures"]
            else "no roster changes this period"
        ),
        target={"min": 2, "label": "target >= 2 active per outlet"},
        status="critical" if result["active"] < 2 else "good",
        definition="Active cafeteria-staff assignments, with audit-log churn",
        caveat="Staffing requests were removed in migration 015 — a manager now creates staff directly, so there is no pending queue to report.",
        drill_to=drill("/app/cafeterias/my-staff"),
    )


@widget("caf_pushback_rate")
def pushback_rate(cur, scope: Scope) -> dict[str, Any]:
    """The same number F&B reads as "this outlet bounces orders". Seeing their
    own figure lets the manager know how they look upstream."""
    result = quality.order_pushback_rate(cur, scope)
    return kpi(
        label="Push-back rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        caption=f"{result['count']} of {result['sample']} orders sent back to F&B",
        target={"max": 0.10, "label": "target <= 10%"},
        status=status_for(result["rate"], warn=0.10, critical=0.25),
        definition="M25 read from the outlet side — I bounce orders",
        drill_to=drill("/app/history/requests", requestKind="fmb", orderStatus="resubmitted"),
    )


@widget("caf_service_board")
def service_board(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — one lane per day for the next seven days, each order a
    block at its serve time.

    Ordered by serve time and not order date: the manager's day is organised by
    when food must leave the kitchen. Ordering this board by anything else would
    be a chart of someone else's schedule.
    """
    hours = scope.config.risk_window_days() * 24
    rows = fetch_all(
        cur,
        """
        SELECT sel.request_fmb_selection_id AS selection_id,
               sel.unit_code AS outlet,
               sel.menu_item_label AS item,
               sel.quantity AS quantity,
               sel.status AS status,
               f."date" AS day,
               f.serve_time AS serve_time,
               f.location AS location,
               f.request_id AS request_id,
               r.event_title AS event_title,
               claimer.full_name AS claimed_by,
               sel.approved_at AS approved_at
          FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
          LEFT JOIN users claimer ON claimer.user_id = sel.claimed_by_user_id
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND sel.status NOT IN ('cancelled')
           AND r.status NOT IN ('cancelled', 'completed_rejected', 'draft')
           AND f."date" >= %(today)s
           AND f."date" < %(today)s::date + 7
      ORDER BY f."date", f.serve_time
        """,
        scope.base_params,
    )
    lanes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    items = []
    for row in rows:
        entry = {
            "selectionId": row["selection_id"],
            "requestId": row["request_id"],
            "outlet": row["outlet"],
            "outletLabel": scope.outlet_labels.get(row["outlet"], row["outlet"]),
            "label": row["item"],
            "quantity": int(row["quantity"]),
            "status": row["status"],
            "date": row["day"].isoformat(),
            "start": row["serve_time"].isoformat() if row["serve_time"] else None,
            "end": row["serve_time"].isoformat() if row["serve_time"] else None,
            "location": row["location"],
            "eventTitle": row["event_title"],
            "claimedBy": row["claimed_by"],
            "unclaimed": row["status"] == "approved",
            "unaccepted": row["status"] == "pending",
        }
        lanes[entry["date"]].append(entry)
        items.append(entry)
    return panel(
        title="Outlet service board",
        subtitle=f"The next 7 days, in serve-time order · risk window {hours / 24:.0f} days",
        chart="timeline-chart",
        data={
            "lanes": [
                {"key": day, "label": day, "bars": blocks, "peak": len(blocks), "breached": False}
                for day, blocks in sorted(lanes.items())
            ],
            "ceiling": None,
            "riskWindowHours": hours,
        },
        axes={"x": {"type": "time", "label": "Serve time"}, "y": {"type": "category", "label": "Date"}},
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "start", "label": "Serve", "format": "time"},
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "quantity", "label": "Qty", "format": FMT_COUNT},
                {"key": "location", "label": "Venue", "format": "text"},
                {"key": "status", "label": "State", "format": "text"},
                {"key": "claimedBy", "label": "Claimed by", "format": "text"},
            ],
            items,
        ),
        caption="Unclaimed approved blocks carry a hatched fill, so “nobody has this” is visible without reading the label.",
        empty="Nothing is due at your outlets in the next 7 days.",
        filters=["outlet", "state", "riskOnly"],
        drill_to=drill("/app/inbox/requests", requestKind="fmb"),
        signature=True,
        mobile="time-list",
    )


@widget("caf_claim_distribution")
def claim_distribution(cur, scope: Scope) -> dict[str, Any]:
    staff = people.claim_distribution(cur, scope)
    balance = people.workload_balance(staff)
    return panel(
        title="Claim distribution",
        subtitle="Orders claimed per staff member this period",
        chart="dot-plot",
        series_list=[
            series(
                "staff",
                "Staff",
                1,
                [{"x": s["value"], "label": s["name"], "userId": s["userId"], "share": s["share"]} for s in staff],
            )
        ],
        axes={"x": {"type": "linear", "label": "Orders claimed", "format": FMT_COUNT}},
        annotations=(
            [{"type": "reference", "axis": "x", "value": balance["median"], "label": "outlet median"}]
            if balance["median"]
            else []
        ),
        table_view=table(
            [
                {"key": "name", "label": "Staff", "format": "text"},
                {"key": "value", "label": "Claimed", "format": FMT_COUNT},
                {"key": "share", "label": "Share", "format": FMT_PERCENT},
                {"key": "medianHours", "label": "Median handling (h)", "format": FMT_HOURS},
            ],
            staff,
        ),
        caption="First-come-first-served claiming lets one person take most of the pool while others idle.",
        empty="No orders were claimed at your outlets in this period.",
        mobile="ranked-list",
    )


@widget("caf_order_lifecycle")
def order_lifecycle(cur, scope: Scope) -> dict[str, Any]:
    rows = fetch_all(
        cur,
        """
        SELECT date_trunc('week', sel.created_at)::date AS week,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM sel.approved_at - sel.created_at) / 3600.0) AS accept_h,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM sel.ready_at - sel.approved_at) / 3600.0) AS prepare_h,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM sel.delivered_at - sel.ready_at) / 3600.0) AS deliver_h,
               count(*) AS n
          FROM request_fmb_selection sel
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND sel.created_at >= %(from)s AND sel.created_at < %(to)s
      GROUP BY 1
      ORDER BY 1
        """,
        scope.base_params,
    )
    data = [
        {
            "x": r["week"].isoformat(),
            "accept": max(0.0, float(r["accept_h"] or 0)),
            "prepare": max(0.0, float(r["prepare_h"] or 0)),
            "deliver": max(0.0, float(r["deliver_h"] or 0)),
            "sample": int(r["n"]),
        }
        for r in rows
    ]
    return panel(
        title="Order lifecycle latency",
        subtitle="Median hours per week: accept, prepare, deliver",
        chart="stacked-bar",
        series_list=[
            series("accept", "Accept (yours)", 1, [{"x": r["x"], "y": r["accept"]} for r in data]),
            series("prepare", "Prepare (kitchen)", 2, [{"x": r["x"], "y": r["prepare"]} for r in data]),
            series("deliver", "Deliver", 3, [{"x": r["x"], "y": r["deliver"]} for r in data]),
        ],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Hours", "format": FMT_HOURS}},
        table_view=table(
            [
                {"key": "x", "label": "Week", "format": "date"},
                {"key": "accept", "label": "Accept (h)", "format": FMT_HOURS},
                {"key": "prepare", "label": "Prepare (h)", "format": FMT_HOURS},
                {"key": "deliver", "label": "Deliver (h)", "format": FMT_HOURS},
            ],
            data,
        ),
        caption="Accept is yours; claim is the roster's; prepare is the kitchen's. Three different remedies.",
        caveat=sla.approximate_since(scope),
        empty="No orders were placed at your outlets in this period.",
    )


@widget("caf_menu_performance")
def menu_performance(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.menu_performance(cur, scope)
    unpriced = [r for r in rows if r["unpriced"]]
    return panel(
        title="Menu performance",
        subtitle="Menu items by order volume, with revenue",
        chart="bar-chart",
        series_list=[
            series(
                "orders",
                "Orders",
                1,
                [
                    {
                        "x": r["value"],
                        "label": r["label"],
                        "optionId": r["optionId"],
                        "annotation": (f"RM {r['revenue']:,.0f}" if not r["unpriced"] else "no price"),
                        "warn": r["unpriced"],
                        "muted": r["value"] == 0,
                    }
                    for r in rows
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Orders", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "value", "label": "Orders", "format": FMT_COUNT},
                {"key": "portions", "label": "Portions", "format": FMT_COUNT},
                {"key": "revenue", "label": "Revenue", "format": FMT_CURRENCY},
                {"key": "price", "label": "Unit price", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=(
            f"{len(unpriced)} item(s) carry no price — their revenue reads zero and is not zero."
            if unpriced
            else "Two decisions on one chart: what to promote, and what to retire."
        ),
        empty="No menu items are configured at your outlets.",
        drill_to=drill("/app/menu"),
        mobile="ranked-list",
    )


@widget("caf_dietary_coverage")
def dietary_coverage(cur, scope: Scope) -> dict[str, Any]:
    matrix = capacity.menu_dietary_coverage(cur, scope)
    filled = {(c["outlet"], c["tag"]) for c in matrix["cells"] if c["value"]}
    gaps = [
        {"outlet": o["label"], "tag": t["label"]}
        for o in matrix["outlets"]
        for t in matrix["tags"]
        if (o["code"], t["id"]) not in filled
    ]
    return panel(
        title="Dietary coverage",
        subtitle="Active menu items carrying each dietary tag",
        chart="heatmap",
        data={
            "rows": [o["label"] for o in matrix["outlets"]],
            "rowKeys": [o["code"] for o in matrix["outlets"]],
            "columns": [t["label"] for t in matrix["tags"]],
            "columnKeys": [t["id"] for t in matrix["tags"]],
            "cells": matrix["cells"],
            "emptyIsBreach": True,
        },
        axes={"x": {"type": "category", "label": "Dietary tag"}, "y": {"type": "category", "label": "Outlet"}},
        table_view=table(
            [
                {"key": "outlet", "label": "Outlet", "format": "text"},
                {"key": "tag", "label": "Uncovered tag", "format": "text"},
            ],
            gaps,
        ),
        caption=f"{len(gaps)} dietary requirement(s) have no item covering them at your outlets.",
        empty="No active menu items are configured at your outlets.",
        drill_to=drill("/app/menu"),
        mobile="breach-list",
    )


@widget("caf_staffing_timeline")
def staffing_timeline(cur, scope: Scope) -> dict[str, Any]:
    """The audit log drawn to scale. A manager arguing for faster roster
    turnaround has the evidence rather than an impression."""
    events = people.staffing_timeline(cur, scope)
    lanes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        lanes[event["name"]].append(
            {
                "date": event["at"][:10],
                "start": event["at"][11:19],
                "end": event["at"][11:19],
                "label": event["action"],
                "location": scope.outlet_labels.get(event["outlet"], event["outlet"]),
                "overlap": 1,
                "assignees": 1,
                "status": event["action"],
            }
        )
    return panel(
        title="Staffing timeline",
        subtitle="Roster changes at your outlets",
        chart="timeline-chart",
        data={
            "lanes": [{"key": name, "label": name, "bars": bars} for name, bars in sorted(lanes.items())],
            "ceiling": None,
            "mode": "events",
        },
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "category", "label": "Staff member"}},
        table_view=table(
            [
                {"key": "at", "label": "When", "format": "datetime"},
                {"key": "name", "label": "Staff", "format": "text"},
                {"key": "action", "label": "Action", "format": "text"},
                {"key": "actor", "label": "By", "format": "text"},
            ],
            events,
        ),
        empty="No roster changes were recorded at your outlets in this period.",
        drill_to=drill("/app/cafeterias/staff-requests-history"),
        mobile="time-list",
    )


@widget("caf_forward_demand")
def forward_demand(cur, scope: Scope) -> dict[str, Any]:
    """Orders and total portions on one axis — both counts. Portions rising
    faster than orders means larger orders, which is a kitchen-capacity signal
    rather than a throughput one."""
    rows = fetch_all(
        cur,
        """
        SELECT f."date" AS day, count(*) AS orders, sum(sel.quantity) AS portions
          FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
         WHERE sel.unit_code = ANY(%(outlets)s)
           AND sel.status <> 'cancelled'
           AND r.status NOT IN ('cancelled', 'completed_rejected', 'draft')
           AND f."date" >= %(today)s
           AND f."date" < %(today)s::date + %(horizon)s
      GROUP BY 1
      ORDER BY 1
        """,
        scope.base_params,
    )
    data = [
        {"x": r["day"].isoformat(), "orders": int(r["orders"]), "portions": float(r["portions"] or 0)}
        for r in rows
    ]
    return panel(
        title="Forward order demand",
        subtitle="Orders and portions per day at your outlets",
        chart="area-chart",
        series_list=[
            series("orders", "Orders", 1, [{"x": r["x"], "y": r["orders"]} for r in data]),
            series("portions", "Portions", 2, [{"x": r["x"], "y": r["portions"]} for r in data]),
        ],
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Count", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "x", "label": "Date", "format": "date"},
                {"key": "orders", "label": "Orders", "format": FMT_COUNT},
                {"key": "portions", "label": "Portions", "format": FMT_COUNT},
            ],
            data,
        ),
        caption="Portions rising faster than orders means larger orders — a kitchen-capacity signal.",
        empty="Nothing is booked at your outlets in the forward horizon.",
        drill_to=drill("/app/inbox/requests", requestKind="fmb"),
    )


@widget("caf_at_risk")
def at_risk(cur, scope: Scope) -> dict[str, Any]:
    result = risk.orders_at_risk(cur, scope)
    unpriced = risk.unpriced_ordered_items(cur, scope)
    claims = people.claim_distribution(cur, scope)
    total_claimed = sum(c["value"] for c in claims)
    hog = next((c for c in claims if c["share"] and c["share"] > 0.6), None) if total_claimed >= 5 else None
    return panel(
        title="Needs attention",
        subtitle="Right now, at your outlets",
        chart="alert-list",
        data={"counts": result, "unpriced": unpriced, "claimConcentration": hog},
        table_view=table(
            [
                {"key": "label", "label": "Unpriced item with live orders", "format": "text"},
                {"key": "orders", "label": "Orders", "format": FMT_COUNT},
            ],
            unpriced,
        ),
        empty="Nothing needs attention right now.",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", risk="true"),
    )
