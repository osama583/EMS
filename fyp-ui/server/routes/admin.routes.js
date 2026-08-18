const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { isClubAdmin, presidentOfClubIds } = require('../services/club-identity.service');
const { deriveUnitCode, deriveRoleCode } = require('../services/unit-code');
const { rolesFor, roleLabel, departmentFor, primaryRoleLabelFor } = require('../services/user-access.service');
const { eligibleRolesForUnit, eligibleRolesForUnits, flatRolesAvailable, isProtectedRole, isFlatRole, unitsForRole, HEAD_ROLE_CODES } = require('../services/role-eligibility.service');
const softDeleteService = require('../services/soft-delete.service');

const router = express.Router();

// ============================================================================
// USERS
// ============================================================================

function projectUser(user) {
  const roles = rolesFor(user.user_id);
  return {
    id: String(user.user_id),
    displayName: user.full_name,
    username: user.username,
    email: user.email,
    roleLabel: primaryRoleLabelFor(user),
    department: departmentFor(user),
    active: user.is_active,
    roles: roles.map((r) => ({ assignmentId: String(r.assignmentId), roleCode: r.roleCode, roleName: r.roleName, unitCode: r.unitCode, unitDescription: r.unitDescription })),
    isClubAdmin: isClubAdmin(user.user_id),
    presidentOfClubIds: presidentOfClubIds(user.user_id).map(String),
  };
}

router.get('/users', async (_req, res, next) => {
  try {
    res.json(db.users.filter((u) => !u.archived_at).map(projectUser));
  } catch (err) { next(err); }
});

router.post('/users', async (req, res, next) => {
  try {
    const { displayName, username, email, active } = req.body;
    if (!displayName || !username || !email) throw new WorkflowError('displayName, username, and email are required.', 400);
    const user = {
      user_id: nextId('users'),
      full_name: displayName,
      username,
      email,
      password: 'Demo@123',
      is_active: active !== undefined ? active : true,
      archived_at: null,
    };
    db.users.push(user);
    res.json(projectUser(user));
  } catch (err) { next(err); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const user = db.users.find((u) => u.user_id === Number(req.params.id));
    if (!user) throw new WorkflowError('User not found.', 404);
    const { displayName, username, email, active } = req.body;
    if (displayName !== undefined) user.full_name = displayName;
    if (username !== undefined) user.username = username;
    if (email !== undefined) user.email = email;
    if (active !== undefined) user.is_active = active;
    res.json(projectUser(user));
  } catch (err) { next(err); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const user = db.users.find((u) => u.user_id === Number(req.params.id));
    if (!user) throw new WorkflowError('User not found.', 404);
    user.is_active = req.body.active;
    res.json(projectUser(user));
  } catch (err) { next(err); }
});

// Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) via the
// shared registry — see soft-delete.service.js/admin-deletion.registry.js. Blocked by role/unit
// assignments, submitted requests, club presidency, or Club Admin privileges (every reason listed
// together, same "report every blocker at once" behavior the old hard-delete check had).
softDeleteService.mountRoutes(router, '/users', 'user', projectUser);

// ============================================================================
// USER <-> UNIT/ROLE ASSIGNMENTS
// ============================================================================

router.get('/users/:id/assignments', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    res.json(rolesFor(userId));
  } catch (err) { next(err); }
});

