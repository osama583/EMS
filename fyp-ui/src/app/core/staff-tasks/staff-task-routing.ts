import { AuthUser } from '../auth/auth.models';
import { hasRole, unitCodesFor } from '../auth/role-access';
import { StaffTaskRoutingKey } from './staff-task.models';

// The 5 Service-department unitCodes that route staff tasks, plus the one flat-routed role. Kept
// in sync by hand with staff-tasks.ts's ROLE_PRESENTATION map (that file owns the per-key display
// config; this one only answers "does this user have a task queue at all").
const TASK_ROUTED_UNIT_CODES: ReadonlySet<string> = new Set([
  'logistics_and_facilities', 'student_services', 'a_v_services', 'photography_services', 'transport_services',
]);

// This user's staff-task routing key, or null if they have no task queue (most roles don't —
// only cafeteria-staff and staff/lecturer/head-of-department assigned to one of the 5 routed
// Service departments do). Mirrors staff-tasks.ts's inline derivation, extracted so other pages
// (records-hub) can ask "does this viewer have a Tasks tab" without duplicating the rule.
export function staffTaskRoutingKeyFor(user: AuthUser): StaffTaskRoutingKey | null {
  if (hasRole(user, 'cafeteria-staff')) return 'cafeteria-staff';
  const routedUnit = unitCodesFor(user).find((code) => TASK_ROUTED_UNIT_CODES.has(code));
  return routedUnit ?? null;
}
