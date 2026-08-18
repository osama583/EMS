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
  const scheduleStr = (date, start, end) => `${date} · ${start}-${end}`;
  switch (requirementName) {
    case 'logistics': {
      const row = db.request_logistics.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.item, quantity: String(row.quantity), schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '' };
    }
    case 'transportation': {
      const row = db.request_transportation.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.type, quantity: `${row.requested_pax} pax`, schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '' };
    }
    case 'photoVideo': {
      const row = db.request_photography_videography.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.service, quantity: String(row.personnel_quantity), schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.coverage || row.notes || '' };
    }
    case 'soundLight': {
      const row = db.request_sound_light.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.item, quantity: undefined, schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '' };
    }
    case 'campusTour': {
      const row = db.request_campus_tour.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.start_point, quantity: `${row.pax} pax`, schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '' };
    }
    case 'fmb': {
      const row = db.request_fmb.find((r) => r.request_id === requestId);
      if (!row) return null;
      return { request: row.food_type, quantity: `${row.pax} pax`, schedule: scheduleStr(row.date, row.start_time, row.end_time), location: row.location, detail: row.notes || '' };
    }
    default:
      return null;
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

function projectDepartmentTask(task, assignedToEmail) {
  const request = db.request.find((r) => r.request_id === task.request_id);
  if (!request) throw new WorkflowError('Proposal not found for this task.', 404);
  const requirement = db.event_requirements.find((r) => r.requirement_id === task.requirement_id);
  if (!requirement) throw new WorkflowError('Event requirement not found for this task.', 404);
  const details = departmentTaskDetails(task.request_id, requirement.requirement_name) || { request: requirement.requirement_name, quantity: undefined, schedule: '', location: '', detail: '' };
  return {
    id: String(task.request_task_id),
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
    role: 'cafeteria-staff',
    assignedToEmail: assignedToEmail || '',
    eventCode: request.request_code,
    eventTitle: request.event_title,
    request: selection.menu_item_label,
    quantity: String(selection.quantity),
    schedule: `${fmbRow.date} · ${fmbRow.start_time}-${fmbRow.end_time}`,
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
        if (task && (task.assigned_unit_code === role || task.assigned_role === role)) tasks.push(projectDepartmentTask(task, assignedToEmail));
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
    const { role, assignedToEmail, eventCode } = req.body;
    const request = db.request.find((r) => r.request_code === eventCode);
    if (!request) throw new WorkflowError('Event not found for the given eventCode.', 400);
    const task = db.request_task.find((t) => t.request_id === request.request_id && (t.assigned_unit_code === role || t.assigned_role === role) && t.stage_code === 'department_review');
    if (!task) throw new WorkflowError('Department task not found for the given role.', 400);
    const staffUser = db.users.find((u) => u.email === assignedToEmail);
    if (!staffUser) throw new WorkflowError('Staff member not found for the given assignedToEmail.', 400);

    // Attribute the assignment to the head-of-department/head-of-school of the task's own unit
    // (or, for fmb, the food_beverage_services unit's head-of-department — RBAC redesign retired
    // the old flat 'cafeteria-manager' role, see workflow.service.js) so workflow_history's
    // assigned_by_user_id is a sensible real user rather than always null.
    let manager;
    if (task.assigned_unit_code) {
      manager = db.users.find((u) => db.user_unit_roles.some((uur) => uur.user_id === u.user_id && uur.unit_code === task.assigned_unit_code && (uur.role_code === 'head-of-department' || uur.role_code === 'head-of-school')));
    } else if (task.assigned_role === 'fmb') {
      manager = db.users.find((u) => db.user_unit_roles.some((uur) => uur.user_id === u.user_id && uur.unit_code === 'food_beverage_services' && uur.role_code === 'head-of-department'));
    }

    workflow.assignStaffToTask(task.request_task_id, staffUser.user_id, manager ? manager.user_id : null);
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

    const task = workflow.updateTaskStatus(idParam, status);
    const assignment = db.task_assignment.find((a) => a.request_task_id === task.request_task_id);
    const staffUser = assignment ? db.users.find((u) => u.user_id === assignment.staff_user_id) : null;
    res.json(projectDepartmentTask(task, staffUser ? staffUser.email : ''));
  } catch (err) { next(err); }
});

module.exports = router;
