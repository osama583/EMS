const { db } = require('../db');
const workflow = require('./workflow.service');

const STAGE_LABELS = {
  submitted: 'Submitted', hos_hod_review: 'HOS/HOD review', fmb_review: 'F&B review', cfo_review: 'CFO review',
  department_review: 'Department review', resubmission_required: 'Revision required',
  completed_approved: 'Approved', completed_rejected: 'Rejected', cancelled: 'Cancelled', draft: 'Draft',
};

// Maps snake_case DB `request.status` (and `resume_stage`) values onto Angular's hyphenated
// ProposalStage enum (fyp-ui/src/app/core/proposals/proposal-status.models.ts). The DB's two
// terminal statuses (completed_approved / completed_rejected) collapse onto the enum's separate
// Approved / Rejected members, which have no snake_case DB equivalent of their own.
const DB_STATUS_TO_PROPOSAL_STAGE = {
  submitted: 'submitted',
  hos_hod_review: 'hos-hod-review',
  fmb_review: 'fmb-review',
  cfo_review: 'cfo-review',
  department_review: 'department-review',
  resubmission_required: 'resubmission-required',
  completed_approved: 'approved',
  completed_rejected: 'rejected',
  cancelled: 'cancelled',
};

function dbStatusToProposalStage(dbStatus) {
  return DB_STATUS_TO_PROPOSAL_STAGE[dbStatus] || dbStatus;
}

function editableRowsFromOrganizers(requestId) {
  return db.organizers.filter((o) => o.request_id === requestId).map((o) => ({ id: o.organizer_id, name: `${o.staff_first_name} ${o.staff_last_name}`, email: o.staff_email, role: o.staff_role, notes: o.note }));
}
function editableRowsFromCoOwners(requestId) {
  return db.co_owners.filter((c) => c.request_id === requestId).map((c) => ({ id: c.co_owner_id, name: `${c.staff_first_name} ${c.staff_last_name}`, email: c.staff_email, role: c.staff_role }));
}
function editableRowsFromImportantPeople(requestId) {
  return db.important_people.filter((p) => p.request_id === requestId).map((p) => ({ id: p.important_person_id, name: p.name, type: p.type, organization: p.organization, designation: p.designation }));
}
function editableRowsFromGuests(requestId) {
  return db.general_guest.filter((g) => g.request_id === requestId).map((g) => ({ id: g.general_guest_id, guestType: g.guest_type, count: g.count, notes: g.notes }));
}
function editableRowsFromAgenda(requestId) {
  return db.brief_agenda.filter((a) => a.request_id === requestId).map((a) => ({ id: a.brief_agenda_id, time: a.time, activity: a.activity, location: a.location, pic: a.pic, notes: a.notes }));
}
function editableRowsFromDiscussions(requestId) {
  return db.request_discussion_topics.filter((d) => d.request_id === requestId).map((d) => ({ id: d.request_discussion_topic_id, topic: d.discussion_topic }));
}
function editableRowsFromSchedule(requestId) {
  return db.event_schedule.filter((s) => s.request_id === requestId).map((s) => ({ id: s.event_schedule_id, date: s.date, start: s.start_time, end: s.end_time, location: s.location }));
}