// Assigns (roleCode, unitCode?) to the user. unitCode is required when the target role is
// unit-scoped, omitted for flat roles. Validates: role must be currently eligible for the given
// unit (or a valid flat role); a head role (head-of-school/head-of-department) hard-blocks if the
// unit already has a different head (design spec: "hard block ... toast error, no silent
// replacement").
router.post('/users/:id/assignments', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const user = db.users.find((u) => u.user_id === userId);
    if (!user) throw new WorkflowError('User not found.', 404);
    const { roleCode, unitCode } = req.body;
    const role = db.role.find((r) => r.role_code === roleCode && r.is_active && !r.archived_at);
    if (!role) throw new WorkflowError('Role not found or inactive.', 400);

    const flat = isFlatRole(db, role);
    if (!flat) {
      if (!unitCode) throw new WorkflowError('unitCode is required for a role that belongs to one or more units.', 400);
      const unit = db.unit.find((u) => u.code === unitCode && u.is_active && !u.archived_at);
      if (!unit) throw new WorkflowError('Unit not found or inactive.', 400);
      const eligible = eligibleRolesForUnit(db, unitCode).some((r) => r.role_code === roleCode);
      if (!eligible) throw new WorkflowError(`Role '${roleCode}' is not eligible for this unit.`, 400);
      if (HEAD_ROLE_CODES.has(roleCode)) {
        const existingHead = db.user_unit_roles.find((uur) => uur.unit_code === unitCode && HEAD_ROLE_CODES.has(uur.role_code) && uur.user_id !== userId);
        if (existingHead) throw new WorkflowError('This unit already has a head assigned. Remove the existing head before assigning a new one.', 409);
      }
    } else if (unitCode) {
      throw new WorkflowError('unitCode must be omitted for a flat role.', 400);
    }

    const effectiveUnitCode = flat ? null : unitCode;
    const alreadyAssigned = db.user_unit_roles.some((uur) => uur.user_id === userId && uur.unit_code === effectiveUnitCode && uur.role_code === roleCode);
    if (alreadyAssigned) throw new WorkflowError('This user already holds this role in this unit.', 409);

    db.user_unit_roles.push({
      user_unit_role_id: nextId('user_unit_roles'),
      user_id: userId,
      unit_code: effectiveUnitCode,
      role_code: roleCode,
      assigned_at: new Date().toISOString(),
    });
    res.status(201).json(rolesFor(userId));
  } catch (err) { next(err); }
});

router.delete('/users/:id/assignments/:assignmentId', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const existing = db.user_unit_roles.find((uur) => uur.user_unit_role_id === assignmentId && uur.user_id === userId);
    if (!existing) throw new WorkflowError('Assignment not found.', 404);
    db.user_unit_roles = db.user_unit_roles.filter((uur) => uur.user_unit_role_id !== assignmentId);
    res.json(rolesFor(userId));
  } catch (err) { next(err); }
});

// ============================================================================
// UNITS
// ============================================================================

function projectUnit(unit) {
  return {
    id: unit.code, name: unit.description, code: unit.code, description: unit.description,
    active: unit.is_active, archivedAt: unit.archived_at || undefined,
    roleCodes: db.role_unit.filter((ru) => ru.unit_code === unit.code).map((ru) => ru.role_code),
  };
}

// Adds/removes role_unit rows for `unitCode` so its links exactly match `roleCodes` — added
// codes get a new row, removed codes lose theirs, unchanged codes are left alone. Every code must
// refer to a currently active role, or the whole call is rejected before any row is touched.
function syncUnitRoles(unitCode, roleCodes) {
  const roles = roleCodes.map((code) => {
    const role = db.role.find((r) => r.role_code === code && r.is_active && !r.archived_at);
    if (!role) throw new WorkflowError(`Role '${code}' not found or inactive.`, 400);
    return role;
  });
  const nextCodes = new Set(roles.map((r) => r.role_code));
  const currentCodes = new Set(db.role_unit.filter((ru) => ru.unit_code === unitCode).map((ru) => ru.role_code));
  db.role_unit = db.role_unit.filter((ru) => ru.unit_code !== unitCode || nextCodes.has(ru.role_code));
  for (const code of nextCodes) {
    if (!currentCodes.has(code)) db.role_unit.push({ role_code: code, unit_code: unitCode });
  }
}

router.get('/units', async (_req, res, next) => {
  try {
    res.json(db.unit.filter((u) => !u.archived_at).map(projectUnit));
  } catch (err) { next(err); }
});

