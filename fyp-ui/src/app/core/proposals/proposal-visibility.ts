import { AuthUser, UserRole } from '../auth/auth.models';
import { DepartmentRequestKind, requestKindsForRole } from '../departments/department-workflow.config';
import { departmentsForRole, ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, isReviewerStage } from './proposal-status.models';

export type ProposalVisibilitySection = 'inbox' | 'ongoing' | 'history';

const APPLICANT_ROLES: readonly UserRole[] = [UserRole.Applicant, UserRole.ClubPresident, UserRole.ExternalUser];

// The server owns workflow transitions; this is purely a display-layer mapping from "which stage
// is active" to "which reviewer role's inbox it belongs in" — used only to decide what Angular
// shows, never to decide what happens next.
function reviewerRoleForStage(stage: ProposalStage): UserRole | null {
  switch (stage) {
    case ProposalStage.HosHodReview: return UserRole.HosHod;
    case ProposalStage.FmbReview: return UserRole.Fmb;
    case ProposalStage.CfoReview: return UserRole.Cfo;
    default: return null;
  }
}

export function userIsApplicantForProposal(user: AuthUser | null, proposal: ProposalReviewRecord): boolean {
  if (!user) return false;
  const userEmail = user.email.trim().toLowerCase();
  const userName = user.displayName.trim().toLowerCase();
  const applicantEmail = proposal.applicantEmail.trim().toLowerCase();
  const applicantName = proposal.applicant.trim().toLowerCase();
  if (userEmail && applicantEmail && userEmail === applicantEmail) return true;
  if (userName && applicantName && userName === applicantName) return true;
  return proposal.coOwners.some((coOwner) => {
    const coOwnerEmail = String(coOwner['email'] ?? '').trim().toLowerCase();
    const coOwnerName = String(coOwner['name'] ?? '').trim().toLowerCase();
    return (userEmail && coOwnerEmail && userEmail === coOwnerEmail) || (userName && coOwnerName && userName === coOwnerName);
  });
}

export function userOwnsCurrentProposalAction(user: AuthUser | null, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): boolean {
  if (!user) return false;
  if (APPLICANT_ROLES.includes(user.role)) {
    return userIsApplicantForProposal(user, proposal) && proposal.workflow.stage === ProposalStage.ResubmissionRequired;
  }
  const routedKinds = requestKindsForRole(user.role);
  if (requestKind && routedKinds.length && !routedKinds.includes(requestKind)) return false;
  return roleOwnsWorkflowAction(user.role, proposal.workflow);
}

// Whether `role` currently owns an action on a proposal in `state` — the single source of truth
// for "is this actually this user's job right now", used to keep restricted proposals out of a
// role's Inbox in the first place rather than showing them and then blocking the action. This is
// a read-only display filter over server-reported state, not a transition decision.
function roleOwnsWorkflowAction(role: UserRole, state: ProposalReviewRecord['workflow']): boolean {
  if (isReviewerStage(state.stage)) return reviewerRoleForStage(state.stage) === role;
  if (state.stage === ProposalStage.DepartmentReview) {
    const ownedDepartments = departmentsForRole(role);
    return state.departmentConfirmations.some((entry) => !entry.confirmed && ownedDepartments.includes(entry.department as DepartmentRequestKind));
  }
  return false;
}

export function proposalSectionForUser(user: AuthUser | null, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): ProposalVisibilitySection | null {
  if (!user || !userIsRelatedToProposal(user, proposal, requestKind)) return null;
  if (proposal.workflow.stage === ProposalStage.Approved || proposal.workflow.stage === ProposalStage.Rejected) return 'history';
  if (userOwnsCurrentProposalAction(user, proposal, requestKind)) return 'inbox';
  return 'ongoing';
}

function userIsRelatedToProposal(user: AuthUser, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): boolean {
  if (userIsApplicantForProposal(user, proposal)) return true;
  const role = user.role;
  const routedKinds = requestKindsForRole(role);
  if (requestKind && routedKinds.length && !routedKinds.includes(requestKind)) return false;
  if (reviewerHasRelation(role, proposal)) return true;
  const ownedDepartments = departmentsForRole(role);
  return ownedDepartments.length > 0 && proposal.workflow.departmentConfirmations.some((entry) => ownedDepartments.includes(entry.department as DepartmentRequestKind));
}

// Fixed display order of the reviewer chain, used only to tell whether a reviewer's own stage is
// still ahead, current, or already passed for a given proposal — never to decide whether a stage
// applies at all (the server alone decides that, e.g. via the pax threshold for F&B/CFO).
const REVIEWER_STAGE_ORDER: readonly ProposalStage[] = [ProposalStage.HosHodReview, ProposalStage.FmbReview, ProposalStage.CfoReview, ProposalStage.DepartmentReview];

function reviewerHasRelation(role: UserRole, proposal: ProposalReviewRecord): boolean {
  const roleStage = REVIEWER_STAGE_ORDER.find((stage) => reviewerRoleForStage(stage) === role);
  if (!roleStage) return false;
  if (proposal.workflow.rejectedBy === role) return true;
  const currentIndex = REVIEWER_STAGE_ORDER.indexOf(proposal.workflow.stage);
  const roleIndex = REVIEWER_STAGE_ORDER.indexOf(roleStage);
  return proposal.workflow.stage === ProposalStage.Approved
    || currentIndex >= roleIndex;
}
