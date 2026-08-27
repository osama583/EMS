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


@widget("cfo_forward_spend")
def forward_spend(cur, scope: Scope) -> dict[str, Any]:
    """Hero — money committed to approved events that have not yet happened.

    Approved spend is already a commitment: the proposal cannot be cancelled
    inside `CANCELLATION_DEADLINE_DAYS`. This is the number that has to be
    affordable, and it is knowable months ahead.
    """
    months = finance.forward_commitment(cur, scope, months=3)
    coverage = finance.price_coverage(cur, scope, outlets=[])
    total = sum(m["value"] for m in months)
    return hero(
        label="Forward committed spend · next 90 days",
        value=total,
        fmt=FMT_CURRENCY,
        caption=(
            f"{sum(m['proposals'] for m in months)} approved events across "
            f"{len(months)} month(s)"
            if months
            else "no approved event is still to run"
        ),
        status="unknown",
        sparkline=[{"x": m["x"], "y": m["value"]} for m in months],
        caveat=(
            f"Food component based on {coverage['coverage']:.0%} of menu items priced (gap G4)."
            if coverage["coverage"] is not None and coverage["coverage"] < 1
            else None
        ),
        definition="M57 — committed food plus funding for approved proposals with a future event date",
        empty="No approved event is still to run.",
        drill_to=drill("#panel-cfo_runway"),
    )


@widget("cfo_forward_spend_kpi")
def forward_spend_kpi(cur, scope: Scope) -> dict[str, Any]:
    result = forward_spend(cur, scope)
    return kpi(
        label="Forward spend",
        value=result["value"],
        fmt=FMT_CURRENCY,
        caption=result["caption"],
        status=result["status"],
        caveat=result["caveat"],
        definition=result["definition"],
        drill_to=result["drill"],
    )