// Standard shape (deletedAt/permanentDeletionAt/daysRemaining) shared with every other
// soft-deletable entity's "Deleted" view — see soft-delete.service.js's archivedList().
router.get('/units/archive', async (_req, res, next) => {
  try {
    res.json(softDeleteService.archivedList('unit').map(({ row, deletedAt, permanentDeletionAt, daysRemaining }) => ({
      ...projectUnit(row), deletedAt, permanentDeletionAt, daysRemaining,
    })));
  } catch (err) { next(err); }
});

router.get('/units/:id/deletion-check', async (req, res, next) => {
  try { res.json(softDeleteService.previewDeletion('unit', req.params.id)); } catch (err) { next(err); }
});

router.get('/units/:id/eligible-roles', async (req, res, next) => {
  try {
    res.json(eligibleRolesForUnit(db, req.params.id).map(projectRole));
  } catch (err) { next(err); }
});

router.post('/units', async (req, res, next) => {
  try {
    // `code` is always server-derived from `description` (services/unit-code.js) and is
    // permanent from this point on — the admin UI never offers to edit it after save.
    const { description, active, roleCodes } = req.body;
    if (!description) throw new WorkflowError('description is required.', 400);
    const code = deriveUnitCode(description);
    if (db.unit.some((u) => u.code === code)) throw new WorkflowError(`A unit with the derived code '${code}' already exists.`, 409);
    const unit = { code, description, is_active: active !== undefined ? active : true, archived_at: null };
    db.unit.push(unit);
    if (roleCodes) syncUnitRoles(code, roleCodes);
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

router.put('/units/:id', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit) throw new WorkflowError('Unit not found.', 404);
    // code is immutable — description/active are the only editable fields.
    const { description, active, roleCodes } = req.body;
    if (description !== undefined) unit.description = description;
    if (active !== undefined) unit.is_active = active;
    if (roleCodes !== undefined) syncUnitRoles(unit.code, roleCodes);
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

router.patch('/units/:id/status', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit) throw new WorkflowError('Unit not found.', 404);
    unit.is_active = req.body.active;
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

// Soft-delete: blocked if any user_unit_roles row still references this unit. Archived units are
// hidden from every picker (eligibleRolesForUnit/GET /units both filter archived rows out).
router.delete('/units/:id', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit) throw new WorkflowError('Unit not found.', 404);
    const assignedCount = db.user_unit_roles.filter((uur) => uur.unit_code === unit.code).length;
    if (assignedCount > 0) throw new WorkflowError(`Cannot delete: ${assignedCount} user${assignedCount === 1 ? ' is' : 's are'} still assigned to this unit.`, 409);
    unit.archived_at = new Date().toISOString();
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

router.post('/units/:id/restore', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit) throw new WorkflowError('Unit not found.', 404);
    unit.archived_at = null;
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

router.delete('/units/:id/purge', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit || !unit.archived_at) throw new WorkflowError('Archived unit not found.', 404);
    db.unit = db.unit.filter((u) => u.code !== unit.code);
    db.role_unit = db.role_unit.filter((ru) => ru.unit_code !== unit.code);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ============================================================================
// ROLES
// ============================================================================

function projectRole(role) {
  return {
    roleCode: role.role_code,
    roleName: role.role_name,
    description: role.description || '',
    unitCodes: unitsForRole(db, role.role_code),
    isProtected: role.is_protected,
    active: role.is_active,
    archivedAt: role.archived_at || undefined,
  };
}

// Adds/removes role_unit rows for `roleCode` so its links exactly match `unitCodes` — mirrors
// syncUnitRoles() from the Units section, same diff-and-apply behavior in the other direction.
// Every code must refer to a currently active unit, or the whole call is rejected before any row
// is touched.
function syncRoleUnits(roleCode, unitCodes) {
  const units = unitCodes.map((code) => {
    const unit = db.unit.find((u) => u.code === code && u.is_active && !u.archived_at);
    if (!unit) throw new WorkflowError(`Unit '${code}' not found or inactive.`, 400);
    return unit;
  });
  const nextCodes = new Set(units.map((u) => u.code));
  const currentCodes = new Set(db.role_unit.filter((ru) => ru.role_code === roleCode).map((ru) => ru.unit_code));
  db.role_unit = db.role_unit.filter((ru) => ru.role_code !== roleCode || nextCodes.has(ru.unit_code));
  for (const code of nextCodes) {
    if (!currentCodes.has(code)) db.role_unit.push({ role_code: roleCode, unit_code: code });
  }
}

router.get('/roles', async (_req, res, next) => {
  try {
    res.json(db.role.filter((r) => !r.archived_at).map(projectRole));
  } catch (err) { next(err); }
});

router.get('/roles/archive', async (_req, res, next) => {
  try {
    res.json(softDeleteService.archivedList('role').map(({ row, deletedAt, permanentDeletionAt, daysRemaining }) => ({
      ...projectRole(row), deletedAt, permanentDeletionAt, daysRemaining,
    })));
  } catch (err) { next(err); }
});

router.get('/roles/:code/deletion-check', async (req, res, next) => {
  try {
    if (isProtectedRole(req.params.code)) return res.json({ canDelete: false, blockingReasons: ['this role is protected and cannot be deleted'], entityLabel: `"${req.params.code}"` });
    res.json(softDeleteService.previewDeletion('role', req.params.code));
  } catch (err) { next(err); }
});

router.get('/roles/flat', async (_req, res, next) => {
  try {
    res.json(flatRolesAvailable(db).map(projectRole));
  } catch (err) { next(err); }
});

// New custom roles are always fully editable/deletable (is_protected=false) — only the 9 seed
// roles carry is_protected=true, set once by role-eligibility.service.js's seedRoles(), never by
// this endpoint.
router.post('/roles', async (req, res, next) => {
  try {
    const { roleName, description, unitCodes, active } = req.body;
    if (!roleName) throw new WorkflowError('roleName is required.', 400);
    const roleCode = deriveRoleCode(roleName);
    if (db.role.some((r) => r.role_code === roleCode)) throw new WorkflowError(`A role with the derived code '${roleCode}' already exists.`, 409);
    const role = {
      role_code: roleCode,
      role_name: roleName,
      description: description || '',
      is_protected: false,
      is_active: active !== undefined ? active : true,
      archived_at: null,
    };
    db.role.push(role);
    if (unitCodes) syncRoleUnits(roleCode, unitCodes);
    res.json(projectRole(role));
  } catch (err) { next(err); }
});

// Protected roles: only role_name/description are editable, never their Unit links. Custom
// roles: everything is editable.
router.put('/roles/:code', async (req, res, next) => {
  try {
    const role = db.role.find((r) => r.role_code === req.params.code);
    if (!role) throw new WorkflowError('Role not found.', 404);
    const { roleName, description, unitCodes, active } = req.body;
    if (roleName !== undefined) role.role_name = roleName;
    if (description !== undefined) role.description = description;
    if (isProtectedRole(role.role_code)) {
      if (unitCodes !== undefined) {
        throw new WorkflowError('This role is protected: its unit associations cannot be changed.', 403);
      }
    } else {
      if (unitCodes !== undefined) syncRoleUnits(role.role_code, unitCodes);
      if (active !== undefined) role.is_active = active;
    }
    res.json(projectRole(role));
  } catch (err) { next(err); }
});

// Soft-delete, non-protected roles only, blocked if any user currently holds it.
router.delete('/roles/:code', async (req, res, next) => {
  try {
    const role = db.role.find((r) => r.role_code === req.params.code);
    if (!role) throw new WorkflowError('Role not found.', 404);
    if (isProtectedRole(role.role_code)) throw new WorkflowError('This role is protected and cannot be deleted.', 403);
    const holderCount = db.user_unit_roles.filter((uur) => uur.role_code === role.role_code).length;
    if (holderCount > 0) throw new WorkflowError(`Cannot delete: ${holderCount} user${holderCount === 1 ? '' : 's'} currently hold this role.`, 409);
    role.archived_at = new Date().toISOString();
    res.json(projectRole(role));
  } catch (err) { next(err); }
});

router.post('/roles/:code/restore', async (req, res, next) => {
  try {
    const role = db.role.find((r) => r.role_code === req.params.code);
    if (!role) throw new WorkflowError('Role not found.', 404);
    role.archived_at = null;
    res.json(projectRole(role));
  } catch (err) { next(err); }
});

router.delete('/roles/:code/purge', async (req, res, next) => {
  try {
    const role = db.role.find((r) => r.role_code === req.params.code);
    if (!role || !role.archived_at) throw new WorkflowError('Archived role not found.', 404);
    db.role = db.role.filter((r) => r.role_code !== role.role_code);
    db.role_unit = db.role_unit.filter((ru) => ru.role_code !== role.role_code);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ============================================================================
// NAV PAGES (Page Visibility builder)
// ============================================================================

function projectGrant(g) {
  // is_active defaults true for rows persisted before this column existed (db.json predates the
  // 2026-08-13 active-toggle addition) — same "undefined means never turned off" backfill as the
  // column's own DB DEFAULT TRUE. role_codes/unit_codes (multi-select, added later that same day)
  // similarly backfill to [] for any row somehow missing them.
  return {
    grantId: g.grant_id, grantType: g.grant_type,
    roleCodes: g.role_codes || [], unitCodes: g.unit_codes || [],
    active: g.is_active !== false,
  };
}

function projectNavPage(page) {
  return {
    pageCode: page.page_code,
    label: page.label,
    entryType: page.entry_type,
    icon: page.icon || undefined,
    parentPageCode: page.parent_page_code || undefined,
    sortOrder: page.sort_order,
    routePath: page.route_path || undefined,
    active: page.is_active,
    grants: db.nav_page_grants.filter((g) => g.page_code === page.page_code && !g.archived_at).map(projectGrant),
  };
}

router.get('/nav-pages', async (_req, res, next) => {
  try {
    res.json(db.nav_page.filter((p) => !p.archived_at).map(projectNavPage));
  } catch (err) { next(err); }
});

// route_path is never client-supplied — always '/app/' + page_code, recomputed on every save so
// it can never drift from the (immutable) page_code. Folders never have a route.
function deriveNavRoutePath(entryType, pageCode) {
  return entryType === 'folder' ? null : `/app/${pageCode}`;
}

// Minimal but real SVG validation/sanitization for uploaded icon files: rejects anything that
// isn't actually an <svg> document, and strips <script> tags plus on*="" event-handler attributes
// so the stored markup is safe to render via [innerHTML] on the client (see
// page-visibility.ts/site-header — both inline this string directly, so unsanitized markup would
// be a stored-XSS vector for every user who ever sees this page's sidebar entry).
function sanitizeSvgIcon(raw) {
  let trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  // Standalone .svg files exported from design tools (Illustrator, Figma, ...) start with a UTF-8
  // BOM and/or an <?xml ... ?> declaration before the root <svg> element — strip whatever's legally
  // allowed to precede it (BOM, XML prolog, DOCTYPE, comments) rather than rejecting a valid file.
  trimmed = trimmed
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->\s*)*/, '')
    .trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) {
    throw new WorkflowError('Icon must be a valid SVG file.', 400);
  }
  if (trimmed.length > 100_000) throw new WorkflowError('Icon SVG is too large (100KB limit).', 400);
  return trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"(?:[^"]*)"/gi, '')
    .replace(/\son\w+\s*=\s*'(?:[^']*)'/gi, '');
}

