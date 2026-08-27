"""Widgets every service department shares, parameterised by unit.

These are the same *question* asked of six different lanes: how fast does this
head decide, how much work is promised and unstaffed, where does the lane time
go. Building them once means a Head of School or the CFO comparing two
departments is comparing the same decomposition, which is the whole reason the
lane-time bar is deliberately identical across the six.

Everything role-specific lives in the per-profile modules beside this one.
"""
from __future__ import annotations

from typing import Any

from ..metrics import capacity, common, demand, flow, people, quality, risk, sla
from ..scope import Scope, delta, num, ratio, status_for
from .base import (
    FMT_COUNT,
    FMT_DAYS,
    FMT_HOURS,
    FMT_PERCENT,
    drill,
    kpi,
    panel,
    series,
    table,
    widget,
)


def spec(scope: Scope) -> common.DepartmentSpec:
    """The caller's own department shape.

    Raises for a unit with no known detail table. Only widgets that genuinely
    read that table call this; the ones that merely want a `requestKind` for a
    drill link use `maybe_spec()` instead, so a service department created after
    this design shipped degrades to the generic profile rather than erroring -
    which is the whole reason `hod_generic` exists.
    """
    found = common.spec_for(scope.unit_code)
    if found is None:
        raise ValueError(f"No department spec for unit {scope.unit_code}")
    return found


def maybe_spec(scope: Scope) -> common.DepartmentSpec | None:
    return common.spec_for(scope.unit_code)


def requirement_of(scope: Scope) -> str | None:
    """The requirement name for a drill filter, or None for an unmapped unit.

    `drill()` strips None params, so an unmapped unit gets an unfiltered
    destination rather than a broken one.
    """
    found = common.spec_for(scope.unit_code)
    return found.requirement if found else None


def _requests_route(scope: Scope, bucket: str = "inbox") -> str:
    return f"/app/{bucket}/requests"


# --- KPIs -----------------------------------------------------------------


@widget("dept_decision_latency")
def decision_latency(cur, scope: Scope) -> dict[str, Any]:
    current = sla.decision_latency(cur, scope)
    previous = sla.decision_latency(cur, scope, previous=True)
    target = scope.config.decision_sla_hours(scope.unit_code)
    trend = sla.decision_latency_by_week(cur, scope)
    median = current["median"]
    return kpi(
        label="Decision latency",
        value=median,
        fmt=FMT_HOURS,
        secondary=f"p90 {current['p90']:.0f}h" if current["p90"] is not None else None,
        caption=f"{current['sample']} decisions in period",
        target={"max": target, "label": f"target <= {target:g}h"},
        status=status_for(median, warn=target, critical=target * 2),
        delta=delta(median, previous["median"], higher_is_better=False),
        sparkline=trend,
        definition="M10 - task created to its first approve or send-back",
        drill_to=drill(_requests_route(scope), bucket="inbox", requestKind=requirement_of(scope)),
    )


