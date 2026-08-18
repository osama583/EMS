const express = require('express');
const { db, nextId } = require('../db');
const { WorkflowError } = require('../services/workflow.service');
const { deriveCafeteriaUnitCode, isCafeteriaUnitCode } = require('../services/unit-code');
const { rolesFor } = require('../services/user-access.service');

const router = express.Router();

// A Cafeteria is a `unit` row whose code is CAFETERIA_UNIT_PREFIX-coded (see
// services/unit-code.js) — staffed via the normal role_unit/user_unit_roles tables with the
// 'cafeteria-manager'/'cafeteria-staff' roles, same mechanism as every other unit in the system.
// This file is Cafeteria Admin's dedicated surface (Manage Cafeterias / Staff Assignments / Menu
// Oversight) plus the pre-existing read-only cafeteria list every other role's menu pickers use —
// it never introduces a second data model: every read here is a filtered view over `unit`/
// `user_unit_roles`/`role_unit`, the exact same tables System Admin's Units/Users/Roles pages
// read, so a cafeteria is never invisible to System Admin — only these 3 dedicated pages are
// cafeteria-admin-exclusive (see db.js's seedNavPages() grant comment).
function cafeteriaUnits() {
  return db.unit.filter((u) => isCafeteriaUnitCode(u.code) && !u.archived_at);
}

function projectCafeteria(unit) {
  return { id: unit.code, name: unit.description, code: unit.code, active: unit.is_active, archivedAt: unit.archived_at || undefined };
}

// Read-only list — used by every non-admin cafeteria picker (F&B's read-only Cafeteria Menus
// viewer, and Cafeteria Admin's own 3 pages below). Kept at GET / for backward compatibility
// with CafeteriaService.list()'s existing callers. Only ACTIVE, non-deleted cafeterias — an
// inactive/deleted cafeteria shouldn't appear as an assignment/menu target.
router.get('/', async (_req, res, next) => {
  try {
    res.json(cafeteriaUnits().filter((u) => u.is_active).map(projectCafeteria));
  } catch (err) { next(err); }
});

// Soft-deleted cafeterias — same 7-day-retention shape (deletedAt/permanentDeletionAt/
// daysRemaining) every other Admin Settings "Deleted" tab uses (see soft-delete.service.js's
// archivedList()), computed inline here rather than through that shared module: a cafeteria is a
// `unit` row, and registering a SECOND soft-delete entity also pointed at table: 'unit' would let
// this endpoint list every archived unit in the system, not just cafeterias.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
router.get('/deleted', async (_req, res, next) => {
  try {
    const rows = db.unit.filter((u) => isCafeteriaUnitCode(u.code) && u.archived_at);
    res.json(rows.map((unit) => {
      const deletedAt = new Date(unit.archived_at).getTime();
      const permanentDeletionAt = new Date(deletedAt + RETENTION_MS).toISOString();
      const daysRemaining = Math.max(0, Math.ceil((deletedAt + RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)));
      return { ...projectCafeteria(unit), deletedAt: unit.archived_at, permanentDeletionAt, daysRemaining };
    }));
  } catch (err) { next(err); }
});

// ============================================================================
// MANAGE CAFETERIAS — Cafeteria Admin creates/edits/deactivates cafeteria units.
// ============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { name, active } = req.body;
    if (!name) throw new WorkflowError('name is required.', 400);
    const code = deriveCafeteriaUnitCode(name);
    if (db.unit.some((u) => u.code === code)) throw new WorkflowError(`A cafeteria with the derived code '${code}' already exists.`, 409);
    const unit = { code, description: name, is_active: active !== undefined ? active : true, archived_at: null };
    db.unit.push(unit);
    res.json(projectCafeteria(unit));
  } catch (err) { next(err); }
});

router.put('/:code', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.code && isCafeteriaUnitCode(u.code));
    if (!unit) throw new WorkflowError('Cafeteria not found.', 404);
    const { name, active } = req.body;
    if (name !== undefined) unit.description = name;
    if (active !== undefined) unit.is_active = active;
    res.json(projectCafeteria(unit));
  } catch (err) { next(err); }
});

