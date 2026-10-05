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

export type FmbSelectionStatus = 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'ready' | 'fulfilled' | 'cancelled';

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

// Fields on this interface fall into two groups: - ALWAYS present: sent by both GET /proposals (list
// rows) and GET /proposals/{id} (full detail) — see proposals.py service's project_list_item() vs
// project().
/** Inbox urgency band. The server pins 'urgent' above 'warning' above everything else. */
export type ProposalUrgency = 'normal' | 'warning' | 'urgent' | 'overdue';

export interface ProposalReviewRecord {
  readonly id: number;
  readonly proposalId: string;
  readonly eventTitle: string;
  readonly applicant: string;
  readonly applicantInitials: string;
  readonly schedule: string;
  readonly totalPax: number;
  readonly status: string;
  // Server-computed, present only on GET /proposals list responses (not single-item reads): which of
  // the four list pages this proposal belongs to for the CALLER specifically, and the human-readable
  // label those pages show as the status badge.
  readonly bucket?: 'inbox' | 'ongoing' | 'history' | 'drafts';
  readonly statusLabel?: string;
  // How close the event is, for a proposal still awaiting a decision (server-computed against the
  // APPROVAL_WARNING_DAYS / APPROVAL_URGENT_DAYS policy values). Absent once a proposal is decided —
  // a settled proposal has no urgency. 'overdue' means the event date passed before anyone decided.
  readonly urgency?: ProposalUrgency | null;
  readonly daysUntilEvent?: number | null;
  // List rows DO include these two: records-page.ts's Drafts table reads shortIntroduction (the
  // 'introduction' cell) and category (its filter dropdown + search), same as full detail.
  readonly shortIntroduction: string;
  readonly category: string;
  readonly applicantEmail: string;
  readonly workflow: ProposalWorkflowState;

  readonly goals?: string;
  readonly benefits?: string;
  readonly requests?: readonly ProposalDepartmentRequest[];
  // Structured (non-flattened) per-requirement rows — mirrors what event-proposal.ts's own requestRows
  // form state holds (date/start/end/withLogo/etc.
  readonly requestRows?: Partial<Record<ProposalDepartmentKey, readonly EditableRow[]>>;

  // Full submission fields — everything the applicant filled out on the event-proposal form,
  // carried through so the Full Reviewer view (View 1) can render it read-only in its entirety.
  readonly applicantDepartment?: string;
  readonly coOwners?: readonly EditableRow[];
  readonly organizers?: readonly EditableRow[];
  readonly importantPeople?: readonly EditableRow[];
  readonly guests?: readonly EditableRow[];
  readonly agenda?: readonly EditableRow[];
  readonly discussions?: readonly EditableRow[];
  // The exception in this block: list rows carry scheduleRows too (proposals.py's
  // project_list_item), because the proposal tables show date, time and location as three
  // separate columns rather than the joined `schedule` string above.
  readonly scheduleRows?: readonly EditableRow[];
  readonly eventImage?: EventImageAsset | null;
  readonly eventVisibility?: EventVisibility;
  // The clubs a 'Club Only' event is addressed to.
  readonly eventClubs?: readonly string[];
  readonly eventClubNames?: readonly string[];
  readonly eventCategories?: readonly string[];
  readonly eventFormat?: string;
  readonly registrationMode?: RegistrationMode;
  readonly publicity?: string;
  readonly costAmount?: number | null;
  readonly bankAccountName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly selectedRequirements?: readonly DepartmentRequestKind[];
  readonly externalPax?: number;
  // Organizer-set registration capacity; null = uncapped.
  readonly maxPax?: number | null;
  // Server-computed: is this proposal still inside its CANCELLATION_DEADLINE_DAYS window? The
  // backend enforces the same rule on POST /cancel — this only decides whether the button shows.
  readonly cancellationOpen?: boolean;
  readonly fmbSelections?: readonly FmbSelection[];
  // Durable "did the caller ever decide this proposal" — mirrors the server's own workflow_history
  // EXISTS check (proposals.py's _VISIBLE_SQL / the 'acted-on' list filter), so a reviewer whose live
  // stage relation has since moved on (see proposal-visibility.ts's reviewerHasRelation) can still be
  // told the proposal is theirs to open, the same way the server already lets them list and fetch it.
  readonly actedByMe?: boolean;
  // The applicant's own school/department unit codes, read off user_unit_roles server-side — the same
  // join _VISIBLE_SQL uses to decide which head of school may see a proposal. `applicantDepartment`
  // above is a free-text display snapshot (NULL on older proposals) and must never be used to decide
  // access; match on these codes instead.
  readonly applicantUnitCodes?: readonly string[];
  // One entry per REQUESTED ITEM, sent only for ?scope=all rows sitting in Implementation. Finer than
  // workflow.departmentConfirmations (one per department): four logistics items can each be at a
  // different step, and rolling them into one 'Logistics' line is what this breakdown exists to undo.
  readonly implementationItems?: readonly ImplementationItem[];
}

/** One row of workflow_history — every action taken on a proposal, in the order it happened. */
export interface ProposalHistoryEntry {
  readonly workflow_history_id: number;
  // submit | approve | resubmit | applicant-resubmit | reject | cancel | task-created | assign-row |
  // create-selection | approve-selection | resubmit-selection …
  readonly action: string;
  readonly actor_name: string | null;
  // 'system' for rows the workflow wrote itself (task-created), which have no actor_user_id.
  readonly actor_role: string | null;
  readonly actor_user_id: number | null;
  readonly comment: string | null;
  readonly previous_status: string | null;
  readonly new_status: string | null;
  readonly created_at: string;
  readonly request_task_id: number | null;
  // The actor's own cafeteria, for a cafeteria manager or staff member. workflow_history does not
  // record WHICH order a step acted on, so with several cafeterias on one proposal this is the only
  // thing that tells their otherwise identical steps apart.
  readonly actor_unit?: string | null;
  // Set on a per-department row, which is what lets the timeline branch once department review
  // starts. Null on the whole-proposal reviewer chain.
  readonly requirement_name: string | null;
}

export interface ImplementationItem {
  readonly department: string;
  readonly item: string;
  // Quantity/pax, or the order's "6 × Level 3 Food Court" for a cafeteria order.
  readonly detail: string;
  // request_row_assignment.status, request_fmb_selection.status, or the server's 'unassigned' /
  // 'unordered' for an item nobody has picked up yet.
  readonly status: string;
  readonly assignees: readonly string[];
}

export function departmentsForRole(identity: WorkflowIdentity): readonly ProposalDepartmentKey[] {
  return requestKindsForManager(identity);
}
