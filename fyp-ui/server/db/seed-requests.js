// Seeds 13 realistic proposals covering every workflow state, driven through
// workflow.service.js's exported state-machine functions (not hand-set status
// fields) per the design spec's "Seed data coverage" section.
//
// NOTE on user.role lookups below: db.users.role stores the API-facing UserRole
// string value directly (hyphenated, e.g. 'hos-hod', 'logistics-manager',
// 'av-manager', 'photography-manager') per seed-users.js — NOT the SQL schema's
// snake_case CHECK-constraint tokens. All role lookups in this file use the
// correct hyphenated values, verified against server/db/seed-users.js and
// src/app/core/auth/auth.models.ts's UserRole enum.

function buildRequest(db, nextId, opts) {
  const applicant = db.users.find((u) => u.email === opts.applicantEmail);
  const unit = db.unit_users.find((uu) => uu.user_id === applicant.user_id);
  const unitRow = unit ? db.unit.find((u) => u.code === unit.unit_code) : null;

  const request = {
    request_id: nextId('request'),
    request_code: opts.requestCode,
    applicant_user_id: applicant.user_id,
    applicant_name: `${applicant.first_name} ${applicant.last_name}`,
    applicant_email: applicant.email,
    applicant_department_or_school: unitRow ? unitRow.description : 'School of Computing',
    event_title: opts.eventTitle,
    short_introduction: opts.shortIntroduction,
    goals_objectives: opts.goals,
    expected_benefits: opts.benefits,
    event_visibility: opts.visibility || 'Public',
    event_format: opts.format || 'On Campus',
    registration_approval: opts.registrationApproval || 'Automatic',
    promotion_publicity_method: opts.publicity || null,
    event_image: null,
    total_pax: opts.totalPax,
    max_pax: opts.maxPax || null,
    status: 'draft',
    submitted_at: null,
    cancelled_at: null,
    cancelled_by_user_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resume_stage: null,
    reviewer_comment: null,
  };
  db.request.push(request);

  for (const categoryName of opts.categories || []) {
    const category = db.event_category.find((c) => c.name === categoryName);
    db.request_categories.push({ request_id: request.request_id, category_id: category.event_category_id });
  }

  for (const requirementName of opts.requirements || []) {
    const requirement = db.event_requirements.find((r) => r.requirement_name === requirementName);
    db.application_requirements.push({ request_id: request.request_id, requirement_id: requirement.requirement_id });
  }

  db.event_schedule.push({ event_schedule_id: nextId('event_schedule'), request_id: request.request_id, date: opts.schedule.date, start_time: opts.schedule.start, end_time: opts.schedule.end, location: opts.schedule.location });

  for (const organizer of opts.organizers || [{ name: request.applicant_name, email: request.applicant_email, role: 'Event Lead', note: 'Primary point of contact.' }]) {
    db.organizers.push({ organizer_id: nextId('organizers'), request_id: request.request_id, staff_id: null, staff_first_name: organizer.name.split(' ')[0], staff_last_name: organizer.name.split(' ').slice(1).join(' '), staff_email: organizer.email, staff_role: organizer.role, note: organizer.note || null });
  }

  for (const guest of opts.guests || [{ guestType: 'Students', count: Math.round(opts.totalPax * 0.8), notes: 'General admission.' }]) {
    db.general_guest.push({ general_guest_id: nextId('general_guest'), request_id: request.request_id, guest_type: guest.guestType, count: guest.count, notes: guest.notes || null });
  }

  return request;
}