// Validates a grant row's shape/refs before it's added to a page. Each row is independent — see
// nav_page_grants' comment in ems_database_schema.sql for what each grant_type means — and now
// holds a SET of roles/units (multi-select) rather than one of each. 'role'/'unit_role' get
// different role eligibility checks (role_only never allows a unit-scoped role since there's no
// unit to scope it to; unit_role requires every role be eligible for AT LEAST ONE of the picked
// units — it's a cross-product within the row, not one atomic pair per role/unit).
function validateGrant(grantType, roleCodes, unitCodes) {
  if (!['role', 'unit_role', 'unit'].includes(grantType)) throw new WorkflowError("grantType must be 'role', 'unit_role', or 'unit'.", 400);
  roleCodes = Array.isArray(roleCodes) ? [...new Set(roleCodes)] : [];
  unitCodes = Array.isArray(unitCodes) ? [...new Set(unitCodes)] : [];

  if (grantType === 'role') {
    if (roleCodes.length === 0) throw new WorkflowError('At least one role is required for a Role grant.', 400);
    for (const roleCode of roleCodes) {
      const role = db.role.find((r) => r.role_code === roleCode && r.is_active && !r.archived_at);
      if (!role) throw new WorkflowError(`Role '${roleCode}' not found or inactive.`, 400);
      if (!isFlatRole(db, role)) throw new WorkflowError(`'${roleCode}' belongs to one or more units and needs a unit — use a Unit + Role grant instead.`, 400);
    }
    return { role_codes: roleCodes, unit_codes: [] };
  }
  if (grantType === 'unit') {
    if (unitCodes.length === 0) throw new WorkflowError('At least one unit is required for a Unit grant.', 400);
    for (const unitCode of unitCodes) {
      if (!db.unit.some((u) => u.code === unitCode && u.is_active && !u.archived_at)) throw new WorkflowError(`Unit '${unitCode}' not found or inactive.`, 400);
    }
    return { role_codes: [], unit_codes: unitCodes };
  }
  // unit_role
  if (unitCodes.length === 0) throw new WorkflowError('At least one unit is required for a Unit + Role grant.', 400);
  if (roleCodes.length === 0) throw new WorkflowError('At least one role is required for a Unit + Role grant.', 400);
  for (const unitCode of unitCodes) {
    if (!db.unit.some((u) => u.code === unitCode && u.is_active && !u.archived_at)) throw new WorkflowError(`Unit '${unitCode}' not found or inactive.`, 400);
  }
  const eligibleCodes = new Set(eligibleRolesForUnits(db, unitCodes).map((r) => r.role_code));
  for (const roleCode of roleCodes) {
    if (!db.role.find((r) => r.role_code === roleCode && r.is_active && !r.archived_at)) throw new WorkflowError(`Role '${roleCode}' not found or inactive.`, 400);
    if (!eligibleCodes.has(roleCode)) throw new WorkflowError(`'${roleCode}' is not eligible for any of the selected units.`, 400);
  }
  return { role_codes: roleCodes, unit_codes: unitCodes };
}

