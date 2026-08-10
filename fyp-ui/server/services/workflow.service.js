const { db, nextId } = require('../db');

class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function findRequest(requestId) {
  const request = db.request.find((r) => r.request_id === Number(requestId));
  if (!request) throw new WorkflowError('Proposal not found.', 404);
  return request;
}

function isHosHodOfUnit(userId, request) {
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  if (!applicant) return false;
  const applicantUnit = db.unit_users.find((uu) => uu.user_id === applicant.user_id);
  if (!applicantUnit) return false;
  const unit = db.unit.find((u) => u.code === applicantUnit.unit_code);
  return !!unit && unit.head_user_id === Number(userId);
}

function isApplicantSelf(requestId, userId) {
  const request = findRequest(requestId);
  return request.applicant_user_id === Number(userId);
}

// Authorization is a pure lookup against the CURRENT request status — this is the single
// place that decides "does this actor's role/identity match what the current stage needs."
// Every mutating function below calls this FIRST, before touching any data. The frontend's
// own display logic is only a UI convenience; this is the actual authority (system.md's
// "the backend owns the workflow" principle).
function authorizeAction(requestId, actorUser, action) {
  const request = findRequest(requestId);
  const status = request.status;

  if (action === 'hos_hod_review' && status === 'hos_hod_review') {
    if (actorUser.role !== 'hos_hod') throw new WorkflowError('Only HOS/HOD can act at this stage.', 403);
    if (!isHosHodOfUnit(actorUser.user_id, request)) throw new WorkflowError('You are not the HOS/HOD for this applicant\'s unit.', 403);
    return;
  }
  if (action === 'fmb_review' && status === 'fmb_review') {
    if (actorUser.role !== 'fmb') throw new WorkflowError('Only F&B can act at this stage.', 403);
    return;
  }
  if (action === 'cfo_review' && status === 'cfo_review') {
    if (actorUser.role !== 'cfo') throw new WorkflowError('Only CFO can act at this stage.', 403);
    return;
  }
  if (action === 'cancel') {
    if (status === 'cancelled' || status === 'completed_rejected') throw new WorkflowError('This proposal cannot be cancelled.', 400);
    const isCoOwner = db.co_owners.some((c) => c.request_id === request.request_id && c.staff_id && db.staff.find((s) => s.staff_id === c.staff_id)?.user_id === Number(actorUser.user_id));
    if (!isApplicantSelf(requestId, actorUser.user_id) && !isCoOwner) throw new WorkflowError('Only the applicant or a co-owner can cancel.', 403);
    const config = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
    const schedule = db.event_schedule.find((s) => s.request_id === request.request_id);
    if (schedule && config) {
      const deadline = new Date(schedule.date);
      deadline.setDate(deadline.getDate() - config.number);
      if (new Date() > deadline) throw new WorkflowError('The cancellation deadline for this event has passed.', 400);
    }
    return;
  }
  throw new WorkflowError(`This action is not available at the current stage (${status}).`, 400);
}

function highPaxThreshold() {
  return db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD').number;
}

function recordHistory(requestId, requestTaskId, requirementId, action, actorUserId, actorRole, comment, previousStatus, newStatus) {
  db.workflow_history.push({
    workflow_history_id: nextId('workflow_history'),
    request_id: Number(requestId),
    request_task_id: requestTaskId || null,
    requirement_id: requirementId || null,
    action,
    actor_user_id: actorUserId != null ? Number(actorUserId) : null,
    actor_role: actorRole,
    comment: comment || null,
    previous_status: previousStatus,
    new_status: newStatus,
    created_at: new Date().toISOString(),
  });
}

// Called once, right after the applicant's form-submit action creates the `request` row with
// status='draft'. Decides the FIRST real stage per the self-review/CFO-skip rules (Phase 1's
// corrected workflow diagram).
function submitProposal(requestId) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  const previousStatus = request.status;

  let nextStatus;
  if (isHosHodOfUnit(applicant.user_id, request)) {
    // Self-review: skip hos_hod_review entirely, go straight to the F&B/CFO check.
    nextStatus = request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
  } else if (applicant.role === 'cfo' || applicant.role === 'fmb') {
    // CFO/F&B applying for themselves: skip ALL higher approval.
    nextStatus = 'department_review';
  } else {
    nextStatus = 'hos_hod_review';
  }

  request.status = nextStatus;
  request.submitted_at = new Date().toISOString();
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'submit', applicant.user_id, applicant.role, null, previousStatus, nextStatus);
  return request;
}

