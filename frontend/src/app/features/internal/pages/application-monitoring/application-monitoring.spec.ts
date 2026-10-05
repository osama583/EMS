import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { DepartmentConfirmation, ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { doneCountFor, isTerminal, subStatusesFor } from './application-monitoring';

// The whole point of this page's status cell: 'Department review' is ONE label over several
// departments working in parallel, each with its own status and its own people. The breakdown is
// what tells an admin which of them is actually holding the application up.
describe('subStatusesFor', () => {
  const withConfirmations = (departmentConfirmations: readonly DepartmentConfirmation[]): ProposalReviewRecord => ({
    ...PROPOSAL_REVIEW_RECORDS[0],
    workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, stage: ProposalStage.DepartmentReview, departmentConfirmations },
  });

  it('keeps each department separate, with its own status and assignees', () => {
    const entries = subStatusesFor(withConfirmations([
      { department: 'logistics', confirmed: true, status: 'approved', assignees: ['Ahmad Firdaus', 'David Tan'] },
      { department: 'fmb', confirmed: false, status: 'pending', assignees: [] },
    ]));

    expect(entries).toEqual([
      { label: 'Logistics', status: 'Approved', tone: 'success', assignees: 'Ahmad Firdaus, David Tan', detail: '', needsAssignee: true, comment: '' },
      // F&B is fulfilled by a cafeteria, so an empty assignee list is normal rather than a gap.
      { label: 'Food & Beverage', status: 'Pending', tone: 'blue', assignees: '', detail: '', needsAssignee: false, comment: '' },
    ]);
  });

  it('surfaces the comment when a department asked the applicant for changes', () => {
    const [entry] = subStatusesFor(withConfirmations([
      { department: 'transportation', confirmed: false, status: 'resubmitted', comment: 'Need a pickup time.' },
    ]));

    expect(entry.status).toBe('Changes requested');
    expect(entry.tone).toBe('warning');
    expect(entry.comment).toBe('Need a pickup time.');
  });

  // The server omits `status` on older rows; `confirmed` is then the only signal there is.
  it('falls back to the confirmed flag when a task carries no status', () => {
    const entries = subStatusesFor(withConfirmations([
      { department: 'soundLight', confirmed: true },
      { department: 'photoVideo', confirmed: false },
    ]));

    expect(entries.map((entry) => entry.status)).toEqual(['Approved', 'Pending']);
  });

  it('is empty for an application that has not reached the departments', () => {
    expect(subStatusesFor(withConfirmations([]))).toEqual([]);
  });
});

// Implementation is a FINER grain than department review: every department has already approved, so a
// per-department list would read "Approved" six times while the real work sits in individual items —
// four logistics items and two transport bookings each at their own step.
describe('subStatusesFor and doneCountFor in implementation', () => {
  const inImplementation = (implementationItems: ProposalReviewRecord['implementationItems']): ProposalReviewRecord => ({
    ...PROPOSAL_REVIEW_RECORDS[0],
    implementationItems,
    workflow: {
      ...PROPOSAL_REVIEW_RECORDS[0].workflow,
      stage: ProposalStage.Implementation,
      // Every department approved — which is exactly why this list is useless here.
      departmentConfirmations: [{ department: 'logistics', confirmed: true, status: 'approved' }],
    },
  });

  it('lists every requested item separately, not one line per department', () => {
    const entries = subStatusesFor(inImplementation([
      { department: 'logistics', item: 'Round Table', detail: '4', status: 'completed', assignees: ['Ahmad Firdaus'] },
      { department: 'logistics', item: 'Projector', detail: '1', status: 'assigned', assignees: ['David Tan'] },
      { department: 'transportation', item: '40-Seater Coach', detail: '27 pax', status: 'assigned', assignees: ['Bob Sinnappan'] },
    ]));

    expect(entries.map((entry) => entry.label)).toEqual([
      'Logistics · Round Table',
      'Logistics · Projector',
      'Transportation · 40-Seater Coach',
    ]);
    expect(entries[0].status).toBe('Completed');
    expect(entries[1].status).toBe('In progress');
    expect(entries[2].detail).toBe('27 pax');
  });

  // The whole point of driving this off the requested items rather than the assignment rows: an item
  // nobody has picked up is the one an administrator most needs to see.
  it('still shows an item nobody has picked up', () => {
    const entries = subStatusesFor(inImplementation([
      { department: 'waterNormal', item: 'Mineral Water', detail: '41 bottles', status: 'unordered', assignees: [] },
      { department: 'fundingPurchase', item: 'Equipment Rental', detail: '42', status: 'unassigned', assignees: [] },
    ]));

    expect(entries.map((entry) => entry.status)).toEqual(['Not ordered', 'Not assigned']);
    expect(entries.every((entry) => entry.tone === 'warning')).toBe(true);
    // Water is a cafeteria ORDER — it is unordered, not unstaffed, so the popover must not ask for
    // an assignee it will never have.
    expect(entries.map((entry) => entry.needsAssignee)).toEqual([false, true]);
  });

  it('counts finished items for the badge, not finished departments', () => {
    const proposal = inImplementation([
      { department: 'logistics', item: 'Round Table', detail: '4', status: 'completed', assignees: [] },
      { department: 'fmb', item: 'Orange Juice', detail: '6 × Level 3', status: 'fulfilled', assignees: [] },
      { department: 'transportation', item: 'Coach', detail: '27 pax', status: 'assigned', assignees: [] },
      { department: 'waterNormal', item: 'Mineral Water', detail: '41', status: 'unordered', assignees: [] },
    ]);

    // 2 of 4 items done — the single approved department confirmation is deliberately ignored.
    expect(doneCountFor(proposal)).toBe(2);
    expect(subStatusesFor(proposal).length).toBe(4);
  });

  it('falls back to departments when the application is not in implementation', () => {
    const proposal = { ...PROPOSAL_REVIEW_RECORDS[0], implementationItems: [] as never[] };
    expect(subStatusesFor(proposal).length).toBe(proposal.workflow.departmentConfirmations.length);
  });
});

