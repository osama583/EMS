// db/nextId are bound via init(), not required directly from '../db' at top-level: db.js's own
// module-load order calls init(db, nextId) with its live references before any route or seed
// logic runs, and every other consumer of this module (e.g. the Express routes layer) does the
// same once at startup, right after require('../db').
let db;
let nextId;
function init(dbRef, nextIdRef) {
  db = dbRef;
  nextId = nextIdRef;
}

function assertInit() {
  if (!db || !nextId) {
    throw new Error('workflow.service: init(db, nextId) must be called once at startup before any other export is used.');
  }
}

const { isHeadOfUnit } = require('./user-access.service');

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

// Unit + Level model: request_task no longer stores a flat role string for the 5 Service
// department-routed requirement kinds (logistics/transportation/photoVideo/soundLight/
// campusTour) — it stores `assigned_unit_code` instead (see ems_database_schema.sql's comment
// above CREATE TABLE request_task). `assigned_role` is now reserved for exactly the two
// non-unit-scoped kinds: 'cfo' (fundingPurchase) and 'fmb' (fmb — F&B is unit-scoped as a
// Service department for USER identity purposes, but its request_task routing keeps the legacy
// flat 'fmb' assigned_role token since createFmbSelection()/the cafeteria fan-out downstream
// keys off it, not a unit lookup — kept exactly as before, out of scope to change here).
const UNIT_CODE_FOR_REQUIREMENT = {
  logistics: 'logistics_and_facilities',
  transportation: 'transport_services',
  photoVideo: 'photography_services',
  soundLight: 'a_v_services',
  campusTour: 'student_services',
};
// Funding/Purchase is deliberately ABSENT here: per the system specification it is recorded on
// the form (request_funding_purchase rows) but never enters the approval workflow — no
// department-review task, no CFO sign-off on the line items, purely informational. The CFO's
// only workflow role is the cfo_review approval stage for high-pax proposals. See
// createDepartmentTasks() below, which skips it explicitly.
const FLAT_ROLE_FOR_REQUIREMENT = {
  fmb: 'fmb',
};

// Requirement keys that carry data on the form but never create a request_task.
const NON_WORKFLOW_REQUIREMENTS = new Set(['fundingPurchase']);
// F&B's own unit — used by the fmb_review gate below (F&B is unit-scoped: role/function_level
// 'manager' on the 'food_beverage_services' Service department unit) even though its
// request_task routing above still uses the legacy flat 'fmb' assigned_role token.
const FMB_UNIT_CODE = 'food_beverage_services';

// True if `userId` holds head-of-school or head-of-department on `unitCode` — replaces the old
// function_level==='manager' check. RBAC redesign: see user-access.service.js's isHeadOfUnit().
function isManagerOfUnit(userId, unitCode) {
  return isHeadOfUnit(userId, unitCode);
}

function isHosHodOfUnit(userId, request) {
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  if (!applicant) return false;
  // Applicant may hold several unit roles; self-review applies to ANY unit where they're also
  // its head-of-school (school units only — a head-of-department applicant self-reviewing is a
  // different, F&B-specific case handled directly in submitProposal() below).
  const applicantUnitCodes = db.user_unit_roles
    .filter((uur) => uur.user_id === applicant.user_id && uur.unit_code)
    .map((uur) => uur.unit_code);
  return applicantUnitCodes.some((unitCode) => isHeadOfUnit(userId, unitCode) && db.unit.find((u) => u.code === unitCode) && require('./role-eligibility.service').isSchoolUnit(unitCode));
}

function isApplicantSelf(requestId, userId) {
  const request = findRequest(requestId);
  return request.applicant_user_id === Number(userId);
}

// Co-owners are stored as snapshot rows (name/email, staff_id optional) — match on the email
// snapshot as well as staff_id so a co-owner added by picking them from the staff directory is
// recognised even when staff_id was never resolved. Co-owners share the applicant's rights to
// edit, resubmit and cancel the proposal (system specification §4 "Applicant or co-owners").
function isCoOwner(requestId, userId) {
  const actor = db.users.find((u) => u.user_id === Number(userId));
  if (!actor) return false;
  const actorEmail = String(actor.email || '').trim().toLowerCase();
  return db.co_owners.some((c) => {
    if (c.request_id !== Number(requestId)) return false;
    if (c.staff_id && db.staff.find((s) => s.staff_id === c.staff_id)?.user_id === Number(userId)) return true;
    return !!actorEmail && String(c.staff_email || '').trim().toLowerCase() === actorEmail;
  });
}

// "Owns this proposal" = the applicant themselves or any co-owner. The single gate every
// applicant-side mutation (save-edits, resubmit, delete draft, cancel, registration approval)
// runs through, so the frontend never decides who may edit a proposal.
function isProposalOwner(requestId, userId) {
  return isApplicantSelf(requestId, userId) || isCoOwner(requestId, userId);
}

function assertProposalOwner(requestId, userId) {
  if (!isProposalOwner(requestId, userId)) {
    throw new WorkflowError('Only the applicant or a co-owner of this proposal can do that.', 403);
  }
}

// The earliest scheduled date across every event_schedule row — the cancellation deadline is
// measured from when the event STARTS, so a multi-day event locks on its first day, not its
// last. Returns null when the proposal has no schedule rows at all (draft with nothing entered).
function earliestEventDate(requestId) {
  const dates = db.event_schedule
    .filter((s) => s.request_id === Number(requestId) && s.date)
    .map((s) => new Date(`${s.date}T00:00:00`))
    .filter((d) => !isNaN(d.getTime()));
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

function cancellationDeadlineDays() {
  const config = db.config.find((c) => c.code === 'CANCELLATION_DEADLINE_DAYS');
  if (!config) throw new WorkflowError('CANCELLATION_DEADLINE_DAYS config not found.', 404);
  return config.number;
}

function maxEventCategories() {
  const config = db.config.find((c) => c.code === 'MAX_EVENT_CATEGORIES');
  if (!config) throw new WorkflowError('MAX_EVENT_CATEGORIES config not found.', 404);
  return config.number;
}

// The cancellation window closes CANCELLATION_DEADLINE_DAYS whole days before the event's first
// scheduled day, at the end of that day. Shared by authorizeAction('cancel') and
// cancelProposal() so the check can never be bypassed by calling the mutation directly.
function isWithinCancellationWindow(requestId) {
  const eventDate = earliestEventDate(requestId);
  if (!eventDate) return true;
  const deadline = new Date(eventDate);
  deadline.setDate(deadline.getDate() - cancellationDeadlineDays());
  deadline.setHours(23, 59, 59, 999);
  return Date.now() <= deadline.getTime();
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
    if (!isHosHodOfUnit(actorUser.user_id, request)) throw new WorkflowError('You are not the HOS/HOD for this applicant\'s unit.', 403);
    return;
  }
  if (action === 'fmb_review' && status === 'fmb_review') {
    if (!isManagerOfUnit(actorUser.user_id, FMB_UNIT_CODE)) throw new WorkflowError('Only F&B can act at this stage.', 403);
    return;
  }
  if (action === 'cfo_review' && status === 'cfo_review') {
    const { hasRole } = require('./user-access.service');
    if (!hasRole(actorUser.user_id, 'cfo')) throw new WorkflowError('Only CFO can act at this stage.', 403);
    return;
  }
  if (action === 'cancel') {
    if (['cancelled', 'completed_rejected', 'completed_approved'].includes(status)) {
      throw new WorkflowError('This proposal cannot be cancelled.', 400);
    }
    if (!isProposalOwner(requestId, actorUser.user_id)) throw new WorkflowError('Only the applicant or a co-owner can cancel.', 403);
    if (!isWithinCancellationWindow(requestId)) {
      throw new WorkflowError(`The cancellation deadline for this event has passed (cancellation closes ${cancellationDeadlineDays()} day(s) before the event date).`, 400);
    }
    return;
  }
  throw new WorkflowError(`This action is not available at the current stage (${status}).`, 400);
}

