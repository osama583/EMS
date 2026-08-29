"""Widgets shared across every simplified HOD profile, plus the hod_generic
fallback for a unit with no known detail table.

A/V, Logistics, Transport, Student Services and Photography no longer carry
their own per-department widget module - they were unified onto this one
shared shape (a "jobs at risk" hero, an on-time and a push-back tile,
who's-carrying-what-work, and what's-used-most), so a head reading a different
department's dashboard sees the same page shape, not a bespoke instrument per
lane. The two panels are deliberately the same forms the Cafeteria Manager
carries - a column chart and a ring - because they answer the same two
questions for a different role. F&B
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


def _humanise_minutes(minutes: float) -> str:
    """A signed minute count as the unit a person would say it in.

    Departments close jobs weeks ahead of the booked window, so the raw figure
    is routinely five digits: "median 77179 min early" is arithmetically right
    and communicates nothing. The unit steps up with the magnitude, which is
    what makes the number readable at both ends of that range.
    """
    magnitude = abs(minutes)
    if magnitude < 90:
        return f"{magnitude:.0f} min"
    if magnitude < 48 * 60:
        return f"{magnitude / 60:.0f}h"
    return f"{magnitude / 1440:.0f} days"


@widget("dept_jobs_at_risk")
def jobs_at_risk(cur, scope: Scope) -> dict[str, Any]:
    """Hero — plain count of jobs at risk right now.

    Reads `risk.risk_list()`, which is also what the Risk List *panel* used to
    render before it was removed from these profiles. The metric stays: the
    count is the useful part and it belongs on one tile, not restated as a
    twenty-five-row list a band further down.
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
            # Always critical, matching caf_request_counts: a green zero trains
            # the eye to skim the one tile on the strip worth stopping for.
            {"key": "late", "label": "Late", "value": late, "status": "critical", "drill": drill(_requests_route(scope, "ongoing"), requestKind=requirement_of(scope), risk="true")},
        ],
    }


# --- Panels ---------------------------------------------------------------


@widget("dept_on_time_completion")
def on_time_completion(cur, scope: Scope) -> dict[str, Any]:
    """The department twin of the cafeteria's on-time delivery tile.

    Every department promised someone a time, and until now none of the five
    simplified profiles carried a number saying whether it was kept. What
    "the time" *is* differs by lane and is resolved in `sla.task_deadline_sql`,
    so the caption names the basis rather than leaving a head to assume their
    number means the same as Transport's.
    """
    department = spec(scope)
    result = sla.task_punctuality(cur, scope, department)
    median = result["medianMinutes"]
    return kpi(
        label="On-time completion",
        value=result["rate"],
        fmt=FMT_PERCENT,
        secondary=f"measured against {result['basis']}",
        caption=(
            f"{result['late']} of {result['completed']} completed jobs finished late"
            if result["completed"]
            else "No jobs completed in this period"
        )
        + (
            f" · median {_humanise_minutes(median)} {'late' if median > 0 else 'early'}"
            if median is not None
            else ""
        ),
        target={"min": 0.95, "label": "Goal: 95% or higher"},
        status=status_for(result["rate"], minimum=0.95, critical=0.85, higher_is_better=True),
        definition=f"Completed tasks resolved on or before {result['basis']}",
        drill_to=drill(_requests_route(scope, "history"), requestKind=requirement_of(scope)),
    )


@widget("dept_pushback_rate")
def pushback_rate(cur, scope: Scope) -> dict[str, Any]:
    """M20 read from the department side - work this unit handed back to the
    applicant rather than doing.

    Not a failure number on its own: a send-back is often the right call on a
    proposal that arrived unusable. It is a *cost* number - every push-back is
    a round trip the applicant pays for - which is why the target is a ceiling
    rather than a floor and the caption gives the count behind the rate.
    """
    result = quality.send_back_rate(cur, scope)
    previous = quality.send_back_rate(cur, scope, previous=True)
    return kpi(
        label="Push-back rate",
        value=result["rate"],
        fmt=FMT_PERCENT,
        caption=f"{result['count']} of {result['sample']} jobs sent back to the applicant",
        delta=delta(result["rate"], previous["rate"], higher_is_better=False),
        target={"max": 0.10, "label": "target <= 10%"},
        status=status_for(result["rate"], warn=0.10, critical=0.25),
        definition="M20 — tasks this unit returned to the applicant for correction",
        drill_to=drill(_requests_route(scope, "history"), requestKind=requirement_of(scope), taskStatus="resubmitted"),
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
        # Vertical columns, matching caf_staff_workload (widgets/cafeteria.py).
        chart="column-chart",
        series_list=[
            series(
                "staff",
                "Staff",
                1,
                [
                    {"x": s["name"], "y": s["value"], "userId": s["userId"], "completed": s["completed"]}
                    for s in staff
                ],
            )
        ],
        axes={
            "x": {"type": "category", "label": "Staff"},
            "y": {"type": "linear", "label": "Jobs assigned", "format": FMT_COUNT},
        },
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
    # Same ring as caf_menu_performance (widgets/cafeteria.py): the top seven by share, everything
    # else folded into one "Other" wedge.
    ordered = sorted(usage, key=lambda item: item["value"], reverse=True)
    top = [item for item in ordered if item["value"] > 0][:7]
    other_total = sum(item["value"] for item in ordered[len(top) :] if item["value"] > 0)
    segments = [{"label": item["label"], "value": item["value"], "optionId": item["optionId"]} for item in top]
    if other_total:
        segments.append({"label": "Other options", "value": other_total})
    return panel(
        title="Most used",
        subtitle="What's requested most from your catalogue",
        chart="donut-chart",
        data={
            "segments": segments,
            "total": sum(item["value"] for item in usage),
            "totalLabel": "Selections this period",
            "format": FMT_COUNT,
        },
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


# --- Generic-department fallbacks ----------------------------------------
# A service unit created after this design shipped has no detail table, so every widget above that
# reads one is unavailable to it.


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
