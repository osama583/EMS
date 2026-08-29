"""Family F - cost and finance (M50-M58).

Rule R9 governs this whole family: money reaches a Head of School only as
school-level sums and per-pax ratios, and `bank_account_name` /
`bank_account_number` reach nobody. No query in this module selects either
column; they are a payout destination, not an analytic.

Every currency figure here is paired with its price coverage (M58). A total
without the coverage beside it is a total that quietly understates, because
`fmb_options.unit_price_rm` is nullable (gap G4) and an unpriced item
contributes zero to a sum while contributing a real cost in the world.
"""
from __future__ import annotations

from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio

# Proposals whose money is not a commitment.
_DEAD = "('cancelled', 'completed_rejected', 'draft')"


def committed_food_cost(cur, scope: Scope, *, request_filter: str = "", previous: bool = False, extra: dict | None = None) -> dict[str, Any]:
    """M50 - ordered quantity times menu price, over live proposals.

    Returned with `pricedItems` / `totalItems` so the caller can render the
    coverage caveat beside the figure rather than under it.
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT sum(s.quantity * o.unit_price_rm) AS total,
               count(*) FILTER (WHERE o.unit_price_rm IS NOT NULL) AS priced,
               count(*) AS items
          FROM request_fmb_selection s
          JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
          JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
         WHERE s.status <> 'cancelled'
           AND r.status NOT IN {_DEAD}
           AND coalesce(s.created_at, r.submitted_at) >= %({lo})s
           AND coalesce(s.created_at, r.submitted_at) < %({hi})s
           {request_filter}
        """,
        scope.params(**(extra or {})),
    )
    return {
        "total": num(row["total"], 0.0) if row else 0.0,
        "pricedItems": int(row["priced"]) if row else 0,
        "totalItems": int(row["items"]) if row else 0,
        "coverage": ratio(row["priced"], row["items"]) if row else None,
    }


def total_cost_split(cur, scope: Scope, *, previous: bool = False) -> dict[str, Any]:
    """THE cost definition, shared by the F&B and CFO dashboards.

        total     = budget + cafeteria
        budget    = request_funding_purchase - quantity x unit price, every
                    budget category. This is the money the applicant planned for
                    on the proposal's funding/purchase table.
        cafeteria = request_fmb_selection x fmb_options.unit_price_rm - food the
                    cafeterias were actually asked to make.

    The two are disjoint by construction: they come from different tables filled
    in by different people at different points, so adding them double-counts
    nothing. Food bought through a caterer is a budget line and never becomes a
    cafeteria order; a cafeteria order is never re-entered as a budget line.

    Both dashboards call THIS, rather than each computing a total from the same
    two halves. F&B previously counted only the Food & Beverage budget category
    against its total, which made its "total cost" a different quantity from the
    CFO's "total spend" while both were labelled a total - the mismatch this
    function exists to prevent.
    """
    cafeteria = committed_food_cost(cur, scope, previous=previous)
    budget = funding_commitment(cur, scope, previous=previous)
    return {
        "budget": round(budget, 2),
        "cafeteria": round(cafeteria["total"], 2),
        "total": round(budget + cafeteria["total"], 2),
        "pricedItems": cafeteria["pricedItems"],
        "totalItems": cafeteria["totalItems"],
        "coverage": cafeteria["coverage"],
    }


def fnb_cost_per_pax(cur, scope: Scope) -> dict[str, Any]:
    """F&B spend over the attendance behind it.

    Same numerator and denominator as the CFO's cost-per-pax tile, because both
    now read total_cost_split. The two pages therefore show the SAME number, not
    two figures that differ by which slice of spend each happened to count.
    """
    spend = total_cost_split(cur, scope)
    row = fetch_one(
        cur,
        f"""
        SELECT sum(r.total_pax) AS pax, count(*) AS n
          FROM request r
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
        """,
        scope.params(),
    )
    pax = num(row["pax"], 0.0) if row else 0.0
    return {
        "value": ratio(spend["total"], pax),
        "cost": spend["total"],
        "pax": pax,
        "proposals": int(row["n"]) if row else 0,
        "coverage": spend["coverage"],
    }


