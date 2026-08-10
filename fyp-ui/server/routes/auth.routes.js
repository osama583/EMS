const express = require('express');
const { db } = require('../db');
const { ROLE_LABELS } = require('../services/role-labels');

const router = express.Router();

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
    res.json({
      email: user.email,
      displayName: `${user.first_name} ${user.last_name}`,
      username: user.email.split('@')[0],
      role: user.role,
      accountType: user.role === 'external-user' ? 'external' : 'internal',
      roleLabel: labels.label,
      department: departmentFor(user),
    });
  } catch (err) { next(err); }
});

module.exports = router;
