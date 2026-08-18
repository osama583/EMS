"""F&B cafeteria orders - the per-selection lifecycle beneath the F&B task.

Once F&B approves the food request it fans the order out into one
request_fmb_selection row per cafeteria the food is split across. Each row then
lives its own life, independent of its siblings:

    pending    F&B created it; the owning Cafeteria Manager decides
    approved   manager accepted -> enters that cafeteria's SHARED staff pool
    preparing  a staff member claimed it out of the pool; it leaves everyone
               else's inbox at that moment (first claim wins)
    fulfilled  the claiming staff member finished it
    resubmitted manager pushed it back to F&B with a comment
    cancelled  F&B dropped this one order

The parent F&B request_task completes only once EVERY selection is terminal.

Note the asymmetry with departments: a Cafeteria Manager's "resubmit" goes back
to F&B, not to the applicant. The applicant is never involved in a cafeteria's
pushback - F&B edits the order and re-sends it.
"""
from __future__ import annotations

from ...db import fetch_all, fetch_one
from ...errors import Forbidden, NotFound, WorkflowError
from . import history
from .authorization import heads_unit, is_cafeteria_manager_of, is_cafeteria_staff_of
from .constants import (
    FMB_REQUIREMENT,
    FMB_UNIT_CODE,
    SEL_APPROVED,
    SEL_CANCELLED,
    SEL_FULFILLED,
    SEL_PENDING,
    SEL_PREPARING,
    SEL_RESUBMITTED,
    SEL_TERMINAL,
    TASK_COMPLETED,
)
from .tasks import check_all_tasks_resolved, find_task


def load_selection(cur, selection_id: int) -> dict:
    row = fetch_one(
        cur,
        "SELECT * FROM request_fmb_selection WHERE request_fmb_selection_id = %s",
        (selection_id,),
    )
    if row is None:
        raise NotFound("Order selection not found.")
    return row


def request_id_for_selection(cur, selection_id: int) -> int:
    row = fetch_one(
        cur,
        """SELECT f.request_id
             FROM request_fmb_selection s
             JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
            WHERE s.request_fmb_selection_id = %s""",
        (selection_id,),
    )
    if row is None:
        raise NotFound("Order selection not found.")
    return row["request_id"]


def selections_for_request(cur, request_id: int) -> list[dict]:
    return fetch_all(
        cur,
        """SELECT s.*, u.description AS cafeteria_name, cl.full_name AS claimed_by_name
             FROM request_fmb_selection s
             JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
        LEFT JOIN unit u ON u.code = s.unit_code
        LEFT JOIN users cl ON cl.user_id = s.claimed_by_user_id
            WHERE f.request_id = %s
         ORDER BY s.request_fmb_selection_id""",
        (request_id,),
    )


def _resolve_menu_item(cur, fmb_option_id: int) -> dict:
    """Freeze the catalog label at order time. request_* rows store the LABEL,
    not just the id, so renaming or deleting a menu item later cannot rewrite
    the history of an order that already went out."""
    row = fetch_one(
        cur,
        "SELECT fmb_option_id, label FROM fmb_options WHERE fmb_option_id = %s AND archived_at IS NULL",
        (fmb_option_id,),
    )
    if row is None:
        raise NotFound("That menu item is no longer available.")
    return row


