import { AuthUser } from '../auth/auth.models';
import { DepartmentRequestKind, requestKindsForManager, WorkflowIdentity } from '../departments/department-workflow.config';
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
  // The raw request_fmb row (applicant's original food/water ask) this selection fulfills —
  // several selections can point at the same requestFmbId (F&B fans one request out across
  // multiple cafeterias/orders until the requested pax is covered).
  readonly requestFmbId: number;
  // Cafeteria unit code (unit.code, CAFETERIA_UNIT_PREFIX-coded) — a Cafeteria is a Unit, see
  // server/db.js's seedCafeteriaDomain().
  readonly cafeteriaCode: string;
  readonly cafeteriaName: string;
  // The fmb_options row this order was placed against — needed so F&B's edit form can preselect
  // the current menu item when the owning Cafeteria Manager pushes the order back.
  readonly fmbOptionId: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly notes: string;
  readonly status: FmbSelectionStatus;
  // Why the owning Cafeteria Manager sent this specific order back to F&B. Empty otherwise.
  readonly managerComment: string;
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
  // Structured (non-flattened) per-requirement rows — mirrors what event-proposal.ts's own
  // requestRows form state holds (date/start/end/withLogo/etc. as individual fields, plus each
  // option-picker field encoded as `${kind}:${option_id}`). `requests` above is a display-only
  // projection with pre-joined strings and is NOT sufficient to repopulate the editable form.
  readonly requestRows?: Partial<Record<ProposalDepartmentKey, readonly EditableRow[]>>;

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
  readonly eventFormat: string;
  readonly registrationMode: RegistrationMode;
  readonly publicity: string;
  readonly costAmount?: number | null;
  readonly bankAccountName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly selectedRequirements: readonly DepartmentRequestKind[];
  readonly externalPax: number;
  // Organizer-set registration capacity; null = uncapped.
  readonly maxPax?: number | null;
  // Server-computed: is this proposal still inside its CANCELLATION_DEADLINE_DAYS window? The
  // backend enforces the same rule on POST /cancel — this only decides whether the button shows.
  readonly cancellationOpen?: boolean;
  readonly fmbSelections?: readonly FmbSelection[];

  readonly workflow: ProposalWorkflowState;
}

export function departmentsForRole(identity: WorkflowIdentity): readonly ProposalDepartmentKey[] {
  return requestKindsForManager(identity);
}
