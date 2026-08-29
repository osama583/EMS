import { AuthUser } from '../auth/auth.models';
import { hasRole, unitCodesFor } from '../auth/role-access';
import { RequestOptionKind } from '../request-options/request-option.models';

export type DepartmentRequestKind =
  | 'logistics'
  | 'campusTour'
  | 'waterNormal'
  | 'soundLight'
  | 'photoVideo'
  | 'transportation'
  | 'fmb'
  | 'fundingPurchase';

// RBAC redesign: every department workflow except CFO is keyed by `unitCode`. A unit's
// manager/staff levels are the head-of-department/staff role_codes — there's no
// `managerRole`/`staffRole` field any more. Unit codes below MUST match server/db.js's seeded
// unit codes exactly (see services/unit-code.js's lowercase_with_underscores derivation). F&B
// now owns BOTH the fmb/waterNormal request review AND My Menu/Serving Units (the old separate
// 'cafeteria-manager' role was retired — see docs/superpowers/specs/
// 2026-08-13-rbac-role-unit-redesign-design.md — F&B's head-of-department does the whole job).
export interface UnitDepartmentWorkflowConfig {
  readonly unitCode: string;
  readonly requestKinds: readonly DepartmentRequestKind[];
  readonly optionKinds: readonly RequestOptionKind[];
  readonly assignmentRequired: boolean;
}

// CFO is the one department workflow that stays flat-role-routed (not unit-scoped) — see
// server/services/workflow.service.js's FLAT_ROLE_FOR_REQUIREMENT.
export interface FlatDepartmentWorkflowConfig {
  readonly roleCode: 'cfo';
  readonly requestKinds: readonly DepartmentRequestKind[];
  readonly optionKinds: readonly RequestOptionKind[];
  readonly assignmentRequired: boolean;
}

export const UNIT_DEPARTMENT_WORKFLOWS: readonly UnitDepartmentWorkflowConfig[] = [
  { unitCode: 'logistics_and_facilities', requestKinds: ['logistics'], optionKinds: ['logistics'], assignmentRequired: true },
  { unitCode: 'student_services', requestKinds: ['campusTour'], optionKinds: ['campusTourStart', 'campusTourType'], assignmentRequired: true },
  { unitCode: 'food_beverage_services', requestKinds: ['fmb', 'waterNormal'], optionKinds: ['fmb', 'dietaryInformation', 'servingUnit'], assignmentRequired: false },
  { unitCode: 'a_v_services', requestKinds: ['soundLight'], optionKinds: ['soundLight'], assignmentRequired: true },
  { unitCode: 'photography_services', requestKinds: ['photoVideo'], optionKinds: ['photoVideo'], assignmentRequired: true },
  { unitCode: 'transport_services', requestKinds: ['transportation'], optionKinds: ['transportation'], assignmentRequired: true },
];

// The CFO owns NO department-review request kind: Funding/Purchase is recorded on the form but
// is not part of the approval workflow (no request_task is created for it — see
// server/services/workflow.service.js's NON_WORKFLOW_REQUIREMENTS). The CFO's single workflow
// role is the cfo_review approval stage, which is a REVIEWER action, not a department one — so
// requestKinds is empty and the CFO renders the reviewer view. The optionKinds entry stays,
// because the CFO still curates the Funding/Purchase dropdown catalogs.
export const FLAT_DEPARTMENT_WORKFLOWS: readonly FlatDepartmentWorkflowConfig[] = [
  // 'venue' joins funding as CFO-curated master data: the university's venue
  // list is finance-governed, and putting it here is what gives the Venue
  // Management page the same ownership check, nav grant and Page Visibility row
  // as every other dropdown catalogue rather than a special case.
  { roleCode: 'cfo', requestKinds: [], optionKinds: ['fundingMain', 'fundingSub', 'venue'], assignmentRequired: false },
];

// Accepts either a bare role_code string ('cfo') or a full AuthUser — every caller below
// normalizes to whichever shape applies. `manager` here means "the workflow's owning identity"
// (a Service department's head-of-department, or the CFO flat role), not a literal level marker.
export type WorkflowIdentity = string | AuthUser;

function isFlatRoleCode(identity: WorkflowIdentity): identity is string {
  return typeof identity === 'string';
}

export function workflowForManager(identity: WorkflowIdentity): UnitDepartmentWorkflowConfig | FlatDepartmentWorkflowConfig | undefined {
  if (isFlatRoleCode(identity)) {
    return FLAT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.roleCode === identity);
  }
  if (hasRole(identity, 'cfo')) {
    return FLAT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.roleCode === 'cfo');
  }
  // Cafeteria Manager manages their OWN cafeteria's My Menu (fmb options only) — it is NOT a
  // head-of-department/head-of-school, so it needs its own branch here rather than falling into
  // the headedUnit lookup below. requestKinds stays empty: My Menu is option-management, not
  // request-review (the F&B->Cafeteria-Manager food-selection approval flow is a separate,
  // per-selection concern handled through proposal-visibility.ts, not this config).
  const cafeteriaRole = identity.roles.find((r) => r.roleCode === 'cafeteria-manager' && r.unitCode);
  if (cafeteriaRole) return { unitCode: cafeteriaRole.unitCode!, requestKinds: [], optionKinds: ['fmb'], assignmentRequired: false };
  const headedUnit = identity.roles.find((r) => (r.roleCode === 'head-of-department' || r.roleCode === 'head-of-school') && r.unitCode)?.unitCode;
  if (!headedUnit) return undefined;
  return UNIT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.unitCode === headedUnit);
}