function departmentRequestsFor(requestId) {
  const rows = [];
  for (const l of db.request_logistics.filter((r) => r.request_id === requestId)) rows.push({ id: l.request_logistics_id, department: 'logistics', item: l.item, quantity: String(l.quantity), schedule: `${l.date} · ${l.start_time}-${l.end_time}`, location: l.location, notes: l.notes || '' });
  for (const t of db.request_transportation.filter((r) => r.request_id === requestId)) rows.push({ id: t.request_transportation_id, department: 'transportation', item: t.type, quantity: `${t.requested_pax} pax`, schedule: `${t.date} · ${t.moving_time}`, location: `${t.pickup} → ${t.dropoff}`, notes: t.notes || '' });
  for (const p of db.request_photography_videography.filter((r) => r.request_id === requestId)) rows.push({ id: p.request_photography_videography_id, department: 'photoVideo', item: p.service, quantity: '—', schedule: `${p.date} · ${p.start_time}-${p.end_time}`, location: p.location, notes: p.notes || '' });
  for (const s of db.request_sound_light.filter((r) => r.request_id === requestId)) rows.push({ id: s.request_sound_light_id, department: 'soundLight', item: s.item, quantity: '1', schedule: `${s.date} · ${s.start_time}-${s.end_time}`, location: s.location, notes: s.notes || '' });
  for (const f of db.request_fmb.filter((r) => r.request_id === requestId)) rows.push({ id: f.request_fmb_id, department: 'fmb', item: f.food_type, quantity: `${f.pax} pax`, schedule: `${f.date} · ${f.serve_time}`, location: f.location, notes: f.notes || '' });
  for (const c of db.request_campus_tour.filter((r) => r.request_id === requestId)) rows.push({ id: c.request_campus_tour_id, department: 'campusTour', item: `${c.start_point} · ${c.tour_type}`, quantity: `${c.pax} pax`, schedule: c.date, location: '', notes: c.notes || '' });
  for (const w of db.request_mineral_water.filter((r) => r.request_id === requestId)) rows.push({ id: w.request_mineral_water_id, department: 'waterNormal', item: w.with_logo ? 'Mineral Water (with Logo)' : 'Mineral Water', quantity: w.option_label ? `${w.option_label}` : `${w.quantity} bottles`, schedule: `${w.date} · ${w.start_time}-${w.end_time}`, location: w.location, notes: w.notes || '' });
  for (const f of db.request_funding_purchase.filter((r) => r.request_id === requestId)) rows.push({ id: f.request_funding_purchase_id, department: 'fundingPurchase', item: `${f.main_item} — ${f.sub_item}`, quantity: String(f.quantity), schedule: '', location: '', notes: f.notes || '' });
  return rows;
}

function fmbSelectionsFor(requestId) {
  const fmbRows = db.request_fmb.filter((f) => f.request_id === requestId);
  const selections = [];
  for (const fmbRow of fmbRows) {
    for (const selection of db.request_fmb_selection.filter((s) => s.request_fmb_id === fmbRow.request_fmb_id)) {
      const cafeteria = db.unit.find((u) => u.code === selection.unit_code);
      selections.push({
        id: selection.request_fmb_selection_id,
        requestFmbId: fmbRow.request_fmb_id,
        cafeteriaCode: selection.unit_code,
        cafeteriaName: cafeteria ? cafeteria.description : 'Unknown cafeteria',
        // Encoded the same way request-options.routes.js projects catalog ids, so the F&B edit
        // form's menu-item picker can match it directly.
        fmbOptionId: selection.fmb_option_id != null ? `fmb:${selection.fmb_option_id}` : '',
        menuItemLabel: selection.menu_item_label,
        quantity: selection.quantity,
        notes: selection.notes || '',
        status: selection.status,
        // Why the owning Cafeteria Manager pushed this specific order back — shown to F&B on the
        // edit form so they know what to change before re-sending it.
        managerComment: selection.manager_comment || '',
      });
    }
  }
  return selections;
}

// Guest types that count as "external" for the reviewer's at-a-glance KPI — derived from the
// applicant's own general_guest breakdown rather than an assumed percentage of total pax.
const EXTERNAL_GUEST_TYPES = new Set(['External Guests', 'Parents-Guardians', 'Parents / Guardians', 'Industry Partners', 'Alumni', 'Others']);
function externalPaxFor(requestId) {
  return db.general_guest
    .filter((g) => g.request_id === requestId && EXTERNAL_GUEST_TYPES.has(g.guest_type))
    .reduce((sum, g) => sum + (Number(g.count) || 0), 0);
}

