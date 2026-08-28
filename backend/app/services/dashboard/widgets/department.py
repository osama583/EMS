"""Widgets shared across every simplified HOD profile, plus the hod_generic
fallback for a unit with no known detail table.

A/V, Logistics, Transport, Student Services and Photography no longer carry
their own per-department widget module - they were unified onto this one
shared shape (a "jobs at risk" hero, a plain Risk List, who's-carrying-what-
work, and what's-used-most), so a head reading a different department's
dashboard sees the same page shape, not a bespoke instrument per lane. F&B
(widgets/fmb.py) is not yet part of that unification - see its own module
docstring.

Everything role-specific for the departments still outside this unification
(F&B, School, CFO, Cafeteria) lives in the per-profile modules beside this
one.
"""
from __future__ import annotations

from typing import Any

from ..metrics import capacity, common, flow, people, quality, risk, sla
from ..scope import Scope, delta, status_for
from .base import (
    FMT_COUNT,
    FMT_PERCENT,
    drill,
    hero,
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


@widget("dept_jobs_at_risk")
def jobs_at_risk(cur, scope: Scope) -> dict[str, Any]:
    """Hero — plain count of jobs at risk right now, reading the exact same
    rows risk_list() below lists. Kept as one function call shared by both so
    the hero number can never drift from what the Risk List panel shows -
    the two are the same query, read once.
    """
    department = spec(scope)
    result = risk.risk_list(cur, scope, department)
    threshold = result["thresholdMinutes"]
    label = f"{threshold} min" if threshold < 120 else f"{threshold // 60}h" if threshold < 24 * 60 else "1 day"
    return hero(
        label="Jobs at risk right now",
        value=result["count"],
        fmt=FMT_COUNT,
        caption=(
            f"not started, due within {label}" if result["count"] else f"nothing due within {label} is unstarted"
        ),
        target={"max": 0, "label": "target: none"},
        status="critical" if result["count"] else "good",
        definition=f"Open jobs with nobody assigned, due within {label} of now (or already overdue)",
        empty=f"Nothing due within {label} is still unstarted.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, risk="true"),
    )


@widget("dept_request_counts")
def request_counts(cur, scope: Scope) -> dict[str, Any]:
    """Compact four-number strip: Inbox / Ongoing / Completed / Late.

    Plain status counts a head already knows the meaning of from the rest of
    the app (the sidebar's own Inbox/Ongoing/History routes) - not a new
    vocabulary, just those same three buckets counted, plus how many of the
    ongoing ones are overdue.
    """
    department = maybe_spec(scope)
    counts = flow.request_bucket_counts(cur, scope)
    late = flow.late_request_count(cur, scope, department)
    return {
        "kind": "counts",
        "items": [
            {"key": "inbox", "label": "Inbox", "value": counts["inbox"], "status": "unknown", "drill": drill(_requests_route(scope, "inbox"), requestKind=requirement_of(scope))},
            {"key": "ongoing", "label": "Ongoing", "value": counts["ongoing"], "status": "unknown", "drill": drill(_requests_route(scope, "ongoing"), requestKind=requirement_of(scope))},
            {"key": "completed", "label": "Completed", "value": counts["completed"], "status": "good", "drill": drill(_requests_route(scope, "history"), requestKind=requirement_of(scope))},
            {"key": "late", "label": "Late", "value": late, "status": "critical" if late else "good", "drill": drill(_requests_route(scope, "ongoing"), requestKind=requirement_of(scope), risk="true")},
        ],
    }


# --- Panels ---------------------------------------------------------------


@widget("dept_risk_list")
def risk_list(cur, scope: Scope) -> dict[str, Any]:
    """The plain Risk List: named jobs that have not started and whose own
    deadline is inside this department's threshold (or already passed).

    Reads risk.risk_list(), the mixed-unit (minutes/hours/day), per-department
    threshold version - not risk.at_risk_tasks()/M70, which is a single
    days-wide window shared by every department regardless of how far in
    advance that department's work is normally staffed.
    """
    department = spec(scope)
    result = risk.risk_list(cur, scope, department)
    return panel(
        title="Risk list",
        subtitle="Jobs that have not started and are due soon",
        chart="alert-list",
        data={"items": result["items"], "stalled": None, "cancellationLocked": 0},
        table_view=table(
            [
                {"key": "date", "label": "Due", "format": "datetime"},
                {"key": "eventTitle", "label": "Event", "format": "text"},
                {"key": "status", "label": "Status", "format": "text"},
            ],
            result["items"],
        ),
        empty="Nothing unstarted is due soon.",
        drill_to=drill("/app/inbox/requests", requestKind=department.requirement, risk="true"),
    )


@widget("dept_staff_balance")
def staff_balance(cur, scope: Scope) -> dict[str, Any]:
    # No spec needed: assignments are scoped by unit code through the task
    # table, not by the department's own detail table, so this works for a unit
    # created after this design shipped.
    staff = people.assignments_per_staff(cur, scope, maybe_spec(scope))
    balance = people.workload_balance(staff)
    return panel(
        title="Who's carrying how much work",
        subtitle="Jobs currently assigned to each staff member",
        chart="bar-chart",
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
        axes={"x": {"type": "linear", "label": "Jobs assigned", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "name", "label": "Staff", "format": "text"},
                {"key": "value", "label": "Jobs assigned", "format": FMT_COUNT},
                {"key": "completed", "label": "Completed", "format": FMT_COUNT},
            ],
            staff,
        ),
        caption=(
            "Work is spread evenly across the team."
            if not balance["spread"] or balance["spread"] == float("inf") or balance["spread"] <= 1.5
            else "One person is carrying noticeably more than the rest."
        ),
        empty="No staff have any jobs assigned right now.",
        mobile="ranked-list",
    )


@widget("dept_catalogue_health")
def catalogue_health(cur, scope: Scope) -> dict[str, Any]:
    department = spec(scope)
    usage = capacity.catalogue_usage(cur, scope, department)
    off = quality.off_catalogue_rate(cur, scope, department)
    dead = [item for item in usage if item["value"] == 0]
    return panel(
        title="Most used",
        subtitle="What's requested most from your catalogue",
        chart="bar-chart",
        series_list=[
            series(
                "selections",
                "Times requested",
                1,
                [
                    {"x": item["value"], "label": item["label"], "optionId": item["optionId"], "dead": item["value"] == 0}
                    for item in usage
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Times requested", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "label", "label": "Item", "format": "text"},
                {"key": "value", "label": "Times requested", "format": FMT_COUNT},
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
# every widget above that reads one is unavailable to it. These cover the
# families that need only request_task and workflow_history.


@widget("gen_clearance_rate")
def clearance_rate(cur, scope: Scope) -> dict[str, Any]:
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