// Soft-delete: blocked while any manager/staff is still assigned (same rule regular Unit deletion
// already enforces — see admin.routes.js's DELETE /units/:id). Kept recoverable for 7 days via
// POST /:code/restore below, matching every other Admin Settings entity's lifecycle.
router.delete('/:code', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.code && isCafeteriaUnitCode(u.code));
    if (!unit) throw new WorkflowError('Cafeteria not found.', 404);
    if (unit.archived_at) throw new WorkflowError('Cafeteria is already deleted.', 409);
    const assignedCount = db.user_unit_roles.filter((uur) => uur.unit_code === unit.code).length;
    if (assignedCount > 0) throw new WorkflowError(`Cannot delete: ${assignedCount} staff member${assignedCount === 1 ? ' is' : 's are'} still assigned to this cafeteria.`, 409);
    unit.archived_at = new Date().toISOString();
    res.json(projectCafeteria(unit));
  } catch (err) { next(err); }
});

router.post('/:code/restore', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.code && isCafeteriaUnitCode(u.code));
    if (!unit) throw new WorkflowError('Cafeteria not found.', 404);
    if (!unit.archived_at) throw new WorkflowError('Cafeteria is not deleted.', 409);
    unit.archived_at = null;
    res.json(projectCafeteria(unit));
  } catch (err) { next(err); }
});

// Permanent removal — re-checks the same "no staff assigned" dependency (something could have
// been assigned again during the retention window, though assignable-users/POST /assignments
// both already exclude units without an active cafeteria, so this is mostly defensive).
router.delete('/:code/purge', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.code && isCafeteriaUnitCode(u.code));
    if (!unit) throw new WorkflowError('Cafeteria not found.', 404);
    if (!unit.archived_at) throw new WorkflowError('Cafeteria must be deleted before it can be purged.', 409);
    const assignedCount = db.user_unit_roles.filter((uur) => uur.unit_code === unit.code).length;
    if (assignedCount > 0) throw new WorkflowError(`Cannot permanently delete: ${assignedCount} staff member${assignedCount === 1 ? ' is' : 's are'} still assigned to this cafeteria.`, 409);
    db.unit = db.unit.filter((u) => u !== unit);
    db.role_unit = db.role_unit.filter((ru) => ru.unit_code !== unit.code);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ============================================================================
// STAFF ASSIGNMENTS — assign/remove a cafeteria-manager or cafeteria-staff to/from a cafeteria.
// Users already holding a cafeteria assignment (or any other role) are deliberately never listed
// here beyond their name/email/current cafeteria assignment — Cafeteria Admin only ever sees
// people through this cafeteria-scoped lens, matching "the data or user in cafeteria should not
// be showing even to the admin system" (System Admin's own Users/Units screens are unaffected;
// they're a separate, general-purpose view over the same rows).
// ============================================================================

const CAFETERIA_ROLE_CODES = ['cafeteria-manager', 'cafeteria-staff'];

function projectAssignment(uur) {
  const user = db.users.find((u) => u.user_id === uur.user_id);
  const unit = db.unit.find((u) => u.code === uur.unit_code);
  return {
    assignmentId: String(uur.user_unit_role_id),
    userId: user ? String(user.user_id) : '',
    displayName: user ? user.full_name : 'Unknown user',
    email: user ? user.email : '',
    roleCode: uur.role_code,
    roleLabel: uur.role_code === 'cafeteria-manager' ? 'Cafeteria Manager' : 'Cafeteria Staff',
    cafeteriaCode: uur.unit_code,
    cafeteriaName: unit ? unit.description : uur.unit_code,
  };
}

router.get('/assignments', async (_req, res, next) => {
  try {
    const cafeteriaCodes = new Set(cafeteriaUnits().map((u) => u.code));
    const assignments = db.user_unit_roles.filter((uur) => CAFETERIA_ROLE_CODES.includes(uur.role_code) && cafeteriaCodes.has(uur.unit_code));
    res.json(assignments.map(projectAssignment));
  } catch (err) { next(err); }
});

// Users eligible to be newly assigned to a cafeteria — anyone active who does NOT already hold
// ANY role (matches the Assignments tab's own "user gets created first, role assigned after"
// flow: a user with an existing role elsewhere isn't offered here to avoid double-role confusion
// this dedicated picker isn't designed to show). A user already holding a cafeteria role is
// managed by removing/re-adding their existing row, not offered again here.
router.get('/assignable-users', async (_req, res, next) => {
  try {
    const users = db.users
      .filter((u) => u.is_active && !u.archived_at)
      .filter((u) => rolesFor(u.user_id).length === 0)
      .map((u) => ({ id: String(u.user_id), displayName: u.full_name, email: u.email }));
    res.json(users);
  } catch (err) { next(err); }
});