// New pages/folders always land at the end of their sibling list (top-level, or within their
// parent folder) — there is no manual sort-order editing (see PUT /nav-pages/:code), so this is
// the only place sort_order is ever assigned.
function nextSiblingSortOrder(parentPageCode) {
  const siblings = db.nav_page.filter((p) => (p.parent_page_code || null) === (parentPageCode || null) && !p.archived_at);
  return siblings.length ? Math.max(...siblings.map((p) => p.sort_order)) + 1 : 0;
}

router.post('/nav-pages', async (req, res, next) => {
  try {
    const { label, entryType, icon, parentPageCode } = req.body;
    if (!label) throw new WorkflowError('label is required.', 400);
    if (!['page', 'folder'].includes(entryType)) throw new WorkflowError("entryType must be 'page' or 'folder'.", 400);
    if (entryType === 'page' && parentPageCode) {
      const parent = db.nav_page.find((p) => p.page_code === parentPageCode);
      if (!parent || parent.entry_type !== 'folder') throw new WorkflowError('Parent must be an existing folder.', 400);
    }
    if (entryType === 'folder' && parentPageCode) throw new WorkflowError('A folder cannot be nested inside another folder.', 400);
    const pageCode = deriveUnitCode(label);
    if (db.nav_page.some((p) => p.page_code === pageCode)) throw new WorkflowError(`A page with the derived code '${pageCode}' already exists.`, 409);
    const resolvedParent = entryType === 'page' ? (parentPageCode || null) : null;
    const page = {
      page_code: pageCode,
      label,
      entry_type: entryType,
      icon: sanitizeSvgIcon(icon),
      parent_page_code: resolvedParent,
      sort_order: nextSiblingSortOrder(resolvedParent),
      route_path: deriveNavRoutePath(entryType, pageCode),
      is_active: true,
      archived_at: null,
    };
    db.nav_page.push(page);
    // New pages start with zero grants (visible to nobody) — the admin adds grant rows afterward
    // via the Permissions tab, same place existing pages are managed from.
    res.json(projectNavPage(page));
  } catch (err) { next(err); }
});

