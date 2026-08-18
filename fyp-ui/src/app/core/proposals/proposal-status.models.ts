// Pure, Angular-free types for the proposal approval chain. The actual state-transition
// logic (who can act, what happens next) lives server-side — see system.md's stated
// principle "the backend owns the workflow, not the frontend." This file only holds the
// shared vocabulary (stage names) and pure display helpers the UI needs to render whatever
// state the server returns.
export enum ProposalStage {
  Submitted = 'submitted',
  HosHodReview = 'hos-hod-review',
  FmbReview = 'fmb-review',
  CfoReview = 'cfo-review',
  DepartmentReview = 'department-review',
  ResubmissionRequired = 'resubmission-required',
  Approved = 'approved',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
}

export interface DepartmentConfirmation {
  readonly department: string;
  readonly confirmed: boolean;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
}

export interface ProposalWorkflowState {
  readonly stage: ProposalStage;
  readonly resumeStage?: ProposalStage;
  readonly reviewerComment?: string;
  readonly rejectedBy?: string;
  readonly rejectedReason?: string;
  readonly departmentConfirmations: readonly DepartmentConfirmation[];
}

export function isReviewerStage(stage: ProposalStage): boolean {
  return stage === ProposalStage.HosHodReview || stage === ProposalStage.FmbReview || stage === ProposalStage.CfoReview;
}

export function stageLabel(stage: ProposalStage): string {
  switch (stage) {
    case ProposalStage.Submitted: return 'Submitted';
    case ProposalStage.HosHodReview: return 'HOS/HOD review';
    case ProposalStage.FmbReview: return 'F&B review';
    case ProposalStage.CfoReview: return 'CFO review';
    case ProposalStage.DepartmentReview: return 'Department review';
    case ProposalStage.ResubmissionRequired: return 'Revision required';
    case ProposalStage.Approved: return 'Approved';
    case ProposalStage.Rejected: return 'Rejected';
    case ProposalStage.Cancelled: return 'Cancelled';
  }
}

const STAGE_ROLE_LABELS: Partial<Record<ProposalStage, string>> = {
  [ProposalStage.HosHodReview]: 'HOS/HOD',
  [ProposalStage.FmbReview]: 'F&B',
  [ProposalStage.CfoReview]: 'CFO',
};
const ROLE_LABELS: Readonly<Record<string, string>> = {
  cfo: 'CFO',
  'head-of-school': 'HOS/HOD',
  'head-of-department': 'F&B',
};

export interface ReviewerCommentEntry {
  readonly stage: string;
  readonly reviewer: string;
  readonly initials: string;
  readonly text: string;
}

// Shared by proposal-reviewer-view.ts (the reviewer's own read of the comment chain) and
// event-proposal.ts (the applicant's read of the same comment when editing a resubmission-
// required proposal) — same "who said this, at what stage" resolution, one definition.
export function reviewerCommentEntry(state: ProposalWorkflowState): ReviewerCommentEntry | null {
  if (!state.reviewerComment) return null;
  const roleLabel = (state.resumeStage && STAGE_ROLE_LABELS[state.resumeStage])
    ?? ROLE_LABELS[state.rejectedBy ?? '']
    ?? 'Reviewer';
  const initials = roleLabel.split(/[\s/&]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return { stage: stageLabel(state.stage), reviewer: roleLabel, initials, text: state.reviewerComment };
}
