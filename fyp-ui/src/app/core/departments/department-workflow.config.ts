import { UserRole } from '../auth/auth.models';
import { RequestOptionKind } from '../request-options/request-option.models';

export type DepartmentRequestKind =
  | 'logistics'
  | 'campusTour'
  | 'waterLogo'
  | 'waterNormal'
  | 'soundLight'
  | 'photoVideo'
  | 'transportation'
  | 'fnb'
  | 'fundingPurchase';

export interface DepartmentWorkflowConfig {
  readonly managerRole: UserRole;
  readonly staffRole?: UserRole;
  readonly requestKinds: readonly DepartmentRequestKind[];
  readonly optionKinds: readonly RequestOptionKind[];
  readonly assignmentRequired: boolean;
}

export const DEPARTMENT_WORKFLOWS: readonly DepartmentWorkflowConfig[] = [
  { managerRole: UserRole.LogisticsManager, staffRole: UserRole.LogisticsStaff, requestKinds: ['logistics'], optionKinds: ['logistics'], assignmentRequired: true },
  { managerRole: UserRole.StudentServicesManager, staffRole: UserRole.StudentServicesMember, requestKinds: ['campusTour'], optionKinds: ['campusTourStart', 'campusTourArea', 'campusTourMap'], assignmentRequired: true },
  { managerRole: UserRole.FmbManager, staffRole: UserRole.FmbWaterServicesStaff, requestKinds: ['waterLogo', 'waterNormal'], optionKinds: ['dietaryInformation', 'waterLogo', 'waterNormal'], assignmentRequired: true },
  { managerRole: UserRole.CafeteriaManager, requestKinds: ['fnb'], optionKinds: ['fnb', 'servingUnit'], assignmentRequired: false },
  { managerRole: UserRole.AvManager, staffRole: UserRole.AvTechnician, requestKinds: ['soundLight'], optionKinds: ['soundLight'], assignmentRequired: true },
  { managerRole: UserRole.PhotographyManager, staffRole: UserRole.PhotographyStaff, requestKinds: ['photoVideo'], optionKinds: ['photoVideo'], assignmentRequired: true },
  { managerRole: UserRole.TransportManager, staffRole: UserRole.TransportStaff, requestKinds: ['transportation'], optionKinds: ['transportation'], assignmentRequired: true },
  { managerRole: UserRole.Cfo, requestKinds: ['fundingPurchase'], optionKinds: ['fundingMain', 'fundingSub'], assignmentRequired: false },
];

export function workflowForManager(role: UserRole): DepartmentWorkflowConfig | undefined {
  return DEPARTMENT_WORKFLOWS.find((workflow) => workflow.managerRole === role);
}

export function optionKindsForManager(role: UserRole): readonly RequestOptionKind[] {
  return workflowForManager(role)?.optionKinds ?? [];
}

export function requestKindsForManager(role: UserRole): readonly DepartmentRequestKind[] {
  return workflowForManager(role)?.requestKinds ?? [];
}

export function staffRoleForManager(role: UserRole): UserRole | undefined {
  return workflowForManager(role)?.staffRole;
}

export function requestKindsForRole(role: UserRole): readonly DepartmentRequestKind[] {
  return DEPARTMENT_WORKFLOWS.find((workflow) => workflow.managerRole === role || workflow.staffRole === role)?.requestKinds ?? [];
}