function approveReviewerStage(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;

  let nextStatus;
  if (previousStatus === 'hos_hod_review') {
    nextStatus = request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
  } else if (previousStatus === 'fmb_review') {
    nextStatus = request.total_pax > highPaxThreshold() ? 'cfo_review' : 'department_review';
    // (fmb_review is only ever entered when pax IS high per submitProposal's/resubmit's logic,
    // so the `total_pax > highPaxThreshold()` check here is defensive, not reachable via the
    // false branch under normal flow — but kept explicit rather than assumed.)
  } else if (previousStatus === 'cfo_review') {
    nextStatus = 'department_review';
  } else {
    throw new WorkflowError(`Cannot approve from status ${previousStatus}.`, 400);
  }

  request.status = nextStatus;
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'approve', actorUserId, actor.role, null, previousStatus, nextStatus);
  return request;
}

function rejectReviewerStage(requestId, actorUserId, reason) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.status = 'completed_rejected';
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'reject', actorUserId, actor.role, reason, previousStatus, 'completed_rejected');
  return request;
}

// resumeStage is stored directly on the request row as a new field (request.resume_stage) —
// NOT part of the original ems_database_schema.sql request table, added here as a mock-layer
// necessity to track "where to resume." A real backend would likely derive this from the most
// recent workflow_history row instead of storing it directly; the mock takes the simpler path.
function resubmitReviewerStage(requestId, actorUserId, comment) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.resume_stage = previousStatus;
  request.status = 'resubmission_required';
  request.reviewer_comment = comment;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'resubmit', actorUserId, actor.role, comment, previousStatus, 'resubmission_required');
  return request;
}

function applicantResubmit(requestId, updates) {
  const request = findRequest(requestId);
  Object.assign(request, updates);
  const resumeStatus = request.resume_stage || 'hos_hod_review';
  const previousStatus = request.status;
  request.status = resumeStatus;
  request.resume_stage = null;
  request.reviewer_comment = null;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'applicant-resubmit', request.applicant_user_id, 'applicant', null, previousStatus, resumeStatus);
  return request;
}

function cancelProposal(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  request.status = 'cancelled';
  request.cancelled_at = new Date().toISOString();
  request.cancelled_by_user_id = Number(actorUserId);
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'cancel', actorUserId, actor.role, null, previousStatus, 'cancelled');
  return request;
}

// Called once, the moment a request enters department_review. Creates one request_task per
// DISTINCT requirement the applicant selected, EXCEPT waterLogo/waterNormal — those attach to
// the SAME task as fmb (Phase 1's correction: F&B reviews food + water together, one task).
function createDepartmentTasks(requestId) {
  const applicationRequirements = db.application_requirements.filter((ar) => ar.request_id === Number(requestId));
  const requirementNames = applicationRequirements.map((ar) => db.event_requirements.find((r) => r.requirement_id === ar.requirement_id).requirement_name);

  const roleForRequirement = {
    logistics: 'logistics_manager',
    transportation: 'transportation_manager',
    photoVideo: 'photo_video_manager',
    soundLight: 'sound_light_manager',
    campusTour: 'student_services_manager',
    fundingPurchase: 'cfo',
    fmb: 'fmb',
  };

  // Water rows never get their own task row — they're folded into 'fmb'. If the applicant
  // selected water but NOT fmb explicitly (the Angular form always includes fmb whenever water
  // is picked, per Task 2.5's corrected requirement checklist merge — but defend against it
  // anyway), still create exactly one 'fmb' task.
  const distinctTaskRequirements = [...new Set(requirementNames.map((name) => (name === 'waterLogo' || name === 'waterNormal') ? 'fmb' : name))];

  for (const requirementName of distinctTaskRequirements) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementName);
    db.request_task.push({
      request_task_id: nextId('request_task'),
      request_id: Number(requestId),
      requirement_id: requirement.requirement_id,
      stage_code: 'department_review',
      sequence_no: 1,
      assigned_role: roleForRequirement[requirementName],
      assignment_mode: requirementName === 'fmb' ? 'shared_pool' : 'assigned',
      // NOTE: 'shared_pool' here describes the OVERALL fmb task's eventual staff-fulfilment
      // step conceptually, but the actual shared-pool mechanism (Task 3.4 Step 5) operates at
      // the request_fmb_selection level, not this request_task level — this task row's
      // assignment_mode is mostly informational for fmb; the department-review-time actions
      // (Cafeteria Manager approve/resubmit per selection) read/write request_fmb_selection
      // rows directly, not this table's assignment_mode.
      status: 'pending',
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by_user_id: null,
    });
  }
}

