"""CFO — the institutional finance dashboard.

Under `_VISIBLE_SQL` the CFO is nearly blind outside their own gate: clause 5
fires only at `cfo_review`, and `cfo_review` is only reached when
`total_pax > HIGH_PAX_THRESHOLD`. Clause 6's `assigned_role = 'cfo'` branch is
dead code, because `fundingPurchase` is in `NON_WORKFLOW_REQUIREMENTS` and is
never routed. So every proposal at or below the threshold — including all its
funding lines, which are recorded on *every* proposal — is invisible to the
person who owns the budget.

Every widget here is therefore an **R7 aggregate**: counts, sums and ratios over
rows the caller cannot open, carrying no row identifier, no applicant name, and
never a bank account column. The signature panel exists to quantify exactly what
the gate does not see, which is the evidence for or against retuning the
threshold — and it does not exist anywhere else in the application.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ....db import fetch_one
from ..metrics import finance, quality, risk, sla
from ..scope import Scope, apply_bucket_floor, delta, fold_tail, num, ratio, status_for
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

# Candidate thresholds for the draggable preview. Spread either side of the
# seeded default so the curve has shape on both sides of where it sits now.
_THRESHOLD_CANDIDATES = (20, 35, 50, 75, 100)


@widget("cfo_request_counts")
def request_counts(cur, scope: Scope) -> dict[str, Any]:
    """The status strip, in the CFO's own nouns.

    Same compact four-tile shape every other profile carries, counting
    proposals rather than tasks because a proposal is the CFO's unit of work.
    The fourth tile is **Cancelled**, not Late: a CFO is not chasing an overdue
    task, and a cancelled event is the one bucket that changes what every spend
    figure on this page means - money committed and then released.
    """
    counts = finance.proposal_bucket_counts(cur, scope)
    return {
        "kind": "counts",
        "items": [
            {"key": "inbox", "label": "Inbox", "value": counts["inbox"], "status": "unknown", "drill": drill("/app/inbox/proposals", stage="cfo-review")},
            {"key": "ongoing", "label": "Ongoing", "value": counts["ongoing"], "status": "unknown", "drill": drill("/app/ongoing/proposals")},
            {"key": "completed", "label": "Completed", "value": counts["completed"], "status": "good", "drill": drill("/app/history/proposals", status="completed-approved")},
            # Red whether or not anything is cancelled, matching the Late tile
            # on every other strip: a green zero trains the eye to skip the one
            # tile worth stopping for.
            {"key": "cancelled", "label": "Cancelled", "value": counts["cancelled"], "status": "critical", "drill": drill("/app/history/proposals", status="cancelled")},
        ],
    }


@widget("cfo_total_spend")
def total_spend(cur, scope: Scope) -> dict[str, Any]:
    """Committed food plus funding, over the period and filters in force.

    The numerator of the cost-per-pax tile beside it, shown in its own right
    because "what did we commit" and "what did it cost per head" are two
    questions and a reader should not have to multiply to get the first.
    """
    spend = finance.total_cost_split(cur, scope)
    result = finance.cost_per_pax(cur, scope)
    return kpi(
        label="Total spend",
        value=spend["total"],
        fmt=FMT_CURRENCY,
        secondary=f"RM {spend['budget']:,.0f} budget + RM {spend['cafeteria']:,.0f} cafeteria",
        caption=f"across {result['proposals']} live proposal(s) in this period",
        status="unknown",
        caveat=(
            f"Food component based on {result['coverage']:.0%} of items priced (gap G4)."
            if result["coverage"] is not None and result["coverage"] < 1
            else None
        ),
        definition="Budget cost (M51) plus cafeteria food cost (M50) - finance.total_cost_split",
        drill_to=drill("#panel-cfo_spend_by_category"),
    )


@widget("cfo_cafeteria_cost")
def cafeteria_cost(cur, scope: Scope) -> dict[str, Any]:
    """The cafeteria share of Total Spend, called out on its own.

    Not additional money: this is already inside the Total Spend tile above,
    through committed_food_cost. It is broken out because it is the only part of
    institutional spend that another dashboard is accountable for - the same
    figure F&B sees as its Total cafeteria cost - so the two pages reconcile
    against each other rather than each quoting a private total.
    """
    spend = finance.total_cost_split(cur, scope)
    share = ratio(spend["cafeteria"], spend["total"])
    return kpi(
        label="Cafeteria total cost",
        value=spend["cafeteria"],
        fmt=FMT_CURRENCY,
        secondary=f"{share:.0%} of total spend" if share is not None else None,
        caption="Orders placed on cafeteria menus, already counted in total spend",
        status="unknown",
        caveat=(
            f"{spend['totalItems'] - spend['pricedItems']} ordered item(s) carry no price (gap G4)."
            if spend["totalItems"] > spend["pricedItems"]
            else None
        ),
        definition="M50 committed food cost - the cafeteria component of M50+M52",
        drill_to=drill("#panel-cfo_spend_by_category"),
    )


@widget("cfo_total_pax")
def total_pax(cur, scope: Scope) -> dict[str, Any]:
    """Total attendance behind the spend - the denominator, shown in its own
    right for the same reason the numerator is."""
    result = finance.cost_per_pax(cur, scope)
    return kpi(
        label="Total pax served",
        value=result["pax"],
        fmt=FMT_COUNT,
        caption=f"across {result['proposals']} live proposal(s) in this period",
        status="unknown",
        definition="Sum of request.total_pax over live proposals in the period",
        drill_to=drill("#panel-cfo_cost_per_pax_schools"),
    )


@widget("cfo_cost_per_pax")
def cost_per_pax(cur, scope: Scope) -> dict[str, Any]:
    """The comparable efficiency figure, and the basis of every conversation
    with a Head of School."""
    result = finance.cost_per_pax(cur, scope)
    by_school = finance.cost_per_pax_by_school(cur, scope)
    values = [s["value"] for s in by_school if s["value"] is not None and s["n"] >= scope.config.bucket_floor()]
    spread = (max(values) - min(values)) if len(values) > 1 else None
    return kpi(
        label="Cost per pax · institutional",
        value=result["value"],
        fmt=FMT_CURRENCY,
        secondary=f"inter-school spread RM {spread:,.2f}" if spread is not None else None,
        caption=f"{result['proposals']} proposals · {result['pax']:,.0f} pax",
        status="unknown",
        caveat=(
            f"Food component based on {result['coverage']:.0%} of items priced (gap G4)."
            if result["coverage"] is not None and result["coverage"] < 1
            else None
        ),
        definition="M55",
        drill_to=drill("#panel-cfo_cost_per_pax_schools"),
    )


@widget("cfo_gate_decisions")
def gate_decisions(cur, scope: Scope) -> dict[str, Any]:
    """Decisions and dwell in **one stacked panel with a separate dwell row**,
    not a second y-axis. Two measures of different scale are two panels or one
    indexed series; a dual axis is the most common dashboard mistake and the
    panel contract makes it unrepresentable."""
    rows = quality.gate_outcomes_by_period(cur, scope, stage="cfo_review", grain="month")
    dwell = sla.stage_dwell(cur, scope, status="cfo_review")
    median = dwell[0]["median"] if dwell else None
    return panel(
        title="Gate decisions & dwell",
        subtitle="Decisions at cfo_review, per month",
        # Grouped columns for the same reason as F&B's gate outcomes: the three
        # decisions are alternatives, not parts of a whole, and stacking put all
        # three in one column.
        chart="column-chart",
        series_list=[
            series("approved", "Approved", 1, [{"x": r["x"], "y": r["approved"]} for r in rows]),
            series("sentBack", "Sent back", 2, [{"x": r["x"], "y": r["sentBack"]} for r in rows]),
            series("rejected", "Rejected", 8, [{"x": r["x"], "y": r["rejected"]} for r in rows]),
        ],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "Proposals", "format": FMT_COUNT}},
        data={"dwellMedianHours": median, "dwellP90Hours": dwell[0]["p90"] if dwell else None},
        table_view=table(
            [
                {"key": "x", "label": "Month", "format": "date"},
                {"key": "approved", "label": "Approved", "format": FMT_COUNT},
                {"key": "sentBack", "label": "Sent back", "format": FMT_COUNT},
                {"key": "rejected", "label": "Rejected", "format": FMT_COUNT},
            ],
            rows,
        ),
        caption=(
            f"Median dwell at this gate is {median:.0f}h, shown as its own row rather than a second axis."
            if median is not None
            else None
        ),
        empty="No decision was taken at this gate in the period.",
        drill_to=drill("/app/history/proposals", stage="cfo-review"),
        mobile="scroll",
    )


@widget("cfo_funding_main_usage")
def funding_main_usage(cur, scope: Scope) -> dict[str, Any]:
    """Funding **main** items ranked by how often they are picked.

    Horizontal bars, not columns: these labels are finance categories, and
    "Printing & Marketing Materials" rotated under a column is a label a reader
    has to tilt their head for. Dead codes stay on the chart, muted - a code
    nobody picks still lengthens the applicant's form, and it is only visible
    when it is drawn.

    Clicking a bar narrows the sub-item chart beside it rather than navigating
    away; `cross_filter` declares that, and clicking the same bar again clears
    it. See `panel()` in widgets/base.py for the contract.
    """
    rows = finance.funding_catalogue_usage(cur, scope)
    off = finance.funding_off_catalogue(cur, scope)
    dead = [r for r in rows if r["value"] == 0]
    return panel(
        title="Funding main items",
        subtitle="Most used, by selections in this period",
        chart="bar-chart",
        series_list=[
            series(
                "selections",
                "Selections",
                1,
                [
                    {
                        "x": r["value"],
                        "label": r["label"],
                        "optionId": r["optionId"],
                        "annotation": r["code"],
                        "muted": r["value"] == 0,
                    }
                    for r in rows
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Selections", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "label", "label": "Funding main item", "format": "text"},
                {"key": "code", "label": "Finance code", "format": "text"},
                {"key": "value", "label": "Selections", "format": FMT_COUNT},
                {"key": "amount", "label": "Committed", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=(
            f"Select a bar to break it down by sub-item. {len(dead)} dead code(s). "
            f"Off-catalogue rate {off['rate']:.0%} — that spend never reaches a finance code."
            if off["rate"] is not None
            else f"Select a bar to break it down by sub-item. {len(dead)} code(s) with no selections in the period."
        ),
        empty="No funding main options are configured.",
        cross_filter={
            "target": "cfo_funding_sub_usage",
            # The field a *mark here* carries its identity in, and the field the
            # target's own points carry that same identity in. Naming both keeps
            # the client from having to know which two panels these are.
            "pointKey": "optionId",
            "targetKey": "mainOptionId",
            "labelKey": "label",
        },
        drill_to=drill("/app/dropdown-options/fundingMain"),
        mobile="ranked-list",
    )


@widget("cfo_funding_sub_usage")
def funding_sub_usage(cur, scope: Scope) -> dict[str, Any]:
    """Funding **sub**-items ranked by how often they are picked.

    Ships every active sub-item, each tagged with the main option it hangs off.
    The default view is the overall ranking across all mains; selecting a bar on
    the panel beside this one hides everything outside that main. Each count is
    final as it leaves the server - the selection chooses which bars to draw,
    it does not recompute any of them.
    """
    rows = finance.funding_sub_usage(cur, scope)
    dead = [r for r in rows if r["value"] == 0]
    return panel(
        title="Funding sub-items",
        subtitle="Most used across all main items",
        chart="bar-chart",
        series_list=[
            series(
                "selections",
                "Selections",
                2,
                [
                    {
                        "x": r["value"],
                        "label": r["label"],
                        "optionId": r["optionId"],
                        "mainOptionId": r["mainOptionId"],
                        "mainLabel": r["mainLabel"],
                        "annotation": r["code"],
                        "muted": r["value"] == 0,
                    }
                    for r in rows
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Selections", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "label", "label": "Funding sub-item", "format": "text"},
                {"key": "mainLabel", "label": "Under main item", "format": "text"},
                {"key": "code", "label": "Procurement code", "format": "text"},
                {"key": "value", "label": "Selections", "format": FMT_COUNT},
                {"key": "amount", "label": "Committed", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=f"{len(dead)} sub-item(s) with no selections in the period.",
        empty="No funding sub-options are configured.",
        drill_to=drill("/app/dropdown-options/fundingSub"),
        mobile="ranked-list",
    )