def create_selection(
    cur,
    request_id: int,
    actor_user_id: int,
    *,
    cafeteria_unit_code: str,
    fmb_option_id: int,
    quantity: int,
    menu_item_label: str | None = None,
    notes: str | None = None,
) -> dict:
    """F&B places one cafeteria order under this proposal's food request."""
    if not heads_unit(cur, actor_user_id, FMB_UNIT_CODE):
        raise Forbidden("Only Food & Beverage Services can place a cafeteria order.")
    if quantity is None or int(quantity) <= 0:
        raise WorkflowError("An order needs a quantity of at least one.")

    fmb_row = fetch_one(
        cur, "SELECT request_fmb_id FROM request_fmb WHERE request_id = %s", (request_id,)
    )
    if fmb_row is None:
        raise NotFound("This proposal has no food request to add an order to.")

    cafeteria = fetch_one(
        cur, "SELECT code FROM unit WHERE code = %s AND is_active", (cafeteria_unit_code,)
    )
    if cafeteria is None:
        raise NotFound("That cafeteria is not available.")

    menu_item = _resolve_menu_item(cur, fmb_option_id)
    cur.execute(
        """INSERT INTO request_fmb_selection
               (request_fmb_id, unit_code, fmb_option_id, menu_item_label, quantity, status, notes)
           VALUES (%s, %s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (
            fmb_row["request_fmb_id"],
            cafeteria_unit_code,
            menu_item["fmb_option_id"],
            menu_item_label or menu_item["label"],
            int(quantity),
            SEL_PENDING,
            notes,
        ),
    )
    selection = dict(cur.fetchone())
    history.record(
        cur,
        request_id,
        action="create-selection",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        new_status=SEL_PENDING,
        comment="Order placed with " + cafeteria_unit_code + ".",
    )
    return selection


def approve_selection(cur, selection_id: int, actor_user_id: int) -> dict:
    """Cafeteria Manager accepts one order; it enters their staff shared pool."""
    selection = load_selection(cur, selection_id)
    if not is_cafeteria_manager_of(cur, actor_user_id, selection["unit_code"]):
        raise Forbidden("You do not manage the cafeteria this order belongs to.")
    if selection["status"] != SEL_PENDING:
        raise WorkflowError("This order is not awaiting your review.")

    cur.execute(
        "UPDATE request_fmb_selection SET status = %s WHERE request_fmb_selection_id = %s",
        (SEL_APPROVED, selection_id),
    )
    request_id = request_id_for_selection(cur, selection_id)
    history.record(
        cur,
        request_id,
        action="approve-selection",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        previous_status=SEL_PENDING,
        new_status=SEL_APPROVED,
    )
    check_fmb_task_resolved(cur, request_id)
    return load_selection(cur, selection_id)


def send_selection_back(cur, selection_id: int, actor_user_id: int, comment: str) -> dict:
    """Cafeteria Manager pushes one order back to F&B.

    Goes to F&B, NOT the applicant, and leaves the parent task and every sibling
    order untouched.
    """
    selection = load_selection(cur, selection_id)
    if not is_cafeteria_manager_of(cur, actor_user_id, selection["unit_code"]):
        raise Forbidden("You do not manage the cafeteria this order belongs to.")
    if selection["status"] != SEL_PENDING:
        raise WorkflowError("This order is not awaiting your review.")
    comment = (comment or "").strip()
    if not comment:
        raise WorkflowError("Explain what needs to change so F&B can fix this order.")

    cur.execute(
        """UPDATE request_fmb_selection SET status = %s, manager_comment = %s
            WHERE request_fmb_selection_id = %s""",
        (SEL_RESUBMITTED, comment, selection_id),
    )
    history.record(
        cur,
        request_id_for_selection(cur, selection_id),
        action="resubmit-selection",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        comment=comment,
        previous_status=SEL_PENDING,
        new_status=SEL_RESUBMITTED,
    )
    return load_selection(cur, selection_id)


def edit_selection(cur, selection_id: int, actor_user_id: int, updates: dict) -> dict:
    """F&B edits a pending or pushed-back order.

    Saving the edit IS the re-send: the order goes straight back to whichever
    cafeteria now owns it - the same manager, or a different one if F&B switched
    cafeterias. There is no separate re-approve step.
    """
    selection = load_selection(cur, selection_id)
    if not heads_unit(cur, actor_user_id, FMB_UNIT_CODE):
        raise Forbidden("Only Food & Beverage Services can edit a cafeteria order.")
    if selection["status"] not in (SEL_PENDING, SEL_RESUBMITTED):
        raise WorkflowError("This order has already been accepted and can no longer be edited.")

    request_id = request_id_for_selection(cur, selection_id)
    previous = selection["status"]
    actor_role = history.primary_role_code(cur, actor_user_id)

    if updates.get("cancel"):
        cur.execute(
            "UPDATE request_fmb_selection SET status = %s WHERE request_fmb_selection_id = %s",
            (SEL_CANCELLED, selection_id),
        )
        history.record(
            cur,
            request_id,
            action="cancel-selection",
            actor_user_id=actor_user_id,
            actor_role=actor_role,
            previous_status=previous,
            new_status=SEL_CANCELLED,
        )
        check_fmb_task_resolved(cur, request_id)
        return load_selection(cur, selection_id)

    columns: dict[str, object] = {}
    if "cafeteriaCode" in updates:
        cafeteria = fetch_one(
            cur, "SELECT code FROM unit WHERE code = %s AND is_active", (updates["cafeteriaCode"],)
        )
        if cafeteria is None:
            raise NotFound("That cafeteria is not available.")
        columns["unit_code"] = updates["cafeteriaCode"]
    if "fmbOptionId" in updates:
        item = _resolve_menu_item(cur, updates["fmbOptionId"])
        columns["fmb_option_id"] = item["fmb_option_id"]
        columns.setdefault("menu_item_label", item["label"])
    if "menuItemLabel" in updates:
        columns["menu_item_label"] = updates["menuItemLabel"]
    if "quantity" in updates:
        if int(updates["quantity"]) <= 0:
            raise WorkflowError("An order needs a quantity of at least one.")
        columns["quantity"] = int(updates["quantity"])
    if "notes" in updates:
        columns["notes"] = updates["notes"]

    # The re-send: back to pending, and the manager's pushback comment is
    # cleared now that it has been acted on.
    columns["status"] = SEL_PENDING
    columns["manager_comment"] = None

    assignments = ", ".join(name + " = %s" for name in columns)
    cur.execute(
        "UPDATE request_fmb_selection SET " + assignments + " WHERE request_fmb_selection_id = %s",
        [*columns.values(), selection_id],
    )
    history.record(
        cur,
        request_id,
        action="edit-selection",
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        previous_status=previous,
        new_status=SEL_PENDING,
    )
    return load_selection(cur, selection_id)


def claim_selection(cur, selection_id: int, staff_user_id: int) -> dict:
    """First cafeteria staff member to claim an approved order owns it.

    The UPDATE is guarded on status = 'approved', so two staff members claiming
    simultaneously cannot both succeed - the second one's rowcount is 0. This is
    the race that a read-then-write would lose.
    """
    selection = load_selection(cur, selection_id)
    if not is_cafeteria_staff_of(cur, staff_user_id, selection["unit_code"]):
        raise Forbidden("You are not assigned to the cafeteria this order belongs to.")

    cur.execute(
        """UPDATE request_fmb_selection
              SET status = %s, claimed_by_user_id = %s
            WHERE request_fmb_selection_id = %s AND status = %s""",
        (SEL_PREPARING, staff_user_id, selection_id, SEL_APPROVED),
    )
    if cur.rowcount == 0:
        raise WorkflowError("This order is no longer available to claim.", code="already_claimed")

    history.record(
        cur,
        request_id_for_selection(cur, selection_id),
        action="claim-selection",
        actor_user_id=staff_user_id,
        actor_role="cafeteria-staff",
        previous_status=SEL_APPROVED,
        new_status=SEL_PREPARING,
    )
    return load_selection(cur, selection_id)


def fulfil_selection(cur, selection_id: int, actor_user_id: int) -> dict:
    selection = load_selection(cur, selection_id)
    if selection["status"] != SEL_PREPARING:
        raise WorkflowError("Claim this order before marking it fulfilled.")
    if selection["claimed_by_user_id"] != actor_user_id:
        raise Forbidden("This order was claimed by another staff member.")

    cur.execute(
        "UPDATE request_fmb_selection SET status = %s WHERE request_fmb_selection_id = %s",
        (SEL_FULFILLED, selection_id),
    )
    request_id = request_id_for_selection(cur, selection_id)
    history.record(
        cur,
        request_id,
        action="fulfil-selection",
        actor_user_id=actor_user_id,
        actor_role="cafeteria-staff",
        previous_status=SEL_PREPARING,
        new_status=SEL_FULFILLED,
    )
    check_fmb_task_resolved(cur, request_id)
    return load_selection(cur, selection_id)


def check_fmb_task_resolved(cur, request_id: int) -> None:
    """Complete the F&B task once every one of its orders is terminal."""
    try:
        task = find_task(cur, request_id, FMB_REQUIREMENT)
    except NotFound:
        # Data inconsistency, not a user error: nothing to resolve. A soft
        # no-op beats crashing the approve/fulfil call that triggered this.
        return

    selections = fetch_all(
        cur,
        """SELECT s.status FROM request_fmb_selection s
             JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
            WHERE f.request_id = %s""",
        (request_id,),
    )
    if not selections or not all(s["status"] in SEL_TERMINAL for s in selections):
        return
    if task["status"] == TASK_COMPLETED:
        return

    cur.execute(
        "UPDATE request_task SET status = %s, resolved_at = now() WHERE request_task_id = %s",
        (TASK_COMPLETED, task["request_task_id"]),
    )
    history.record(
        cur,
        request_id,
        action="complete",
        actor_user_id=None,
        actor_role="system",
        request_task_id=task["request_task_id"],
        requirement_id=task["requirement_id"],
        previous_status=task["status"],
        new_status=TASK_COMPLETED,
    )
    check_all_tasks_resolved(cur, request_id)


def shared_pool_for_staff(cur, staff_user_id: int) -> list[dict]:
    """Unclaimed orders in every cafeteria this staff member belongs to, plus
    the ones they have already claimed."""
    return fetch_all(
        cur,
        """SELECT s.*, u.description AS cafeteria_name, r.request_id, r.request_code, r.event_title
             FROM request_fmb_selection s
             JOIN request_fmb f ON f.request_fmb_id = s.request_fmb_id
             JOIN request r ON r.request_id = f.request_id
        LEFT JOIN unit u ON u.code = s.unit_code
            WHERE s.unit_code IN (
                    SELECT unit_code FROM user_unit_roles
                     WHERE user_id = %s AND role_code = 'cafeteria-staff'
                  )
              AND (s.status = %s OR s.claimed_by_user_id = %s)
         ORDER BY s.request_fmb_selection_id DESC""",
        (staff_user_id, SEL_APPROVED, staff_user_id),
    )
