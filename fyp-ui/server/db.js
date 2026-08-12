// Persisted database. Every table listed below mirrors ems_database_schema.sql exactly —
// same table name, same column names, snake_case throughout.
//
// server/data/db.json is the ONLY data-storage file in this backend — no separate seed-*.js
// modules exist anymore. On first boot (no db.json present), the seedFresh() function below
// populates the initial demo dataset (users/units/cafeterias/categories/config/dropdown
// options) directly in-process and writes it to disk immediately. After that, db.json is the
// sole source of truth for every table, including dropdown options and every request/workflow
// row — nothing is ever re-seeded from code on a later boot. Every mutating route calls
// saveDb() (via server/app.js's shared middleware) after changing the in-memory db so the file
// stays in sync — this module exports saveDb() for exactly that purpose.

const fs = require('fs');
const path = require('path');

const workflowService = require('./services/workflow.service');

const TABLE_NAMES = [
  // Identity & Organization
  'users', 'staff', 'student', 'external_user_profile', 'unit', 'unit_users', 'clubs', 'student_clubs',
  // Cafeteria Domain
  'cafeteria', 'cafeteria_assignment',
  // Categories & Requirements
  'event_category', 'event_requirements',
  // Manager-Configured Options
  'logistics_options', 'transportation_options', 'media_options', 'sound_light_options',
  'dietary_information_options', 'serving_unit_options', 'fmb_options',
  'campus_tour_start_options', 'water_logo_options', 'water_normal_options',
  'funding_main_options', 'funding_sub_options',
  // Config
  'config',
  // Request Core
  'request', 'request_categories', 'application_requirements',
  // Request-Specific Department Data (snapshots)
  'request_logistics', 'request_transportation', 'request_photography_videography',
  'request_sound_light', 'request_fmb', 'request_fmb_selection', 'request_campus_tour',
  'request_mineral_water_logo', 'request_mineral_water_normal', 'request_funding_purchase',
  // Request Support Tables
  'co_owners', 'organizers', 'important_people', 'general_guest', 'event_schedule',
  'brief_agenda', 'request_discussion_topics',
  // Event Discovery / Registration
  'event_registration', 'saved_event',
  // Workflow — Tasks, Assignments, History
  'request_task', 'task_assignment', 'workflow_history',
  // Engagement (notification preferences — see event-engagement.routes.js)
  'notification_preference',
];

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const db = {};
for (const table of TABLE_NAMES) db[table] = [];

const counters = {};
function resetCounters() {
  for (const table of TABLE_NAMES) counters[table] = 0;
}
function nextId(table) {
  counters[table] = (counters[table] || 0) + 1;
  return counters[table];
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ counters, tables: db }, null, 2));
}

function loadFromDisk() {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  for (const table of TABLE_NAMES) db[table] = raw.tables[table] || [];
  Object.assign(counters, raw.counters || {});
}

// ============================================================================
// Fresh-seed data (only ever runs once, when server/data/db.json does not yet exist)
// ============================================================================

const ROLE_DEPARTMENTS = {
  'external-user': 'External Community',
  applicant: 'APU Community',
  'club-president': 'Student Clubs and Societies',
  'hos-hod': 'School Leadership',
  cfo: 'Finance Office',
  fmb: 'Food & Beverage Services',
  'cafeteria-manager': 'Cafeteria Services',
  'cafeteria-staff': 'Cafeteria Services',
  'cafeteria-admin': 'System Administration',
  'logistics-manager': 'Logistics and Facilities',
  'logistics-staff': 'Logistics and Facilities',
  'student-services-manager': 'Student Services',
  'student-services-member': 'Student Services',
  'av-manager': 'A/V Services',
  'av-technician': 'A/V Services',
  'photography-manager': 'Photography Services',
  'photography-staff': 'Photography Services',
  'transport-manager': 'Transport Services',
  'transport-staff': 'Transport Services',
  'system-admin': 'System Administration',
  student: 'APU Community',
  lecturer: 'Academic Staff',
  staff: 'General Staff',
};

