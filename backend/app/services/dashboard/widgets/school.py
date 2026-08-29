"""Head of School — one profile, two shapes.

The schema does not distinguish schools: both are `unit` rows whose head holds
`head-of-school`. So the differentiation is by **portfolio profile**, computed
from each school's own trailing-term data by `school_signature()` rather than
hardcoded to a named pair. A third school added later gets a signature panel
deterministically, and a school whose behaviour changes gets the dashboard that
now fits it.

    service     Technical Service Dependency — where the school's cycle time goes
    commercial  Cost Recovery & External Engagement — where the school's money goes

Two panels are present in **both** shapes on purpose: the stage waterfall and
applicant activity. Two heads comparing notes should be comparing the same
thing.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from ....db import fetch_all, fetch_one
from ..metrics import demand, finance, people, quality, sla
from ..metrics.common import requirement_label
from ..scope import Scope, apply_bucket_floor, delta, fold_tail, num, ratio, status_for
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

# Restricts a proposal query to applicants holding an active assignment in the
# named unit. Composed from a module constant, never from a request parameter -
# the unit itself arrives bound as %(school)s (rule R2).
SCHOOL_FILTER = """
AND EXISTS (
    SELECT 1 FROM user_unit_roles uur
     WHERE uur.user_id = r.applicant_user_id
       AND uur.unit_code = %(school)s
       AND uur.is_active
)
"""

PEER_FILTER = """
AND EXISTS (
    SELECT 1 FROM user_unit_roles uur
     WHERE uur.user_id = r.applicant_user_id
       AND uur.unit_code = %(peer)s
       AND uur.is_active
)
"""


def _school(scope: Scope) -> str:
    if not scope.unit_code:
        raise ValueError("A school dashboard needs a unit")
    return scope.unit_code


def _peer_school(cur, scope: Scope) -> tuple[str | None, str | None]:
    """The one other school, for the benchmark series.

    With two schools an anonymised label identifies them anyway, so the peer is
    named. A comparison that pretends otherwise is worse than an honest one.
    """
    row = fetch_one(
        cur,
        """
        SELECT u.code, u.description
          FROM unit u
         WHERE u.code LIKE 'school%%' AND u.code <> %(school)s AND u.is_active
      ORDER BY u.code
         LIMIT 1
        """,
        {"school": _school(scope)},
    )
    return (row["code"], row["description"]) if row else (None, None)


def _extra(scope: Scope, cur=None) -> dict[str, Any]:
    return {"school": _school(scope)}


# --- Hero -----------------------------------------------------------------


@widget("hos_end_to_end")
def end_to_end(cur, scope: Scope) -> dict[str, Any]:
    """Median days from submission to `completed_approved`, for this school.

    The number the school's organisers actually experience and the one they
    complain about. Every other figure on the page exists to explain it. There
    is no `request.completed_at` (gap G5), so the completion time comes from the
    last workflow_history row.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS p50, count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM (done.at - r.submitted_at)) / 86400.0 AS days
              FROM request r
              JOIN LATERAL (
                    SELECT max(created_at) AS at FROM workflow_history h
                     WHERE h.request_id = r.request_id AND h.new_status = 'completed_approved'
              ) done ON TRUE
             WHERE r.submitted_at IS NOT NULL
               AND done.at IS NOT NULL
               AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
               {SCHOOL_FILTER}
          ) s
        """,
        scope.params(**_extra(scope)),
    )
    institutional = fetch_one(
        cur,
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS p50, count(*) AS n
          FROM (
            SELECT EXTRACT(epoch FROM (done.at - r.submitted_at)) / 86400.0 AS days
              FROM request r
              JOIN LATERAL (
                    SELECT max(created_at) AS at FROM workflow_history h
                     WHERE h.request_id = r.request_id AND h.new_status = 'completed_approved'
              ) done ON TRUE
             WHERE r.submitted_at IS NOT NULL AND done.at IS NOT NULL
               AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
          ) s
        """,
        scope.base_params,
    )
    value = num(row["p50"]) if row else None
    peer_value = num(institutional["p50"]) if institutional else None
    floor = scope.config.bucket_floor()
    # R8: an institutional median computed over fewer than k proposals is not a
    # benchmark, it is one school's number wearing a neutral label.
    if institutional and int(institutional["n"]) < floor:
        peer_value = None
        scope.note_suppressed()
    return hero(
        label="End-to-end approval time",
        value=value,
        fmt=FMT_DAYS,
        caption=(
            f"institutional median {peer_value:.1f} days — context, not a target"
            if peer_value is not None
            else f"{row['n'] if row else 0} approved proposals in period"
        ),
        target={"max": 10, "label": "target <= 10 days"},
        status=status_for(value, warn=10, critical=20),
        definition="submitted_at → the last workflow_history row reaching completed_approved (gap G5)",
        empty="No proposal from this school has completed approval in this period.",
        drill_to=drill("#panel-hos_stage_waterfall"),
    )


