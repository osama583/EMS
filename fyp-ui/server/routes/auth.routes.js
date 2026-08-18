const express = require('express');
const { db, nextId } = require('../db');
const { isClubAdmin, presidentOfClubIds } = require('../services/club-identity.service');
const { rolesFor, roleLabel, departmentFor } = require('../services/user-access.service');
const { navTreeFor } = require('../services/nav-tree.service');

const router = express.Router();

// 2026-08-17 Cafeteria refactor: 'cafeteria-manager' is a real, unit-linked role again (a
// Cafeteria is a Unit — see db.js's seedCafeteriaDomain()) — this identifies which cafeteria
// unit a Cafeteria Manager is scoped to (a manager may hold the role at more than one cafeteria;
// picks the lowest user_unit_role_id deterministically rather than depending on array order, same
// precedent as the pre-refactor cafeteria_assignment-based lookup this replaces). F&B's
// head-of-department is an unrelated role (food-request REVIEW workflow, not any specific
// cafeteria) and is intentionally excluded here — see cafeteria-menu-viewer.ts for its own
// separate read-only cross-cafeteria view.
function cafeteriaCodeFor(user) {
  const assignments = db.user_unit_roles.filter((uur) => uur.user_id === user.user_id && uur.role_code === 'cafeteria-manager');
  if (assignments.length === 0) return undefined;
  const first = assignments.reduce((a, b) => (a.user_unit_role_id < b.user_unit_role_id ? a : b));
  return first.unit_code;
}

function projectAuthUser(user) {
  const roles = rolesFor(user.user_id);
  const cafeteriaCode = cafeteriaCodeFor(user);
  return {
    id: String(user.user_id),
    email: user.email,
    displayName: user.full_name,
    username: user.username,
    roles: roles.map((r) => ({ roleCode: r.roleCode, roleName: r.roleName, unitCode: r.unitCode, unitDescription: r.unitDescription })),
    roleLabel: roles.length > 0 ? roleLabel(roles[0]) : 'Unassigned',
    department: departmentFor(user),
    accountType: roles.some((r) => r.roleCode === 'external-user') ? 'external' : 'internal',
    ...(cafeteriaCode !== undefined ? { cafeteriaCode } : {}),
    isClubAdmin: isClubAdmin(user.user_id),
    presidentOfClubIds: presidentOfClubIds(user.user_id).map(String),
    nav: navTreeFor(user.user_id),
  };
}

// Dev-only: feeds the login screen's "Development demo users" picker (see login.ts) with the
// REAL seeded accounts straight from the db, so that list can never drift from server/db.js's
// actual SEED_ACCOUNTS the way the old hand-transcribed frontend copy (mock-users.ts) did —
// single source of truth. Only accounts that can actually log in are listed (roleless accounts
// are 403'd by POST /login above; external-user is the self-registration flow, not a demo
// account). Plaintext seed password included ONLY here, for the dev-only autofill picker — never
// returned by POST /login or GET /me. Not mounted/reachable when environment.enableMockAuth is
// false (production build's login.ts never calls this).
router.get('/demo-users', async (_req, res, next) => {
  try {
    const users = db.users
      .filter((u) => !u.archived_at && u.is_active)
      .map((u) => ({ user: u, roles: rolesFor(u.user_id) }))
      .filter(({ roles }) => roles.length > 0 && !roles.some((r) => r.roleCode === 'external-user'))
      .map(({ user }) => ({ ...projectAuthUser(user), password: user.password }));
    res.json(users);
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find((u) => u.email === email && u.password === password);
    if (!user) return res.status(401).json({ message: 'The email or password is incorrect.' });
    // A user is created with identity fields only; role/unit assignment happens afterward on the
    // Assignments tab. Until an admin assigns at least one role, the account has no access to
    // authorize and cannot sign in — reject here rather than letting a roleless session through.
    if (rolesFor(user.user_id).length === 0) {
      return res.status(403).json({ message: 'This account has no role assigned yet. Contact a System Admin to assign a role before signing in.' });
    }
    res.json(projectAuthUser(user));
  } catch (err) { next(err); }
});

// Re-fetches the caller's own session projection (roles, nav tree, club identity — everything
// projectAuthUser() computes) without a full re-login. The nav tree in particular is only ever
// computed at login time and then cached client-side (AuthService persists AuthUser to
// localStorage) — an admin editing Page Visibility, Roles, or Units elsewhere doesn't retroactively
// touch anyone's cached session, so every internal page that mutates nav_page/nav_page_grants/
// role/user_unit_roles calls this afterward (see AdminDirectoryService.refresh())
// to pull a fresh nav tree into the CURRENT admin's own sidebar immediately. Takes userId as a
// query param rather than requiring real auth middleware — this mock backend has none; a real
// deployment would derive the user from the session/token instead of trusting a client-supplied id.
router.get('/me', async (req, res, next) => {
  try {
    const userId = Number(req.query.userId);
    const user = db.users.find((u) => u.user_id === userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(projectAuthUser(user));
  } catch (err) { next(err); }
});

// Self-registration for guest ("Register as a guest") accounts, called AFTER the client-side
// mock OTP challenge in ExternalRegistrationService.verifyOtp() succeeds (see
// external-registration.service.ts) — OTP delivery itself stays a dev-only mock (no real email/
// SMS provider wired up yet), but the account this creates is real: a `users` row +
// user_unit_roles row with role_code='external-user', persisted via server/data/db.json like
// every other account, so the guest can log back in afterward through the normal POST /login
// above.
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
      full_name: `${firstName} ${lastName || ''}`.trim(),
      username: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password,
      is_active: true,
    };
    db.users.push(user);
    db.user_unit_roles.push({
      user_unit_role_id: nextId('user_unit_roles'),
      user_id: user.user_id,
      unit_code: null,
      role_code: 'external-user',
      assigned_at: new Date().toISOString(),
    });

    if (age !== undefined || gender !== undefined) {
      db.external_user_profile.push({
        external_user_profile_id: nextId('external_user_profile'),
        user_id: user.user_id,
        age: age !== undefined && age !== null && age !== '' ? Number(age) : null,
        gender: gender || null,
        registered_at: new Date().toISOString(),
      });
    }

    res.status(201).json(projectAuthUser(user));
  } catch (err) { next(err); }
});

module.exports = router;
