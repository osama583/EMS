"""Proposals: the applicant's own submissions and every review action on them.

Resource design
---------------
    GET    /proposals                      scoped to the caller (see below)
    POST   /proposals                      create and submit
    POST   /proposals/drafts               create or update a draft
    GET    /proposals/{id}                 one proposal, if the caller may see it
    PATCH  /proposals/{id}                 save content without changing stage
    DELETE /proposals/{id}                 delete a draft
    GET    /proposals/{id}/history         audit trail
    GET    /proposals/{id}/tasks           department tasks
    POST   /proposals/{id}/decision        approve | reject | send-back  (reviewer)
    POST   /proposals/{id}/resubmission    applicant returns sent-back work
    POST   /proposals/{id}/cancellation    applicant cancels

The three reviewer verbs collapse into ONE endpoint taking {"decision": ...}
rather than three sibling routes. The authorisation, the stage lookup and the
audit write are identical for all three; only the resulting status differs. The
mock had /approve, /reject and /resubmit as separate routes, which is where its
"which actor field does this one take?" inconsistency came from.

SCOPING. GET /proposals returns only what the caller may see, computed
server-side: their own proposals, ones they co-own, and ones currently awaiting
their decision. The mock returned every proposal in the database to every
caller and let the browser filter - which meant every applicant's bank account
details were in the response of any list page.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, transaction
from ..errors import BadRequest, Forbidden, NotFound, WorkflowError
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ..services import identity
from ..services import proposals as svc
from ..services import workflow as wf
from ..services.workflow.constants import (
    FMB_UNIT_CODE,
    ROW_ASSIGNABLE_REQUIREMENTS,
    SEL_TERMINAL,
    TASK_TERMINAL,
    TERMINAL_STATUSES,
    UNIT_CODE_FOR_REQUIREMENT,
)
from ._helpers import body, pagination, required

bp = Blueprint("proposals", __name__, url_prefix="/proposals")


# --- Visibility -----------------------------------------------------------
# One predicate, used by both the list and the single-item read, so a proposal
# can never be listable but unreadable (or worse, the reverse).
_VISIBLE_SQL = """
      r.applicant_user_id = %(user_id)s
   OR EXISTS (
        SELECT 1 FROM co_owners c
   LEFT JOIN staff s ON s.staff_id = c.staff_id
       WHERE c.request_id = r.request_id
         AND (s.user_id = %(user_id)s OR lower(trim(c.staff_email)) = lower(%(email)s))
      )
   OR (r.status = 'hos_hod_review' AND EXISTS (
        SELECT 1 FROM user_unit_roles applicant_role
          JOIN user_unit_roles my_role ON my_role.unit_code = applicant_role.unit_code
         WHERE applicant_role.user_id = r.applicant_user_id
           AND my_role.user_id = %(user_id)s
           AND my_role.role_code IN ('head-of-school', 'head-of-department')
      ))
   OR (r.status = 'fmb_review' AND %(is_fmb_head)s)
   OR (r.status = 'cfo_review' AND %(is_cfo)s)
   OR EXISTS (
        SELECT 1 FROM request_task t
         WHERE t.request_id = r.request_id
           AND (t.assigned_unit_code = ANY(%(headed_units)s)
                OR (t.assigned_role = 'fmb' AND %(is_fmb_head)s)
                OR (t.assigned_role = 'cfo' AND %(is_cfo)s))
      )
   OR EXISTS (
        SELECT 1 FROM task_assignment a
          JOIN request_task t ON t.request_task_id = a.request_task_id
         WHERE t.request_id = r.request_id AND a.staff_user_id = %(user_id)s
      )
   OR EXISTS (
        SELECT 1 FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE f.request_id = r.request_id
           AND sel.unit_code = ANY(%(cafeteria_units)s)
      )
   OR EXISTS (
        -- Durable "I acted on this" record - unlike the stage-gated clauses above (which stop
        -- matching the instant a proposal leaves that reviewer's stage), a workflow_history row
        -- is permanent, so a HOS/HOD, FMB head, or CFO who decided a proposal keeps seeing it in
        -- History even after it becomes terminal and their live-stage clause can never fire again.
        SELECT 1 FROM workflow_history wh
         WHERE wh.request_id = r.request_id AND wh.actor_user_id = %(user_id)s
      )
"""


# --- Bucketing --------------------------------------------------------------
# Mirrors the client's proposal-visibility.ts (proposalSectionForUser /
# userOwnsCurrentProposalAction / roleOwnsWorkflowAction), ported to SQL so
# Inbox/Ongoing/History become real server-side filters instead of "fetch
# everything visible, bucket it in the browser." Three buckets:
#   history: r.status is terminal (approved, rejected or cancelled)
#   inbox:   the caller can act RIGHT NOW - either as the applicant on
#            something sent back to them, or as whichever reviewer/department/
#            cafeteria-manager identity currently owns the next action
#   ongoing: visible, not terminal, not currently the caller's turn
#
# No proposal-visibility.ts-style "applicant-like short-circuit" is needed
# here: in this app's actual role model, an applicant-like account (student/
# lecturer/staff/external-user) never ALSO holds a reviewer/department-head/
# cafeteria-manager role, so "is the applicant owed an action" and "does the
# caller own a reviewer/department action" can never both be reachable for
# the same proposal by the same account - a plain OR of the two is exact.
#
# A department task counts as owed to the applicant while 'resubmitted'
# (department_review stays on request.status while sibling departments keep
# working - see request_task's docstring), independent of r.status.
_DEPARTMENT_PUSHBACK_SQL = """
    EXISTS (
        SELECT 1 FROM request_task t
         WHERE t.request_id = r.request_id
           AND t.stage_code = 'department_review' AND t.status = 'resubmitted'
    )
"""

_INBOX_SQL = f"""
      (r.applicant_user_id = %(user_id)s AND
       (r.status = 'resubmission_required' OR {_DEPARTMENT_PUSHBACK_SQL}))
   OR (r.status = 'hos_hod_review' AND EXISTS (
        SELECT 1 FROM user_unit_roles applicant_role
          JOIN user_unit_roles my_role ON my_role.unit_code = applicant_role.unit_code
         WHERE applicant_role.user_id = r.applicant_user_id
           AND my_role.user_id = %(user_id)s
           AND my_role.role_code = 'head-of-school'
      ))
   OR (r.status = 'fmb_review' AND %(is_fmb_head)s)
   OR (r.status = 'cfo_review' AND %(is_cfo)s)
   OR (r.status = 'department_review' AND EXISTS (
        SELECT 1 FROM request_task t
         WHERE t.request_id = r.request_id AND t.status = 'pending'
           AND (t.assigned_unit_code = ANY(%(headed_units)s)
                OR (t.assigned_role = 'fmb' AND %(is_fmb_head)s))
      ))
   OR EXISTS (
        SELECT 1 FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE f.request_id = r.request_id
           AND sel.unit_code = ANY(%(cafeteria_manager_units)s) AND sel.status = 'pending'
      )
   OR (%(is_fmb_head)s AND EXISTS (
        SELECT 1 FROM request_fmb_selection sel
          JOIN request_fmb f ON f.request_fmb_id = sel.request_fmb_id
         WHERE f.request_id = r.request_id AND sel.status = 'resubmitted'
      ))
"""

_BUCKET_SQL = f"""
    CASE
        WHEN r.status = ANY(%(terminal_statuses)s) THEN 'history'
        WHEN {_INBOX_SQL} THEN 'inbox'
        ELSE 'ongoing'
    END
"""

# The human-readable status label list pages show. Mirrors stageLabel() plus
# hub-proposals.ts's "Changes requested" override, computed once here instead
# of on every row client-side. 'draft' is handled by the same CASE (proposal-
# status.models.ts's stageLabel has no draft case; the client capitalises it
# itself for Drafts, but a bucketed inbox/ongoing/history row is never a
# draft, so this only needs to cover submitted-and-beyond).
_STATUS_LABEL_SQL = f"""
    CASE
        WHEN r.applicant_user_id = %(user_id)s AND {_DEPARTMENT_PUSHBACK_SQL} THEN 'Changes requested'
        WHEN r.status = 'submitted' THEN 'Submitted'
        WHEN r.status = 'hos_hod_review' THEN 'HOS/HOD review'
        WHEN r.status = 'fmb_review' THEN 'F&B review'
        WHEN r.status = 'cfo_review' THEN 'CFO review'
        WHEN r.status = 'department_review' THEN 'Department review'
        WHEN r.status = 'resubmission_required' THEN 'Revision required'
        WHEN r.status = 'completed_approved' THEN 'Approved'
        WHEN r.status = 'completed_rejected' THEN 'Rejected'
        WHEN r.status = 'cancelled' THEN 'Cancelled'
        WHEN r.status = 'draft' THEN 'Draft'
        ELSE r.status
    END
"""

_SORT_COLUMNS = {
    "updatedAt": "r.updated_at",
    "schedule": "earliest_schedule",
    "eventTitle": "r.event_title",
    "applicant": "r.applicant_name",
    "status": "r.status",
}


def _scope_params() -> dict:
    principal = current_principal()
    cafeteria_units = sorted(
        principal.units_for_role("cafeteria-manager") | principal.units_for_role("cafeteria-staff")
    )
    return {
        "user_id": principal.user_id,
        "email": principal.email,
        "headed_units": sorted(principal.headed_units) or [""],
        "cafeteria_units": cafeteria_units or [""],
        "cafeteria_manager_units": sorted(principal.units_for_role("cafeteria-manager")) or [""],
        "is_cfo": principal.has_role("cfo"),
        "is_fmb_head": "food_beverage_services" in principal.headed_units,
        "terminal_statuses": list(TERMINAL_STATUSES),
    }


def _load_visible(cur, request_id: int) -> dict:
    params = {**_scope_params(), "request_id": request_id}
    row = fetch_one(
        cur,
        f"SELECT r.* FROM request r WHERE r.request_id = %(request_id)s AND ({_VISIBLE_SQL})",
        params,
    )
    if row is None:
        # Deliberately 404, not 403: telling an unauthorised caller that a
        # proposal exists is itself a disclosure.
        raise NotFound("Proposal not found.")
    return row


_BUCKETS = ("inbox", "ongoing", "history", "drafts")


# --- Reads ----------------------------------------------------------------
@bp.get("")
@require_auth
def list_proposals():
    """Proposals the caller may see, paginated and sorted server-side.

    ?bucket=inbox|ongoing|history|drafts restricts to one of the four list
    pages' scopes - 'drafts' is r.status = 'draft' AND caller is the applicant
    (drafts are never shared with co-owners, unlike a submitted proposal), the
    other three are the CASE in _BUCKET_SQL. Omitting it returns every visible
    proposal, as before (used by callers that still want the raw feed).

    ?q= searches proposal id, event title and applicant name (case-insensitive,
    substring). ?statusLabel= filters to one exact value of the same
    human-readable label _STATUS_LABEL_SQL computes (what the list pages'
    status filter dropdown offers) - both applied before pagination, so a
    search always searches the whole bucket, not just the current page.

    ?sort=updatedAt|schedule|eventTitle|applicant|status (default updatedAt)
    and ?order=asc|desc (default desc for updatedAt, asc otherwise) drive
    ORDER BY; 'schedule' sorts by the proposal's earliest scheduled event date,
    NULLS LAST regardless of order so undated drafts never jump to the top of
    a descending sort.

    Still honours ?status= (raw comma-separated request.status values) and
    ?mine=true for callers that filter that way instead of by bucket.
    """
    limit, offset = pagination()
    params = _scope_params()
    clauses = [f"({_VISIBLE_SQL})"]

    bucket = request.args.get("bucket")
    if bucket is not None and bucket not in _BUCKETS:
        raise BadRequest("bucket must be one of: " + ", ".join(_BUCKETS) + ".")
    if bucket == "drafts":
        clauses.append("r.status = 'draft' AND r.applicant_user_id = %(user_id)s")
    elif bucket is not None:
        clauses.append("r.status <> 'draft'")
        params["bucket"] = bucket
        clauses.append(f"({_BUCKET_SQL}) = %(bucket)s")

    status = request.args.get("status")
    if status:
        params["status"] = status.split(",")
        clauses.append("r.status = ANY(%(status)s)")
    if str(request.args.get("mine", "")).lower() in ("1", "true", "yes"):
        clauses.append("r.applicant_user_id = %(user_id)s")
    requester = request.args.get("requester")
    if requester == "mine":
        clauses.append("r.applicant_user_id = %(user_id)s")
    elif requester == "other":
        clauses.append("r.applicant_user_id <> %(user_id)s")
    elif requester is not None:
        raise BadRequest("requester must be one of: mine, other.")

    query = request.args.get("q", "").strip()
    if query:
        params["q"] = f"%{query}%"
        clauses.append(
            "(r.request_code ILIKE %(q)s OR r.event_title ILIKE %(q)s OR r.applicant_name ILIKE %(q)s)"
        )
    status_label = request.args.get("statusLabel")
    if status_label:
        params["status_label"] = status_label
        clauses.append(f"({_STATUS_LABEL_SQL}) = %(status_label)s")
    category = request.args.get("category")
    if category:
        params["category"] = category
        clauses.append(
            "EXISTS (SELECT 1 FROM request_categories rc "
            "WHERE rc.request_id = r.request_id AND rc.category_name = %(category)s)"
        )

    sort_key = request.args.get("sort", "updatedAt")
    sort_column = _SORT_COLUMNS.get(sort_key)
    if sort_column is None:
        raise BadRequest("sort must be one of: " + ", ".join(_SORT_COLUMNS) + ".")
    order = request.args.get("order", "desc" if sort_key == "updatedAt" else "asc").lower()
    if order not in ("asc", "desc"):
        raise BadRequest("order must be asc or desc.")
    # A NULL earliest_schedule (no dates entered yet) always sorts last, in
    # either direction - "soonest first" and "furthest first" both mean
    # "undated last", not "undated first" on a descending sort.
    nulls = "NULLS LAST" if sort_column == "earliest_schedule" else ""

    where = " AND ".join(clauses)
    # One CTE joining the earliest schedule date, shared by the count, the
    # bucket/status-label CASEs (both reference r./earliest_schedule) and the
    # ORDER BY, so none of that SQL is duplicated across three queries.
    base = """
        WITH scoped AS (
            SELECT r.*, sched.earliest_schedule
              FROM request r
              LEFT JOIN (SELECT request_id, min("date") AS earliest_schedule
                           FROM event_schedule GROUP BY request_id) sched
                     ON sched.request_id = r.request_id
             WHERE {where}
        )
    """.format(where=where)
    with transaction() as cur:
        total = fetch_one(cur, base + "SELECT count(*) AS c FROM scoped r", params)["c"]
        rows = fetch_all(
            cur,
            base + f"""
                SELECT r.*,
                       (CASE WHEN r.status = 'draft' THEN 'drafts' ELSE ({_BUCKET_SQL}) END) AS bucket,
                       ({_STATUS_LABEL_SQL}) AS "statusLabel"
                  FROM scoped r
              ORDER BY {sort_column} {order} {nulls}, r.request_id DESC
                 LIMIT {limit} OFFSET {offset}
            """,
            params,
        )
        items = []
        for row in rows:
            item = svc.project(cur, row, include_children=False)
            item["bucket"] = row["bucket"]
            item["statusLabel"] = row["statusLabel"]
            items.append(item)

    return jsonify(
        {
            "items": items,
            "page": offset // limit + 1,
            "pageSize": limit,
            "total": total,
            "totalPages": max(1, -(-total // limit)),
        }
    )


# The proposal FORM's own sidebar page (route /app/forms/event-proposal) - not the
# review/list pages. Whoever the admin's Page Visibility settings let see this page is
# exactly "who could plausibly submit or edit a proposal," which is the eligibility rule
# for the Co-owner/Organizer pickers below: both roles let someone act as the applicant
# in the applicant's place (resubmit for Co-owners; help organise for Organizers), so
# neither should ever offer someone who couldn't have the proposal form open themselves.
_PROPOSAL_FORM_PAGE_CODE = "proposal-form"


@bp.get("/collaborator-candidates")
@require_internal
def list_collaborator_candidates():
    """Active internal users eligible to be a Co-owner or Organizer/PIC on a proposal.

    Scoped server-side to whoever the Page Visibility admin settings grant access to
    the proposal form itself (nav_page_grants on 'proposal-form') - see
    docs/superpowers/specs/2026-08-20-proposal-api-bug-patterns.md for why this exists:
    /auth/internal-users used to hand back literally every active internal account
    (including ones with no proposal-facing role at all) to this same picker.
    """
    return jsonify(identity.users_with_page_access(_PROPOSAL_FORM_PAGE_CODE))


@bp.get("/status-labels")
@require_auth
def list_status_labels():
    """Distinct status labels within one bucket, for that list page's status filter dropdown.

    Unpaginated by design - there are at most 10 possible labels total, so this
    is always a small, fast result, independent of how many proposals exist.
    """
    bucket = request.args.get("bucket")
    if bucket not in _BUCKETS:
        raise BadRequest("bucket must be one of: " + ", ".join(_BUCKETS) + ".")
    params = _scope_params()
    if bucket == "drafts":
        where = "r.status = 'draft' AND r.applicant_user_id = %(user_id)s"
    else:
        params["bucket"] = bucket
        where = f"({_VISIBLE_SQL}) AND r.status <> 'draft' AND ({_BUCKET_SQL}) = %(bucket)s"
    with transaction() as cur:
        rows = fetch_all(
            cur,
            f"""SELECT DISTINCT ({_STATUS_LABEL_SQL}) AS label FROM request r
                 WHERE {where} ORDER BY 1""",
            params,
        )
    return jsonify([row["label"] for row in rows])


@bp.get("/categories")
@require_auth
def list_categories():
    """Distinct event categories within one bucket, for that list page's category filter."""
    bucket = request.args.get("bucket")
    if bucket not in _BUCKETS:
        raise BadRequest("bucket must be one of: " + ", ".join(_BUCKETS) + ".")
    params = _scope_params()
    if bucket == "drafts":
        where = "r.status = 'draft' AND r.applicant_user_id = %(user_id)s"
    else:
        params["bucket"] = bucket
        where = f"({_VISIBLE_SQL}) AND r.status <> 'draft' AND ({_BUCKET_SQL}) = %(bucket)s"
    with transaction() as cur:
        rows = fetch_all(
            cur,
            f"""SELECT DISTINCT rc.category_name AS category
                  FROM request r
                  JOIN request_categories rc ON rc.request_id = r.request_id
                 WHERE {where} ORDER BY 1""",
            params,
        )
    return jsonify([row["category"] for row in rows])


# --- Department requests (the department-scoped Requests hub) --------------
# hub-requests.ts shows one row per (proposal, department_review task) for
# whichever department-request kinds the caller is routed to (their headed
# unit, or F&B for both fmb/waterNormal) - a DIFFERENT bucketing question from
# _BUCKET_SQL above: a department's own row goes to history the moment THEIR
# task is terminal (completed/cancelled), independent of sibling departments
# or the whole proposal's r.status (parallel independence - see request_task's
# docstring), and 'resubmitted' (they sent it back) is ongoing for them, not
# inbox - they are waiting on the applicant now, not the other way around.
_TASK_BUCKET_SQL = """
    CASE
        WHEN t.status = ANY(%(task_terminal)s) THEN 'history'
        WHEN t.status = 'pending' THEN 'inbox'
        ELSE 'ongoing'
    END
"""


def _routed_request_kinds() -> list[str]:
    """The caller's own department-request kinds, mirroring department-workflow.config.ts's
    requestKindsForRole() for the roles that ever show up in this tab (unit heads and F&B)."""
    principal = current_principal()
    kinds = [kind for kind, unit in UNIT_CODE_FOR_REQUIREMENT.items() if unit in principal.headed_units]
    if FMB_UNIT_CODE in principal.headed_units:
        kinds += ["fmb", "waterNormal"]
    return kinds


# request_fmb_selection.status -> bucket, mirroring _TASK_BUCKET_SQL's rule but on the ORDER's
# own status rather than a request_task's: 'pending' still needs the cafeteria manager's decision
# (inbox), a terminal order is done (history), everything else - approved/preparing/ready/
# resubmitted - is in progress for them (ongoing).
_ORDER_BUCKET_SQL = """
    CASE
        WHEN s.status = ANY(%(order_terminal)s) THEN 'history'
        WHEN s.status = 'pending' THEN 'inbox'
        ELSE 'ongoing'
    END
"""


def _department_task_rows(cur, bucket: str, routed_kinds: list[str]) -> list[dict]:
    """Rows from the caller's own headed-unit tasks (department heads, F&B head) - the original
    query this function replaces, unchanged in shape. Each row is enriched with who is assigned
    and their real step status: request_row_assignment for the 5 row-assignable kinds,
    request_fmb_selection for fmb/waterNormal."""
    if not routed_kinds:
        return []
    params = {
        **_scope_params(),
        "bucket": bucket,
        "task_terminal": list(TASK_TERMINAL),
        "task_requirement_names": sorted({"fmb" if k == "waterNormal" else k for k in routed_kinds}),
    }
    tasks = fetch_all(
        cur,
        f"""SELECT t.request_task_id, t.status, t.comment, er.requirement_name,
                   r.request_id, r.request_code, r.event_title, r.short_introduction,
                   r.goals_objectives, r.applicant_name, r.applicant_email
              FROM request_task t
              JOIN request r ON r.request_id = t.request_id
              JOIN event_requirements er ON er.requirement_id = t.requirement_id
             WHERE ({_VISIBLE_SQL}) AND t.stage_code = 'department_review'
               AND er.requirement_name = ANY(%(task_requirement_names)s)
               AND ({_TASK_BUCKET_SQL}) = %(bucket)s
          ORDER BY r.request_id DESC""",
        params,
    )
    if not tasks:
        return []
    schedules = {
        row["request_id"]: row
        for row in fetch_all(
            cur,
            """SELECT request_id, min("date") AS date, min(start_time) AS start,
                      max(end_time) AS "end", min(location) AS location
                 FROM event_schedule GROUP BY request_id""",
        )
    }

    rows: list[dict] = []
    for task in tasks:
        proposal_id = task["request_id"]
        initials = "".join(part[0] for part in (task["applicant_name"] or "").split()[:2]).upper()
        schedule = schedules.get(proposal_id)
        schedule_text = (
            f"{schedule['date']} · {str(schedule['start'])[:5]}-{str(schedule['end'])[:5]}"
            if schedule else ""
        )
        assignees = (
            _row_assignees(cur, task["request_task_id"])
            if task["requirement_name"] in ROW_ASSIGNABLE_REQUIREMENTS
            else {}
        )
        orders_by_ask = (
            _fmb_orders(cur, proposal_id)
            if task["requirement_name"] == "fmb"
            else {}
        )
        for detail in _flatten_requests_for_task(cur, proposal_id, task["requirement_name"], routed_kinds):
            department = detail["department"]
            if department in ROW_ASSIGNABLE_REQUIREMENTS:
                assignment = assignees.get(detail["id"])
                assigned_to = assignment["names"] if assignment else []
                progress_status = assignment["status"] if assignment else None
            elif department in ("fmb", "waterNormal"):
                orders = orders_by_ask.get(detail["id"], [])
                assigned_to = sorted({o["claimed_by_name"] for o in orders if o["claimed_by_name"]})
                progress_status = None
            else:
                assigned_to = []
                progress_status = None
            rows.append({
                "proposalId": proposal_id,
                "proposalCode": task["request_code"],
                "requestTaskId": task["request_task_id"],
                "taskStatus": task["status"],
                "taskComment": task["comment"],
                "eventTitle": task["event_title"],
                "shortIntroduction": task["short_introduction"],
                "goals": task["goals_objectives"],
                "applicant": task["applicant_name"],
                "applicantEmail": task["applicant_email"],
                "applicantInitials": initials,
                "schedule": schedule_text,
                "request": detail,
                "assignedTo": assigned_to,
                # The row-assignment's own progress (assigned/preparing/completed) when this
                # requirement is row-assignable; null for fmb/waterNormal (its progress is
                # per-ORDER, see "orders" below) and for fundingPurchase (never assigned).
                "progressStatus": progress_status,
                "orders": [
                    {
                        "cafeteriaName": o["cafeteria_name"],
                        "claimedByName": o["claimed_by_name"],
                        "status": o["status"],
                    }
                    for o in orders_by_ask.get(detail["id"], [])
                ] if department in ("fmb", "waterNormal") else [],
            })
    return rows


def _row_assignees(cur, request_task_id: int) -> dict[int, dict]:
    """row_id -> {names, status} for every row of one row-assignable task. Status is shared by
    every co-assignee on the same row (see request_row_assignment's own design), so the first
    assignee's status stands for the whole row."""
    assignments = fetch_all(
        cur,
        """SELECT a.row_id, a.status, u.full_name
             FROM request_row_assignment a
             JOIN users u ON u.user_id = a.staff_user_id
            WHERE a.request_task_id = %s
         ORDER BY a.row_id, a.assigned_at""",
        (request_task_id,),
    )
    by_row: dict[int, dict] = {}
    for a in assignments:
        entry = by_row.setdefault(a["row_id"], {"names": [], "status": a["status"]})
        entry["names"].append(a["full_name"])
    return by_row


def _fmb_orders(cur, request_id: int) -> dict[int, list[dict]]:
    """request_fmb_id -> every cafeteria order placed against that raw food/water ask, each with
    its own cafeteria/claimant/status - one ask can fan out into several orders (one per
    cafeteria), each independently staffed."""
    orders = fetch_all(
        cur,
        """SELECT s.request_fmb_id, s.status, u.description AS cafeteria_name, cl.full_name AS claimed_by_name
             FROM request_fmb_selection s
             JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
        LEFT JOIN unit u ON u.code = s.unit_code
        LEFT JOIN users cl ON cl.user_id = s.claimed_by_user_id
            WHERE f.request_id = %s
         ORDER BY s.request_fmb_selection_id""",
        (request_id,),
    )
    by_ask: dict[int, list[dict]] = {}
    for o in orders:
        by_ask.setdefault(o["request_fmb_id"], []).append(o)
    return by_ask


def _cafeteria_manager_order_rows(cur, bucket: str) -> list[dict]:
    """Rows for a cafeteria manager's OWN cafeteria(s) - a materially different scope from
    _department_task_rows: a manager isn't the head of food_beverage_services, they own specific
    request_fmb_selection orders by unit_code, bucketed by the ORDER's own status rather than a
    request_task's. Without this, a cafeteria manager saw an empty Requests tab despite the
    frontend showing it to them (requestKindsForRole() treats cafeteria-manager as owning 'fmb')."""
    principal = current_principal()
    cafeteria_units = sorted(principal.units_for_role("cafeteria-manager"))
    if not cafeteria_units:
        return []
    orders = fetch_all(
        cur,
        f"""SELECT s.request_fmb_selection_id, s.status, s.quantity, s.menu_item_label, s.notes,
                   s.unit_code, u.description AS cafeteria_name, cl.full_name AS claimed_by_name,
                   f.request_id, f.date, f.serve_time, f.location,
                   r.request_code, r.event_title, r.applicant_name
              FROM request_fmb_selection s
              JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
              JOIN request r ON r.request_id = f.request_id
         LEFT JOIN unit u ON u.code = s.unit_code
         LEFT JOIN users cl ON cl.user_id = s.claimed_by_user_id
             WHERE s.unit_code = ANY(%(cafeteria_units)s)
               AND ({_ORDER_BUCKET_SQL}) = %(bucket)s
          ORDER BY s.request_fmb_selection_id DESC""",
        {"cafeteria_units": cafeteria_units, "bucket": bucket, "order_terminal": list(SEL_TERMINAL)},
    )
    rows: list[dict] = []
    for o in orders:
        initials = "".join(part[0] for part in (o["applicant_name"] or "").split()[:2]).upper()
        schedule_text = f"{o['date']} · {str(o['serve_time'])[:5]}" if o["date"] else ""
        rows.append({
            "proposalId": o["request_id"],
            "proposalCode": o["request_code"],
            "requestTaskId": None,
            "taskStatus": o["status"],
            "taskComment": None,
            "eventTitle": o["event_title"],
            "shortIntroduction": "",
            "goals": "",
            "applicant": o["applicant_name"],
            "applicantEmail": "",
            "applicantInitials": initials,
            "schedule": schedule_text,
            "request": {
                "id": o["request_fmb_selection_id"],
                "department": "fmb",
                "item": o["menu_item_label"],
                "quantity": str(o["quantity"]),
                "schedule": schedule_text,
                "location": o["location"] or "",
                "notes": o["notes"] or "",
            },
            "assignedTo": [o["claimed_by_name"]] if o["claimed_by_name"] else [],
            "progressStatus": None,
            "orders": [{"cafeteriaName": o["cafeteria_name"], "claimedByName": o["claimed_by_name"], "status": o["status"]}],
            "cafeteriaName": o["cafeteria_name"],
        })
    return rows


_REQUEST_SORT_KEYS = {"schedule": "schedule", "event": "eventTitle", "status": "taskStatus"}


@bp.get("/requests")
@require_auth
def list_department_requests():
    """One row per department_review task routed to the caller, across every
    proposal they may see - the Requests hub's Inbox/Ongoing/History tabs.

    ?bucket=inbox|ongoing|history (required) filters both the department-head
    rows (by request_task.status via _TASK_BUCKET_SQL) and, for a cafeteria
    manager, their own orders (by request_fmb_selection.status via
    _ORDER_BUCKET_SQL) - the two are unioned into one response.
    ?requestKind= restricts to one of the caller's own routed kinds; omitted
    returns all of them. Water folds into the F&B task (see request_task's
    docstring / create_department_tasks) - an F&B head's 'waterNormal' rows
    share the same task row as their 'fmb' rows, split apart again here by
    which per-requirement detail table actually has a matching request.

    ?q= substring-matches proposal code/event title/item (case-insensitive).
    ?sort=schedule|event|status (default schedule) with ?order=asc|desc.
    ?page=/?pageSize= paginate the final, filtered, sorted list - all of this
    happens here, server-side, on the whole bucket, never in the client (each
    row is assembled per-item in Python via the enrichment joins above, so
    this filters/sorts the assembled list rather than a raw SQL WHERE/ORDER BY,
    the same approach already used by GET /tasks/my-row-assignments and
    GET /cafeteria-orders).
    """
    bucket = request.args.get("bucket")
    if bucket not in ("inbox", "ongoing", "history"):
        raise BadRequest("bucket must be one of: inbox, ongoing, history.")
    routed_kinds = _routed_request_kinds()
    request_kind = request.args.get("requestKind")
    if request_kind is not None:
        routed_kinds = [request_kind] if request_kind in routed_kinds else []

    with transaction() as cur:
        rows = _department_task_rows(cur, bucket, routed_kinds)
        if request_kind is None or request_kind == "fmb":
            rows += _cafeteria_manager_order_rows(cur, bucket)

    query = request.args.get("q", "").strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in f"{row['proposalCode']} {row['eventTitle']} {row['request']['item']}".lower()
        ]

    sort_key = request.args.get("sort", "schedule")
    sort_field = _REQUEST_SORT_KEYS.get(sort_key)
    if sort_field is None:
        raise BadRequest("sort must be one of: " + ", ".join(_REQUEST_SORT_KEYS) + ".")
    order = request.args.get("order", "asc")
    rows.sort(key=lambda row: str(row[sort_field] or ""), reverse=(order == "desc"))

    limit, offset = pagination()
    total = len(rows)
    page_rows = rows[offset:offset + limit]

    return jsonify(
        {
            "items": page_rows,
            "page": offset // limit + 1,
            "pageSize": limit,
            "total": total,
            "totalPages": max(1, -(-total // limit)),
        }
    )


def _flatten_requests_for_task(cur, request_id: int, requirement_name: str, routed_kinds: list[str]) -> list[dict]:
    """The per-requirement detail rows a department_review task's requirement_name covers.

    Every requirement folds 1:1 EXCEPT 'fmb', whose task also covers
    'waterNormal' - so when the task's own name is 'fmb', this returns BOTH
    the fmb rows (if 'fmb' is one of the caller's routed kinds) and the
    waterNormal rows (if that's routed instead, or as well).
    """
    kinds = [requirement_name]
    if requirement_name == "fmb":
        kinds = [k for k in ("fmb", "waterNormal") if k in routed_kinds]
    all_rows = svc.flatten_requests(cur, request_id)
    return [row for row in all_rows if row["department"] in kinds]


@bp.get("/<int:request_id>")
@require_auth
def get_proposal(request_id: int):
    with transaction() as cur:
        row = _load_visible(cur, request_id)
        projected = svc.project(cur, row)
        projected["tasks"] = wf.tasks_for_request(cur, request_id)
        projected["fmbSelections"] = wf.selections_for_request(cur, request_id)
    return jsonify(projected)


@bp.get("/<int:request_id>/history")
@require_auth
def get_history(request_id: int):
    with transaction() as cur:
        _load_visible(cur, request_id)
        return jsonify(wf.history_for(cur, request_id))


@bp.get("/<int:request_id>/conversations")
@require_auth
def get_conversations(request_id: int):
    """Per-partner resubmission chat: one thread per department, one per
    reviewer-stage authority who has sent this proposal back. Deliberately
    does NOT gate on _load_visible: that predicate is stage-scoped (e.g. a
    HOS/HOD loses "visibility" the moment they approve and the proposal moves
    to department_review), which would cut a reviewer off from their own past
    conversation the instant they act - the opposite of what a chat needs.
    wf.conversations_for is itself the authorization boundary here: it never
    returns a thread the caller wasn't proven (via their own workflow_history
    row or proposal ownership) to be a party to, so loading the bare request
    row first is safe - no proposal CONTENT is exposed by this endpoint,
    only conversation threads the caller already has a right to see."""
    principal = current_principal()
    with transaction() as cur:
        row = wf.load_request(cur, request_id)
        threads = wf.conversations_for(cur, row, principal.user_id)
    return jsonify(threads)


@bp.get("/<int:request_id>/tasks")
@require_auth
def get_tasks(request_id: int):
    with transaction() as cur:
        _load_visible(cur, request_id)
        return jsonify(wf.tasks_for_request(cur, request_id))


# --- Create and edit ------------------------------------------------------
@bp.post("")
@require_internal
def create_proposal():
    """Create and submit in one step - the applicant never sees a bare draft."""
    principal = current_principal()
    payload = body()
    draft_id = payload.pop("draftRequestId", None)

    with transaction() as cur:
        applicant = svc.load_applicant(cur, principal.user_id)
        if draft_id:
            # Submitting an existing draft converts it in place rather than
            # leaving a duplicate behind.
            existing = wf.load_request(cur, int(draft_id))
            if existing["status"] != "draft":
                raise WorkflowError("This proposal is no longer a draft.")
            wf.assert_proposal_owner(cur, existing["request_id"], principal.user_id)
            svc.save_content(cur, existing["request_id"], applicant, payload, draft=False)
            request_id = existing["request_id"]
        else:
            request_id = svc.create(cur, applicant, payload, draft=False)

        wf.submit(cur, request_id)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result), 201


@bp.post("/drafts")
@require_internal
def save_draft():
    """Create or update a draft. Never enters the workflow."""
    principal = current_principal()
    payload = body()
    draft_id = payload.pop("draftRequestId", None)

    with transaction() as cur:
        applicant = svc.load_applicant(cur, principal.user_id)
        if draft_id:
            existing = wf.load_request(cur, int(draft_id))
            if existing["status"] != "draft":
                raise WorkflowError("This proposal is no longer a draft.")
            wf.assert_proposal_owner(cur, existing["request_id"], principal.user_id)
            svc.save_content(cur, existing["request_id"], applicant, payload, draft=True)
            request_id = existing["request_id"]
        else:
            request_id = svc.create(cur, applicant, payload, draft=True)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result), 200 if draft_id else 201


