"""Food & Beverage Services — the order fan-out dashboard.

F&B wears three hats at once: a gatekeeper at `fmb_review` (the only department
that can reject a proposal outright), a department lane like the other five, and
a supply orchestrator choosing which cafeteria fulfils each order.

The signature panel is the routing decision. When the next order needs an
outlet, this is the page that answers which one — not by capacity on paper but
by measured behaviour. A Sankey would show where orders *went*, which F&B
already knows because it sent them; what it does not know is which outlet is
*slow*, and slowness is a per-outlet distribution.
"""
from __future__ import annotations

from typing import Any

from ..metrics import capacity, finance, flow, quality, risk, sla
from ..scope import Scope, delta, fold_tail, ratio, status_for
from .base import (
    FMT_COUNT,
    FMT_CURRENCY,
    FMT_DAYS,
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

# F&B sees every outlet; a Cafeteria Manager sees their own. Passing an explicit
# empty list is the difference, and it is the only difference between the two
# dashboards' order queries.
ALL_OUTLETS: list[str] = []


@widget("fmb_on_time_delivery")
def on_time_delivery(cur, scope: Scope) -> dict[str, Any]:
    """Hero — every other number on this page is a means to this end. Food that
    arrives after the session it was ordered for did not happen, whatever the
    order status says."""
    result = sla.delivery_punctuality(cur, scope)
    minutes = result["medianMinutes"]
    return hero(
        label="On-time delivery rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        caption=(
            f"{result['delivered']} delivered · {result['late']} late · median "
            f"{abs(minutes):.0f} min {'late' if minutes and minutes > 0 else 'early'}"
            if minutes is not None
            else f"{result['delivered']} delivered in period"
        ),
        target={"min": 0.95, "label": "Goal: 95% or higher"},
        status=status_for(result["rate"], minimum=0.95, critical=0.85, higher_is_better=True),
        definition="M19 — delivered_at on or before request_fmb.date + serve_time",
        empty="No orders have been delivered in this period.",
        drill_to=drill("/app/history/requests", requestKind="fmb", delivery="late"),
    )


@widget("fmb_orders_at_risk")
def orders_at_risk(cur, scope: Scope) -> dict[str, Any]:
    result = risk.orders_at_risk(cur, scope, outlets=ALL_OUTLETS)
    return kpi(
        label="Orders at risk",
        value=result["count"],
        fmt=FMT_COUNT,
        secondary=f"{result['pending']} pending · {result['approved']} unclaimed",
        caption=f"serve time inside {result['windowHours'] / 24:.0f} days",
        target={"max": 0, "label": "target 0 still pending"},
        status="critical" if result["pending"] else ("warning" if result["count"] else "good"),
        definition="An order still pending two days out is a different emergency from one preparing two hours out",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", risk="true"),
    )


@widget("fmb_gate_queue")
def gate_queue(cur, scope: Scope) -> dict[str, Any]:
    """F&B sits between HOS/HOD and the CFO; dwell here delays the CFO gate and
    every department behind it."""
    from ....db import fetch_one

    waiting = fetch_one(
        cur, "SELECT count(*) AS n FROM request WHERE status = 'fmb_review'", ()
    )
    dwell = sla.stage_dwell(cur, scope, status="fmb_review")
    median = dwell[0]["median"] if dwell else None
    return kpi(
        label="Gate queue & latency",
        value=int(waiting["n"]) if waiting else 0,
        fmt=FMT_COUNT,
        secondary=f"median dwell {median:.0f}h" if median is not None else None,
        caption="proposals waiting at fmb_review",
        target={"max": 48, "label": "target <= 48h dwell"},
        status=status_for(median, warn=48, critical=96) if median is not None else ("warning" if waiting and waiting["n"] else "good"),
        definition="M14 for the fmb_review stage",
        drill_to=drill("/app/inbox/proposals", stage="fmb-review"),
    )


@widget("fmb_pushback_rate")
def pushback_rate(cur, scope: Scope) -> dict[str, Any]:
    """A manager's send-back comes back to F&B, not to the applicant. Every
    push-back is F&B rework, usually caused by sending an order to an outlet
    that could not take it."""
    result = quality.order_pushback_rate(cur, scope, outlets_from_scope=False)
    per_outlet = quality.pushback_by_outlet(cur, scope)
    worst = max((o for o in per_outlet if o["rate"] is not None), key=lambda o: o["rate"], default=None)
    return kpi(
        label="Outlet push-back rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        secondary=f"worst: {worst['label']} at {worst['rate']:.0%}" if worst and worst["rate"] else None,
        caption=f"{result['count']} of {result['sample']} orders bounced",
        target={"max": 0.10, "label": "target <= 10%"},
        status=status_for(result["rate"], warn=0.10, critical=0.25),
        definition="M25 read from the F&B side — my orders get bounced",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", orderStatus="resubmitted"),
    )