// Transcribed from fyp-ui/src/app/core/auth/mock-users.ts's MOCK_AUTH_USERS.
const SEED_ACCOUNTS = [
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
  { email: 'aina.rahman@student.apu.edu.my', displayName: 'Aina Rahman', role: 'student', school: 'School of Computing' },
  { email: 'daniel.wong@student.apu.edu.my', displayName: 'Daniel Wong', role: 'student', school: 'School of Business' },
  { email: 'mei.ling.tan@student.apu.edu.my', displayName: 'Mei Ling Tan', role: 'student', school: 'School of Computing' },
  { email: 'jordan.lee@staff.apu.edu.my', displayName: 'Jordan Lee', role: 'staff' },
  { email: 'farah.izzati@staff.apu.edu.my', displayName: 'Farah Izzati', role: 'staff' },
  { email: 'cafeteria.staff2@demo.apu.edu.my', displayName: 'Cafeteria Staff Two', role: 'cafeteria-staff' },
  { email: 'hos.computing@demo.apu.edu.my', displayName: 'Dr. Wei Chen (HOS, School of Computing)', role: 'hos-hod', department: 'School of Computing' },
  { email: 'student.computing@demo.apu.edu.my', displayName: 'Aina Rahman (Computing Student)', role: 'student', school: 'School of Computing' },
  { email: 'student.computing2@demo.apu.edu.my', displayName: 'Mei Ling Tan (Computing Student)', role: 'student', school: 'School of Computing' },
  { email: 'lecturer.computing@demo.apu.edu.my', displayName: 'Dr. Kumar Selvam (Computing Lecturer)', role: 'lecturer', department: 'School of Computing' },
  { email: 'hos.business@demo.apu.edu.my', displayName: 'Dr. Farah Aziz (HOS, School of Business)', role: 'hos-hod', department: 'School of Business' },
  { email: 'student.business@demo.apu.edu.my', displayName: 'Daniel Wong (Business Student)', role: 'student', school: 'School of Business' },
  { email: 'lecturer.business@demo.apu.edu.my', displayName: 'Dr. Siti Nurhaliza (Business Lecturer)', role: 'lecturer', department: 'School of Business' },
  { email: 'hod.marketing@demo.apu.edu.my', displayName: 'Encik Razif Hassan (HOD, Marketing)', role: 'hos-hod', department: 'Marketing' },
  { email: 'staff.marketing@demo.apu.edu.my', displayName: 'Nurul Huda (Marketing Staff)', role: 'staff', department: 'Marketing' },
  { email: 'staff.marketing2@demo.apu.edu.my', displayName: 'Jordan Lee (Marketing Staff)', role: 'staff', department: 'Marketing' },
  { email: 'hod.finance@demo.apu.edu.my', displayName: 'Puan Aishah Karim (HOD, Finance)', role: 'hos-hod', department: 'Finance' },
  { email: 'staff.finance@demo.apu.edu.my', displayName: 'Farah Izzati (Finance Staff)', role: 'staff', department: 'Finance' },
];

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

function splitName(displayName) {
  const parenIndex = displayName.indexOf('(');
  const cleaned = parenIndex >= 0 ? displayName.slice(0, parenIndex).trim() : displayName;
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function seedUsersAndUnits() {
  const usersByDepartment = new Map();

  for (const acct of SEED_ACCOUNTS) {
    const { firstName, lastName } = splitName(acct.displayName);
    // acct.department (HOS/HOD/staff/lecturer) or acct.school (student) override the role-level
    // default so accounts sharing a role — e.g. two HOS/HOD accounts for two different schools —
    // land in distinct units instead of collapsing into one.
    const department = acct.department || acct.school || ROLE_DEPARTMENTS[acct.role];

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
      db.student.push({ student_id: nextId('student'), user_id: user.user_id, school: acct.school || 'School of Computing' });
    } else if (acct.role === 'staff' || acct.role === 'lecturer' || MANAGER_LIKE_ROLES.has(acct.role)) {
      db.staff.push({ staff_id: nextId('staff'), user_id: user.user_id, department_or_school: department });
    }

    if (!usersByDepartment.has(department)) usersByDepartment.set(department, []);
    usersByDepartment.get(department).push(user);
  }

  for (const [department, users] of usersByDepartment.entries()) {
    const code = slugify(department).slice(0, 20).toUpperCase();
    const hosHod = users.find((u) => u.role === 'hos-hod');
    db.unit.push({ code, description: department, head_user_id: hosHod ? hosHod.user_id : null, is_active: true });
    for (const user of users) db.unit_users.push({ user_id: user.user_id, unit_code: code });
  }
}

