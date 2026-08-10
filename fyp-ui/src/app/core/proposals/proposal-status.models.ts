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