function addLogisticsRequest(db, nextId, request, opts) {
  db.request_logistics.push({ request_logistics_id: nextId('request_logistics'), request_id: request.request_id, option_id: opts.optionId || null, item: opts.item, quantity: opts.quantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addTransportationRequest(db, nextId, request, opts) {
  db.request_transportation.push({ request_transportation_id: nextId('request_transportation'), request_id: request.request_id, option_id: opts.optionId || null, type: opts.type, requested_pax: opts.requestedPax, pickup: opts.pickup, dropoff: opts.dropoff, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addPhotoVideoRequest(db, nextId, request, opts) {
  db.request_photography_videography.push({ request_photography_videography_id: nextId('request_photography_videography'), request_id: request.request_id, option_id: opts.optionId || null, service: opts.service, personnel_quantity: opts.personnelQuantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, coverage: opts.coverage, notes: opts.notes || null });
}
function addSoundLightRequest(db, nextId, request, opts) {
  db.request_sound_light.push({ request_sound_light_id: nextId('request_sound_light'), request_id: request.request_id, option_id: opts.optionId || null, item: opts.item, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addFmbRequest(db, nextId, request, opts) {
  const row = { request_fmb_id: nextId('request_fmb'), request_id: request.request_id, option_id: opts.optionId || null, food_type: opts.foodType, pax: opts.pax, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null };
  db.request_fmb.push(row);
  return row;
}
function addCampusTourRequest(db, nextId, request, opts) {
  db.request_campus_tour.push({ request_campus_tour_id: nextId('request_campus_tour'), request_id: request.request_id, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, pax: opts.pax, start_point_option_id: opts.startPointOptionId || null, start_point: opts.startPoint, notes: opts.notes || null });
}
function addWaterLogoRequest(db, nextId, request, opts) {
  db.request_mineral_water_logo.push({ request_mineral_water_logo_id: nextId('request_mineral_water_logo'), request_id: request.request_id, option_id: opts.optionId || null, quantity: opts.quantity, date: opts.date, start_time: opts.start, end_time: opts.end, location: opts.location, notes: opts.notes || null });
}
function addFundingPurchaseRequest(db, nextId, request, opts) {
  db.request_funding_purchase.push({ request_funding_purchase_id: nextId('request_funding_purchase'), request_id: request.request_id, main_option_id: opts.mainOptionId || null, main_item: opts.mainItem, sub_option_id: opts.subOptionId || null, sub_item: opts.subItem, quantity: opts.quantity, unit_price_rm: opts.unitPrice, notes: opts.notes || null });
}

const workflow = require('../services/workflow.service');

function seedRequests(db, nextId) {
  // Scenario 1: plain low-pax proposal mid-hos_hod_review.
  const r1 = buildRequest(db, nextId, {
    requestCode: 'EVT-260201', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'APU Photography Club Exhibition', shortIntroduction: 'A showcase of student photography from the past semester.',
    goals: 'Give student photographers a public platform for their work.', benefits: 'Increased visibility for the Photography Club and stronger campus arts culture.',
    totalPax: 45, categories: ['Culture & Community'], requirements: ['logistics'],
    schedule: { date: '2026-08-20', start: '14:00', end: '18:00', location: 'Spine Gallery' },
  });
  addLogisticsRequest(db, nextId, r1, { item: 'Display easels', quantity: 20, date: '2026-08-20', start: '12:00', end: '18:00', location: 'Spine Gallery', notes: 'Set up before 12pm.' });
  r1.status = 'hos_hod_review';
  r1.submitted_at = new Date().toISOString();

  // Scenario 2: high-pax proposal mid-fmb_review (not yet reached CFO).
  const r2 = buildRequest(db, nextId, {
    requestCode: 'EVT-260202', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Future Tech Showcase 2026', shortIntroduction: 'Student technology demonstrations and industry panel discussions.',
    goals: 'Connect student innovators with industry.', benefits: 'Professional feedback and collaboration opportunities.',
    totalPax: 120, categories: ['Academic & Career'], requirements: ['logistics', 'fmb'],
    schedule: { date: '2026-08-25', start: '10:00', end: '17:00', location: 'Design Studio' },
  });
  addLogisticsRequest(db, nextId, r2, { item: 'Exhibition booths', quantity: 15, date: '2026-08-25', start: '08:00', end: '17:00', location: 'Design Studio', notes: null });
  addFmbRequest(db, nextId, r2, { foodType: 'Buffet', pax: 120, date: '2026-08-25', start: '12:00', end: '13:30', location: 'Design Studio', notes: 'Halal and vegetarian selections required.' });
  r2.status = 'fmb_review';
  r2.submitted_at = new Date().toISOString();

  // Scenario 3: high-pax proposal mid-cfo_review (F&B already approved, CFO pending).
  const r3 = buildRequest(db, nextId, {
    requestCode: 'EVT-260203', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'APU Sports Carnival', shortIntroduction: 'A university-wide day of sports and wellness activities.',
    goals: 'Encourage active lifestyles across schools.', benefits: 'Improved wellbeing and inter-school teamwork.',
    totalPax: 320, categories: ['Sports & Wellness'], requirements: ['logistics', 'transportation'],
    schedule: { date: '2026-09-02', start: '08:00', end: '18:00', location: 'Sports Centre' },
  });
  addLogisticsRequest(db, nextId, r3, { item: 'Banquet chairs', quantity: 100, date: '2026-09-02', start: '07:00', end: '18:00', location: 'Sports Centre', notes: null });
  addTransportationRequest(db, nextId, r3, { type: 'Chartered bus', requestedPax: 44, pickup: 'APU Residence', dropoff: 'Sports Centre', date: '2026-09-02', start: '07:00', end: '08:00', location: 'Sports Centre', notes: null });
  r3.status = 'cfo_review';
  r3.submitted_at = new Date().toISOString();

  // Scenario 4: high-pax proposal where CFO resubmitted; resumed at cfo_review after
  // applicant's fix (demonstrates F&B is skipped on resume).
  const r4 = buildRequest(db, nextId, {
    requestCode: 'EVT-260204', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'Innovation Summit 2026', shortIntroduction: 'A day of keynotes and workshops on emerging technology.',
    goals: 'Expose students to industry innovation trends.', benefits: 'Broader technical awareness and networking.',
    totalPax: 200, categories: ['Academic & Career'], requirements: ['fundingPurchase'],
    schedule: { date: '2026-09-10', start: '09:00', end: '17:00', location: 'Auditorium 1' },
  });
  addFundingPurchaseRequest(db, nextId, r4, { mainItem: 'Honorarium', subItem: 'Guest speaker', quantity: 3, unitPrice: 1500, notes: 'Three keynote speakers.' });
  r4.status = 'cfo_review';
  r4.submitted_at = new Date().toISOString();
  r4.resume_stage = null; // already resumed — this row represents the state AFTER resubmission, back at cfo_review

  // Scenario 5: HOS/HOD self-application — skipped straight to F&B review.
  const r5 = buildRequest(db, nextId, {
    requestCode: 'EVT-260205', applicantEmail: 'hoshod@demo.apu.edu.my',
    eventTitle: 'School Leadership Retreat', shortIntroduction: 'An internal planning retreat for school leadership.',
    goals: 'Align on the coming semester\'s priorities.', benefits: 'Stronger leadership coordination.',
    totalPax: 30, categories: ['Academic & Career'], requirements: ['fmb'],
    schedule: { date: '2026-08-18', start: '09:00', end: '16:00', location: 'Auditorium 2' },
  });
  addFmbRequest(db, nextId, r5, { foodType: 'Lunch', pax: 30, date: '2026-08-18', start: '12:00', end: '13:00', location: 'Auditorium 2', notes: null });
  r5.status = 'fmb_review'; // skipped hos_hod_review because applicant IS this unit's HOS/HOD
  r5.submitted_at = new Date().toISOString();

  // Scenario 6: applicant-is-CFO application — skipped straight to department_review.
  const r6 = buildRequest(db, nextId, {
    requestCode: 'EVT-260206', applicantEmail: 'cfo@demo.apu.edu.my',
    eventTitle: 'Finance Office Town Hall', shortIntroduction: 'A quarterly briefing for the Finance Office team.',
    goals: 'Share quarterly results and priorities.', benefits: 'Team alignment.',
    totalPax: 25, categories: ['Academic & Career'], requirements: ['logistics'],
    schedule: { date: '2026-08-15', start: '10:00', end: '11:30', location: 'Auditorium 2' },
  });
  addLogisticsRequest(db, nextId, r6, { item: 'Chairs', quantity: 25, date: '2026-08-15', start: '09:30', end: '11:30', location: 'Auditorium 2', notes: null });
  r6.status = 'department_review';
  r6.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r6.request_id);

  // Scenario 7: department_review proposal — 2 of 4 tasks approved+assigned, 1 pending, 1 resubmitted.
  const r7 = buildRequest(db, nextId, {
    requestCode: 'EVT-260207', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'APU Cultural Night 2026', shortIntroduction: 'An evening celebrating APU\'s international community.',
    goals: 'Strengthen cross-cultural understanding.', benefits: 'Greater student participation and cultural awareness.',
    totalPax: 180, categories: ['Culture & Community'], requirements: ['logistics', 'soundLight', 'photoVideo', 'transportation'],
    schedule: { date: '2026-08-08', start: '16:00', end: '22:00', location: 'Atrium' },
  });
  addLogisticsRequest(db, nextId, r7, { item: 'Banquet chairs and registration tables', quantity: 188, date: '2026-08-08', start: '13:00', end: '15:30', location: 'Atrium', notes: 'Complete setup before vendor arrival.' });
  addSoundLightRequest(db, nextId, r7, { item: 'Main-stage sound and lighting', date: '2026-08-08', start: '14:00', end: '22:00', location: 'Atrium stage', notes: 'Wireless microphones, digital mixer.' });
  addPhotoVideoRequest(db, nextId, r7, { service: 'Photo and video team', personnelQuantity: 3, date: '2026-08-08', start: '16:00', end: '22:00', location: 'Atrium', coverage: 'Performances, guests, awards.', notes: null });
  addTransportationRequest(db, nextId, r7, { type: 'Campus shuttle', requestedPax: 28, pickup: 'APU Residence', dropoff: 'Campus', date: '2026-08-08', start: '15:00', end: '22:30', location: 'Atrium', notes: 'Two scheduled pickup windows.' });
  r7.status = 'department_review';
  r7.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r7.request_id);
  {
    const logisticsManager = db.users.find((u) => u.role === 'logistics-manager');
    const logisticsStaff = db.users.find((u) => u.role === 'logistics-staff');
    workflow.approveDepartmentTask(r7.request_id, 'logistics', logisticsManager.user_id);
    workflow.assignStaffToTask(workflow.findDepartmentTask(r7.request_id, 'logistics').request_task_id, logisticsStaff.user_id, logisticsManager.user_id);

    const avManager = db.users.find((u) => u.role === 'av-manager');
    const avTech = db.users.find((u) => u.role === 'av-technician');
    if (avManager && avTech) {
      workflow.approveDepartmentTask(r7.request_id, 'soundLight', avManager.user_id);
      workflow.assignStaffToTask(workflow.findDepartmentTask(r7.request_id, 'soundLight').request_task_id, avTech.user_id, avManager.user_id);
    }

    const photoManager = db.users.find((u) => u.role === 'photography-manager');
    if (photoManager) workflow.resubmitDepartmentTask(r7.request_id, 'photoVideo', photoManager.user_id, 'Please confirm exact number of guests requiring photo coverage before we can allocate personnel.');
    // transportation task is left at 'pending' — the 4th, untouched task for this scenario.
  }

  // Scenario 8: F&B request with 2 request_fmb_selection rows — one approved+claimed by
  // Cafeteria Staff, one resubmitted back to F&B.
  const r8 = buildRequest(db, nextId, {
    requestCode: 'EVT-260208', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'Graduate Networking Evening', shortIntroduction: 'An evening for graduating students to connect with alumni.',
    goals: 'Support graduate employability.', benefits: 'New career connections.',
    totalPax: 90, categories: ['Academic & Career'], requirements: ['fmb'],
    schedule: { date: '2026-08-23', start: '17:00', end: '20:30', location: 'Auditorium 2' },
  });
  const r8Fmb = addFmbRequest(db, nextId, r8, { foodType: 'Refreshments', pax: 90, date: '2026-08-23', start: '18:00', end: '19:00', location: 'Auditorium 2', notes: 'Split across two cafeterias for faster service.' });
  r8.status = 'department_review';
  r8.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r8.request_id);
  {
    const fmbOption1 = db.fmb_options.find((o) => o.cafeteria_id === db.cafeteria[0].cafeteria_id);
    const fmbOption2 = db.fmb_options.find((o) => o.cafeteria_id === db.cafeteria[1].cafeteria_id);
    const selection1 = workflow.createFmbSelection(r8Fmb.request_fmb_id, db.cafeteria[0].cafeteria_id, fmbOption1.fmb_option_id, fmbOption1.label, 45, null);
    const selection2 = workflow.createFmbSelection(r8Fmb.request_fmb_id, db.cafeteria[1].cafeteria_id, fmbOption2.fmb_option_id, fmbOption2.label, 45, null);
    const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
    const cafeteriaStaff = db.users.find((u) => u.role === 'cafeteria-staff');
    workflow.approveFmbSelection(selection1.request_fmb_selection_id, cafeteriaManager.user_id);
    workflow.claimSharedFmbSelection(selection1.request_fmb_selection_id, cafeteriaStaff.user_id);
    workflow.resubmitFmbSelection(selection2.request_fmb_selection_id, cafeteriaManager.user_id);
  }

  // Scenario 9: fully completed_approved proposal with full task/history trail.
  const r9 = buildRequest(db, nextId, {
    requestCode: 'EVT-260082', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Clubs and Societies Fair', shortIntroduction: 'A discovery fair introducing students to APU clubs and societies.',
    goals: 'Increase awareness and membership of student-led organisations.', benefits: 'Stronger campus participation.',
    totalPax: 260, categories: ['Clubs & Societies'], requirements: ['logistics'],
    schedule: { date: '2026-07-18', start: '10:00', end: '16:00', location: 'Spine' },
  });
  addLogisticsRequest(db, nextId, r9, { item: 'Display booths', quantity: 24, date: '2026-07-18', start: '08:00', end: '16:00', location: 'Spine', notes: null });
  r9.status = 'department_review';
  r9.submitted_at = new Date().toISOString();
  workflow.createDepartmentTasks(r9.request_id);
  {
    const logisticsManager = db.users.find((u) => u.role === 'logistics-manager');
    const logisticsStaff = db.users.find((u) => u.role === 'logistics-staff');
    workflow.approveDepartmentTask(r9.request_id, 'logistics', logisticsManager.user_id);
    const task = workflow.findDepartmentTask(r9.request_id, 'logistics');
    workflow.assignStaffToTask(task.request_task_id, logisticsStaff.user_id, logisticsManager.user_id);
    workflow.updateTaskStatus(task.request_task_id, 'preparing');
    workflow.updateTaskStatus(task.request_task_id, 'completed');
  }

  // Scenario 10: completed_rejected proposal (rejected at hos_hod_review).
  const r10 = buildRequest(db, nextId, {
    requestCode: 'EVT-260210', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Unofficial Campus Party', shortIntroduction: 'A late-night unofficial gathering.',
    goals: 'Social gathering.', benefits: 'Student socialising.',
    totalPax: 300, categories: ['Entertainment & Social'], requirements: ['soundLight'],
    schedule: { date: '2026-08-30', start: '22:00', end: '02:00', location: 'Campus Plaza' },
  });
  addSoundLightRequest(db, nextId, r10, { item: 'PA system', date: '2026-08-30', start: '21:00', end: '02:00', location: 'Campus Plaza', notes: null });
  r10.status = 'hos_hod_review';
  r10.submitted_at = new Date().toISOString();
  {
    const hosHod = db.users.find((u) => u.role === 'hos-hod');
    workflow.rejectReviewerStage(r10.request_id, hosHod.user_id, 'Late-night off-hours events past 10pm are not permitted without prior special approval from Campus Safety, which was not obtained.');
  }

  // Scenario 11: cancelled proposal (cancelled by applicant before the deadline).
  const r11 = buildRequest(db, nextId, {
    requestCode: 'EVT-260211', applicantEmail: 'aina.rahman@student.apu.edu.my',
    eventTitle: 'Photography Club Field Trip', shortIntroduction: 'An off-campus photography excursion.',
    goals: 'Practical photography experience.', benefits: 'Skill development.',
    totalPax: 20, categories: ['Culture & Community'], requirements: ['transportation'],
    schedule: { date: '2026-12-15', start: '08:00', end: '18:00', location: 'Batu Caves' },
  });
  addTransportationRequest(db, nextId, r11, { type: 'University van', requestedPax: 20, pickup: 'APU Main Entrance', dropoff: 'Batu Caves', date: '2026-12-15', start: '08:00', end: '09:00', location: 'Batu Caves', notes: null });
  r11.status = 'hos_hod_review';
  r11.submitted_at = new Date().toISOString();
  workflow.cancelProposal(r11.request_id, r11.applicant_user_id);

  // Scenarios 12-13: draft proposals never submitted.
  buildRequest(db, nextId, {
    requestCode: 'EVT-260212', applicantEmail: 'jordan.lee@staff.apu.edu.my',
    eventTitle: 'Draft: Alumni Homecoming', shortIntroduction: 'Planning in progress.',
    goals: 'TBD.', benefits: 'TBD.', totalPax: 0, categories: [], requirements: [],
    schedule: { date: '2026-10-05', start: '10:00', end: '16:00', location: 'TBD' },
  });
  buildRequest(db, nextId, {
    requestCode: 'EVT-260213', applicantEmail: 'daniel.wong@student.apu.edu.my',
    eventTitle: 'Draft: Winter Charity Drive', shortIntroduction: 'Planning in progress.',
    goals: 'TBD.', benefits: 'TBD.', totalPax: 0, categories: [], requirements: [],
    schedule: { date: '2026-12-01', start: '09:00', end: '17:00', location: 'TBD' },
  });
}

module.exports = {
  buildRequest,
  addLogisticsRequest,
  addTransportationRequest,
  addPhotoVideoRequest,
  addSoundLightRequest,
  addFmbRequest,
  addCampusTourRequest,
  addWaterLogoRequest,
  addFundingPurchaseRequest,
  seedRequests,
};