// Department-stage authorization: who may act on ONE request_task. Unit-routed tasks
// (logistics/transportation/photoVideo/soundLight/campusTour) are owned by any head of that
// unit; the flat 'fmb' task is owned by the F&B unit's head-of-department. Departments may only
// approve or resubmit — never reject (see chk_task_status in ems_database_schema.sql).
function authorizeDepartmentTask(task, actorUserId) {
  const request = findRequest(task.request_id);
  if (request.status !== 'department_review') {
    throw new WorkflowError(`This proposal is not in department review (currently ${request.status}).`, 400);
  }
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new WorkflowError('This department task is already closed.', 400);
  }
  if (task.assigned_unit_code) {
    if (!isManagerOfUnit(actorUserId, task.assigned_unit_code)) {
      throw new WorkflowError('You do not head the department this request is routed to.', 403);
    }
    return;
  }
  if (task.assigned_role === 'fmb') {
    if (!isManagerOfUnit(actorUserId, FMB_UNIT_CODE)) {
      throw new WorkflowError('Only Food & Beverage Services can act on this request.', 403);
    }
    return;
  }
  throw new WorkflowError('This task has no recognised routing.', 400);
}

function highPaxThreshold() {
  const config = db.config.find((c) => c.code === 'HIGH_PAX_THRESHOLD');
  if (!config) throw new WorkflowError('HIGH_PAX_THRESHOLD config not found.', 404);
  return config.number;
}

// workflow_history.actor_role is a display string only (not used for any authorization check —
// authorizeAction() above is the actual gate). Picks the actor's first held role_code, or a
// fixed literal for the well-known synthetic actors ('system', 'applicant', 'staff',
// 'cafeteria_staff') that already get passed directly by several call sites below.
function primaryRoleCodeFor(userId) {
  const { rolesFor } = require('./user-access.service');
  const roles = rolesFor(userId);
  return roles.length > 0 ? roles[0].roleCode : 'unknown';
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

// The single gate that runs once the HOS/HOD box has resolved — whether it was skipped
// (applicant heads their own School) or approved. Mirrors the specification's workflow diagram
// exactly, in order:
//   1. Applicant is CFO or the F&B head?  -> straight to department_review (they would
//      otherwise be reviewing their own proposal at the fmb_review/cfo_review stages).
//   2. total_pax > HIGH_PAX_THRESHOLD (read from `config`, never hardcoded)? -> fmb_review,
//      which on approval advances to cfo_review, then department_review.
//   3. Otherwise -> department_review.
function stageAfterHosHod(request) {
  const { hasRole } = require('./user-access.service');
  if (hasRole(request.applicant_user_id, 'cfo') || isManagerOfUnit(request.applicant_user_id, FMB_UNIT_CODE)) {
    return 'department_review';
  }
  return request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
}

// Called once, right after the applicant's form-submit action creates the `request` row with
// status='draft'. Decides the FIRST real stage per the self-review/CFO-skip rules (Phase 1's
// corrected workflow diagram).
function submitProposal(requestId) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  const previousStatus = request.status;

  // Self-review guard: an applicant who heads their own School would otherwise review their own
  // proposal, so hos_hod_review is skipped and the flow resumes at the next gate. Everyone else
  // starts at hos_hod_review.
  const nextStatus = isHosHodOfUnit(applicant.user_id, request)
    ? stageAfterHosHod(request)
    : 'hos_hod_review';

  request.status = nextStatus;
  request.submitted_at = new Date().toISOString();
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'submit', applicant.user_id, primaryRoleCodeFor(applicant.user_id), null, previousStatus, nextStatus);
  return request;
}

function approveReviewerStage(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;

  let nextStatus;
  if (previousStatus === 'hos_hod_review') {
    nextStatus = stageAfterHosHod(request);
  } else if (previousStatus === 'fmb_review') {
    // F&B and CFO are sequential: F&B's approval always hands off to the CFO, who is the last
    // approval gate before department review.
    nextStatus = 'cfo_review';
  } else if (previousStatus === 'cfo_review') {
    nextStatus = 'department_review';
  } else {
    throw new WorkflowError(`Cannot approve from status ${previousStatus}.`, 400);
  }

  request.status = nextStatus;
  request.updated_at = new Date().toISOString();
  if (nextStatus === 'department_review') createDepartmentTasks(request.request_id);
  recordHistory(request.request_id, null, null, 'approve', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, nextStatus);
  return request;
}

function rejectReviewerStage(requestId, actorUserId, reason) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  if (!['hos_hod_review', 'fmb_review', 'cfo_review'].includes(previousStatus)) {
    throw new WorkflowError(`Cannot reject from status ${previousStatus}.`, 400);
  }
  request.status = 'completed_rejected';
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'reject', actorUserId, primaryRoleCodeFor(actorUserId), reason, previousStatus, 'completed_rejected');
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
  recordHistory(request.request_id, null, null, 'resubmit', actorUserId, primaryRoleCodeFor(actorUserId), comment, previousStatus, 'resubmission_required');
  return request;
}

