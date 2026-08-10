// Seeds event_registration and saved_event tables from completed_approved requests
// (Task 3.5's seeded proposals) and the student accounts (Task 3.1). Must run after
// seedRequests so db.request is populated. See design spec's "at least one event with
// registration_approval='manual' and a pending registration in the organizer's inbox"
// requirement — satisfied via Scenario 9 (Clubs and Societies Fair) in seed-requests.js,
// which was given registrationApproval: 'Approval Required'.

module.exports = function seedRegistrations(db, nextId) {
  const approvedRequests = db.request.filter((r) => r.status === 'completed_approved');
  const students = db.users.filter((u) => u.role === 'student');

  for (const request of approvedRequests) {
    for (const student of students) {
      db.event_registration.push({
        event_registration_id: nextId('event_registration'),
        request_id: request.request_id,
        user_id: student.user_id,
        registrant_name: `${student.first_name} ${student.last_name}`,
        registrant_email: student.email,
        reason_for_attending: request.registration_approval === 'Approval Required' ? 'Interested in attending and supporting this event.' : null,
        status: request.registration_approval === 'Approval Required' ? 'pending_approval' : 'registered',
        registered_at: new Date().toISOString(),
      });
    }
  }

  // At least one saved event per student, for My Events / saved-events UI coverage.
  for (const student of students) {
    const first = db.request.find((r) => r.status === 'completed_approved');
    if (first) db.saved_event.push({ user_id: student.user_id, request_id: first.request_id, saved_at: new Date().toISOString() });
  }
};
