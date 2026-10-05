import { ProposalHistoryEntry } from '../../../../core/proposals/proposal-review.models';
import { buildTracking, upcomingFor } from './application-tracking';

let nextId = 1;
function entry(partial: Partial<ProposalHistoryEntry>): ProposalHistoryEntry {
  return {
    workflow_history_id: partial.workflow_history_id ?? nextId++,
    action: 'approve',
    actor_name: 'Someone',
    actor_role: 'head-of-school',
    actor_user_id: 1,
    comment: null,
    previous_status: null,
    new_status: null,
    created_at: '2026-09-02T05:45:20',
    request_task_id: null,
    requirement_name: null,
    ...partial,
  };
}

describe('buildTracking', () => {
  beforeEach(() => { nextId = 1; });

  it('puts the whole-proposal chain on the spine, in the order it happened', () => {
    const track = buildTracking([
      entry({ action: 'submit', actor_name: 'Ahmed', actor_role: 'student', previous_status: 'draft', new_status: 'hos_hod_review' }),
      entry({ action: 'approve', actor_name: 'Rahim', actor_role: 'head-of-school', previous_status: 'hos_hod_review', new_status: 'fmb_review' }),
    ]);

    expect(track.main.map((step) => step.title)).toEqual(['Proposal submitted', 'Approved · HOS/HOD review']);
    expect(track.main[0].actor).toBe('Ahmed');
    expect(track.main[1].role).toBe('Head of School');
    expect(track.branches).toEqual([]);
  });

  // The point of the whole view: six departments working at once produce six interleaved rows in a
  // flat log, and which one is behind is unreadable until they are pulled into their own tracks.
  it('splits department rows into one branch each', () => {
    const track = buildTracking([
      entry({ action: 'approve', previous_status: 'cfo_review', new_status: 'department_review' }),
      entry({ action: 'task-created', actor_role: 'system', actor_name: null, requirement_name: 'logistics' }),
      entry({ action: 'task-created', actor_role: 'system', actor_name: null, requirement_name: 'transportation' }),
      entry({ action: 'resubmit', actor_name: 'Zulkifli', requirement_name: 'logistics', comment: 'Need a layout.' }),
      entry({ action: 'approve', actor_name: 'Hafiz', requirement_name: 'transportation' }),
    ]);

    expect(track.main.map((step) => step.title)).toEqual(['Approved · CFO review']);
    expect(track.branches.map((branch) => branch.label)).toEqual(['Logistics', 'Transportation']);
    expect(track.branches[0].steps.map((step) => step.title))
      .toEqual(['Logistics requested changes']);
    expect(track.branches[0].steps[0].comment).toBe('Need a layout.');
    // A send-back is what stalled the application — coloured so it stands out when scanning.
    expect(track.branches[0].steps[0].tone).toBe('attention');
  });

  // The timeline answers "who took action". Routing the app performed itself is not an answer, and
  // in real data those rows carry a non-null actor_user_id (the applicant's) despite actor_role
  // 'system' — so keeping them would also credit the app's own bookkeeping to whoever submitted.
  it('drops routing the workflow did itself', () => {
    const track = buildTracking([
      entry({ action: 'task-created', actor_role: 'system', actor_user_id: 1057, actor_name: 'Ahmed a/l Subramaniam', requirement_name: 'fmb' }),
      entry({ action: 'approve', requirement_name: 'fmb', actor_name: 'Nadia', request_task_id: 3 }),
    ]);

    expect(track.branches[0].steps.map((step) => step.title)).toEqual(['Food & Beverage approved']);
  });

  // …but the workflow closing the application IS the ending. It is kept out of `main` so it renders
  // after the branches it depends on, rather than mid-spine where its timestamp would put it.
  it('keeps the closing step separate so it renders last', () => {
    const track = buildTracking([
      entry({ action: 'auto-complete', actor_role: 'system', previous_status: 'department_review', new_status: 'completed_approved' }),
    ]);

    expect(track.main).toEqual([]);
    expect(track.ending?.title).toBe('All departments complete · Approved');
  });

  // The phase split. Department review is where a department DECIDES; Implementation is where the
  // work gets done. Mixing them put staff fulfilment and cafeteria delivery under "Department
  // review", and left a department's branch ending on something after its own approval.
  it('separates what a department decided from the work that followed', () => {
    const track = buildTracking([
      entry({ action: 'approve', requirement_name: 'logistics', request_task_id: 5, actor_name: 'Zulkifli', previous_status: 'pending', new_status: 'approved' }),
      entry({ action: 'assign', requirement_name: 'logistics', request_task_id: 5, actor_name: 'Zulkifli' }),
      entry({ action: 'preparing', requirement_name: 'logistics', request_task_id: 5, actor_role: 'staff', actor_name: 'Sarah Lee' }),
      entry({ action: 'completed', requirement_name: 'logistics', request_task_id: 5, actor_role: 'staff', actor_name: 'Sarah Lee' }),
    ]);

    // The department's story ends at its approval — 'assign' is staffing bookkeeping, not a decision.
    expect(track.branches[0].steps.map((step) => step.title)).toEqual(['Logistics approved']);
    expect(track.implementation[0].steps.map((step) => step.title)).toEqual(['Preparing', 'Completed']);
  });

  // The end-to-end shape of the contradiction reported on EVT-04498.
  it('drops the Implementation placeholder once any department is implementing', () => {
    const track = buildTracking([
      entry({ action: 'approve', requirement_name: 'logistics', request_task_id: 5, actor_name: 'Zulkifli' }),
      entry({ action: 'preparing', requirement_name: 'logistics', request_task_id: 5, actor_role: 'staff', actor_name: 'David Tan' }),
    ], 'department-review');

    expect(track.implementation).toHaveLength(1);
    expect(track.upcoming).toEqual(['Approved']);
  });

  // One staff member starting two items writes two rows differing only by 'row N' — and the row id is
  // not shown, so both dots would read identically.
  it('shows a staff member once per phase, however many items they picked up', () => {
    const track = buildTracking([
      entry({ action: 'preparing', requirement_name: 'logistics', request_task_id: 4255, actor_user_id: 14, actor_role: 'staff', actor_name: 'David Tan', comment: 'row 2142' }),
      entry({ action: 'preparing', requirement_name: 'logistics', request_task_id: 4255, actor_user_id: 14, actor_role: 'staff', actor_name: 'David Tan', comment: 'row 2143' }),
      entry({ action: 'preparing', requirement_name: 'logistics', request_task_id: 4255, actor_user_id: 13, actor_role: 'staff', actor_name: 'Ahmad Firdaus', comment: 'row 2144' }),
    ]);

    expect(track.implementation[0].steps.map((step) => step.actor)).toEqual(['David Tan', 'Ahmad Firdaus']);
  });

  // One proposal can be fanned out across several cafeterias, each with its own manager and staff.
  // workflow_history records no link to the order a step acted on, so the actor's own outlet is the
  // only thing separating two otherwise identical 'Cafeteria order accepted' steps.
  it('names which cafeteria took each step', () => {
    const track = buildTracking([
      entry({ action: 'create-selection', actor_name: 'Nadia', comment: 'Order placed with cafeteria__atrium_cafeteria.' }),
      entry({ action: 'create-selection', actor_name: 'Nadia', comment: 'Order placed with cafeteria__level_3_food_court.' }),
      entry({ action: 'approve-selection', actor_name: 'Siti Aminah', actor_role: 'cafeteria-manager', actor_unit: 'Atrium Cafeteria' }),
      entry({ action: 'approve-selection', actor_name: 'Lim Wei Sheng', actor_role: 'cafeteria-manager', actor_unit: 'Level 3 Food Court' }),
    ]);

    expect(track.branches[0].steps.map((step) => step.cafeteria))
      .toEqual(['Atrium Cafeteria', 'Level 3 Food Court', 'Atrium Cafeteria', 'Level 3 Food Court']);
    // The raw unit code in the order comment says nothing the cafeteria field does not.
    expect(track.branches[0].steps[0].comment).toBe('');
  });

  it('keeps each cafeteria staff member with their own outlet', () => {
    const track = buildTracking([
      entry({ action: 'fulfil-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff', actor_unit: 'Atrium Cafeteria' }),
      entry({ action: 'fulfil-selection', actor_name: 'Tan Mei Yee', actor_role: 'cafeteria-staff', actor_unit: 'Level 3 Food Court' }),
    ]);

    expect(track.implementation[0].steps.map((step) => `${step.actor} · ${step.cafeteria}`))
      .toEqual(['Ravi · Atrium Cafeteria', 'Tan Mei Yee · Level 3 Food Court']);
  });

  it('files cafeteria fulfilment under implementation, and the ordering under review', () => {
    const track = buildTracking([
      entry({ action: 'create-selection', actor_name: 'Nadia', created_at: '2026-08-29T00:12:00' }),
      entry({ action: 'approve-selection', actor_name: 'Siti', actor_role: 'cafeteria-manager', created_at: '2026-08-29T00:44:00' }),
      entry({ action: 'claim-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff', created_at: '2026-08-29T00:56:00' }),
      entry({ action: 'fulfil-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff', created_at: '2026-08-29T01:37:00' }),
    ]);

    expect(track.branches[0].steps.map((step) => step.title))
      .toEqual(['Cafeteria order placed', 'Cafeteria order accepted']);
    expect(track.implementation[0].steps.map((step) => step.title))
      .toEqual(['Cafeteria started preparing', 'Cafeteria order delivered']);
  });

  // A department approving a task with several assigned rows writes one history row per ROW, which
  // would otherwise draw the same decision as two identical dots milliseconds apart.
  it('collapses one decision recorded once per assigned row', () => {
    const track = buildTracking([
      entry({ workflow_history_id: 39173, action: 'approve', requirement_name: 'campusTour', request_task_id: 5975, actor_user_id: 9, actor_name: 'Kamala Devi', created_at: '2026-09-02T06:13:55.860220' }),
      entry({ workflow_history_id: 39174, action: 'approve', requirement_name: 'campusTour', request_task_id: 5975, actor_user_id: 9, actor_name: 'Kamala Devi', created_at: '2026-09-02T06:13:55.884152' }),
    ]);

    expect(track.branches[0].steps.map((step) => step.title)).toEqual(['Campus Tour approved']);
  });

  // …but two genuinely separate send-backs on the same task are two events, not one.
  it('keeps repeated actions that carry different comments', () => {
    const track = buildTracking([
      entry({ action: 'resubmit', requirement_name: 'logistics', request_task_id: 1, actor_user_id: 9, comment: 'Need a layout.' }),
      entry({ action: 'resubmit', requirement_name: 'logistics', request_task_id: 1, actor_user_id: 9, comment: 'Still missing the layout.' }),
    ]);

    expect(track.branches[0].steps).toHaveLength(2);
  });

  // Cafeteria order rows hang off request_fmb and carry no requirement_name, so EVERY one of them
  // must be routed by action — missing claim/ready is what put "Claim selection" and "Ready
  // selection" on the main spine between CFO approval and completion.
  // Cafeteria rows carry no requirement_name of their own (they hang off request_fmb, not a
  // request_task), so every one of them must be routed to F&B by action — missing claim/ready is what
  // put "Claim selection" and "Ready selection" on the main spine.
  it('never leaves a cafeteria step on the main spine', () => {
    const track = buildTracking([
      entry({ action: 'create-selection', actor_name: 'Nadia' }),
      entry({ action: 'approve-selection', actor_name: 'Siti', actor_role: 'cafeteria-manager' }),
      entry({ action: 'claim-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff' }),
      entry({ action: 'ready-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff' }),
      entry({ action: 'fulfil-selection', actor_name: 'Ravi', actor_role: 'cafeteria-staff' }),
    ]);

    expect(track.main).toEqual([]);
    expect(track.branches[0].department).toBe('fmb');
    expect(track.implementation[0].department).toBe('fmb');
  });


  // A department with three requested items writes three assign-row, three preparing and three
  // completed rows plus a closing 'complete' — eight dots for one phase. A department's story is the
  // decision it took: it approved.
  it('reduces a department branch to its decisions, not its per-item bookkeeping', () => {
    const track = buildTracking([
      entry({ action: 'task-created', actor_role: 'system', requirement_name: 'logistics' }),
      entry({ action: 'assign-row', requirement_name: 'logistics', comment: 'row 2137' }),
      entry({ action: 'approve', requirement_name: 'logistics', request_task_id: 7, actor_name: 'Zulkifli' }),
      entry({ action: 'assign-row', requirement_name: 'logistics', comment: 'row 2138' }),
      entry({ action: 'preparing', requirement_name: 'logistics', actor_role: 'staff', comment: 'row 2137' }),
      entry({ action: 'preparing', requirement_name: 'logistics', actor_role: 'staff', comment: 'row 2138' }),
      entry({ action: 'completed', requirement_name: 'logistics', actor_role: 'staff', comment: 'row 2137' }),
      entry({ action: 'completed', requirement_name: 'logistics', actor_role: 'staff', comment: 'row 2138' }),
      entry({ action: 'complete', requirement_name: 'logistics', actor_role: 'staff' }),
    ]);

    expect(track.branches[0].steps.map((step) => step.title)).toEqual(['Logistics approved']);
  });

  it('reads the log in id order even when timestamps collide', () => {
    const sameInstant = '2026-09-02T06:03:06';
    const track = buildTracking([
      entry({ workflow_history_id: 20, action: 'approve', previous_status: 'cfo_review', new_status: 'department_review', created_at: sameInstant }),
      entry({ workflow_history_id: 10, action: 'approve', previous_status: 'fmb_review', new_status: 'cfo_review', created_at: sameInstant }),
    ]);

    expect(track.main.map((step) => step.title)).toEqual(['Approved · F&B review', 'Approved · CFO review']);
  });
});

describe('upcomingFor', () => {
  it('shows the stages still ahead as unreached', () => {
    expect(upcomingFor('department-review')).toEqual(['Implementation', 'Approved']);
    expect(upcomingFor('implementation')).toEqual(['Approved']);
  });

  // Departments run in parallel: a proposal stays in department_review until the LAST one decides,
  // so departments that already approved can have staff working while others have not started.
  // Saying "Implementation · Not reached yet" under that work contradicts what is on screen.
  it('does not call a stage unreached when its work is already showing', () => {
    expect(upcomingFor('department-review', ['Implementation'])).toEqual(['Approved']);
  });

  it('is empty once the application is finished', () => {
    expect(upcomingFor('approved')).toEqual([]);
    expect(upcomingFor('rejected')).toEqual([]);
    expect(upcomingFor('cancelled')).toEqual([]);
  });
});
