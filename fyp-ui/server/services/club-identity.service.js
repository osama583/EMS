// Club identity: Club Admin (system-wide: create/delete/deactivate any club, manage categories)
// is the 'club-admin' flat role (see role-eligibility.service.js's PROTECTED_ROLES) — granted via
// the normal Users -> Assignments flow like any other role, not a bespoke flag table. Club
// President is different: per-club (clubs.user_id FK), checked via isPresidentOf() below, never a
// role — a club has exactly one President, not an assignable system permission. These are the
// single source of truth for "is this user X?" checks, shared between clubs.routes.js (club
// management/join-request endpoints) and auth.routes.js (so the login response carries club
// status down to the client without duplicating the check anywhere).
const { db } = require('../db');

function isClubAdmin(userId) {
  return db.user_unit_roles.some((uur) => uur.user_id === userId && uur.role_code === 'club-admin');
}

function presidentOfClubIds(userId) {
  return db.clubs.filter((c) => c.user_id === userId).map((c) => c.club_id);
}

function isPresidentOf(userId, clubId) {
  return db.clubs.some((c) => c.club_id === clubId && c.user_id === userId);
}

// Only students and lecturers can be club members or presidents — Service department staff,
// heads of department, etc. have no path to club participation in this system. RBAC redesign:
// 'student' and 'lecturer' are now literal, distinct role_codes (see role-eligibility.service.js),
// so this is a direct role check instead of a function_level+unit_kind derivation.
function isEligibleForClub(user) {
  if (!user) return false;
  return db.user_unit_roles.some((uur) => uur.user_id === user.user_id && (uur.role_code === 'student' || uur.role_code === 'lecturer'));
}

module.exports = { isClubAdmin, presidentOfClubIds, isPresidentOf, isEligibleForClub };