@widget("dept_unassigned_work")
def unassigned_work(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    result = people.unassigned_approved_work(cur, scope, department)
    sla_hours = scope.config.assignment_sla_hours(scope.unit_code)
    return kpi(
        label="Unassigned approved work",
        value=result["count"],
        fmt=FMT_COUNT,
        secondary=f"{result['urgent']} inside the risk window" if result["urgent"] else None,
        caption=f"soonest {result['soonest']}" if result["soonest"] else "nothing approved and unstaffed",
        target={"max": 0, "label": f"assign within {sla_hours:g}h of approval"},
        status="critical" if result["urgent"] else ("warning" if result["count"] else "good"),
        definition="M64 - approved rows with no assignee, weighted by days to the event",
        drill_to=drill("/app/ongoing/requests", requestKind=department.requirement, assigned="none"),
    )


@widget("dept_send_back_rate")
def send_back_rate(cur, scope: Scope) -> dict[str, Any]:
    current = quality.send_back_rate(cur, scope)
    previous = quality.send_back_rate(cur, scope, previous=True)
    depth = quality.send_back_comment_depth(cur, scope)
    warn = scope.config.send_back_warn_rate(scope.unit_code)
    terse = depth["terseShare"]
    return kpi(
        label="Send-back rate",
        value=current["rate"],
        fmt=FMT_PERCENT,
        secondary=f"{terse:.0%} under 40 characters" if terse is not None else None,
        caption=f"{current['count']} of {current['sample']} tasks",
        target={"max": warn, "label": f"target <= {warn:.0%}"},
        status=status_for(current["rate"], warn=warn, critical=warn * 2),
        delta=delta(current["rate"], previous["rate"], higher_is_better=False),
        definition="M20 with M24 - a terse comment guarantees another loop",
        drill_to=drill("/app/history/requests", requestKind=requirement_of(scope), outcome="resubmitted"),
    )


@widget("dept_prep_runway")
def prep_runway(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    current = sla.preparation_runway(cur, scope, department)
    previous = sla.preparation_runway(cur, scope, department, previous=True)
    floor = scope.config.lead_days(scope.unit_code)
    return kpi(
        label="Preparation runway",
        value=current["median"],
        fmt=FMT_DAYS,
        secondary=f"p10 {current['p10']:.1f}d" if current["p10"] is not None else None,
        caption=f"{current['sample']} tasks with a dated requirement",
        target={"min": floor, "label": f"target >= {floor:g} days"},
        status=status_for(current["median"], minimum=floor, critical=floor / 2, higher_is_better=True),
        delta=delta(current["median"], previous["median"], higher_is_better=True),
        definition="M16 - notice between the task appearing and the event date",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, sort="schedule"),
    )


@widget("dept_off_catalogue")
def off_catalogue(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    result = quality.off_catalogue_rate(cur, scope, department)
    return kpi(
        label="Off-catalogue rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        caption=f"{result['count']} of {result['sample']} rows typed in",
        target={"max": 0.10, "label": "target <= 10%"},
        status=status_for(result["rate"], warn=0.10, critical=0.25),
        definition="M27 - an off-catalogue row has no stock level, so it is invisible to the forecast",
        drill_to=drill(department.catalogue_route or "/app/dropdown-options"),
    )


# --- Panels ---------------------------------------------------------------


@widget("dept_lane_time")
def lane_time(cur, scope: Scope) -> dict[str, Any]:
    rows = sla.lane_time_breakdown(cur, scope)
    return panel(
        title="Where the lane time goes",
        subtitle="Median hours per week: decision, then waiting for an assignee, then execution",
        chart="stacked-bar",
        series_list=[
            series("decision", "Decision", 1, [{"x": r["x"], "y": r["decision"]} for r in rows]),
            series("assignment", "Assignment lag", 2, [{"x": r["x"], "y": r["assignment"]} for r in rows]),
            series("execution", "Execution", 3, [{"x": r["x"], "y": r["execution"]} for r in rows]),
        ],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Hours", "format": FMT_HOURS}},
        table_view=table(
            [
                {"key": "x", "label": "Week", "format": "date"},
                {"key": "decision", "label": "Decision (h)", "format": FMT_HOURS},
                {"key": "assignment", "label": "Assignment lag (h)", "format": FMT_HOURS},
                {"key": "execution", "label": "Execution (h)", "format": FMT_HOURS},
                {"key": "sample", "label": "Tasks", "format": FMT_COUNT},
            ],
            rows,
        ),
        caption="Turns “we are slow” into “we are slow here”, which has three different fixes.",
        empty="No tasks have completed a full cycle in this period yet.",
        drill_to=drill("/app/history/requests", requestKind=requirement_of(scope)),
    )


@widget("dept_staff_balance")
def staff_balance(cur, scope: Scope) -> dict[str, Any]:
    # No spec needed: assignments are scoped by unit code through the task
    # table, not by the department's own detail table, so this works for a unit
    # created after this design shipped.
    staff = people.assignments_per_staff(cur, scope, maybe_spec(scope))
    balance = people.workload_balance(staff)
    median = balance["median"]
    subtitle = "Assignments per person this period"
    if balance["spread"] and balance["spread"] != float("inf"):
        subtitle += f" · spread {balance['spread']:.1f}x across {balance['staff']} staff"
    return panel(
        title="Workload balance",
        subtitle=subtitle,
        chart="dot-plot",
        series_list=[
            series(
                "staff",
                "Staff",
                1,
                [
                    {"x": s["value"], "label": s["name"], "userId": s["userId"], "completed": s["completed"]}
                    for s in staff
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Assignments", "format": FMT_COUNT}},
        annotations=[{"type": "reference", "axis": "x", "value": median, "label": "unit median"}] if median else [],
        table_view=table(
            [
                {"key": "name", "label": "Staff", "format": "text"},
                {"key": "value", "label": "Assignments", "format": FMT_COUNT},
                {"key": "completed", "label": "Completed", "format": FMT_COUNT},
                {"key": "medianHours", "label": "Median handling (h)", "format": FMT_HOURS},
            ],
            staff,
        ),
        caption=(
            "Gini is suppressed below three staff — with two people it restates the ratio."
            if balance["giniSuppressed"]
            else f"Gini {balance['gini']:.2f} · three people at 12/11/1 is invisible in an average of 8."
        ),
        empty="This unit has no active staff assignments in the period.",
        mobile="ranked-list",
    )


@widget("dept_catalogue_health")
def catalogue_health(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    usage = capacity.catalogue_usage(cur, scope, department)
    off = quality.off_catalogue_rate(cur, scope, department)
    dead = [item for item in usage if item["value"] == 0]
    return panel(
        title="Catalogue health",
        subtitle="Active options by selections in the period",
        chart="bar-chart",
        series_list=[
            series(
                "selections",
                "Selections",
                1,
                [
                    {"x": item["value"], "label": item["label"], "optionId": item["optionId"], "dead": item["value"] == 0}
                    for item in usage
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Selections", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "label", "label": "Option", "format": "text"},
                {"key": "value", "label": "Selections", "format": FMT_COUNT},
            ],
            usage,
        ),
        caption=(
            f"{len(dead)} active option(s) with no selections lengthen the form for nothing. "
            f"Off-catalogue rate {off['rate']:.0%}: demand escaping the catalogue entirely."
            if off["rate"] is not None
            else f"{len(dead)} active option(s) with no selections lengthen the form for nothing."
        ),
        empty="No options are configured for this department yet.",
        drill_to=drill(department.catalogue_route or "/app/dropdown-options"),
        mobile="ranked-list",
    )


@widget("dept_rework_profile")
def rework_profile(cur, scope: Scope) -> dict[str, Any]:
    weekly = quality.send_backs_by_week(cur, scope)
    loops = quality.rework_loops(cur, scope)
    yield_rate = quality.first_pass_yield(cur, scope)
    caption_parts = []
    if loops is not None:
        caption_parts.append(f"{loops:.1f} loops per sent-back task")
    if yield_rate is not None:
        caption_parts.append(f"first-pass yield {yield_rate:.0%}")
    return panel(
        title="Rework profile",
        subtitle="Send-backs per week",
        chart="column-chart",
        series_list=[series("sendBacks", "Send-backs", 2, weekly)],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Send-backs", "format": FMT_COUNT}},
        table_view=table(
            [{"key": "x", "label": "Week", "format": "date"}, {"key": "y", "label": "Send-backs", "format": FMT_COUNT}],
            weekly,
        ),
        caption=" · ".join(caption_parts) or None,
        empty="Nothing has been sent back in this period.",
        drill_to=drill("/app/history/requests", requestKind=requirement_of(scope), outcome="resubmitted"),
        mobile="scroll",
    )


@widget("dept_forward_demand")
def forward_demand(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    committed = demand.forward_demand(cur, scope, department)
    forecast = demand.demand_forecast(cur, scope, department)
    series_list = [series("committed", "Committed", 1, committed)]
    if forecast["available"]:
        series_list.append(
            series("projected", "Projected", 1, forecast["points"], dashed=True, band=True)
        )
    return panel(
        title="Forward demand",
        subtitle=f"Committed rows per day over the next {scope.config.horizon_days(scope.unit_code)} days",
        chart="area-chart",
        series_list=series_list,
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Rows", "format": FMT_COUNT}},
        table_view=table(
            [{"key": "x", "label": "Date", "format": "date"}, {"key": "y", "label": "Rows", "format": FMT_COUNT}],
            committed,
        ),
        caption=forecast.get("method") if forecast["available"] else forecast.get("reason"),
        caveat=None if forecast["available"] else "Projection unavailable — " + str(forecast.get("reason", "")),
        empty="Nothing is booked in the forward horizon.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, sort="schedule"),
    )


@widget("dept_at_risk")
def at_risk(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    risky = risk.at_risk_tasks(cur, scope, department)
    latency = sla.decision_latency(cur, scope)
    stalled = risk.stalled_tasks(cur, scope, median_decision_hours=latency["median"])
    return panel(
        title="At risk this week",
        subtitle=f"Open work inside the next {risky['windowDays']} days",
        chart="alert-list",
        data={
            "items": risky["items"],
            "stalled": stalled,
            "cancellationLocked": risk.cancellation_window_exposure(cur, scope),
        },
        table_view=table(
            [
                {"key": "date", "label": "Date", "format": "date"},
                {"key": "eventTitle", "label": "Event", "format": "text"},
                {"key": "status", "label": "Task status", "format": "text"},
            ],
            risky["items"],
        ),
        empty="Nothing in this unit falls inside the risk window.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, risk="true"),
    )


# --- Generic-department fallbacks ----------------------------------------
# A service unit created after this design shipped has no detail table, so
# every widget above that reads one is unavailable to it. These four cover the
# families that need only request_task and workflow_history.


@widget("gen_clearance_rate")
def clearance_rate(cur, scope: Scope) -> dict[str, Any]:
    from .base import hero

    current = flow.clearance_rate(cur, scope)
    previous = flow.clearance_rate(cur, scope, previous=True)
    return hero(
        label="Clearance rate",
        value=current,
        fmt="ratio",
        caption="Resolved divided by created in the period",
        target={"min": 1.0, "label": "target >= 1.0 sustained"},
        status=status_for(current, minimum=1.0, critical=0.8, higher_is_better=True),
        delta=delta(current, previous, higher_is_better=True),
        definition="M02 - above 1.0 the backlog is shrinking",
        empty="No tasks have reached this unit yet.",
        drill_to=drill("/app/inbox/requests"),
    )


@widget("gen_open_backlog")
def open_backlog(cur, scope: Scope) -> dict[str, Any]:
    total = flow.open_backlog(cur, scope)
    wip = flow.work_in_progress(cur, scope)
    return kpi(
        label="Open backlog",
        value=total,
        fmt=FMT_COUNT,
        secondary=f"{wip} in progress",
        caption=f"{total - wip} not yet started",
        status="good" if total == 0 else "warning",
        definition="M03 with M06 - untouched work separated from work under way",
        drill_to=drill("/app/inbox/requests"),
    )


@widget("gen_first_pass_yield")
def first_pass_yield(cur, scope: Scope) -> dict[str, Any]:
    value = quality.first_pass_yield(cur, scope)
    return kpi(
        label="First-pass yield",
        value=value,
        fmt=FMT_PERCENT,
        caption="Completed with no send-back",
        target={"min": 0.8, "label": "target >= 80%"},
        status=status_for(value, minimum=0.8, critical=0.5, higher_is_better=True),
        definition="M26",
        drill_to=drill("/app/history/requests"),
    )


@widget("gen_backlog_age")
def backlog_age(cur, scope: Scope) -> dict[str, Any]:
    rows = flow.backlog_age_profile(cur, scope)
    return panel(
        title="Backlog age profile",
        subtitle="Open tasks by how long they have been waiting",
        chart="column-chart",
        series_list=[series("age", "Open tasks", 1, [{"x": r["bucket"], "y": r["value"]} for r in rows])],
        axes={"x": {"type": "category", "label": "Age"}, "y": {"type": "linear", "label": "Tasks", "format": FMT_COUNT}},
        table_view=table(
            [{"key": "bucket", "label": "Age", "format": "text"}, {"key": "value", "label": "Tasks", "format": FMT_COUNT}],
            rows,
        ),
        caption="A distribution, not a mean: a mean of four days hides the one task sitting at thirty.",
        empty="Nothing is open in this unit.",
        signature=True,
        drill_to=drill("/app/inbox/requests"),
    )


@widget("gen_throughput")
def throughput(cur, scope: Scope) -> dict[str, Any]:
    rows = flow.throughput_by_week(cur, scope)
    return panel(
        title="Throughput",
        subtitle="Tasks completed per week",
        chart="column-chart",
        series_list=[series("completed", "Completed", 1, rows)],
        axes={"x": {"type": "date", "label": "Week"}, "y": {"type": "linear", "label": "Tasks", "format": FMT_COUNT}},
        table_view=table(
            [{"key": "x", "label": "Week", "format": "date"}, {"key": "y", "label": "Completed", "format": FMT_COUNT}],
            rows,
        ),
        empty="Nothing has completed in this window.",
        mobile="scroll",
    )


@widget("gen_stalled")
def stalled(cur, scope: Scope) -> dict[str, Any]:
    latency = sla.decision_latency(cur, scope)
    result = risk.stalled_tasks(cur, scope, median_decision_hours=latency["median"])
    return panel(
        title="Stalled work",
        subtitle=f"Open beyond {result['thresholdHours']:.0f}h",
        chart="alert-list",
        data={"items": [], "stalled": result, "cancellationLocked": 0},
        table_view=table([{"key": "count", "label": "Stalled tasks", "format": FMT_COUNT}], [result]),
        caption="The threshold is twice this unit's own median decision time, not an absolute hour count.",
        empty="Nothing is stalled.",
        drill_to=drill("/app/inbox/requests"),
    )
