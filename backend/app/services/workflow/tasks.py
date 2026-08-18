"""Department review: parallel, independent tasks - one per selected requirement.

Departments differ from the single-actor stages in one important way: they
CANNOT reject. Only hos_hod_review / fmb_review / cfo_review can end a proposal
outright. A department's only pushback is send-back-with-comment, and that
affects only its own task. Sibling departments keep working, which is why
request.status stays department_review even while one task sits 'resubmitted'.

Lifecycle of one task:
    pending -> approved (manager approves + assigns staff)
            -> preparing (assigned staff starts)
            -> completed (assigned staff finishes)
    or      -> resubmitted (manager sends back) -> pending (applicant resubmits)

When every task reaches a terminal state the whole proposal auto-completes.
"""
from __future__ import annotations

from ...db import fetch_all, fetch_one
from ...errors import NotFound, WorkflowError
from . import history
from .authorization import authorize_department_task, heads_unit
from .constants import (
    COMPLETED_APPROVED,
    FLAT_ROLE_FOR_REQUIREMENT,
    FMB_REQUIREMENT,
    NON_WORKFLOW_REQUIREMENTS,
    TASK_APPROVED,
    TASK_CANCELLED,
    TASK_COMPLETED,
    TASK_TERMINAL,
    UNIT_CODE_FOR_REQUIREMENT,
    WATER_REQUIREMENT,
)


def _requirement_by_name(cur, name: str) -> dict:
    row = fetch_one(cur, "SELECT * FROM event_requirements WHERE requirement_name = %s", (name,))
    if row is None:
        raise NotFound("Event requirement '" + name + "' is not configured.")
    return row


def create_department_tasks(cur, request_id: int) -> list[dict]:
    """Create one task per DISTINCT selected requirement, the moment department review opens.

    Two foldings apply. Mineral water never gets its own task - it merges into
    the F&B task, because F&B reviews food and water together. Funding/Purchase
    is dropped entirely: it is recorded for the record but never routed.
    """
    selected = fetch_all(
        cur,
        """SELECT DISTINCT er.requirement_name
             FROM application_requirements ar
             JOIN event_requirements er ON er.requirement_id = ar.requirement_id
            WHERE ar.request_id = %s""",
        (request_id,),
    )
    names = {row["requirement_name"] for row in selected}
    # Water folds into F&B. Done before the non-workflow filter so a water-only
    # proposal still produces exactly one F&B task.
    folded = {FMB_REQUIREMENT if name == WATER_REQUIREMENT else name for name in names}
    task_requirements = sorted(folded - NON_WORKFLOW_REQUIREMENTS)

    created: list[dict] = []
    for name in task_requirements:
        requirement = _requirement_by_name(cur, name)
        # chk_task_routing: exactly one of these is set, never both.
        unit_code = UNIT_CODE_FOR_REQUIREMENT.get(name)
        role = FLAT_ROLE_FOR_REQUIREMENT.get(name)
        if not unit_code and not role:
            # A requirement with no routing would create an unactionable task
            # that blocks completion forever. Skip it rather than deadlock.
            continue
        cur.execute(
            """INSERT INTO request_task
                   (request_id, requirement_id, stage_code, sequence_no,
                    assigned_unit_code, assigned_role, assignment_mode, status)
               VALUES (%s, %s, 'department_review', 1, %s, %s, %s, 'pending')
               RETURNING *""",
            (
                request_id,
                requirement["requirement_id"],
                unit_code,
                role,
                "shared_pool" if name == FMB_REQUIREMENT else "assigned",
            ),
        )
        task = dict(cur.fetchone())
        created.append(task)
        history.record(
            cur,
            request_id,
            action="task-created",
            actor_user_id=None,
            actor_role="system",
            request_task_id=task["request_task_id"],
            requirement_id=requirement["requirement_id"],
            new_status="pending",
        )

    if not created:
        # Nothing left to fulfil (e.g. Funding/Purchase alone). Complete now,
        # or the proposal would sit in department_review with no actor able to
        # move it - all_tasks_resolved() requires at least one task.
        _complete_request(cur, request_id, "No department fulfilment was required.")
    return created


def _complete_request(cur, request_id: int, comment: str | None = None) -> None:
    row = fetch_one(cur, "SELECT status FROM request WHERE request_id = %s", (request_id,))
    if row is None or row["status"] == COMPLETED_APPROVED:
        return
    cur.execute(
        "UPDATE request SET status = %s, updated_at = now() WHERE request_id = %s",
        (COMPLETED_APPROVED, request_id),
    )
    history.record(
        cur,
        request_id,
        action="auto-complete",
        actor_user_id=None,
        actor_role="system",
        comment=comment,
        previous_status=row["status"],
        new_status=COMPLETED_APPROVED,
    )


