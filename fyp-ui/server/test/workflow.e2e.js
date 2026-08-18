// End-to-end smoke test of the EMS approval workflow, run against a RUNNING server.
//
//   npm run server      # terminal 1 (delete server/data/db.json first for a clean dataset)
//   npm run test:workflow
//
// It walks the whole specification: the config values, server-side validation, the
// HOS/HOD -> F&B -> CFO -> department chain, department authorization and staff assignment, the
// cancellation cascade and its deadline, the F&B -> Cafeteria sub-chain (create / send back /
// edit / approve / claim / fulfil), event registration with reasons and capacity, and the
// "manager options are snapshots" rule. Every check asserts against the API, not the UI, because
// the backend is the authority for all of it.
const BASE = 'http://localhost:4000/api';

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${extra ? ' -> ' + JSON.stringify(extra) : ''}`); }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function proposalPayload(overrides = {}) {
  return {
    applicantEmail: 'applicant@demo.apu.edu.my',
    applicantDepartment: 'School of Computing',
    eventTitle: 'E2E Workflow Test Event',
    shortIntroduction: 'Testing the full approval chain end to end.',
    goals: 'Verify every stage transition is owned by the backend.',
    benefits: 'A workflow that is provably correct.',
    eventVisibility: 'Private',
    eventFormat: '1',
    registrationMode: 'Automatic',
    totalPax: 120,
    scheduleRows: [{ date: futureDate(60), start: '09:00', end: '17:00', location: 'Auditorium' }],
    selectedRequirements: ['logistics', 'fundingPurchase'],
    eventCategories: [],
    guests: [{ guestType: 'Students', count: 120 }],
    requestRows: {
      logistics: [{ item: 'Chairs', quantity: 40, date: futureDate(60), start: '08:00', end: '18:00', location: 'Auditorium', notes: '' }],
      fundingPurchase: [{ mainItem: 'Printing and materials', subItem: 'Posters and flyers', quantity: 10, unit: 12.5, notes: '' }],
    },
    ...overrides,
  };
}

async function main() {
  console.log('\n== 1. Config is DB-driven ==');
  const config = await call('GET', '/config');
  check('all three config values exposed',
    config.body && config.body.paxReviewerThreshold === 50 && config.body.cancellationDaysLimit === 3 && config.body.maxEventCategories === 2, config.body);

  console.log('\n== 2. Validation rejects an incomplete proposal ==');
  const invalid = await call('POST', '/proposal-workflow', proposalPayload({ eventTitle: '' }));
  check('missing event title is rejected server-side', invalid.status === 400, invalid.body);
  const noSchedule = await call('POST', '/proposal-workflow', proposalPayload({ scheduleRows: [] }));
  check('missing schedule is rejected server-side', noSchedule.status === 400, noSchedule.body);
  const tooManyCategories = await call('POST', '/proposal-workflow', proposalPayload({ eventCategories: ['1', '2', '3'] }));
  check('more categories than MAX_EVENT_CATEGORIES is rejected', tooManyCategories.status === 400, tooManyCategories.body);

  console.log('\n== 3. High-pax proposal walks HOS/HOD -> F&B -> CFO -> Department ==');
  const created = await call('POST', '/proposal-workflow', proposalPayload());
  check('proposal created', created.status === 201, created.body);
  const id = created.body.id;
  check('starts at HOS/HOD review', created.body.workflow.stage === 'hos-hod-review', created.body.workflow);

  const wrongActor = await call('POST', `/proposal-workflow/${id}/approve`, { reviewerEmail: 'logistics.manager@demo.apu.edu.my' });
  check('a non-HOS cannot approve the HOS/HOD stage', wrongActor.status === 403, wrongActor.body);

  const hosApprove = await call('POST', `/proposal-workflow/${id}/approve`, { reviewerEmail: 'hoshod@demo.apu.edu.my' });
  check('HOS approval moves it to F&B review (pax 120 > 50)', hosApprove.body?.workflow?.stage === 'fmb-review', hosApprove.body);

  const cfoTooEarly = await call('POST', `/proposal-workflow/${id}/approve`, { reviewerEmail: 'cfo@demo.apu.edu.my' });
  check('CFO cannot act while it is still at F&B review', cfoTooEarly.status >= 400, cfoTooEarly.body);

  const fmbApprove = await call('POST', `/proposal-workflow/${id}/approve`, { reviewerEmail: 'fmb@demo.apu.edu.my' });
  check('F&B approval moves it to CFO review', fmbApprove.body?.workflow?.stage === 'cfo-review', fmbApprove.body);

  const cfoApprove = await call('POST', `/proposal-workflow/${id}/approve`, { reviewerEmail: 'cfo@demo.apu.edu.my' });
  check('CFO approval moves it to department review', cfoApprove.body?.workflow?.stage === 'department-review', cfoApprove.body);

  const departments = cfoApprove.body.workflow.departmentConfirmations.map((d) => d.department);
  check('exactly one department task (logistics)', departments.length === 1 && departments[0] === 'logistics', departments);
  check('Funding/Purchase creates no department task', !departments.includes('fundingPurchase'), departments);
  check('Funding/Purchase data is still stored', cfoApprove.body.requests.some((r) => r.department === 'fundingPurchase'), cfoApprove.body.requests.map((r) => r.department));

  console.log('\n== 4. Department stage is authorized and assignment is scoped ==');
  const strangerConfirm = await call('POST', `/proposal-workflow/${id}/confirm-department`, { department: 'logistics', confirmedByEmail: 'transport.manager@demo.apu.edu.my' });
  check('a different department head cannot confirm logistics', strangerConfirm.status === 403, strangerConfirm.body);

  const deptResubmitNoComment = await call('POST', `/proposal-workflow/${id}/resubmit-department`, { department: 'logistics', comment: '  ', reviewerEmail: 'logistics.manager@demo.apu.edu.my' });
  check('department resubmit requires a comment', deptResubmitNoComment.status === 400, deptResubmitNoComment.body);

  const deptResubmit = await call('POST', `/proposal-workflow/${id}/resubmit-department`, { department: 'logistics', comment: 'Please confirm the exact chair count.', reviewerEmail: 'logistics.manager@demo.apu.edu.my' });
  const logisticsEntry = deptResubmit.body?.workflow?.departmentConfirmations?.find((d) => d.department === 'logistics');
  check('department resubmit is visible as task status', logisticsEntry?.status === 'resubmitted', logisticsEntry);
  check('department resubmit does not change the proposal status', deptResubmit.body?.workflow?.stage === 'department-review', deptResubmit.body?.workflow?.stage);

  const strangerResubmit = await call('POST', `/proposal-workflow/${id}/resubmit-applicant`, { actorEmail: 'transport.staff@demo.apu.edu.my', ...proposalPayload() });
  check('a stranger cannot resubmit someone else\'s proposal', strangerResubmit.status === 403, strangerResubmit.body);

  const applicantResubmit = await call('POST', `/proposal-workflow/${id}/resubmit-applicant`, { actorEmail: 'applicant@demo.apu.edu.my', ...proposalPayload() });
  const logisticsAfter = applicantResubmit.body?.workflow?.departmentConfirmations?.find((d) => d.department === 'logistics');
  check('applicant resubmission returns the task to the department', logisticsAfter?.status === 'pending', logisticsAfter);

  const confirm = await call('POST', `/proposal-workflow/${id}/confirm-department`, { department: 'logistics', confirmedByEmail: 'logistics.manager@demo.apu.edu.my' });
  check('the logistics head can confirm', confirm.status === 200, confirm.body);

  const wrongUnitAssign = await call('POST', '/staff-tasks/assignments', { role: 'logistics_and_facilities', assignedToEmail: 'transport.staff@demo.apu.edu.my', assignedByEmail: 'logistics.manager@demo.apu.edu.my', eventCode: created.body.proposalId });
  check('cannot assign a task to staff outside the unit', wrongUnitAssign.status === 400, wrongUnitAssign.body);

  const assign = await call('POST', '/staff-tasks/assignments', { role: 'logistics_and_facilities', assignedToEmail: 'logistics.staff@demo.apu.edu.my', assignedByEmail: 'logistics.manager@demo.apu.edu.my', eventCode: created.body.proposalId });
  check('assignment to a real unit staff member succeeds', assign.status === 200, assign.body);
  const taskId = assign.body.id;

  const tasks = await call('GET', `/staff-tasks?role=logistics_and_facilities&assignedToEmail=logistics.staff@demo.apu.edu.my`);
  const myTask = (tasks.body || []).find((t) => t.id === taskId);
  check('task shows real schedule data (no undefined)', !!myTask && !String(myTask.schedule).includes('undefined'), myTask);

  const otherStaff = await call('PATCH', `/staff-tasks/${taskId}/status`, { status: 'preparing', staffEmail: 'logistics.staff2@demo.apu.edu.my' });
  check('an unassigned staff member cannot progress the task', otherStaff.status === 403, otherStaff.body);

  const preparing = await call('PATCH', `/staff-tasks/${taskId}/status`, { status: 'preparing', staffEmail: 'logistics.staff@demo.apu.edu.my' });
  check('assignee can mark preparing', preparing.body?.status === 'preparing', preparing.body);
  const completed = await call('PATCH', `/staff-tasks/${taskId}/status`, { status: 'completed', staffEmail: 'logistics.staff@demo.apu.edu.my' });
  check('assignee can mark completed', completed.body?.status === 'completed', completed.body);

  const finalState = await call('GET', `/proposal-workflow/${id}`);
  check('proposal auto-completes once every department task is done', finalState.body?.workflow?.stage === 'approved', finalState.body?.workflow?.stage);

  console.log('\n== 5. Cancellation cascades to every task ==');
  const toCancel = await call('POST', '/proposal-workflow', proposalPayload({ totalPax: 10, eventTitle: 'E2E Cancellation Test' }));
  const cancelId = toCancel.body.id;
  await call('POST', `/proposal-workflow/${cancelId}/approve`, { reviewerEmail: 'hoshod@demo.apu.edu.my' });
  const beforeCancel = await call('GET', `/proposal-workflow/${cancelId}`);
  check('low-pax proposal skips F&B/CFO', beforeCancel.body?.workflow?.stage === 'department-review', beforeCancel.body?.workflow?.stage);

  const strangerCancel = await call('POST', `/proposal-workflow/${cancelId}/cancel`, { cancelledBy: 'transport.staff@demo.apu.edu.my' });
  check('a stranger cannot cancel', strangerCancel.status === 403, strangerCancel.body);

  const cancelled = await call('POST', `/proposal-workflow/${cancelId}/cancel`, { cancelledBy: 'applicant@demo.apu.edu.my' });
  check('applicant can cancel inside the window', cancelled.body?.workflow?.stage === 'cancelled', cancelled.body?.workflow?.stage);
  const cancelledTasks = cancelled.body?.workflow?.departmentConfirmations ?? [];
  check('every department task is cancelled too', cancelledTasks.length > 0 && cancelledTasks.every((t) => t.status === 'cancelled'), cancelledTasks);

  console.log('\n== 6. Cancellation deadline is enforced ==');
  const soon = await call('POST', '/proposal-workflow', proposalPayload({
    totalPax: 10, eventTitle: 'E2E Deadline Test',
    scheduleRows: [{ date: futureDate(1), start: '09:00', end: '12:00', location: 'Lab' }],
    requestRows: { logistics: [{ item: 'Chairs', quantity: 5, date: futureDate(1), start: '08:00', end: '13:00', location: 'Lab', notes: '' }] },
    selectedRequirements: ['logistics'],
  }));
  const lateCancel = await call('POST', `/proposal-workflow/${soon.body.id}/cancel`, { cancelledBy: 'applicant@demo.apu.edu.my' });
  check('cancelling inside the deadline window is blocked', lateCancel.status === 400, lateCancel.body);
  const soonRecord = await call('GET', `/proposal-workflow/${soon.body.id}`);
  check('projection reports the cancellation window as closed', soonRecord.body?.cancellationOpen === false, soonRecord.body?.cancellationOpen);

  console.log('\n== 7. Guests cannot submit proposals ==');
  await call('POST', '/auth/register', { email: 'e2e.guest@example.com', firstName: 'E2E', lastName: 'Guest', password: 'x' });
  const guestSubmit = await call('POST', '/proposal-workflow', proposalPayload({ applicantEmail: 'e2e.guest@example.com' }));
  check('external user is refused', guestSubmit.status === 403, guestSubmit.body);


  console.log('\n== 8. F&B -> Cafeteria sub-chain ==');
  const foodPayload = proposalPayload({
    totalPax: 20, eventTitle: 'E2E Food Chain Test',
    selectedRequirements: ['fmb'],
    requestRows: {
      fmb: [{ foodType: 'Lunch', quantity: 20, date: futureDate(45), start: '12:00', location: 'Atrium', notes: '' }],
    },
    scheduleRows: [{ date: futureDate(45), start: '09:00', end: '17:00', location: 'Atrium' }],
  });
  const food = await call('POST', '/proposal-workflow', foodPayload);
  const foodId = food.body.id;
  await call('POST', `/proposal-workflow/${foodId}/approve`, { reviewerEmail: 'hoshod@demo.apu.edu.my' });
  const foodState = await call('GET', `/proposal-workflow/${foodId}`);
  check('food request creates exactly one F&B department task',
    foodState.body?.workflow?.departmentConfirmations?.length === 1 && foodState.body.workflow.departmentConfirmations[0].department === 'fmb',
    foodState.body?.workflow?.departmentConfirmations);

  const requestFmbId = foodState.body.requests.find((r) => r.department === 'fmb')?.id;
  const cafeterias = await call('GET', '/cafeterias');
  const cafeteria = (cafeterias.body || [])[0];
  check('cafeterias are available to pick from', !!cafeteria, cafeterias.body);
  const menu = await call('GET', '/request-options?kind=fmb');
  const menuItem = (menu.body || []).find((item) => item.cafeteriaCode === cafeteria.code) || (menu.body || [])[0];

  const notFmb = await call('POST', `/proposal-workflow/${foodId}/fmb-selections`, {
    reviewerEmail: 'logistics.manager@demo.apu.edu.my', requestFmbId, cafeteriaCode: cafeteria.code,
    fmbOptionId: menuItem.id, menuItemLabel: menuItem.label, quantity: 20,
  });
  check('only F&B can create a cafeteria order', notFmb.status === 403, notFmb.body);

  const order = await call('POST', `/proposal-workflow/${foodId}/fmb-selections`, {
    reviewerEmail: 'fmb@demo.apu.edu.my', requestFmbId, cafeteriaCode: cafeteria.code,
    fmbOptionId: menuItem.id, menuItemLabel: menuItem.label, quantity: 20,
  });
  check('F&B can create a cafeteria order', order.status === 201, order.body);
  const selectionId = order.body?.fmbSelections?.[0]?.id;

  const wrongManager = await call('POST', `/proposal-workflow/${foodId}/fmb-selections/${selectionId}/approve`, { reviewerEmail: 'fmb@demo.apu.edu.my' });
  check('F&B cannot approve its own cafeteria order', wrongManager.status === 403, wrongManager.body);

  const noComment = await call('POST', `/proposal-workflow/${foodId}/fmb-selections/${selectionId}/resubmit`, { reviewerEmail: 'cafeteria.manager@demo.apu.edu.my', comment: '' });
  check('resubmitting an order requires a comment', noComment.status === 400, noComment.body);

  const sentBack = await call('POST', `/proposal-workflow/${foodId}/fmb-selections/${selectionId}/resubmit`, { reviewerEmail: 'cafeteria.manager@demo.apu.edu.my', comment: 'Please split this across two menu items.' });
  const sentBackSelection = sentBack.body?.fmbSelections?.find((s) => s.id === selectionId);
  check('cafeteria manager can send an order back to F&B with a comment',
    sentBackSelection?.status === 'resubmitted' && (sentBackSelection?.managerComment || '').length > 0, sentBackSelection);

  const edited = await call('POST', `/proposal-workflow/${foodId}/fmb-selections/${selectionId}/edit`, {
    reviewerEmail: 'fmb@demo.apu.edu.my', cafeteriaCode: cafeteria.code, fmbOptionId: menuItem.id,
    menuItemLabel: menuItem.label, quantity: 10,
  });
  const editedSelection = edited.body?.fmbSelections?.find((s) => s.id === selectionId);
  check('F&B editing the order re-sends it to the cafeteria manager', editedSelection?.status === 'pending' && editedSelection?.quantity === 10, editedSelection);

  const approvedOrder = await call('POST', `/proposal-workflow/${foodId}/fmb-selections/${selectionId}/approve`, { reviewerEmail: 'cafeteria.manager@demo.apu.edu.my' });
  const approvedSelection = approvedOrder.body?.fmbSelections?.find((s) => s.id === selectionId);
  check('the owning cafeteria manager can approve the order', approvedSelection?.status === 'approved', approvedSelection);

  const pool = await call('GET', '/staff-tasks?role=cafeteria-staff&assignedToEmail=cafeteria.staff@demo.apu.edu.my');
  const poolTask = (pool.body || []).find((t) => t.id === `fmb-selection:${selectionId}`);
  check('the approved order appears in the cafeteria staff shared inbox', !!poolTask, pool.body);
  check('the order shows a real serve time (no undefined)', !!poolTask && !String(poolTask.schedule).includes('undefined'), poolTask);

  const claimed = await call('PATCH', `/staff-tasks/fmb-selection:${selectionId}/status`, { status: 'preparing', staffEmail: 'cafeteria.staff@demo.apu.edu.my' });
  check('the first staff member to claim the order owns it', claimed.body?.status === 'preparing', claimed.body);

  const secondClaim = await call('PATCH', `/staff-tasks/fmb-selection:${selectionId}/status`, { status: 'completed', staffEmail: 'cafeteria.staff2@demo.apu.edu.my' });
  check('another staff member cannot complete a claimed order', secondClaim.status === 403, secondClaim.body);

  const fulfilled = await call('PATCH', `/staff-tasks/fmb-selection:${selectionId}/status`, { status: 'completed', staffEmail: 'cafeteria.staff@demo.apu.edu.my' });
  check('the claiming staff member can fulfil the order', fulfilled.body?.status === 'completed', fulfilled.body);

  const foodFinal = await call('GET', `/proposal-workflow/${foodId}`);
  check('the proposal completes once every cafeteria order is fulfilled', foodFinal.body?.workflow?.stage === 'approved', foodFinal.body?.workflow?.stage);

  console.log('\n== 9. Event registration ==');
  const eventId = foodFinal.body.id;
  const autoReg = await call('POST', `/events/${eventId}/register`, { email: 'aina.rahman@student.apu.edu.my' });
  check('an automatic-approval event registers straight away', autoReg.body?.status === 'confirmed', autoReg.body);

  const manual = await call('POST', '/proposal-workflow', proposalPayload({
    totalPax: 10, eventTitle: 'E2E Manual Approval Event', eventVisibility: 'Public',
    registrationMode: 'Approval Required', eventCategories: ['1'], maxPax: 1,
    selectedRequirements: ['logistics'],
    requestRows: { logistics: [{ item: 'Chairs', quantity: 5, date: futureDate(50), start: '08:00', end: '18:00', location: 'Hall', notes: '' }] },
    scheduleRows: [{ date: futureDate(50), start: '09:00', end: '17:00', location: 'Hall' }],
  }));
  const manualId = manual.body.id;
  await call('POST', `/proposal-workflow/${manualId}/approve`, { reviewerEmail: 'hoshod@demo.apu.edu.my' });
  await call('POST', `/proposal-workflow/${manualId}/confirm-department`, { department: 'logistics', confirmedByEmail: 'logistics.manager@demo.apu.edu.my' });
  const manualAssign = await call('POST', '/staff-tasks/assignments', { role: 'logistics_and_facilities', assignedToEmail: 'logistics.staff@demo.apu.edu.my', assignedByEmail: 'logistics.manager@demo.apu.edu.my', eventCode: manual.body.proposalId });
  await call('PATCH', `/staff-tasks/${manualAssign.body.id}/status`, { status: 'preparing', staffEmail: 'logistics.staff@demo.apu.edu.my' });
  await call('PATCH', `/staff-tasks/${manualAssign.body.id}/status`, { status: 'completed', staffEmail: 'logistics.staff@demo.apu.edu.my' });

  const missingReason = await call('POST', `/events/${manualId}/register`, { email: 'aina.rahman@student.apu.edu.my' });
  check('a manual-approval event requires a reason for attending', missingReason.status === 400, missingReason.body);

  const longReason = await call('POST', `/events/${manualId}/register`, { email: 'aina.rahman@student.apu.edu.my', reason: 'x'.repeat(101) });
  check('the reason for attending is capped at 100 characters', longReason.status === 400, longReason.body);

  const pendingReg = await call('POST', `/events/${manualId}/register`, { email: 'aina.rahman@student.apu.edu.my', reason: 'I am presenting a poster.' });
  check('a valid manual registration goes to pending', pendingReg.body?.status === 'pending', pendingReg.body);

  const capacity = await call('POST', `/events/${manualId}/register`, { email: 'daniel.wong@student.apu.edu.my', reason: 'I would like to attend.' });
  check('registration capacity (max_pax) is enforced', capacity.status === 400, capacity.body);

  const inbox = await call('GET', '/events/registrations/pending?email=applicant@demo.apu.edu.my');
  const pendingRow = (inbox.body || []).find((r) => r.eventId === String(manualId));
  check('the applicant sees the pending registration with name, email and reason',
    !!pendingRow && !!pendingRow.name && !!pendingRow.email && pendingRow.reason === 'I am presenting a poster.', pendingRow);

  const strangerApprove = await call('POST', `/events/registrations/${pendingRow?.id}/approve`, { actorEmail: 'transport.staff@demo.apu.edu.my' });
  check('a stranger cannot approve another organizer’s registration', strangerApprove.status === 403, strangerApprove.body);

  const approvedReg = await call('POST', `/events/registrations/${pendingRow?.id}/approve`, { actorEmail: 'applicant@demo.apu.edu.my' });
  check('the applicant can approve the registration', approvedReg.body?.status === 'confirmed', approvedReg.body);


  console.log('\n== 10. Manager options are frozen as snapshots ==');
  const catalog = await call('GET', '/request-options');
  // Re-runnable against a database this test has already touched: the rename below is reverted
  // at the end, but accept either label in case a previous run was interrupted mid-way.
  const chairOption = (catalog.body || []).find((o) => o.kind === 'logistics' && String(o.label).includes('Chairs'));
  check('a logistics option exists to snapshot', !!chairOption, (catalog.body || []).slice(0, 3).map((o) => o.label));
  if (chairOption) {
    const originalLabel = chairOption.label;
    const snapProposal = await call('POST', '/proposal-workflow', proposalPayload({
      totalPax: 10, eventTitle: 'E2E Snapshot Test', selectedRequirements: ['logistics'],
      requestRows: { logistics: [{ item: chairOption.id, quantity: 12, date: futureDate(70), start: '08:00', end: '18:00', location: 'Hall A', notes: '' }] },
      scheduleRows: [{ date: futureDate(70), start: '09:00', end: '17:00', location: 'Hall A' }],
    }));
    const snapRow = snapProposal.body?.requests?.find((r) => r.department === 'logistics');
    check('a picked option is stored by its label, not its catalog reference', snapRow?.item === originalLabel, snapRow);

    const optionBody = {
      kind: 'logistics', description: chairOption.description ?? null, active: true,
      availableQuantity: chairOption.availableQuantity, quantityUnit: chairOption.quantityUnit, imageDataUrl: chairOption.imageDataUrl ?? null,
    };
    await call('PUT', `/request-options/${encodeURIComponent(chairOption.id)}`, { ...optionBody, label: `${originalLabel} (renamed)` });
    const afterRename = await call('GET', `/proposal-workflow/${snapProposal.body.id}`);
    const renamedRow = afterRename.body?.requests?.find((r) => r.department === 'logistics');
    check('renaming the option later does not change the already-submitted request', renamedRow?.item === originalLabel, renamedRow);
    // Put the catalog back so a run leaves no trace on the option itself.
    await call('PUT', `/request-options/${encodeURIComponent(chairOption.id)}`, { ...optionBody, label: originalLabel });
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
