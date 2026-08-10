import { AuthUser, UserRole } from '../auth/auth.models';
import { DepartmentRequestKind, requestKindsForRole } from '../departments/department-workflow.config';
import { departmentsForRole, ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, reviewerChainForPax, reviewerRoleForStage, roleOwnsWorkflowAction } from './proposal-status.models';

export type ProposalVisibilitySection = 'inbox' | 'ongoing' | 'history';

const APPLICANT_ROLES: readonly UserRole[] = [UserRole.Applicant, UserRole.ClubPresident, UserRole.ExternalUser];

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
    return userIsApplicantForProposal(user, proposal) && proposal.workflow.stage === ProposalStage.NeedsRevision;
  }
  const routedKinds = requestKindsForRole(user.role);
  if (requestKind && routedKinds.length && !routedKinds.includes(requestKind)) return false;
  return roleOwnsWorkflowAction(user.role, proposal.workflow, departmentsForRole(user.role));
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
  return ownedDepartments.length > 0 && proposal.workflow.departmentConfirmations.some((entry) => ownedDepartments.includes(entry.department));
}

function reviewerHasRelation(role: UserRole, proposal: ProposalReviewRecord): boolean {
  const chain = reviewerChainForPax(proposal.totalPax);
  const roleStage = chain.find((stage) => reviewerRoleForStage(stage) === role);
  if (!roleStage) return false;
  if (proposal.workflow.rejectedBy === role) return true;
  const currentIndex = chain.indexOf(proposal.workflow.stage);
  const roleIndex = chain.indexOf(roleStage);
  return proposal.workflow.stage === ProposalStage.Approved
    || currentIndex >= roleIndex;
}