function seedCafeteriaDomain() {
  const cafeteria1 = { cafeteria_id: nextId('cafeteria'), name: 'Atrium Cafeteria', active: true };
  const cafeteria2 = { cafeteria_id: nextId('cafeteria'), name: 'Level 3 Food Court', active: true };
  db.cafeteria.push(cafeteria1, cafeteria2);

  const cafeteriaManager = db.users.find((u) => u.role === 'cafeteria-manager');
  const cafeteriaStaffUsers = db.users.filter((u) => u.role === 'cafeteria-staff');
  const cafeteriaAdmin = db.users.find((u) => u.role === 'cafeteria-admin');

  if (cafeteriaManager) {
    db.cafeteria_assignment.push(
      { cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria1.cafeteria_id, user_id: cafeteriaManager.user_id, assignment_role: 'manager', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() },
      { cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria2.cafeteria_id, user_id: cafeteriaManager.user_id, assignment_role: 'manager', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() },
    );
  }
  for (const staff of cafeteriaStaffUsers) {
    db.cafeteria_assignment.push({ cafeteria_assignment_id: nextId('cafeteria_assignment'), cafeteria_id: cafeteria1.cafeteria_id, user_id: staff.user_id, assignment_role: 'staff', assigned_by_user_id: cafeteriaAdmin ? cafeteriaAdmin.user_id : null, assigned_at: new Date().toISOString() });
  }
}

function seedCategoriesAndRequirements() {
  const categoryNames = ['Academic & Career', 'Workshops & Training', 'Sports & Wellness', 'Culture & Community', 'Clubs & Societies', 'Entertainment & Social', 'Volunteering'];
  for (const name of categoryNames) db.event_category.push({ event_category_id: nextId('event_category'), name, active: true });

  const requirementNames = ['logistics', 'transportation', 'photoVideo', 'soundLight', 'fmb', 'campusTour', 'fundingPurchase'];
  for (const name of requirementNames) db.event_requirements.push({ requirement_id: nextId('event_requirements'), requirement_name: name });
}

function seedConfigValues() {
  db.config.push(
    { code: 'HIGH_PAX_THRESHOLD', number: 50 },
    { code: 'CANCELLATION_DEADLINE_DAYS', number: 3 },
    { code: 'MAX_EVENT_CATEGORIES', number: 2 },
  );
}