router.put('/nav-pages/:code', async (req, res, next) => {
  try {
    const page = db.nav_page.find((p) => p.page_code === req.params.code);
    if (!page) throw new WorkflowError('Page not found.', 404);
    // page_code and route_path are immutable/derived — every other field (label, icon, order,
    // parent, active) is editable here. Grant rows are managed separately via
    // POST/DELETE /nav-pages/:code/grants (the Permissions tab), not through this endpoint.
    const { label, icon, parentPageCode, active } = req.body;
    if (label !== undefined) page.label = label;
    if (icon !== undefined) page.icon = sanitizeSvgIcon(icon);
    if (parentPageCode !== undefined) {
      if (page.entry_type === 'folder' && parentPageCode) throw new WorkflowError('A folder cannot be nested inside another folder.', 400);
      if (parentPageCode) {
        const parent = db.nav_page.find((p) => p.page_code === parentPageCode);
        if (!parent || parent.entry_type !== 'folder') throw new WorkflowError('Parent must be an existing folder.', 400);
      }
      const resolvedParent = parentPageCode || null;
      // Moving to a different folder (or out to top-level) drops the page at the end of its new
      // sibling list — its old sort_order has no meaning among different siblings.
      if (resolvedParent !== (page.parent_page_code || null)) page.sort_order = nextSiblingSortOrder(resolvedParent);
      page.parent_page_code = resolvedParent;
    }
    if (active !== undefined) page.is_active = active;
    res.json(projectNavPage(page));
  } catch (err) { next(err); }
});

// Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) via the
// shared registry — blocked while the folder still has child pages. Purging cascades to the
// page's own grant rows (see admin-deletion.registry.js's onPurge), matching the prior hard-delete
// cascade.
softDeleteService.mountRoutes(router, '/nav-pages', 'navPage', projectNavPage, 'code');

// ============================================================================
// NAV PAGE PERMISSIONS (Permissions tab) — one page's grant rows at a time, each row
// independently typed (role / unit_role / unit) and OR'd together. See nav_page_grants' comment
// in ems_database_schema.sql.
// ============================================================================

// Pages are capped at 3 permission rows in the UI (one per grant_type at most) to keep the
// Permissions tab scannable — enforced here too so the cap can't be bypassed via direct API calls.
const MAX_GRANTS_PER_PAGE = 3;

router.post('/nav-pages/:code/grants', async (req, res, next) => {
  try {
    const page = db.nav_page.find((p) => p.page_code === req.params.code);
    if (!page) throw new WorkflowError('Page not found.', 404);
    const { grantType, roleCodes, unitCodes } = req.body;
    const validated = validateGrant(grantType, roleCodes, unitCodes);
    const existingOfType = db.nav_page_grants.find((g) => g.page_code === page.page_code && g.grant_type === grantType && !g.archived_at);
    if (existingOfType) throw new WorkflowError(`This page already has a '${grantType}' permission row — edit it instead of adding another.`, 409);
    const rowCount = db.nav_page_grants.filter((g) => g.page_code === page.page_code && !g.archived_at).length;
    if (rowCount >= MAX_GRANTS_PER_PAGE) throw new WorkflowError(`A page can have at most ${MAX_GRANTS_PER_PAGE} permission rows.`, 409);
    const row = { grant_id: nextId('nav_page_grants'), page_code: page.page_code, grant_type: grantType, role_codes: validated.role_codes, unit_codes: validated.unit_codes, is_active: true, archived_at: null };
    db.nav_page_grants.push(row);
    res.status(201).json(projectGrant(row));
  } catch (err) { next(err); }
});

