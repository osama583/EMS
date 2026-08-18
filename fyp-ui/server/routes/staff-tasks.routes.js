const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

const router = express.Router();

// request_task.assigned_unit_code is set to the Service department's unit code for the 5
// unit-routed requirement kinds (logistics/transportation/photoVideo/soundLight/campusTour — see
// workflow.service.js's UNIT_CODE_FOR_REQUIREMENT). Angular sends the acting staff/manager's own
// `unitCode` (looked up client-side from one of the user's unit-scoped role assignments) instead
// of a role string, so this route compares assigned_unit_code directly against it.
function unitCodeForUser(userId) {
  const link = db.user_unit_roles.find((uur) => uur.user_id === userId && uur.unit_code);
  return link ? link.unit_code : '';
}

// Maps a department requirement key (request_task.assigned_role space, per
// workflow.service.js's createDepartmentTasks) onto the human labels used in the StaffTask
// projection. Mirrors proposal-projection.service.js's departmentRequestsFor per-department item
// derivation, but reduced to the fields StaffTask needs (request/quantity/schedule/location).
function departmentTaskDetails(requestId, requirementName) {
  const window = (date, start, end) => `${date} · ${start}-${end}`;
  const at = (date, time) => `${date} · ${time}`;
  // Column names below track ems_database_schema.sql exactly: transportation stores moving_time
  // + pickup/dropoff (no end_time/location), photography/videography and campus tour dropped
  // their personnel/coverage and time/location columns, and request_fmb stores serve_time.
  // Reading the dropped columns used to render "undefined-undefined" in the staff task list.
  switch (requirementName) {
    case 'logistics':
      return db.request_logistics.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.item, quantity: String(row.quantity), schedule: window(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '',
      }));
    case 'transportation':
      return db.request_transportation.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.type, quantity: `${row.requested_pax} pax`, schedule: at(row.date, row.moving_time), location: `${row.pickup} → ${row.dropoff}`, detail: row.notes || '',
      }));
    case 'photoVideo':
      return db.request_photography_videography.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.service, quantity: undefined, schedule: window(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '',
      }));
    case 'soundLight':
      return db.request_sound_light.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.item, quantity: undefined, schedule: window(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '',
      }));
    case 'campusTour':
      return db.request_campus_tour.filter((r) => r.request_id === requestId).map((row) => ({
        request: `${row.start_point} · ${row.tour_type}`, quantity: `${row.pax} pax`, schedule: row.date, location: row.start_point, detail: row.notes || '',
      }));
    case 'fmb': {
      const food = db.request_fmb.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.food_type, quantity: `${row.pax} pax`, schedule: at(row.date, row.serve_time), location: row.location, detail: row.notes || '',
      }));
      // Mineral water shares the F&B department task (one review covers food + water together).
      const water = db.request_mineral_water.filter((r) => r.request_id === requestId).map((row) => ({
        request: row.with_logo ? 'Mineral Water (with logo)' : 'Mineral Water', quantity: `${row.quantity} bottles`, schedule: window(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '',
      }));
      return [...food, ...water];
    }
    default:
      return [];
  }
}

// Maps request_task.status -> StaffTaskStatus ('assigned' | 'preparing' | 'completed' per
// Task 2.6's corrected type). 'approved' means the task was assigned to a staff member and
// they haven't started yet.
function mapTaskStatus(status) {
  if (status === 'approved') return 'assigned';
  if (status === 'preparing') return 'preparing';
  if (status === 'completed') return 'completed';
  return status;
}

// One request_task can cover several requested rows (three logistics items, two vehicles, ...).
// Every row is surfaced as its own StaffTask entry so the assignee sees the full ask rather than
// only the first row, but they all share the SAME request_task_id - acting on any one of them
// progresses the single underlying task.
function projectDepartmentTasks(task, assignedToEmail) {
  const requirement = db.event_requirements.find((r) => r.requirement_id === task.requirement_id);
  if (!requirement) throw new WorkflowError('Event requirement not found for this task.', 404);
  const rows = departmentTaskDetails(task.request_id, requirement.requirement_name);
  if (rows.length === 0) return [projectDepartmentTask(task, assignedToEmail)];
  return rows.map((row, index) => projectDepartmentTask(task, assignedToEmail, row, index));
}