def cafeteria_order_distribution(cur, scope: Scope) -> list[dict[str, Any]]:
    """Orders per outlet - the fan-out F&B decided, counted.

    Orders rather than portions or money: the question this answers is "who is
    F&B leaning on", and one 200-portion order is one decision to send work
    somewhere, the same as one 5-portion order.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT sel.unit_code AS code,
               u.description AS label,
               count(*) AS orders,
               coalesce(sum(sel.quantity), 0) AS portions,
               sum(sel.quantity * o.unit_price_rm) AS cost
          FROM request_fmb_selection sel
          JOIN fmb_options o ON o.fmb_option_id = sel.fmb_option_id
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
          LEFT JOIN unit u ON u.code = sel.unit_code
         WHERE sel.status <> 'cancelled'
           AND r.status NOT IN {_DEAD}
           AND coalesce(sel.created_at, r.submitted_at) >= %(from)s
           AND coalesce(sel.created_at, r.submitted_at) < %(to)s
      GROUP BY 1, 2
      ORDER BY 3 DESC
        """,
        scope.params(),
    )
    return [
        {
            "code": r["code"],
            "label": r["label"] or r["code"],
            "orders": int(r["orders"]),
            "portions": int(r["portions"]),
            "cost": num(r["cost"], 0.0),
        }
        for r in rows
    ]


def water_requested(cur, scope: Scope) -> dict[str, Any]:
    """Mineral water actually asked for, split by logo and by whether the ask
    survived.

    Bottles, not requests: two rows of 12 and one of 200 are not "three".

    `cancelled` is the requested volume on proposals that died (cancelled or
    rejected). It is the nearest thing the schema holds to water that was
    ordered and then not used - nobody records spillage - and it is reported
    under its own honest name rather than as a wastage figure the data cannot
    support.
    """
    row = fetch_one(
        cur,
        f"""
        SELECT coalesce(sum(w.quantity) FILTER (
                   WHERE w.with_logo AND r.status NOT IN {_DEAD}), 0) AS with_logo,
               coalesce(sum(w.quantity) FILTER (
                   WHERE NOT w.with_logo AND r.status NOT IN {_DEAD}), 0) AS without_logo,
               coalesce(sum(w.quantity) FILTER (
                   WHERE r.status IN ('cancelled', 'completed_rejected')), 0) AS cancelled,
               count(*) FILTER (WHERE r.status NOT IN {_DEAD}) AS requests
          FROM request_mineral_water w
          JOIN request r ON r.request_id = w.request_id
         WHERE w."date" >= %(from)s AND w."date" < %(to)s
        """,
        scope.params(),
    )
    if row is None:
        return {"withLogo": 0, "withoutLogo": 0, "cancelled": 0, "requests": 0, "total": 0}
    with_logo, without_logo = int(row["with_logo"]), int(row["without_logo"])
    return {
        "withLogo": with_logo,
        "withoutLogo": without_logo,
        "cancelled": int(row["cancelled"]),
        "requests": int(row["requests"]),
        "total": with_logo + without_logo,
    }


def funding_commitment(cur, scope: Scope, *, request_filter: str = "", previous: bool = False, extra: dict | None = None) -> float:
    """M51 - funding and purchase lines, over live proposals.

    Recorded on every proposal, routed on none - `fundingPurchase` is in
    NON_WORKFLOW_REQUIREMENTS and never becomes a task. That is the CFO's
    largest blind spot today and the reason rule R7 exists at all.
    """
    lo, hi = ("prev_from", "prev_to") if previous else ("from", "to")
    row = fetch_one(
        cur,
        f"""
        SELECT sum(p.quantity * p.unit_price_rm) AS total
          FROM request_funding_purchase p
          JOIN request r ON r.request_id = p.request_id
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %({lo})s AND r.submitted_at < %({hi})s
           {request_filter}
        """,
        scope.params(**(extra or {})),
    )
    return num(row["total"], 0.0) if row else 0.0


