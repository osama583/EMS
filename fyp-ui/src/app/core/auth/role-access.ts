// RBAC redesign helpers — role checks against AuthUser.roles[] replacing UserRole enum
// comparisons and FunctionLevel/UnitKind checks. See docs/superpowers/specs/
// 2026-08-13-rbac-role-unit-redesign-design.md.
import { AuthUser } from './auth.models';

// True if `user` holds `roleCode` in ANY unit (or as a flat role). Pass `unitCode` to check a
// specific unit only.
export function hasRole(user: AuthUser, roleCode: string, unitCode?: string): boolean {
  return user.roles.some((r) => r.roleCode === roleCode && (unitCode === undefined || r.unitCode === unitCode));
}

export function hasAnyRole(user: AuthUser, roleCodes: readonly string[]): boolean {
  return user.roles.some((r) => roleCodes.includes(r.roleCode));
}

export function unitCodesFor(user: AuthUser): readonly string[] {
  return user.roles.filter((r) => r.unitCode).map((r) => r.unitCode as string);
}

// Display-only department/unit string — first unit-scoped role's unit description, or a generic
// fallback for a user with no unit role at all (mirrors the server's user-access.service.js's
// departmentFor(), minus the staff/student legacy-table override which only matters server-side).
export function departmentFor(user: AuthUser): string {
  const unitRole = user.roles.find((r) => r.unitDescription);
  return unitRole?.unitDescription ?? 'APU Community';
}

export function isSystemAdmin(user: AuthUser): boolean {
  return hasRole(user, 'system-admin');
}

export function isExternalUser(user: AuthUser): boolean {
  return hasRole(user, 'external-user');
}

const HEAD_ROLE_CODES = ['head-of-school', 'head-of-department'];
const STAFF_LIKE_ROLE_CODES = ['lecturer', 'staff', 'cafeteria-staff'];

export function isHeadOfAnyUnit(user: AuthUser): boolean {
  return hasAnyRole(user, HEAD_ROLE_CODES);
}

export function isStaffLike(user: AuthUser): boolean {
  return hasAnyRole(user, STAFF_LIKE_ROLE_CODES);
}

// Saved-events access: every unit-scoped user, plus the two flat roles that had it under the
// old model (external-user's own equivalent is handled separately — external accounts don't
// reach the internal shell at all). Kept as an explicit allowlist rather than "has any role" so
// cafeteria-admin/system-admin (never granted this before) don't silently gain it.
export function roleCanUseSavedEvents(user: AuthUser): boolean {
  if (hasRole(user, 'cfo')) return true;
  return unitCodesFor(user).length > 0;
}

// Student or lecturer — the only two roles eligible for club membership/presidency (mirrors the
// server's club-identity.service.js's isEligibleForClub()).
export function isSchoolStudentOrLecturer(user: AuthUser): boolean {
  return hasAnyRole(user, ['student', 'lecturer']);
}

export function isClubPresident(user: AuthUser): boolean {
  return Boolean(user.presidentOfClubIds && user.presidentOfClubIds.length > 0);
}