@widget("fmb_committed_cost")
def committed_cost(cur, scope: Scope) -> dict[str, Any]:
    """The total is the number people quote; the coverage is what makes it
    honest. Showing one without the other is how a spend figure quietly
    understates."""
    current = finance.committed_food_cost(cur, scope)
    previous = finance.committed_food_cost(cur, scope, previous=True)
    coverage = current["coverage"]
    return kpi(
        label="Committed food cost",
        value=current["total"],
        fmt=FMT_CURRENCY,
        caption=f"{current['totalItems']} ordered lines",
        caveat=(
            f"Based on {coverage:.0%} of items priced — unpriced menu items contribute nothing to this total."
            if coverage is not None and coverage < 1
            else None
        ),
        status="warning" if coverage is not None and coverage < 0.8 else "good",
        delta=delta(current["total"], previous["total"], higher_is_better=False),
        definition="M50 with M58 coverage",
        drill_to=drill("#panel-fmb_cost_by_outlet"),
    )


@widget("fmb_water_runway")
def water_runway(cur, scope: Scope) -> dict[str, Any]:
    """The one genuine inventory constraint F&B owns; every other F&B resource
    is a cafeteria's kitchen."""
    result = capacity.water_runway_days(cur, scope)
    return kpi(
        label="Water stock runway",
        value=result["days"],
        fmt=FMT_DAYS,
        secondary=f"{result['label']} on {result['date']}" if result["label"] else None,
        caption="days until committed bottles exceed stock" if result["days"] is not None else "no breach in the horizon",
        target={"min": 14, "label": "target >= 14 days"},
        status=status_for(result["days"], minimum=14, critical=3, higher_is_better=True) if result["days"] is not None else "good",
        definition="M30, water variant",
        drill_to=drill("/app/dropdown-options/waterNormal"),
    )