@bp.patch("/<int:request_id>")
@require_internal
def save_edits(request_id: int):
    """Persist edits without advancing the workflow.

    Allowed while a reviewer has sent the proposal back, while a department has
    sent its own task back (the proposal itself stays in department_review), and
    on a draft.
    """
    principal = current_principal()
    payload = body()

    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        wf.assert_proposal_owner(cur, request_id, principal.user_id)

        department_sent_back = proposal["status"] == "department_review" and fetch_one(
            cur,
            "SELECT 1 FROM request_task WHERE request_id = %s AND status = 'resubmitted'",
            (request_id,),
        )
        if proposal["status"] not in ("draft", "resubmission_required") and not department_sent_back:
            raise WorkflowError("Cannot save edits from status " + proposal["status"] + ".")

        applicant = svc.load_applicant(cur, proposal["applicant_user_id"])
        svc.save_content(
            cur, request_id, applicant, payload, draft=proposal["status"] == "draft"
        )
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.delete("/<int:request_id>")
@require_internal
def delete_draft(request_id: int):
    """Drafts only. A submitted proposal must be cancelled so its history survives."""
    principal = current_principal()
    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        if proposal["status"] != "draft":
            raise WorkflowError("Only drafts can be deleted. Cancel a submitted proposal instead.")
        wf.assert_proposal_owner(cur, request_id, principal.user_id)
        svc.delete_draft(cur, request_id)
    return "", 204