// A finished application has no "how far along" left to report. The tally is not just redundant
// there, it actively lies: a cancelled application's tasks are cancelled too, which scored "0/1 done"
// as though something were still outstanding, and an approved one's "2/2" only restated 'Approved'.
describe('isTerminal', () => {
  const at = (stage: ProposalStage, departmentConfirmations: readonly DepartmentConfirmation[] = []): ProposalReviewRecord => ({
    ...PROPOSAL_REVIEW_RECORDS[0],
    workflow: { ...PROPOSAL_REVIEW_RECORDS[0].workflow, stage, departmentConfirmations },
  });

  it('treats approved, rejected and cancelled as finished', () => {
    expect(isTerminal(at(ProposalStage.Approved))).toBe(true);
    expect(isTerminal(at(ProposalStage.Rejected))).toBe(true);
    expect(isTerminal(at(ProposalStage.Cancelled))).toBe(true);
  });

  // The escalation job's overdue_* statuses are terminal too (workflow/constants.py's
  // TERMINAL_STATUSES), but they have no ProposalStage member and arrive as their raw value.
  it('treats an escalated overdue application as finished', () => {
    for (const raw of ['overdue_hos_hod', 'overdue_fmb', 'overdue_cfo', 'overdue_department']) {
      expect(isTerminal(at(raw as ProposalStage))).toBe(true);
    }
  });

  it('leaves an in-flight application reporting its progress', () => {
    expect(isTerminal(at(ProposalStage.DepartmentReview))).toBe(false);
    expect(isTerminal(at(ProposalStage.Implementation))).toBe(false);
    expect(isTerminal(at(ProposalStage.HosHodReview))).toBe(false);
  });

  // The two rows from the reported screenshots.
  it('would have counted a cancelled application as 0/1 done', () => {
    const cancelled = at(ProposalStage.Cancelled, [{ department: 'logistics', confirmed: false, status: 'cancelled' }]);
    expect(doneCountFor(cancelled)).toBe(0);
    expect(subStatusesFor(cancelled).length).toBe(1);
    // …which is why the badge must not ask for either number once isTerminal() is true.
    expect(isTerminal(cancelled)).toBe(true);
  });

  it('would have restated an approved application as 2/2', () => {
    const approved = at(ProposalStage.Approved, [
      { department: 'logistics', confirmed: true, status: 'completed' },
      { department: 'photoVideo', confirmed: true, status: 'completed' },
    ]);
    expect(doneCountFor(approved)).toBe(2);
    expect(isTerminal(approved)).toBe(true);
  });
});
