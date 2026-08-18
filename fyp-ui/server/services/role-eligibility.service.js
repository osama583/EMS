// The 9 protected seed roles — see docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-
// design.md and the 2026-08-17 Role<->Unit refactor. "Is this unit a School" is a pure string
// check on unit.code, never a stored column: the seed data's convention is that every School
// unit's code contains "school" (school_of_computing, school_of_business) and no Service
// department's code does.
function isSchoolUnit(unitCode) {
  return String(unitCode || '').includes('school');
}

const PROTECTED_ROLE_CODES = [
  'head-of-school', 'head-of-department', 'lecturer', 'staff', 'student',
  'cfo', 'cafeteria-admin', 'cafeteria-manager', 'cafeteria-staff', 'external-user', 'system-admin', 'club-admin',
];

// Unit membership for these is no longer a category flag — it's seeded as real `role_unit` rows
// (see db.js's seedRoleUnits()) once units exist. This literal list stays only as the base
// role_code/role_name/description catalog.
const PROTECTED_ROLES = [
  { role_code: 'head-of-school', role_name: 'Head of School', description: 'Heads a School unit; reviews proposals from that School (HOS/HOD stage).' },
  { role_code: 'head-of-department', role_name: 'Head of Department', description: 'Heads a Service department unit; reviews proposals routed to that department.' },
  { role_code: 'lecturer', role_name: 'Lecturer', description: 'Academic staff member of a School.' },
  { role_code: 'staff', role_name: 'Staff', description: 'General staff member of any unit (School or Service department).' },
  { role_code: 'student', role_name: 'Student', description: 'Student enrolled under a School.' },
  { role_code: 'cfo', role_name: 'CFO', description: 'Finance Office — reviews high-pax proposals at the CFO stage.' },
  // Flat, system-wide: creates cafeteria units and assigns cafeteria-manager/cafeteria-staff to
  // them. Distinct from cafeteria-manager/cafeteria-staff, which are unit-linked (see
  // seedCafeteriaDomain() in db.js) — a Cafeteria Admin oversees every cafeteria without being
  // staffed at any single one, the same "flat oversight vs unit-linked staffing" split as
  // system-admin vs a department's head-of-department.
  { role_code: 'cafeteria-admin', role_name: 'Cafeteria Admin', description: 'Creates cafeterias and assigns managers/staff to them.' },
  // Unit-linked (one or more cafeteria_ role_unit rows) — runs one specific cafeteria's menu and
  // day-to-day operations. Reintroduces the pre-2026-08-13-redesign 'cafeteria-manager' concept
  // as a real role now that Cafeteria is a Unit; F&B head-of-department's separate oversight of
  // the food-request review workflow (fmb/waterNormal) is unrelated and unchanged.
  { role_code: 'cafeteria-manager', role_name: 'Cafeteria Manager', description: 'Manages one or more specific cafeterias: menu, staff, day-to-day operations.' },
  // Unit-linked (one or more cafeteria_ role_unit rows) — works at whichever specific cafeteria/
  // cafeterias a Cafeteria Admin assigns them to. No longer flat — see seedCafeteriaDomain().
  { role_code: 'cafeteria-staff', role_name: 'Cafeteria Staff', description: 'Works at a cafeteria assigned by a Cafeteria Admin.' },
  { role_code: 'external-user', role_name: 'External User', description: 'Self-registered guest account from outside the university. Never assignable by an admin.' },
  { role_code: 'system-admin', role_name: 'System Admin', description: 'Manages users, units, roles, and page visibility.' },
  // Flat, system-wide capability: create/delete/deactivate any club and manage club categories.
  // Replaces the old bespoke club_admins flag table (2026-08-17) — granted/revoked exclusively
  // via the normal Users -> Assignments tab like every other role, no separate mechanism. Distinct
  // from Club President, which is per-club (clubs.user_id FK, checked via isPresidentOf()), not a
  // role — a club has exactly one President and it isn't assignable from the Roles system.
  { role_code: 'club-admin', role_name: 'Club Admin', description: 'Creates, deletes, and deactivates clubs; manages club categories. System-wide, not tied to a specific club.' },
];

function isProtectedRole(roleCode) {
  return PROTECTED_ROLE_CODES.includes(roleCode);
}

// Unit codes directly linked to `roleCode` via the role_unit join table.
function unitsForRole(db, roleCode) {
  return db.role_unit.filter((ru) => ru.role_code === roleCode).map((ru) => ru.unit_code);
}

// Roles eligible for `unitCode` — now a direct role_unit membership check (a role is assignable
// with a specific unit only if that exact (role, unit) pair exists in role_unit), replacing the
// old is_unit_scoped/unit_eligibility category match. Used both for the admin's per-unit
// assignment picker and for Unit + Role permission grants. Flat roles (zero role_unit rows) are
// NEVER included here — use flatRolesAvailable() for those instead.
function eligibleRolesForUnit(db, unitCode) {
  const roleCodes = new Set(db.role_unit.filter((ru) => ru.unit_code === unitCode).map((ru) => ru.role_code));
  return db.role.filter((r) => r.is_active && !r.archived_at && roleCodes.has(r.role_code));
}

// A role is Flat if it has zero role_unit rows.
function isFlatRole(db, role) {
  return !db.role_unit.some((ru) => ru.role_code === role.role_code);
}

function flatRoleEligible(db, role) {
  return isFlatRole(db, role) && role.role_code !== 'external-user';
}

function flatRolesAvailable(db) {
  return db.role.filter((r) => r.is_active && !r.archived_at && flatRoleEligible(db, r));
}

// Union of eligibleRolesForUnit() across several units — used by the Page Visibility builder's
// Unit + Role mode, where the admin picks a set of units first and the role checklist narrows to
// whatever's actually assignable across that set (e.g. picking one School and one Service
// department shows head-of-school/lecturer/student alongside head-of-department/staff).
function eligibleRolesForUnits(db, unitCodes) {
  const seen = new Map();
  for (const unitCode of unitCodes) {
    for (const role of eligibleRolesForUnit(db, unitCode)) seen.set(role.role_code, role);
  }
  return [...seen.values()];
}

const HEAD_ROLE_CODES = new Set(['head-of-school', 'head-of-department']);

module.exports = {
  isSchoolUnit,
  PROTECTED_ROLE_CODES,
  PROTECTED_ROLES,
  isProtectedRole,
  unitsForRole,
  eligibleRolesForUnit,
  eligibleRolesForUnits,
  isFlatRole,
  flatRolesAvailable,
  HEAD_ROLE_CODES,
};
