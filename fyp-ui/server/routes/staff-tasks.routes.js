const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

const router = express.Router();

// request_task.assigned_role is always set to the MANAGER role token (see workflow.service.js's
// createDepartmentTasks -> roleForRequirement). But Angular sends the STAFF member's own role
// (e.g. 'logistics-staff') both when a staff member lists their tasks (staff-tasks.ts, sends
// auth.user().role) and when a manager assigns work (proposal-department-view.ts's
// assignRequests(), sends staffRoleForManager(managerRole) — the STAFF role, not the manager's
// own role, per department-workflow.config.ts). Map staff role -> manager role so both routes
// below compare against assigned_role correctly.
const STAFF_TO_MANAGER_ROLE = {
  'logistics-staff': 'logistics-manager',
  'student-services-member': 'student-services-manager',
  'av-technician': 'av-manager',
  'photography-staff': 'photography-manager',
  'transport-staff': 'transport-manager',
};

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
    role: task.assigned_role,
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
  const cafeteria = db.cafeteria.find((c) => c.cafeteria_id === selection.cafeteria_id);
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
    detail: cafeteria ? cafeteria.name : '',
    status: selection.status === 'approved' ? 'assigned' : selection.status === 'preparing' ? 'preparing' : selection.status === 'fulfilled' ? 'completed' : selection.status,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { role, assignedToEmail } = req.query;
    const staffUser = db.users.find((u) => u.email === assignedToEmail);
    const tasks = [];

    if (staffUser) {
      // `role` is the STAFF member's own role (e.g. 'logistics-staff'), but request_task rows
      // are stamped with the MANAGER role (e.g. 'logistics-manager') — map before comparing.
      const managerRole = STAFF_TO_MANAGER_ROLE[role] || role;
      const myAssignments = db.task_assignment.filter((a) => a.staff_user_id === staffUser.user_id);
      for (const assignment of myAssignments) {
        const task = db.request_task.find((t) => t.request_task_id === assignment.request_task_id);
        if (task && task.assigned_role === managerRole) tasks.push(projectDepartmentTask(task, assignedToEmail));
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

      // Shared inbox: approved-but-unclaimed rows for any cafeteria this staff member is
      // assigned to (via cafeteria_assignment).
      const myCafeteriaIds = new Set(db.cafeteria_assignment.filter((a) => a.user_id === staffUser.user_id).map((a) => a.cafeteria_id));
      for (const selection of db.request_fmb_selection) {
        if (selection.status !== 'approved') continue;
        if (!myCafeteriaIds.has(selection.cafeteria_id)) continue;
        tasks.push(projectFmbSelection(selection, ''));
      }
    }

    res.json(tasks);
  } catch (err) { next(err); }
});

// Angular's assignRequests() (proposal-department-view.ts) sends department-level context
// (eventCode, request item label) rather than a request_task_id directly — look up the
// matching request via request_code, then the department's request_task by assigned_role.
router.post('/assignments', async (req, res, next) => {
  try {
    const { role, assignedToEmail, eventCode } = req.body;
    const request = db.request.find((r) => r.request_code === eventCode);
    if (!request) throw new WorkflowError('Event not found for the given eventCode.', 400);
    // `role` here is the STAFF role being assigned (assignRequests() sends
    // staffRoleForManager(this.role()), not the manager's own role) — map to the manager role
    // that request_task.assigned_role is actually stamped with before looking up the task.
    const managerRoleForTask = STAFF_TO_MANAGER_ROLE[role] || role;
    const task = db.request_task.find((t) => t.request_id === request.request_id && t.assigned_role === managerRoleForTask && t.stage_code === 'department_review');
    if (!task) throw new WorkflowError('Department task not found for the given role.', 400);
    const staffUser = db.users.find((u) => u.email === assignedToEmail);
    if (!staffUser) throw new WorkflowError('Staff member not found for the given assignedToEmail.', 400);

    const managerRoleFor = { logistics: 'logistics-manager', transportation: 'transport-manager', photoVideo: 'photography-manager', soundLight: 'av-manager', campusTour: 'student-services-manager', fmb: 'cafeteria-manager' };
    const requirement = db.event_requirements.find((r) => r.requirement_id === task.requirement_id);
    const managerRole = managerRoleFor[requirement.requirement_name];
    const manager = db.users.find((u) => u.role === managerRole);

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
