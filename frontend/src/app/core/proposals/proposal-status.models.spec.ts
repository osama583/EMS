import { ProposalStage, isReviewerStage, stageLabel } from './proposal-status.models';

describe('proposal-status.models', () => {
  it('labels every stage with a human-readable string', () => {
    expect(stageLabel(ProposalStage.Submitted)).toBe('Submitted');
    expect(stageLabel(ProposalStage.HosHodReview)).toBe('HOS/HOD review');
    expect(stageLabel(ProposalStage.FmbReview)).toBe('F&B review');
    expect(stageLabel(ProposalStage.CfoReview)).toBe('CFO review');
    expect(stageLabel(ProposalStage.DepartmentReview)).toBe('Department review');
    expect(stageLabel(ProposalStage.ResubmissionRequired)).toBe('Revision required');
    expect(stageLabel(ProposalStage.Approved)).toBe('Approved');
    expect(stageLabel(ProposalStage.Rejected)).toBe('Rejected');
    expect(stageLabel(ProposalStage.Cancelled)).toBe('Cancelled');
  });

  it('identifies the three single-actor reviewer stages', () => {
    expect(isReviewerStage(ProposalStage.HosHodReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.FmbReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.CfoReview)).toBe(true);
    expect(isReviewerStage(ProposalStage.DepartmentReview)).toBe(false);
    expect(isReviewerStage(ProposalStage.Approved)).toBe(false);
  });
});
