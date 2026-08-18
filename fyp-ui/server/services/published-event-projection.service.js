const { db } = require('../db');

const PLACEHOLDER_IMAGE = {
  url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Event</text></svg>',
  fileName: 'placeholder.svg',
  mimeType: 'image/svg+xml',
  sizeBytes: 0,
  status: 'uploaded',
};

// `PublishedEvent` rows ARE `request` rows that reached `completed_approved` — not a separate
// seed source (design spec's schema). Visibility (Public vs. Private/Club Only) is NOT filtered
// here: every completed event is returned to the client, which applies the
// Public-for-everyone / Private-and-Club-Only-for-signed-in-users rule based on the viewer's
// auth state (there is no server-side session to check against in this mock backend).
function isPublishedEvent(request) {
  return request.status === 'completed_approved';
}

function projectPublishedEvent(request) {
  // category_name is frozen at proposal-save time — read the snapshot directly, never re-resolve
  // via event_category, so renaming/archiving a category later can't change what's displayed here.
  const categories = db.request_categories
    .filter((rc) => rc.request_id === request.request_id)
    .map((rc) => rc.category_name);
  const schedule = db.event_schedule
    .filter((s) => s.request_id === request.request_id)
    .map((s) => ({ date: s.date, start: s.start_time, end: s.end_time, location: s.location }));
  const confirmedRegistrationCount = db.event_registration.filter((r) => r.request_id === request.request_id && r.status === 'registered').length;
  const pendingRegistrationCount = db.event_registration.filter((r) => r.request_id === request.request_id && r.status === 'pending_approval').length;
  const cost = request.cost_amount != null ? Number(request.cost_amount) : null;

  return {
    id: String(request.request_id),
    eventTitle: request.event_title,
    shortIntroduction: request.short_introduction,
    goals: request.goals_objectives,
    expectedBenefits: request.expected_benefits,
    categories,
    eventVisibility: request.event_visibility,
    promotionMethod: request.promotion_publicity_method || undefined,
    eventFormat: request.event_format_snapshot,
    eventImage: request.event_image || PLACEHOLDER_IMAGE,
    schoolDepartment: request.applicant_department_or_school,
    audience: ['APU Community'],
    schedule,
    totalExpectedPax: request.total_pax,
    registrationMode: request.registration_approval,
    confirmedRegistrationCount,
    pendingRegistrationCount,
    cost,
    bankAccountName: request.bank_account_name || null,
    bankAccountNumber: request.bank_account_number || null,
    isFree: cost == null || cost <= 0,
  };
}

function publishedEvents() {
  return db.request.filter(isPublishedEvent).map(projectPublishedEvent);
}

module.exports = { isPublishedEvent, projectPublishedEvent, publishedEvents };
