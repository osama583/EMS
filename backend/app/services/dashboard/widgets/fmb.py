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


@widget("fmb_gate_outcomes")
def gate_outcomes(cur, scope: Scope) -> dict[str, Any]:
    """The only department dashboard carrying a rejection series, because it is
    the only department that can reject."""
    rows = quality.gate_outcomes_by_period(cur, scope, stage="fmb_review")
    return panel(
        title="Gate outcomes",
        subtitle="Decisions at fmb_review, per week",
        # Grouped columns, not stacked.
        chart="column-chart",
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

    **Only `completed` respects the reporting period**, for the reason set out
    at flow.request_bucket_counts: the other tiles are backlog, and windowing a
    backlog hides live work that happens to be old. A fulfilled order is
    counted against its own service date rather than a row timestamp, because
    `request_fmb_selection` carries no completion column and the date the food
    was served is the date the work happened.
    """
    from ....db import fetch_all

    rows = fetch_all(
        cur,
        """
        SELECT count(*) FILTER (WHERE sel.status = 'pending') AS inbox,
               count(*) FILTER (WHERE sel.status IN ('approved', 'preparing', 'resubmitted')) AS ongoing,
               count(*) FILTER (
                   WHERE sel.status = 'fulfilled'
                     AND f."date" >= %(from)s AND f."date" < %(to)s
               ) AS completed,
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

    Budget cost plus cafeteria food cost - the shared definition in
    finance.total_cost_split, so this tile and the CFO's Total spend are the
    same number rather than two totals that differ by what each counted.

    The tile beside this one is the cafeteria half on its own.
    """
    spend = finance.total_cost_split(cur, scope)
    return kpi(
        label="Total cost",
        value=spend["total"],
        fmt=FMT_CURRENCY,
        secondary=f"RM {spend['budget']:,.0f} budget + RM {spend['cafeteria']:,.0f} cafeteria",
        caption="Budget cost plus cafeteria food requests",
        status="unknown",
        caveat=(
            f"Based on {spend['coverage']:.0%} of ordered items carrying a price - "
            "an unpriced item counts as zero."
            if spend["coverage"] is not None and spend["coverage"] < 1
            else None
        ),
        definition="M51 budget commitment plus M50 committed food cost, over live proposals",
        drill_to=drill("#panel-fmb_order_distribution"),
    )


@widget("fmb_cafeteria_cost")
def cafeteria_cost(cur, scope: Scope) -> dict[str, Any]:
    """Row 2, tile 2 - the part of Total Cost the outlets actually cooked.

    Food requested from the cafeterias, and nothing else - the budget half of
    the total is deliberately excluded here. Only this number moves when a
    fan-out decision changes, and it is the same figure the CFO's Cafeteria
    total cost tile shows.
    """
    spend = finance.total_cost_split(cur, scope)
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
        # No caption. It restated the chart in prose ("Atrium Cafeteria is
        # carrying 71% of the orders"), which the hover tooltip now answers
        # exactly, per segment, without a second block of text to keep in sync.
        empty="No orders were placed with any outlet in this period.",
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
        # A horizontal bar reads its MAGNITUDE from `x` and its category from `label` (see bar-
        # chart.ts's rows()).
        series_list=[series("bottles", "Bottles", 1, [{"x": b["value"], "label": b["label"]} for b in bars])],
        axes={"x": {"type": "linear", "label": "Bottles", "format": FMT_COUNT}},
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
