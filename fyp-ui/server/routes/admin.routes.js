const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { ROLE_LABELS } = require('../services/role-labels');

const router = express.Router();

function unitCodeFor(userId) {
  const link = db.unit_users.find((uu) => uu.user_id === userId);
  return link ? link.unit_code : '';
}

function departmentFor(user, unitCode) {
  const staffRow = db.staff.find((s) => s.user_id === user.user_id);
  if (staffRow) return staffRow.department_or_school;
  const studentRow = db.student.find((s) => s.user_id === user.user_id);
  if (studentRow) return studentRow.school;
  const unit = db.unit.find((u) => u.code === unitCode);
  if (unit) return unit.description;
  const labels = ROLE_LABELS[user.role];
  return labels ? labels.department : '';
}

function projectUser(user) {
  const unitCode = unitCodeFor(user.user_id);
  const labels = ROLE_LABELS[user.role] || { label: user.role, department: '' };
  return {
    id: String(user.user_id),
    displayName: `${user.first_name} ${user.last_name}`,
    username: user.email.split('@')[0],
    email: user.email,
    role: user.role,
    roleLabel: labels.label,
    unitId: unitCode,
    department: departmentFor(user, unitCode),
    active: user.is_active,
  };
}

function projectUnit(unit) {
  return { id: unit.code, name: unit.description, code: unit.code, description: unit.description, active: unit.is_active };
}

router.get('/users', async (_req, res, next) => {
  try {
    res.json(db.users.map(projectUser));
  } catch (err) { next(err); }
});

router.get('/units', async (_req, res, next) => {
  try {
    res.json(db.unit.map(projectUnit));
  } catch (err) { next(err); }
});

function applyUnitLink(userId, unitId) {
  const existing = db.unit_users.find((uu) => uu.user_id === userId);
  if (existing) existing.unit_code = unitId;
  else db.unit_users.push({ user_id: userId, unit_code: unitId });
}

router.post('/users', async (req, res, next) => {
  try {
    const { displayName, username, email, role, unitId, active } = req.body;
    const [firstName, ...rest] = (displayName || '').split(' ');
    const user = {
      user_id: nextId('users'),
      first_name: firstName || displayName || '',
      last_name: rest.join(' '),
      email,
      phone_number: null,
      role,
      is_active: active !== undefined ? active : true,
      password: 'Demo@123',
    };
    db.users.push(user);
    if (unitId) applyUnitLink(user.user_id, unitId);
    res.json(projectUser(user));
  } catch (err) { next(err); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const user = db.users.find((u) => u.user_id === Number(req.params.id));
    if (!user) throw new WorkflowError('User not found.', 404);
    const { displayName, email, role, unitId, active } = req.body;
    if (displayName !== undefined) {
      const [firstName, ...rest] = displayName.split(' ');
      user.first_name = firstName || displayName;
      user.last_name = rest.join(' ');
    }
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (active !== undefined) user.is_active = active;
    if (unitId !== undefined) applyUnitLink(user.user_id, unitId);
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

router.post('/units', async (req, res, next) => {
  try {
    const { code, description, active } = req.body;
    const unit = { code, description, head_user_id: null, is_active: active !== undefined ? active : true };
    db.unit.push(unit);
    res.json(projectUnit(unit));
  } catch (err) { next(err); }
});

router.put('/units/:id', async (req, res, next) => {
  try {
    const unit = db.unit.find((u) => u.code === req.params.id);
    if (!unit) throw new WorkflowError('Unit not found.', 404);
    const { description, active } = req.body;
    if (description !== undefined) unit.description = description;
    if (active !== undefined) unit.is_active = active;
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

module.exports = router;
