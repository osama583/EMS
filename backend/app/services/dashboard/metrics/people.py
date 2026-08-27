"""Family G - people and productivity (M60-M67).

Rule R10 governs this whole family: names inside the unit, shapes across units.
Every function here that returns a person's name is called only with the
viewer's own unit or outlet as its scope, and the cross-unit variants return
headcount and distribution shape with no name attached.
"""
from __future__ import annotations

from typing import Any

from ....db import fetch_all, fetch_one
from ..scope import Scope, num, ratio
from .common import NON_COMMITTED_STATUSES, DepartmentSpec


def assignments_per_staff(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """M60 - row assignments plus task assignments per staff member.

    Row assignments are the real unit of work for the five row-assignable
    requirements (migration 012); counting only `task_assignment` undercounts
    them badly, and a workload panel built on the undercount would exonerate
    exactly the busiest person.
    """
    rows = fetch_all(
        cur,
        """
        SELECT u.user_id AS user_id,
               u.full_name AS name,
               coalesce(rows_assigned.n, 0) + coalesce(tasks_assigned.n, 0) AS assignments,
               coalesce(rows_assigned.completed, 0) AS completed,
               rows_assigned.median_hours AS median_hours
          FROM user_unit_roles uur
          JOIN users u ON u.user_id = uur.user_id
          LEFT JOIN LATERAL (
                SELECT count(*) AS n,
                       count(*) FILTER (WHERE ra.status = 'completed') AS completed,
                       percentile_cont(0.5) WITHIN GROUP (
                           ORDER BY EXTRACT(epoch FROM ra.resolved_at - ra.assigned_at) / 3600.0
                       ) AS median_hours
                  FROM request_row_assignment ra
                  JOIN request_task t ON t.request_task_id = ra.request_task_id
                 WHERE ra.staff_user_id = u.user_id
                   AND t.assigned_unit_code = %(unit)s
                   AND ra.assigned_at >= %(from)s AND ra.assigned_at < %(to)s
          ) rows_assigned ON TRUE
          LEFT JOIN LATERAL (
                SELECT count(*) AS n
                  FROM task_assignment ta
                  JOIN request_task t ON t.request_task_id = ta.request_task_id
                 WHERE ta.staff_user_id = u.user_id
                   AND t.assigned_unit_code = %(unit)s
                   AND ta.assigned_at >= %(from)s AND ta.assigned_at < %(to)s
          ) tasks_assigned ON TRUE
         WHERE uur.unit_code = %(unit)s
           AND uur.role_code = 'staff'
           AND uur.is_active
           AND u.is_active AND u.archived_at IS NULL
      ORDER BY 3 DESC, 2
        """,
        scope.base_params,
    )
    return [
        {
            "userId": r["user_id"],
            "name": r["name"],
            "value": int(r["assignments"]),
            "completed": int(r["completed"]),
            "completionRate": ratio(r["completed"], r["assignments"]),
            "medianHours": num(r["median_hours"]),
        }
        for r in rows
    ]


def workload_balance(staff: list[dict[str, Any]]) -> dict[str, Any]:
    """M61 - max/min spread and Gini across the unit's active staff.

    A head with three staff at 12/11/1 has a management problem that an average
    of eight conceals. Gini is suppressed below three people: with two staff the
    coefficient is a restatement of the ratio and reads as precision it does not
    have.
    """
    values = sorted(float(s["value"]) for s in staff)
    if not values:
        # Same keys as the populated case. A caller reading balance["gini"] on an
        # empty unit should get None, not a KeyError - the empty unit is the
        # day-one case, so the two shapes have to match.
        return {
            "spread": None,
            "min": None,
            "max": None,
            "median": None,
            "gini": None,
            "staff": 0,
            "giniSuppressed": True,
        }
    low, high = values[0], values[-1]
    median = values[len(values) // 2] if len(values) % 2 else (values[len(values) // 2 - 1] + values[len(values) // 2]) / 2
    total = sum(values)
    gini = None
    if len(values) >= 3 and total:
        n = len(values)
        weighted = sum((i + 1) * v for i, v in enumerate(values))
        gini = round((2 * weighted) / (n * total) - (n + 1) / n, 4)
    return {
        "spread": round(high / low, 2) if low else (None if not high else float("inf")),
        "min": low,
        "max": high,
        "median": median,
        "gini": gini,
        "staff": len(values),
        "giniSuppressed": len(values) < 3,
    }


def unassigned_approved_work(cur, scope: Scope, spec: DepartmentSpec) -> dict[str, Any]:
    """M64 - approved rows with no assignee, weighted by days to the event date.

    The most actionable single number on any service HOD's dashboard: an
    approved item with nobody on it is work that has been promised and not
    staffed. The weighting is what separates "three rigs, all next month" from
    "three rigs, one tomorrow".
    """
    row = fetch_one(
        cur,
        f"""
        SELECT count(*) AS n,
               min(d."date") AS soonest,
               count(*) FILTER (WHERE d."date" <= %(today)s::date + %(risk_days)s) AS urgent
          FROM {spec.table} d
          JOIN request_task t ON t.request_id = d.request_id
          JOIN request r ON r.request_id = d.request_id
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status IN ('approved', 'preparing')
           AND r.status <> ALL(%(non_committed)s)
           AND d."date" >= %(today)s
           AND NOT EXISTS (
                SELECT 1 FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s AND ra.row_id = d.{spec.pk}
           )
           AND NOT EXISTS (
                SELECT 1 FROM task_assignment ta
                 WHERE ta.request_task_id = t.request_task_id
           )
        """,
        scope.params(
            non_committed=list(NON_COMMITTED_STATUSES),
            requirement=spec.requirement,
            risk_days=scope.config.risk_window_days(scope.unit_code),
        ),
    )
    return {
        "count": int(row["n"]) if row else 0,
        "urgent": int(row["urgent"]) if row else 0,
        "soonest": row["soonest"].isoformat() if row and row["soonest"] else None,
    }


def stale_unassigned(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """Approved rows still unassigned past SLA_ASSIGNMENT_HOURS, oldest first."""
    rows = fetch_all(
        cur,
        f"""
        SELECT d.{spec.pk} AS row_id,
               d.request_id AS request_id,
               d."date" AS day,
               d.{spec.label_column} AS label,
               r.event_title AS event_title,
               EXTRACT(epoch FROM now() - t.resolved_at) / 3600.0 AS hours_since,
               t.resolved_at AS approved_at
          FROM {spec.table} d
          JOIN request_task t ON t.request_id = d.request_id
          JOIN request r ON r.request_id = d.request_id
         WHERE t.assigned_unit_code = %(unit)s
           AND t.status IN ('approved', 'preparing')
           AND r.status <> ALL(%(non_committed)s)
           AND d."date" >= %(today)s
           AND NOT EXISTS (
                SELECT 1 FROM request_row_assignment ra
                 WHERE ra.requirement_name = %(requirement)s AND ra.row_id = d.{spec.pk}
           )
      ORDER BY d."date"
         LIMIT 25
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), requirement=spec.requirement),
    )
    return [
        {
            "rowId": r["row_id"],
            "requestId": r["request_id"],
            "date": r["day"].isoformat(),
            "label": r["label"],
            "eventTitle": r["event_title"],
            "hoursSinceApproval": num(r["hours_since"]),
        }
        for r in rows
    ]


def double_booked(cur, scope: Scope, spec: DepartmentSpec) -> list[dict[str, Any]]:
    """One person holding two rows whose windows overlap.

    Unlimited assignees per row is permitted for Photography and Logistics
    (`MAX_ASSIGNEES_PER_ROW[...] = None`), so nothing in the schema stops an
    over-assignment, and with a two-person roster it is easy to do by accident.
    """
    if not spec.has_window:
        return []
    rows = fetch_all(
        cur,
        f"""
        SELECT u.user_id AS user_id, u.full_name AS name,
               a."date" AS day,
               a.{spec.start_column} AS a_start, a.{spec.end_column} AS a_end,
               a.{spec.label_column} AS a_label, a.request_id AS a_request,
               b.{spec.start_column} AS b_start, b.{spec.end_column} AS b_end,
               b.{spec.label_column} AS b_label, b.request_id AS b_request
          FROM request_row_assignment ra_a
          JOIN request_row_assignment ra_b
            ON ra_b.staff_user_id = ra_a.staff_user_id
           AND ra_b.requirement_name = ra_a.requirement_name
           AND ra_b.row_id > ra_a.row_id
          JOIN {spec.table} a ON a.{spec.pk} = ra_a.row_id
          JOIN {spec.table} b ON b.{spec.pk} = ra_b.row_id
          JOIN users u ON u.user_id = ra_a.staff_user_id
          JOIN request ra ON ra.request_id = a.request_id
          JOIN request rb ON rb.request_id = b.request_id
         WHERE ra_a.requirement_name = %(requirement)s
           AND a."date" = b."date"
           AND a.{spec.start_column} < b.{spec.end_column}
           AND a.{spec.end_column} > b.{spec.start_column}
           AND ra.status <> ALL(%(non_committed)s)
           AND rb.status <> ALL(%(non_committed)s)
           AND a."date" >= %(today)s
      ORDER BY a."date"
        """,
        scope.params(non_committed=list(NON_COMMITTED_STATUSES), requirement=spec.requirement),
    )
    return [
        {
            "userId": r["user_id"],
            "name": r["name"],
            "date": r["day"].isoformat(),
            "first": {
                "label": r["a_label"],
                "requestId": r["a_request"],
                "start": r["a_start"].isoformat() if r["a_start"] else None,
                "end": r["a_end"].isoformat() if r["a_end"] else None,
            },
            "second": {
                "label": r["b_label"],
                "requestId": r["b_request"],
                "start": r["b_start"].isoformat() if r["b_start"] else None,
                "end": r["b_end"].isoformat() if r["b_end"] else None,
            },
        }
        for r in rows
    ]


# --- Cafeteria people metrics (M65-M67) ----------------------------------


def claim_distribution(cur, scope: Scope) -> list[dict[str, Any]]:
    """M65 - per-staff share of claimed orders.

    First-come-first-served claiming means an outlet can have one person taking
    80% of the pool while others idle. `claimed_by_user_id` makes that visible
    and nothing else in the application does.
    """
    rows = fetch_all(
        cur,
        """
        SELECT u.user_id AS user_id,
               u.full_name AS name,
               uur.unit_code AS outlet,
               count(s.request_fmb_selection_id) AS claimed,
               percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(epoch FROM s.delivered_at - s.approved_at) / 3600.0
               ) AS median_hours
          FROM user_unit_roles uur
          JOIN users u ON u.user_id = uur.user_id
          LEFT JOIN request_fmb_selection s
                 ON s.claimed_by_user_id = u.user_id
                AND s.unit_code = uur.unit_code
                AND s.created_at >= %(from)s AND s.created_at < %(to)s
         WHERE uur.unit_code = ANY(%(outlets)s)
           AND uur.role_code = 'cafeteria-staff'
           AND uur.is_active
           AND u.is_active AND u.archived_at IS NULL
      GROUP BY 1, 2, 3
      ORDER BY 4 DESC, 2
        """,
        scope.base_params,
    )
    total = sum(int(r["claimed"]) for r in rows)
    return [
        {
            "userId": r["user_id"],
            "name": r["name"],
            "outlet": r["outlet"],
            "value": int(r["claimed"]),
            "share": ratio(r["claimed"], total),
            "medianHours": num(r["median_hours"]),
        }
        for r in rows
    ]


def staff_churn(cur, scope: Scope) -> list[dict[str, Any]]:
    """M66 - audit-log actions per outlet, split by action."""
    rows = fetch_all(
        cur,
        """
        SELECT date_trunc('week', created_at)::date AS week,
               cafeteria_code AS outlet,
               action,
               count(*) AS n
          FROM cafeteria_staff_audit_log
         WHERE cafeteria_code = ANY(%(outlets)s)
           AND created_at >= %(from)s AND created_at < %(to)s
      GROUP BY 1, 2, 3
      ORDER BY 1
        """,
        scope.base_params,
    )
    return [
        {"week": r["week"].isoformat(), "outlet": r["outlet"], "action": r["action"], "value": int(r["n"])}
        for r in rows
    ]


def staffing_timeline(cur, scope: Scope) -> list[dict[str, Any]]:
    """The audit log as a per-person timeline, for the staffing panel.

    Names shown: a Cafeteria Manager already manages these people on
    `/app/cafeterias/my-staff`, so this is inside their own scope (R10). Another
    outlet's staff never reach the query - `cafeteria_code = ANY(:outlets)`.
    """
    rows = fetch_all(
        cur,
        """
        SELECT cafeteria_staff_audit_log_id AS id,
               cafeteria_code AS outlet,
               action,
               target_display_name AS name,
               actor_display_name AS actor,
               created_at AS at
          FROM cafeteria_staff_audit_log
         WHERE cafeteria_code = ANY(%(outlets)s)
           AND created_at >= %(from)s AND created_at < %(to)s
      ORDER BY created_at DESC
         LIMIT 60
        """,
        scope.base_params,
    )
    return [
        {
            "id": r["id"],
            "outlet": r["outlet"],
            "action": r["action"],
            "name": r["name"],
            "actor": r["actor"],
            "at": r["at"].isoformat(),
        }
        for r in rows
    ]


def staff_availability(cur, scope: Scope) -> dict[str, Any]:
    """Active cafeteria staff per outlet, plus the audit-log churn behind it.

    The staffing-request tables were dropped in migration 015 - a manager now
    creates staff directly - so the "pending request" half of the original M67
    no longer has a source. Churn is what remains measurable, and the widget
    says so rather than rendering an empty pending count as "nothing waiting".
    """
    rows = fetch_all(
        cur,
        """
        SELECT uur.unit_code AS outlet,
               coalesce(u2.description, uur.unit_code) AS label,
               count(*) FILTER (WHERE uur.is_active AND u.is_active) AS active,
               count(*) FILTER (WHERE NOT uur.is_active) AS suspended
          FROM user_unit_roles uur
          JOIN users u ON u.user_id = uur.user_id
          JOIN unit u2 ON u2.code = uur.unit_code
         WHERE uur.unit_code = ANY(%(outlets)s)
           AND uur.role_code = 'cafeteria-staff'
           AND u.archived_at IS NULL
      GROUP BY 1, 2
      ORDER BY 2
        """,
        scope.base_params,
    )
    recent = fetch_one(
        cur,
        """
        SELECT count(*) FILTER (WHERE action IN ('suspend', 'remove')) AS departures,
               count(*) FILTER (WHERE action = 'create') AS arrivals
          FROM cafeteria_staff_audit_log
         WHERE cafeteria_code = ANY(%(outlets)s)
           AND created_at >= %(from)s AND created_at < %(to)s
        """,
        scope.base_params,
    )
    return {
        "outlets": [
            {
                "outlet": r["outlet"],
                "label": r["label"],
                "active": int(r["active"]),
                "suspended": int(r["suspended"]),
            }
            for r in rows
        ],
        "active": sum(int(r["active"]) for r in rows),
        "suspended": sum(int(r["suspended"]) for r in rows),
        "arrivals": int(recent["arrivals"]) if recent else 0,
        "departures": int(recent["departures"]) if recent else 0,
    }


def applicant_activity(cur, scope: Scope, *, unit_code: str) -> list[dict[str, Any]]:
    """Proposals submitted per applicant within one school.

    Names shown - the viewer's own school (R10). Identifies both the organisers
    carrying the school and the ones who need help with the form, which is the
    same list read two ways.
    """
    rows = fetch_all(
        cur,
        """
        SELECT r.applicant_user_id AS user_id,
               r.applicant_name AS name,
               count(*) AS submitted,
               count(*) FILTER (WHERE r.status = 'completed_approved') AS approved,
               count(DISTINCT h.request_id) AS sent_back,
               coalesce(avg(cost.total), 0) AS mean_cost
          FROM request r
          JOIN user_unit_roles uur
            ON uur.user_id = r.applicant_user_id
           AND uur.unit_code = %(school)s
           AND uur.is_active
          LEFT JOIN workflow_history h
                 ON h.request_id = r.request_id AND h.action = 'resubmit'
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
         WHERE r.submitted_at >= %(from)s AND r.submitted_at < %(to)s
      GROUP BY 1, 2
      ORDER BY 3 DESC, 2
        """,
        scope.params(school=unit_code),
    )
    return [
        {
            "userId": r["user_id"],
            "name": r["name"],
            "value": int(r["submitted"]),
            "approved": int(r["approved"]),
            "sentBack": int(r["sent_back"]),
            "sendBackRate": ratio(r["sent_back"], r["submitted"]),
            "meanCost": num(r["mean_cost"], 0.0),
        }
        for r in rows
    ]