@widget("hos_end_to_end_kpi")
def end_to_end_kpi(cur, scope: Scope) -> dict[str, Any]:
    result = end_to_end(cur, scope)
    return kpi(
        label="End-to-end time",
        value=result["value"],
        fmt=FMT_DAYS,
        caption=result["caption"],
        target=result["target"],
        status=result["status"],
        definition=result["definition"],
        drill_to=result["drill"],
    )


@widget("hos_cost_per_pax")
def cost_per_pax(cur, scope: Scope) -> dict[str, Any]:
    """The only comparable efficiency figure the schema can produce, and the one
    a CFO will quote back. Always defined, unlike a recovery ratio on a term with
    no paid events."""
    result = finance.cost_per_pax(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    institutional = finance.cost_per_pax(cur, scope)
    median = institutional["value"]
    value = result["value"]
    status = "unknown"
    if value is not None and median:
        excess = value / median - 1
        status = "critical" if excess > 0.5 else ("warning" if excess > 0.25 else "good")
    return hero(
        label="Cost per pax",
        value=value,
        fmt=FMT_CURRENCY,
        caption=(
            f"institutional median RM {median:,.2f} · {result['proposals']} proposals, {result['pax']:,.0f} pax"
            if median
            else f"{result['proposals']} proposals, {result['pax']:,.0f} pax"
        ),
        target={"max": median, "label": "amber above +25%, critical above +50% of the institutional median"} if median else None,
        status=status,
        caveat=(
            f"Food component based on {result['coverage']:.0%} of items priced (gap G4)."
            if result["coverage"] is not None and result["coverage"] < 1
            else None
        ),
        definition="M55 — (committed food + funding) ÷ total pax, scoped to this school's applicants",
        empty="This school has submitted no proposals in this period.",
        drill_to=drill("#panel-hos_cost_by_category"),
    )


@widget("hos_cost_per_pax_kpi")
def cost_per_pax_kpi(cur, scope: Scope) -> dict[str, Any]:
    result = cost_per_pax(cur, scope)
    return kpi(
        label="Cost per pax",
        value=result["value"],
        fmt=FMT_CURRENCY,
        caption=result["caption"],
        status=result["status"],
        caveat=result["caveat"],
        definition=result["definition"],
        drill_to=result["drill"],
    )


# --- KPIs -----------------------------------------------------------------


@widget("hos_gate_latency")
def gate_latency(cur, scope: Scope) -> dict[str, Any]:
    """The one segment of the hero this head personally owns. Displayed as a
    share of the end-to-end total, so a 1.2-day gate inside an 11-day total
    reads honestly rather than looking like the problem."""
    dwell = sla.stage_dwell(cur, scope, status="hos_hod_review", request_filter=SCHOOL_FILTER, extra=_extra(scope))
    entry = dwell[0] if dwell else {}
    median = entry.get("median")
    waiting = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n FROM request r
         WHERE r.status = 'hos_hod_review' {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    return kpi(
        label="Gate latency",
        value=median,
        fmt=FMT_HOURS,
        secondary=f"p90 {entry['p90']:.0f}h" if entry.get("p90") is not None else None,
        caption=f"{int(waiting['n']) if waiting else 0} waiting at your gate now",
        target={"max": 48, "label": "target <= 48h"},
        status=status_for(median, warn=48, critical=96),
        definition="M14 for hos_hod_review, this school only",
        drill_to=drill("/app/inbox/proposals", stage="hos-hod-review"),
    )


@widget("hos_outcome_mix")
def outcome_mix(cur, scope: Scope) -> dict[str, Any]:
    """A gate that approves everything is not a gate; a gate that sends back half
    is a form problem upstream."""
    mix = quality.gate_outcome_mix(cur, scope, stage="hos_hod_review", request_filter=SCHOOL_FILTER, extra=_extra(scope))
    return kpi(
        label="Approval outcome mix",
        value=mix["approvedShare"],
        fmt=FMT_PERCENT,
        secondary=f"{mix['sentBack']} sent back · {mix['rejected']} rejected",
        caption=f"{mix['total']} decisions at your gate",
        target={"max": 0.20, "label": "send-back <= 20%"},
        status=status_for(mix["sentBackShare"], warn=0.20, critical=0.40),
        definition="M22 with M20 at hos_hod_review",
        drill_to=drill("/app/history/proposals", stage="hos-hod-review"),
    )


@widget("hos_service_footprint")
def service_footprint(cur, scope: Scope) -> dict[str, Any]:
    """The school's own driver of downstream latency, and the only one it
    controls directly."""
    mine = demand.mean_requirements_per_proposal(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    peer_code, peer_label = _peer_school(cur, scope)
    peer_value = None
    if peer_code:
        peer = demand.mean_requirements_per_proposal(cur, scope, request_filter=PEER_FILTER, extra={"peer": peer_code})
        if peer["sample"] >= scope.config.bucket_floor():
            peer_value = peer["mean"]
        else:
            scope.note_suppressed()
    return kpi(
        label="Service footprint",
        value=mine["mean"],
        fmt="number",
        secondary=(f"{peer_label}: {peer_value:.1f}" if peer_value is not None else None),
        caption=f"mean requirements per proposal · {mine['sample']} proposals",
        status="unknown",
        definition="M42 — a trend, not a limit",
        drill_to=drill("#panel-hos_requirement_mix"),
    )


@widget("hos_forward_pipeline")
def forward_pipeline(cur, scope: Scope) -> dict[str, Any]:
    """What the school has committed to deliver, distinct from what it has
    submitted."""
    row = fetch_one(
        cur,
        f"""
        SELECT count(DISTINCT r.request_id) AS n, sum(r.total_pax) AS pax
          FROM request r
          JOIN event_schedule es ON es.request_id = r.request_id
         WHERE r.status = 'completed_approved'
           AND es."date" >= %(today)s
           {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    return kpi(
        label="Forward pipeline",
        value=int(row["n"]) if row else 0,
        fmt=FMT_COUNT,
        secondary=f"{num(row['pax'], 0.0):,.0f} pax" if row else None,
        caption="approved events still to run",
        status="unknown",
        definition="Approved proposals with a future event date",
        drill_to=drill("/app/ongoing/proposals", horizon=60),
    )


@widget("hos_cost_recovery")
def cost_recovery(cur, scope: Scope) -> dict[str, Any]:
    """Paid events only. Renders "no paid events this period" rather than 0%
    when the denominator is empty — a zero here would be read as failure when it
    means absence."""
    revenue = finance.revenue_exposure(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    cost = finance.cost_per_pax(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    if not revenue["exposure"]:
        return kpi(
            label="Cost recovery",
            value=None,
            fmt=FMT_PERCENT,
            caption="no paid events in this period",
            status="unknown",
            definition="Registration revenue collected ÷ committed cost, paid events only",
            drill_to=drill("#panel-hos_recovery_funnel"),
        )
    value = ratio(revenue["collected"], cost["cost"])
    return kpi(
        label="Cost recovery",
        value=value,
        fmt=FMT_PERCENT,
        secondary=f"RM {revenue['collected']:,.0f} of RM {cost['cost']:,.0f}",
        caption="paid events only",
        target={"min": 0.60, "label": "target >= 60% on paid events"},
        status=status_for(value, minimum=0.60, critical=0.30, higher_is_better=True),
        definition="Collected registration revenue ÷ committed cost",
        drill_to=drill("#panel-hos_recovery_funnel"),
    )


@widget("hos_collection_rate")
def collection_rate(cur, scope: Scope) -> dict[str, Any]:
    """The gap between an event that sold and an event that was paid for. The
    count is the actionable half; the rate is the trend. Counts only — no
    registrant reaches this tile (R9)."""
    revenue = finance.revenue_exposure(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    unpaid = revenue["paymentRequired"] - revenue["approved"]
    return kpi(
        label="Collection rate",
        value=revenue["collectionRate"],
        fmt=FMT_PERCENT,
        secondary=f"{unpaid} unpaid" if revenue["paymentRequired"] else None,
        caption=(
            f"{revenue['approved']} of {revenue['paymentRequired']} registrations paid"
            if revenue["paymentRequired"]
            else "no registration requires payment in this period"
        ),
        target={"min": 0.90, "label": "target >= 90%"},
        status=status_for(revenue["collectionRate"], minimum=0.90, critical=0.60, higher_is_better=True),
        definition="M54",
        drill_to=drill("/app/history/proposals", payment="unpaid", school="mine"),
    )


@widget("hos_commercial_intensity")
def commercial_intensity(cur, scope: Scope) -> dict[str, Any]:
    """The input to the profile-score rule that selected this dashboard, shown
    openly so the head can see why their dashboard looks as it does."""
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE r.cost_amount > 0 OR fund.n > 0) AS commercial, count(*) AS total
          FROM request r
          LEFT JOIN LATERAL (
                SELECT count(*) AS n FROM request_funding_purchase p WHERE p.request_id = r.request_id
          ) fund ON TRUE
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    peer_code, peer_label = _peer_school(cur, scope)
    peer_value = None
    if peer_code:
        peer_row = fetch_one(
            cur,
            f"""
            SELECT count(*) FILTER (WHERE r.cost_amount > 0 OR fund.n > 0) AS commercial, count(*) AS total
              FROM request r
              LEFT JOIN LATERAL (
                    SELECT count(*) AS n FROM request_funding_purchase p WHERE p.request_id = r.request_id
              ) fund ON TRUE
             WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
               {PEER_FILTER}
            """,
            scope.params(peer=peer_code),
        )
        if peer_row and int(peer_row["total"]) >= scope.config.bucket_floor():
            peer_value = ratio(peer_row["commercial"], peer_row["total"])
        else:
            scope.note_suppressed()
    return kpi(
        label="Commercial intensity",
        value=ratio(row["commercial"], row["total"]) if row else None,
        fmt=FMT_PERCENT,
        secondary=f"{peer_label}: {peer_value:.0%}" if peer_value is not None else None,
        caption="proposals carrying a cost or a funding line",
        status="unknown",
        definition="The score that chose this dashboard shape",
        drill_to=drill("#panel-hos_cost_per_pax_trend"),
    )


@widget("hos_external_engagement")
def external_engagement(cur, scope: Scope) -> dict[str, Any]:
    """A school running internal-only events at a high cost per pax has a
    different case to make than one bringing two hundred industry guests onto
    campus."""
    row = fetch_one(
        cur,
        f"""
        SELECT
            sum(g."count") FILTER (
                WHERE g.guest_type IN ('External Guests', 'Industry Partners', 'Alumni')) AS external_pax,
            sum(g."count") AS total_pax
          FROM request r
          JOIN general_guest g ON g.request_id = r.request_id
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    # important_people is a separate one-to-many; counting it in the query above
    # would multiply the guest sums by the number of notable guests.
    notable = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n
          FROM important_people ip
          JOIN request r ON r.request_id = ip.request_id
         WHERE ip.type IN ('Partner', 'Speaker')
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    return kpi(
        label="External engagement",
        value=ratio(row["external_pax"], row["total_pax"]) if row else None,
        fmt=FMT_PERCENT,
        secondary=f"{int(notable['n']) if notable else 0} partners and speakers",
        caption="expected attendance from external guests, industry partners and alumni",
        status="unknown",
        definition="general_guest bands, counts only — no attendee identity",
        drill_to=drill("#panel-hos_guest_mix"),
    )


# --- Signature panels -----------------------------------------------------


@widget("hos_dependency_map")
def dependency_map(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel (service shape) — turn "our events are slow" into "we
    select A/V on 62% of proposals and A/V contributes 4.1 of our 11 days".

    That sentence is the whole point of this dashboard. Under R7 the panel
    crosses a boundary — it reports department task timings for proposals the
    school owns — which is legitimate: the rows are the school's own proposals
    and the aggregate carries no department-internal identifier. The k>=5 floor
    still applies per requirement.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT er.requirement_name AS requirement,
               count(DISTINCT t.request_task_id) AS n,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM coalesce(t.resolved_at, now()) - t.created_at) / 86400.0
               ) AS median_days,
               percentile_cont(0.9) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM coalesce(t.resolved_at, now()) - t.created_at) / 86400.0
               ) AS p90_days,
               count(DISTINCT r.request_id) AS proposals
          FROM request_task t
          JOIN request r ON r.request_id = t.request_id
          JOIN event_requirements er ON er.requirement_id = t.requirement_id
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {SCHOOL_FILTER}
      GROUP BY 1
      ORDER BY 3 DESC NULLS LAST
        """,
        scope.params(**_extra(scope)),
    )
    total = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n FROM request r
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    denominator = int(total["n"]) if total else 0
    mapped = [
        {
            "requirement": r["requirement"],
            "label": requirement_label(r["requirement"]),
            "n": int(r["n"]),
            "medianDays": num(r["median_days"]),
            "p90Days": num(r["p90_days"]),
            "share": ratio(r["proposals"], denominator),
        }
        for r in rows
    ]
    floored = apply_bucket_floor(scope, mapped, count_key="n", value_keys=("medianDays", "p90Days"))
    selected = {r["requirement"] for r in mapped}
    never = [
        {"requirement": name, "label": requirement_label(name), "medianDays": None, "n": 0, "share": 0.0}
        for name in ("logistics", "transportation", "photoVideo", "soundLight", "campusTour", "fmb", "waterNormal", "fundingPurchase")
        if name not in selected
    ]
    return panel(
        title="Service dependency map",
        subtitle="Median days each requirement contributes to this school's proposals",
        chart="bar-chart",
        series_list=[
            series(
                "dwell",
                "Median days",
                1,
                [
                    {
                        "x": r["medianDays"],
                        "label": r["label"],
                        "requirement": r["requirement"],
                        "annotation": f"selected on {r['share']:.0%}" if r["share"] is not None else None,
                        "suppressed": r.get("suppressed", False),
                    }
                    for r in floored
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Days", "format": FMT_DAYS}},
        data={"neverSelected": never},
        table_view=table(
            [
                {"key": "label", "label": "Requirement", "format": "text"},
                {"key": "share", "label": "Selection share", "format": FMT_PERCENT},
                {"key": "medianDays", "label": "Median (d)", "format": FMT_DAYS},
                {"key": "p90Days", "label": "p90 (d)", "format": FMT_DAYS},
                {"key": "n", "label": "Tasks", "format": FMT_COUNT},
            ],
            floored,
        ),
        caption="Requirements this school never selects are listed beneath, greyed rather than hidden.",
        empty="This school has submitted no proposals carrying a service requirement in this period.",
        drill_to=drill("/app/history/proposals", school="mine"),
        suppressed=sum(1 for row in floored if row.get("suppressed")),
        signature=True,
        mobile="ranked-list",
    )


@widget("hos_recovery_funnel")
def recovery_funnel(cur, scope: Scope) -> dict[str, Any]:
    """Signature panel (commercial shape) — the whole commercial path in one
    object, and where it leaks.

    A school losing money at "payment approved" has a collections problem; one
    losing it at "registered" has a pricing or marketing problem. The stage names
    the fix. A funnel and not a waterfall: the reader's question is conversion
    between stages, not additive contributions to a total.
    """
    revenue = finance.revenue_exposure(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    cost = finance.cost_per_pax(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    capacity_row = fetch_one(
        cur,
        f"""
        SELECT sum(r.max_pax) AS capacity FROM request r
         WHERE r.cost_amount > 0
           AND r.status NOT IN ('cancelled', 'completed_rejected', 'draft')
           AND coalesce(r.submitted_at, r.created_at) >= %(from)s
           AND coalesce(r.submitted_at, r.created_at) < %(to)s
           {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    stages = [
        {"stage": "Committed cost", "value": cost["cost"], "format": FMT_CURRENCY},
        {"stage": "Capacity", "value": num(capacity_row["capacity"], 0.0) if capacity_row else 0.0, "format": FMT_COUNT},
        {"stage": "Registered", "value": revenue["registered"], "format": FMT_COUNT},
        {"stage": "Payment required", "value": revenue["paymentRequired"], "format": FMT_COUNT},
        {"stage": "Payment approved", "value": revenue["approved"], "format": FMT_COUNT},
    ]
    for index, stage in enumerate(stages):
        previous = stages[index - 1]["value"] if index else None
        stage["share"] = ratio(stage["value"], previous) if index and index > 1 else None
    net = revenue["collected"] - cost["cost"]
    return panel(
        title="Cost recovery funnel",
        subtitle="Committed cost through to money collected, paid events only",
        chart="funnel",
        data={
            "stages": stages,
            "net": net,
            "netDirection": "positive" if net > 0 else ("negative" if net < 0 else "neutral"),
        },
        table_view=table(
            [
                {"key": "stage", "label": "Stage", "format": "text"},
                {"key": "value", "label": "Value", "format": "number"},
                {"key": "share", "label": "Conversion", "format": FMT_PERCENT},
            ],
            stages,
        ),
        caption=f"Net position RM {net:,.2f} — the one figure on this page with a sign, so it uses the diverging pair.",
        caveat=(
            f"Food component based on {cost['coverage']:.0%} of items priced (gap G4)."
            if cost["coverage"] is not None and cost["coverage"] < 1
            else None
        ),
        empty="This school has run no paid events in this period.",
        drill_to=drill("/app/history/proposals", school="mine"),
        signature=True,
        mobile="stacked-bars",
    )


# --- Shared panels --------------------------------------------------------


@widget("hos_stage_waterfall")
def stage_waterfall(cur, scope: Scope) -> dict[str, Any]:
    """Present on both school dashboards deliberately — it is the one panel that
    should be identical, so two heads comparing notes are comparing the same
    thing."""
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('month', h.created_at)::date AS bucket,
               h.previous_status AS stage,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM gap) / 86400.0) AS days
          FROM (
            SELECT h.request_id, h.previous_status, h.created_at,
                   h.created_at - lag(h.created_at) OVER (PARTITION BY h.request_id ORDER BY h.created_at) AS gap
              FROM workflow_history h
              JOIN request r ON r.request_id = h.request_id
             WHERE h.created_at >= %(from)s AND h.created_at < %(to)s
               {SCHOOL_FILTER}
          ) h
         WHERE gap IS NOT NULL AND previous_status IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1
        """,
        scope.params(**_extra(scope)),
    )
    stages = ("hos_hod_review", "fmb_review", "cfo_review", "department_review", "resubmission_required")
    labels = {
        "hos_hod_review": "Your gate",
        "fmb_review": "F&B",
        "cfo_review": "CFO",
        "department_review": "Departments",
        "resubmission_required": "Waiting on the applicant",
    }
    months = sorted({r["bucket"].isoformat() for r in rows})
    lookup = {(r["bucket"].isoformat(), r["stage"]): num(r["days"]) or 0.0 for r in rows}
    return panel(
        title="Stage waterfall",
        subtitle="Median days spent at each stage, per month",
        chart="stacked-bar",
        series_list=[
            series(
                stage,
                labels[stage],
                index,
                [{"x": month, "y": lookup.get((month, stage), 0.0)} for month in months],
            )
            for index, stage in enumerate(stages, start=1)
        ],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "Days", "format": FMT_DAYS}},
        table_view=table(
            [
                {"key": "month", "label": "Month", "format": "date"},
                *[{"key": stage, "label": labels[stage], "format": FMT_DAYS} for stage in stages],
            ],
            [{"month": month, **{stage: lookup.get((month, stage), 0.0) for stage in stages}} for month in months],
        ),
        caption="A worsening total can be attributed to a stage rather than argued about.",
        empty="No proposal from this school has moved between stages in this period.",
        drill_to=drill("/app/history/proposals", school="mine"),
        mobile="scroll",
    )


@widget("hos_applicant_activity")
def applicant_activity(cur, scope: Scope) -> dict[str, Any]:
    """Names shown — own school (R10). Identifies both the organisers carrying
    the school and the ones who need help with the form."""
    rows = people.applicant_activity(cur, scope, unit_code=_school(scope))
    return panel(
        title="Applicant activity",
        subtitle="Proposals submitted per organiser this period",
        chart="dot-plot",
        series_list=[
            series(
                "applicants",
                "Organisers",
                1,
                [
                    {
                        "x": r["value"],
                        "label": r["name"],
                        "userId": r["userId"],
                        "sendBackRate": r["sendBackRate"],
                        "meanCost": r["meanCost"],
                    }
                    for r in rows
                ],
            )
        ],
        axes={"x": {"type": "linear", "label": "Proposals", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "name", "label": "Organiser", "format": "text"},
                {"key": "value", "label": "Submitted", "format": FMT_COUNT},
                {"key": "approved", "label": "Approved", "format": FMT_COUNT},
                {"key": "sendBackRate", "label": "Send-back rate", "format": FMT_PERCENT},
                {"key": "meanCost", "label": "Mean committed cost", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        empty="Nobody in this school has submitted a proposal in this period.",
        mobile="ranked-list",
    )


@widget("hos_requirement_mix")
def requirement_mix(cur, scope: Scope) -> dict[str, Any]:
    mine = demand.requirement_mix(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    peer_code, peer_label = _peer_school(cur, scope)
    peer = (
        demand.requirement_mix(cur, scope, request_filter=PEER_FILTER, extra={"peer": peer_code})
        if peer_code
        else []
    )
    peer_floored = apply_bucket_floor(scope, [{**p, "n": p["value"]} for p in peer], count_key="n", value_keys=("share",))
    peer_lookup = {p["requirement"]: p for p in peer_floored}
    return panel(
        title="Requirement mix against the peer school",
        subtitle="Share of proposals selecting each requirement",
        chart="bar-chart",
        series_list=[
            series("mine", scope.unit_label or "This school", 1, [{"x": r["share"], "label": r["label"]} for r in mine]),
            series(
                "peer",
                peer_label or "Peer school",
                2,
                [
                    {"x": peer_lookup.get(r["requirement"], {}).get("share"), "label": r["label"]}
                    for r in mine
                ],
            ),
        ],
        axes={"x": {"type": "linear", "label": "Share of proposals", "format": FMT_PERCENT}},
        table_view=table(
            [
                {"key": "label", "label": "Requirement", "format": "text"},
                {"key": "share", "label": "This school", "format": FMT_PERCENT},
                {"key": "value", "label": "Proposals", "format": FMT_COUNT},
            ],
            mine,
        ),
        caption=f"Buckets under {scope.config.bucket_floor()} proposals are suppressed on the peer series.",
        suppressed=sum(1 for row in peer_floored if row.get("suppressed")),
        empty="This school has submitted no proposals in this period.",
        drill_to=drill("/app/history/proposals", school="mine"),
        mobile="ranked-list",
    )


@widget("hos_event_outcome")
def event_outcome(cur, scope: Scope) -> dict[str, Any]:
    """Registrations against capacity, both counts on one axis. Divergence is
    the school's real demand signal: events filling to capacity argue for more
    or larger events; events at 20% fill argue for fewer."""
    rows = demand.registration_conversion(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    return panel(
        title="Event outcome",
        subtitle="Registrations against advertised capacity",
        chart="line-chart",
        series_list=[
            series("registered", "Registered", 1, [{"x": r["x"], "y": r["registered"]} for r in rows]),
            series("capacity", "Capacity", 2, [{"x": r["x"], "y": r["capacity"]} for r in rows]),
        ],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "People", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "x", "label": "Month", "format": "date"},
                {"key": "registered", "label": "Registered", "format": FMT_COUNT},
                {"key": "capacity", "label": "Capacity", "format": FMT_COUNT},
                {"key": "fill", "label": "Fill", "format": FMT_PERCENT},
            ],
            rows,
        ),
        caption="Counts only — no attendee identity reaches any dashboard.",
        empty="This school has run no approved events in this period.",
    )


@widget("hos_rework_profile")
def rework_profile(cur, scope: Scope) -> dict[str, Any]:
    """Send-back comments appear in the hover, truncated — they are the actual
    coaching material and the only place the school learns what it keeps getting
    wrong."""
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('month', h.created_at)::date AS bucket,
               count(*) AS n,
               left(string_agg(coalesce(h.comment, ''), ' · ' ORDER BY h.created_at DESC), 400) AS comments
          FROM workflow_history h
          JOIN request r ON r.request_id = h.request_id
         WHERE h.action = 'resubmit'
           AND h.created_at >= %(from)s AND h.created_at < %(to)s
           {SCHOOL_FILTER}
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(**_extra(scope)),
    )
    data = [
        {"x": r["bucket"].isoformat(), "y": int(r["n"]), "comments": r["comments"]}
        for r in rows
    ]
    return panel(
        title="Rework profile",
        subtitle="Send-backs received per month",
        chart="column-chart",
        series_list=[series("sendBacks", "Send-backs", 2, data)],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "Send-backs", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "x", "label": "Month", "format": "date"},
                {"key": "y", "label": "Send-backs", "format": FMT_COUNT},
                {"key": "comments", "label": "Reviewer comments", "format": "text"},
            ],
            data,
        ),
        empty="No proposal from this school has been sent back in this period.",
        drill_to=drill("/app/history/proposals", outcome="resubmitted", school="mine"),
        mobile="scroll",
    )


@widget("hos_forward_commitment")
def forward_commitment(cur, scope: Scope) -> dict[str, Any]:
    rows = demand.event_calendar_density(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    return panel(
        title="Forward commitment",
        subtitle="Approved events still to run",
        chart="area-chart",
        series_list=[series("events", "Events", 1, rows)],
        axes={"x": {"type": "date", "label": "Date"}, "y": {"type": "linear", "label": "Events", "format": FMT_COUNT}},
        table_view=table(
            [
                {"key": "x", "label": "Date", "format": "date"},
                {"key": "y", "label": "Events", "format": FMT_COUNT},
                {"key": "pax", "label": "Pax", "format": FMT_COUNT},
            ],
            rows,
        ),
        empty="This school has no approved events still to run.",
        drill_to=drill("/app/ongoing/proposals", school="mine"),
    )


@widget("hos_cost_by_category")
def cost_by_category(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.budget_category_split(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    food = finance.committed_food_cost(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
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
            [{"x": month, "y": sum(r["value"] for r in rows if r["bucket"] == month and r["category"] == label)} for month in months],
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
    # Food is a distinct final segment: it comes from a different table and a
    # different price source, so folding it into a funding category would make
    # the coverage caveat unattributable.
    series_list.append(
        series("food", "Food", 5, [{"x": month, "y": food["total"] / max(1, len(months))} for month in months])
    )
    return panel(
        title="Committed cost by finance category",
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
        caveat=(
            f"Food component based on {food['coverage']:.0%} of items priced (gap G4)."
            if food["coverage"] is not None and food["coverage"] < 1
            else None
        ),
        caption="The second level by procurement code is in the table view, where a table does what a fourth hue cannot.",
        empty="This school has recorded no committed cost in this period.",
        mobile="scroll",
    )


@widget("hos_guest_mix")
def guest_mix(cur, scope: Scope) -> dict[str, Any]:
    """Four collapsed bands, not the raw seven `general_guest.guest_type` values.

    Seven classes carrying meaning is past the point where adjacent bands blur.
    The full seven-way split is in the table view, where a table does the job
    colour cannot.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('month', coalesce(r.submitted_at, r.created_at))::date AS bucket,
               g.guest_type AS guest_type,
               sum(g."count") AS pax
          FROM general_guest g
          JOIN request r ON r.request_id = g.request_id
         WHERE coalesce(r.submitted_at, r.created_at) >= %(from)s
           AND coalesce(r.submitted_at, r.created_at) < %(to)s
           {SCHOOL_FILTER}
      GROUP BY 1, 2
      ORDER BY 1
        """,
        scope.params(**_extra(scope)),
    )
    bands = {
        "Students": "Internal",
        "APU Staff": "Internal",
        "External Guests": "External",
        "Industry Partners": "External",
        "Alumni": "External",
        "Parents-Guardians": "Family",
        "Others": "Other",
    }
    months = sorted({r["bucket"].isoformat() for r in rows})
    banded: dict[tuple[str, str], float] = defaultdict(float)
    detail = []
    for row in rows:
        month = row["bucket"].isoformat()
        band = bands.get(row["guest_type"], "Other")
        banded[(month, band)] += float(row["pax"] or 0)
        detail.append({"month": month, "guestType": row["guest_type"], "pax": float(row["pax"] or 0)})
    order = ["Internal", "External", "Family", "Other"]
    notable = fetch_all(
        cur,
        f"""
        SELECT ip.type AS type, count(*) AS n
          FROM important_people ip
          JOIN request r ON r.request_id = ip.request_id
         WHERE coalesce(r.submitted_at, r.created_at) >= %(from)s
           AND coalesce(r.submitted_at, r.created_at) < %(to)s
           {SCHOOL_FILTER}
      GROUP BY 1
      ORDER BY 2 DESC
        """,
        scope.params(**_extra(scope)),
    )
    return panel(
        title="External engagement mix",
        subtitle="Expected attendance by guest band, per month",
        chart="stacked-bar",
        series_list=[
            series(band, band, index, [{"x": month, "y": banded.get((month, band), 0.0)} for month in months])
            for index, band in enumerate(order, start=1)
        ],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "Expected pax", "format": FMT_COUNT}},
        data={"notable": [{"type": r["type"], "value": int(r["n"])} for r in notable]},
        table_view=table(
            [
                {"key": "month", "label": "Month", "format": "date"},
                {"key": "guestType", "label": "Guest type", "format": "text"},
                {"key": "pax", "label": "Expected pax", "format": FMT_COUNT},
            ],
            detail,
        ),
        caption="Seven guest types collapse to four bands on the chart; the full split is in the table.",
        empty="This school has recorded no expected guests in this period.",
        mobile="scroll",
    )


@widget("hos_cost_per_pax_trend")
def cost_per_pax_trend(cur, scope: Scope) -> dict[str, Any]:
    """Three series on one axis — all three are ringgit per head, so one axis is
    correct. The peer and institutional series carry no drill: they are R7
    aggregates over rows this head cannot open."""
    peer_code, peer_label = _peer_school(cur, scope)
    mine = finance.cost_per_pax(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    institutional = finance.cost_per_pax(cur, scope)
    peer = (
        finance.cost_per_pax(cur, scope, request_filter=PEER_FILTER, extra={"peer": peer_code})
        if peer_code
        else {"value": None, "proposals": 0}
    )
    floor = scope.config.bucket_floor()
    peer_value = peer["value"] if peer["proposals"] >= floor else None
    if peer["proposals"] and peer["proposals"] < floor:
        scope.note_suppressed()
    label = scope.period.label
    rows = [
        {"series": scope.unit_label or "This school", "value": mine["value"]},
        {"series": peer_label or "Peer school", "value": peer_value},
        {"series": "Institutional", "value": institutional["value"]},
    ]
    return panel(
        title="Cost per pax against the peer school",
        subtitle=f"{label} · ringgit per head",
        chart="bar-chart",
        series_list=[
            series(
                "costPerPax",
                "Cost per pax",
                1,
                [{"x": r["value"], "label": r["series"], "drillable": index == 0} for index, r in enumerate(rows)],
            )
        ],
        axes={"x": {"type": "linear", "label": "RM per head", "format": FMT_CURRENCY}},
        table_view=table(
            [
                {"key": "series", "label": "Scope", "format": "text"},
                {"key": "value", "label": "Cost per pax", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption="The peer and institutional bars are aggregates over proposals you cannot open, so they carry no drill-through.",
        empty="No proposal in this period carries a committed cost.",
        mobile="ranked-list",
    )


@widget("hos_forward_financial")
def forward_financial(cur, scope: Scope) -> dict[str, Any]:
    rows = finance.forward_commitment(cur, scope, request_filter=SCHOOL_FILTER, extra=_extra(scope))
    return panel(
        title="Forward financial commitment",
        subtitle="Committed cost by month for approved events not yet run",
        chart="area-chart",
        series_list=[series("committed", "Committed", 1, [{"x": r["x"], "y": r["value"]} for r in rows])],
        axes={"x": {"type": "date", "label": "Month"}, "y": {"type": "linear", "label": "RM", "format": FMT_CURRENCY}},
        table_view=table(
            [
                {"key": "x", "label": "Month", "format": "date"},
                {"key": "food", "label": "Food", "format": FMT_CURRENCY},
                {"key": "funding", "label": "Funding", "format": FMT_CURRENCY},
                {"key": "value", "label": "Total", "format": FMT_CURRENCY},
            ],
            rows,
        ),
        caption="What the school has already spent on paper.",
        empty="This school has no approved events still to run.",
        drill_to=drill("/app/ongoing/proposals", school="mine"),
    )


@widget("hos_at_risk")
def at_risk(cur, scope: Scope) -> dict[str, Any]:
    from ..metrics import risk

    stranded = risk.stranded_at_gate(cur, scope)
    waiting = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n, min(r.submitted_at) AS oldest FROM request r
         WHERE r.status = 'hos_hod_review' {SCHOOL_FILTER}
        """,
        scope.params(**_extra(scope)),
    )
    return panel(
        title="Needs your attention",
        subtitle="At your gate and downstream",
        chart="alert-list",
        data={
            "gateQueue": {
                "count": int(waiting["n"]) if waiting else 0,
                "oldest": waiting["oldest"].isoformat() if waiting and waiting["oldest"] else None,
            },
            "stranded": stranded,
        },
        table_view=table(
            [
                {"key": "unitLabel", "label": "Applicant unit", "format": "text"},
                {"key": "count", "label": "Stranded proposals", "format": FMT_COUNT},
            ],
            stranded,
        ),
        caption=(
            "Stranded proposals sit at hos_hod_review with no qualifying reviewer — a detector for a known routing "
            "defect, not a fix."
            if stranded
            else None
        ),
        empty="Nothing is waiting at your gate.",
        drill_to=drill("/app/inbox/proposals", stage="hos-hod-review"),
    )
