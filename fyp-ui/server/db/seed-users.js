// Seeds users, staff, student, unit, unit_users from mock-users.ts's account list,
// plus additional plain student/staff accounts and a second cafeteria-staff account
// needed for later tasks (proposal seed data, shared-inbox demo).
//
// users.role stores the API-facing UserRole string value directly (e.g. 'hos-hod'),
// NOT the SQL schema's snake_case CHECK-constraint token — a deliberate mock-layer
// adaptation documented in the task brief.

const roleDetails = {
  'external-user': { department: 'External Community' },
  applicant: { department: 'APU Community' },
  'club-president': { department: 'Student Clubs and Societies' },
  'hos-hod': { department: 'School Leadership' },
  cfo: { department: 'Finance Office' },
  fmb: { department: 'Food & Beverage Services' },
  'cafeteria-manager': { department: 'Cafeteria Services' },
  'cafeteria-staff': { department: 'Cafeteria Services' },
  'cafeteria-admin': { department: 'System Administration' },
  'logistics-manager': { department: 'Logistics and Facilities' },
  'logistics-staff': { department: 'Logistics and Facilities' },
  'student-services-manager': { department: 'Student Services' },
  'student-services-member': { department: 'Student Services' },
  'av-manager': { department: 'A/V Services' },
  'av-technician': { department: 'A/V Services' },
  'photography-manager': { department: 'Photography Services' },
  'photography-staff': { department: 'Photography Services' },
  'transport-manager': { department: 'Transport Services' },
  'transport-staff': { department: 'Transport Services' },
  'system-admin': { department: 'System Administration' },
  student: { department: 'APU Community' },
  staff: { department: 'General Staff' },
};

