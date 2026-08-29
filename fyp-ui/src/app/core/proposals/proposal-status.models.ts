// Pure, Angular-free types for the proposal approval chain.
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

export type DepartmentTaskStatus = 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'completed' | 'cancelled';

export interface DepartmentConfirmation {
  readonly department: string;
  readonly confirmed: boolean;
  // Raw request_task.status, so the UI can distinguish "still waiting on this department" from
  // "this department asked the applicant for changes" — `confirmed` alone cannot.
  readonly status?: DepartmentTaskStatus;
  // The department's push-back comment when status === 'resubmitted'.
  readonly comment?: string;
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

// Human labels for the department a request_task is routed to — used when a DEPARTMENT (rather
// than a single-actor reviewer) asks the applicant for changes. Exported for hub-proposals.ts,
// which needs the same labels on its own split inbox rows when >1 department pushes back at once.
export const DEPARTMENT_LABELS: Readonly<Record<string, string>> = {
  logistics: 'Logistics',
  transportation: 'Transportation',
  photoVideo: 'Photography / Videography',
  soundLight: 'Sound & Light',
  campusTour: 'Campus Tour',
  fmb: 'Food & Beverage',
  waterNormal: 'Mineral Water',
  fundingPurchase: 'Funding / Purchase',
};

// Shared by every place that turns a display name/label into an avatar's initials -
// ReviewerCommentEntry.initials, ProposalConversation's avatar rendering, etc.
export function initialsFor(label: string): string {
  return label.split(/[\s/&]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

// Every comment the applicant needs to answer: the single-actor reviewer stage's comment (when
// the whole proposal was sent back) plus one entry per department that asked for changes while
// department review continues in parallel.
export function allCommentEntries(state: ProposalWorkflowState): readonly ReviewerCommentEntry[] {
  const entries: ReviewerCommentEntry[] = [];
  const reviewer = reviewerCommentEntry(state);
  if (reviewer) entries.push(reviewer);
  for (const confirmation of state.departmentConfirmations ?? []) {
    if (confirmation.status !== 'resubmitted' || !confirmation.comment) continue;
    const label = DEPARTMENT_LABELS[confirmation.department] ?? confirmation.department;
    entries.push({
      stage: 'Department review',
      reviewer: label,
      initials: initialsFor(label),
      text: confirmation.comment,
    });
  }
  return entries;
}

// Shared by proposal-reviewer-view.ts (the reviewer's own read of the comment chain) and
// event-proposal.ts (the applicant's read of the same comment when editing a resubmission-
// required proposal) — same "who said this, at what stage" resolution, one definition.
export function reviewerCommentEntry(state: ProposalWorkflowState): ReviewerCommentEntry | null {
  if (!state.reviewerComment) return null;
  const roleLabel = (state.resumeStage && STAGE_ROLE_LABELS[state.resumeStage])
    ?? ROLE_LABELS[state.rejectedBy ?? '']
    ?? 'Reviewer';
  return { stage: stageLabel(state.stage), reviewer: roleLabel, initials: initialsFor(roleLabel), text: state.reviewerComment };
}
