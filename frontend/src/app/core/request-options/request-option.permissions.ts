import { RequestOptionKind } from './request-option.models';
import { optionKindsForManager, WorkflowIdentity } from '../departments/department-workflow.config';

export function managerOptionKinds(identity: WorkflowIdentity): readonly RequestOptionKind[] { return optionKindsForManager(identity); }
export function canManageRequestOptions(identity: WorkflowIdentity, cafeteriaPage: boolean): boolean {
  const kinds = managerOptionKinds(identity);
  return cafeteriaPage
    ? kinds.some((kind) => kind === 'fmb' || kind === 'servingUnit')
    : kinds.some((kind) => kind !== 'fmb' && kind !== 'servingUnit');
}
