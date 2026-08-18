"""The proposal workflow state machine.

The backend owns this entirely. Every transition validates the current state,
the actor's authority, and the business rules server-side; the frontend sends
an action and renders whatever comes back.

Split by concern:
    constants     statuses, routing tables, config lookups
    authorization who may act, given the row's current state
    history       workflow_history writes (the audit trail)
    stages        the single-actor chain (HOS/HOD -> F&B -> CFO)
    tasks         parallel department review
    fmb           cafeteria orders under the F&B task
"""
from __future__ import annotations

from . import authorization, constants, fmb, history, stages, tasks

# --- Stage transitions ---
submit = stages.submit
approve = stages.approve
reject = stages.reject
send_back = stages.send_back
applicant_resubmit = stages.applicant_resubmit
cancel = stages.cancel
stage_after_hos_hod = stages.stage_after_hos_hod

# --- Department tasks ---
create_department_tasks = tasks.create_department_tasks
approve_task = tasks.approve_task
send_task_back = tasks.send_task_back
assign_staff = tasks.assign_staff
unassign_staff = tasks.unassign_staff
update_task_status = tasks.update_task_status
tasks_for_request = tasks.tasks_for_request
find_task = tasks.find_task
load_task = tasks.load_task
check_all_tasks_resolved = tasks.check_all_tasks_resolved

# --- F&B cafeteria orders ---
create_selection = fmb.create_selection
approve_selection = fmb.approve_selection
send_selection_back = fmb.send_selection_back
edit_selection = fmb.edit_selection
claim_selection = fmb.claim_selection
fulfil_selection = fmb.fulfil_selection
selections_for_request = fmb.selections_for_request
shared_pool_for_staff = fmb.shared_pool_for_staff

# --- Authorization / lookups ---
load_request = authorization.load_request
is_proposal_owner = authorization.is_proposal_owner
assert_proposal_owner = authorization.assert_proposal_owner
is_within_cancellation_window = authorization.is_within_cancellation_window
heads_unit = authorization.heads_unit
has_role = authorization.has_role
history_for = history.history_for

__all__ = [
    "constants",
    "authorization",
    "history",
    "stages",
    "tasks",
    "fmb",
    "submit",
    "approve",
    "reject",
    "send_back",
    "applicant_resubmit",
    "cancel",
    "stage_after_hos_hod",
    "create_department_tasks",
    "approve_task",
    "send_task_back",
    "assign_staff",
    "unassign_staff",
    "update_task_status",
    "tasks_for_request",
    "find_task",
    "load_task",
    "check_all_tasks_resolved",
    "create_selection",
    "approve_selection",
    "send_selection_back",
    "edit_selection",
    "claim_selection",
    "fulfil_selection",
    "selections_for_request",
    "shared_pool_for_staff",
    "load_request",
    "is_proposal_owner",
    "assert_proposal_owner",
    "is_within_cancellation_window",
    "heads_unit",
    "has_role",
    "history_for",
]
