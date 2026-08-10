import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';

// Pure, Angular-free state machine for the proposal approval chain:
//   HOS/HOD -> (F&B Reviewer -> CFO, only if totalPax > 50) -> Department Review (parallel) -> Approved
// Reject (HOS/HOD, CFO, F&B Reviewer only) ends the proposal. Resubmit-with-comment sends it back to the
// applicant; on re-submission it resumes at `resumeStage`, not the start of the chain.
export enum ProposalStage {
  HosHodReview = 'hos-hod-review',
  FmbReviewerPending = 'fmb-reviewer-pending',
  CfoReview = 'cfo-review',
  DepartmentReview = 'department-review',
  Approved = 'approved',
  Rejected = 'rejected',
  NeedsRevision = 'needs-revision',
}

export interface DepartmentConfirmation {
  readonly department: DepartmentRequestKind;
  readonly confirmed: boolean;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
}

export interface ProposalWorkflowState {
  readonly stage: ProposalStage;
  readonly resumeStage?: ProposalStage;
  readonly reviewerComment?: string;
  readonly rejectedBy?: UserRole;
  readonly rejectedReason?: string;
  readonly departmentConfirmations: readonly DepartmentConfirmation[];
}


export function initialWorkflowState(selectedRequirements: readonly DepartmentRequestKind[]): ProposalWorkflowState {
  return {
    stage: ProposalStage.HosHodReview,
    departmentConfirmations: requiredDepartmentsFor(selectedRequirements).map((department) => ({ department, confirmed: false })),
  };
}

export function reviewerChainForPax(totalPax: number, paxThreshold: number = 50): readonly ProposalStage[] {
  return totalPax > paxThreshold
    ? [ProposalStage.HosHodReview, ProposalStage.FmbReviewerPending, ProposalStage.CfoReview, ProposalStage.DepartmentReview]
    : [ProposalStage.HosHodReview, ProposalStage.DepartmentReview];
}

export function nextStageAfterApproval(current: ProposalStage, totalPax: number, paxThreshold: number = 50): ProposalStage {
  const chain = reviewerChainForPax(totalPax, paxThreshold);
  const index = chain.indexOf(current);
  if (index === -1 || index === chain.length - 1) return ProposalStage.DepartmentReview;
  return chain[index + 1];
}

export function requiredDepartmentsFor(selectedRequirements: readonly DepartmentRequestKind[]): readonly DepartmentRequestKind[] {
  return [...new Set(selectedRequirements)];
}

export function applyReviewerApproval(state: ProposalWorkflowState, totalPax: number, paxThreshold: number = 50): ProposalWorkflowState {
  return { ...state, stage: nextStageAfterApproval(state.stage, totalPax, paxThreshold) };
}

export function applyReviewerRejection(state: ProposalWorkflowState, reviewer: UserRole, reason: string): ProposalWorkflowState {
  return { ...state, stage: ProposalStage.Rejected, rejectedBy: reviewer, rejectedReason: reason };
}

export function applyReviewerResubmit(state: ProposalWorkflowState, fromStage: ProposalStage, comment: string): ProposalWorkflowState {
  return { ...state, stage: ProposalStage.NeedsRevision, resumeStage: fromStage, reviewerComment: comment };
}

export function applyApplicantResubmit(state: ProposalWorkflowState): ProposalWorkflowState {
  const { resumeStage, reviewerComment, ...rest } = state;
  return { ...rest, stage: resumeStage ?? ProposalStage.HosHodReview };
}

export function applyDepartmentConfirmation(
  state: ProposalWorkflowState,
  department: DepartmentRequestKind,
  confirmedBy: string,
): ProposalWorkflowState {
  const departmentConfirmations = state.departmentConfirmations.map((entry) =>
    entry.department === department
      ? { ...entry, confirmed: true, confirmedAt: new Date().toISOString(), confirmedBy }
      : entry,
  );
  const allConfirmed = departmentConfirmations.every((entry) => entry.confirmed);
  return { ...state, departmentConfirmations, stage: allConfirmed ? ProposalStage.Approved : state.stage };
}

export function applyDepartmentResubmit(
  state: ProposalWorkflowState,
  department: DepartmentRequestKind,
  comment: string,
): ProposalWorkflowState {
  return { ...state, stage: ProposalStage.NeedsRevision, resumeStage: ProposalStage.DepartmentReview, reviewerComment: comment };
}

export function isReviewerStage(stage: ProposalStage): boolean {
  return stage === ProposalStage.HosHodReview || stage === ProposalStage.FmbReviewerPending || stage === ProposalStage.CfoReview;
}

// Whether `role` currently owns an action on a proposal in `state` — the single source of truth
// for "is this actually this user's job right now", used to keep restricted proposals out of a
// role's Inbox in the first place rather than showing them and then blocking the action.
export function roleOwnsWorkflowAction(
  role: UserRole,
  state: ProposalWorkflowState,
  departmentsForRole: readonly DepartmentRequestKind[],
): boolean {
  if (role === UserRole.Applicant || role === UserRole.ClubPresident || role === UserRole.ExternalUser) {
    return state.stage === ProposalStage.NeedsRevision;
  }
  if (isReviewerStage(state.stage)) return reviewerRoleForStage(state.stage) === role;
  if (state.stage === ProposalStage.DepartmentReview) {
    return state.departmentConfirmations.some((entry) => !entry.confirmed && departmentsForRole.includes(entry.department));
  }
  return false;
}

export function reviewerRoleForStage(stage: ProposalStage): UserRole | null {
  switch (stage) {
    case ProposalStage.HosHodReview: return UserRole.HosHod;
    case ProposalStage.FmbReviewerPending: return UserRole.FmbReviewer;
    case ProposalStage.CfoReview: return UserRole.Cfo;
    default: return null;
  }
}

export function stageLabel(stage: ProposalStage): string {
  switch (stage) {
    case ProposalStage.HosHodReview: return 'HOS/HOD review';
    case ProposalStage.FmbReviewerPending: return 'F&B review';
    case ProposalStage.CfoReview: return 'CFO review';
    case ProposalStage.DepartmentReview: return 'Department review';
    case ProposalStage.Approved: return 'Approved';
    case ProposalStage.Rejected: return 'Rejected';
    case ProposalStage.NeedsRevision: return 'Revision required';
  }
}
