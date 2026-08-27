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
    `backend/docs/security.md` on attendee identity).
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


def gate_coverage(cur, scope: Scope) -> dict[str, Any]:
    """M56 - the share of proposals crossing HIGH_PAX_THRESHOLD, and the share
    of committed spend those proposals carry.

    Two numbers on one tile, deliberately: "4% of proposals, 31% of spend". If
    the gate sees 4% of events and 31% of the money the threshold is roughly
    doing its job; if it sees 4% and 9%, it is not. That comparison is the whole
    argument for retuning it, and the CFO is the person who can request that.
    """
    threshold = scope.config.number("HIGH_PAX_THRESHOLD", 50)
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS proposals,
               count(*) FILTER (WHERE r.total_pax > %(threshold)s) AS above,
               coalesce(sum(cost.total), 0) AS spend,
               coalesce(sum(cost.total) FILTER (WHERE r.total_pax > %(threshold)s), 0) AS spend_above
          FROM request r
          LEFT JOIN LATERAL (
                SELECT coalesce((SELECT sum(s.quantity * o.unit_price_rm)
                                   FROM request_fmb_selection s
                                   JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
                                   JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                                  WHERE f.request_id = r.request_id AND s.status <> 'cancelled'), 0)
                     + coalesce((SELECT sum(p.quantity * p.unit_price_rm)
                                   FROM request_funding_purchase p
                                  WHERE p.request_id = r.request_id), 0) AS total
          ) cost ON TRUE
         WHERE r.status NOT IN {_DEAD}
           AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
        """,
        scope.params(threshold=threshold),
    )
    return {
        "threshold": threshold,
        "proposalShare": ratio(row["above"], row["proposals"]) if row else None,
        "spendShare": ratio(row["spend_above"], row["spend"]) if row else None,
        "proposalsAbove": int(row["above"]) if row else 0,
        "proposals": int(row["proposals"]) if row else 0,
        "spendAbove": num(row["spend_above"], 0.0) if row else 0.0,
        "spend": num(row["spend"], 0.0) if row else 0.0,
    }


def gate_coverage_matrix(cur, scope: Scope) -> list[dict[str, Any]]:
    """The CFO's signature panel: pax bands against committed-cost bands.

    An R7 aggregate over every proposal in the period - counts and sums only,
    no identifier of any kind. What it quantifies is exactly what the current
    threshold misses: how many proposals, carrying how much money, pass below
    the gate. That figure exists nowhere else in the application.
    """
    rows = fetch_all(
        cur,
        f"""
        SELECT pax_band, cost_band, count(*) AS n, sum(total_cost) AS cost, sum(pax) AS pax
          FROM (
            SELECT CASE WHEN r.total_pax < 20 THEN '0-19'
                        WHEN r.total_pax < 50 THEN '20-49'
                        WHEN r.total_pax < 100 THEN '50-99'
                        WHEN r.total_pax < 250 THEN '100-249'
                        ELSE '250+' END AS pax_band,
                   CASE WHEN cost.total < 500 THEN 'RM 0-499'
                        WHEN cost.total < 2000 THEN 'RM 500-1,999'
                        WHEN cost.total < 10000 THEN 'RM 2,000-9,999'
                        ELSE 'RM 10,000+' END AS cost_band,
                   cost.total AS total_cost,
                   r.total_pax AS pax
              FROM request r
              LEFT JOIN LATERAL (
                    SELECT coalesce((SELECT sum(s.quantity * o.unit_price_rm)
                                       FROM request_fmb_selection s
                                       JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
                                       JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                                      WHERE f.request_id = r.request_id AND s.status <> 'cancelled'), 0)
                         + coalesce((SELECT sum(p.quantity * p.unit_price_rm)
                                       FROM request_funding_purchase p
                                      WHERE p.request_id = r.request_id), 0) AS total
              ) cost ON TRUE
             WHERE r.status NOT IN {_DEAD}
               AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
          ) banded
      GROUP BY 1, 2
        """,
        scope.base_params,
    )
    return [
        {
            "paxBand": r["pax_band"],
            "costBand": r["cost_band"],
            "n": int(r["n"]),
            "cost": num(r["cost"], 0.0),
            "pax": num(r["pax"], 0.0),
        }
        for r in rows
    ]


def threshold_preview(cur, scope: Scope, candidates: list[int]) -> list[dict[str, Any]]:
    """Coverage and queue cost at hypothetical HIGH_PAX_THRESHOLD values.

    Computed server-side and changing nothing: the CFO sees that moving the
    threshold from 50 to 35 brings 41% of spend under the gate instead of 31%
    and adds roughly six proposals a month to their queue - both sides of the
    trade, before asking an administrator to change anything.
    """
    out = []
    for candidate in candidates:
        row = fetch_one(
            cur,
            f"""
            SELECT count(*) FILTER (WHERE r.total_pax > %(candidate)s) AS above,
                   count(*) AS proposals,
                   coalesce(sum(cost.total), 0) AS spend,
                   coalesce(sum(cost.total) FILTER (WHERE r.total_pax > %(candidate)s), 0) AS spend_above
              FROM request r
              LEFT JOIN LATERAL (
                    SELECT coalesce((SELECT sum(s.quantity * o.unit_price_rm)
                                       FROM request_fmb_selection s
                                       JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
                                       JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                                      WHERE f.request_id = r.request_id AND s.status <> 'cancelled'), 0)
                         + coalesce((SELECT sum(p.quantity * p.unit_price_rm)
                                       FROM request_funding_purchase p
                                      WHERE p.request_id = r.request_id), 0) AS total
              ) cost ON TRUE
             WHERE r.status NOT IN {_DEAD}
               AND r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
            """,
            scope.params(candidate=candidate),
        )
        days = max(1, scope.period.days)
        above = int(row["above"]) if row else 0
        out.append(
            {
                "threshold": candidate,
                "proposalShare": ratio(row["above"], row["proposals"]) if row else None,
                "spendShare": ratio(row["spend_above"], row["spend"]) if row else None,
                "queuePerMonth": round(above * 30.0 / days, 1),
            }
        )
    return out


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


def price_coverage(cur, scope: Scope, *, outlets: list[str] | None = None) -> dict[str, Any]:
    """M58 - active menu items carrying a price, over active menu items.

    Displayed beside every currency figure that depends on it. A CFO reading
    RM 128,400 needs to know whether that is 95% of the truth or 60%.
    """
    targets = outlets if outlets is not None else list(scope.outlets)
    row = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE o.unit_price_rm IS NOT NULL) AS priced,
               count(*) AS items
          FROM fmb_options o
         WHERE o.active AND o.archived_at IS NULL
           AND (%(all_outlets)s OR o.unit_code = ANY(%(target_outlets)s))
        """,
        scope.params(all_outlets=not targets, target_outlets=targets or [""]),
    )
    unpriced_live = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n
          FROM request_fmb_selection s
          JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
          JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
         WHERE o.unit_price_rm IS NULL
           AND s.status NOT IN ('cancelled', 'fulfilled')
           AND r.status NOT IN {_DEAD}
           AND (%(all_outlets)s OR s.unit_code = ANY(%(target_outlets)s))
        """,
        scope.params(all_outlets=not targets, target_outlets=targets or [""]),
    )
    return {
        "coverage": ratio(row["priced"], row["items"]) if row else None,
        "priced": int(row["priced"]) if row else 0,
        "items": int(row["items"]) if row else 0,
        "unpricedWithLiveOrders": int(unpriced_live["n"]) if unpriced_live else 0,
    }


def cost_by_outlet(cur, scope: Scope, *, outlets: list[str] | None = None) -> list[dict[str, Any]]:
    """M50 per outlet, each with its own M58 coverage.

    Coverage per outlet rather than one institutional figure: an outlet at 40%
    priced makes its own bar meaningless, and averaging that into a single
    caption would hide which one.
    """
    targets = outlets if outlets is not None else list(scope.outlets)
    rows = fetch_all(
        cur,
        f"""
        SELECT s.unit_code AS code,
               coalesce(u.description, u.code) AS label,
               sum(s.quantity * o.unit_price_rm) AS total,
               count(*) FILTER (WHERE o.unit_price_rm IS NOT NULL) AS priced,
               count(*) AS items
          FROM request_fmb_selection s
          JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
          JOIN unit u ON u.code = s.unit_code
          JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
          JOIN request r ON r.request_id = f.request_id
         WHERE s.status <> 'cancelled'
           AND r.status NOT IN {_DEAD}
           AND coalesce(s.created_at, r.submitted_at) >= %(from)s
           AND coalesce(s.created_at, r.submitted_at) < %(to)s
           AND (%(all_outlets)s OR s.unit_code = ANY(%(target_outlets)s))
      GROUP BY 1, 2
      ORDER BY 3 DESC NULLS LAST
        """,
        scope.params(all_outlets=not targets, target_outlets=targets or [""]),
    )
    return [
        {
            "code": r["code"],
            "label": r["label"],
            "value": num(r["total"], 0.0),
            "coverage": ratio(r["priced"], r["items"]),
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