function seedDropdownOptions() {
  const requirementId = (name) => db.event_requirements.find((r) => r.requirement_name === name).requirement_id;

  db.logistics_options.push(
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Registration table', description: 'For guest registration and check-in.', active: true, available_quantity: 1, quantity_unit: 'table', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Registration Table</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Chairs', description: null, active: true, available_quantity: 200, quantity_unit: 'chair', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Event Chairs</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Banquet tables', description: null, active: true, available_quantity: 20, quantity_unit: 'table', item_image_url: null },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Directional standees', description: null, active: true, available_quantity: 10, quantity_unit: 'standee', item_image_url: null },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Stage riser', description: null, active: true, available_quantity: 4, quantity_unit: 'section', item_image_url: null },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Queue barriers', description: null, active: true, available_quantity: 16, quantity_unit: 'barrier', item_image_url: null },
  );

  db.transportation_options.push(
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'University van', description: null, active: true, passenger_capacity: 10, available_vehicle_count: 3, instructions: null, vehicle_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23ebf8ff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">University Van</text></svg>' },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Chartered bus', description: null, active: true, passenger_capacity: 44, available_vehicle_count: 2, instructions: null, vehicle_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23e6fffa"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23234e52">Chartered Bus</text></svg>' },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Grab voucher', description: 'Capacity is per vehicle.', active: true, passenger_capacity: 4, available_vehicle_count: 20, instructions: null, vehicle_image_url: null },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'VIP car', description: null, active: true, passenger_capacity: 4, available_vehicle_count: 2, instructions: null, vehicle_image_url: null },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Airport pickup', description: null, active: true, passenger_capacity: 6, available_vehicle_count: 2, instructions: null, vehicle_image_url: null },
  );

  db.media_options.push(
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photographer', description: null, active: true, max_personnel: 4 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Videographer', description: null, active: true, max_personnel: 4 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photo and video team', description: null, active: true, max_personnel: 8 },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Livestream support', description: null, active: true, max_personnel: 5 },
  );

  db.sound_light_options.push(
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Wireless microphone', description: null, active: true, available_quantity: 12, technical_description: 'Handheld or lapel, standard venue setup.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'PA system', description: null, active: true, available_quantity: 4, technical_description: 'Standard public-address setup for mid-size venues.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Projector support', description: null, active: true, available_quantity: 8, technical_description: 'Includes screen and standard HDMI/VGA connectors.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Stage lighting', description: null, active: true, available_quantity: 3, technical_description: 'Basic wash and spot lighting rig.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'LED screen', description: null, active: true, available_quantity: 2, technical_description: 'Modular LED wall panels, setup crew required.' },
  );

  const servingUnitIdMap = {};
  for (const [oldId, label, description] of [['serving-pax', 'Per pax', 'One serving for one person.'], ['serving-set', 'Per set', null], ['serving-tray', 'Per tray', null], ['serving-piece', 'Per piece', null], ['serving-bottle', 'Per bottle', null]]) {
    const row = { serving_unit_option_id: nextId('serving_unit_options'), label, description, active: true };
    db.serving_unit_options.push(row);
    servingUnitIdMap[oldId] = row.serving_unit_option_id;
  }

  const dietaryIdMap = {};
  for (const [oldId, label, description] of [['dietary-standard', 'Standard menu', 'No special dietary classification.'], ['dietary-vegetarian', 'Vegetarian', null], ['dietary-vegan', 'Vegan', null], ['dietary-gluten-free', 'Gluten-free', null], ['dietary-allergen-aware', 'Allergen-aware', 'Confirm the specific allergen requirements before ordering.']]) {
    const row = { dietary_information_option_id: nextId('dietary_information_options'), label, description, active: true };
    db.dietary_information_options.push(row);
    dietaryIdMap[oldId] = row.dietary_information_option_id;
  }

  const fmbSeeds = [
    ['food-lunch', 'Lunch', 'serving-pax', 'dietary-standard'],
    ['food-dinner', 'Dinner', 'serving-pax', 'dietary-standard'],
    ['food-refreshments', 'Refreshments', 'serving-pax', 'dietary-standard'],
    ['food-coffee-tea', 'Coffee / Tea', 'serving-pax', 'dietary-standard'],
    ['food-buffet', 'Buffet', 'serving-pax', 'dietary-standard'],
    ['food-other', 'Other', null, null],
  ];
  fmbSeeds.forEach(([, label, servingKey, dietaryKey], index) => {
    db.fmb_options.push({
      fmb_option_id: nextId('fmb_options'),
      requirement_id: requirementId('fmb'),
      cafeteria_id: db.cafeteria[index % db.cafeteria.length].cafeteria_id,
      label,
      description: null,
      active: true,
      serving_unit_option_id: servingKey ? servingUnitIdMap[servingKey] : servingUnitIdMap['serving-pax'],
      dietary_information_option_id: dietaryKey ? dietaryIdMap[dietaryKey] : dietaryIdMap['dietary-standard'],
      availability_ordering_notes: null,
      menu_image_url: null,
    });
  });

  db.campus_tour_start_options.push(
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Main Lobby', description: null, active: true, meeting_instructions: 'Meet beside the reception desk.', max_group_size: 30 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Atrium', description: null, active: true, meeting_instructions: null, max_group_size: 50 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Admissions Office', description: null, active: true, meeting_instructions: null, max_group_size: 20 },
    { campus_tour_start_option_id: nextId('campus_tour_start_options'), requirement_id: requirementId('campusTour'), label: 'Library Entrance', description: null, active: true, meeting_instructions: null, max_group_size: 25 },
  );

  const bottleCounts = [24, 48, 96, 120];
  for (const count of bottleCounts) {
    db.water_logo_options.push({ water_logo_option_id: nextId('water_logo_options'), requirement_id: requirementId('fmb'), label: `${count} bottles`, description: null, active: true, number_of_bottles: count, available_stock: 500, logo_branding_requirement: 'APU logo artwork is required.', lead_time_ordering_instructions: null });
  }
  db.water_logo_options.push({ water_logo_option_id: nextId('water_logo_options'), requirement_id: requirementId('fmb'), label: 'Custom quantity', description: null, active: true, number_of_bottles: 0, available_stock: 500, logo_branding_requirement: 'APU logo artwork is required.', lead_time_ordering_instructions: null });

  for (const count of bottleCounts) {
    db.water_normal_options.push({ water_normal_option_id: nextId('water_normal_options'), requirement_id: requirementId('fmb'), label: `${count} bottles`, description: null, active: true, number_of_bottles: count, available_stock: 500, ordering_delivery_instructions: null });
  }
  db.water_normal_options.push({ water_normal_option_id: nextId('water_normal_options'), requirement_id: requirementId('fmb'), label: 'Custom quantity', description: null, active: true, number_of_bottles: 0, available_stock: 500, ordering_delivery_instructions: null });

  const fundingMainIdMap = {};
  for (const [oldId, label, financeCode] of [['fund-main-printing', 'Printing and materials', 'PRINT'], ['fund-main-venue', 'Venue setup', 'VENUE'], ['fund-main-honorarium', 'Honorarium', 'HON'], ['fund-main-external', 'External service', 'EXT'], ['fund-main-supplies', 'Event supplies', 'SUP']]) {
    const row = { funding_main_option_id: nextId('funding_main_options'), requirement_id: requirementId('fundingPurchase'), label, description: null, active: true, budget_category_finance_code: financeCode, purchasing_guidance: null };
    db.funding_main_options.push(row);
    fundingMainIdMap[oldId] = row.funding_main_option_id;
  }

  const fundingSubSeeds = [
    ['Posters and flyers', 'fund-main-printing'], ['Certificates', 'fund-main-printing'], ['Name tags', 'fund-main-printing'], ['Programme booklets', 'fund-main-printing'],
    ['Furniture rental', 'fund-main-venue'], ['Decorations', 'fund-main-venue'], ['Backdrop production', 'fund-main-venue'], ['Booth setup', 'fund-main-venue'],
    ['Guest speaker', 'fund-main-honorarium'], ['Facilitator', 'fund-main-honorarium'], ['Performer', 'fund-main-honorarium'], ['External judge', 'fund-main-honorarium'],
    ['Security service', 'fund-main-external'], ['Cleaning service', 'fund-main-external'], ['Medical support', 'fund-main-external'], ['Technical contractor', 'fund-main-external'],
    ['Participant kits', 'fund-main-supplies'], ['Stationery', 'fund-main-supplies'], ['Prizes and tokens', 'fund-main-supplies'], ['Consumable supplies', 'fund-main-supplies'],
  ];
  for (const [label, parentOldId] of fundingSubSeeds) {
    db.funding_sub_options.push({ funding_sub_option_id: nextId('funding_sub_options'), main_option_id: fundingMainIdMap[parentOldId], label, description: null, active: true, finance_procurement_code: null, default_unit_purchasing_note: null });
  }
}

function seedFresh() {
  resetCounters();
  seedUsersAndUnits();
  seedCafeteriaDomain();
  seedCategoriesAndRequirements();
  seedConfigValues();
  seedDropdownOptions();
  // Inbox/Ongoing/History/Drafts/Explore Events intentionally start empty — no proposals,
  // registrations, tasks, or workflow history are seeded. Only what's submitted through the
  // app itself (real HTTP requests hitting server/routes/*) will ever populate those tables.
}

workflowService.init(db, nextId);

if (fs.existsSync(DB_FILE)) {
  loadFromDisk();
} else {
  seedFresh();
  saveDb();
}

module.exports = { db, nextId, TABLE_NAMES, saveDb };
