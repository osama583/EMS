// Shared role-label/department lookup, transcribed from fyp-ui/src/app/core/auth/mock-users.ts's
// `roleDetails` object. Keyed by the same hyphenated role string values used in db.users.role.
// Consumed by both auth.routes.js (login response) and admin.routes.js (user directory
// projection) so the map lives in exactly one place instead of being duplicated verbatim.
const ROLE_LABELS = {
  'external-user': { label: 'Registered External User', department: 'External Community' },
  applicant: { label: 'Applicant', department: 'APU Community' },
  'club-president': { label: 'Club President', department: 'Student Clubs and Societies' },
  'hos-hod': { label: 'HOS / HOD', department: 'School Leadership' },
  cfo: { label: 'CFO', department: 'Finance Office' },
  fmb: { label: 'F&B', department: 'Food & Beverage Services' },
  'cafeteria-manager': { label: 'Cafeteria Manager', department: 'Cafeteria Services' },
  'cafeteria-staff': { label: 'Cafeteria Staff', department: 'Cafeteria Services' },
  'cafeteria-admin': { label: 'Cafeteria Admin', department: 'System Administration' },
  'logistics-manager': { label: 'Logistics Manager', department: 'Logistics and Facilities' },
  'logistics-staff': { label: 'Logistics Staff', department: 'Logistics and Facilities' },
  'student-services-manager': { label: 'Student Services Manager', department: 'Student Services' },
  'student-services-member': { label: 'Student Services Member', department: 'Student Services' },
  'av-manager': { label: 'A/V Manager', department: 'A/V Services' },
  'av-technician': { label: 'A/V Technician', department: 'A/V Services' },
  'photography-manager': { label: 'Photography Manager', department: 'Photography Services' },
  'photography-staff': { label: 'Photography Staff', department: 'Photography Services' },
  'transport-manager': { label: 'Transport Manager', department: 'Transport Services' },
  'transport-staff': { label: 'Transport Driver / Staff', department: 'Transport Services' },
  'system-admin': { label: 'System Admin', department: 'System Administration' },
  // Plain seeded student/staff accounts, used as proposal applicants (mapped to the same
  // proposal-owner navigation as Applicant/ClubPresident).
  student: { label: 'Student', department: 'APU Community' },
  lecturer: { label: 'Lecturer', department: 'Academic Staff' },
  staff: { label: 'Staff', department: 'General Staff' },
};

module.exports = { ROLE_LABELS };
