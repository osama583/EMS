const express = require('express');
const { db, nextId } = require('../db');
const { ROLE_LABELS } = require('../services/role-labels');

const router = express.Router();

// Only meaningful for a Cafeteria Manager — identifies which cafeteria (FmbSelection.cafeteriaId)
// this manager is scoped to review (see AuthUser.cafeteriaId in auth.models.ts, documented as
// "Set only for UserRole.CafeteriaManager"). Cafeteria-staff are intentionally excluded even
// though they also have cafeteria_assignment rows, matching that contract. A manager can be
// assigned to multiple cafeterias; pick the lowest cafeteria_id deterministically rather than
// depending on array insertion order.
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

// Self-registration for guest ("Register as a guest") accounts, called AFTER the client-side
// mock OTP challenge in ExternalRegistrationService.verifyOtp() succeeds (see
// external-registration.service.ts) — OTP delivery itself stays a dev-only mock (no real email/
// SMS provider wired up yet), but the account this creates is real: a `users` row with
// role='external-user', persisted via server/data/db.json like every other account, so the
// guest can log back in afterward through the normal POST /login above.
router.post('/register', async (req, res, next) => {
  try {
    const { email, firstName, lastName, age, gender, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !firstName || !password) {
      return res.status(400).json({ message: 'Email, first name, and password are required.' });
    }
    if (db.users.some((u) => u.email === normalizedEmail)) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const user = {
      user_id: nextId('users'),
      first_name: firstName,
      last_name: lastName || '',
      email: normalizedEmail,
      phone_number: null,
      role: 'external-user',
      is_active: true,
      password,
    };
    db.users.push(user);

    if (age !== undefined || gender !== undefined) {
      db.external_user_profile.push({
        external_user_profile_id: nextId('external_user_profile'),
        user_id: user.user_id,
        age: age !== undefined && age !== null && age !== '' ? Number(age) : null,
        gender: gender || null,
        registered_at: new Date().toISOString(),
      });
    }

    const labels = ROLE_LABELS[user.role] || { label: user.role, department: 'External Community' };
    res.status(201).json({
      email: user.email,
      displayName: `${user.first_name} ${user.last_name}`.trim(),
      username: user.email.split('@')[0],
      role: user.role,
      accountType: 'external',
      roleLabel: labels.label,
      department: labels.department,
    });
  } catch (err) { next(err); }
});

module.exports = router;
