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
const FLAT_ROLE_FOR_REQUIREMENT = {
  fundingPurchase: 'cfo',
  fmb: 'fmb',
};
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

// Called once, right after the applicant's form-submit action creates the `request` row with
// status='draft'. Decides the FIRST real stage per the self-review/CFO-skip rules (Phase 1's
// corrected workflow diagram).
function submitProposal(requestId) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  const previousStatus = request.status;

  const { hasRole } = require('./user-access.service');
  let nextStatus;
  if (isHosHodOfUnit(applicant.user_id, request)) {
    // Self-review: skip hos_hod_review entirely, go straight to the F&B/CFO check.
    nextStatus = request.total_pax > highPaxThreshold() ? 'fmb_review' : 'department_review';
  } else if (hasRole(applicant.user_id, 'cfo') || isManagerOfUnit(applicant.user_id, FMB_UNIT_CODE)) {
    // CFO/F&B manager applying for themselves: skip ALL higher approval.
    nextStatus = 'department_review';
  } else {
    nextStatus = 'hos_hod_review';
  }

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
function applicantResubmit(requestId, payload) {
  const request = findRequest(requestId);
  if (request.status !== 'resubmission_required') {
    throw new WorkflowError(`Cannot resubmit from status ${request.status}.`, 400);
  }
  if (payload) saveRequestContent(requestId, payload);
  const resumeStatus = request.resume_stage || 'hos_hod_review';
  const previousStatus = request.status;
  request.status = resumeStatus;
  request.resume_stage = null;
  request.reviewer_comment = null;
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'applicant-resubmit', request.applicant_user_id, 'applicant', null, previousStatus, resumeStatus);
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
function saveRequestContent(requestId, payload) {
  const request = findRequest(requestId);
  const applicant = db.users.find((u) => u.user_id === request.applicant_user_id);
  if (!applicant) throw new WorkflowError('Applicant not found for this proposal.', 400);
  clearRequestChildRows(request.request_id);
  applyRequestScalarFields(request, payload, applicant);
  buildRequestChildRows(request, payload);
  recordHistory(request.request_id, null, null, 'save-content', applicant.user_id, primaryRoleCodeFor(applicant.user_id), null, request.status, request.status);
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
function buildRequestChildRows(request, payload) {
  // payload.eventCategories now carries event_category_id values (the Angular picker's `value` is
  // the catalog id, not the name — see event-proposal.ts's categoryOptions). The by-name fallback
  // below is a compatibility net for any in-flight draft saved under the old name-based payload
  // shape before this change shipped; it can be removed once no such drafts remain.
  for (const categoryRef of payload.eventCategories || []) {
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
    db.request_logistics.push({ request_logistics_id: nextId('request_logistics'), request_id: request.request_id, option_id: row.item || null, item: row.item, quantity: Number(row.quantity) || 0, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.transportation || []) {
    db.request_transportation.push({ request_transportation_id: nextId('request_transportation'), request_id: request.request_id, option_id: row.type || null, type: row.type, requested_pax: Number(row.requestedPax) || 0, pickup: row.pickup, dropoff: row.dropoff, date: row.date, moving_time: row.start, notes: row.notes || null });
  }
  for (const row of requestRows.photoVideo || []) {
    db.request_photography_videography.push({ request_photography_videography_id: nextId('request_photography_videography'), request_id: request.request_id, option_id: row.service || null, service: row.service, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.soundLight || []) {
    db.request_sound_light.push({ request_sound_light_id: nextId('request_sound_light'), request_id: request.request_id, option_id: row.item || null, item: row.item, date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.fmb || []) {
    db.request_fmb.push({ request_fmb_id: nextId('request_fmb'), request_id: request.request_id, option_id: row.foodType || null, food_type: row.foodType, pax: Number(row.quantity) || 0, date: row.date, serve_time: row.start, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.campusTour || []) {
    db.request_campus_tour.push({ request_campus_tour_id: nextId('request_campus_tour'), request_id: request.request_id, date: row.date, pax: Number(row.pax) || 0, start_point_option_id: row.startPoint || null, start_point: row.startPoint, tour_type_option_id: row.tourType || null, tour_type: row.tourType, notes: row.notes || null });
  }
  for (const row of requestRows.waterNormal || []) {
    db.request_mineral_water.push({ request_mineral_water_id: nextId('request_mineral_water'), request_id: request.request_id, option_id: row.quantity || null, quantity: Number(row.quantity) || 0, with_logo: row.withLogo === 'Yes', date: row.date, start_time: row.start, end_time: row.end, location: row.location, notes: row.notes || null });
  }
  for (const row of requestRows.fundingPurchase || []) {
    db.request_funding_purchase.push({ request_funding_purchase_id: nextId('request_funding_purchase'), request_id: request.request_id, main_option_id: row.mainItem || null, main_item: row.mainItem, sub_option_id: row.subItem || null, sub_item: row.subItem, quantity: Number(row.quantity) || 0, unit_price_rm: Number(row.unit) || 0, notes: row.notes || null });
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

  let request = draftRequestId ? db.request.find((r) => r.request_id === Number(draftRequestId)) : null;
  if (request && request.status !== 'draft') throw new WorkflowError('This proposal is no longer a draft and cannot be submitted as one.', 400);

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

  let request = draftRequestId ? db.request.find((r) => r.request_id === Number(draftRequestId)) : null;
  if (request && request.status !== 'draft') throw new WorkflowError('This proposal is no longer a draft and cannot be saved as one.', 400);

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
function deleteDraft(requestId) {
  const request = findRequest(requestId);
  if (request.status !== 'draft') throw new WorkflowError('Only drafts can be deleted.', 400);
  clearRequestChildRows(request.request_id);
  db.request = db.request.filter((r) => r.request_id !== request.request_id);
  db.workflow_history = db.workflow_history.filter((h) => h.request_id !== request.request_id);
}

function cancelProposal(requestId, actorUserId) {
  const request = findRequest(requestId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = request.status;
  if (['completed_approved', 'completed_rejected', 'cancelled'].includes(previousStatus)) {
    throw new WorkflowError(`Cannot cancel from status ${previousStatus}.`, 400);
  }
  request.status = 'cancelled';
  request.cancelled_at = new Date().toISOString();
  request.cancelled_by_user_id = Number(actorUserId);
  request.updated_at = new Date().toISOString();
  recordHistory(request.request_id, null, null, 'cancel', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'cancelled');
  return request;
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
  // anyway), still create exactly one 'fmb' task.
  const distinctTaskRequirements = [...new Set(requirementNames.map((name) => (name === 'waterNormal') ? 'fmb' : name))];

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
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
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
  return task;
}

function resubmitDepartmentTask(requestId, requirementKey, actorUserId, comment) {
  const task = findDepartmentTask(requestId, requirementKey);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = task.status;
  task.status = 'resubmitted';
  task.comment = comment;
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

function createFmbSelection(requestFmbId, cafeteriaUnitCode, fmbOptionId, menuItemLabel, quantity, notes) {
  const selection = {
    request_fmb_selection_id: nextId('request_fmb_selection'),
    request_fmb_id: Number(requestFmbId),
    unit_code: cafeteriaUnitCode,
    fmb_option_id: Number(fmbOptionId),
    menu_item_label: menuItemLabel,
    quantity: Number(quantity),
    status: 'pending',
    notes: notes || null,
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
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  selection.status = 'approved';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'approve-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'approved');
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
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'resubmit-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'resubmitted');
  return selection;
}

// F&B edits a resubmitted row — dish, quantity, and/or cafeteria — then it goes straight back
// to whichever Cafeteria Manager now owns it (same one if the cafeteria is unchanged, a
// different one if F&B switched it). No separate "re-approve" step: saving the edit IS the
// re-send, per the design spec.
function editFmbSelection(selectionId, updates, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const actor = db.users.find((u) => u.user_id === Number(actorUserId));
  const previousStatus = selection.status;
  if (updates.cancel) {
    selection.status = 'cancelled';
    recordHistory(requestIdForFmbSelection(selectionId), null, null, 'cancel-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'cancelled');
    checkFmbTaskResolved(selectionId);
    return selection;
  }
  if (updates.cafeteriaCode !== undefined) selection.unit_code = updates.cafeteriaCode;
  if (updates.fmbOptionId !== undefined) selection.fmb_option_id = Number(updates.fmbOptionId);
  if (updates.menuItemLabel !== undefined) selection.menu_item_label = updates.menuItemLabel;
  if (updates.quantity !== undefined) selection.quantity = Number(updates.quantity);
  if (updates.notes !== undefined) selection.notes = updates.notes;
  selection.status = 'pending';
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'edit-selection', actorUserId, primaryRoleCodeFor(actorUserId), null, previousStatus, 'pending');
  return selection;
}

// First staff member to claim a shared-pool task owns it — it then leaves every other
// eligible staff member's inbox. Modeled here at the selection level: claiming stamps
// claimed_by_user_id directly on the request_fmb_selection row (a mock-layer addition — see
// staff-tasks.routes.js's claimingStaffEmail), scoped further by which cafeteria this specific
// staff member is assigned to (checked by the routes layer before calling this, using
// cafeteria_assignment).
function claimSharedFmbSelection(selectionId, staffUserId) {
  const selection = findFmbSelection(selectionId);
  if (selection.status !== 'approved') throw new WorkflowError('This order is not available to claim.', 400);
  selection.status = 'preparing';
  selection.claimed_by_user_id = Number(staffUserId);
  const requestId = requestIdForFmbSelection(selectionId);
  recordHistory(requestId, null, null, 'claim-selection', staffUserId, 'cafeteria_staff', null, 'approved', 'preparing');
  return selection;
}

function fulfilFmbSelection(selectionId, actorUserId) {
  const selection = findFmbSelection(selectionId);
  const previousStatus = selection.status;
  selection.status = 'fulfilled';
  selection.claimed_by_user_id = Number(actorUserId);
  recordHistory(requestIdForFmbSelection(selectionId), null, null, 'fulfil-selection', actorUserId, 'cafeteria_staff', null, previousStatus, 'fulfilled');
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
  findFmbSelection,
  approveFmbSelection,
  resubmitFmbSelection,
  editFmbSelection,
  claimSharedFmbSelection,
  fulfilFmbSelection,
};
