// Replaces server/services/user-projection.service.js's unitCodeFor/departmentFor/roleLabelFor
// (built for the old single unit+function_level identity) with lookups over the new
// user_unit_roles many-to-many. See docs/superpowers/specs/
// 2026-08-13-rbac-role-unit-redesign-design.md.
let db;
function init(dbRef) {
  db = dbRef;
}

// Every (unit_code, role_code) pair a user holds, resolved to display data. unit_code is null
// for flat-role rows.
function rolesFor(userId) {
  return db.user_unit_roles
    .filter((uur) => uur.user_id === Number(userId))
    .map((uur) => {
      const role = db.role.find((r) => r.role_code === uur.role_code);
      const unit = uur.unit_code ? db.unit.find((u) => u.code === uur.unit_code) : undefined;
      return {
        assignmentId: uur.user_unit_role_id,
        roleCode: uur.role_code,
        roleName: role ? role.role_name : uur.role_code,
        unitCode: uur.unit_code || null,
        unitDescription: unit ? unit.description : null,
      };
    });
}

// unitCode omitted -> true if the user holds roleCode in ANY unit (or as a flat role).
// unitCode given -> true only for that specific unit.
function hasRole(userId, roleCode, unitCode) {
  return db.user_unit_roles.some((uur) => (
    uur.user_id === Number(userId)
    && uur.role_code === roleCode
    && (unitCode === undefined || uur.unit_code === unitCode)
  ));
}

function unitsHeadedBy(userId) {
  return db.user_unit_roles
    .filter((uur) => uur.user_id === Number(userId) && (uur.role_code === 'head-of-school' || uur.role_code === 'head-of-department'))
    .map((uur) => uur.unit_code);
}

// True if `userId` holds head-of-school or head-of-department on `unitCode` specifically —
// replaces workflow.service.js's old isManagerOfUnit(userId, unitCode).
function isHeadOfUnit(userId, unitCode) {
  return hasRole(userId, 'head-of-school', unitCode) || hasRole(userId, 'head-of-department', unitCode);
}

// Builds the human-facing role label for one (roleName, unitDescription) pair — no more school/
// service_department branching (that vocabulary now lives directly in role.role_name, e.g.
// "Head of School" vs "Head of Department" are already distinct role rows).
function roleLabel(entry) {
  return entry.unitDescription ? `${entry.roleName} — ${entry.unitDescription}` : entry.roleName;
}

// Department/unit string shown in the directory — first unit-scoped role's unit description, or
// the staff/student table's legacy override, or a generic fallback for a user with no unit role
// at all (e.g. system-admin).
function departmentFor(user) {
  const staffRow = db.staff.find((s) => s.user_id === user.user_id);
  if (staffRow && staffRow.department_or_school) return staffRow.department_or_school;
  const studentRow = db.student.find((s) => s.user_id === user.user_id);
  if (studentRow && studentRow.school) return studentRow.school;
  const roles = rolesFor(user.user_id);
  const unitRole = roles.find((r) => r.unitDescription);
  if (unitRole) return unitRole.unitDescription;
  return 'APU Community';
}

// Primary role label shown in the directory / login response — first role wins (roles are
// unordered; "first" here just means array order, matching the old single-role display since
// realistic seed accounts hold exactly one role each).
function primaryRoleLabelFor(user) {
  const roles = rolesFor(user.user_id);
  if (roles.length === 0) return 'Unassigned';
  return roleLabel(roles[0]);
}

module.exports = {
  init,
  rolesFor,
  hasRole,
  unitsHeadedBy,
  isHeadOfUnit,
  roleLabel,
  departmentFor,
  primaryRoleLabelFor,
};
