import { AuthUser } from '../auth/auth.models';
import { departmentFor, hasRole, isExternalUser } from '../auth/role-access';
import { DepartmentRequestKind, requestKindsForRole } from '../departments/department-workflow.config';
import { departmentsForRole, ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, isReviewerStage } from './proposal-status.models';

export type ProposalVisibilitySection = 'inbox' | 'ongoing' | 'history';

// RBAC redesign: "is this user an applicant-like proposal owner" is external-user plus any
// unit-scoped user holding 'staff'/'lecturer'/'student'. Deliberately EXCLUDES
// head-of-school/head-of-department — matching the old APPLICANT_ROLES list's precedent, which
// never included HosHod even though a head CAN submit their own proposal (that triggers a
// distinct self-review skip handled server-side in workflow.service.js's submitProposal(), not a
// visibility-layer "applicant" concern) — heads are primarily reviewers/department owners for
// this display filter's purposes. Club President is a data fact layered on a Student/Lecturer
// account (see AuthUser.presidentOfClubIds), not its own role — already covered below.
function isApplicantLike(user: AuthUser): boolean {
  if (isExternalUser(user)) return true;
  return hasRole(user, 'staff') || hasRole(user, 'lecturer') || hasRole(user, 'student');
}

// The unit_code of every School unit `user` heads (head-of-school), or undefined if none.
function headOfSchoolUnitCode(user: AuthUser): string | undefined {
  return user.roles.find((r) => r.roleCode === 'head-of-school')?.unitCode ?? undefined;
}

// Cafeteria Manager's relation to a proposal is per-SELECTION (request_fmb_selection rows routed
// to their own cafeteria via fmbSelections[].cafeteriaCode), not a whole-ProposalStage gate like
// HOS/HOD/F&B/CFO below — a proposal can sit in DepartmentReview (or later) with the manager's
// own selection still 'pending' while sibling selections for OTHER cafeterias are already
// fulfilled. See workflow.service.js's approveFmbSelection/resubmitFmbSelection and
// proposal-department-view.ts's isCafeteriaSelectionView for the actual approve/resubmit UI.
function myCafeteriaSelections(user: AuthUser, proposal: ProposalReviewRecord) {
  const cafeteriaCode = user.cafeteriaCode;
  if (cafeteriaCode === undefined) return [];
  return (proposal.fmbSelections ?? []).filter((selection) => selection.cafeteriaCode === cafeteriaCode);
}

// The server owns workflow transitions; this is purely a display-layer mapping from "which stage
// is active" to "which reviewer identity's inbox it belongs in" — used only to decide what
// Angular shows, never to decide what happens next. This mirrors workflow.service.js's
// isHosHodOfUnit/isManagerOfUnit checks for display purposes.
function userMatchesReviewerForStage(user: AuthUser, stage: ProposalStage): boolean {
  switch (stage) {
    case ProposalStage.HosHodReview: return headOfSchoolUnitCode(user) !== undefined;
    case ProposalStage.FmbReview: return hasRole(user, 'head-of-department', 'food_beverage_services');
    case ProposalStage.CfoReview: return hasRole(user, 'cfo');
    default: return false;
  }
}