# --- Workflow actions -----------------------------------------------------
DECISIONS = ("approve", "reject", "send-back")


@bp.post("/<int:request_id>/decision")
@require_internal
def record_decision(request_id: int):
    """The reviewer's decision at the current single-actor stage.

    One endpoint for all three verbs: they share the same authorisation, the
    same stage lookup and the same audit write, and differ only in outcome.
    """
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in DECISIONS:
        raise WorkflowError("Decision must be one of: " + ", ".join(DECISIONS) + ".")

    comment = str(payload.get("comment") or payload.get("reason") or "")
    with transaction() as cur:
        if decision == "approve":
            wf.approve(cur, request_id, principal)
        elif decision == "reject":
            wf.reject(cur, request_id, principal, comment)
        else:
            wf.send_back(cur, request_id, principal, comment)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.post("/<int:request_id>/resubmission")
@require_internal
def resubmit(request_id: int):
    """Applicant returns work that a reviewer or a department sent back.

    An optional body updates the content in the same transaction, so a
    resubmission can never persist edits and then fail to advance the stage.
    `comment` is the applicant's reply to whichever authority sent it back -
    required, joining the same per-partner conversation as their original
    send-back comment (see history.conversations_for).
    """
    principal = current_principal()
    payload = request.get_json(silent=True) or {}
    comment = str(payload.get("comment") or "").strip()
    if not comment:
        raise WorkflowError("Add a reply so the reviewer knows what changed.")

    with transaction() as cur:
        proposal = wf.load_request(cur, request_id)
        wf.assert_proposal_owner(cur, request_id, principal.user_id)
        content = {k: v for k, v in payload.items() if k != "comment"}
        if content:
            applicant = svc.load_applicant(cur, proposal["applicant_user_id"])
            svc.save_content(cur, request_id, applicant, content, draft=False)
        wf.applicant_resubmit(cur, request_id, principal, comment=comment)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.post("/<int:request_id>/department-tasks/<requirement_name>/resubmission")