// Applicant resubmits a proposal a reviewer sent back (status='resubmission_required'). `payload`
// is the event-proposal form's FULL submission shape (same as createProposal()/saveDraft()/
// saveRequestContent() take) — every scalar field and every request_* child table is replaced
// from what the applicant edited, not just the 5-field allowlist this used to shallow-patch, so
// edits to the schedule/co-owners/requests/etc. actually survive a resubmit. Persisting is
// delegated entirely to saveRequestContent(); this function's own job is only the stage
// transition (resume at whichever stage sent it back, clear resume_stage/reviewer_comment).
function applicantResubmit(requestId, payload, actorUserId) {
  const request = findRequest(requestId);
  assertProposalOwner(requestId, actorUserId);

  // Case 2 — a DEPARTMENT sent one of its tasks back. The proposal itself never left
  // department_review (parallel independence: sibling departments keep working), so resubmitting
  // resets only the tasks that asked for changes, back into their own department's Inbox. Every
  // other task's progress is untouched.
  const resubmittedTasks = db.request_task.filter((t) => t.request_id === request.request_id && t.status === 'resubmitted');
  if (request.status === 'department_review' && resubmittedTasks.length > 0) {
    if (payload) saveRequestContent(requestId, payload, actorUserId);
    for (const task of resubmittedTasks) {
      task.status = 'pending';
      task.comment = null;
      recordHistory(request.request_id, task.request_task_id, task.requirement_id, 'applicant-resubmit', actorUserId, 'applicant', null, 'resubmitted', 'pending');
    }
    request.updated_at = new Date().toISOString();
    return request;
  }

  // Case 1 — a single-actor reviewer stage (HOS/HOD, F&B or CFO) sent the whole proposal back.
  if (request.status !== 'resubmission_required') {
    throw new WorkflowError(`Cannot resubmit from status ${request.status}.`, 400);
  }
  if (payload) {
    validateProposalPayload(payload);
    saveRequestContent(requestId, payload, actorUserId);
  }
  const resumeStatus = request.resume_stage || 'hos_hod_review';
  const previousStatus = request.status;
  request.status = resumeStatus;
  request.resume_stage = null;
  request.reviewer_comment = null;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'applicant-resubmit', actorUserId ?? request.applicant_user_id, 'applicant', null, previousStatus, resumeStatus);
  return request;
}

// Generic "persist this request's content, touch nothing else" primitive — replaces the
// `request` row's own scalar fields and every request_* child table from `payload`, exactly
// like createProposal()/saveDraft() do, but never assigns request.status, resume_stage, or
// reviewer_comment. Deliberately has no opinion on which statuses may call it — that's an
// authorization/workflow decision for the caller (route handler), not this function. Meant to
// be the one shared "save in place" primitive for every "keep editing without changing where
// this sits in the workflow" case — e.g. an applicant editing a resubmission-required proposal
// (the current caller — see the /:id/save-edits route) — and, later, anything with the same
// shape (a reviewer drafting a comment without committing to approve/reject/resubmit, etc.),
// rather than each such case growing its own narrow save function like applicantResubmit()'s
// hardcoded 5-field allowlist did.
function saveRequestContent(requestId, payload, actorUserId) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  if (!applicant) throw new WorkflowError('Applicant not found for this proposal.', 400);
  if (actorUserId != null) assertProposalOwner(requestId, actorUserId);
  clearRequestChildRows(request.request_id);
  applyRequestScalarFields(request, payload, applicant);
  buildRequestChildRows(request, payload);
  const editorId = actorUserId != null ? Number(actorUserId) : applicant.user_id;
  recordHistory(request.request_id, null, null, 'save-content', editorId, primaryRoleCodeFor(editorId), null, request.status, request.status);
  return request;
}

// Deletes every child-table row for a request (all tables keyed by request_id, minus the
// request row itself) — used before re-writing a draft's child rows on every save-as-draft
// call, since drafts are edited repeatedly and each save should fully replace prior content
// rather than append duplicates.
const REQUEST_CHILD_TABLES = [
  'request_categories', 'application_requirements', 'event_schedule', 'co_owners', 'organizers',
  'important_people', 'general_guest', 'brief_agenda', 'request_discussion_topics',
  'request_logistics', 'request_transportation', 'request_photography_videography',
  'request_sound_light', 'request_fmb', 'request_campus_tour', 'request_mineral_water',
  'request_funding_purchase',
];
function clearRequestChildRows(requestId) {
  for (const table of REQUEST_CHILD_TABLES) {
    db[table] = db[table].filter((row) => row.request_id !== requestId);
  }
}

// Builds every request_* child table row from the event-proposal form's submission payload
// (Angular's EventProposalComponent, via proposal-workflow.routes.js's POST / and PUT /:id)
// onto an already-created `request` row. Shared by createProposal() (submits immediately) and
// saveDraft() (stays in status='draft').

// ---------------------------------------------------------------------------------------------
// Manager-configured options are SNAPSHOTS (system specification, core principle 2). The Angular
// pickers send the catalog reference `${kind}:${id}` (request-options.routes.js's projectOption);
// this resolves that reference ONCE at save time into the numeric FK plus a frozen copy of the
// option's label. Editing or archiving the option afterwards can never change an already-saved
// request row, because nothing re-reads the catalog on the way out.
//
// Before this existed, the raw reference string ("logistics:2") was written into BOTH the
// option_id column and the label column, so every department saw "logistics:2" where the item
// name should be.
// ---------------------------------------------------------------------------------------------
const OPTION_CATALOGS = {
  logistics: { table: 'logistics_options', pk: 'logistics_option_id' },
  transportation: { table: 'transportation_options', pk: 'transportation_option_id' },
  photoVideo: { table: 'media_options', pk: 'media_option_id' },
  soundLight: { table: 'sound_light_options', pk: 'sound_light_option_id' },
  fmb: { table: 'fmb_options', pk: 'fmb_option_id' },
  dietaryInformation: { table: 'dietary_information_options', pk: 'dietary_information_option_id' },
  servingUnit: { table: 'serving_unit_options', pk: 'serving_unit_option_id' },
  campusTourStart: { table: 'campus_tour_start_options', pk: 'campus_tour_start_option_id' },
  campusTourType: { table: 'campus_tour_type_options', pk: 'campus_tour_type_option_id' },
  waterNormal: { table: 'water_normal_options', pk: 'water_normal_option_id' },
  fundingMain: { table: 'funding_main_options', pk: 'funding_main_option_id' },
  fundingSub: { table: 'funding_sub_options', pk: 'funding_sub_option_id' },
};

// Accepts a `${kind}:${id}` reference, a bare numeric id, or a plain label (drafts saved before
// the id-backed pickers shipped, and the seeded demo rows, both use labels). Returns
// { optionId, label } with optionId null when nothing in the catalog matches.
function resolveOptionSnapshot(kind, reference) {
  const catalog = OPTION_CATALOGS[kind];
  const raw = reference == null ? '' : String(reference).trim();
  if (!catalog || !raw) return { optionId: null, label: raw };
  const rows = db[catalog.table] || [];

  const parts = raw.split(':');
  const numeric = Number(parts[parts.length - 1]);
  if (Number.isFinite(numeric) && String(numeric) === parts[parts.length - 1]) {
    const byId = rows.find((row) => row[catalog.pk] === numeric);
    if (byId) return { optionId: byId[catalog.pk], label: byId.label };
  }

  const byLabel = rows.find((row) => row.label === raw);
  if (byLabel) return { optionId: byLabel[catalog.pk], label: byLabel.label };
  // Unknown reference: keep whatever the applicant sent so nothing is silently lost.
  return { optionId: null, label: raw };
}

