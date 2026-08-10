import { UserRole } from '../auth/auth.models';
import {
  ProposalStage,
  ProposalWorkflowState,
  applyApplicantResubmit,
  applyDepartmentConfirmation,
  applyReviewerApproval,
  applyReviewerRejection,
  applyReviewerResubmit,
  initialWorkflowState,
  reviewerChainForPax,
  roleOwnsWorkflowAction,
} from './proposal-status.models';

describe('proposal-status.models', () => {
  it('includes the F&B reviewer and CFO stages only when totalPax exceeds 50', () => {
    expect(reviewerChainForPax(51)).toEqual([
      ProposalStage.HosHodReview,
      ProposalStage.FmbReviewerPending,
      ProposalStage.CfoReview,
      ProposalStage.DepartmentReview,
    ]);
    expect(reviewerChainForPax(50)).toEqual([ProposalStage.HosHodReview, ProposalStage.DepartmentReview]);
    expect(reviewerChainForPax(49)).toEqual([ProposalStage.HosHodReview, ProposalStage.DepartmentReview]);
  });

  it('skips the F&B/CFO reviewer stages for a small proposal', () => {
    const state = initialWorkflowState(['fnb']);
    const afterHosHod = applyReviewerApproval(state, 30);
    expect(afterHosHod.stage).toBe(ProposalStage.DepartmentReview);
  });

  it('routes a large proposal through F&B reviewer then CFO before department review', () => {
    const state = initialWorkflowState(['logistics']);
    const afterHosHod = applyReviewerApproval(state, 80);
    expect(afterHosHod.stage).toBe(ProposalStage.FmbReviewerPending);

    const afterFmb = applyReviewerApproval(afterHosHod, 80);
    expect(afterFmb.stage).toBe(ProposalStage.CfoReview);

    const afterCfo = applyReviewerApproval(afterFmb, 80);
    expect(afterCfo.stage).toBe(ProposalStage.DepartmentReview);
  });

  it('rejects from any reviewer stage into a terminal Rejected state', () => {
    const state: ProposalWorkflowState = { stage: ProposalStage.CfoReview, departmentConfirmations: [] };
    const rejected = applyReviewerRejection(state, UserRole.Cfo, 'Budget exceeds allocation');
    expect(rejected.stage).toBe(ProposalStage.Rejected);
    expect(rejected.rejectedBy).toBe(UserRole.Cfo);
    expect(rejected.rejectedReason).toBe('Budget exceeds allocation');
  });

  it('resumes at the stage that sent it back, not the start of the chain', () => {
    const state: ProposalWorkflowState = { stage: ProposalStage.CfoReview, departmentConfirmations: [] };
    const sentBack = applyReviewerResubmit(state, ProposalStage.CfoReview, 'Please fix the budget line');
    expect(sentBack.stage).toBe(ProposalStage.NeedsRevision);
    expect(sentBack.resumeStage).toBe(ProposalStage.CfoReview);
    expect(sentBack.reviewerComment).toBe('Please fix the budget line');

    const resumed = applyApplicantResubmit(sentBack);
    expect(resumed.stage).toBe(ProposalStage.CfoReview);
    expect(resumed.stage).not.toBe(ProposalStage.HosHodReview);
  });

  it('flips to Approved only once every required department has confirmed', () => {
    let state = initialWorkflowState(['fnb', 'logistics']);
    expect(state.stage).toBe(ProposalStage.HosHodReview);

    state = applyDepartmentConfirmation(state, 'fnb', 'cafeteria.manager@demo.apu.edu.my');
    expect(state.stage).toBe(ProposalStage.HosHodReview);

    state = applyDepartmentConfirmation(state, 'logistics', 'logistics.manager@demo.apu.edu.my');
    expect(state.stage).toBe(ProposalStage.Approved);
  });

  it('keeps fnb department confirmation independent of the F&B reviewer stage', () => {
    const state = initialWorkflowState(['fnb']);
    const afterHosHod = applyReviewerApproval(state, 80);
    expect(afterHosHod.stage).toBe(ProposalStage.FmbReviewerPending);
    // Confirming the fnb department at this point must not be possible/relevant while still
    // at the FmbReviewerPending gate; departmentConfirmations tracking is untouched by reviewer stages.
    expect(afterHosHod.departmentConfirmations).toEqual(state.departmentConfirmations);
  });

  describe('roleOwnsWorkflowAction', () => {
    it('grants access only to the reviewer whose stage currently owns the proposal', () => {
      const state: ProposalWorkflowState = { stage: ProposalStage.CfoReview, departmentConfirmations: [] };
      expect(roleOwnsWorkflowAction(UserRole.Cfo, state, [])).toBe(true);
      expect(roleOwnsWorkflowAction(UserRole.HosHod, state, [])).toBe(false);
      expect(roleOwnsWorkflowAction(UserRole.FmbReviewer, state, [])).toBe(false);
    });

    it('denies every reviewer once a proposal has moved past their stage', () => {
      const state: ProposalWorkflowState = { stage: ProposalStage.DepartmentReview, departmentConfirmations: [] };
      expect(roleOwnsWorkflowAction(UserRole.HosHod, state, [])).toBe(false);
      expect(roleOwnsWorkflowAction(UserRole.Cfo, state, [])).toBe(false);
      expect(roleOwnsWorkflowAction(UserRole.FmbReviewer, state, [])).toBe(false);
    });

    it('grants a department manager access only while their department is unconfirmed', () => {
      const state: ProposalWorkflowState = { ...initialWorkflowState(['logistics', 'fnb']), stage: ProposalStage.DepartmentReview };
      expect(roleOwnsWorkflowAction(UserRole.LogisticsManager, state, ['logistics'])).toBe(true);
      expect(roleOwnsWorkflowAction(UserRole.CafeteriaManager, state, ['fnb'])).toBe(true);

      const afterLogisticsConfirmed = applyDepartmentConfirmation(state, 'logistics', 'logistics.manager@demo.apu.edu.my');
      expect(roleOwnsWorkflowAction(UserRole.LogisticsManager, afterLogisticsConfirmed, ['logistics'])).toBe(false);
      expect(roleOwnsWorkflowAction(UserRole.CafeteriaManager, afterLogisticsConfirmed, ['fnb'])).toBe(true);
    });

    it('denies a department manager whose department was not requested on this proposal', () => {
      const state: ProposalWorkflowState = { ...initialWorkflowState(['logistics']), stage: ProposalStage.DepartmentReview };
      expect(roleOwnsWorkflowAction(UserRole.CafeteriaManager, state, ['fnb'])).toBe(false);
    });

    it('denies department managers while a proposal is still at a reviewer stage', () => {
      const state: ProposalWorkflowState = { stage: ProposalStage.HosHodReview, departmentConfirmations: [{ department: 'logistics', confirmed: false }] };
      expect(roleOwnsWorkflowAction(UserRole.LogisticsManager, state, ['logistics'])).toBe(false);
    });

    it('denies everyone once a proposal is approved, rejected, or needs revision', () => {
      for (const stage of [ProposalStage.Approved, ProposalStage.Rejected, ProposalStage.NeedsRevision]) {
        const state: ProposalWorkflowState = { stage, departmentConfirmations: [] };
        expect(roleOwnsWorkflowAction(UserRole.HosHod, state, [])).toBe(false);
        expect(roleOwnsWorkflowAction(UserRole.LogisticsManager, state, ['logistics'])).toBe(false);
      }
    });
  });
});