function findDepartmentTask(requestId, requirementKey) {
  const requirement = db.event_requirements.find((r) => r.requirement_name === requirementKey);
  const task = db.request_task.find((t) => t.request_id === Number(requestId) && t.requirement_id === requirement.requirement_id && t.stage_code === 'department_review');
  if (!task) throw new WorkflowError('Department task not found.', 404);
  return task;
}

function checkAllDepartmentTasksResolved(requestId) {
  const tasks = db.request_task.filter((t) => t.request_id === Number(requestId) && t.stage_code === 'department_review');
  const allResolved = tasks.every((t) => t.status === 'completed' || t.status === 'cancelled');
  if (allResolved && tasks.length > 0) {
    const request = findRequest(requestId);
    const previousStatus = request.status;
    request.status = 'completed_approved';
    request.updated_at = new Date().toISOString();
    recordHistory(requestId, null, null, 'auto-complete', null, 'system', null, previousStatus, 'completed_approved');
  }
}

function approveDepartmentTask(requestId, requirementKey, actorUserId) {
  const task = findDepartmentTask(requestId, requirementKey);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = task.status;
  task.status = 'approved';
  task.resolved_at = new Date().toISOString();
  task.resolved_by_user_id = Number(actorUserId);
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'approve', actorUserId, actor.role, null, previousStatus, 'approved');

  // fmb is special: 'approve' here means F&B approved the FOOD+WATER REQUEST overall and is
  // about to create selection rows (a separate call — see the routes layer, which calls
  // createFmbSelection() once per cafeteria after this approval) — it does NOT immediately
  // mark the task 'completed'. Every other department's approve DOES immediately complete the
  // task once staff assignment has happened (assignStaffToTask marks it, not this function).
  return task;
}

function resubmitDepartmentTask(requestId, requirementKey, actorUserId, comment) {
  const task = findDepartmentTask(requestId, requirementKey);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = task.status;
  task.status = 'resubmitted';
  task.comment = comment;
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'resubmit', actorUserId, actor.role, comment, previousStatus, 'resubmitted');
  // Per the design spec's "parallel independence": this does NOT touch request.status or any
  // sibling request_task row. The applicant sees this specific department's resubmission in
  // their inbox (a query concern for the routes layer, not this function) while every other
  // department's task continues unaffected.
  return task;
}

function assignStaffToTask(requestTaskId, staffUserId, assignedByUserId) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  db.task_assignment.push({
    task_assignment_id: nextId('task_assignment'),
    request_task_id: task.request_task_id,
    staff_user_id: Number(staffUserId),
    assigned_by_user_id: assignedByUserId ? Number(assignedByUserId) : null,
    assigned_at: new Date().toISOString(),
  });
  const previousStatus = task.status;
  task.status = 'approved';
  task.resolved_at = new Date().toISOString();
  task.resolved_by_user_id = assignedByUserId ? Number(assignedByUserId) : null;
  recordHistory(task.request_id, task.request_task_id, task.requirement_id, 'assign', assignedByUserId, 'manager', null, previousStatus, 'approved');
  return task;
}

function updateTaskStatus(requestTaskId, status) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  if (!['preparing', 'completed'].includes(status)) throw new WorkflowError('Staff can only set preparing or completed.', 400);
  const previousStatus = task.status;
  task.status = status;
  if (status === 'completed') { task.resolved_at = new Date().toISOString(); checkAllDepartmentTasksResolved(task.request_id); }
  recordHistory(task.request_id, task.request_task_id, task.requirement_id, status, null, 'staff', null, previousStatus, status);
  return task;
}

function createFmbSelection(requestFmbId, cafeteriaId, fmbOptionId, menuItemLabel, quantity, notes) {
  const selection = {
    request_fmb_selection_id: nextId('request_fmb_selection'),
    request_fmb_id: Number(requestFmbId),
    cafeteria_id: Number(cafeteriaId),
    fmb_option_id: Number(fmbOptionId),
    menu_item_label: menuItemLabel,
    quantity: Number(quantity),
    status: 'pending',
    notes: notes || null,
  };
  db.request_fmb_selection.push(selection);
  return selection;
}

function findFmbSelection(selectionId) {
  const selection = db.request_fmb_selection.find((s) => s.request_fmb_selection_id === Number(selectionId));
  if (!selection) throw new WorkflowError('Order selection not found.', 404);
  return selection;
}

function requestIdForFmbSelection(selectionId) {
  const selection = findFmbSelection(selectionId);
  const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === selection.request_fmb_id);
  return fmbRow.request_id;
}

