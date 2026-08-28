"""F&B — the cost, gate and outlet dashboard.

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


# --- The dashboard as specified ------------------------------------------
# Row 1 counts, row 2 money, row 3 gate outcomes beside order distribution,
# then water. Everything below reuses the Cafeteria Manager's own components:
# the same counts strip, the same donut, the same stat tile.


@widget("fmb_request_counts")
def request_counts(cur, scope: Scope) -> dict[str, Any]:
    """Row 1 - the same strip the Cafeteria Manager gets, over every outlet.

    Identical component and identical query shape to caf_request_counts
    (widgets/cafeteria.py). The difference is the scope, and it is the one this
    module draws everywhere else: a manager's strip is filtered to their own
    outlets, F&B's is not filtered at all (see ALL_OUTLETS).

    CANCELLED replaces that strip's LATE tile. Late is a shift signal - it tells
    someone who can still go and cook that it is not cooked yet. F&B cannot act
    on that; by the time an order runs late the outlet has either delivered it
    or has not. A cancelled order is F&B's own fan-out coming back undone, which
    is what this page is about.
    """
    from ....db import fetch_all

    rows = fetch_all(
        cur,
        """
        SELECT count(*) FILTER (WHERE sel.status = 'pending') AS inbox,
               count(*) FILTER (WHERE sel.status IN ('approved', 'preparing', 'resubmitted')) AS ongoing,
               count(*) FILTER (WHERE sel.status = 'fulfilled') AS completed,
               count(*) FILTER (WHERE sel.status = 'cancelled') AS cancelled
          FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
        """,
        scope.params(),
    )
    row = rows[0] if rows else {"inbox": 0, "ongoing": 0, "completed": 0, "cancelled": 0}
    return {
        "kind": "counts",
        "items": [
            {"key": "inbox", "label": "Inbox", "value": int(row["inbox"] or 0), "status": "unknown",
             "drill": drill("/app/inbox/requests", requestKind="fmb")},
            {"key": "ongoing", "label": "Ongoing", "value": int(row["ongoing"] or 0), "status": "unknown",
             "drill": drill("/app/ongoing/requests", requestKind="fmb")},
            {"key": "completed", "label": "Completed", "value": int(row["completed"] or 0), "status": "good",
             "drill": drill("/app/history/requests", requestKind="fmb")},
            # Reads red whether or not anything is cancelled, for the reason the
            # Late tile does on the cafeteria strip: a green zero trains the eye
            # to skim the one tile on the row worth stopping for.
            {"key": "cancelled", "label": "Cancelled", "value": int(row["cancelled"] or 0), "status": "critical",
             "drill": drill("/app/history/requests", requestKind="fmb", orderStatus="cancelled")},
        ],
    }


@widget("fmb_total_cost")
def total_cost(cur, scope: Scope) -> dict[str, Any]:
    """Row 2, tile 1 - every ringgit F&B is on the hook for this period.

    Cafeteria orders plus purchase lines filed under the Food & Beverage budget
    category. Both are F&B money; only the first is an outlet's doing, which is
    what the tile beside this one separates out.

    Deliberately not the CFO's Total Spend and always smaller than it: that
    figure is every category's funding plus all food, and this is F&B's slice
    of the same money, not a second count of it.
    """
    spend = finance.fnb_spend(cur, scope)
    return kpi(
        label="Total cost",
        value=spend["total"],
        fmt=FMT_CURRENCY,
        secondary=f"RM {spend['funding']:,.0f} bought outside the cafeterias" if spend["funding"] else None,
        caption="Cafeteria orders plus Food & Beverage funding lines",
        status="unknown",
        caveat=(
            f"Based on {spend['coverage']:.0%} of ordered items carrying a price - "
            "an unpriced item counts as zero."
            if spend["coverage"] is not None and spend["coverage"] < 1
            else None
        ),
        definition="M50 committed food cost plus FIN-FNB funding lines, over live proposals",
        drill_to=drill("#panel-fmb_order_distribution"),
    )


@widget("fmb_cafeteria_cost")
def cafeteria_cost(cur, scope: Scope) -> dict[str, Any]:
    """Row 2, tile 2 - the part of Total Cost the outlets actually cooked.

    Kept apart from the total because the two answer different questions. Total
    cost is what F&B spent; this is what F&B spent THROUGH ITS OWN OUTLETS, and
    only the second moves when a fan-out decision changes. The same number is
    what the CFO's Cafeteria total cost tile shows.
    """
    spend = finance.fnb_spend(cur, scope)
    share = ratio(spend["cafeteria"], spend["total"])
    return kpi(
        label="Total cafeteria cost",
        value=spend["cafeteria"],
        fmt=FMT_CURRENCY,
        secondary=f"{share:.0%} of total cost" if share is not None else None,
        caption=f"across {spend['totalItems']} ordered menu item(s)",
        status="unknown",
        caveat=(
            f"{spend['totalItems'] - spend['pricedItems']} ordered item(s) carry no price."
            if spend["totalItems"] > spend["pricedItems"]
            else None
        ),
        definition="M50 - ordered quantity x fmb_options.unit_price_rm, cafeteria orders only",
        drill_to=drill("#panel-fmb_cost_by_outlet"),
    )


@widget("fmb_cost_per_pax")
def cost_per_pax(cur, scope: Scope) -> dict[str, Any]:
    """Row 2, tile 3 - total cost over the heads it fed.

    The same calculation and the same denominator as the CFO's cost-per-pax
    tile, so the two can be read against each other. The numerator is F&B money
    rather than all money, so this is always the smaller of the two.
    """
    result = finance.fnb_cost_per_pax(cur, scope)
    return kpi(
        label="Cost per pax",
        value=result["value"],
        fmt=FMT_CURRENCY,
        caption=f"RM {result['cost']:,.0f} over {result['pax']:,.0f} pax in {result['proposals']} proposal(s)",
        status="unknown",
        caveat=(
            "No attendance is recorded in this period, so this cannot be computed."
            if not result["pax"]
            else None
        ),
        definition="F&B total cost divided by total_pax over live proposals in the period",
        drill_to=drill("#panel-fmb_order_distribution"),
    )


@widget("fmb_change_rate")
def change_rate(cur, scope: Scope) -> dict[str, Any]:
    """Row 2, tile 4 - how often an order goes back to the outlet for changes.

    The same measurement as the old "Outlet push-back rate" (M25), renamed to
    say what happened rather than to name a behaviour. A reader who has not read
    the metric catalogue knows what "sent back for changes" means and can only
    guess at "push-back".
    """
    result = quality.order_pushback_rate(cur, scope, outlets_from_scope=False)
    per_outlet = quality.pushback_by_outlet(cur, scope)
    worst = max((o for o in per_outlet if o["rate"] is not None), key=lambda o: o["rate"], default=None)
    return kpi(
        label="Cafeteria request change rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        secondary=f"most affected: {worst['label']} at {worst['rate']:.0%}" if worst and worst["rate"] else None,
        caption=f"{result['count']} of {result['sample']} order(s) sent back for changes",
        target={"max": 0.10, "label": "target 10% or lower"},
        status=status_for(result["rate"], warn=0.10, critical=0.25),
        definition="M25 - orders returned to the cafeteria because something had to change",
        drill_to=drill("/app/inbox/requests", requestKind="fmb", orderStatus="resubmitted"),
    )


@widget("fmb_order_distribution")
def order_distribution(cur, scope: Scope) -> dict[str, Any]:
    """Row 3, beside the gate - where the orders went.

    The Cafeteria Manager's donut (caf_menu_performance) with a different
    grouping: that one splits one outlet's orders by menu item, this one splits
    every order by outlet. Same component, same shape of answer.
    """
    rows = finance.cafeteria_order_distribution(cur, scope)
    total = sum(r["orders"] for r in rows)
    lead = ratio(rows[0]["orders"], total) if rows and total else None
    return panel(
        title="Cafeteria order distribution",
        subtitle="Orders placed with each outlet this period",
        chart="donut-chart",
        data={
            "segments": [{"label": r["label"], "value": r["orders"], "code": r["code"]} for r in rows],
            "total": total,
            "totalLabel": "Orders this period",
            "format": FMT_COUNT,
        },
        table_view=table(
            [
                {"key": "label", "label": "Outlet", "format": "text"},
                {"key": "orders", "label": "Orders", "format": FMT_COUNT},
                {"key": "portions", "label": "Portions", "format": FMT_COUNT},
                {"key": "cost", "label": "Cost", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=(
            f"{rows[0]['label']} is carrying {lead:.0%} of the orders."
            if lead is not None
            else None
        ),
        empty="No orders were placed with any outlet in this period.",
        drill_to=drill("/app/history/requests", requestKind="fmb"),
    )


@widget("fmb_water_usage")
def water_usage(cur, scope: Scope) -> dict[str, Any]:
    """Mineral water requested this period, by branding.

    A bar chart rather than a donut: with-logo and without-logo are two volumes
    to compare, not two slices of something anyone thinks of as a whole, and the
    third bar is not part of that whole at all.

    Cancelled is the requested volume on proposals that died. Nothing in the
    schema records spillage or breakage, so this is the closest true measure of
    water that was asked for and then not needed - and it carries that name
    rather than a wastage label the data cannot evidence.
    """
    result = finance.water_requested(cur, scope)
    bars = [
        {"label": "With logo", "value": result["withLogo"]},
        {"label": "Without logo", "value": result["withoutLogo"]},
        {"label": "Cancelled", "value": result["cancelled"]},
    ]
    return panel(
        title="Water requested",
        subtitle="Bottles asked for this period, by branding",
        chart="bar-chart",
        series_list=[series("bottles", "Bottles", 1, [{"x": b["label"], "y": b["value"]} for b in bars])],
        axes={
            "x": {"type": "category", "label": "Branding"},
            "y": {"type": "linear", "label": "Bottles", "format": FMT_COUNT},
        },
        table_view=table(
            [
                {"key": "label", "label": "Branding", "format": "text"},
                {"key": "value", "label": "Bottles", "format": FMT_COUNT},
            ],
            bars,
        ),
        caption=(
            f"{result['total']:,} bottle(s) across {result['requests']} live request(s)."
            if result["requests"]
            else None
        ),
        empty="No mineral water was requested in this period.",
        drill_to=drill("/app/inbox/requests", requestKind="waterNormal"),
    )