// Which reviewer stage (if any) `user`'s own identity corresponds to — used by
// reviewerHasRelation() below to find their place in REVIEWER_STAGE_ORDER. Returns null for
// anyone who isn't a reviewer at any stage (e.g. an ordinary unit-scoped Staff/Student).
function reviewerStageForUser(user: AuthUser): ProposalStage | null {
  if (headOfSchoolUnitCode(user) !== undefined) return ProposalStage.HosHodReview;
  if (hasRole(user, 'head-of-department', 'food_beverage_services')) return ProposalStage.FmbReview;
  if (hasRole(user, 'cfo')) return ProposalStage.CfoReview;
  return null;
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

// True when a DEPARTMENT (not a single-actor reviewer) has pushed one of its tasks back to the
// applicant. The proposal itself stays in DepartmentReview — sibling departments keep working in
// parallel — so this cannot be read off `workflow.stage`; it lives on the per-task status.
export function departmentAwaitingApplicant(proposal: ProposalReviewRecord): boolean {
  return proposal.workflow.departmentConfirmations.some((entry) => entry.status === 'resubmitted');
}

// Everything the applicant currently has to answer: a reviewer stage that sent the whole
// proposal back, or one or more departments that asked for changes.
export function proposalNeedsApplicantAction(proposal: ProposalReviewRecord): boolean {
  return proposal.workflow.stage === ProposalStage.ResubmissionRequired || departmentAwaitingApplicant(proposal);
}

export function userOwnsCurrentProposalAction(user: AuthUser | null, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): boolean {
  if (!user) return false;
  // The applicant (or a co-owner) always owns the action when something was sent back to them,
  // whatever else their account happens to be — a head-of-department submitting their own
  // proposal is an applicant for THAT proposal.
  if (userIsApplicantForProposal(user, proposal)) {
    if (proposalNeedsApplicantAction(proposal)) return true;
    if (isApplicantLike(user)) return false;
  }
  if (isApplicantLike(user) && !isReviewerOrDepartmentOwner(user)) return false;
  const routedKinds = requestKindsForRole(user);
  if (requestKind && routedKinds.length && !routedKinds.includes(requestKind)) return false;
  return roleOwnsWorkflowAction(user, proposal);
}

// A user can be applicant-like (staff/lecturer/student) AND still own a review queue — e.g. a
// department's staff member. Only a purely applicant-like account short-circuits above.
function isReviewerOrDepartmentOwner(user: AuthUser): boolean {
  return reviewerStageForUser(user) !== null
    || hasRole(user, 'cafeteria-manager')
    || departmentsForRole(user).length > 0;
}

// Whether `user` currently owns an action on `proposal` — the single source of truth for "is this
// actually this user's job right now", used to keep restricted proposals out of a role's Inbox in
// the first place rather than showing them and then blocking the action. This is a read-only
// display filter over server-reported state, not a transition decision (the backend's
// isHosHodOfUnit in workflow.service.js is the real authority — this mirrors it for display).
function roleOwnsWorkflowAction(user: AuthUser, proposal: ProposalReviewRecord): boolean {
  // Cafeteria Manager: independent of ProposalStage entirely — they own action the moment ANY of
  // their own cafeteria's selections is 'pending' (freshly created or edited-and-resent by F&B),
  // same "parallel independence" precedent as DepartmentReview's per-department confirmations
  // below, just one level more granular (per-selection, not per-department).
  if (hasRole(user, 'cafeteria-manager')) return myCafeteriaSelections(user, proposal).some((selection) => selection.status === 'pending');
  // F&B: a Cafeteria Manager pushing one order back puts that order squarely on F&B's desk, even
  // though the fmb department task itself is already 'approved'. Same per-selection granularity as
  // the Cafeteria Manager branch above, mirrored on the other side of the hand-off.
  if (hasRole(user, 'head-of-department', 'food_beverage_services')
    && (proposal.fmbSelections ?? []).some((selection) => selection.status === 'resubmitted')) {
    return true;
  }
  const state = proposal.workflow;
  if (state.stage === ProposalStage.HosHodReview) {
    return headOfSchoolUnitCode(user) !== undefined && departmentFor(user) === proposal.applicantDepartment;
  }
  if (isReviewerStage(state.stage)) return userMatchesReviewerForStage(user, state.stage);
  if (state.stage === ProposalStage.DepartmentReview) {
    const ownedDepartments = departmentsForRole(user);
    // 'resubmitted' means this department is waiting on the APPLICANT, so it belongs in the
    // department's Ongoing, not its Inbox. 'pending' is the only status they still owe action on.
    return state.departmentConfirmations.some((entry) => (entry.status ?? (entry.confirmed ? 'approved' : 'pending')) === 'pending' && ownedDepartments.includes(entry.department as DepartmentRequestKind));
  }
  return false;
}

// History covers every terminal state — approved, rejected AND cancelled (system specification
// §4, Visibility). A cancelled proposal used to fall through to Ongoing, where it sat forever.
const TERMINAL_STAGES: readonly ProposalStage[] = [ProposalStage.Approved, ProposalStage.Rejected, ProposalStage.Cancelled];

export function proposalSectionForUser(user: AuthUser | null, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): ProposalVisibilitySection | null {
  if (!user || !userIsRelatedToProposal(user, proposal, requestKind)) return null;
  if (TERMINAL_STAGES.includes(proposal.workflow.stage)) return 'history';
  if (userOwnsCurrentProposalAction(user, proposal, requestKind)) return 'inbox';
  return 'ongoing';
}

function userIsRelatedToProposal(user: AuthUser, proposal: ProposalReviewRecord, requestKind?: DepartmentRequestKind): boolean {
  if (userIsApplicantForProposal(user, proposal)) return true;
  const routedKinds = requestKindsForRole(user);
  if (requestKind && routedKinds.length && !routedKinds.includes(requestKind)) return false;
  // Cafeteria Manager: related the moment ANY selection exists for their own cafeteria, at any
  // status (including fulfilled/cancelled, so past orders still surface in History) — unlike
  // reviewerHasRelation()/departmentConfirmations below, which are keyed off whole-proposal stage
  // or department, neither of which line up with "one specific cafeteria's own orders."
  if (hasRole(user, 'cafeteria-manager')) return myCafeteriaSelections(user, proposal).length > 0;
  if (reviewerHasRelation(user, proposal)) return true;
  const ownedDepartments = departmentsForRole(user);
  return ownedDepartments.length > 0 && proposal.workflow.departmentConfirmations.some((entry) => ownedDepartments.includes(entry.department as DepartmentRequestKind));
}

// Fixed display order of the reviewer chain, used only to tell whether a reviewer's own stage is
// still ahead, current, or already passed for a given proposal — never to decide whether a stage
// applies at all (the server alone decides that, e.g. via the pax threshold for F&B/CFO).
const REVIEWER_STAGE_ORDER: readonly ProposalStage[] = [ProposalStage.HosHodReview, ProposalStage.FmbReview, ProposalStage.CfoReview, ProposalStage.DepartmentReview];

function reviewerHasRelation(user: AuthUser, proposal: ProposalReviewRecord): boolean {
  const roleStage = reviewerStageForUser(user);
  if (!roleStage) return false;
  // HOS/HOD is shared across every school/department unit — restrict relation to the reviewer's
  // own unit so a School of Computing HOS doesn't see School of Business proposals in Ongoing.
  if (roleStage === ProposalStage.HosHodReview && departmentFor(user) !== proposal.applicantDepartment) return false;
  if (proposal.workflow.rejectedBy && user.roles.some((r) => r.roleCode === proposal.workflow.rejectedBy)) return true;
  const currentIndex = REVIEWER_STAGE_ORDER.indexOf(proposal.workflow.stage);
  const roleIndex = REVIEWER_STAGE_ORDER.indexOf(roleStage);
  return proposal.workflow.stage === ProposalStage.Approved
    || currentIndex >= roleIndex;
}