@widget("fmb_fanout_board")
def fanout_board(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — one row per outlet, the order lifecycle as a stacked
    bar, with acceptance, claim and push-back beside it."""
    outlets = capacity.order_pipeline_by_outlet(cur, scope, outlets=ALL_OUTLETS)
    pushbacks = {o["code"]: o for o in quality.pushback_by_outlet(cur, scope)}
    rows = []
    for outlet in outlets:
        accept = sla.order_accept_latency(cur, scope, outlet=outlet["code"])
        claim = sla.order_claim_latency(cur, scope, outlet=outlet["code"])
        rows.append(
            {
                **outlet,
                "acceptMedian": accept["median"],
                "claimMedian": claim["median"],
                "pushbackRate": pushbacks.get(outlet["code"], {}).get("rate"),
            }
        )
    cancelled = sum(o["cancelled"] for o in outlets)
    stages = ("pending", "approved", "preparing", "ready", "fulfilled")
    return panel(
        title="Order fan-out board",
        subtitle="Every outlet's live order mix, with measured acceptance and claim times",
        chart="stacked-bar",
        series_list=[
            series(
                stage,
                stage.capitalize(),
                index,
                [{"x": row[stage], "label": row["label"], "code": row["code"]} for row in rows],
                rampStep=250 + index * 75,
            )
            for index, stage in enumerate(stages, start=1)
        ],
        axes={"x": {"type": "linear", "label": "Orders", "format": FMT_COUNT}, "y": {"type": "category", "label": "Outlet"}},
        data={"rows": rows},
        table_view=table(
            [
                {"key": "label", "label": "Outlet", "format": "text"},
                {"key": "pending", "label": "Pending", "format": FMT_COUNT},
                {"key": "approved", "label": "Approved", "format": FMT_COUNT},
                {"key": "preparing", "label": "Preparing", "format": FMT_COUNT},
                {"key": "ready", "label": "Ready", "format": FMT_COUNT},
                {"key": "fulfilled", "label": "Fulfilled", "format": FMT_COUNT},
                {"key": "acceptMedian", "label": "Accept p50 (h)", "format": FMT_HOURS},
                {"key": "claimMedian", "label": "Claim p50 (h)", "format": FMT_HOURS},
                {"key": "pushbackRate", "label": "Push-back", "format": FMT_PERCENT},
            ],
            rows,
        ),
        caption=(
            f"{cancelled} cancelled order(s) are excluded from the bars — a cancellation is not a stage anything "
            "passes through."
        ),
        caveat=sla.approximate_since(scope),
        empty="No orders have been placed with any outlet in this period.",
        filters=["outlet", "menuItem"],
        drill_to=drill("/app/inbox/requests", requestKind="fmb"),
        signature=True,
        mobile="ranked-list",
    )


@widget("fmb_gate_outcomes")
def gate_outcomes(cur, scope: Scope) -> dict[str, Any]:
    """The only department dashboard carrying a rejection series, because it is
    the only department that can reject."""
    rows = quality.gate_outcomes_by_period(cur, scope, stage="fmb_review")
    return panel(
        title="Gate outcomes",
        subtitle="Decisions at fmb_review, per week",
        chart="stacked-bar",
        series_list=[
            series("approved", "Approved", 1, [{"x": r["x"], "y": r["approved"]} for r in rows]),
            series("sentBack", "Sent back", 2, [{"x": r["x"], "y": r["sentBack"]} for r in rows]),
            series("rejected", "Rejected", 8, [{"x": r["x"], "y": r["rejected"]} for r in rows]),
        ],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Proposals", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "x", "label": "Week", "format": "date"},
                {"key": "approved", "label": "Approved", "format": FMT_COUNT},
                {"key": "sentBack", "label": "Sent back", "format": FMT_COUNT},
                {"key": "rejected", "label": "Rejected", "format": FMT_COUNT},
            ],
            rows,
        ),
        empty="No decisions were taken at this gate in the period.",
        drill_to=drill("/app/history/proposals", stage="fmb-review"),
        mobile="scroll",
    )


@widget("fmb_outlet_balance")
def outlet_balance(cur, scope: Scope) -> dict[str, Any]:
    """F&B chooses the split, so a drift is a decision worth seeing."""
    rows = capacity.outlet_load_balance(cur, scope)
    weeks = sorted({r["week"] for r in rows})
    totals: dict[str, int] = {}
    labels: dict[str, str] = {}
    for row in rows:
        totals[row["code"]] = totals.get(row["code"], 0) + row["value"]
        labels[row["code"]] = row["label"]
    ranked = sorted(({"label": code, "value": value} for code, value in totals.items()), key=lambda r: -r["value"])
    kept = fold_tail(scope, ranked, limit=3)
    kept_codes = [r["label"] for r in kept if not r.get("isOther")]

    def points_for(codes: set[str]) -> list[dict[str, Any]]:
        out = []
        for week in weeks:
            in_week = [r for r in rows if r["week"] == week]
            total = sum(r["value"] for r in in_week) or None
            value = sum(r["value"] for r in in_week if r["code"] in codes)
            out.append({"x": week, "y": ratio(value, total)})
        return out

    series_list = [
        series(code, labels[code], index, points_for({code}))
        for index, code in enumerate(kept_codes, start=1)
    ]
    if any(r.get("isOther") for r in kept):
        series_list.append(series("other", "Other", 4, points_for(set(totals) - set(kept_codes))))

    return panel(
        title="Outlet allocation balance",
        subtitle="Share of orders per outlet, per week",
        chart="line-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Share", "format": FMT_PERCENT}},
        table_view=table(
            [
                {"key": "week", "label": "Week", "format": "date"},
                {"key": "label", "label": "Outlet", "format": "text"},
                {"key": "value", "label": "Orders", "format": FMT_COUNT},
            ],
            rows,
        ),
        empty="No orders have been placed with any outlet in this period.",
    )


@widget("fmb_cost_by_outlet")
def cost_by_outlet(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.cost_by_outlet(cur, scope, outlets=ALL_OUTLETS)
    thin = [r for r in rows if r["coverage"] is not None and r["coverage"] < 0.8]
    return panel(
        title="Committed food cost by outlet",
        subtitle="Ordered quantity × menu price, this period",
        chart="bar-chart",
        series_list=[
            series(
                "cost",
                "Committed cost",
                1,
                [
                    {
                        "x": r["value"],
                        "label": r["label"],
                        "code": r["code"],
                        "annotation": f"{r['coverage']:.0%} priced" if r["coverage"] is not None else None,
                        "warn": bool(r["coverage"] is not None and r["coverage"] < 0.8),
                    }
                    for r in rows
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "RM", "format": FMT_CURRENCY}},
        table_view=table(
            [
                {"key": "label", "label": "Outlet", "format": "text"},
                {"key": "value", "label": "Committed cost", "format": FMT_CURRENCY},
                {"key": "coverage", "label": "Price coverage", "format": FMT_PERCENT},
            ],
            rows,
        ),
        caption=(
            f"{len(thin)} outlet(s) are under 80% priced — those bars understate by an unknown amount."
            if thin
            else None
        ),
        empty="No orders have been placed with any outlet in this period.",
        drill_to=drill("/app/cafeterias/menu-oversight"),
        mobile="ranked-list",
    )


@widget("fmb_water_meter")
def water_meter(cur, scope: Scope) -> dict[str, Any]:
    """A meter, not a pie — it is one ratio against one limit."""
    rows = capacity.water_commitment(cur, scope)
    warn = scope.config.capacity_warn(scope.unit_code)
    return panel(
        title="Water stock runway",
        subtitle="Committed bottles against available stock",
        chart="meter",
        data={
            "meters": [
                {
                    "label": r["label"],
                    "optionId": r["optionId"],
                    "value": r["ratio"],
                    "committed": r["committed"],
                    "available": r["available"],
                    "status": status_for(r["ratio"], warn=warn, critical=1.0),
                }
                for r in rows
            ]
        },
        table_view=table(
            [
                {"key": "label", "label": "Pack", "format": "text"},
                {"key": "committed", "label": "Committed", "format": FMT_COUNT},
                {"key": "available", "label": "Available", "format": FMT_COUNT},
                {"key": "ratio", "label": "Ratio", "format": FMT_PERCENT},
            ],
            rows,
        ),
        empty="No mineral water packs are configured.",
        drill_to=drill("/app/dropdown-options/waterNormal"),
    )


@widget("fmb_dietary_coverage")
def dietary_coverage(cur, scope: Scope) -> dict[str, Any]:
    """An outlet with no halal or no vegetarian item cannot serve a large share
    of campus events, and nothing else in the application surfaces that."""
    matrix = capacity.menu_dietary_coverage(cur, scope, outlets=ALL_OUTLETS)
    filled = {(c["outlet"], c["tag"]) for c in matrix["cells"] if c["value"]}
    gaps = [
        {"outlet": o["label"], "tag": t["label"]}
        for o in matrix["outlets"]
        for t in matrix["tags"]
        if (o["code"], t["id"]) not in filled
    ]
    return panel(
        title="Dietary coverage across outlets",
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
        caption=f"{len(gaps)} outlet/tag combination(s) have no menu item at all — each carries a ring and a glyph.",
        empty="No active menu items are configured.",
        drill_to=drill("/app/cafeterias/menu-oversight"),
        mobile="breach-list",
    )


@widget("fmb_order_lifecycle")
def order_lifecycle(cur, scope: Scope) -> dict[str, Any]:
    """Names which segment is degrading: accept is the manager's, claim is the
    roster's, prepare is the kitchen's. Three different remedies."""
    from ....db import fetch_all

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
         WHERE sel.created_at >= %(from)s AND sel.created_at < %(to)s
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
        chart="column-chart",
        series_list=[
            series("accept", "Accept", 1, [{"x": r["x"], "y": r["accept"]} for r in data]),
            series("prepare", "Prepare", 2, [{"x": r["x"], "y": r["prepare"]} for r in data]),
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
        caveat=sla.approximate_since(scope),
        empty="No orders have been placed in this period.",
    )


@widget("fmb_at_risk")
def at_risk(cur, scope: Scope) -> dict[str, Any]:
    result = risk.orders_at_risk(cur, scope, outlets=ALL_OUTLETS)
    unpriced = risk.unpriced_ordered_items(cur, scope, outlets=ALL_OUTLETS)
    stranded = risk.stranded_at_gate(cur, scope)
    return panel(
        title="At risk right now",
        subtitle=f"Live orders inside the next {result['windowHours'] / 24:.0f} days",
        chart="alert-list",
        data={
            "counts": result,
            "unpriced": unpriced,
            "stranded": stranded,
        },
        table_view=table(
            [
                {"key": "label", "label": "Unpriced item with live orders", "format": "text"},
                {"key": "orders", "label": "Orders", "format": FMT_COUNT},
            ],
            unpriced,
        ),
        empty="Nothing is inside the risk window.",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", risk="true"),
    )