function buildRequestChildRows(request, payload) {
  // payload.eventCategories now carries event_category_id values (the Angular picker's `value` is
  // the catalog id, not the name — see event-proposal.ts's categoryOptions). The by-name fallback
  // below is a compatibility net for any in-flight draft saved under the old name-based payload
  // shape before this change shipped; it can be removed once no such drafts remain.
  for (const categoryRef of (payload.eventCategories || []).slice(0, maxEventCategories())) {
    const category = db.event_category.find((c) => c.event_category_id === Number(categoryRef)) || db.event_category.find((c) => c.name === categoryRef);
    if (category) db.request_categories.push({ request_id: request.request_id, category_id: category.event_category_id, category_name: category.name });
  }

  for (const requirementKey of payload.selectedRequirements || []) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementKey);
    if (requirement) db.application_requirements.push({ request_id: request.request_id, requirement_id: requirement.requirement_id });
  }

  for (const row of payload.scheduleRows || []) {
    db.event_schedule.push({ event_schedule_id: nextId('event_schedule'), request_id: request.request_id, date: row.date, start_time: row.start, end_time: row.end, location: row.location });
  }

  for (const row of payload.coOwners || []) {
    const [firstName, ...rest] = String(row.name || '').split(' ');
    db.co_owners.push({ co_owner_id: nextId('co_owners'), request_id: request.request_id, staff_id: null, staff_first_name: firstName || '', staff_last_name: rest.join(' '), staff_email: row.email || '', staff_role: row.role || null });
  }
  for (const row of payload.organizers || []) {
    const [firstName, ...rest] = String(row.name || '').split(' ');
    db.organizers.push({ organizer_id: nextId('organizers'), request_id: request.request_id, staff_id: null, staff_first_name: firstName || '', staff_last_name: rest.join(' '), staff_email: row.email || '', staff_role: row.role || null, note: row.notes || null });
  }
  for (const row of payload.importantPeople || []) {
    db.important_people.push({ important_person_id: nextId('important_people'), request_id: request.request_id, name: row.name, type: row.type, organization: row.organization || null, designation: row.designation || null });
  }
  for (const row of payload.guests || []) {
    db.general_guest.push({ general_guest_id: nextId('general_guest'), request_id: request.request_id, guest_type: row.guestType, count: Number(row.count) || 0, notes: row.notes || null });
  }
  for (const row of payload.agenda || []) {
    db.brief_agenda.push({ brief_agenda_id: nextId('brief_agenda'), request_id: request.request_id, time: row.time, activity: row.activity, location: row.location, pic: row.pic, notes: row.notes || null });
  }
  for (const row of payload.discussions || []) {
    db.request_discussion_topics.push({ request_discussion_topic_id: nextId('request_discussion_topics'), request_id: request.request_id, discussion_topic: row.topic });
  }

  const requestRows = payload.requestRows || {};
  for (const row of requestRows.logistics || []) {
    const item = resolveOptionSnapshot('logistics', row.item);
    db.request_logistics.push({ request_logistics_id: nextId('request_logistics'), request_id: request.request_id, option_id: item.optionId, item: item.label, quantity: Number(row.quantity) || 0, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.transportation || []) {
    const type = resolveOptionSnapshot('transportation', row.type);
    db.request_transportation.push({ request_transportation_id: nextId('request_transportation'), request_id: request.request_id, option_id: type.optionId, type: type.label, requested_pax: Number(row.requestedPax) || 0, pickup: row.pickup, dropoff: row.dropoff, date: row.date, moving_time: row.start, notes: row.notes || null });
  }
  for (const row of requestRows.photoVideo || []) {
    const service = resolveOptionSnapshot('photoVideo', row.service);
    db.request_photography_videography.push({ request_photography_videography_id: nextId('request_photography_videography'), request_id: request.request_id, option_id: service.optionId, service: service.label, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.soundLight || []) {
    const item = resolveOptionSnapshot('soundLight', row.item);
    db.request_sound_light.push({ request_sound_light_id: nextId('request_sound_light'), request_id: request.request_id, option_id: item.optionId, item: item.label, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.fmb || []) {
    const foodType = resolveOptionSnapshot('fmb', row.foodType);
    db.request_fmb.push({ request_fmb_id: nextId('request_fmb'), request_id: request.request_id, option_id: foodType.optionId, food_type: foodType.label, pax: Number(row.quantity) || 0, date: row.date, serve_time: row.start, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.campusTour || []) {
    const startPoint = resolveOptionSnapshot('campusTourStart', row.startPoint);
    const tourType = resolveOptionSnapshot('campusTourType', row.tourType);
    db.request_campus_tour.push({ request_campus_tour_id: nextId('request_campus_tour'), request_id: request.request_id, date: row.date, pax: Number(row.pax) || 0, start_point_option_id: startPoint.optionId, start_point: startPoint.label, tour_type_option_id: tourType.optionId, tour_type: tourType.label, notes: row.notes || null });
  }
  for (const row of requestRows.waterNormal || []) {
    // The Mineral Water picker's value IS the quantity option (e.g. "48 bottles"), so the
    // catalog row carries the real bottle count — the snapshot freezes both.
    const pack = resolveOptionSnapshot('waterNormal', row.quantity);
    const packRow = pack.optionId != null ? db.water_normal_options.find((o) => o.water_normal_option_id === pack.optionId) : null;
    db.request_mineral_water.push({ request_mineral_water_id: nextId('request_mineral_water'), request_id: request.request_id, option_id: pack.optionId, quantity: packRow ? Number(packRow.number_of_bottles) || 0 : Number(row.quantity) || 0, option_label: pack.label, with_logo: row.withLogo === 'Yes', date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.fundingPurchase || []) {
    const mainItem = resolveOptionSnapshot('fundingMain', row.mainItem);
    const subItem = resolveOptionSnapshot('fundingSub', row.subItem);
    db.request_funding_purchase.push({ request_funding_purchase_id: nextId('request_funding_purchase'), request_id: request.request_id, main_option_id: mainItem.optionId, main_item: mainItem.label, sub_option_id: subItem.optionId, sub_item: subItem.label, quantity: Number(row.quantity) || 0, unit_price_rm: Number(row.unit) || 0, notes: row.notes || null });
  }
}

// Server-side validation of a full proposal submission. The Angular form validates the same
// rules for immediate feedback, but this is the authority — a payload that reaches the API
// without passing here never enters the workflow (system specification §8E: "Validate all forms
// both client-side and server-side"). Deliberately only applied on SUBMIT/RESUBMIT paths, never
// on save-as-draft, since a draft is expected to be incomplete.
const REQUIRED_PROPOSAL_FIELDS = [
  ['eventTitle', 'Event title'],
  ['shortIntroduction', 'Short introduction'],
  ['goals', 'Goals and objectives'],
  ['benefits', 'Expected benefits'],
];
function validateProposalPayload(payload) {
  const errors = [];
  for (const [field, label] of REQUIRED_PROPOSAL_FIELDS) {
    if (!String(payload[field] ?? '').trim()) errors.push(`${label} is required.`);
  }

  const scheduleRows = (payload.scheduleRows || []).filter((row) => row && row.date && row.start && row.end && row.location);
  if (scheduleRows.length === 0) errors.push('At least one complete event schedule row (date, start, end, location) is required.');
  for (const row of scheduleRows) {
    if (String(row.end) <= String(row.start)) errors.push(`Schedule row on ${row.date}: the end time must be after the start time.`);
  }

  const selectedRequirements = payload.selectedRequirements || [];
  if (selectedRequirements.length === 0) errors.push('Select at least one requirement for this event.');
  for (const key of selectedRequirements) {
    if (!db.event_requirements.some((r) => r.requirement_name === key) && key !== 'waterNormal') {
      errors.push(`Unknown requirement "${key}".`);
    }
  }

  const categories = payload.eventCategories || [];
  const maxCategories = maxEventCategories();
  if (categories.length > maxCategories) {
    errors.push(`Select at most ${maxCategories} event categor${maxCategories === 1 ? 'y' : 'ies'}.`);
  }
  if (payload.eventVisibility === 'Public' && categories.length === 0) {
    errors.push('A public event needs at least one event category.');
  }

  const totalPax = Number(payload.totalPax);
  if (!Number.isFinite(totalPax) || totalPax < 0) errors.push('Total expected pax must be zero or more.');
  const maxPax = payload.maxPax;
  if (maxPax != null && maxPax !== '' && (!Number.isFinite(Number(maxPax)) || Number(maxPax) < 0)) {
    errors.push('Registration capacity must be zero or more.');
  }

  const cost = payload.costAmount;
  if (cost != null && cost !== '' && Number(cost) > 0) {
    if (!String(payload.bankAccountName ?? '').trim() || !String(payload.bankAccountNumber ?? '').trim()) {
      errors.push('A paid event needs both a bank account name and number so attendees can pay.');
    }
  }

  if (errors.length > 0) {
    const error = new WorkflowError(errors[0], 400);
    error.details = errors;
    throw error;
  }
}

function applyRequestScalarFields(request, payload, applicant) {
  request.applicant_name = applicant.full_name;
  request.applicant_email = applicant.email;
  request.applicant_department_or_school = payload.applicantDepartment || '';
  request.event_title = payload.eventTitle || '';
  request.short_introduction = payload.shortIntroduction || '';
  request.goals_objectives = payload.goals || '';
  request.expected_benefits = payload.benefits || '';
  request.event_visibility = payload.eventVisibility || 'Private';
  // payload.eventFormat now carries an event_format_id (the picker's `value`) — resolve to the
  // catalog row and freeze its name as the snapshot. Same by-name compatibility fallback as
  // buildRequestChildRows() above, for in-flight drafts saved before this change shipped.
  const format = db.event_format.find((f) => f.event_format_id === Number(payload.eventFormat)) || db.event_format.find((f) => f.name === payload.eventFormat);
  request.event_format_id = format ? format.event_format_id : null;
  request.event_format_snapshot = format ? format.name : (payload.eventFormat || 'On Campus');
  request.registration_approval = payload.registrationMode || 'Automatic';
  request.promotion_publicity_method = payload.publicity || null;
  request.event_image = payload.eventImage || null;
  request.total_pax = Number(payload.totalPax) || 0;
  request.max_pax = payload.maxPax != null ? Number(payload.maxPax) : null;
  // null (not 0) means "not entered" — distinct from an explicit free event.
  request.cost_amount = payload.costAmount != null ? Number(payload.costAmount) : null;
  request.bank_account_name = payload.bankAccountName || null;
  request.bank_account_number = payload.bankAccountNumber || null;
  request.updated_at = new Date().toISOString();
}

// Builds a full `request` row plus every request_* child table row from the event-proposal
// form's submission payload (Angular's EventProposalComponent.submit(), via
// proposal-workflow.routes.js's POST /), then immediately runs it through submitProposal() so
// it enters the workflow at the correct stage. If draftRequestId is given (the applicant opened
// a saved draft and is now submitting it for real), that existing draft row is converted in
// place instead of creating a second, duplicate request row.
function createProposal(payload, draftRequestId) {
  const applicant = db.users.find((u) => u.email === payload.applicantEmail);
  if (!applicant) throw new WorkflowError('Applicant not found for the given applicantEmail.', 400);
  // External (self-registered guest) accounts may explore, register and save public events, but
  // never submit a proposal — system specification §6.
  const { hasRole } = require('./user-access.service');
  if (hasRole(applicant.user_id, 'external-user')) {
    throw new WorkflowError('Guest accounts cannot submit event proposals.', 403);
  }
  validateProposalPayload(payload);

  let request = draftRequestId ? db.request.find((r) => r.request_id === Number(draftRequestId)) : null;
  if (request && request.status !== 'draft') throw new WorkflowError('This proposal is no longer a draft and cannot be submitted as one.', 400);
  if (request) assertProposalOwner(request.request_id, applicant.user_id);

  if (request) {
    clearRequestChildRows(request.request_id);
  } else {
    request = {
      request_id: nextId('request'),
      request_code: `EVT-${Date.now()}`,
      applicant_user_id: applicant.user_id,
      applicant_name: '', applicant_email: '', applicant_department_or_school: '',
      event_title: '', short_introduction: '', goals_objectives: '', expected_benefits: '',
      event_visibility: '', event_format_id: null, event_format_snapshot: '', registration_approval: '',
      promotion_publicity_method: null, event_image: null, total_pax: 0, max_pax: null,
      cost_amount: null, bank_account_name: null, bank_account_number: null,
      status: 'draft',
      submitted_at: null,
      cancelled_at: null,
      cancelled_by_user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resume_stage: null,
      reviewer_comment: null,
    };
    db.request.push(request);
  }

  applyRequestScalarFields(request, payload, applicant);
  buildRequestChildRows(request, payload);

  recordHistory(request.request_id, null, null, 'create', applicant.user_id, primaryRoleCodeFor(applicant.user_id), null, null, 'draft');
  return submitProposal(request.request_id);
}

// Creates (draftRequestId omitted) or updates (draftRequestId given) a `request` row that stays
// in status='draft' — never runs submitProposal(), so it does not enter the review workflow.
// Every "Save as Draft" click from the same form session should reuse the same request row
// rather than accumulating duplicates, so the caller (proposal-workflow.routes.js) passes back
// the id it got from the first save.
function saveDraft(payload, draftRequestId) {
  const applicant = db.users.find((u) => u.email === payload.applicantEmail);
  if (!applicant) throw new WorkflowError('Applicant not found for the given applicantEmail.', 400);
  const { hasRole } = require('./user-access.service');
  if (hasRole(applicant.user_id, 'external-user')) {
    throw new WorkflowError('Guest accounts cannot submit event proposals.', 403);
  }

  let request = draftRequestId ? db.request.find((r) => r.request_id === Number(draftRequestId)) : null;
  if (request && request.status !== 'draft') throw new WorkflowError('This proposal is no longer a draft and cannot be saved as one.', 400);
  // Updating an existing draft is only ever the owner's (or a co-owner's) to do — a draft id is
  // otherwise just a guessable integer.
  if (request) assertProposalOwner(request.request_id, applicant.user_id);

  if (request) {
    clearRequestChildRows(request.request_id);
  } else {
    request = {
      request_id: nextId('request'),
      request_code: `EVT-${Date.now()}`,
      applicant_user_id: applicant.user_id,
      applicant_name: '', applicant_email: '', applicant_department_or_school: '',
      event_title: '', short_introduction: '', goals_objectives: '', expected_benefits: '',
      event_visibility: '', event_format_id: null, event_format_snapshot: '', registration_approval: '',
      promotion_publicity_method: null, event_image: null, total_pax: 0, max_pax: null,
      cost_amount: null, bank_account_name: null, bank_account_number: null,
      status: 'draft',
      submitted_at: null,
      cancelled_at: null,
      cancelled_by_user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resume_stage: null,
      reviewer_comment: null,
    };
    db.request.push(request);
  }

  applyRequestScalarFields(request, payload, applicant);
  buildRequestChildRows(request, payload);
  recordHistory(request.request_id, null, null, draftRequestId ? 'draft-update' : 'draft-create', applicant.user_id, primaryRoleCodeFor(applicant.user_id), null, 'draft', 'draft');
  return request;
}

// Permanently removes a draft (status='draft' only — never a submitted proposal, which must go
// through cancelProposal() instead to preserve its workflow_history trail) and all its child
// rows. Used by the Drafts list's delete action.
function deleteDraft(requestId, actorUserId) {
  const request = findRequest(requestId);
  if (request.status !== 'draft') throw new WorkflowError('Only drafts can be deleted.', 400);
  if (actorUserId != null) assertProposalOwner(requestId, actorUserId);
  clearRequestChildRows(request.request_id);
  db.request = db.request.filter((r) => r.request_id !== request.request_id);
  db.workflow_history = db.workflow_history.filter((h) => h.request_id !== request.request_id);
}

// Cancelling a proposal cascades: every department task and every cafeteria order attached to it
// is marked 'cancelled' too, each with its own workflow_history row, so the departments and
// cafeteria staff who were mid-fulfilment see it disappear from their Inbox and land in History
// as cancelled rather than silently lingering as 'pending'/'preparing' work for a dead event
// (system specification §4, Cancellation).
function cancelProposal(requestId, actorUserId) {
  const request = findRequest(requestId);
  const previousStatus = request.status;
  if (['completed_approved', 'completed_rejected', 'cancelled'].includes(previousStatus)) {
    throw new WorkflowError(`Cannot cancel from status ${previousStatus}.`, 400);
  }
  if (!isProposalOwner(requestId, actorUserId)) {
    throw new WorkflowError('Only the applicant or a co-owner can cancel.', 403);
  }
  if (!isWithinCancellationWindow(requestId)) {
    throw new WorkflowError(`The cancellation deadline for this event has passed (cancellation closes ${cancellationDeadlineDays()} day(s) before the event date).`, 400);
  }

  const actorRole = primaryRoleCodeFor(actorUserId);
  const now = new Date().toISOString();
  request.status = 'cancelled';
  request.cancelled_at = now;
  request.cancelled_by_user_id = Number(actorUserId);
  request.updated_at = now;
  recordHistory(request.request_id, null, null, 'cancel', actorUserId, actorRole, null, previousStatus, 'cancelled');

  for (const task of db.request_task.filter((t) => t.request_id === request.request_id)) {
    if (task.status === 'cancelled' || task.status === 'completed') continue;
    const taskPrevious = task.status;
    task.status = 'cancelled';
    task.resolved_at = now;
    task.resolved_by_user_id = Number(actorUserId);
    recordHistory(request.request_id, task.request_task_id, task.requirement_id, 'cancel', actorUserId, actorRole, 'Cancelled because the proposal was cancelled.', taskPrevious, 'cancelled');
  }

  for (const selection of fmbSelectionsForRequest(request.request_id)) {
    if (selection.status === 'cancelled' || selection.status === 'fulfilled') continue;
    const selectionPrevious = selection.status;
    selection.status = 'cancelled';
    recordHistory(request.request_id, null, null, 'cancel-selection', actorUserId, actorRole, 'Cancelled because the proposal was cancelled.', selectionPrevious, 'cancelled');
  }

  return request;
}

// Every request_fmb_selection row belonging to a request, across all of its request_fmb rows.
function fmbSelectionsForRequest(requestId) {
  return db.request_fmb
    .filter((f) => f.request_id === Number(requestId))
    .flatMap((f) => db.request_fmb_selection.filter((s) => s.request_fmb_id === f.request_fmb_id));
}

// Called once, the moment a request enters department_review. Creates one request_task per
// DISTINCT requirement the applicant selected, EXCEPT waterNormal (mineral water, with-logo
// or not, is a single applicant-facing request now) — those attach to the SAME task as fmb
// (Phase 1's correction: F&B reviews food + water together, one task).
function createDepartmentTasks(requestId) {
  const applicationRequirements = db.application_requirements.filter((ar) => ar.request_id === Number(requestId));
  const requirementNames = applicationRequirements.map((ar) => {
    const requirement = db.event_requirements.find((r) => r.requirement_id === ar.requirement_id);
    if (!requirement) throw new WorkflowError('Event requirement not found.', 404);
    return requirement.requirement_name;
  });

  // Water rows never get their own task row — they're folded into 'fmb'. If the applicant
  // selected water but NOT fmb explicitly (the Angular form always includes fmb whenever water
  // is picked, per Task 2.5's corrected requirement checklist merge — but defend against it
  // anyway), still create exactly one 'fmb' task. Funding/Purchase is filtered out entirely:
  // its rows are stored for the record but it is not part of the approval workflow.
  const distinctTaskRequirements = [...new Set(requirementNames.map((name) => (name === 'waterNormal') ? 'fmb' : name))]
    .filter((name) => !NON_WORKFLOW_REQUIREMENTS.has(name));

  for (const requirementName of distinctTaskRequirements) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementName);
    if (!requirement) throw new WorkflowError('Event requirement not found.', 404);
    // Mutually exclusive per chk_request_task_assignment: the 5 Service department-routed
    // kinds get assigned_unit_code (assigned_role stays null); the 2 flat-routed kinds
    // (fundingPurchase -> cfo, fmb -> fmb) get assigned_role (assigned_unit_code stays null).
    const assignedUnitCode = UNIT_CODE_FOR_REQUIREMENT[requirementName] || null;
    const assignedRole = FLAT_ROLE_FOR_REQUIREMENT[requirementName] || null;
    db.request_task.push({
      request_task_id: nextId('request_task'),
      request_id: Number(requestId),
      requirement_id: requirement.requirement_id,
      stage_code: 'department_review',
      sequence_no: 1,
      assigned_unit_code: assignedUnitCode,
      assigned_role: assignedRole,
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

  // A proposal whose only requirements are non-workflow ones (e.g. Funding/Purchase alone) has
  // nothing left to fulfil, so department review completes the moment it opens — without this,
  // checkAllDepartmentTasksResolved()'s `tasks.length > 0` guard would leave it stuck in
  // department_review with no actor able to move it.
  if (distinctTaskRequirements.length === 0) {
    const request = findRequest(requestId);
    const previousStatus = request.status;
    request.status = 'completed_approved';
    request.updated_at = new Date().toISOString();
    recordHistory(requestId, null, null, 'auto-complete', null, 'system', 'No department fulfilment was required.', previousStatus, 'completed_approved');
  }
}

function findDepartmentTask(requestId, requirementKey) {
  const requirement = db.event_requirements.find((r) => r.requirement_name === requirementKey);
  if (!requirement) throw new WorkflowError('Department task not found.', 404);
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
  authorizeDepartmentTask(task, actorUserId);
  const previousStatus = task.status;
  task.status = 'approved';
  task.resolved_at = new Date().toISOString();
  task.resolved_by_user_id = Number(actorUserId);
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'approve', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'approved');

  // fmb is special: 'approve' here means F&B approved the FOOD+WATER REQUEST overall and is
  // about to create selection rows (a separate call — see the routes layer, which calls
  // createFmbSelection() once per cafeteria after this approval) — it does NOT immediately
  // mark the task 'completed'. Every other department's approve DOES immediately complete the
  // task once staff assignment has happened (assignStaffToTask marks it, not this function).
  //
  // Exception: a mineral-water-only request has no request_fmb rows to fan out into cafeteria
  // orders at all, so there is nothing left for checkFmbTaskResolved() to wait on — F&B's
  // approval IS the fulfilment, and the task completes here.
  if (requirementKey === 'fmb' && !db.request_fmb.some((f) => f.request_id === Number(requestId))) {
    task.status = 'completed';
    recordHistory(requestId, task.request_task_id, task.requirement_id, 'complete', actorUserId, primaryRoleCodeFor(actorUserId), null, 'approved', 'completed');
    checkAllDepartmentTasksResolved(requestId);
  }
  return task;
}

function resubmitDepartmentTask(requestId, requirementKey, actorUserId, comment) {
  const task = findDepartmentTask(requestId, requirementKey);
  authorizeDepartmentTask(task, actorUserId);
  const trimmedComment = String(comment || '').trim();
  // A department cannot reject — resubmit-with-comment is its only pushback, so the comment is
  // the entire message to the applicant and must actually say something.
  if (!trimmedComment) throw new WorkflowError('Explain what needs to change so the applicant can fix it.', 400);
  const previousStatus = task.status;
  task.status = 'resubmitted';
  task.comment = trimmedComment;
  comment = trimmedComment;
  recordHistory(requestId, task.request_task_id, task.requirement_id, 'resubmit', actorUserId, primaryRoleCodeFor(actorUserId), comment, previousStatus, 'resubmitted');
  // Per the design spec's "parallel independence": this does NOT touch request.status or any
  // sibling request_task row. The applicant sees this specific department's resubmission in
  // their inbox (a query concern for the routes layer, not this function) while every other
  // department's task continues unaffected.
  return task;
}

function assignStaffToTask(requestTaskId, staffUserId, assignedByUserId) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  // Only the head of the routed unit may assign, and only to someone who actually belongs to
  // that unit — otherwise a manager could hand their department's work to an unrelated account.
  authorizeDepartmentTask(task, assignedByUserId);
  if (task.assigned_unit_code) {
    const staffBelongsToUnit = db.user_unit_roles.some((uur) => uur.user_id === Number(staffUserId) && uur.unit_code === task.assigned_unit_code);
    if (!staffBelongsToUnit) throw new WorkflowError('That team member does not belong to this department.', 400);
  }
  if (db.task_assignment.some((a) => a.request_task_id === task.request_task_id && a.staff_user_id === Number(staffUserId))) {
    throw new WorkflowError('That team member is already assigned to this task.', 400);
  }
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

function updateTaskStatus(requestTaskId, status, actorUserId) {
  const task = db.request_task.find((t) => t.request_task_id === Number(requestTaskId));
  if (!task) throw new WorkflowError('Task not found.', 404);
  if (!['preparing', 'completed'].includes(status)) throw new WorkflowError('Staff can only set preparing or completed.', 400);
  // Only a staff member this task was actually assigned to may progress it — the frontend hides
  // other people's tasks, but this is the gate that enforces it.
  if (!db.task_assignment.some((a) => a.request_task_id === task.request_task_id && a.staff_user_id === Number(actorUserId))) {
    throw new WorkflowError('This task is not assigned to you.', 403);
  }
  if (task.status === 'cancelled') throw new WorkflowError('This task was cancelled and can no longer be updated.', 400);
  if (task.status === 'completed') throw new WorkflowError('This task is already completed.', 400);
  if (status === 'preparing' && task.status !== 'approved') {
    throw new WorkflowError('Only a newly assigned task can be moved to preparing.', 400);
  }
  const previousStatus = task.status;
  task.status = status;
  if (status === 'completed') { task.resolved_at = new Date().toISOString(); }
  recordHistory(task.request_id, task.request_task_id, task.requirement_id, status, actorUserId, 'staff', null, previousStatus, status);
  if (status === 'completed') checkAllDepartmentTasksResolved(task.request_id);
  return task;
}

function createFmbSelection(requestFmbId, cafeteriaUnitCode, fmbOptionId, menuItemLabel, quantity, notes) {
  const menuItem = resolveOptionSnapshot('fmb', fmbOptionId);
  const selection = {
    request_fmb_selection_id: nextId('request_fmb_selection'),
    request_fmb_id: Number(requestFmbId),
    unit_code: cafeteriaUnitCode,
    fmb_option_id: menuItem.optionId,
    menu_item_label: menuItemLabel || menuItem.label,
    quantity: Number(quantity),
    status: 'pending',
    notes: notes || null,
    // Set by resubmitFmbSelection() when the owning Cafeteria Manager pushes this specific order
    // back to F&B — cleared again once F&B edits and re-sends it. Mock-layer addition alongside
    // claimed_by_user_id below (not in the original DDL).
    manager_comment: null,
    // NOT part of the original ems_database_schema.sql request_fmb_selection table — a
    // mock-layer addition (mirrors request.resume_stage's precedent) so the staff-tasks router
    // can resolve "who claimed/fulfilled THIS specific selection" without misattributing across
    // sibling selections on the same request (workflow_history's request_id-scoped rows can't
    // distinguish between multiple concurrently-claimed selections on one request).
    claimed_by_user_id: null,
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
  if (selection.status !== 'pending') throw new WorkflowError('This order is not awaiting your review.', 400);
  const previousStatus = selection.status;
  selection.status = 'approved';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'approve-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'approved');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// Cafeteria Manager resubmits ONE selection row -> goes back to F&B with status
// 'resubmitted'. Per the design spec, this does NOT touch the applicant or the parent
// request_task's status at all — it's purely a signal that F&B needs to edit this row.
function resubmitFmbSelection(selectionId, actorUserId, comment) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'pending') throw new WorkflowError('This order is not awaiting your review.', 400);
  const trimmedComment = String(comment || '').trim();
  if (!trimmedComment) throw new WorkflowError('Explain what needs to change so F&B can fix this order.', 400);
  const previousStatus = selection.status;
  selection.status = 'resubmitted';
  // Stored on the selection row itself (not the parent request_task) so F&B sees exactly which
  // order was pushed back and why — sibling orders for other cafeterias are unaffected.
  selection.manager_comment = trimmedComment;
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'resubmit-selection', actorUserId, primaryRoleCodeFor(actorUserId), trimmedComment, previousStatus, 'resubmitted');
  return selection;
}

// F&B edits a resubmitted row — dish, quantity, and/or cafeteria — then it goes straight back
// to whichever Cafeteria Manager now owns it (same one if the cafeteria is unchanged, a
// different one if F&B switched it). No separate "re-approve" step: saving the edit IS the
// re-send, per the design spec.
function editFmbSelection(selectionId, updates, actorUserId) {
  const selection = findFmbSelection(selectionId);
  if (!isManagerOfUnit(actorUserId, FMB_UNIT_CODE)) {
    throw new WorkflowError('Only Food & Beverage Services can edit a cafeteria order.', 403);
  }
  if (!['pending', 'resubmitted'].includes(selection.status)) {
    throw new WorkflowError('This order has already been approved and can no longer be edited.', 400);
  }
  const previousStatus = selection.status;
  if (updates.cancel) {
    selection.status = 'cancelled';
    recordHistory(requestIdForFmbSelection(selectionId), null, null, 'cancel-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'cancelled');
    checkFmbTaskResolved(selectionId);
    return selection;
  }
  if (updates.cafeteriaCode !== undefined) selection.unit_code = updates.cafeteriaCode;
  if (updates.fmbOptionId !== undefined) selection.fmb_option_id = resolveOptionSnapshot('fmb', updates.fmbOptionId).optionId;
  if (updates.menuItemLabel !== undefined) selection.menu_item_label = updates.menuItemLabel;
  if (updates.quantity !== undefined) selection.quantity = Number(updates.quantity);
  if (updates.notes !== undefined) selection.notes = updates.notes;
  // Saving the edit IS the re-send: the row goes straight back to whichever cafeteria now owns
  // it (the same manager, or a different one if F&B switched cafeterias). The manager's pushback
  // comment is cleared now that it has been acted on.
  selection.status = 'pending';
  selection.manager_comment = null;
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'edit-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'pending');
  return selection;
}

// First staff member to claim a shared-pool task owns it — it then leaves every other
// eligible staff member's inbox. Modeled here at the selection level: claiming stamps
// claimed_by_user_id directly on the request_fmb_selection row (a mock-layer addition — see
// staff-tasks.routes.js's claimingStaffEmail), scoped further by which cafeteria this specific
// staff member is assigned to (checked by the routes layer before calling this, using
// cafeteria_assignment).
function isCafeteriaStaffOf(userId, cafeteriaCode) {
  return db.user_unit_roles.some((uur) => uur.user_id === Number(userId) && uur.unit_code === cafeteriaCode && uur.role_code === 'cafeteria-staff');
}

function claimSharedFmbSelection(selectionId, staffUserId) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'approved') throw new WorkflowError('This order is not available to claim.', 400);
  // Shared pool, but scoped: only staff assigned to THIS cafeteria may claim its orders. First
  // claim wins — the row then leaves everyone else's inbox (its status is no longer 'approved').
  if (!isCafeteriaStaffOf(staffUserId, selection.unit_code)) {
    throw new WorkflowError('You are not assigned to the cafeteria this order belongs to.', 403);
  }
  selection.status = 'preparing';
  selection.claimed_by_user_id = Number(staffUserId);
  const requestId = requestIdForFmbSelection(selectionId);
  recordHistory(requestId, null, null, 'claim-selection', staffUserId, 'cafeteria-staff', null, 'approved', 'preparing');
  return selection;
}

function fulfilFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'preparing') throw new WorkflowError('Claim this order before marking it fulfilled.', 400);
  if (selection.claimed_by_user_id !== Number(actorUserId)) {
    throw new WorkflowError('This order was claimed by another staff member.', 403);
  }
  const previousStatus = selection.status;
  selection.status = 'fulfilled';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'fulfil-selection', actorUserId, 'cafeteria-staff', null, previousStatus, 'fulfilled');
  checkFmbTaskResolved(selectionId);
  return selection;
}

// The fmb request_task is "resolved" once every one of its selection rows has reached a
// terminal state (fulfilled or cancelled) — mirrors checkAllDepartmentTasksResolved's overall
// pattern but scoped to this one task's selection rows instead of sibling request_task rows.
function checkFmbTaskResolved(selectionId) {
  const requestId = requestIdForFmbSelection(selectionId);
  // Internal resolution check, not a user-facing lookup: if data inconsistency means no
  // 'fmb' department task exists, there's nothing to resolve — soft no-op rather than
  // letting the 404 WorkflowError from findDepartmentTask crash the calling
  // approve/edit/fulfil operation.
  let fmbTask;
  try {
    fmbTask = findDepartmentTask(requestId, 'fmb');
  } catch (err) {
    if (err instanceof WorkflowError && err.status === 404) return;
    throw err;
  }
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
  init,
  WorkflowError,
  findRequest,
  isHosHodOfUnit,
  isManagerOfUnit,
  UNIT_CODE_FOR_REQUIREMENT,
  FLAT_ROLE_FOR_REQUIREMENT,
  FMB_UNIT_CODE,
  authorizeAction,
  authorizeDepartmentTask,
  isProposalOwner,
  assertProposalOwner,
  isWithinCancellationWindow,
  cancellationDeadlineDays,
  maxEventCategories,
  validateProposalPayload,
  fmbSelectionsForRequest,
  isCafeteriaStaffOf,
  submitProposal,
  createProposal,
  saveDraft,
  saveRequestContent,
  deleteDraft,
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
  resolveOptionSnapshot,
  findFmbSelection,
  approveFmbSelection,
  resubmitFmbSelection,
  editFmbSelection,
  claimSharedFmbSelection,
  fulfilFmbSelection,
};