// Cafeteria Manager approves ONE selection row -> it enters the shared pool for that
// cafeteria's staff. Does not touch sibling selection rows for the same request_fmb.
function approveFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  selection.status = 'approved';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'approve-selection', actorUserId, actor.role, null, previousStatus, 'approved');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// Cafeteria Manager resubmits ONE selection row -> goes back to F&B with status
// 'resubmitted'. Per the design spec, this does NOT touch the applicant or the parent
// request_task's status at all — it's purely a signal that F&B needs to edit this row.
function resubmitFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  selection.status = 'resubmitted';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'resubmit-selection', actorUserId, actor.role, null, previousStatus, 'resubmitted');
  return selection;
}

// F&B edits a resubmitted row — dish, quantity, and/or cafeteria — then it goes straight back
// to whichever Cafeteria Manager now owns it (same one if cafeteria_id is unchanged, a
// different one if F&B switched it). No separate "re-approve" step: saving the edit IS the
// re-send, per the design spec.
function editFmbSelection(selectionId, updates, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  if (updates.cancel) {
    selection.status = 'cancelled';
    recordHistory(requestIdForFmbSelection(selectionId), null, null, 'cancel-selection', actorUserId, actor.role, null, previousStatus, 'cancelled');
    checkFmbTaskResolved(selectionId);
    return selection;
  }
  if (updates.cafeteriaId !== undefined) selection.cafeteria_id = Number(updates.cafeteriaId);
  if (updates.fmbOptionId !== undefined) selection.fmb_option_id = Number(updates.fmbOptionId);
  if (updates.menuItemLabel !== undefined) selection.menu_item_label = updates.menuItemLabel;
  if (updates.quantity !== undefined) selection.quantity = Number(updates.quantity);
  if (updates.notes !== undefined) selection.notes = updates.notes;
  selection.status = 'pending';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'edit-selection', actorUserId, actor.role, null, previousStatus, 'pending');
  return selection;
}

// First staff member to claim a shared-pool task owns it — it then leaves every other
// eligible staff member's inbox. Modeled here at the selection level: claiming means creating
// a task_assignment row against the PARENT request_task (all fmb selections for one proposal
// share one request_task), scoped further by which cafeteria this specific staff member is
// assigned to (checked by the routes layer before calling this, using cafeteria_assignment).
function claimSharedFmbSelection(selectionId, staffUserId) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'approved') throw new WorkflowError('This order is not available to claim.', 400);
  selection.status = 'preparing';
  const requestId = requestIdForFmbSelection(selectionId);
  recordHistory(requestId, null, null, 'claim-selection', staffUserId, 'cafeteria_staff', null, 'approved', 'preparing');
  return selection;
}

function fulfilFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const previousStatus = selection.status;
  selection.status = 'fulfilled';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'fulfil-selection', actorUserId, 'cafeteria_staff', null, previousStatus, 'fulfilled');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// The fmb request_task is "resolved" once every one of its selection rows has reached a
// terminal state (fulfilled or cancelled) — mirrors checkAllDepartmentTasksResolved's overall
// pattern but scoped to this one task's selection rows instead of sibling request_task rows.
function checkFmbTaskResolved(selectionId) {
  const requestId = requestIdForFmbSelection(selectionId);
  const fmbTask = findDepartmentTask(requestId, 'fmb');
  const allFmbRows = db.request_fmb
    .filter((f) => f.request_id === Number(requestId))
    .flatMap((f) => db.request_fmb_selection.filter((s) => s.request_fmb_id === f.request_fmb_id));
  const allResolved = allFmbRows.length > 0 && allFmbRows.every((s) => s.status === 'fulfilled' || s.status === 'cancelled');
  if (allResolved && fmbTask.status !== 'completed') {
    const previousStatus = fmbTask.status;
    fmbTask.status = 'completed';
    fmbTask.resolved_at = new Date().toISOString();
    recordHistory(requestId, fmbTask.request_task_id, fmbTask.requirement_id, 'complete', null, 'system', null, previousStatus, 'completed');
    checkAllDepartmentTasksResolved(requestId);
  }
}

module.exports = {
  WorkflowError,
  findRequest,
  isHosHodOfUnit,
  authorizeAction,
  submitProposal,
  approveReviewerStage,
  rejectReviewerStage,
  resubmitReviewerStage,
  applicantResubmit,
  cancelProposal,
  createDepartmentTasks,
  findDepartmentTask,
  approveDepartmentTask,
  resubmitDepartmentTask,
  assignStaffToTask,
  updateTaskStatus,
  createFmbSelection,
  findFmbSelection,
  approveFmbSelection,
  resubmitFmbSelection,
  editFmbSelection,
  claimSharedFmbSelection,
  fulfilFmbSelection,
};
