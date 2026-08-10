const express = require('express');
const { db } = require('../db');
const { ROLE_LABELS } = require('../services/role-labels');

const router = express.Router();

// Only meaningful for a Cafeteria Manager — identifies which cafeteria (FmbSelection.cafeteriaId)
// this manager is scoped to review (see AuthUser.cafeteriaId in auth.models.ts, documented as
// "Set only for UserRole.CafeteriaManager"). Cafeteria-staff are intentionally excluded even
// though they also have cafeteria_assignment rows, matching that contract. A manager can be
// assigned to multiple cafeterias (see seed-cafeteria.js); pick the lowest cafeteria_id
// deterministically rather than depending on array insertion order.
function cafeteriaIdFor(user) {
  if (user.role !== 'cafeteria-manager') return undefined;
  const assignments = db.cafeteria_assignment.filter(
    (a) => a.user_id === user.user_id && a.assignment_role === 'manager',
  );
  if (assignments.length === 0) return undefined;
  return Math.min(...assignments.map((a) => a.cafeteria_id));
}

function departmentFor(user) {
  const staffRow = db.staff.find((s) => s.user_id === user.user_id);
  if (staffRow) return staffRow.department_or_school;
  const studentRow = db.student.find((s) => s.user_id === user.user_id);
  if (studentRow) return studentRow.school;
  const labels = ROLE_LABELS[user.role];
  return labels ? labels.department : 'APU Community';
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find((u) => u.email === email && u.password === password);
    if (!user) return res.status(401).json({ message: 'The email or password is incorrect.' });
    const labels = ROLE_LABELS[user.role] || { label: user.role, department: 'APU Community' };
    const cafeteriaId = cafeteriaIdFor(user);
    res.json({
      email: user.email,
      displayName: `${user.first_name} ${user.last_name}`,
      username: user.email.split('@')[0],
      role: user.role,
      accountType: user.role === 'external-user' ? 'external' : 'internal',
      roleLabel: labels.label,
      department: departmentFor(user),
      ...(cafeteriaId !== undefined ? { cafeteriaId } : {}),
    });
  } catch (err) { next(err); }
});

module.exports = router;