def check_all_tasks_resolved(cur, request_id: int) -> None:
    """Auto-complete the proposal once every department task is terminal."""
    tasks = fetch_all(
        cur,
        "SELECT status FROM request_task WHERE request_id = %s AND stage_code = 'department_review'",
        (request_id,),
    )
    if tasks and all(t["status"] in TASK_TERMINAL for t in tasks):
        _complete_request(cur, request_id)


def find_task(cur, request_id: int, requirement_name: str) -> dict:
    row = fetch_one(
        cur,
        """SELECT t.* FROM request_task t
             JOIN event_requirements er ON er.requirement_id = t.requirement_id
            WHERE t.request_id = %s AND er.requirement_name = %s
              AND t.stage_code = 'department_review'""",
        (request_id, requirement_name),
    )
    if row is None:
        raise NotFound("Department task not found.")
    return row


def load_task(cur, task_id: int) -> dict:
    row = fetch_one(cur, "SELECT * FROM request_task WHERE request_task_id = %s", (task_id,))
    if row is None:
        raise NotFound("Task not found.")
    return row


def approve_task(cur, request_id: int, requirement_name: str, actor_user_id: int) -> dict:
    """Department manager approves their task.

    For every department except F&B this records the approval; the task
    completes when assigned staff finish it. F&B is different: approval means
    "the food request is sound", and the task stays open while cafeteria orders
    are created and fulfilled - unless there is no food at all (a water-only
    request), where the approval IS the fulfilment.
    """
    task = find_task(cur, request_id, requirement_name)
    authorize_department_task(cur, task, actor_user_id)
    if task["status"] in TASK_TERMINAL:
        raise WorkflowError("This task is already " + task["status"] + ".")

    previous = task["status"]
    cur.execute(
        """UPDATE request_task SET status = %s, resolved_at = now(), resolved_by_user_id = %s
            WHERE request_task_id = %s""",
        (TASK_APPROVED, actor_user_id, task["request_task_id"]),
    )
    history.record(
        cur,
        request_id,
        action="approve",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        request_task_id=task["request_task_id"],
        requirement_id=task["requirement_id"],
        previous_status=previous,
        new_status=TASK_APPROVED,
    )

    if requirement_name == FMB_REQUIREMENT:
        has_food = fetch_one(
            cur, "SELECT 1 FROM request_fmb WHERE request_id = %s", (request_id,)
        )
        if not has_food:
            cur.execute(
                "UPDATE request_task SET status = %s WHERE request_task_id = %s",
                (TASK_COMPLETED, task["request_task_id"]),
            )
            history.record(
                cur,
                request_id,
                action="complete",
                actor_user_id=actor_user_id,
                actor_role=history.primary_role_code(cur, actor_user_id),
                request_task_id=task["request_task_id"],
                requirement_id=task["requirement_id"],
                previous_status=TASK_APPROVED,
                new_status=TASK_COMPLETED,
            )
            check_all_tasks_resolved(cur, request_id)

    return load_task(cur, task["request_task_id"])


def send_task_back(cur, request_id: int, requirement_name: str, actor_user_id: int, comment: str) -> dict:
    """Department pushes back to the applicant. Touches nothing else.

    Deliberately does NOT change request.status or any sibling task: parallel
    independence means other departments carry on while this one waits.
    """
    task = find_task(cur, request_id, requirement_name)
    authorize_department_task(cur, task, actor_user_id)
    comment = (comment or "").strip()
    if not comment:
        # A department cannot reject, so this comment is the entire message to
        # the applicant. An empty one leaves them with nothing to act on.
        raise WorkflowError("Explain what needs to change so the applicant can fix it.")
    if task["status"] in TASK_TERMINAL:
        raise WorkflowError("This task is already " + task["status"] + ".")

    previous = task["status"]
    cur.execute(
        "UPDATE request_task SET status = 'resubmitted', comment = %s WHERE request_task_id = %s",
        (comment, task["request_task_id"]),
    )
    history.record(
        cur,
        request_id,
        action="resubmit",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        request_task_id=task["request_task_id"],
        requirement_id=task["requirement_id"],
        comment=comment,
        previous_status=previous,
        new_status="resubmitted",
    )
    return load_task(cur, task["request_task_id"])