@require_internal
def resubmit_department_task(request_id: int, requirement_name: str):
    """Applicant fixes and resends ONE department's request, not the whole proposal.

    A department cannot reject - only send its own task back with a comment (see
    tasks.py's send_task_back) - so this is the applicant's only way to answer
    that, and it must not touch anything outside `requirement_name`'s own rows:
    other departments keep working in parallel, and content already approved
    elsewhere on the proposal (or by a sibling department) must not be silently
    rewritten by an unrelated resubmission. Compare resubmit() above, which is
    correctly whole-proposal because it only fires when a REVIEWER stage sent
    everything back. `comment` is the applicant's reply to this department -
    required, joins the same per-partner conversation as the department's
    original send-back comment (see history.conversations_for).
    """
    principal = current_principal()
    payload = body()
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise WorkflowError("rows must be a list of request rows.")
    comment = str(payload.get("comment") or "").strip()
    if not comment:
        raise WorkflowError("Add a reply so the department knows what changed.")

    with transaction() as cur:
        wf.assert_proposal_owner(cur, request_id, principal.user_id)
        svc.write_single_requirement_rows(cur, request_id, requirement_name, rows)
        wf.applicant_resubmit_task(cur, request_id, requirement_name, principal.user_id, comment=comment)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.post("/<int:request_id>/cancellation")
@require_internal
def cancel(request_id: int):
    principal = current_principal()
    with transaction() as cur:
        wf.cancel(cur, request_id, principal)
        result = svc.project(cur, wf.load_request(cur, request_id))
    return jsonify(result)


@bp.get("/<int:request_id>/cancellation")
@require_auth
def cancellation_window(request_id: int):
    """Whether cancellation is still open, computed by the same authority that
    enforces it - so the button's state and the rule can never disagree."""
    with transaction() as cur:
        _load_visible(cur, request_id)
        principal = current_principal()
        return jsonify(
            {
                "open": wf.is_within_cancellation_window(cur, request_id),
                "isOwner": wf.is_proposal_owner(cur, request_id, principal.user_id),
            }
        )