// Edits an existing row's role/unit sets in place (add/remove roles or units from an existing
// permission row) — distinct from PATCH .../active below, which only flips the active toggle.
router.put('/nav-pages/:code/grants/:grantId', async (req, res, next) => {
  try {
    const grantId = Number(req.params.grantId);
    const existing = db.nav_page_grants.find((g) => g.grant_id === grantId && g.page_code === req.params.code);
    if (!existing) throw new WorkflowError('Permission row not found.', 404);
    const { roleCodes, unitCodes } = req.body;
    const validated = validateGrant(existing.grant_type, roleCodes, unitCodes);
    existing.role_codes = validated.role_codes;
    existing.unit_codes = validated.unit_codes;
    res.json(projectGrant(existing));
  } catch (err) { next(err); }
});

router.patch('/nav-pages/:code/grants/:grantId', async (req, res, next) => {
  try {
    const grantId = Number(req.params.grantId);
    const existing = db.nav_page_grants.find((g) => g.grant_id === grantId && g.page_code === req.params.code);
    if (!existing) throw new WorkflowError('Permission row not found.', 404);
    const { active } = req.body;
    if (active === undefined) throw new WorkflowError('active is required.', 400);
    existing.is_active = !!active;
    res.json(projectGrant(existing));
  } catch (err) { next(err); }
});

// Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) via the
// shared registry — a grant row has no dependents of its own, so this never blocks.
softDeleteService.mountRoutes(router, '/nav-pages/:code/grants', 'navPageGrant', projectGrant, 'grantId');

// Roles eligible across one or more units (comma-separated unitCodes) — feeds the Permissions
// tab's role picker when a row's type is Unit + Role. Union across units: picking a School and a
// Service department together offers head-of-school/lecturer/student alongside
// head-of-department/staff (see role-eligibility.service.js's eligibleRolesForUnits()).
router.get('/nav-pages/eligible-roles', async (req, res, next) => {
  try {
    const unitCodes = String(req.query.unitCodes || req.query.unitCode || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (unitCodes.length === 0) return res.json([]);
    res.json(eligibleRolesForUnits(db, unitCodes).map(projectRole));
  } catch (err) { next(err); }
});

// Preview: returns the nav tree as it would render for a chosen (roleCode, unitCode?) pair,
// WITHOUT requiring a real logged-in user holding that combination — used by the admin's
// "Preview as" panel. Synthesizes a throwaway in-memory role assignment, runs the real
// navTreeFor() logic against it, then discards it.
router.get('/nav-pages/preview', async (req, res, next) => {
  try {
    const { roleCode, unitCode } = req.query;
    const role = db.role.find((r) => r.role_code === roleCode);
    if (!role) throw new WorkflowError('Role not found.', 404);
    const flat = isFlatRole(db, role);
    if (!flat && !unitCode) throw new WorkflowError('unitCode is required to preview a role that belongs to one or more units.', 400);
    const { navTreeFor } = require('../services/nav-tree.service');
    const syntheticUserId = -1;
    const removed = db.user_unit_roles.filter((uur) => uur.user_id === syntheticUserId);
    db.user_unit_roles = db.user_unit_roles.filter((uur) => uur.user_id !== syntheticUserId);
    db.user_unit_roles.push({ user_unit_role_id: -1, user_id: syntheticUserId, unit_code: flat ? null : unitCode, role_code: roleCode, assigned_at: new Date().toISOString() });
    const tree = navTreeFor(syntheticUserId);
    db.user_unit_roles = db.user_unit_roles.filter((uur) => uur.user_id !== syntheticUserId).concat(removed);
    res.json(tree);
  } catch (err) { next(err); }
});

module.exports = router;