@widget("cfo_gate_coverage")
def gate_coverage(cur, scope: Scope) -> dict[str, Any]:
    """Two numbers on one tile, deliberately: "4% of proposals · 31% of spend".

    If the gate sees 4% of events and 31% of the money the threshold is roughly
    doing its job; if it sees 4% and 9%, it is not. That comparison is the single
    most decision-relevant figure on the page, and splitting it across two tiles
    would lose it.
    """
    result = finance.gate_coverage(cur, scope)
    return kpi(
        label="Gate coverage",
        value=result["spendShare"],
        fmt=FMT_PERCENT,
        secondary=(
            f"{result['proposalShare']:.0%} of proposals" if result["proposalShare"] is not None else None
        ),
        caption=f"threshold {result['threshold']:.0f} pax · {result['proposalsAbove']} of {result['proposals']} reach your gate",
        target={"min": 0.60, "label": "target >= 60% of spend"},
        status=status_for(result["spendShare"], minimum=0.60, critical=0.30, higher_is_better=True),
        definition="M56 — the share of proposals, and of committed spend, crossing HIGH_PAX_THRESHOLD",
        drill_to=drill("#panel-cfo_gate_matrix"),
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


@widget("cfo_collection")
def collection(cur, scope: Scope) -> dict[str, Any]:
    """Revenue that was earned and not received. The amount is what makes it a
    finance issue rather than an administrative one. Counts and sums only — no
    registrant reaches this tile (R9)."""
    revenue = finance.revenue_exposure(cur, scope)
    return kpi(
        label="Collection",
        value=revenue["collectionRate"],
        fmt=FMT_PERCENT,
        secondary=f"RM {revenue['uncollected']:,.2f} uncollected" if revenue["uncollected"] else None,
        caption=(
            f"{revenue['approved']} of {revenue['paymentRequired']} paid registrations"
            if revenue["paymentRequired"]
            else "no registration requires payment in this period"
        ),
        target={"min": 0.90, "label": "target >= 90%"},
        status=status_for(revenue["collectionRate"], minimum=0.90, critical=0.60, higher_is_better=True),
        definition="M54 with the uncollected amount in ringgit",
        drill_to=drill("#panel-cfo_revenue_funnel"),
    )


@widget("cfo_gate_queue")
def gate_queue(cur, scope: Scope) -> dict[str, Any]:
    """The CFO is the last gate before department fan-out; dwell here delays
    every department behind it."""
    waiting = fetch_one(cur, "SELECT count(*) AS n FROM request WHERE status = 'cfo_review'", ())
    dwell = sla.stage_dwell(cur, scope, status="cfo_review")
    median = dwell[0]["median"] if dwell else None
    count = int(waiting["n"]) if waiting else 0
    return kpi(
        label="Gate queue & latency",
        value=count,
        fmt=FMT_COUNT,
        secondary=f"median dwell {median:.0f}h" if median is not None else None,
        caption="proposals waiting at cfo_review",
        target={"max": 48, "label": "target <= 48h dwell"},
        status=status_for(median, warn=48, critical=96) if median is not None else ("warning" if count else "good"),
        definition="M14 for the cfo_review stage",
        drill_to=drill("/app/inbox/proposals", stage="cfo-review"),
    )


@widget("cfo_price_coverage")
def price_coverage(cur, scope: Scope) -> dict[str, Any]:
    """A data-quality tile promoted to KPI status because every currency figure
    on this page depends on it. A CFO reading RM 128,400 needs to know whether
    that is 95% of the truth or 60%."""
    result = finance.price_coverage(cur, scope, outlets=[])
    return kpi(
        label="Price coverage",
        value=result["coverage"],
        fmt=FMT_PERCENT,
        secondary=(
            f"{result['unpricedWithLiveOrders']} unpriced items with live orders"
            if result["unpricedWithLiveOrders"]
            else None
        ),
        caption=f"{result['priced']} of {result['items']} active menu items priced",
        target={"min": 0.95, "label": "target >= 95%"},
        status=(
            "critical"
            if result["unpricedWithLiveOrders"]
            else status_for(result["coverage"], minimum=0.95, critical=0.8, higher_is_better=True)
        ),
        definition="M58 with M75",
        drill_to=drill("/app/cafeterias/menu-oversight", unpriced="true"),
    )


@widget("cfo_gate_matrix")
def gate_matrix(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel — pax bands against committed-cost bands, with a rule at
    the live threshold and a server-computed preview of alternatives.

    Cells left of the rule and in the top two cost bands are spend the gate never
    sees; they carry a status ring **and** a glyph. The draggable preview is the
    panel's real value: a CFO can see that moving the threshold from 50 to 35
    brings 41% of spend under the gate instead of 31% and adds roughly six
    proposals a month to their queue — both sides of the trade, before asking an
    administrator to change anything.
    """
    cells = finance.gate_coverage_matrix(cur, scope)
    coverage = finance.gate_coverage(cur, scope)
    preview = finance.threshold_preview(cur, scope, list(_THRESHOLD_CANDIDATES))
    floored = apply_bucket_floor(scope, cells, count_key="n", value_keys=("cost", "pax"))
    pax_bands = ["0-19", "20-49", "50-99", "100-249", "250+"]
    cost_bands = ["RM 0-499", "RM 500-1,999", "RM 2,000-9,999", "RM 10,000+"]
    return panel(
        title="Gate coverage matrix",
        subtitle=f"Proposals by attendance and committed cost · rule at the live threshold of {coverage['threshold']:.0f} pax",
        chart="heatmap",
        data={
            "rows": cost_bands,
            "columns": pax_bands,
            "cells": [
                {
                    "label": c["costBand"],
                    "date": c["paxBand"],
                    "committed": c["n"],
                    "available": None,
                    "ratio": c["n"],
                    "cost": c["cost"],
                    "pax": c["pax"],
                    "suppressed": c.get("suppressed", False),
                    "belowGate": (
                        c["paxBand"] in ("0-19", "20-49")
                        and c["costBand"] in ("RM 2,000-9,999", "RM 10,000+")
                    ),
                }
                for c in floored
            ],
            "threshold": coverage["threshold"],
            "preview": preview,
            "mode": "count",
        },
        axes={"x": {"type": "category", "label": "Attendance"}, "y": {"type": "category", "label": "Committed cost"}},
        annotations=[{"type": "vertical-rule", "value": coverage["threshold"], "label": "HIGH_PAX_THRESHOLD"}],
        table_view=table(
            [
                {"key": "paxBand", "label": "Attendance", "format": "text"},
                {"key": "costBand", "label": "Committed cost", "format": "text"},
                {"key": "n", "label": "Proposals", "format": FMT_COUNT},
                {"key": "cost", "label": "Total committed", "format": FMT_CURRENCY},
            ],
            floored,
        ),
        caption=(
            f"Cells below the rule carrying real money are spend the gate never sees. "
            f"Buckets under {scope.config.bucket_floor()} proposals render as an em dash."
        ),
        empty="No proposals were submitted in this period.",
        filters=["school", "format"],
        drill_to=drill("/app/history/proposals"),
        signature=True,
        mobile="breach-list",
    )


@widget("cfo_spend_by_category")
def spend_by_category(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.budget_category_split(cur, scope)
    food = finance.committed_food_cost(cur, scope)
    months = sorted({r["bucket"] for r in rows})
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row["category"]] += row["value"]
    ranked = sorted(({"label": k, "value": v} for k, v in totals.items()), key=lambda r: -r["value"])
    kept = fold_tail(scope, ranked, limit=3)
    kept_labels = [r["label"] for r in kept if not r.get("isOther")]

    series_list = [
        series(
            label,
            label,
            index,
            [
                {"x": month, "y": sum(r["value"] for r in rows if r["bucket"] == month and r["category"] == label)}
                for month in months
            ],
        )
        for index, label in enumerate(kept_labels, start=1)
    ]
    if any(r.get("isOther") for r in kept):
        series_list.append(
            series(
                "other",
                "Other",
                4,
                [
                    {"x": month, "y": sum(r["value"] for r in rows if r["bucket"] == month and r["category"] not in kept_labels)}
                    for month in months
                ],
            )
        )
    series_list.append(
        series("food", "Food", 5, [{"x": month, "y": food["total"] / max(1, len(months))} for month in months])
    )
    largest = ranked[0] if ranked else None
    grand_total = sum(totals.values())
    return panel(
        title="Committed spend by finance category",
        subtitle="Funding lines by budget category, with food as its own segment",
        chart="stacked-bar",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "RM", "format": FMT_CURRENCY}},
        table_view=table(
            [
                {"key": "bucket", "label": "Month", "format": "date"},
                {"key": "category", "label": "Budget category", "format": "text"},
                {"key": "subcategory", "label": "Procurement code", "format": "text"},
                {"key": "value", "label": "Committed", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=(
            f"{largest['label']} carries {largest['value'] / grand_total:.0%} of committed funding. "
            "The second level by procurement code is in the table view."
            if largest and grand_total
            else "The second level by procurement code is in the table view."
        ),
        caveat=(
            f"Food component based on {food['coverage']:.0%} of items priced (gap G4)."
            if food["coverage"] is not None and food["coverage"] < 1
            else None
        ),
        empty="No funding or purchase line was recorded in this period.",
        mobile="scroll",
    )


@widget("cfo_runway")
def runway(cur, scope: Scope) -> dict[str, Any]:
    months = finance.forward_commitment(cur, scope, months=6)
    total = sum(m["value"] for m in months)
    peak = max(months, key=lambda m: m["value"], default=None)
    return panel(
        title="Forward commitment runway",
        subtitle="Committed spend by month for approved events not yet run",
        chart="column-chart",
        series_list=[series("committed", "Committed", 1, [{"x": m["x"], "y": m["value"]} for m in months])],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "RM", "format": FMT_CURRENCY}},
        table_view=table(
            [
                {"key": "x", "label": "Month", "format": "date"},
                {"key": "food", "label": "Food", "format": FMT_CURRENCY},
                {"key": "funding", "label": "Funding", "format": FMT_CURRENCY},
                {"key": "value", "label": "Total", "format": FMT_CURRENCY},
                {"key": "proposals", "label": "Events", "format": FMT_COUNT},
            ],
            months,
        ),
        caption=(
            f"{peak['x'][:7]} carries {peak['value'] / total:.0%} of the six-month runway — a timing signal, "
            "not a spend signal."
            if peak and total and peak["value"] / total > 0.4
            else None
        ),
        empty="No approved event is still to run.",
        drill_to=drill("/app/ongoing/proposals"),
        mobile="scroll",
    )


@widget("cfo_cost_per_pax_schools")
def cost_per_pax_schools(cur, scope: Scope) -> dict[str, Any]:
    """Every bar is an R7 aggregate. The two schools are **named**: with two
    schools an anonymised label identifies them anyway, and a comparison that
    pretends otherwise is worse than an honest one."""
    rows = finance.cost_per_pax_by_school(cur, scope)
    floored = apply_bucket_floor(scope, rows, count_key="n", value_keys=("value", "cost", "pax"))
    institutional = finance.cost_per_pax(cur, scope)
    return panel(
        title="Cost per pax by school and format",
        subtitle="Committed cost per head, with the institutional median as a reference",
        chart="bar-chart",
        series_list=[
            series(
                "costPerPax",
                "Cost per pax",
                1,
                [
                    {
                        "x": r["value"],
                        "label": f"{r['school']} · {r['format']}",
                        "suppressed": r.get("suppressed", False),
                    }
                    for r in floored
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "RM per head", "format": FMT_CURRENCY}},
        annotations=(
            [{"type": "reference", "axis": "x", "value": institutional["value"], "label": "institutional"}]
            if institutional["value"]
            else []
        ),
        table_view=table(
            [
                {"key": "school", "label": "School", "format": "text"},
                {"key": "format", "label": "Format", "format": "text"},
                {"key": "n", "label": "Proposals", "format": FMT_COUNT},
                {"key": "value", "label": "Cost per pax", "format": FMT_CURRENCY},
            ],
            floored,
        ),
        caption=f"Buckets under {scope.config.bucket_floor()} proposals render as an em dash and are counted in the page footnote.",
        empty="No proposal in this period carries a committed cost.",
        drill_to=drill("/app/history/proposals"),
        mobile="ranked-list",
    )


@widget("cfo_revenue_funnel")
def revenue_funnel(cur, scope: Scope) -> dict[str, Any]:
    """The drop between "submitted" and "approved" is organisers not reviewing
    proofs; between "required" and "submitted" is attendees not paying. Two
    different problems, two different people to talk to, and the funnel names
    which. Counts only, never registrants."""
    revenue = finance.revenue_exposure(cur, scope)
    stages = [
        {"stage": "Revenue exposure", "value": revenue["exposure"], "format": FMT_CURRENCY},
        {"stage": "Payment required", "value": revenue["paymentRequired"], "format": FMT_COUNT},
        {"stage": "Proof submitted", "value": revenue["submitted"] + revenue["approved"], "format": FMT_COUNT},
        {"stage": "Payment approved", "value": revenue["approved"], "format": FMT_COUNT},
        {"stage": "Collected", "value": revenue["collected"], "format": FMT_CURRENCY},
    ]
    for index, stage in enumerate(stages):
        if index in (2, 3):
            stage["share"] = ratio(stage["value"], stages[index - 1]["value"])
        else:
            stage["share"] = None
    return panel(
        title="Revenue & collection funnel",
        subtitle="Paid events only",
        chart="funnel",
        data={"stages": stages, "uncollected": revenue["uncollected"]},
        table_view=table(
            [
                {"key": "stage", "label": "Stage", "format": "text"},
                {"key": "value", "label": "Value", "format": "number"},
                {"key": "share", "label": "Conversion", "format": FMT_PERCENT},
            ],
            stages,
        ),
        caption="Counts and sums only — no registrant identity reaches any dashboard.",
        empty="No paid event ran in this period.",
        drill_to=drill("/app/history/proposals", payment="unpaid"),
        mobile="stacked-bars",
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
        chart="stacked-bar",
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


@widget("cfo_finance_catalogue")
def finance_catalogue(cur, scope: Scope) -> dict[str, Any]:
    """The CFO owns this catalogue. A high off-catalogue rate means spend is
    being recorded outside the finance codes it is meant to roll up to, which
    quietly breaks the category panel above."""
    rows = finance.funding_catalogue_usage(cur, scope)
    off = finance.funding_off_catalogue(cur, scope)
    dead = [r for r in rows if r["value"] == 0]
    return panel(
        title="Finance catalogue health",
        subtitle="Funding main options by selections in the period",
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
                {"key": "label", "label": "Funding item", "format": "text"},
                {"key": "code", "label": "Finance code", "format": "text"},
                {"key": "value", "label": "Selections", "format": FMT_COUNT},
                {"key": "amount", "label": "Committed", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption=(
            f"{len(dead)} dead code(s). Off-catalogue rate {off['rate']:.0%} — that spend never reaches a finance code."
            if off["rate"] is not None
            else f"{len(dead)} code(s) with no selections in the period."
        ),
        empty="No funding options are configured.",
        drill_to=drill("/app/dropdown-options/fundingMain"),
        mobile="ranked-list",
    )


@widget("cfo_at_risk")
def at_risk(cur, scope: Scope) -> dict[str, Any]:
    revenue = finance.revenue_exposure(cur, scope)
    unpriced = risk.unpriced_ordered_items(cur, scope, outlets=[])
    stranded = risk.stranded_at_gate(cur, scope)
    waiting = fetch_one(
        cur,
        "SELECT count(*) AS n, min(submitted_at) AS oldest FROM request WHERE status = 'cfo_review'",
        (),
    )
    return panel(
        title="Needs your attention",
        subtitle="At your gate, and in the data behind every figure on this page",
        chart="alert-list",
        data={
            "gateQueue": {
                "count": int(waiting["n"]) if waiting else 0,
                "oldest": waiting["oldest"].isoformat() if waiting and waiting["oldest"] else None,
            },
            "uncollected": revenue["uncollected"],
            "unpriced": unpriced,
            "stranded": stranded,
        },
        table_view=table(
            [
                {"key": "label", "label": "Unpriced item with live orders", "format": "text"},
                {"key": "outlet", "label": "Outlet", "format": "text"},
                {"key": "orders", "label": "Orders", "format": FMT_COUNT},
            ],
            unpriced,
        ),
        empty="Nothing is waiting at your gate.",
        drill_to=drill("/app/inbox/proposals", stage="cfo-review"),
    )