function projectDepartmentTask(task, assignedToEmail, row, index = 0) {
  const request = db.request.find((r) => r.request_id === task.request_id);
  if (!request) throw new WorkflowError('Proposal not found for this task.', 404);
  const requirement = db.event_requirements.find((r) => r.requirement_id === task.requirement_id);
  if (!requirement) throw new WorkflowError('Event requirement not found for this task.', 404);
  const details = row || departmentTaskDetails(task.request_id, requirement.requirement_name)[0] || { request: requirement.requirement_name, quantity: undefined, schedule: '', location: '', detail: '' };
  return {
    id: String(task.request_task_id),
    rowKey: `${task.request_task_id}:${index}`,
    // Kept as `role` on the wire for the Angular StaffTask shape's backward-compat field name,
    // but the VALUE is now a unit_code (or, for the two flat-routed kinds, the flat role string
    // 'cfo'/'fmb') rather than a manager role token — see assigned_unit_code/assigned_role above.
    role: task.assigned_unit_code || task.assigned_role,
    assignedToEmail,
    eventCode: request.request_code,
    eventTitle: request.event_title,
    request: details.request,
    quantity: details.quantity,
    schedule: details.schedule,
    location: details.location,
    detailLabel: 'Department notes',
    detail: task.comment || details.detail || '',
    status: mapTaskStatus(task.status),
    completedAt: task.status === 'completed' ? task.resolved_at || undefined : undefined,
  };
}

// claimSharedFmbSelection / fulfilFmbSelection (workflow.service.js) stamp claimed_by_user_id
// directly on the selection row — a mock-layer addition to request_fmb_selection (not part of
// the original schema, mirrors request.resume_stage's precedent). Resolving identity via
// workflow_history's request_id-scoped rows was tried first but is WRONG when a request has
// multiple F&B selections (e.g. several cafeterias) claimed by different staff members, since
// history rows aren't scoped to a specific selection — only to the parent request.
function claimingStaffEmail(selectionId) {
  const selection = db.request_fmb_selection.find((s) => s.request_fmb_selection_id === selectionId);
  if (!selection || !selection.claimed_by_user_id) return '';
  const user = db.users.find((u) => u.user_id === selection.claimed_by_user_id);
  return user ? user.email : '';
}

function projectFmbSelection(selection, assignedToEmail) {
  const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === selection.request_fmb_id);
  if (!fmbRow) throw new WorkflowError('F&B request not found for this selection.', 404);
  const request = db.request.find((r) => r.request_id === fmbRow.request_id);
  if (!request) throw new WorkflowError('Proposal not found for this selection.', 404);
  const cafeteria = db.unit.find((u) => u.code === selection.unit_code);
  return {
    id: `fmb-selection:${selection.request_fmb_selection_id}`,
    rowKey: `fmb-selection:${selection.request_fmb_selection_id}`,
    role: 'cafeteria-staff',
    assignedToEmail: assignedToEmail || '',
    eventCode: request.request_code,
    eventTitle: request.event_title,
    request: selection.menu_item_label,
    quantity: String(selection.quantity),
    schedule: `${fmbRow.date} · ${fmbRow.serve_time}`,
    location: fmbRow.location,
    detailLabel: 'Cafeteria',
    detail: cafeteria ? cafeteria.description : '',
    status: selection.status === 'approved' ? 'assigned' : selection.status === 'preparing' ? 'preparing' : selection.status === 'fulfilled' ? 'completed' : selection.status,
  };
}

