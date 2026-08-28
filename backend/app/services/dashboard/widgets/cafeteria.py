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
from ..metrics import finance, people, quality, risk, sla
from ..scope import Scope, status_for
from .base import (
    FMT_COUNT,
    FMT_CURRENCY,
    FMT_PERCENT,
    drill,
    hero,
    kpi,
    panel,
    series,
    table,
    widget,
)


def _orders_route(bucket: str) -> str:
    return f"/app/{bucket}/requests"


@widget("caf_request_counts")
def request_counts(cur, scope: Scope) -> dict[str, Any]:
    """Compact Inbox / Ongoing / Completed / Late strip, cafeteria's own
    version of dept_request_counts (widgets/department.py) - orders rather
    than tasks, since a cafeteria manager's unit of work is an order.
    """
    targets = list(scope.outlets)
    rows = fetch_all(
        cur,
        """
        SELECT count(*) FILTER (WHERE sel.status = 'pending') AS inbox,
               count(*) FILTER (WHERE sel.status IN ('approved', 'preparing', 'resubmitted')) AS ongoing,
               count(*) FILTER (WHERE sel.status = 'fulfilled') AS completed,
               count(*) FILTER (
                   WHERE sel.status IN ('approved', 'preparing')
                     AND (f."date" + f.serve_time) < now()
               ) AS late
          FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE sel.unit_code = ANY(%(outlets)s)
        """,
        scope.params(outlets=targets or [""]),
    )
    row = rows[0] if rows else {"inbox": 0, "ongoing": 0, "completed": 0, "late": 0}
    late = int(row["late"] or 0)
    return {
        "kind": "counts",
        "items": [
            {"key": "inbox", "label": "Inbox", "value": int(row["inbox"] or 0), "status": "unknown", "drill": drill(_orders_route("inbox"), requestKind="fmb")},
            {"key": "ongoing", "label": "Ongoing", "value": int(row["ongoing"] or 0), "status": "unknown", "drill": drill(_orders_route("ongoing"), requestKind="fmb")},
            {"key": "completed", "label": "Completed", "value": int(row["completed"] or 0), "status": "good", "drill": drill(_orders_route("history"), requestKind="fmb")},
            # Late reads red whether or not anything is late. A green zero
            # trains the eye to skim the tile that is the only one on the strip
            # worth stopping for; the number itself already says "none".
            {"key": "late", "label": "Late", "value": late, "status": "critical", "drill": drill(_orders_route("ongoing"), requestKind="fmb", risk="true")},
        ],
    }


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
        target={"min": 0.95, "label": "Goal: 95% or higher"},
        status=status_for(combined["rate"], minimum=0.95, critical=0.85, higher_is_better=True),
        definition="M19 per outlet, grouped rather than averaged",
        drill_to=drill("/app/history/requests", requestKind="fmb", delivery="late"),
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
    """Signature panel — the next 24 hours, each order a block at its serve time.

    Ordered by serve time and not order date: the manager's day is organised by
    when food must leave the kitchen. Ordering this board by anything else would
    be a chart of someone else's schedule.
    """
    hours = 24
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
           AND (f."date" + coalesce(f.serve_time, '00:00'::time)) >= now()
           AND (f."date" + coalesce(f.serve_time, '00:00'::time)) < now() + interval '24 hours'
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
        subtitle="The next 24 hours, in serve-time order",
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
        empty="Nothing is due at your outlets in the next 24 hours.",
        filters=["outlet", "state", "riskOnly"],
        drill_to=drill("/app/inbox/requests", requestKind="fmb"),
        signature=True,
        mobile="time-list",
    )


@widget("caf_staff_workload")
def staff_workload(cur, scope: Scope) -> dict[str, Any]:
    """Who's carrying how much work - cafeteria's own version of
    dept_staff_balance (widgets/department.py), same plain wording, reading
    claims instead of task assignments since a cafeteria manager's staff pick
    up orders, not row assignments.

    Vertical columns rather than horizontal bars: a cafeteria roster is a
    handful of people with short given names, so nothing has to be rotated or
    truncated to fit under a column, and one column per person compares
    heights - which is the comparison this panel exists to make. The
    horizontal form earns its keep where the categories are long service
    names ("Photography / Videography"), which is not this panel.
    """
    staff = people.claim_distribution(cur, scope)
    balance = people.workload_balance(staff)
    return panel(
        title="Who's carrying how much work",
        subtitle="Orders claimed by each staff member this period",
        chart="column-chart",
        series_list=[
            series(
                "staff",
                "Staff",
                1,
                # A column chart carries its category on x and its magnitude on
                # y - the transpose of the bar form this panel used to take.
                [{"x": s["name"], "y": s["value"], "userId": s["userId"]} for s in staff],
            )
        ],
        axes={
            "x": {"type": "category", "label": "Staff"},
            "y": {"type": "linear", "label": "Orders claimed", "format": FMT_COUNT},
        },
        table_view=table(
            [
                {"key": "name", "label": "Staff", "format": "text"},
                {"key": "value", "label": "Orders claimed", "format": FMT_COUNT},
            ],
            staff,
        ),
        caption=(
            "Work is spread evenly across the team."
            if not balance["spread"] or balance["spread"] == float("inf") or balance["spread"] <= 1.5
            else "One person is claiming noticeably more than the rest."
        ),
        empty="No orders were claimed at your outlets in this period.",
        mobile="ranked-list",
    )


@widget("caf_menu_performance")
def menu_performance(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.menu_performance(cur, scope)
    unpriced = [r for r in rows if r["unpriced"]]
    ordered = sorted(rows, key=lambda r: r["value"], reverse=True)
    top = [r for r in ordered if r["value"] > 0][:7]
    other_total = sum(r["value"] for r in ordered[len(top) :] if r["value"] > 0)
    segments = [{"label": r["label"], "value": r["value"], "optionId": r["optionId"]} for r in top]
    if other_total:
        segments.append({"label": "Other items", "value": other_total})
    total_orders = sum(r["value"] for r in rows)
    return panel(
        title="Most used",
        subtitle="What's ordered most from your menu",
        chart="donut-chart",
        data={"segments": segments, "total": total_orders, "totalLabel": "Orders this period", "format": FMT_COUNT},
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
