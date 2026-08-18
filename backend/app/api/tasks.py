"""Department tasks and F&B cafeteria orders - the fulfilment side of the workflow.

    GET   /tasks                          my department inbox (head) or my assignments (staff)
    GET   /tasks/{id}                     one task with its assignments
    POST  /tasks/{id}/decision            approve | send-back   (department head)
    POST  /tasks/{id}/assignments         assign a staff member (department head)
    DELETE /tasks/{id}/assignments/{uid}  unassign
    PATCH /tasks/{id}                     preparing | completed (assigned staff)
    GET   /tasks/{id}/assignable-staff    who may be assigned to this task

    GET   /cafeteria-orders               my cafeteria queue (manager or staff)
    POST  /cafeteria-orders               F&B places an order
    POST  /cafeteria-orders/{id}/decision approve | send-back   (cafeteria manager)
    PATCH /cafeteria-orders/{id}          F&B edits or cancels one order
    POST  /cafeteria-orders/{id}/claim    staff claims from the shared pool
    POST  /cafeteria-orders/{id}/fulfilment staff marks it done

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
from ..services import workflow as wf
from ..services.workflow.constants import FMB_UNIT_CODE
from ._helpers import body, required

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


# --- Cafeteria orders -----------------------------------------------------
@orders_bp.get("")
@require_internal
def list_orders():
    """A manager sees their cafeteria's orders; staff see the unclaimed pool plus
    their own claims. Which one you get follows from your roles."""
    principal = current_principal()
    managed = sorted(principal.units_for_role("cafeteria-manager"))
    with transaction() as cur:
        if managed:
            rows = fetch_all(
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
        else:
            rows = wf.shared_pool_for_staff(cur, principal.user_id)
    return jsonify(rows)


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
    """First staff member to claim owns it; it leaves everyone else's queue."""
    principal = current_principal()
    with transaction() as cur:
        result = wf.claim_selection(cur, selection_id, principal.user_id)
    return jsonify(result)


@orders_bp.post("/<int:selection_id>/fulfilment")
@require_internal
def fulfil_order(selection_id: int):
    principal = current_principal()
    with transaction() as cur:
        result = wf.fulfil_selection(cur, selection_id, principal.user_id)
    return jsonify(result)
