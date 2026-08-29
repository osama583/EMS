"""Department tasks and F&B cafeteria orders - the fulfilment side of the workflow.

    GET   /tasks                          my department inbox (head) or my assignments (staff)
    GET   /tasks/{id}                     one task with its assignments
    POST  /tasks/{id}/decision            approve | send-back   (department head)
    POST  /tasks/{id}/assignments         assign a staff member (department head)
    DELETE /tasks/{id}/assignments/{uid}  unassign
    PATCH /tasks/{id}                     preparing | completed (assigned staff)
    GET   /tasks/{id}/assignable-staff    who may be assigned to this task
    GET   /tasks/my-row-assignments       my row-level assignments, paginated/filtered
    GET   /tasks/my-row-assignments/dates distinct deadline dates, for the calendar dot indicator

    GET   /cafeteria-orders               my cafeteria queue (manager or staff), paginated/filtered
    GET   /cafeteria-orders/dates         distinct serve dates, for the calendar dot indicator
    POST  /cafeteria-orders               F&B places an order
    POST  /cafeteria-orders/{id}/decision approve | send-back   (cafeteria manager)
    PATCH /cafeteria-orders/{id}          F&B edits or cancels one order
    POST  /cafeteria-orders/{id}/claim    staff claims from the shared pool
    POST  /cafeteria-orders/{id}/ready    staff marks it done preparing
    POST  /cafeteria-orders/{id}/fulfilment staff marks it delivered (photo required)

Task decisions mirror the proposal decision endpoint: one route, a `decision`
field, because the two verbs differ only in outcome. Departments have no
`reject` - only the single-actor stages can end a proposal.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, transaction
from ..errors import Forbidden, NotFound, WorkflowError
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ..services import proposals as svc
from ..services import workflow as wf
from ..services.workflow.constants import FMB_UNIT_CODE
from ._helpers import body, paged, pagination, required

bp = Blueprint("tasks", __name__, url_prefix="/tasks")
orders_bp = Blueprint("cafeteria_orders", __name__, url_prefix="/cafeteria-orders")


# --- Department tasks -----------------------------------------------------
@bp.get("")
@require_internal
def list_tasks():
    """Tasks the caller can act on.

    A department head sees everything routed to a unit they head. A staff member
    sees only what they are assigned. Both are computed here, from the caller's
    roles - the client never says which view it wants.
    """
    principal = current_principal()
    headed = sorted(principal.headed_units) or [""]
    flat_roles = []
    if principal.has_role("cfo"):
        flat_roles.append("cfo")
    if FMB_UNIT_CODE in principal.headed_units:
        flat_roles.append("fmb")

    status = request.args.get("status")
    with transaction() as cur:
        rows = fetch_all(
            cur,
            """
            SELECT t.*, er.requirement_name, r.request_code, r.event_title,
                   r.status AS request_status, r.applicant_name,
                   u.description AS assigned_unit_description,
                   (a.staff_user_id IS NOT NULL) AS assigned_to_me
              FROM request_task t
              JOIN request r ON r.request_id = t.request_id
         LEFT JOIN event_requirements er ON er.requirement_id = t.requirement_id
         LEFT JOIN unit u ON u.code = t.assigned_unit_code
         LEFT JOIN task_assignment a
                ON a.request_task_id = t.request_task_id AND a.staff_user_id = %(user_id)s
             WHERE t.assigned_unit_code = ANY(%(headed)s)
                OR t.assigned_role = ANY(%(flat_roles)s)
                OR a.staff_user_id IS NOT NULL
          ORDER BY t.created_at DESC
            """,
            {"user_id": principal.user_id, "headed": headed, "flat_roles": flat_roles or [""]},
        )
    if status:
        wanted = set(status.split(","))
        rows = [r for r in rows if r["status"] in wanted]
    return jsonify(rows)


def _load_actionable_task(cur, task_id: int):
    task = wf.load_task(cur, task_id)
    return task


@bp.get("/<int:task_id>")
@require_internal
def get_task(task_id: int):
    principal = current_principal()
    with transaction() as cur:
        task = _load_actionable_task(cur, task_id)
        assignments = fetch_all(
            cur,
            """SELECT a.staff_user_id, u.full_name, u.email, a.assigned_at
                 FROM task_assignment a JOIN users u ON u.user_id = a.staff_user_id
                WHERE a.request_task_id = %s""",
            (task_id,),
        )
        is_assignee = any(a["staff_user_id"] == principal.user_id for a in assignments)
        if not is_assignee:
            # Raises Forbidden unless the caller heads the routed unit.
            wf.authorization.authorize_department_task(cur, task, principal.user_id)
        task["assignments"] = assignments
    return jsonify(task)


TASK_DECISIONS = ("approve", "send-back")


@bp.post("/<int:task_id>/decision")
@require_internal
def task_decision(task_id: int):
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in TASK_DECISIONS:
        raise WorkflowError(
            "Decision must be one of: " + ", ".join(TASK_DECISIONS)
            + ". Departments cannot reject a proposal outright."
        )

    with transaction() as cur:
        task = wf.load_task(cur, task_id)
        requirement = fetch_one(
            cur,
            "SELECT requirement_name FROM event_requirements WHERE requirement_id = %s",
            (task["requirement_id"],),
        )
        if requirement is None:
            raise NotFound("This task has no requirement to act on.")

        if decision == "approve":
            result = wf.approve_task(
                cur, task["request_id"], requirement["requirement_name"], principal.user_id
            )
        else:
            result = wf.send_task_back(
                cur,
                task["request_id"],
                requirement["requirement_name"],
                principal.user_id,
                str(payload.get("comment") or ""),
            )
    return jsonify(result)


@bp.post("/<int:task_id>/assignments")
@require_internal
def assign(task_id: int):
    principal = current_principal()
    payload = body()
    (staff_user_id,) = required(payload, "staffUserId")
    with transaction() as cur:
        result = wf.assign_staff(cur, task_id, int(staff_user_id), principal.user_id)
    return jsonify(result), 201


@bp.delete("/<int:task_id>/assignments/<int:staff_user_id>")
@require_internal
def unassign(task_id: int, staff_user_id: int):
    principal = current_principal()
    with transaction() as cur:
        wf.unassign_staff(cur, task_id, staff_user_id, principal.user_id)
    return "", 204


@bp.get("/<int:task_id>/assignable-staff")
@require_internal
def assignable_staff(task_id: int):
    """Members of the unit this task routed to, so the picker cannot offer
    someone the assign call would then reject."""
    principal = current_principal()
    with transaction() as cur:
        task = wf.load_task(cur, task_id)
        wf.authorization.authorize_department_task(cur, task, principal.user_id)
        if not task["assigned_unit_code"]:
            return jsonify([])
        rows = fetch_all(
            cur,
            """SELECT DISTINCT u.user_id, u.full_name, u.email, uur.role_code
                 FROM user_unit_roles uur
                 JOIN users u ON u.user_id = uur.user_id
                WHERE uur.unit_code = %s AND u.is_active AND u.archived_at IS NULL
             ORDER BY u.full_name""",
            (task["assigned_unit_code"],),
        )
    return jsonify(rows)


@bp.patch("/<int:task_id>")
@require_internal
def update_status(task_id: int):
    """Assigned staff progress their own task."""
    principal = current_principal()
    payload = body()
    (status,) = required(payload, "status")
    with transaction() as cur:
        result = wf.update_task_status(cur, task_id, str(status), principal.user_id)
    return jsonify(result)


# --- Row-level assignment ---------------------------------------------------
# Logistics/Transportation/Photography/Sound & Light/Campus Tour route staff per REQUESTED ROW, not
# per whole department task - see workflow/tasks.py's row-assignment functions and migration 012's
# request_row_assignment.

@bp.get("/<int:task_id>/rows/<requirement_name>/assignments")
@require_internal
def row_assignments(task_id: int, requirement_name: str):
    """Every row's current assignee list for this task - the manager's picker
    needs this to show who's already assigned to each row, and the approve
    gate needs it to know whether every row is staffed."""
    principal = current_principal()
    with transaction() as cur:
        task = wf.load_task(cur, task_id)
        wf.authorization.authorize_department_task(cur, task, principal.user_id)
        assignments = wf.row_assignments_for_task(cur, task_id)
        fully_staffed = wf.rows_fully_staffed(cur, task_id, requirement_name)
    return jsonify({"assignments": assignments, "fullyStaffed": fully_staffed})


@bp.post("/<int:task_id>/rows/<requirement_name>/<int:row_id>/assignments")
@require_internal
def assign_row(task_id: int, requirement_name: str, row_id: int):
    principal = current_principal()
    payload = body()
    (staff_user_id,) = required(payload, "staffUserId")
    with transaction() as cur:
        result = wf.assign_to_row(cur, task_id, requirement_name, row_id, int(staff_user_id), principal.user_id)
    return jsonify(result), 201


@bp.delete("/<int:task_id>/rows/<requirement_name>/<int:row_id>/assignments/<int:staff_user_id>")
@require_internal
def unassign_row(task_id: int, requirement_name: str, row_id: int, staff_user_id: int):
    principal = current_principal()
    with transaction() as cur:
        wf.unassign_from_row(cur, task_id, requirement_name, row_id, staff_user_id, principal.user_id)
    return "", 204


@bp.patch("/row-assignments/<int:row_assignment_id>")
@require_internal
def update_row_assignment_status(row_assignment_id: int):
    """The assigned staff member progresses their own row: assigned -> preparing -> completed."""
    principal = current_principal()
    payload = body()
    (status,) = required(payload, "status")
    with transaction() as cur:
        result = wf.update_row_status(cur, row_assignment_id, str(status), principal.user_id)
    return jsonify(result)


_CLOSED_ROW_STATUSES = ("completed",)
_ROW_SORT_KEYS = {"schedule": "deadline", "event": "event_title", "status": "status"}


def _enriched_row_assignments(cur, staff_user_id: int) -> list[dict]:
    """Every row assignment for one staff member, enriched with each row's own
    display fields (item/quantity/schedule/location/deadline) from
    proposals.flatten_requests() - the same per-row projection the manager's
    own department view reads. One proposal can back several assignments, so
    it's fetched once per distinct proposal rather than once per assignment.
    Also attaches `partners`: the display names of every OTHER staff member
    sharing that same row (see migration 012 - a row can have several
    assignees, e.g. two Logistics staff on one big chairs/tables setup), so a
    staff member knows who else to coordinate with without opening the task.
    Co-assignees are batched per distinct request_task_id, not per row, so
    this stays one extra query per task on the page rather than one per row.
    Shared by list_my_row_assignments (the paginated list) and
    my_row_assignment_dates (the calendar's dot indicator) so both read
    exactly the same enrichment logic.
    """
    assignments = wf.my_row_assignments(cur, staff_user_id)
    rows_by_request: dict[int, list[dict]] = {}
    partners_by_task: dict[int, dict[int, list[dict]]] = {}
    enriched = []
    for assignment in assignments:
        request_id = assignment["request_id"]
        if request_id not in rows_by_request:
            rows_by_request[request_id] = svc.flatten_requests(cur, request_id)
        detail = next(
            (
                row for row in rows_by_request[request_id]
                if row["department"] == assignment["requirement_name"] and row["id"] == assignment["row_id"]
            ),
            None,
        )

        task_id = assignment["request_task_id"]
        if task_id not in partners_by_task:
            by_row: dict[int, list[dict]] = {}
            for co_assignee in wf.co_assignees_for_task(cur, task_id):
                by_row.setdefault(co_assignee["row_id"], []).append(co_assignee)
            partners_by_task[task_id] = by_row
        partners = [
            co_assignee["staff_name"]
            for co_assignee in partners_by_task[task_id].get(assignment["row_id"], [])
            if co_assignee["staff_user_id"] != staff_user_id
        ]

        enriched.append({
            **assignment,
            "item": detail["item"] if detail else "",
            "quantity": detail["quantity"] if detail else "",
            "schedule": detail["schedule"] if detail else "",
            "location": detail["location"] if detail else "",
            "notes": detail["notes"] if detail else "",
            "deadline": detail["deadline"] if detail else "",
            "partners": partners,
        })
    return enriched


@bp.get("/my-row-assignments")
@require_internal
def list_my_row_assignments():
    """Every row assignment for the caller - backs the staff-facing My Tasks page.

    Filtering/sorting/pagination all happen here, server-side, on the enriched
    result - never in the client. ?mode=active|history splits on status the
    same way the page's two tabs do (CLOSED_ROW_STATUSES = completed);
    ?status= narrows further within that (assigned/preparing, or completed for
    history); ?q= substring-matches proposal id/event title/item/location;
    ?dateStart=/?dateEnd= (YYYY-MM-DD) filter on the row's own deadline day,
    inclusive - a single ?dateStart with no ?dateEnd means "that day only";
    ?sort=schedule|event|status (default schedule) with ?order=asc|desc.
    """
    principal = current_principal()
    with transaction() as cur:
        enriched = _enriched_row_assignments(cur, principal.user_id)

    mode = request.args.get("mode", "active")
    closed = lambda row: row["status"] in _CLOSED_ROW_STATUSES
    enriched = [row for row in enriched if closed(row) == (mode == "history")]

    status = request.args.get("status")
    if status:
        enriched = [row for row in enriched if row["status"] == status]

    query = request.args.get("q", "").strip().lower()
    if query:
        enriched = [
            row for row in enriched
            if query in f"{row['request_code']} {row['event_title']} {row['item']} {row['location']}".lower()
        ]

    date_start = request.args.get("dateStart")
    date_end = request.args.get("dateEnd") or date_start
    if date_start:
        enriched = [row for row in enriched if date_start <= (row["deadline"] or "")[:10] <= date_end]

    sort_key = request.args.get("sort", "schedule")
    sort_field = _ROW_SORT_KEYS.get(sort_key)
    if sort_field is None:
        raise WorkflowError("sort must be one of: " + ", ".join(_ROW_SORT_KEYS) + ".")
    order = request.args.get("order", "asc")
    enriched.sort(key=lambda row: row[sort_field] or "", reverse=(order == "desc"))

    limit, offset = pagination()
    total = len(enriched)
    page_items = enriched[offset:offset + limit]
    return jsonify(paged(page_items, total))


@bp.get("/my-row-assignments/dates")
@require_internal
def my_row_assignment_dates():
    """Distinct deadline days (YYYY-MM-DD) across the caller's row assignments,
    for the My Tasks calendar's dot indicator - deliberately NOT paginated or
    filtered by the current page's status/search/date-range, so the indicator
    reflects every day that has a task regardless of what's currently showing.
    ?mode=active|history matches the list endpoint's split (each tab's
    calendar only lights up days relevant to that tab).
    """
    principal = current_principal()
    with transaction() as cur:
        enriched = _enriched_row_assignments(cur, principal.user_id)

    mode = request.args.get("mode", "active")
    closed = lambda row: row["status"] in _CLOSED_ROW_STATUSES
    enriched = [row for row in enriched if closed(row) == (mode == "history")]

    dates = sorted({row["deadline"][:10] for row in enriched if row["deadline"]})
    return jsonify(dates)


_CLOSED_ORDER_STATUSES = ("fulfilled", "cancelled")
_ORDER_SORT_KEYS = {"schedule": "serve_date", "event": "event_title", "status": "status"}


def _orders_for_caller(cur, principal) -> list[dict]:
    """A manager sees their cafeteria's orders; staff see the unclaimed pool
    plus their own claims. Which one you get follows from your roles. Shared
    by list_orders (the paginated list) and my_order_dates (the calendar's
    dot indicator)."""
    managed = sorted(principal.units_for_role("cafeteria-manager"))
    if managed:
        return fetch_all(
            cur,
            """SELECT s.*, u.description AS cafeteria_name, r.request_id,
                      r.request_code, r.event_title, f.date AS serve_date, f.serve_time
                 FROM request_fmb_selection s
                 JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
                 JOIN request r ON r.request_id = f.request_id
            LEFT JOIN unit u ON u.code = s.unit_code
                WHERE s.unit_code = ANY(%s)
             ORDER BY s.request_fmb_selection_id DESC""",
            (managed,),
        )
    return wf.shared_pool_for_staff(cur, principal.user_id)


# --- Cafeteria orders -----------------------------------------------------
@orders_bp.get("")
@require_internal
def list_orders():
    """The caller's cafeteria orders, filtered/sorted/paginated server-side -
    never in the client. Same contract as GET /tasks/my-row-assignments (see
    that route's docstring): ?mode=active|history, ?status=, ?q=,
    ?dateStart=/?dateEnd=, ?sort=schedule|event|status, ?order=, ?page=,
    ?pageSize=.
    """
    principal = current_principal()
    with transaction() as cur:
        rows = _orders_for_caller(cur, principal)

    mode = request.args.get("mode", "active")
    closed = lambda row: row["status"] in _CLOSED_ORDER_STATUSES
    rows = [row for row in rows if closed(row) == (mode == "history")]

    status = request.args.get("status")
    if status:
        rows = [row for row in rows if row["status"] == status]

    query = request.args.get("q", "").strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in f"{row['request_code']} {row['event_title']} {row['menu_item_label']}".lower()
        ]

    date_start = request.args.get("dateStart")
    date_end = request.args.get("dateEnd") or date_start
    if date_start:
        rows = [row for row in rows if date_start <= str(row["serve_date"])[:10] <= date_end]

    sort_key = request.args.get("sort", "schedule")
    sort_field = _ORDER_SORT_KEYS.get(sort_key)
    if sort_field is None:
        raise WorkflowError("sort must be one of: " + ", ".join(_ORDER_SORT_KEYS) + ".")
    order = request.args.get("order", "asc")
    rows.sort(key=lambda row: str(row[sort_field] or ""), reverse=(order == "desc"))

    limit, offset = pagination()
    total = len(rows)
    return jsonify(paged(rows[offset:offset + limit], total))


@orders_bp.get("/dates")
@require_internal
def my_order_dates():
    """Distinct serve days (YYYY-MM-DD) across the caller's orders, for the
    Cafeteria queue's calendar dot indicator - not paginated or filtered by
    the current page's status/search/date-range. ?mode=active|history matches
    the list endpoint's split."""
    principal = current_principal()
    with transaction() as cur:
        rows = _orders_for_caller(cur, principal)

    mode = request.args.get("mode", "active")
    closed = lambda row: row["status"] in _CLOSED_ORDER_STATUSES
    rows = [row for row in rows if closed(row) == (mode == "history")]

    dates = sorted({str(row["serve_date"])[:10] for row in rows if row["serve_date"]})
    return jsonify(dates)


@orders_bp.post("")
@require_internal
def create_order():
    """F&B fans an approved food request out into one order per cafeteria."""
    principal = current_principal()
    payload = body()
    request_id, cafeteria_code, option_id, quantity = required(
        payload, "requestId", "cafeteriaCode", "fmbOptionId", "quantity"
    )
    with transaction() as cur:
        result = wf.create_selection(
            cur,
            int(request_id),
            principal.user_id,
            cafeteria_unit_code=str(cafeteria_code),
            fmb_option_id=int(option_id),
            quantity=int(quantity),
            menu_item_label=payload.get("menuItemLabel"),
            notes=payload.get("notes"),
        )
    return jsonify(result), 201


ORDER_DECISIONS = ("approve", "send-back")


@orders_bp.post("/<int:selection_id>/decision")
@require_internal
def order_decision(selection_id: int):
    """Cafeteria Manager accepts one order or pushes it back to F&B.

    Note the asymmetry with departments: send-back here goes to F&B, not to the
    applicant. The applicant is never involved in a cafeteria's pushback.
    """
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in ORDER_DECISIONS:
        raise WorkflowError("Decision must be one of: " + ", ".join(ORDER_DECISIONS) + ".")

    with transaction() as cur:
        if decision == "approve":
            result = wf.approve_selection(cur, selection_id, principal.user_id)
        else:
            result = wf.send_selection_back(
                cur, selection_id, principal.user_id, str(payload.get("comment") or "")
            )
    return jsonify(result)


@orders_bp.patch("/<int:selection_id>")
@require_internal
def edit_order(selection_id: int):
    """F&B edits or cancels one order. Saving the edit re-sends it."""
    principal = current_principal()
    payload = body()
    with transaction() as cur:
        result = wf.edit_selection(cur, selection_id, principal.user_id, payload)
    return jsonify(result)


@orders_bp.post("/<int:selection_id>/claim")
@require_internal
def claim_order(selection_id: int):
    """First staff member to claim owns it; it leaves everyone else's queue.
    Staff-facing UI calls this "Start Preparing"."""
    principal = current_principal()
    with transaction() as cur:
        result = wf.claim_selection(cur, selection_id, principal.user_id)
    return jsonify(result)


@orders_bp.post("/<int:selection_id>/ready")
@require_internal
def ready_order(selection_id: int):
    """Claimant finishes preparing. Staff-facing UI calls this "Done Preparing"."""
    principal = current_principal()
    with transaction() as cur:
        result = wf.mark_selection_ready(cur, selection_id, principal.user_id)
    return jsonify(result)


@orders_bp.post("/<int:selection_id>/fulfilment")
@require_internal
def fulfil_order(selection_id: int):
    """Claimant confirms delivery. Staff-facing UI calls this "Delivered" -
    requires a proof-of-delivery photo (see uploads.py's POST /uploads)."""
    principal = current_principal()
    payload = body()
    with transaction() as cur:
        result = wf.fulfil_selection(
            cur, selection_id, principal.user_id, str(payload.get("deliveryPhotoUrl") or "")
        )
    return jsonify(result)
