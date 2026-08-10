const express = require('express');
const { db } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;

const router = express.Router();

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
  const requirement = db.event_requirements.find((r) => r.requirement_id === task.requirement_id);
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

// request_fmb_selection has no staff-identity column of its own — claimSharedFmbSelection /
// fulfilFmbSelection (workflow.service.js) only mutate the selection's status, they don't
// write a task_assignment row (that table is scoped to request_task, not per-selection). The
// claiming staff member's identity is only ever recorded as workflow_history's actor_user_id
// on the 'claim-selection'/'fulfil-selection' action rows — recover it from there.
function claimingStaffEmail(selectionId) {
  const requestId = (() => {
    const selection = db.request_fmb_selection.find((s) => s.request_fmb_selection_id === selectionId);
    if (!selection) return null;
    const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === selection.request_fmb_id);
    return fmbRow ? fmbRow.request_id : null;
  })();
  if (requestId === null) return '';
  const claimEntries = db.workflow_history
    .filter((h) => h.request_id === requestId && (h.action === 'claim-selection' || h.action === 'fulfil-selection') && h.actor_user_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latest = claimEntries[0];
  if (!latest) return '';
  const user = db.users.find((u) => u.user_id === latest.actor_user_id);
  return user ? user.email : '';
}

function projectFmbSelection(selection, assignedToEmail) {
  const fmbRow = db.request_fmb.find((f) => f.request_fmb_id === selection.request_fmb_id);
  const request = db.request.find((r) => r.request_id === fmbRow.request_id);
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
      const myAssignments = db.task_assignment.filter((a) => a.staff_user_id === staffUser.user_id);
      for (const assignment of myAssignments) {
        const task = db.request_task.find((t) => t.request_task_id === assignment.request_task_id);
        if (task && task.assigned_role === role) tasks.push(projectDepartmentTask(task, assignedToEmail));
      }
    }

    if (role === 'cafeteria-staff' && staffUser) {
      // Rows this staff member has already claimed (preparing/fulfilled) — recovered via
      // workflow_history since request_fmb_selection has no staff-identity column of its own.
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
    const task = db.request_task.find((t) => t.request_id === request.request_id && t.assigned_role === role && t.stage_code === 'department_review');
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