// A cafeteria may have at most one Cafeteria Manager at a time (mirrors the one-head-per-unit
// rule head-of-school/head-of-department already enforce — see ems_database_schema.sql's
// comment above user_unit_roles). `excludeAssignmentId` lets the edit endpoint below check
// against every OTHER row without tripping over the row it's currently editing.
function findExistingManager(cafeteriaCode, excludeAssignmentId) {
  return db.user_unit_roles.find((uur) =>
    uur.unit_code === cafeteriaCode && uur.role_code === 'cafeteria-manager'
    && uur.user_unit_role_id !== excludeAssignmentId,
  );
}

// Shared mutation logic — called both by the direct Cafeteria Admin routes below AND by the
// staff-requests approval flow (POST /staff-requests/:id/approve), so the manager-uniqueness/
// active-cafeteria checks stay in exactly one place regardless of which surface triggered them.
function createAssignment(userId, cafeteriaCode, roleCode) {
  if (!userId || !cafeteriaCode || !roleCode) throw new WorkflowError('userId, cafeteriaCode, and roleCode are required.', 400);
  if (!CAFETERIA_ROLE_CODES.includes(roleCode)) throw new WorkflowError(`roleCode must be one of: ${CAFETERIA_ROLE_CODES.join(', ')}.`, 400);
  const unit = db.unit.find((u) => u.code === cafeteriaCode && isCafeteriaUnitCode(u.code) && u.is_active && !u.archived_at);
  if (!unit) throw new WorkflowError('Cafeteria not found or inactive.', 400);
  const user = db.users.find((u) => u.user_id === Number(userId) && u.is_active && !u.archived_at);
  if (!user) throw new WorkflowError('User not found or inactive.', 400);
  if (db.user_unit_roles.some((uur) => uur.user_id === user.user_id && uur.unit_code === cafeteriaCode && uur.role_code === roleCode)) {
    throw new WorkflowError('This user already holds this role at this cafeteria.', 409);
  }
  if (roleCode === 'cafeteria-manager') {
    const existingManager = findExistingManager(cafeteriaCode);
    if (existingManager) {
      const existingUser = db.users.find((u) => u.user_id === existingManager.user_id);
      throw new WorkflowError(`${unit.description} already has a Cafeteria Manager (${existingUser ? existingUser.full_name : 'another user'}). Remove that assignment first.`, 409);
    }
  }
  const row = { user_unit_role_id: nextId('user_unit_roles'), user_id: user.user_id, unit_code: cafeteriaCode, role_code: roleCode, assigned_at: new Date().toISOString() };
  db.user_unit_roles.push(row);
  return row;
}

function updateAssignment(id, { cafeteriaCode, roleCode }) {
  const row = db.user_unit_roles.find((uur) => uur.user_unit_role_id === Number(id) && CAFETERIA_ROLE_CODES.includes(uur.role_code));
  if (!row) throw new WorkflowError('Assignment not found.', 404);
  const nextCafeteriaCode = cafeteriaCode !== undefined ? cafeteriaCode : row.unit_code;
  const nextRoleCode = roleCode !== undefined ? roleCode : row.role_code;
  if (!CAFETERIA_ROLE_CODES.includes(nextRoleCode)) throw new WorkflowError(`roleCode must be one of: ${CAFETERIA_ROLE_CODES.join(', ')}.`, 400);
  const unit = db.unit.find((u) => u.code === nextCafeteriaCode && isCafeteriaUnitCode(u.code) && u.is_active && !u.archived_at);
  if (!unit) throw new WorkflowError('Cafeteria not found or inactive.', 400);
  if (db.user_unit_roles.some((uur) => uur.user_unit_role_id !== row.user_unit_role_id && uur.user_id === row.user_id && uur.unit_code === nextCafeteriaCode && uur.role_code === nextRoleCode)) {
    throw new WorkflowError('This user already holds this role at this cafeteria.', 409);
  }
  if (nextRoleCode === 'cafeteria-manager') {
    const existingManager = findExistingManager(nextCafeteriaCode, row.user_unit_role_id);
    if (existingManager) {
      const existingUser = db.users.find((u) => u.user_id === existingManager.user_id);
      throw new WorkflowError(`${unit.description} already has a Cafeteria Manager (${existingUser ? existingUser.full_name : 'another user'}). Remove that assignment first.`, 409);
    }
  }
  row.unit_code = nextCafeteriaCode;
  row.role_code = nextRoleCode;
  return row;
}

