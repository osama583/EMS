import { UserRole } from '../auth/auth.models';
import { RequestOptionKind } from './request-option.models';
import { optionKindsForManager } from '../departments/department-workflow.config';

export function managerOptionKinds(role: UserRole): readonly RequestOptionKind[] { return optionKindsForManager(role); }
export function canManageRequestOptions(role: UserRole, cafeteriaPage: boolean): boolean {
  const kinds = managerOptionKinds(role);
  return cafeteriaPage
    ? kinds.some((kind) => kind === 'fmb' || kind === 'servingUnit')
    : kinds.some((kind) => kind !== 'fmb' && kind !== 'servingUnit');
}
