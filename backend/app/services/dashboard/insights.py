"""The decision-support rail: 45 rules, five cards.

A rule is a function `(cur, scope, widgets) -> Insight | None`. It reads the
widget results already computed for the page wherever it can, so the rail costs
almost nothing beyond the panels themselves, and queries directly only for facts
that are not on screen.

Three properties every card holds:

**Evidence, always.** A card with no metric, no value and no window is an
opinion. Each one carries the figure it fired on so a reader can disagree with
it on the merits.

**An action, or no button.** A rule with nothing the viewer can actually do
renders without a button rather than with one that leads nowhere. AI-31 is the
clearest case: it detects a routing defect the viewer cannot fix from here, so
it says so instead of offering a link.

**A cap of five.** Nine or ten rules are candidates per role; the rail shows
five, ranked by severity then recency. An insights rail that scrolls is an
insights rail nobody reads, and the headroom means the rail is selecting rather
than padding.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Any, Callable

from .metrics import capacity, finance, people, quality, risk, sla
from .metrics.common import spec_for
from .scope import Scope, ratio

SEVERITY_RANK = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
MAX_CARDS = 5


@dataclass
class Insight:
    id: str
    code: str
    severity: str
    title: str
    body: str
    evidence: dict[str, Any]
    action: dict[str, Any] | None = None

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "code": self.code,
            "severity": self.severity,
            "title": self.title,
            "body": self.body,
            "evidence": self.evidence,
            "action": self.action,
        }


RuleFn = Callable[[Any, Scope, dict[str, Any]], Insight | None]
RULES: dict[str, RuleFn] = {}


def rule(rule_id: str) -> Callable[[RuleFn], RuleFn]:
    def register(fn: RuleFn) -> RuleFn:
        RULES[rule_id] = fn
        return fn

    return register


def _action(label: str, route: str, **params: Any) -> dict[str, Any]:
    return {"label": label, "route": route, "params": {k: v for k, v in params.items() if v is not None}}


def _panel_data(widgets: dict[str, Any], widget_id: str) -> dict[str, Any]:
    widget = widgets.get(widget_id) or {}
    return widget.get("data") or {}


def _value(widgets: dict[str, Any], widget_id: str) -> Any:
    return (widgets.get(widget_id) or {}).get("value")


def _requirement(scope: Scope) -> str | None:
    spec = spec_for(scope.unit_code)
    return spec.requirement if spec else None


# --- Capacity & resource --------------------------------------------------


@rule("AI-01")
def stockout_forecast(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    cells = capacity.logistics_commitment(cur, scope)
    breaches = [c for c in cells if (c["ratio"] or 0) > 1.0]
    if not breaches:
        return None
    first = min(breaches, key=lambda c: c["date"])
    return Insight(
        id="AI-01",
        code="STOCKOUT_FORECAST",
        severity="critical",
        title=f"{first['label']} is over-committed on {first['date']}",
        body=(
            f"{first['committed']:.0f} {first['unit']} are committed against {first['available']:.0f} available "
            f"— a shortfall of {first['committed'] - first['available']:.0f}. "
            f"{len(breaches)} item-date cell(s) breach in the horizon."
        ),
        evidence={"metric": "M30", "value": first["ratio"], "date": first["date"], "item": first["label"]},
        action=_action("Open the commitment heatmap", "#panel-log_inventory_heatmap", date=first["date"]),
    )


@rule("AI-02")
def capacity_breach(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Names **which** ceiling where a unit has two. A card that says "capacity
    exceeded" to a Transport head without saying whether it is buses or drivers
    has told them to attend the wrong meeting."""
    for hero_id in ("av_crew_coverage", "sts_guide_coverage", "trn_binding_constraint", "log_peak_commitment"):
        widget = widgets.get(hero_id)
        if not widget or widget.get("value") is None:
            continue
        if widget["value"] <= 1.0:
            return None
        binding = ""
        if hero_id == "trn_binding_constraint":
            binding = " " + (widget.get("caption") or "")
        return Insight(
            id="AI-02",
            code="CAPACITY_BREACH",
            severity="critical",
            title=f"{widget['label']} is above 1.0 on the peak forward day",
            body=(
                f"At {widget['value']:.2f} the day cannot be delivered by the current roster no matter how it is "
                f"scheduled.{binding} Reschedule the later booking or arrange temporary cover."
            ),
            evidence={"metric": "M35", "value": widget["value"], "window": "forward horizon"},
            action=widget.get("drill") and {"label": "See the peak day", **widget["drill"]},
        )
    return None