def budget_category_split(cur, scope: Scope, *, request_filter: str = "", grain: str = "month", extra: dict | None = None) -> list[dict[str, Any]]:
    """M52 - funding commitment grouped by finance code, by month.

    A second level by `finance_procurement_code` is carried in the panel's table
    view rather than as more colour: past three categories the all-pairs floor
    fails, and a table does what a fourth hue cannot.
    """
    bucket = "month" if grain == "month" else "week"
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('{bucket}', r.submitted_at)::date AS bucket,
               coalesce(m.budget_category_finance_code, 'Uncoded') AS category,
               coalesce(sub.finance_procurement_code, 'Uncoded') AS subcategory,
               sum(p.quantity * p.unit_price_rm) AS total
          FROM request_funding_purchase p
          JOIN request r ON r.request_id = p.request_id
          LEFT JOIN funding_main_options m ON m.funding_main_option_id = p.main_option_id
          LEFT JOIN funding_sub_options sub ON sub.funding_sub_option_id = p.sub_option_id
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {request_filter}
      GROUP BY 1, 2, 3
      ORDER BY 1, 4 DESC
        """,
        scope.params(**(extra or {})),
    )
    return [
        {
            "bucket": r["bucket"].isoformat(),
            "category": r["category"],
            "subcategory": r["subcategory"],
            "value": num(r["total"], 0.0),
        }
        for r in rows
    ]


def revenue_exposure(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> dict[str, Any]:
    """M53 + M54 - what paid events could collect, and what they did.

    Exposure, not revenue: `cost_amount x active registrations` is what is owed,
    and the gap to the approved share is what is outstanding. Counts and sums
    only - no registrant reaches this response (R9, and
    attendee identity is organiser-only).
    """
    row = fetch_one(
        cur,
        f"""
        SELECT sum(r.cost_amount) FILTER (WHERE reg.status <> 'cancelled') AS exposure,
               count(reg.event_registration_id) FILTER (WHERE reg.status <> 'cancelled') AS registered,
               count(reg.event_registration_id) FILTER (
                   WHERE reg.payment_status <> 'not_required' AND reg.status <> 'cancelled'
               ) AS payment_required,
               count(reg.event_registration_id) FILTER (WHERE reg.payment_status = 'pending_review') AS submitted,
               count(reg.event_registration_id) FILTER (WHERE reg.payment_status = 'approved') AS approved,
               sum(r.cost_amount) FILTER (WHERE reg.payment_status = 'approved') AS collected
          FROM request r
          LEFT JOIN event_registration reg ON reg.request_id = r.request_id
         WHERE r.cost_amount > 0
           AND r.status NOT IN {_DEAD}
           AND coalesce(r.submitted_at, r.created_at) >= %(from)s
           AND coalesce(r.submitted_at, r.created_at) < %(to)s
           {request_filter}
        """,
        scope.params(**(extra or {})),
    )
    exposure = num(row["exposure"], 0.0) if row else 0.0
    collected = num(row["collected"], 0.0) if row else 0.0
    return {
        "exposure": exposure,
        "collected": collected,
        "uncollected": round(exposure - collected, 2),
        "registered": int(row["registered"]) if row else 0,
        "paymentRequired": int(row["payment_required"]) if row else 0,
        "submitted": int(row["submitted"]) if row else 0,
        "approved": int(row["approved"]) if row else 0,
        "collectionRate": ratio(row["approved"], row["payment_required"]) if row else None,
    }


def cost_per_pax(cur, scope: Scope, *, request_filter: str = "", extra: dict | None = None) -> dict[str, Any]:
    """M55 - committed food plus funding, over total attendance.

    The single most comparable efficiency figure the schema can produce, and the
    one a CFO can put in front of a school head. Always defined, unlike a
    recovery ratio on a term with no paid events.
    """
    # Same two halves as total_cost_split, kept here in the filtered form the
    # school/department slices need (total_cost_split takes no request_filter).
    food = committed_food_cost(cur, scope, request_filter=request_filter, extra=extra)
    funding = funding_commitment(cur, scope, request_filter=request_filter, extra=extra)
    row = fetch_one(
        cur,
        f"""
        SELECT sum(r.total_pax) AS pax, count(*) AS n
          FROM request r
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           {request_filter}
        """,
        scope.params(**(extra or {})),
    )
    pax = num(row["pax"], 0.0) if row else 0.0
    return {
        "value": ratio(food["total"] + funding, pax),
        "cost": round(food["total"] + funding, 2),
        "pax": pax,
        "proposals": int(row["n"]) if row else 0,
        "coverage": food["coverage"],
    }


def cost_per_pax_by_school(cur, scope: Scope) -> list[dict[str, Any]]:
    """M55 sliced by the applicant's school.

    An R7 aggregate: the CFO computes over proposals they cannot open. Carries
    the row count so the caller can apply the k>=5 bucket floor, and no row
    identifier of any kind.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT coalesce(u.description, 'Unaffiliated') AS school,
               coalesce(r.event_format_snapshot, 'Unspecified') AS format,
               sum(r.total_pax) AS pax,
               count(DISTINCT r.request_id) AS n,
               coalesce(sum(food.total), 0) + coalesce(sum(fund.total), 0) AS cost
          FROM request r
          LEFT JOIN LATERAL (
                SELECT min(uur.unit_code) AS unit_code
                  FROM user_unit_roles uur
                  JOIN role_unit ru ON ru.role_code = uur.role_code AND ru.unit_code = uur.unit_code
                 WHERE uur.user_id = r.applicant_user_id AND uur.is_active
                   AND uur.unit_code LIKE 'school%%'
          ) applicant_school ON TRUE
          LEFT JOIN unit u ON u.code = applicant_school.unit_code
          LEFT JOIN LATERAL (
                SELECT sum(s.quantity * o.unit_price_rm) AS total
                  FROM request_fmb_selection s
                  JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
                  JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                 WHERE f.request_id = r.request_id AND s.status <> 'cancelled'
          ) food ON TRUE
          LEFT JOIN LATERAL (
                SELECT sum(p.quantity * p.unit_price_rm) AS total
                  FROM request_funding_purchase p
                 WHERE p.request_id = r.request_id
          ) fund ON TRUE
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
      GROUP BY 1, 2
      ORDER BY 1, 2
        """,
        scope.base_params,
    )
    return [
        {
            "school": r["school"],
            "format": r["format"],
            "pax": num(r["pax"], 0.0),
            "n": int(r["n"]),
            "cost": num(r["cost"], 0.0),
            "value": ratio(r["cost"], r["pax"]),
        }
        for r in rows
    ]


def forward_commitment(cur, scope: Scope, *, request_filter: str = "", months: int = 6, extra: dict | None = None) -> list[dict[str, Any]]:
    """M57 - committed spend by month for approved events not yet run.

    Approved spend is already a commitment: the proposal cannot be cancelled
    inside CANCELLATION_DEADLINE_DAYS. This is the number that has to be
    affordable, and it is knowable months ahead.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT date_trunc('month', es.first_date)::date AS bucket,
               coalesce(sum(food.total), 0) AS food,
               coalesce(sum(fund.total), 0) AS funding,
               count(*) AS proposals
          FROM request r
          JOIN LATERAL (
                SELECT min("date") AS first_date FROM event_schedule
                 WHERE request_id = r.request_id
          ) es ON TRUE
          LEFT JOIN LATERAL (
                SELECT sum(s.quantity * o.unit_price_rm) AS total
                  FROM request_fmb_selection s
                  JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
                  JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                 WHERE f.request_id = r.request_id AND s.status <> 'cancelled'
          ) food ON TRUE
          LEFT JOIN LATERAL (
                SELECT sum(p.quantity * p.unit_price_rm) AS total
                  FROM request_funding_purchase p
                 WHERE p.request_id = r.request_id
          ) fund ON TRUE
         WHERE r.status = 'completed_approved'
           AND es.first_date >= %(today)s
           AND es.first_date < (%(today)s::date + (%(months)s || ' months')::interval)
           {request_filter}
      GROUP BY 1
      ORDER BY 1
        """,
        scope.params(months=months, **(extra or {})),
    )
    return [
        {
            "x": r["bucket"].isoformat(),
            "food": num(r["food"], 0.0),
            "funding": num(r["funding"], 0.0),
            "value": num(r["food"], 0.0) + num(r["funding"], 0.0),
            "proposals": int(r["proposals"]),
        }
        for r in rows
    ]


def menu_performance(cur, scope: Scope) -> list[dict[str, Any]]:
    """Menu items by order volume, with revenue and a price-missing flag.

    Two decisions on one chart: what to promote, and what to retire. Zero-order
    items are returned so the second decision is visible at all.
    """
    rows = fetch_all(
        cur,
        """
        SELECT o.fmb_option_id AS option_id,
               o.label AS label,
               o.unit_code AS outlet,
               o.unit_price_rm AS price,
               count(s.request_fmb_selection_id) AS orders,
               coalesce(sum(s.quantity), 0) AS portions,
               coalesce(sum(s.quantity * o.unit_price_rm), 0) AS revenue
          FROM fmb_options o
          LEFT JOIN request_fmb_selection s
                 ON s.fmb_option_id = o.fmb_option_id
                AND s.status <> 'cancelled'
                AND s.created_at >= %(from)s AND s.created_at < %(to)s
         WHERE o.active AND o.archived_at IS NULL
           AND o.unit_code = ANY(%(outlets)s)
      GROUP BY 1, 2, 3, 4
      ORDER BY 5 DESC, 2
        """,
        scope.base_params,
    )
    return [
        {
            "optionId": r["option_id"],
            "label": r["label"],
            "outlet": r["outlet"],
            "price": num(r["price"]),
            "value": int(r["orders"]),
            "portions": num(r["portions"], 0.0),
            "revenue": num(r["revenue"], 0.0),
            "unpriced": r["price"] is None,
        }
        for r in rows
    ]


def funding_catalogue_usage(cur, scope: Scope) -> list[dict[str, Any]]:
    """M37 for the finance catalogue the CFO owns.

    A high off-catalogue rate means spend is being recorded outside the finance
    codes it is meant to roll up to, which quietly breaks the category panel.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT m.funding_main_option_id AS option_id,
               m.label AS label,
               m.budget_category_finance_code AS code,
               count(p.request_funding_purchase_id) AS selections,
               coalesce(sum(p.quantity * p.unit_price_rm), 0) AS value
          FROM funding_main_options m
          LEFT JOIN request_funding_purchase p ON p.main_option_id = m.funding_main_option_id
          LEFT JOIN request r ON r.request_id = p.request_id
                 AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
                 AND r.status NOT IN {_DEAD}
         WHERE m.active AND m.archived_at IS NULL
      GROUP BY 1, 2, 3
      ORDER BY 4 DESC, 2
        """,
        scope.base_params,
    )
    return [
        {
            "optionId": r["option_id"],
            "label": r["label"],
            "code": r["code"],
            "value": int(r["selections"]),
            "amount": num(r["value"], 0.0),
        }
        for r in rows
    ]


def funding_sub_usage(cur, scope: Scope) -> list[dict[str, Any]]:
    """Every active funding **sub**-option ranked by selections, each carrying
    the main option it hangs off.

    `mainOptionId` travels with every row on purpose. A sub-option belongs to
    exactly one main, and its count is already final by the time it leaves this
    function, so the CFO panel can narrow to one main option by *hiding* bars
    rather than refetching. That is a filter, not client-side aggregation - no
    number is recomputed in the browser, and no row reaches it that the caller
    could not already see, since this is the catalogue the CFO owns.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT s.funding_sub_option_id AS option_id,
               s.label AS label,
               s.main_option_id AS main_option_id,
               m.label AS main_label,
               s.finance_procurement_code AS code,
               count(p.request_funding_purchase_id) AS selections,
               coalesce(sum(p.quantity * p.unit_price_rm), 0) AS value
          FROM funding_sub_options s
          JOIN funding_main_options m ON m.funding_main_option_id = s.main_option_id
          LEFT JOIN request_funding_purchase p ON p.sub_option_id = s.funding_sub_option_id
          LEFT JOIN request r ON r.request_id = p.request_id
                 AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
                 AND r.status NOT IN {_DEAD}
         WHERE s.active AND s.archived_at IS NULL
           AND m.active AND m.archived_at IS NULL
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 6 DESC, 2
        """,
        scope.base_params,
    )
    return [
        {
            "optionId": r["option_id"],
            "label": r["label"],
            "mainOptionId": r["main_option_id"],
            "mainLabel": r["main_label"],
            "code": r["code"],
            "value": int(r["selections"]),
            "amount": num(r["value"], 0.0),
        }
        for r in rows
    ]


def proposal_bucket_counts(cur, scope: Scope) -> dict[str, int]:
    """Institution-wide proposal counts for the CFO's status strip.

    The CFO holds no unit, so "inbox" cannot mean `assigned_unit_code = mine`
    the way it does for a department head. It means the CFO's own gate, and
    "ongoing" is everything else still moving - the two are disjoint, so the
    strip adds up rather than double-counting the gate queue.

    The fourth bucket is **cancelled**, not late. A CFO is not chasing an
    overdue task; a cancelled event is money that was committed and released,
    and it is the only one of the four that changes what the spend figures
    above it mean.
    """
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE r.status = 'cfo_review') AS inbox,
               count(*) FILTER (
                   WHERE r.status IN ('submitted', 'hos_hod_review', 'fmb_review',
                                      'department_review', 'resubmission_required')
               ) AS ongoing,
               count(*) FILTER (WHERE r.status = 'completed_approved') AS completed,
               count(*) FILTER (WHERE r.status = 'cancelled') AS cancelled
          FROM request r
         WHERE r.submitted_at IS NOT NULL
        """,
        (),
    )
    return {
        "inbox": int(row["inbox"]) if row else 0,
        "ongoing": int(row["ongoing"]) if row else 0,
        "completed": int(row["completed"]) if row else 0,
        "cancelled": int(row["cancelled"]) if row else 0,
    }


def funding_off_catalogue(cur, scope: Scope) -> dict[str, Any]:
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) FILTER (WHERE p.main_option_id IS NULL) AS off_catalogue,
               count(*) AS total
          FROM request_funding_purchase p
          JOIN request r ON r.request_id = p.request_id
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
           AND r.status NOT IN {_DEAD}
        """,
        scope.base_params,
    )
    return {
        "rate": ratio(row["off_catalogue"], row["total"]) if row else None,
        "count": int(row["off_catalogue"]) if row else 0,
        "sample": int(row["total"]) if row else 0,
    }