function removeAssignment(id) {
  const row = db.user_unit_roles.find((uur) => uur.user_unit_role_id === Number(id) && CAFETERIA_ROLE_CODES.includes(uur.role_code));
  if (!row) throw new WorkflowError('Assignment not found.', 404);
  db.user_unit_roles = db.user_unit_roles.filter((uur) => uur.user_unit_role_id !== row.user_unit_role_id);
}

router.post('/assignments', async (req, res, next) => {
  try {
    const { userId, cafeteriaCode, roleCode } = req.body;
    const row = createAssignment(userId, cafeteriaCode, roleCode);
    res.status(201).json(projectAssignment(row));
  } catch (err) { next(err); }
});

// Edit an existing assignment's cafeteria and/or role — same manager-uniqueness rule applies,
// checked against every OTHER assignment (so re-saving a manager row onto the same cafeteria
// isn't rejected by its own existing row).
router.put('/assignments/:id', async (req, res, next) => {
  try {
    const row = updateAssignment(req.params.id, req.body);
    res.json(projectAssignment(row));
  } catch (err) { next(err); }
});

router.delete('/assignments/:id', async (req, res, next) => {
  try {
    removeAssignment(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ============================================================================
// STAFF REQUESTS — a Cafeteria Manager cannot write user_unit_roles directly; every add/edit/
// remove of a cafeteria-staff member at their OWN cafeteria creates a pending request here for
// Cafeteria Admin to approve or reject. Modeled directly on clubs.routes.js's club_join_requests
// pattern (status/resolved_at/resolved_by_user_id/comment) rather than the heavier
// workflow.service.js state machine, which is unnecessary for a single approve/reject step.
// Approving APPLIES the change immediately via the same createAssignment/updateAssignment/
// removeAssignment helpers Cafeteria Admin's own direct routes above use — no separate mutation
// path to drift out of sync.
// ============================================================================

function myCafeteriaCode(userId) {
  const assignment = db.user_unit_roles.find((uur) => uur.user_id === Number(userId) && uur.role_code === 'cafeteria-manager');
  return assignment ? assignment.unit_code : undefined;
}

function projectStaffRequest(row) {
  const requestedBy = db.users.find((u) => u.user_id === row.requested_by_user_id);
  const targetUser = row.target_user_id ? db.users.find((u) => u.user_id === row.target_user_id) : null;
  const cafeteria = db.unit.find((u) => u.code === row.cafeteria_code);
  const resolvedBy = row.resolved_by_user_id ? db.users.find((u) => u.user_id === row.resolved_by_user_id) : null;
  return {
    id: String(row.cafeteria_staff_request_id),
    cafeteriaCode: row.cafeteria_code,
    cafeteriaName: cafeteria ? cafeteria.description : row.cafeteria_code,
    requestedByUserId: String(row.requested_by_user_id),
    requestedByName: requestedBy ? requestedBy.full_name : 'Unknown user',
    action: row.action,
    targetAssignmentId: row.target_assignment_id ? String(row.target_assignment_id) : undefined,
    targetUserId: targetUser ? String(targetUser.user_id) : undefined,
    displayName: targetUser ? targetUser.full_name : row.payload_display_name || '',
    email: targetUser ? targetUser.email : row.payload_email || '',
    roleCode: row.role_code,
    status: row.status,
    comment: row.comment || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
    resolvedByName: resolvedBy ? resolvedBy.full_name : undefined,
  };
}

// Manager submits an add/edit/remove request for their OWN cafeteria — cafeteriaCode is
// re-derived from the requester's own user_unit_roles row (not trusted from the request body) so
// a manager can never submit a request scoped to a cafeteria they don't actually run.
router.post('/staff-requests', async (req, res, next) => {
  try {
    const { requestedByUserId, action, targetAssignmentId, targetUserId, email, displayName, roleCode } = req.body;
    const requester = db.users.find((u) => u.user_id === Number(requestedByUserId));
    if (!requester) throw new WorkflowError('Requester not found.', 400);
    const cafeteriaCode = myCafeteriaCode(requester.user_id);
    if (!cafeteriaCode) throw new WorkflowError('Only a Cafeteria Manager can submit staff requests.', 403);
    if (!['add', 'edit', 'remove'].includes(action)) throw new WorkflowError("action must be one of: 'add', 'edit', 'remove'.", 400);
    if ((action === 'edit' || action === 'remove') && !targetAssignmentId) throw new WorkflowError('targetAssignmentId is required for edit/remove.', 400);
    if (action === 'add' && !email) throw new WorkflowError('email is required to add a new staff member.', 400);
    const row = {
      cafeteria_staff_request_id: nextId('cafeteria_staff_requests'),
      cafeteria_code: cafeteriaCode,
      requested_by_user_id: requester.user_id,
      action,
      target_user_id: targetUserId ? Number(targetUserId) : null,
      target_assignment_id: targetAssignmentId ? Number(targetAssignmentId) : null,
      payload_display_name: displayName || null,
      payload_email: email || null,
      role_code: roleCode || 'cafeteria-staff',
      status: 'pending',
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by_user_id: null,
    };
    db.cafeteria_staff_requests.push(row);
    res.status(201).json(projectStaffRequest(row));
  } catch (err) { next(err); }
});

// Cafeteria Admin's inbox — a flat oversight role, sees every cafeteria's pending requests (no
// unit filter), same "no cafeteria-scoping for the admin role itself" precedent as every other
// route in this file.
router.get('/staff-requests/inbox', async (_req, res, next) => {
  try {
    res.json(db.cafeteria_staff_requests.filter((r) => r.status === 'pending').map(projectStaffRequest));
  } catch (err) { next(err); }
});

// A manager's own request history (any status) — powers the My Staff History page.
router.get('/staff-requests/mine', async (req, res, next) => {
  try {
    const requesterUserId = Number(req.query.requesterUserId);
    res.json(db.cafeteria_staff_requests.filter((r) => r.requested_by_user_id === requesterUserId).map(projectStaffRequest));
  } catch (err) { next(err); }
});

router.post('/staff-requests/:id/approve', async (req, res, next) => {
  try {
    const row = db.cafeteria_staff_requests.find((r) => r.cafeteria_staff_request_id === Number(req.params.id));
    if (!row) throw new WorkflowError('Staff request not found.', 404);
    if (row.status !== 'pending') throw new WorkflowError('This request has already been resolved.', 409);
    const resolvedByUserId = Number(req.body.resolvedByUserId);
    if (!db.user_unit_roles.some((uur) => uur.user_id === resolvedByUserId && uur.role_code === 'cafeteria-admin')) {
      throw new WorkflowError('Only Cafeteria Admin can review staff requests.', 403);
    }
    if (row.action === 'add') {
      const targetUser = db.users.find((u) => u.email === row.payload_email && u.is_active && !u.archived_at);
      if (!targetUser) throw new WorkflowError('The requested user account was not found or is inactive.', 400);
      createAssignment(targetUser.user_id, row.cafeteria_code, row.role_code);
    } else if (row.action === 'edit') {
      updateAssignment(row.target_assignment_id, { cafeteriaCode: row.cafeteria_code, roleCode: row.role_code });
    } else if (row.action === 'remove') {
      removeAssignment(row.target_assignment_id);
    }
    row.status = 'approved';
    row.resolved_at = new Date().toISOString();
    row.resolved_by_user_id = resolvedByUserId;
    res.json(projectStaffRequest(row));
  } catch (err) { next(err); }
});

router.post('/staff-requests/:id/reject', async (req, res, next) => {
  try {
    const row = db.cafeteria_staff_requests.find((r) => r.cafeteria_staff_request_id === Number(req.params.id));
    if (!row) throw new WorkflowError('Staff request not found.', 404);
    if (row.status !== 'pending') throw new WorkflowError('This request has already been resolved.', 409);
    const resolvedByUserId = Number(req.body.resolvedByUserId);
    if (!db.user_unit_roles.some((uur) => uur.user_id === resolvedByUserId && uur.role_code === 'cafeteria-admin')) {
      throw new WorkflowError('Only Cafeteria Admin can review staff requests.', 403);
    }
    row.status = 'rejected';
    row.comment = req.body.comment || null;
    row.resolved_at = new Date().toISOString();
    row.resolved_by_user_id = resolvedByUserId;
    res.json(projectStaffRequest(row));
  } catch (err) { next(err); }
});

module.exports = router;
