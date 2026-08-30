"""Proposal-shaped widgets shared by the CFO and F&B dashboards.

Both roles read the same object - a proposal moving through the approval chain -
so both get the same two widgets rather than each growing its own copy that
drifts. Neither widget takes a unit or a gate: they are institution-wide by
construction, which is also why they are here and not in cfo.py or fmb.py.
"""
from __future__ import annotations

from typing import Any

from ..metrics import finance
from ..scope import Scope
from .base import FMT_COUNT, drill, panel, series, table, widget


@widget("proposal_totals")
def proposal_totals(cur, scope: Scope) -> dict[str, Any]:
    """The toggle card under the status strip: created / needs action /
    completed / cancelled, one at a time.

    Every option respects the reporting period, unlike the strip above it. That
    difference is deliberate and is the point of having both: the strip is a
    backlog ("what is on my desk now"), this is a flow ("what happened in this
    window"). A reader who wants either question answered has one card for it.
    """
    totals = finance.proposal_totals(cur, scope)
    return {
        "kind": "totals",
        "title": "Proposals this period",
        "options": [
            {
                "key": "created",
                "label": "Created",
                "value": totals["created"],
                "caption": "proposals submitted in this period",
                "drill": drill("/app/history/proposals"),
            },
            {
                "key": "action",
                "label": "Needs action",
                "value": totals["action"],
                "caption": "still moving through the approval chain",
                "drill": drill("/app/ongoing/proposals"),
            },
            {
                "key": "completed",
                "label": "Completed",
                "value": totals["completed"],
                "caption": "approved and closed",
                "drill": drill("/app/history/proposals", status="completed-approved"),
            },
            {
                "key": "cancelled",
                "label": "Cancelled",
                "value": totals["cancelled"],
                "caption": "withdrawn or cancelled after submission",
                "drill": drill("/app/history/proposals", status="cancelled"),
            },
        ],
    }


@widget("proposal_status_breakdown")
def proposal_status_breakdown(cur, scope: Scope) -> dict[str, Any]:
    """How many proposals sit under each status, ranked.

    A horizontal bar rather than a donut: there are a dozen rows once send-backs
    are split by gate, and a dozen wedges is several slivers under 2% and a
    legend taller than the ring. The status names are also long ("Department
    review", "Sent back - HOS/HOD"), which is the case horizontal bars exist for.

    Send-backs are split by the gate that issued them, and drafts are excluded -
    see finance.proposal_status_breakdown() for why both.
    """
    rows = finance.proposal_status_breakdown(cur, scope)
    total = sum(row["value"] for row in rows)
    return panel(
        title="Proposals by status",
        subtitle="Where every submitted proposal sits right now",
        chart="bar-chart",
        series_list=[
            series(
                "count",
                "Proposals",
                1,
                # Horizontal bars carry their magnitude on x, and their category
                # on `label` - see bar-chart.ts's `domain`.
                [{"x": row["value"], "label": row["label"]} for row in rows],
            )
        ],
        axes={"x": {"type": "linear", "label": "Proposals", "format": FMT_COUNT}, "y": {"type": "category"}},
        table_view=table(
            [{"key": "label", "label": "Status"}, {"key": "value", "label": "Proposals", "format": FMT_COUNT}],
            rows,
        ),
        caption=f"{total} submitted proposal(s) in total. Drafts are excluded - nobody can act on one." if total else None,
        empty="No proposal has been submitted yet.",
        drill_to=drill("/app/history/proposals"),
        mobile="ranked-list",
    )
