import { testRole, testUser } from '../auth/auth.test-fixtures';
import { PROPOSAL_REVIEW_RECORDS } from './proposal-review.mock-data';
import { ProposalReviewRecord } from './proposal-review.models';
import { ProposalStage, ProposalWorkflowState } from './proposal-status.models';
import { proposalSectionForUser } from './proposal-visibility';

// A proposal sent back to its applicant sits BESIDE the reviewer chain, not on it, and one that is
// finished sits past the end of it. Either way it still belongs to the reviewers who already handled
// it — the same relation the server's _VISIBLE_SQL grants them.
describe('proposalSectionForUser off-chain stages', () => {
  const FMB_HEAD = testUser([testRole('head-of-department', 'food_beverage_services', 'F&B')], {
    email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo',
  });
  const CFO = testUser([testRole('cfo')], { email: 'cfo@demo.apu.edu.my', displayName: 'CFO Demo' });

  // No departmentConfirmations: a proposal sent back before it ever reached department review has no
  // request_task rows yet, so the reviewer chain is the only relation left to find.
  const at = (workflow: Partial<ProposalWorkflowState>): ProposalReviewRecord => ({
    ...PROPOSAL_REVIEW_RECORDS[0],
    workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, departmentConfirmations: [], ...workflow },
  });

  it('keeps a proposal sent back from a later stage visible to F&B', () => {
    const proposal = at({ stage: ProposalStage.ResubmissionRequired, resumeStage: ProposalStage.CfoReview });
    expect(proposalSectionForUser(FMB_HEAD, proposal)).toBe('ongoing');
  });

  it('keeps a proposal F&B itself sent back visible to F&B', () => {
    const proposal = at({ stage: ProposalStage.ResubmissionRequired, resumeStage: ProposalStage.FmbReview });
    expect(proposalSectionForUser(FMB_HEAD, proposal)).toBe('ongoing');
  });

  it('still hides a send-back that never reached the reviewer', () => {
    const proposal = at({ stage: ProposalStage.ResubmissionRequired, resumeStage: ProposalStage.HosHodReview });
    expect(proposalSectionForUser(CFO, proposal)).toBeNull();
  });

  // Server-authoritative fallback: a reviewer who genuinely acted (workflow_history row exists) stays
  // related even once the live chain position no longer proves it — e.g. sent back behind their own
  // stage by an earlier reviewer after they had already decided it. Without this, "Ongoing > Acted On"
  // (server-side, keyed off the same workflow_history row) could list a proposal the detail page then
  // refused to open.
  it('keeps a proposal visible to a reviewer who actually acted, even off the live chain', () => {
    const proposal = { ...at({ stage: ProposalStage.ResubmissionRequired, resumeStage: ProposalStage.HosHodReview }), actedByMe: true };
    expect(proposalSectionForUser(CFO, proposal)).toBe('ongoing');
  });

  it('files a rejected proposal under History for a reviewer', () => {
    expect(proposalSectionForUser(FMB_HEAD, at({ stage: ProposalStage.Rejected }))).toBe('history');
  });
});

// Whose school a proposal belongs to is decided by the applicant's unit CODES (user_unit_roles, what
// the server's _VISIBLE_SQL joins on), never by the free-text applicantDepartment snapshot — which is
// NULL on a large share of real proposals and, compared against a role's display label, locked a head
// of school out of proposals from their own school that they had already approved.
describe('proposalSectionForUser head-of-school unit matching', () => {
  const HOS = testUser([testRole('head-of-school', 'school_of_computing', 'School of Computing')], {
    email: 'hoshod@demo.apu.edu.my', displayName: 'Rahim Abdullah',
  });

  const fromUnits = (applicantUnitCodes: readonly string[] | undefined, applicantDepartment?: string): ProposalReviewRecord => ({
    ...PROPOSAL_REVIEW_RECORDS[0],
    applicantDepartment,
    applicantUnitCodes,
    workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, departmentConfirmations: [], stage: ProposalStage.CfoReview },
  });

  it('keeps a proposal from the head of school own unit visible when applicantDepartment is empty', () => {
    expect(proposalSectionForUser(HOS, fromUnits(['school_of_computing'], undefined))).toBe('ongoing');
  });

  it('still hides a proposal from another school', () => {
    expect(proposalSectionForUser(HOS, fromUnits(['school_of_business'], 'School of Business'))).toBeNull();
  });

  it('matches on unit code even when the department label disagrees', () => {
    expect(proposalSectionForUser(HOS, fromUnits(['school_of_computing'], 'Computing'))).toBe('ongoing');
  });
});
