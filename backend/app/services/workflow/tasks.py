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
    MAX_ASSIGNEES_PER_ROW,
    NON_WORKFLOW_REQUIREMENTS,
    ROW_ASSIGNABLE_REQUIREMENTS,
    TABLE_FOR_REQUIREMENT,
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


def applicant_resubmit_task(
    cur, request_id: int, requirement_name: str, actor_user_id: int, comment: str | None = None
) -> dict:
    """The applicant fixes and resends ONE department's task, not the whole proposal.

    Mirrors stages.applicant_resubmit's Case 2, scoped to a single requirement:
    resets only that task to 'pending' (clearing its comment). Sibling tasks -
    including ones from OTHER departments still sitting at 'resubmitted' - are
    left exactly as they are; each department's send-back is answered
    independently, on its own schedule, not as a single "fix everything and
    resend" action. `comment` is the applicant's reply to this department,
    recorded so it joins the same per-partner conversation as the department's
    original send_task_back comment (see history.conversations_for).
    """
    task = find_task(cur, request_id, requirement_name)
    if task["status"] != "resubmitted":
        raise WorkflowError("This task was not sent back for changes.")
    cur.execute(
        "UPDATE request_task SET status = 'pending', comment = NULL WHERE request_task_id = %s",
        (task["request_task_id"],),
    )
    history.record(
        cur,
        request_id,
        action="applicant-resubmit",
        actor_user_id=actor_user_id,
        actor_role="applicant",
        request_task_id=task["request_task_id"],
        requirement_id=task["requirement_id"],
        comment=comment,
        previous_status="resubmitted",
        new_status="pending",
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


# --- Row-level assignment ---------------------------------------------------
# Logistics/Transportation/Photography/Sound & Light/Campus Tour: a manager assigns staff to a
# SPECIFIC requested row, not the whole department task - see migration 012's request_row_assignment
# and constants.ROW_ASSIGNABLE_ REQUIREMENTS/MAX_ASSIGNEES_PER_ROW.

def _assert_row_belongs_to_task(cur, task: dict, requirement_name: str, row_id: int) -> None:
    if requirement_name not in ROW_ASSIGNABLE_REQUIREMENTS:
        raise WorkflowError(f"'{requirement_name}' does not support row-level assignment.")
    table, pk_column = TABLE_FOR_REQUIREMENT[requirement_name]
    row = fetch_one(cur, f"SELECT request_id FROM {table} WHERE {pk_column} = %s", (row_id,))
    if row is None or row["request_id"] != task["request_id"]:
        raise NotFound("That request row was not found on this proposal.")


def row_assignments_for_task(cur, task_id: int) -> list[dict]:
    """Every row's current assignee list for one task, grouped by row_id -
    what the manager's per-row picker and the read-only summary both need."""
    return fetch_all(
        cur,
        """SELECT a.request_row_assignment_id, a.row_id, a.staff_user_id, a.status,
                  a.assigned_at, a.resolved_at, u.full_name, u.email
             FROM request_row_assignment a
             JOIN users u ON u.user_id = a.staff_user_id
            WHERE a.request_task_id = %s
         ORDER BY a.row_id, a.assigned_at""",
        (task_id,),
    )


def assign_to_row(
    cur, task_id: int, requirement_name: str, row_id: int, staff_user_id: int, assigned_by_user_id: int
) -> dict:
    """Assign one staff member to one specific requested row.

    Approving the task and assigning its first row happen together from the
    caller's point of view (see api/tasks.py's assign_row) - the task itself
    moves to 'approved' the moment its FIRST row gets an assignee, the same
    "assigning IS approving" rule the old whole-task assign_staff used, just
    triggered per-task instead of per-call.
    """
    task = load_task(cur, task_id)
    authorize_department_task(cur, task, assigned_by_user_id)
    _assert_row_belongs_to_task(cur, task, requirement_name, row_id)

    if task["assigned_unit_code"]:
        belongs = fetch_one(
            cur,
            "SELECT 1 FROM user_unit_roles WHERE user_id = %s AND unit_code = %s",
            (staff_user_id, task["assigned_unit_code"]),
        )
        if not belongs:
            raise WorkflowError("That team member does not belong to this department.")

    limit = MAX_ASSIGNEES_PER_ROW.get(requirement_name)
    if limit is not None:
        current_count = fetch_one(
            cur,
            "SELECT count(*) AS c FROM request_row_assignment WHERE requirement_name = %s AND row_id = %s",
            (requirement_name, row_id),
        )["c"]
        if current_count >= limit:
            noun = "person" if limit == 1 else "people"
            raise WorkflowError(f"This request can only have {limit} {noun} assigned.")

    already = fetch_one(
        cur,
        "SELECT 1 FROM request_row_assignment WHERE requirement_name = %s AND row_id = %s AND staff_user_id = %s",
        (requirement_name, row_id, staff_user_id),
    )
    if already:
        raise WorkflowError("That team member is already assigned to this request.")

    cur.execute(
        """INSERT INTO request_row_assignment
               (request_task_id, requirement_name, row_id, staff_user_id, assigned_by_user_id)
           VALUES (%s, %s, %s, %s, %s)""",
        (task_id, requirement_name, row_id, staff_user_id, assigned_by_user_id),
    )
    history.record(
        cur,
        task["request_id"],
        action="assign-row",
        actor_user_id=assigned_by_user_id,
        actor_role=history.primary_role_code(cur, assigned_by_user_id),
        request_task_id=task_id,
        requirement_id=task["requirement_id"],
        comment=f"row {row_id}",
    )

    if task["status"] not in TASK_TERMINAL and task["status"] != TASK_APPROVED:
        previous = task["status"]
        cur.execute(
            """UPDATE request_task SET status = %s, resolved_at = now(), resolved_by_user_id = %s
                WHERE request_task_id = %s""",
            (TASK_APPROVED, assigned_by_user_id, task_id),
        )
        history.record(
            cur,
            task["request_id"],
            action="approve",
            actor_user_id=assigned_by_user_id,
            actor_role=history.primary_role_code(cur, assigned_by_user_id),
            request_task_id=task_id,
            requirement_id=task["requirement_id"],
            previous_status=previous,
            new_status=TASK_APPROVED,
        )
    return load_task(cur, task_id)


def unassign_from_row(cur, task_id: int, requirement_name: str, row_id: int, staff_user_id: int, actor_user_id: int) -> dict:
    task = load_task(cur, task_id)
    authorize_department_task(cur, task, actor_user_id)
    cur.execute(
        "DELETE FROM request_row_assignment WHERE request_task_id = %s AND requirement_name = %s AND row_id = %s AND staff_user_id = %s",
        (task_id, requirement_name, row_id, staff_user_id),
    )
    if cur.rowcount == 0:
        raise NotFound("That team member is not assigned to this request.")
    history.record(
        cur,
        task["request_id"],
        action="unassign-row",
        actor_user_id=actor_user_id,
        actor_role=history.primary_role_code(cur, actor_user_id),
        request_task_id=task_id,
        requirement_id=task["requirement_id"],
        comment=f"row {row_id}",
    )
    return load_task(cur, task_id)


def rows_fully_staffed(cur, task_id: int, requirement_name: str) -> bool:
    """Whether every row of this task's requirement has at least one assignee -
    the gate the Approve modal's [disabled] uses before it will let the
    manager approve. A task with zero rows counts as staffed (nothing to
    assign), matching how the rest of this module treats an empty request."""
    table, pk_column = TABLE_FOR_REQUIREMENT[requirement_name]
    task = load_task(cur, task_id)
    unstaffed = fetch_one(
        cur,
        f"""SELECT count(*) AS c FROM {table} d
             WHERE d.request_id = %s
               AND NOT EXISTS (
                    SELECT 1 FROM request_row_assignment a
                     WHERE a.requirement_name = %s AND a.row_id = d.{pk_column}
               )""",
        (task["request_id"], requirement_name),
    )
    return unstaffed["c"] == 0


def update_row_status(cur, row_assignment_id: int, status: str, actor_user_id: int) -> dict:
    """The assigned staff member progresses THEIR OWN row: assigned -> preparing -> completed.

    Every assignee on the same row shares that row's progress (see migration
    012's docstring) - whoever gets there first can move it, the same
    "any one of us marks it done" model the old whole-task toggle used, just
    scoped to one row's assignees instead of the whole department's.
    """
    if status not in ("preparing", "completed"):
        raise WorkflowError("Staff can only set preparing or completed.")

    assignment = fetch_one(
        cur, "SELECT * FROM request_row_assignment WHERE request_row_assignment_id = %s", (row_assignment_id,)
    )
    if assignment is None:
        raise NotFound("Assignment not found.")
    if assignment["staff_user_id"] != actor_user_id:
        raise WorkflowError("This request is not assigned to you.", code="forbidden")
    if assignment["status"] == "completed":
        raise WorkflowError("This request is already completed.")
    if status == "preparing" and assignment["status"] != "assigned":
        raise WorkflowError("Only a newly assigned request can be moved to preparing.")

    previous = assignment["status"]
    if status == "completed":
        cur.execute(
            "UPDATE request_row_assignment SET status = %s, resolved_at = now() WHERE request_row_assignment_id = %s",
            (status, row_assignment_id),
        )
    else:
        cur.execute(
            "UPDATE request_row_assignment SET status = %s WHERE request_row_assignment_id = %s",
            (status, row_assignment_id),
        )
    # Every sibling assignee on the SAME row shares this status update, matching the
    # "any one of us marks it done" model - a row is one unit of work regardless of
    # how many people are on it.
    cur.execute(
        """UPDATE request_row_assignment SET status = %s
            WHERE requirement_name = %s AND row_id = %s AND request_row_assignment_id <> %s
              AND status <> 'completed'""",
        (status, assignment["requirement_name"], assignment["row_id"], row_assignment_id),
    )
    if status == "completed":
        cur.execute(
            """UPDATE request_row_assignment SET resolved_at = now()
                WHERE requirement_name = %s AND row_id = %s AND request_row_assignment_id <> %s
                  AND resolved_at IS NULL""",
            (assignment["requirement_name"], assignment["row_id"], row_assignment_id),
        )

    task = load_task(cur, assignment["request_task_id"])
    history.record(
        cur,
        task["request_id"],
        action=status,
        actor_user_id=actor_user_id,
        actor_role="staff",
        request_task_id=task["request_task_id"],
        requirement_id=task["requirement_id"],
        previous_status=previous,
        new_status=status,
        comment=f"row {assignment['row_id']}",
    )

    if status == "completed" and rows_fully_staffed(cur, task["request_task_id"], assignment["requirement_name"]):
        all_done = fetch_one(
            cur,
            """SELECT count(*) AS c FROM request_row_assignment
                WHERE request_task_id = %s AND status <> 'completed'""",
            (task["request_task_id"],),
        )["c"] == 0
        if all_done:
            cur.execute(
                "UPDATE request_task SET status = %s, resolved_at = now() WHERE request_task_id = %s",
                (TASK_COMPLETED, task["request_task_id"]),
            )
            history.record(
                cur,
                task["request_id"],
                action="complete",
                actor_user_id=actor_user_id,
                actor_role="staff",
                request_task_id=task["request_task_id"],
                requirement_id=task["requirement_id"],
                previous_status=task["status"],
                new_status=TASK_COMPLETED,
            )
            check_all_tasks_resolved(cur, task["request_id"])
    return fetch_one(cur, "SELECT * FROM request_row_assignment WHERE request_row_assignment_id = %s", (row_assignment_id,))


def my_row_assignments(cur, staff_user_id: int) -> list[dict]:
    """Every row assignment for one staff member, joined with the proposal/row
    context the frontend's My Tasks page needs to render one row per assignment.
    """
    return fetch_all(
        cur,
        """SELECT a.request_row_assignment_id, a.requirement_name, a.row_id, a.status,
                  a.assigned_at, a.resolved_at, a.request_task_id,
                  t.request_id, r.request_code, r.event_title, r.status AS request_status
             FROM request_row_assignment a
             JOIN request_task t ON t.request_task_id = a.request_task_id
             JOIN request r ON r.request_id = t.request_id
            WHERE a.staff_user_id = %s
         ORDER BY a.assigned_at DESC""",
        (staff_user_id,),
    )


def co_assignees_for_task(cur, request_task_id: int) -> list[dict]:
    """Every staff member assigned to ANY row of one task, with the row they're on -
    lets the caller group by row_id to find who else shares a given row. Batched
    per task (not per row/assignment) so My Tasks' co-assignee column costs one
    extra query per distinct task on the page, not one per row.
    """
    return fetch_all(
        cur,
        """SELECT a.row_id, a.staff_user_id, u.full_name AS staff_name
             FROM request_row_assignment a
             JOIN users u ON u.user_id = a.staff_user_id
            WHERE a.request_task_id = %s""",
        (request_task_id,),
    )


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