// Transcribed from fyp-ui/src/app/core/auth/mock-users.ts's MOCK_AUTH_USERS (as
// corrected by Task 2.1: merged Fmb role, no FmbWaterServicesStaff).
const ACCOUNTS = [
  { email: 'applicant@demo.apu.edu.my', displayName: 'Applicant Demo', role: 'applicant' },
  { email: 'club.president@demo.apu.edu.my', displayName: 'Club President Demo', role: 'club-president' },
  { email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', role: 'hos-hod' },
  { email: 'cfo@demo.apu.edu.my', displayName: 'CFO Demo', role: 'cfo' },
  { email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo', role: 'fmb' },
  { email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager', role: 'cafeteria-manager' },
  { email: 'cafeteria.staff@demo.apu.edu.my', displayName: 'Cafeteria Staff', role: 'cafeteria-staff' },
  { email: 'cafeteria.admin@demo.apu.edu.my', displayName: 'Cafeteria Admin', role: 'cafeteria-admin' },
  { email: 'logistics.manager@demo.apu.edu.my', displayName: 'Logistics Manager', role: 'logistics-manager' },
  { email: 'logistics.staff@demo.apu.edu.my', displayName: 'Ahmad (Logistics Staff)', role: 'logistics-staff' },
  { email: 'logistics.staff2@demo.apu.edu.my', displayName: 'David Tan (Logistics Tech)', role: 'logistics-staff' },
  { email: 'logistics.staff3@demo.apu.edu.my', displayName: 'Sarah Lee (Logistics Assistant)', role: 'logistics-staff' },
  { email: 'student.services.manager@demo.apu.edu.my', displayName: 'Student Services Manager', role: 'student-services-manager' },
  { email: 'student.services.member@demo.apu.edu.my', displayName: 'Priyah (Student Services Member)', role: 'student-services-member' },
  { email: 'student.services.member2@demo.apu.edu.my', displayName: 'Jason Lim (Campus Tour Guide)', role: 'student-services-member' },
  { email: 'student.services.member3@demo.apu.edu.my', displayName: 'Chloe Tan (Student Ambassador)', role: 'student-services-member' },
  { email: 'av.manager@demo.apu.edu.my', displayName: 'A/V Manager', role: 'av-manager' },
  { email: 'av.technician@demo.apu.edu.my', displayName: 'Marcus Vance (Senior A/V Tech)', role: 'av-technician' },
  { email: 'av.technician2@demo.apu.edu.my', displayName: 'Ethan Wong (Sound Engineer)', role: 'av-technician' },
  { email: 'av.technician3@demo.apu.edu.my', displayName: 'Nurul Huda (Lighting Specialist)', role: 'av-technician' },
  { email: 'photography.manager@demo.apu.edu.my', displayName: 'Photography Manager', role: 'photography-manager' },
  { email: 'photographer@demo.apu.edu.my', displayName: 'Alex Rivera (Photographer)', role: 'photography-staff' },
  { email: 'photographer2@demo.apu.edu.my', displayName: 'Samantha Ong (Videographer)', role: 'photography-staff' },
  { email: 'transport.manager@demo.apu.edu.my', displayName: 'Transport Manager', role: 'transport-manager' },
  { email: 'transport.staff@demo.apu.edu.my', displayName: 'Captain Bob (Transport Driver)', role: 'transport-staff' },
  { email: 'transport.staff2@demo.apu.edu.my', displayName: 'Harish Kumar (Fleet Coordinator)', role: 'transport-staff' },
  { email: 'system.admin@demo.apu.edu.my', displayName: 'System Admin', role: 'system-admin' },

  // Additional plain applicant accounts (student / staff) not present in mock-users.ts —
  // needed by Task 3.6's proposal seed data for realistic applicants.
  { email: 'aina.rahman@student.apu.edu.my', displayName: 'Aina Rahman', role: 'student', school: 'School of Computing' },
  { email: 'daniel.wong@student.apu.edu.my', displayName: 'Daniel Wong', role: 'student', school: 'School of Business' },
  { email: 'mei.ling.tan@student.apu.edu.my', displayName: 'Mei Ling Tan', role: 'student', school: 'School of Computing' },
  { email: 'jordan.lee@staff.apu.edu.my', displayName: 'Jordan Lee', role: 'staff' },
  { email: 'farah.izzati@staff.apu.edu.my', displayName: 'Farah Izzati', role: 'staff' },

  // Second cafeteria-staff account — needed so >1 staff member can claim the same
  // shared-inbox task in Task 3.6's F&B demo scenario.
  { email: 'cafeteria.staff2@demo.apu.edu.my', displayName: 'Cafeteria Staff Two', role: 'cafeteria-staff' },
];

function splitName(displayName) {
  const parenIndex = displayName.indexOf('(');
  const cleaned = parenIndex >= 0 ? displayName.slice(0, parenIndex).trim() : displayName;
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const MANAGER_LIKE_ROLES = new Set([
  'club-president', 'hos-hod', 'cfo', 'fmb',
  'cafeteria-manager', 'cafeteria-staff', 'cafeteria-admin',
  'logistics-manager', 'logistics-staff',
  'student-services-manager', 'student-services-member',
  'av-manager', 'av-technician',
  'photography-manager', 'photography-staff',
  'transport-manager', 'transport-staff',
  'system-admin',
]);

module.exports = function seedUsers(db, nextId) {
  const departmentsByUnit = new Map(); // department string -> unit code
  const usersByDepartment = new Map(); // department string -> array of user rows

  for (const acct of ACCOUNTS) {
    const { firstName, lastName } = splitName(acct.displayName);
    const department = roleDetails[acct.role].department;

    const user = {
      user_id: nextId('users'),
      first_name: firstName,
      last_name: lastName,
      email: acct.email,
      phone_number: null,
      role: acct.role,
      is_active: true,
      password: 'Demo@123',
    };
    db.users.push(user);

    if (acct.role === 'student') {
      db.student.push({
        student_id: nextId('student'),
        user_id: user.user_id,
        school: acct.school || 'School of Computing',
      });
    } else if (acct.role === 'staff' || MANAGER_LIKE_ROLES.has(acct.role)) {
      db.staff.push({
        staff_id: nextId('staff'),
        user_id: user.user_id,
        department_or_school: department,
      });
    }

    if (!usersByDepartment.has(department)) usersByDepartment.set(department, []);
    usersByDepartment.get(department).push(user);
  }

  // Build unit rows — one per distinct department across all seeded users.
  for (const [department, users] of usersByDepartment.entries()) {
    const code = slugify(department).slice(0, 20).toUpperCase();
    departmentsByUnit.set(department, code);

    const hosHod = users.find((u) => u.role === 'hos-hod');
    db.unit.push({
      code,
      description: department,
      head_user_id: hosHod ? hosHod.user_id : null,
      is_active: true,
    });

    for (const user of users) {
      db.unit_users.push({ user_id: user.user_id, unit_code: code });
    }
  }
};
