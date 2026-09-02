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

  it('files a rejected proposal under History for a reviewer', () => {
    expect(proposalSectionForUser(FMB_HEAD, at({ stage: ProposalStage.Rejected }))).toBe('history');
  });
});