function canStillBeCancelled(request) {
  if (['completed_approved', 'completed_rejected', 'cancelled', 'draft'].includes(request.status)) return false;
  return workflow.isWithinCancellationWindow(request.request_id);
}

function selectedRequirementsFor(requestId) {
  return db.application_requirements.filter((ar) => ar.request_id === requestId).map((ar) => db.event_requirements.find((r) => r.requirement_id === ar.requirement_id).requirement_name);
}

function projectProposal(request) {
  // category_name is frozen at proposal-save time — read the snapshot directly (also fixes a
  // latent crash if a referenced category row were ever removed, since .find(...) could return
  // undefined and .name would throw).
  const categories = db.request_categories.filter((rc) => rc.request_id === request.request_id).map((rc) => rc.category_name);
  const applicantName = request.applicant_name;
  return {
    id: request.request_id,
    proposalId: request.request_code,
    eventTitle: request.event_title,
    applicant: applicantName,
    applicantInitials: applicantName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(),
    schedule: editableRowsFromSchedule(request.request_id).map((s) => `${s.date} · ${s.start}-${s.end} · ${s.location}`).join('; '),
    shortIntroduction: request.short_introduction,
    goals: request.goals_objectives,
    benefits: request.expected_benefits,
    totalPax: request.total_pax,
    status: STAGE_LABELS[request.status] || request.status,
    category: categories[0] || '',
    requests: departmentRequestsFor(request.request_id),
    applicantEmail: request.applicant_email,
    applicantDepartment: request.applicant_department_or_school,
    coOwners: editableRowsFromCoOwners(request.request_id),
    organizers: editableRowsFromOrganizers(request.request_id),
    importantPeople: editableRowsFromImportantPeople(request.request_id),
    guests: editableRowsFromGuests(request.request_id),
    agenda: editableRowsFromAgenda(request.request_id),
    discussions: editableRowsFromDiscussions(request.request_id),
    scheduleRows: editableRowsFromSchedule(request.request_id),
    eventImage: request.event_image,
    eventVisibility: request.event_visibility,
    eventCategories: categories,
    eventFormat: request.event_format_snapshot,
    registrationMode: request.registration_approval,
    cost: request.cost_amount != null ? Number(request.cost_amount) : null,
    bankAccountName: request.bank_account_name || null,
    bankAccountNumber: request.bank_account_number || null,
    publicity: request.promotion_publicity_method || '',
    selectedRequirements: selectedRequirementsFor(request.request_id),
    externalPax: externalPaxFor(request.request_id),
    maxPax: request.max_pax != null ? Number(request.max_pax) : null,
    // Server-computed so the cancel button's enabled state comes from the same authority that
    // enforces it (workflow.service.js's isWithinCancellationWindow), not a second date parser
    // in the browser.
    cancellationOpen: canStillBeCancelled(request),
    fmbSelections: fmbSelectionsFor(request.request_id),
    workflow: {
      stage: dbStatusToProposalStage(request.status),
      resumeStage: request.resume_stage ? dbStatusToProposalStage(request.resume_stage) : undefined,
      reviewerComment: request.reviewer_comment || undefined,
      departmentConfirmations: db.request_task.filter((t) => t.request_id === request.request_id && t.stage_code === 'department_review').map((t) => ({
        department: db.event_requirements.find((r) => r.requirement_id === t.requirement_id).requirement_name,
        confirmed: t.status === 'completed' || t.status === 'approved' || t.status === 'preparing',
        // Raw task status + the department's pushback comment, so the UI can tell "still waiting
        // on this department" apart from "this department asked the applicant for changes"
        // without re-deriving it from `confirmed` alone.
        status: t.status,
        comment: t.comment || undefined,
        confirmedAt: t.resolved_at || undefined,
        confirmedBy: t.resolved_by_user_id ? String(t.resolved_by_user_id) : undefined,
      })),
    },
  };
}

module.exports = { projectProposal };