def assign_staff(cur, task_id: int, staff_user_id: int, assigned_by_user_id: int) -> dict:
    """Assign a team member to a task. Only the routed unit's head may do this,
    and only to someone who actually belongs to that unit."""
    task = load_task(cur, task_id)
    authorize_department_task(cur, task, assigned_by_user_id)

    if task["assigned_unit_code"]:
        belongs = fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND unit_code = %s",
            (staff_user_id, task["assigned_unit_code"]),
        )
        if not belongs:
            raise WorkflowError("That team member does not belong to this department.")

    already = fetch_one(
        cur,
        "SELECT 1 FROM task_assignment WHERE request_task_id = %s AND staff_user_id = %s",
        (task_id, staff_user_id),
    )
    if already:
        raise WorkflowError("That team member is already assigned to this task.")

    cur.execute(
        """INSERT INTO task_assignment (request_task_id, staff_user_id, assigned_by_user_id)
           VALUES (%s, %s, %s)""",
        (task_id, staff_user_id, assigned_by_user_id),
    )
    previous = task["status"]
    cur.execute(
        """UPDATE request_task SET status = %s, resolved_at = now(), resolved_by_user_id = %s
            WHERE request_task_id = %s""",
        (TASK_APPROVED, assigned_by_user_id, task_id),
    )
    history.record(
        cur,
        task["request_id"],
        action="assign",
        actor_user_id=assigned_by_user_id,
        actor_role=history.primary_role_code(cur, assigned_by_user_id),
        request_task_id=task_id,
        requirement_id=task["requirement_id"],
        previous_status=previous,
        new_status=TASK_APPROVED,
    )
    return load_task(cur, task_id)


def unassign_staff(cur, task_id: int, staff_user_id: int, actor_user_id: int) -> dict:
    task = load_task(cur, task_id)
    authorize_department_task(cur, task, actor_user_id)
    cur.execute(
        "DELETE FROM task_assignment WHERE request_task_id = %s AND staff_user_id = %s",
        (task_id, staff_user_id),
    )
    if cur.rowcount == 0:
        raise NotFound("That team member is not assigned to this task.")
    history.record(
        cur,
        task["request_id"],
        action="unassign",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        request_task_id=task_id,
        requirement_id=task["requirement_id"],
    )
    return load_task(cur, task_id)


def update_task_status(cur, task_id: int, status: str, actor_user_id: int) -> dict:
    """Assigned staff progress their own task: approved -> preparing -> completed."""
    task = load_task(cur, task_id)
    if status not in ("preparing", "completed"):
        raise WorkflowError("Staff can only set preparing or completed.")

    assigned = fetch_one(
        cur,
        "SELECT 1 FROM task_assignment WHERE request_task_id = %s AND staff_user_id = %s",
        (task_id, actor_user_id),
    )
    if not assigned:
        # The UI hides other people's tasks, but this is the gate that enforces it.
        raise WorkflowError("This task is not assigned to you.", code="forbidden")

    if task["status"] == TASK_CANCELLED:
        raise WorkflowError("This task was cancelled and can no longer be updated.")
    if task["status"] == TASK_COMPLETED:
        raise WorkflowError("This task is already completed.")
    if status == "preparing" and task["status"] != TASK_APPROVED:
        raise WorkflowError("Only a newly assigned task can be moved to preparing.")

    previous = task["status"]
    if status == TASK_COMPLETED:
        cur.execute(
            "UPDATE request_task SET status = %s, resolved_at = now() WHERE request_task_id = %s",
            (status, task_id),
        )
    else:
        cur.execute("UPDATE request_task SET status = %s WHERE request_task_id = %s", (status, task_id))

    history.record(
        cur,
        task["request_id"],
        action=status,
        actor_user_id=actor_user_id,
        actor_role="staff",
        request_task_id=task_id,
        requirement_id=task["requirement_id"],
        previous_status=previous,
        new_status=status,
    )
    if status == TASK_COMPLETED:
        check_all_tasks_resolved(cur, task["request_id"])
    return load_task(cur, task_id)


def tasks_for_request(cur, request_id: int) -> list[dict]:
    return fetch_all(
        cur,
        """SELECT t.*, er.requirement_name, u.description AS assigned_unit_description
             FROM request_task t
        LEFT JOIN event_requirements er ON er.requirement_id = t.requirement_id
        LEFT JOIN unit u ON u.code = t.assigned_unit_code
            WHERE t.request_id = %s
         ORDER BY t.request_task_id""",
        (request_id,),
    )


def inbox_for(cur, user_id: int, unit_codes: list[str], flat_roles: list[str]) -> list[dict]:
    """Tasks routed to any unit this user heads, or to a flat role they hold."""
    return fetch_all(
        cur,
        """SELECT t.*, er.requirement_name, r.request_code, r.event_title, r.status AS request_status
             FROM request_task t
             JOIN request r ON r.request_id = t.request_id
        LEFT JOIN event_requirements er ON er.requirement_id = t.requirement_id
            WHERE (t.assigned_unit_code = ANY(%s) OR t.assigned_role = ANY(%s))
         ORDER BY t.created_at DESC""",
        (unit_codes or [""], flat_roles or [""]),
    )