export function optionKindsForManager(identity: WorkflowIdentity): readonly RequestOptionKind[] {
  return workflowForManager(identity)?.optionKinds ?? [];
}

export function requestKindsForManager(identity: WorkflowIdentity): readonly DepartmentRequestKind[] {
  return workflowForManager(identity)?.requestKinds ?? [];
}

export function assignmentRequiredForManager(identity: WorkflowIdentity): boolean {
  return workflowForManager(identity)?.assignmentRequired ?? false;
}

// How many staff may be assigned to a SINGLE requested row for this request kind - mirrors
// the backend's MAX_ASSIGNEES_PER_ROW (workflow/constants.py), which is the actual enforcement;
// this copy only drives the picker's UI (single- vs multi-select), never a security decision.
// null = unlimited (Logistics/Photography/Sound & Light/Campus Tour can each need several
// people on one row); Transportation is capped at 1 - one row is one vehicle, one driver.
const MAX_ASSIGNEES_PER_ROW: Readonly<Partial<Record<DepartmentRequestKind, number | null>>> = {
  logistics: null,
  transportation: 1,
  photoVideo: null,
  soundLight: null,
  campusTour: null,
};

export function maxAssigneesPerRow(requestKind: DepartmentRequestKind): number | null {
  return MAX_ASSIGNEES_PER_ROW[requestKind] ?? null;
}

// Which departments require staff to wait until the task's scheduled day to start it, vs. being
// able to start early. Per spec: Transportation/Photo-Video/Campus Tour (and, separately, Food
// Request via its own cafeteria queue — not a DepartmentRequestKind, so not listed here) are
// same-day-only; Logistics and Sound & Light are unrestricted and can start any time.
const SAME_DAY_START_ONLY: ReadonlySet<DepartmentRequestKind> = new Set(['transportation', 'photoVideo', 'campusTour']);

export function requiresSameDayStart(requestKind: DepartmentRequestKind): boolean {
  return SAME_DAY_START_ONLY.has(requestKind);
}

// A unit's staff members share the SAME unitCode as their head — callers that need "the staff
// role string for this manager" just need the manager's own unitCode.
export function staffUnitCodeForManager(identity: WorkflowIdentity): string | undefined {
  const workflow = workflowForManager(identity);
  return workflow && 'unitCode' in workflow ? workflow.unitCode : undefined;
}

// Looks up requestKinds for either a manager OR a staff-level identity of the same unit/flat
// role — since UnitDepartmentWorkflowConfig no longer distinguishes manager vs staff (both
// levels share the same unitCode -> same requestKinds), this collapses to the same lookup as
// requestKindsForManager for unit-scoped identities, plus the flat 'cfo' lookup.
// 'cafeteria-staff' resolves via the food_beverage_services unit's requestKinds directly (its
// real work is FmbSelection claiming, not requestKinds-scoped view, but the fallback is harmless).
export function requestKindsForRole(identity: WorkflowIdentity): readonly DepartmentRequestKind[] {
  if (isFlatRoleCode(identity)) {
    if (identity === 'cafeteria-staff') return UNIT_DEPARTMENT_WORKFLOWS.find((w) => w.unitCode === 'food_beverage_services')?.requestKinds ?? [];
    return FLAT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.roleCode === identity)?.requestKinds ?? [];
  }
  if (hasRole(identity, 'cfo')) return FLAT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.roleCode === 'cfo')?.requestKinds ?? [];
  if (hasRole(identity, 'cafeteria-staff')) return UNIT_DEPARTMENT_WORKFLOWS.find((w) => w.unitCode === 'food_beverage_services')?.requestKinds ?? [];
  // Cafeteria Manager owns the per-selection fmb approval/resubmit action for their own cafeteria
  // (see workflow.service.js's approveFmbSelection/resubmitFmbSelection and
  // proposal-visibility.ts's cafeteria-manager wiring) — 'fmb' here just needs to be non-empty so
  // userIsRelatedToProposal()'s routedKinds gate doesn't exclude them; the real per-selection
  // ownership check happens in proposal-visibility.ts, not here.
  if (hasRole(identity, 'cafeteria-manager')) return ['fmb'];
  const unitCode = unitCodesFor(identity)[0];
  if (!unitCode) return [];
  return UNIT_DEPARTMENT_WORKFLOWS.find((workflow) => workflow.unitCode === unitCode)?.requestKinds ?? [];
}
