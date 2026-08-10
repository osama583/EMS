import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind, requestKindsForManager } from '../departments/department-workflow.config';
import { EventImageAsset, EventVisibility, RegistrationMode } from '../events/published-event.models';
import { EditableRow } from '../../shared/components/form-controls/form-controls.models';
import { ProposalWorkflowState } from './proposal-status.models';

export type ProposalDepartmentKey = DepartmentRequestKind;

export interface ProposalDepartmentRequest {
  readonly id: number;
  readonly department: ProposalDepartmentKey;
  readonly item: string;
  readonly quantity: string;
  readonly schedule: string;
  readonly location: string;
  readonly notes: string;
}

export type FmbSelectionStatus = 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'fulfilled' | 'cancelled';

export interface FmbSelection {
  readonly id: number;
  readonly cafeteriaId: number;
  readonly cafeteriaName: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly notes: string;
  readonly status: FmbSelectionStatus;
}

export interface ProposalReviewRecord {
  readonly id: number;
  readonly proposalId: string;
  readonly eventTitle: string;
  readonly applicant: string;
  readonly applicantInitials: string;
  readonly schedule: string;
  readonly shortIntroduction: string;
  readonly goals: string;
  readonly benefits: string;
  readonly totalPax: number;
  readonly status: string;
  readonly category: string;
  readonly requests: readonly ProposalDepartmentRequest[];

  // Full submission fields — everything the applicant filled out on the event-proposal form,
  // carried through so the Full Reviewer view (View 1) can render it read-only in its entirety.
  readonly applicantEmail: string;
  readonly applicantDepartment: string;
  readonly coOwners: readonly EditableRow[];
  readonly organizers: readonly EditableRow[];
  readonly importantPeople: readonly EditableRow[];
  readonly guests: readonly EditableRow[];
  readonly agenda: readonly EditableRow[];
  readonly discussions: readonly EditableRow[];
  readonly scheduleRows: readonly EditableRow[];
  readonly eventImage: EventImageAsset | null;
  readonly eventVisibility: EventVisibility;
  readonly eventCategories: readonly string[];
  readonly eventFormat: 'On Campus' | 'Online' | 'Hybrid' | 'Off Campus';
  readonly registrationMode: RegistrationMode;
  readonly publicity: string;
  readonly selectedRequirements: readonly DepartmentRequestKind[];
  readonly externalPax: number;
  readonly fmbSelections?: readonly FmbSelection[];

  readonly workflow: ProposalWorkflowState;
}

export function departmentsForRole(role: UserRole): readonly ProposalDepartmentKey[] {
  return requestKindsForManager(role);
}