@rule("AI-03")
def collision_cluster(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Three collision dates in one week is a week-shaped problem. Per-rig triage
    on each of them is three conversations that should have been one."""
    data = _panel_data(widgets, "av_collision_timeline")
    breached = [lane["key"] for lane in data.get("lanes", []) if lane.get("breached")]
    if len(breached) < 3:
        return None
    import datetime as dt

    dates = sorted(dt.date.fromisoformat(day) for day in breached)
    for index in range(len(dates) - 2):
        if (dates[index + 2] - dates[index]).days <= 7:
            window = f"{dates[index].isoformat()} to {dates[index + 2].isoformat()}"
            return Insight(
                id="AI-03",
                code="COLLISION_CLUSTER",
                severity="serious",
                title=f"Three collision dates fall inside one week ({window})",
                body=(
                    "A temporary crew arrangement for that week costs less than triaging each rig separately. "
                    f"{len(breached)} date(s) breach in the whole window."
                ),
                evidence={"metric": "M31", "value": len(breached), "window": window},
                action=_action("Open the collision timeline", "#panel-av_collision_timeline", date=dates[index].isoformat()),
            )
    return None


@rule("AI-12")
def water_stockout(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    result = capacity.water_runway_days(cur, scope)
    if result["days"] is None or result["days"] > 14:
        return None
    return Insight(
        id="AI-12",
        code="WATER_STOCKOUT",
        severity="critical" if result["days"] <= 3 else "serious",
        title=f"{result['label']} runs out in {result['days']} day(s)",
        body=f"Committed bottles exceed available stock from {result['date']}. Reorder or reduce the commitment.",
        evidence={"metric": "M30", "value": result["days"], "date": result["date"]},
        action=_action("Open the water catalogue", "/app/dropdown-options/waterNormal"),
    )


@rule("AI-13")
def chronic_shortage(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """One item breaching once is a scheduling problem. The same item breaching
    on a fifth of the horizon is a purchasing problem, and they have different
    owners."""
    if scope.unit_code == "transport_services":
        cells = capacity.transport_commitment(cur, scope)
    else:
        cells = capacity.logistics_commitment(cur, scope)
    if not cells:
        return None
    horizon_days = len({c["date"] for c in cells})
    per_item: dict[str, int] = {}
    for cell in cells:
        if (cell["ratio"] or 0) > 1.0:
            per_item[cell["label"]] = per_item.get(cell["label"], 0) + 1
    worst = max(per_item.items(), key=lambda kv: kv[1], default=None)
    if not worst or not horizon_days or worst[1] / horizon_days <= 0.2:
        return None
    return Insight(
        id="AI-13",
        code="CHRONIC_SHORTAGE",
        severity="serious",
        title=f"{worst[0]} is over-committed on {worst[1]} of {horizon_days} days",
        body=(
            "A shortage this persistent is a stock level that no longer matches demand, not a scheduling clash. "
            "Raising the available quantity would remove every one of these breaches at once."
        ),
        evidence={"metric": "M30", "value": worst[1] / horizon_days, "item": worst[0], "window": f"{horizon_days} days"},
        action=_action("Review the catalogue", "/app/dropdown-options/logistics" if scope.unit_code != "transport_services" else "/app/dropdown-options/transportation"),
    )


@rule("AI-28")
def start_point_crowding(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    rows = capacity.start_point_congestion(cur, scope)
    limit = scope.config.integer("START_POINT_MAX_TOURS", 2)
    crowded = [r for r in rows if r["tours"] > limit]
    if not crowded:
        return None
    first = min(crowded, key=lambda r: r["date"])
    return Insight(
        id="AI-28",
        code="START_POINT_CROWDING",
        severity="serious",
        title=f"{first['tours']} tours converge on {first['startPoint']} on {first['date']}",
        body=(
            f"The comfortable maximum is {limit}. The meeting instructions for this point assume one group at a time, "
            "so several arriving together is a real failure rather than a busy morning."
        ),
        evidence={"metric": "M31", "value": first["tours"], "date": first["date"], "startPoint": first["startPoint"]},
        action=_action("Open the congestion heatmap", "#panel-sts_start_point_heatmap"),
    )


# --- SLA & flow -----------------------------------------------------------


@rule("AI-05")
def sla_drift(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Three consecutive rises, not one bad week. A single week above target is
    noise at these volumes."""
    trend = sla.decision_latency_by_week(cur, scope)
    if len(trend) < 4:
        return None
    values = [point["y"] for point in trend[-4:] if point["y"] is not None]
    if len(values) < 4 or not all(values[i] < values[i + 1] for i in range(3)):
        return None
    target = scope.config.decision_sla_hours(scope.unit_code)
    return Insight(
        id="AI-05",
        code="SLA_DRIFT",
        severity="warning",
        title="Decision latency has risen three weeks running",
        body=(
            f"Median decision time went from {values[0]:.0f}h to {values[-1]:.0f}h against a {target:g}h target. "
            "Three consecutive rises is a trend rather than a bad week."
        ),
        evidence={"metric": "M10", "value": values[-1], "window": "3 weeks", "target": target},
        action=_action("Open the inbox", "/app/inbox/requests", bucket="inbox", requestKind=_requirement(scope)),
    )


@rule("AI-11")
def runway_collapse(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """An upstream fix. A department cannot make its own runway longer; only the
    units submitting late can."""
    widget = widgets.get("dept_prep_runway")
    if not widget or widget.get("value") is None:
        return None
    floor = scope.config.lead_days(scope.unit_code)
    if widget["value"] >= floor:
        return None
    return Insight(
        id="AI-11",
        code="RUNWAY_COLLAPSE",
        severity="serious",
        title=f"Preparation runway has fallen to {widget['value']:.1f} days",
        body=(
            f"The target is {floor:g} days. This is an upstream problem: the department cannot lengthen its own "
            "notice, only the units submitting late can. Falling runway predicts every downstream SLA breach."
        ),
        evidence={"metric": "M16", "value": widget["value"], "target": floor},
        action=_action("See what is arriving late", "/app/inbox/requests", requestKind=_requirement(scope), sort="schedule"),
    )


@rule("AI-20")
def gate_bottleneck(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Fires only when the viewer's *own* stage is the slowest. Telling a head
    that some other stage is slow is not actionable from this page."""
    stage = {
        "hos_school": "hos_hod_review",
        "hod_fmb": "fmb_review",
        "cfo": "cfo_review",
    }.get(scope.profile_key)
    if not stage:
        return None
    dwell = sla.stage_dwell(cur, scope)
    if not dwell or dwell[0]["status"] != stage:
        return None
    mine = dwell[0]
    if mine["median"] is None or len(dwell) < 2:
        return None
    return Insight(
        id="AI-20",
        code="GATE_BOTTLENECK",
        severity="serious",
        title="Your gate is the slowest stage in the workflow",
        body=(
            f"Median dwell at {stage.replace('_', ' ')} is {mine['median']:.0f}h, ahead of the next slowest stage. "
            "Every department behind this gate waits on it."
        ),
        evidence={"metric": "M14", "value": mine["median"], "window": scope.period.label, "sample": mine["sample"]},
        action=_action("Clear the queue", "/app/inbox/proposals", stage=stage.replace("_", "-")),
    )


@rule("AI-24")
def turnaround_drift(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    current = risk.post_event_turnaround(cur, scope, spec)
    if current["p90"] is None or current["p90"] <= 14:
        return None
    return Insight(
        id="AI-24",
        code="TURNAROUND_DRIFT",
        severity="serious",
        title=f"Post-event turnaround p90 has reached {current['p90']:.0f} days",
        body=(
            f"Half of deliveries land inside {current['median']:.0f} days, but the slowest tenth take "
            f"{current['p90']:.0f}. The tail is the requester's experience, not the median."
        ),
        evidence={"metric": "M13", "value": current["p90"], "sample": current["sample"]},
        action=_action("Open the distribution", "#panel-pho_turnaround_distribution"),
    )


@rule("AI-27")
def stale_unassigned(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    sla_hours = scope.config.assignment_sla_hours(scope.unit_code)
    stale = [
        item
        for item in people.stale_unassigned(cur, scope, spec)
        if (item["hoursSinceApproval"] or 0) > sla_hours
    ]
    if not stale:
        return None
    oldest = max(stale, key=lambda item: item["hoursSinceApproval"] or 0)
    return Insight(
        id="AI-27",
        code="STALE_UNASSIGNED",
        severity="serious",
        title=f"{len(stale)} approved item(s) have had no assignee for over {sla_hours:g}h",
        body=(
            f"The oldest has been waiting {oldest['hoursSinceApproval']:.0f}h and is due {oldest['date']}. "
            "Approved work with nobody on it has been promised and not staffed."
        ),
        evidence={"metric": "M64", "value": len(stale), "target": sla_hours},
        action=_action("Assign it", "/app/ongoing/requests", requestKind=spec.requirement, assigned="none"),
    )


@rule("AI-41")
def pool_starved(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    result = sla.order_claim_latency(cur, scope)
    target = scope.config.number("SLA_ORDER_CLAIM_HOURS", 4)
    if result["median"] is None or result["median"] <= target:
        return None
    return Insight(
        id="AI-41",
        code="POOL_STARVED",
        severity="serious",
        title=f"Orders sit unclaimed for {result['median']:.1f}h on average",
        body=(
            f"The target is {target:g}h. A manager cannot assign an order — only staff the pool and nudge — so a "
            "long claim time is a roster question, not a kitchen one."
        ),
        evidence={"metric": "M18", "value": result["median"], "target": target, "sample": result["sample"]},
        action=_action("Review your roster", "/app/cafeterias/my-staff"),
    )


# --- Quality & rework -----------------------------------------------------


@rule("AI-09")
def pushback_concentration(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    outlets = quality.pushback_by_outlet(cur, scope)
    total = sum(o["count"] for o in outlets)
    if total < 3:
        return None
    worst = max(outlets, key=lambda o: o["count"])
    share = ratio(worst["count"], total)
    if share is None or share <= 0.6:
        return None
    return Insight(
        id="AI-09",
        code="PUSHBACK_CONCENTRATION",
        severity="serious",
        title=f"{share:.0%} of push-backs come from {worst['label']}",
        body=(
            f"{worst['count']} of {total} bounced orders originate at one outlet. That is usually an ordering "
            "mismatch rather than an outlet problem — check what is being sent there."
        ),
        evidence={"metric": "M25", "value": share, "outlet": worst["label"]},
        action=_action("See the bounced orders", "/app/inbox/requests", requestKind="fmb", outlet=worst["code"], orderStatus="resubmitted"),
    )


@rule("AI-14")
def form_mismatch(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Fires only when **both** rise together. A high send-back rate alone is a
    review-standard question; paired with rising off-catalogue demand it is a
    catalogue that has stopped covering what people ask for."""
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    send_back = quality.send_back_rate(cur, scope)
    previous = quality.send_back_rate(cur, scope, previous=True)
    off = quality.off_catalogue_rate(cur, scope, spec)
    warn = scope.config.send_back_warn_rate(scope.unit_code)
    if send_back["rate"] is None or send_back["rate"] <= warn:
        return None
    if previous["rate"] is not None and send_back["rate"] <= previous["rate"]:
        return None
    if off["rate"] is None or off["rate"] < 0.1:
        return None
    return Insight(
        id="AI-14",
        code="FORM_MISMATCH",
        severity="warning",
        title="Send-backs and off-catalogue requests are rising together",
        body=(
            f"Send-back rate {send_back['rate']:.0%} against a {warn:.0%} target, with {off['rate']:.0%} of rows "
            "typed in rather than picked. The catalogue no longer covers what is being asked for — adding the "
            "missing options fixes both numbers."
        ),
        evidence={"metric": "M20 + M27", "value": send_back["rate"], "offCatalogue": off["rate"]},
        action=_action("Open the catalogue", spec.catalogue_route or "/app/dropdown-options"),
    )


@rule("AI-26")
def rejection_drift(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """The card states plainly that the data cannot distinguish "quality fell"
    from "the bar moved". Presenting a rising rejection rate as a quality signal
    would be a claim the schema cannot support."""
    stage = {"hos_school": "hos_hod_review", "hod_fmb": "fmb_review", "cfo": "cfo_review"}.get(scope.profile_key)
    if not stage:
        return None
    extra = {"school": scope.unit_code} if scope.profile_key == "hos_school" else {}
    filter_sql = ""
    if scope.profile_key == "hos_school":
        from .widgets.school import SCHOOL_FILTER

        filter_sql = SCHOOL_FILTER
    current = quality.gate_outcome_mix(cur, scope, stage=stage, request_filter=filter_sql, extra=extra)
    if current["total"] < 5 or current["rejectedShare"] is None or current["rejectedShare"] < 0.2:
        return None
    return Insight(
        id="AI-26",
        code="REJECTION_DRIFT",
        severity="warning",
        title=f"{current['rejectedShare']:.0%} of proposals at your gate were rejected",
        body=(
            f"{current['rejected']} of {current['total']} decisions. The data cannot distinguish a fall in proposal "
            "quality from a rise in the bar being applied — both look identical here, and only you know which it is."
        ),
        evidence={"metric": "M22", "value": current["rejectedShare"], "sample": current["total"]},
        action=_action("Read the decisions", "/app/history/proposals", stage=stage.replace("_", "-")),
    )


@rule("AI-06")
def outlet_degrading(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    outlets = list(scope.outlets) or [
        row["code"] for row in capacity.order_pipeline_by_outlet(cur, scope, outlets=[])
    ]
    worst = None
    for outlet in outlets:
        accept = sla.order_accept_latency(cur, scope, outlet=outlet)
        target = scope.config.number("SLA_ORDER_ACCEPT_HOURS", 12)
        if accept["median"] is not None and accept["median"] > target:
            if worst is None or accept["median"] > worst[1]:
                worst = (outlet, accept["median"], target, accept["sample"])
    if worst is None:
        return None
    outlet, median, target, sample = worst
    return Insight(
        id="AI-06",
        code="OUTLET_DEGRADING",
        severity="serious",
        title=f"{scope.outlet_labels.get(outlet, outlet)} takes {median:.1f}h to accept an order",
        body=f"The target is {target:g}h across {sample} order(s). Acceptance is the manager's own segment.",
        evidence={"metric": "M17", "value": median, "target": target, "outlet": outlet},
        action=_action("Open the fan-out board", "#panel-fmb_fanout_board"),
    )


@rule("AI-34")
def scope_inflation(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    widget = widgets.get("hos_service_footprint")
    if not widget or widget.get("value") is None or widget["value"] < 3:
        return None
    return Insight(
        id="AI-34",
        code="SCOPE_INFLATION",
        severity="warning",
        title=f"Proposals from this school carry {widget['value']:.1f} requirements on average",
        body=(
            "Each additional service requirement adds a department lane, and every lane adds dwell time to the "
            "end-to-end figure. This is the school's own driver of downstream latency and the one it controls."
        ),
        evidence={"metric": "M42", "value": widget["value"]},
        action=_action("See the dependency map", "#panel-hos_dependency_map"),
    )


# --- Cost & finance -------------------------------------------------------


@rule("AI-04")
def cost_spike(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    filter_sql, extra = "", {}
    if scope.profile_key == "hos_school":
        from .widgets.school import SCHOOL_FILTER

        filter_sql, extra = SCHOOL_FILTER, {"school": scope.unit_code}
    current = finance.committed_food_cost(cur, scope, request_filter=filter_sql, extra=extra)
    previous = finance.committed_food_cost(cur, scope, request_filter=filter_sql, previous=True, extra=extra)
    if not previous["total"] or not current["total"]:
        return None
    change = current["total"] / previous["total"] - 1
    if change <= 0.4:
        return None
    return Insight(
        id="AI-04",
        code="COST_SPIKE",
        severity="warning",
        title=f"Committed food cost is up {change:.0%} on the previous period",
        body=(
            f"RM {current['total']:,.2f} against RM {previous['total']:,.2f}. "
            f"Based on {current['coverage']:.0%} of items priced, so the real movement may be larger."
            if current["coverage"] is not None
            else f"RM {current['total']:,.2f} against RM {previous['total']:,.2f}."
        ),
        evidence={"metric": "M50", "value": change, "window": scope.period.label},
        action=_action("See the breakdown", "#panel-cfo_spend_by_category" if scope.profile_key == "cfo" else "#panel-hos_cost_by_category"),
    )


@rule("AI-23")
def unpriced_exposure(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    outlets = list(scope.outlets) if scope.profile_key == "cafeteria_manager" else []
    coverage = finance.price_coverage(cur, scope, outlets=outlets)
    floor = 0.95 if scope.profile_key in ("cfo", "cafeteria_manager") else 0.8
    if coverage["unpricedWithLiveOrders"] == 0 and (coverage["coverage"] is None or coverage["coverage"] >= floor):
        return None
    return Insight(
        id="AI-23",
        code="UNPRICED_EXPOSURE",
        severity="warning",
        title=(
            f"{coverage['unpricedWithLiveOrders']} unpriced item(s) have live orders"
            if coverage["unpricedWithLiveOrders"]
            else f"Price coverage is {coverage['coverage']:.0%}"
        ),
        body=(
            f"{coverage['priced']} of {coverage['items']} active menu items carry a price. Every unpriced item "
            "contributes zero to a cost total while costing real money, so every currency figure on this page "
            "understates by an unknown amount."
        ),
        evidence={"metric": "M58 + M75", "value": coverage["coverage"], "unpriced": coverage["unpricedWithLiveOrders"]},
        action=_action(
            "Fix the prices",
            "/app/menu" if scope.profile_key == "cafeteria_manager" else "/app/cafeterias/menu-oversight",
            unpriced="true",
        ),
    )


@rule("AI-35")
def recovery_shortfall(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Reports the break-even registration count, which is the number that makes
    the card actionable rather than merely alarming."""
    from .widgets.school import SCHOOL_FILTER

    extra = {"school": scope.unit_code}
    revenue = finance.revenue_exposure(cur, scope, request_filter=SCHOOL_FILTER, extra=extra)
    cost = finance.cost_per_pax(cur, scope, request_filter=SCHOOL_FILTER, extra=extra)
    if not revenue["exposure"] or not cost["cost"]:
        return None
    projected = ratio(revenue["exposure"], cost["cost"])
    if projected is None or projected >= 0.4:
        return None
    per_head = ratio(revenue["exposure"], revenue["registered"]) if revenue["registered"] else None
    break_even = int(cost["cost"] / per_head) + 1 if per_head else None
    return Insight(
        id="AI-35",
        code="RECOVERY_SHORTFALL",
        severity="serious",
        title=f"Paid events are projected to recover {projected:.0%} of their cost",
        body=(
            f"RM {revenue['exposure']:,.2f} of exposure against RM {cost['cost']:,.2f} committed."
            + (f" Break-even needs about {break_even} paid registrations." if break_even else "")
        ),
        evidence={"metric": "M53 + M54", "value": projected, "breakEven": break_even},
        action=_action("Open the recovery funnel", "#panel-hos_recovery_funnel"),
    )


@rule("AI-36")
def collection_tail(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Counts only, never registrants (R9). The count is what makes it a
    finance issue; the names would make it a privacy one."""
    filter_sql, extra = "", {}
    if scope.profile_key == "hos_school":
        from .widgets.school import SCHOOL_FILTER

        filter_sql, extra = SCHOOL_FILTER, {"school": scope.unit_code}
    revenue = finance.revenue_exposure(cur, scope, request_filter=filter_sql, extra=extra)
    unpaid = revenue["paymentRequired"] - revenue["approved"]
    if unpaid <= 0 or not revenue["uncollected"]:
        return None
    return Insight(
        id="AI-36",
        code="COLLECTION_TAIL",
        severity="serious",
        title=f"{unpaid} registration(s) remain unpaid",
        body=(
            f"RM {revenue['uncollected']:,.2f} is earned and not received. The gap between "
            f"{revenue['paymentRequired']} required and {revenue['approved']} approved is the work list."
        ),
        evidence={"metric": "M54", "value": unpaid, "amount": revenue["uncollected"]},
        action=_action("See unpaid events", "/app/history/proposals", payment="unpaid"),
    )


@rule("AI-38")
def threshold_miscalibrated(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Presents the coverage curve at three candidate thresholds, so the card is
    a decision aid rather than a complaint."""
    coverage = finance.gate_coverage(cur, scope)
    if coverage["spendShare"] is None or coverage["spendShare"] >= 0.6:
        return None
    preview = finance.threshold_preview(cur, scope, [20, 35, 50])
    better = [p for p in preview if (p["spendShare"] or 0) > coverage["spendShare"]]
    suggestion = min(better, key=lambda p: p["queuePerMonth"]) if better else None
    return Insight(
        id="AI-38",
        code="THRESHOLD_MISCALIBRATED",
        severity="serious",
        title=f"Your gate sees only {coverage['spendShare']:.0%} of committed spend",
        body=(
            f"At the current threshold of {coverage['threshold']:.0f} pax, {coverage['proposalShare']:.0%} of "
            f"proposals reach you and they carry {coverage['spendShare']:.0%} of the money."
            + (
                f" Moving it to {suggestion['threshold']} would bring {suggestion['spendShare']:.0%} of spend under "
                f"the gate at about {suggestion['queuePerMonth']:.0f} proposals a month."
                if suggestion
                else ""
            )
        ),
        evidence={"metric": "M56", "value": coverage["spendShare"], "threshold": coverage["threshold"]},
        action=_action("Open the coverage matrix", "#panel-cfo_gate_matrix"),
    )


@rule("AI-39")
def category_concentration(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    rows = finance.budget_category_split(cur, scope)
    totals: dict[str, float] = {}
    for row in rows:
        totals[row["category"]] = totals.get(row["category"], 0.0) + row["value"]
    grand = sum(totals.values())
    if not grand:
        return None
    top, value = max(totals.items(), key=lambda kv: kv[1])
    share = value / grand
    if share <= 0.5:
        return None
    return Insight(
        id="AI-39",
        code="CATEGORY_CONCENTRATION",
        severity="warning",
        title=f"{top} carries {share:.0%} of committed spend",
        body=f"RM {value:,.2f} of RM {grand:,.2f}. One finance code above half the total is a concentration worth naming.",
        evidence={"metric": "M52", "value": share, "category": top},
        action=_action("Open the category breakdown", "#panel-cfo_spend_by_category"),
    )


@rule("AI-40")
def runway_concentration(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Labelled a timing signal, not a spend signal. One heavy month is usually
    a calendar artefact, and reading it as overspend leads to the wrong action."""
    months = finance.forward_commitment(cur, scope, months=6)
    total = sum(m["value"] for m in months)
    if not total:
        return None
    peak = max(months, key=lambda m: m["value"])
    share = peak["value"] / total
    if share <= 0.4:
        return None
    return Insight(
        id="AI-40",
        code="RUNWAY_CONCENTRATION",
        severity="warning",
        title=f"{peak['x'][:7]} carries {share:.0%} of the six-month runway",
        body=(
            f"RM {peak['value']:,.2f} of RM {total:,.2f} falls in one month. This is a timing signal rather than a "
            "spend signal — the total is unchanged, the cash-flow shape is not."
        ),
        evidence={"metric": "M57", "value": share, "month": peak["x"]},
        action=_action("Open the runway", "#panel-cfo_runway"),
    )


# --- People & workload ----------------------------------------------------


@rule("AI-08")
def workload_imbalance(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    staff = people.assignments_per_staff(cur, scope, spec)
    balance = people.workload_balance(staff)
    if not staff or balance["spread"] is None or balance["spread"] == float("inf") or balance["spread"] <= 3:
        return None
    busiest = max(staff, key=lambda s: s["value"])
    quietest = min(staff, key=lambda s: s["value"])
    return Insight(
        id="AI-08",
        code="WORKLOAD_IMBALANCE",
        severity="warning",
        title=f"Workload is {balance['spread']:.1f}× apart across the team",
        body=(
            f"{busiest['name']} holds {busiest['value']} assignments; {quietest['name']} holds {quietest['value']}. "
            "An average conceals this entirely."
        ),
        evidence={"metric": "M61", "value": balance["spread"], "staff": balance["staff"]},
        action=_action("Rebalance", "/app/inbox/requests", requestKind=spec.requirement, assignee=busiest["userId"]),
    )


@rule("AI-19")
def spof_lane(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """A standing card while true, not an event. It states the capacity loss per
    absence because that is what makes it a staffing argument rather than an
    observation."""
    result = risk.single_point_of_failure(cur, scope)
    if not result["isFragile"]:
        return None
    return Insight(
        id="AI-19",
        code="SPOF_LANE",
        severity="serious",
        title=f"This lane has {result['staff']} active staff",
        body=(
            f"One absence removes {result['lossPerAbsence']:.0%} of delivery capacity."
            if result["lossPerAbsence"]
            else "There is nobody active in this lane at all."
        ),
        evidence={"metric": "M73", "value": result["staff"]},
        action=None,  # Nothing on this dashboard can hire; a button here would lead nowhere.
    )


@rule("AI-21")
def double_booked(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    conflicts = people.double_booked(cur, scope, spec)
    if not conflicts:
        return None
    first = conflicts[0]
    return Insight(
        id="AI-21",
        code="DOUBLE_BOOKED",
        severity="critical",
        title=f"{first['name']} is booked twice on {first['date']}",
        body=(
            f"{first['first']['label']} ({first['first']['start']}–{first['first']['end']}) overlaps "
            f"{first['second']['label']} ({first['second']['start']}–{first['second']['end']}). "
            f"{len(conflicts)} conflict(s) in total."
        ),
        evidence={"metric": "M60", "value": len(conflicts), "date": first["date"]},
        action=_action("Reassign", "/app/inbox/requests", requestKind=spec.requirement, assignee=first["userId"]),
    )


@rule("AI-42")
def claim_concentration(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """The card notes this may simply be one person's shift. Presenting a
    scheduling artefact as a fairness problem would be a false positive dressed
    as an insight."""
    claims = people.claim_distribution(cur, scope)
    total = sum(c["value"] for c in claims)
    if total < 5:
        return None
    top = max(claims, key=lambda c: c["value"])
    if not top["share"] or top["share"] <= 0.6:
        return None
    return Insight(
        id="AI-42",
        code="CLAIM_CONCENTRATION",
        severity="warning",
        title=f"{top['name']} claims {top['share']:.0%} of the pool",
        body=(
            f"{top['value']} of {total} orders. This may simply be their shift — first-come-first-served claiming "
            "makes coverage and enthusiasm look identical from here."
        ),
        evidence={"metric": "M65", "value": top["share"], "sample": total},
        action=_action("Open the claim distribution", "#panel-caf_claim_distribution"),
    )


@rule("AI-43")
def staffing_request_stalled(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    result = people.staff_availability(cur, scope)
    thin = [o for o in result["outlets"] if o["active"] < 2]
    if not thin:
        return None
    return Insight(
        id="AI-43",
        code="STAFFING_REQUEST_STALLED",
        severity="warning",
        title=f"{thin[0]['label']} has {thin[0]['active']} active staff",
        body=(
            "An outlet below two active staff cannot cover a shared pool through an absence. Staffing runs through "
            "Cafeteria Admin, and the wait is part of the plan."
        ),
        evidence={"metric": "M67", "value": thin[0]["active"], "outlet": thin[0]["outlet"]},
        action=_action("Manage your staff", "/app/cafeterias/my-staff"),
    )


@rule("AI-44")
def churn_spike(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    rows = people.staff_churn(cur, scope)
    departures = [r for r in rows if r["action"] in ("suspend", "remove")]
    if not departures:
        return None
    by_week: dict[str, int] = {}
    for row in departures:
        by_week[row["week"]] = by_week.get(row["week"], 0) + row["value"]
    series = [by_week[week] for week in sorted(by_week)]
    spike = risk.anomalous_spike(
        [{"y": value} for value in series], sigma=scope.config.number("ANOMALY_SIGMA", 2)
    )
    if spike is None:
        return None
    return Insight(
        id="AI-44",
        code="CHURN_SPIKE",
        severity="warning",
        title=f"{spike['value']:.0f} staff removals or suspensions this week",
        body=f"Against a trailing mean of {spike['mean']:.1f}. Churn at this rate reaches claim latency within a fortnight.",
        evidence={"metric": "M66", "value": spike["value"], "mean": spike["mean"]},
        action=_action("Open the staffing timeline", "#panel-caf_staffing_timeline"),
    )


# --- Demand & opportunity -------------------------------------------------


@rule("AI-07")
def low_seat_fill(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    result = capacity.seat_fill(cur, scope)
    if result["median"] is None or result["median"] >= 0.55 or result["sample"] < 3:
        return None
    return Insight(
        id="AI-07",
        code="LOW_SEAT_FILL",
        severity="serious",
        title=f"Median seat fill is {result['median']:.0%}",
        body=(
            f"Across {result['sample']} trips, against a 60–95% target band. A fleet at this fill is short of "
            "vehicles it does not actually need, and this figure is the argument against the next purchase."
        ),
        evidence={"metric": "M32", "value": result["median"], "sample": result["sample"]},
        action=_action("Open the distribution", "#panel-trn_seat_fill_distribution"),
    )


@rule("AI-25")
def group_split_surge(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    rows = capacity.guide_demand(cur, scope)
    splits = sum(r["splitTours"] for r in rows)
    tours = sum(r["tours"] for r in rows)
    share = ratio(splits, tours)
    if share is None or share <= 0.3:
        return None
    return Insight(
        id="AI-25",
        code="GROUP_SPLIT_SURGE",
        severity="warning",
        title=f"{share:.0%} of forward tours need splitting",
        body=(
            f"{splits} of {tours} tours exceed their start point's group cap. Each split is a guide the schedule "
            "does not show until someone works it out by hand."
        ),
        evidence={"metric": "M33", "value": share, "sample": tours},
        action=_action("Open the planner", "#panel-sts_guide_demand"),
    )


@rule("AI-30")
def consolidation_candidate(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    candidates = capacity.consolidation_candidates(cur, scope)
    if not candidates:
        return None
    first = candidates[0]
    return Insight(
        id="AI-30",
        code="CONSOLIDATION_CANDIDATE",
        severity="info",
        title=f"{len(candidates)} trip pair(s) could share one vehicle",
        body=(
            f"On {first['date']}, two trips on {first['route']} carry {first['combinedPax']} passengers between them "
            f"— inside one {first['vehicle']}'s {first['seats']:.0f} seats."
        ),
        evidence={"metric": "M32", "value": len(candidates), "date": first["date"]},
        action=_action("Open the route panel", "#panel-trn_route_concentration"),
    )


@rule("AI-37")
def engagement_decline(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    widget = widgets.get("hos_external_engagement")
    if not widget or widget.get("value") is None or widget["value"] >= 0.2:
        return None
    return Insight(
        id="AI-37",
        code="ENGAGEMENT_DECLINE",
        severity="warning",
        title=f"External guests are {widget['value']:.0%} of expected attendance",
        body=(
            "A school running largely internal events has a different case to make for its cost per head than one "
            "bringing external partners onto campus."
        ),
        evidence={"metric": "M46", "value": widget["value"]},
        action=_action("Open the guest mix", "#panel-hos_guest_mix"),
    )


@rule("AI-45")
def portion_surge(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Flags kitchen capacity rather than throughput — larger orders and more
    orders need different responses."""
    from .metrics import flow

    weeks = flow.order_volume_by_week(cur, scope)
    medians = [w["medianQuantity"] for w in weeks[-4:] if w["medianQuantity"] is not None]
    if len(medians) < 4 or not all(medians[i] < medians[i + 1] for i in range(3)):
        return None
    return Insight(
        id="AI-45",
        code="PORTION_SURGE",
        severity="warning",
        title="Median order size has risen three weeks running",
        body=(
            f"From {medians[0]:.0f} to {medians[-1]:.0f} portions. Larger orders are a kitchen-capacity signal, "
            "not a throughput one — the number of orders may be unchanged."
        ),
        evidence={"metric": "M08", "value": medians[-1], "window": "3 weeks"},
        action=_action("Open forward demand", "#panel-caf_forward_demand"),
    )


@rule("AI-32")
def dependency_drag(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    widget = widgets.get("hos_dependency_map")
    if not widget:
        return None
    rows = (widget.get("tableView") or {}).get("rows") or []
    scored = [r for r in rows if r.get("medianDays")]
    if not scored:
        return None
    total = sum(r["medianDays"] for r in scored)
    worst = max(scored, key=lambda r: r["medianDays"])
    share = ratio(worst["medianDays"], total)
    if share is None or share <= 0.4:
        return None
    return Insight(
        id="AI-32",
        code="DEPENDENCY_DRAG",
        severity="serious",
        title=f"{worst['label']} contributes {share:.0%} of this school's cycle time",
        body=(
            f"A median of {worst['medianDays']:.1f} days out of {total:.1f} across every requirement this school "
            "selects. Selecting it less often, or earlier, is the lever the school actually holds."
        ),
        evidence={"metric": "M14 + M42", "value": share, "requirement": worst["label"]},
        action=_action("Open the dependency map", "#panel-hos_dependency_map"),
    )


# --- Risk & correctness ---------------------------------------------------


@rule("AI-10")
def venue_conflict(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    conflicts = risk.venue_conflicts(cur, scope, spec)
    if not conflicts:
        return None
    first = conflicts[0]
    return Insight(
        id="AI-10",
        code="VENUE_CONFLICT",
        severity="serious",
        title=f"{first['gapMinutes']:.0f} minutes between two bookings at {first['location']}",
        body=(
            f"On {first['date']}, {first['first']['label']} ends at {first['first']['end']} and "
            f"{first['second']['label']} starts at {first['second']['start']}. The teardown window is "
            f"{first['teardownMinutes']} minutes. {len(conflicts)} conflict(s) in the horizon."
        ),
        evidence={"metric": "M31", "value": first["gapMinutes"], "location": first["location"]},
        action=_action("Open venue turnaround", "#panel-log_venue_turnaround"),
    )


@rule("AI-16")
def delivery_backlog(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is not None:
        result = risk.delivery_backlog(cur, scope, spec)
        if result["count"] <= 3:
            return None
        return Insight(
            id="AI-16",
            code="DELIVERY_BACKLOG",
            severity="serious",
            title=f"{result['count']} item(s) are outstanding after their event date",
            body=(
                f"Median age {result['medianAgeDays']:.0f} days, oldest {result['oldestAgeDays']:.0f}. Every "
                "forward-looking panel shows these as done."
            ),
            evidence={"metric": "M70", "value": result["count"], "medianAge": result["medianAgeDays"]},
            action=_action("Open the backlog", "/app/ongoing/requests", requestKind=spec.requirement, phase="post-event"),
        )
    # School variant: approved proposals whose event has passed with open tasks.
    from ..dashboard.widgets.school import SCHOOL_FILTER
    from ...db import fetch_one

    row = fetch_one(
        cur,
        f"""
        SELECT count(DISTINCT r.request_id) AS n
          FROM request r
          JOIN request_task t ON t.request_id = r.request_id
          JOIN event_schedule es ON es.request_id = r.request_id
         WHERE r.status = 'completed_approved'
           AND t.status NOT IN ('completed', 'cancelled')
           AND es."date" < %(today)s
           {SCHOOL_FILTER}
        """,
        scope.params(school=scope.unit_code),
    )
    count = int(row["n"]) if row else 0
    if count == 0:
        return None
    return Insight(
        id="AI-16",
        code="DELIVERY_BACKLOG",
        severity="serious",
        title=f"{count} past event(s) still carry open department work",
        body="The event has happened and a department task on it has not closed. Usually a completion nobody recorded.",
        evidence={"metric": "M70", "value": count},
        action=_action("See them", "/app/ongoing/proposals", school="mine"),
    )


@rule("AI-17")
def serve_time_risk(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    outlets = list(scope.outlets) if scope.profile_key == "cafeteria_manager" else []
    result = risk.orders_at_risk(cur, scope, outlets=outlets)
    if not (result["pending"] or result["approved"]):
        return None
    return Insight(
        id="AI-17",
        code="SERVE_TIME_RISK",
        severity="critical",
        title=f"{result['pending'] + result['approved']} order(s) are not yet in the kitchen",
        body=(
            f"{result['pending']} still need accepting and {result['approved']} are unclaimed, with the nearest serve "
            f"time at {result['soonest']}." if result["soonest"] else "Some live orders have not reached the kitchen."
        ),
        evidence={"metric": "M70", "value": result["pending"] + result["approved"], "soonest": result["soonest"]},
        action=_action("Open the board", "#panel-caf_service_board" if scope.profile_key == "cafeteria_manager" else "#panel-fmb_fanout_board"),
    )


@rule("AI-18")
def coverage_gap(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    widget = widgets.get("pho_coverage_gap")
    if not widget or not widget.get("value"):
        return None
    return Insight(
        id="AI-18",
        code="COVERAGE_GAP",
        severity="critical",
        title=f"{widget['value']} forward shoot(s) have no photographer",
        body=(widget.get("caption") or "") + " With a two-person roster, a third simultaneous shoot is not happening.",
        evidence={"metric": "M64", "value": widget["value"]},
        action=_action("Open the calendar", "#panel-pho_shoot_calendar"),
    )


@rule("AI-31")
def stranded_at_gate(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Detects the routing defect recorded in docs/dashboards/01 § 2.3(b); it
    does not fix it.

    A proposal from someone whose only unit is a service department routes to
    `hos_hod_review` — `_skips_hos_hod()` does not skip, because the applicant
    does belong to a unit — but no actor qualifies, because
    `is_hos_hod_for_applicant()` demands a School. The proposal is stranded with
    no error message.

    No action button: nobody can resolve this from a dashboard, and offering a
    link the API would refuse is worse than offering none.
    """
    unit_filter = scope.unit_code if scope.profile_key.startswith("hod_") else None
    rows = risk.stranded_at_gate(cur, scope, unit=unit_filter)
    if not rows:
        return None
    total = sum(r["count"] for r in rows)
    names = ", ".join(r["unitLabel"] for r in rows[:3])
    return Insight(
        id="AI-31",
        code="STRANDED_AT_GATE",
        severity="critical",
        title=f"{total} proposal(s) are stranded with no qualifying reviewer",
        body=(
            f"They sit at the school/department gate awaiting an approver from {names}, but the authorisation rule "
            "requires a Head of School and their applicant belongs only to a service department. Nobody can act on "
            "them. This needs a System Administrator — it cannot be resolved from this dashboard."
        ),
        evidence={"metric": "M78", "value": total, "oldest": rows[0]["oldest"]},
        action=None,
    )


# --- Data quality & catalogue ---------------------------------------------


@rule("AI-15")
def dietary_gap(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    outlets = list(scope.outlets) if scope.profile_key == "cafeteria_manager" else []
    matrix = capacity.menu_dietary_coverage(cur, scope, outlets=outlets)
    filled = {(c["outlet"], c["tag"]) for c in matrix["cells"] if c["value"]}
    gaps = [
        (outlet["label"], tag["label"])
        for outlet in matrix["outlets"]
        for tag in matrix["tags"]
        if (outlet["code"], tag["id"]) not in filled
    ]
    if not gaps:
        return None
    outlet_label, tag_label = gaps[0]
    return Insight(
        id="AI-15",
        code="DIETARY_GAP",
        severity="warning",
        title=f"{outlet_label} has no {tag_label} item on its active menu",
        body=(
            f"{len(gaps)} outlet-and-tag combination(s) are uncovered. An outlet missing a common dietary "
            "requirement cannot serve a large share of the events routed to it."
        ),
        evidence={"metric": "M38", "value": len(gaps), "outlet": outlet_label},
        action=_action(
            "Open the menu",
            "/app/menu" if scope.profile_key == "cafeteria_manager" else "/app/cafeterias/menu-oversight",
        ),
    )


@rule("AI-22")
def dead_catalogue(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    spec = spec_for(scope.unit_code)
    if spec is None:
        return None
    dead = capacity.dead_catalogue_entries(cur, scope, spec)
    if not dead:
        return None
    return Insight(
        id="AI-22",
        code="DEAD_CATALOGUE",
        severity="info",
        title=f"{len(dead)} active option(s) have had no selections in 90 days",
        body=(
            f"Starting with {dead[0]['label']}. Deactivating them shortens the applicant's form without removing "
            "anything anyone is using."
        ),
        evidence={"metric": "M76", "value": len(dead)},
        action=_action("Open the catalogue", spec.catalogue_route or "/app/dropdown-options"),
    )


@rule("AI-29")
def uncapped_start_point(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    rows = capacity.uncapped_start_points(cur, scope)
    if not rows:
        return None
    return Insight(
        id="AI-29",
        code="UNCAPPED_START_POINT",
        severity="warning",
        title=f"{len(rows)} start point(s) have no group cap but received tours",
        body=(
            f"{rows[0]['label']} took {rows[0]['tours']} tour(s) with no maximum group size set, so those tours "
            "contribute nothing to the guide-demand figure. The headline number is lower than the truth."
        ),
        evidence={"metric": "M33", "value": len(rows)},
        action=_action("Set a cap", "/app/dropdown-options/campusTourStart"),
    )


@rule("AI-33")
def peer_divergence(cur, scope: Scope, widgets: dict[str, Any]) -> Insight | None:
    """Suppressed if either side is under the bucket floor (R8), and no action
    button: the comparison is an R7 aggregate over rows the viewer cannot open,
    so there is nothing to drill to."""
    mine = finance.cost_per_pax(cur, scope, **({} if scope.profile_key == "cfo" else _school_filter(scope)))
    institutional = finance.cost_per_pax(cur, scope)
    floor = scope.config.bucket_floor()
    if mine["proposals"] < floor or institutional["proposals"] < floor:
        return None
    if not mine["value"] or not institutional["value"]:
        return None
    excess = mine["value"] / institutional["value"] - 1
    if excess <= 0.5:
        return None
    return Insight(
        id="AI-33",
        code="PEER_DIVERGENCE",
        severity="warning",
        title=f"Cost per pax is {excess:.0%} above the institutional median",
        body=(
            f"RM {mine['value']:,.2f} against RM {institutional['value']:,.2f}. Both figures depend on menu price "
            "coverage, so read them together with the price-coverage tile."
        ),
        evidence={"metric": "M55", "value": excess, "sample": mine["proposals"]},
        action=None,
    )


def _school_filter(scope: Scope) -> dict[str, Any]:
    from .widgets.school import SCHOOL_FILTER

    return {"request_filter": SCHOOL_FILTER, "extra": {"school": scope.unit_code}}


# --- Evaluation -----------------------------------------------------------


def evaluate(cur, scope: Scope, rule_ids: list[str], widgets: dict[str, Any]) -> list[dict[str, Any]]:
    """Run this profile's candidate rules, rank, and cap at five.

    A rule that raises is skipped rather than allowed to fail the page: the rail
    is decision support, and support that takes the dashboard down with it is
    not support.
    """
    import logging

    log = logging.getLogger(__name__)
    found: list[Insight] = []
    for rule_id in rule_ids:
        fn = RULES.get(rule_id)
        if fn is None:
            continue
        try:
            insight = fn(cur, scope, widgets)
        except Exception:
            log.exception("dashboard.insight.failed", extra={"rule": rule_id, "profile": scope.profile_key})
            continue
        if insight is not None:
            found.append(insight)
    found.sort(key=lambda i: (SEVERITY_RANK.get(i.severity, 9), i.id))
    return [insight.as_json() for insight in found[:MAX_CARDS]]