router.get('/', async (req, res, next) => {
  try {
    // `role` query param is retained on the wire for backward compat with the Angular caller's
    // param name, but its VALUE is now the acting user's own unitCode for the 5 unit-routed
    // kinds (or a flat role string for cfo/fmb/cafeteria-staff) — see the comment above.
    const { role, assignedToEmail } = req.query;
    const staffUser = db.users.find((u) => u.email === assignedToEmail);
    const tasks = [];

    if (staffUser) {
      const myAssignments = db.task_assignment.filter((a) => a.staff_user_id === staffUser.user_id);
      for (const assignment of myAssignments) {
        const task = db.request_task.find((t) => t.request_task_id === assignment.request_task_id);
        // Cancelled tasks stay visible (they belong in the assignee's History as cancelled -
        // system specification section 4); the frontend buckets them by status.
        if (task && (task.assigned_unit_code === role || task.assigned_role === role)) tasks.push(...projectDepartmentTasks(task, assignedToEmail));
      }
    }

    if (role === 'cafeteria-staff' && staffUser) {
      // Rows this staff member has already claimed (preparing/fulfilled) — resolved via
      // claimed_by_user_id, stamped directly on the selection row by claimSharedFmbSelection.
      for (const selection of db.request_fmb_selection) {
        if (selection.status !== 'preparing' && selection.status !== 'fulfilled') continue;
        if (claimingStaffEmail(selection.request_fmb_selection_id) === assignedToEmail) {
          tasks.push(projectFmbSelection(selection, assignedToEmail));
        }
      }

      // Shared inbox: approved-but-unclaimed rows for any cafeteria this staff member holds a
      // 'cafeteria-staff' user_unit_roles row at (a Cafeteria is a Unit — see
      // server/db.js's seedCafeteriaDomain()).
      const myCafeteriaCodes = new Set(db.user_unit_roles.filter((uur) => uur.user_id === staffUser.user_id && uur.role_code === 'cafeteria-staff').map((uur) => uur.unit_code));
      for (const selection of db.request_fmb_selection) {
        if (selection.status !== 'approved') continue;
        if (!myCafeteriaCodes.has(selection.unit_code)) continue;
        tasks.push(projectFmbSelection(selection, ''));
      }
    }

    res.json(tasks);
  } catch (err) { next(err); }
});

// Angular's assignRequests() (proposal-department-view.ts) sends department-level context
// (eventCode, request item label) rather than a request_task_id directly — look up the
// matching request via request_code, then the department's request_task by assigned_unit_code
// (or assigned_role for the two flat-routed kinds).
router.post('/assignments', async (req, res, next) => {
  try {
    // `role` here is now the unit_code being assigned into (assignRequests() sends the
    // manager's own unitCode, since staff being assigned share the SAME unit as their manager —
    // there's no separate "staff role" to map anymore).
    const { role, assignedToEmail, eventCode, assignedByEmail } = req.body;
    const request = db.request.find((r) => r.request_code === eventCode);
    if (!request) throw new WorkflowError('Event not found for the given eventCode.', 400);
    const task = db.request_task.find((t) => t.request_id === request.request_id && (t.assigned_unit_code === role || t.assigned_role === role) && t.stage_code === 'department_review');
    if (!task) throw new WorkflowError('Department task not found for the given role.', 400);
    const staffUser = db.users.find((u) => u.email === assignedToEmail);
    if (!staffUser) throw new WorkflowError('Staff member not found for the given assignedToEmail.', 400);

    // The assigning manager is the real logged-in user (Angular sends assignedByEmail), not a
    // best-guess lookup - assignStaffToTask() then verifies they actually head this task's unit
    // and that the assignee belongs to it.
    const manager = db.users.find((u) => u.email === assignedByEmail);
    if (!manager) throw new WorkflowError('Assigning manager not found for the given assignedByEmail.', 400);

    workflow.assignStaffToTask(task.request_task_id, staffUser.user_id, manager.user_id);
    res.json(projectDepartmentTask(db.request_task.find((t) => t.request_task_id === task.request_task_id), assignedToEmail));
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, staffEmail } = req.body;
    const idParam = req.params.id;

    if (idParam.startsWith('fmb-selection:')) {
      const selectionId = Number(idParam.slice('fmb-selection:'.length));
      const staffUser = db.users.find((u) => u.email === staffEmail);
      if (!staffUser) throw new WorkflowError('Staff member not found for the given staffEmail.', 400);
      let selection;
      if (status === 'preparing') selection = workflow.claimSharedFmbSelection(selectionId, staffUser.user_id);
      else if (status === 'completed') selection = workflow.fulfilFmbSelection(selectionId, staffUser.user_id);
      else throw new WorkflowError('Staff can only set preparing or completed.', 400);
      res.json(projectFmbSelection(selection, staffEmail));
      return;
    }

    const actor = db.users.find((u) => u.email === staffEmail);
    if (!actor) throw new WorkflowError('Staff member not found for the given staffEmail.', 400);
    const task = workflow.updateTaskStatus(idParam, status, actor.user_id);
    res.json(projectDepartmentTask(task, actor.email));
  } catch (err) { next(err); }
});

module.exports = router;
