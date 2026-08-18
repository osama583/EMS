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
const { deriveUnitCode, deriveCafeteriaUnitCode, isCafeteriaUnitCode } = require('./services/unit-code');
const { resolveSeedIcon } = require('./services/seed-icons');

const TABLE_NAMES = [
  // Identity & Organization
  'users', 'staff', 'student', 'external_user_profile', 'unit', 'role', 'role_unit', 'user_unit_roles',
  'nav_page', 'nav_page_grants',
  'clubs', 'club_categories', 'club_category_links', 'club_members', 'club_join_requests',
  // Cafeteria Domain: a Cafeteria is a `unit` row (CAFETERIA_UNIT_PREFIX-coded), staffed via
  // `user_unit_roles` (cafeteria-manager/cafeteria-staff) — no dedicated table (see
  // seedCafeteriaDomain()'s comment). cafeteria_staff_requests IS its own table — a Cafeteria
  // Manager cannot write user_unit_roles directly, every add/edit/remove of their own cafeteria's
  // staff is an approval request for Cafeteria Admin first (see cafeterias.routes.js's
  // /staff-requests section), same status/resolved_at/resolved_by_user_id shape as
  // club_join_requests above.
  'cafeteria_staff_requests',
  // Categories & Requirements
  'event_category', 'event_requirements', 'event_format',
  // Manager-Configured Options
  'logistics_options', 'transportation_options', 'media_options', 'sound_light_options',
  'dietary_information_options', 'serving_unit_options', 'fmb_options',
  'campus_tour_start_options', 'campus_tour_type_options', 'water_normal_options',
  'funding_main_options', 'funding_sub_options',
  // Config
  'config',
  // Request Core
  'request', 'request_categories', 'application_requirements',
  // Request-Specific Department Data (snapshots)
  'request_logistics', 'request_transportation', 'request_photography_videography',
  'request_sound_light', 'request_fmb', 'request_fmb_selection', 'request_campus_tour',
  'request_mineral_water', 'request_funding_purchase',
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

// RBAC redesign (2026-08-13): identity is now `users` (name/username/email/password/is_active
// only) + `user_unit_roles` rows. Each seed account lists one or more {roleCode, unitDept?}
// entries — unitDept is the Unit's description (School or Service department); omitted for flat
// roles (cfo/cafeteria-admin/system-admin/external-user). See role-eligibility.service.js for
// the 9 protected role definitions seeded below by seedRoles().
const SEED_ACCOUNTS = [
  { email: 'applicant@demo.apu.edu.my', displayName: 'Applicant Demo', assignments: [{ roleCode: 'student', unitDept: 'School of Computing' }] },
  { email: 'hoshod@demo.apu.edu.my', displayName: 'HOS / HOD Demo', assignments: [{ roleCode: 'head-of-school', unitDept: 'School of Computing' }] },
  { email: 'cfo@demo.apu.edu.my', displayName: 'CFO Demo', assignments: [{ roleCode: 'cfo' }] },
  { email: 'fmb@demo.apu.edu.my', displayName: 'F&B Demo', assignments: [{ roleCode: 'head-of-department', unitDept: 'Food & Beverage Services' }] },
  { email: 'fmb.staff@demo.apu.edu.my', displayName: 'F&B Staff Demo', assignments: [{ roleCode: 'staff', unitDept: 'Food & Beverage Services' }] },
  // cafeteria-manager/cafeteria-staff are unit-linked roles, but the cafeteria units they'll be
  // linked to don't exist yet at this point in seeding (units are created by
  // seedCafeteriaDomain(), which runs after seedUsersAndUnits()) — assigned here with
  // unit_code=null (same as any flat role), then seedCafeteriaDomain() repoints these rows onto
  // real cafeteria unit codes once those units exist.
  { email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager Demo', assignments: [{ roleCode: 'cafeteria-manager' }] },
  { email: 'cafeteria.staff@demo.apu.edu.my', displayName: 'Cafeteria Staff', assignments: [{ roleCode: 'cafeteria-staff' }] },
  { email: 'cafeteria.admin@demo.apu.edu.my', displayName: 'Cafeteria Admin', assignments: [{ roleCode: 'cafeteria-admin' }] },
  { email: 'logistics.manager@demo.apu.edu.my', displayName: 'Logistics Manager', assignments: [{ roleCode: 'head-of-department', unitDept: 'Logistics and Facilities' }] },
  { email: 'logistics.staff@demo.apu.edu.my', displayName: 'Ahmad (Logistics Staff)', assignments: [{ roleCode: 'staff', unitDept: 'Logistics and Facilities' }] },
  { email: 'logistics.staff2@demo.apu.edu.my', displayName: 'David Tan (Logistics Tech)', assignments: [{ roleCode: 'staff', unitDept: 'Logistics and Facilities' }] },
  { email: 'logistics.staff3@demo.apu.edu.my', displayName: 'Sarah Lee (Logistics Assistant)', assignments: [{ roleCode: 'staff', unitDept: 'Logistics and Facilities' }] },
  { email: 'student.services.manager@demo.apu.edu.my', displayName: 'Student Services Manager', assignments: [{ roleCode: 'head-of-department', unitDept: 'Student Services' }] },
  { email: 'student.services.member@demo.apu.edu.my', displayName: 'Priyah (Student Services Member)', assignments: [{ roleCode: 'staff', unitDept: 'Student Services' }] },
  { email: 'student.services.member2@demo.apu.edu.my', displayName: 'Jason Lim (Campus Tour Guide)', assignments: [{ roleCode: 'staff', unitDept: 'Student Services' }] },
  { email: 'student.services.member3@demo.apu.edu.my', displayName: 'Chloe Tan (Student Ambassador)', assignments: [{ roleCode: 'staff', unitDept: 'Student Services' }] },
  { email: 'av.manager@demo.apu.edu.my', displayName: 'A/V Manager', assignments: [{ roleCode: 'head-of-department', unitDept: 'A/V Services' }] },
  { email: 'av.technician@demo.apu.edu.my', displayName: 'Marcus Vance (Senior A/V Tech)', assignments: [{ roleCode: 'staff', unitDept: 'A/V Services' }] },
  { email: 'av.technician2@demo.apu.edu.my', displayName: 'Ethan Wong (Sound Engineer)', assignments: [{ roleCode: 'staff', unitDept: 'A/V Services' }] },
  { email: 'av.technician3@demo.apu.edu.my', displayName: 'Nurul Huda (Lighting Specialist)', assignments: [{ roleCode: 'staff', unitDept: 'A/V Services' }] },
  { email: 'photography.manager@demo.apu.edu.my', displayName: 'Photography Manager', assignments: [{ roleCode: 'head-of-department', unitDept: 'Photography Services' }] },
  { email: 'photographer@demo.apu.edu.my', displayName: 'Alex Rivera (Photographer)', assignments: [{ roleCode: 'staff', unitDept: 'Photography Services' }] },
  { email: 'photographer2@demo.apu.edu.my', displayName: 'Samantha Ong (Videographer)', assignments: [{ roleCode: 'staff', unitDept: 'Photography Services' }] },
  { email: 'transport.manager@demo.apu.edu.my', displayName: 'Transport Manager', assignments: [{ roleCode: 'head-of-department', unitDept: 'Transport Services' }] },
  { email: 'transport.staff@demo.apu.edu.my', displayName: 'Captain Bob (Transport Driver)', assignments: [{ roleCode: 'staff', unitDept: 'Transport Services' }] },
  { email: 'transport.staff2@demo.apu.edu.my', displayName: 'Harish Kumar (Fleet Coordinator)', assignments: [{ roleCode: 'staff', unitDept: 'Transport Services' }] },
  { email: 'system.admin@demo.apu.edu.my', displayName: 'System Admin', assignments: [{ roleCode: 'system-admin' }] },
  { email: 'aina.rahman@student.apu.edu.my', displayName: 'Aina Rahman', assignments: [{ roleCode: 'student', unitDept: 'School of Computing' }] },
  { email: 'daniel.wong@student.apu.edu.my', displayName: 'Daniel Wong', assignments: [{ roleCode: 'student', unitDept: 'School of Business' }] },
  { email: 'mei.ling.tan@student.apu.edu.my', displayName: 'Mei Ling Tan', assignments: [{ roleCode: 'student', unitDept: 'School of Computing' }] },
  // jordan.lee: holds the 'club-admin' flat role (system-wide club management), granted below in
  // seedClubsDemo() once db.role exists — kept role-less here since it's assigned after seeding.
  // farah.izzati: deliberately left WITHOUT any assignment (a genuinely roleless account can no
  // longer log in — see auth.routes.js's POST /login — so this is now purely a "not yet
  // onboarded" fixture, not a usable demo account).
  { email: 'jordan.lee@staff.apu.edu.my', displayName: 'Jordan Lee', assignments: [] },
  { email: 'farah.izzati@staff.apu.edu.my', displayName: 'Farah Izzati', assignments: [] },
  { email: 'cafeteria.staff2@demo.apu.edu.my', displayName: 'Cafeteria Staff Two', assignments: [{ roleCode: 'cafeteria-staff' }] },
  // NOTE (flagged in the end-of-session summary): the pre-redesign seed data already had TWO
  // head-of-school-equivalent accounts on School of Computing (hoshod@ above, and this one) and
  // on School of Business (hos.business@ below duplicates hoshod-equivalent status with
  // hos.computing's pattern) — that's now illegal under the new one-head-per-unit rule. Demoted
  // this account to 'lecturer' on the same unit rather than silently dropping its identity；an
  // admin should review whether hoshod@ or hos.computing@ is the "real" head going forward.
  { email: 'hos.computing@demo.apu.edu.my', displayName: 'Dr. Wei Chen (HOS, School of Computing)', assignments: [{ roleCode: 'lecturer', unitDept: 'School of Computing' }] },
  { email: 'student.computing@demo.apu.edu.my', displayName: 'Aina Rahman (Computing Student)', assignments: [{ roleCode: 'student', unitDept: 'School of Computing' }] },
  { email: 'student.computing2@demo.apu.edu.my', displayName: 'Mei Ling Tan (Computing Student)', assignments: [{ roleCode: 'student', unitDept: 'School of Computing' }] },
  { email: 'lecturer.computing@demo.apu.edu.my', displayName: 'Dr. Kumar Selvam (Computing Lecturer)', assignments: [{ roleCode: 'lecturer', unitDept: 'School of Computing' }] },
  { email: 'hos.business@demo.apu.edu.my', displayName: 'Dr. Farah Aziz (HOS, School of Business)', assignments: [{ roleCode: 'head-of-school', unitDept: 'School of Business' }] },
  { email: 'student.business@demo.apu.edu.my', displayName: 'Daniel Wong (Business Student)', assignments: [{ roleCode: 'student', unitDept: 'School of Business' }] },
  { email: 'lecturer.business@demo.apu.edu.my', displayName: 'Dr. Siti Nurhaliza (Business Lecturer)', assignments: [{ roleCode: 'lecturer', unitDept: 'School of Business' }] },
  // Marketing/Finance are neither a School nor one of the 6 Service departments — no unit
  // exists for them, so these accounts intentionally get no unit-scoped assignment (matches the
  // prior model's "flag rather than guess" precedent).
  { email: 'hod.marketing@demo.apu.edu.my', displayName: 'Encik Razif Hassan (HOD, Marketing)', assignments: [] },
  { email: 'staff.marketing@demo.apu.edu.my', displayName: 'Nurul Huda (Marketing Staff)', assignments: [] },
  { email: 'staff.marketing2@demo.apu.edu.my', displayName: 'Jordan Lee (Marketing Staff)', assignments: [] },
  { email: 'hod.finance@demo.apu.edu.my', displayName: 'Puan Aishah Karim (HOD, Finance)', assignments: [] },
  { email: 'staff.finance@demo.apu.edu.my', displayName: 'Farah Izzati (Finance Staff)', assignments: [] },
];

function splitName(displayName) {
  const parenIndex = displayName.indexOf('(');
  const cleaned = parenIndex >= 0 ? displayName.slice(0, parenIndex).trim() : displayName;
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// lowercase_with_underscores, no truncation — shared with admin.routes.js via
// services/unit-code.js (also reused for role_code and nav page_code derivation) so every
// caller derives codes identically.
const slugify = deriveUnitCode;

const { PROTECTED_ROLES } = require('./services/role-eligibility.service');

function seedRoles() {
  for (const role of PROTECTED_ROLES) {
    db.role.push({ ...role, is_protected: true, is_active: true, archived_at: null });
  }
}

// Reproduces the pre-refactor is_unit_scoped/unit_eligibility behavior as real role_unit rows,
// once units exist (called after seedUsersAndUnits()). head-of-school/lecturer/student were
// 'school'-eligible, head-of-department was 'non_school'-eligible, staff was eligible on any
// unit — see the deleted category fields' history in role-eligibility.service.js.
function seedRoleUnits() {
  const schoolUnits = db.unit.filter((u) => u.code.includes('school')).map((u) => u.code);
  const nonSchoolUnits = db.unit.filter((u) => !u.code.includes('school')).map((u) => u.code);
  const allUnits = db.unit.map((u) => u.code);
  const link = (roleCode, unitCode) => db.role_unit.push({ role_code: roleCode, unit_code: unitCode });
  for (const code of schoolUnits) { link('head-of-school', code); link('lecturer', code); link('student', code); }
  for (const code of nonSchoolUnits) link('head-of-department', code);
  for (const code of allUnits) link('staff', code);
}

// Unit-scoped role codes at seed time (derived from the role_unit rows seedRoleUnits() just
// created) — used only by seedNavPages()'s grantAnyUnit() to decide how to split a mixed role
// list into 'role' (flat) vs 'unit'/'unit_role' grant rows.
function unitScopedRoleCodesAtSeed() {
  return new Set(db.role_unit.map((ru) => ru.role_code));
}

function seedUsersAndUnits() {
  const unitsByDescription = new Map(); // description -> unit_code, created on first sight

  function ensureUnit(description) {
    if (unitsByDescription.has(description)) return unitsByDescription.get(description);
    const code = slugify(description);
    db.unit.push({ code, description, is_active: true, archived_at: null });
    unitsByDescription.set(description, code);
    return code;
  }

  for (const acct of SEED_ACCOUNTS) {
    const { firstName, lastName } = splitName(acct.displayName);
    const user = {
      user_id: nextId('users'),
      full_name: `${firstName} ${lastName}`.trim(),
      username: acct.email.split('@')[0],
      email: acct.email,
      password: 'Demo@123',
      is_active: true,
    };
    db.users.push(user);

    let studentSchool;
    let staffDepartment;
    for (const assignment of acct.assignments) {
      const unitCode = assignment.unitDept ? ensureUnit(assignment.unitDept) : null;
      db.user_unit_roles.push({
        user_unit_role_id: nextId('user_unit_roles'),
        user_id: user.user_id,
        unit_code: unitCode,
        role_code: assignment.roleCode,
        assigned_at: new Date().toISOString(),
      });
      if (assignment.roleCode === 'student') studentSchool = assignment.unitDept;
      if (['head-of-school', 'head-of-department', 'lecturer', 'staff'].includes(assignment.roleCode)) staffDepartment = assignment.unitDept;
    }

    // staff/student legacy extension tables — still consulted by user-access.service.js's
    // departmentFor() as an override before falling back to the unit-role-derived description.
    if (studentSchool) db.student.push({ student_id: nextId('student'), user_id: user.user_id, school: studentSchool });
    else if (staffDepartment) db.staff.push({ staff_id: nextId('staff'), user_id: user.user_id, department_or_school: staffDepartment });
  }
}

// 2026-08-17 Cafeteria refactor: a Cafeteria is now a Unit (unit.code prefixed with
// CAFETERIA_UNIT_PREFIX so Manage Cafeterias/Staff Assignments can list only cafeteria units —
// see services/unit-code.js's isCafeteriaUnitCode()), and "who manages/staffs which cafeteria"
// is a real role_unit + user_unit_roles fact (cafeteria-manager/cafeteria-staff linked to that
// specific cafeteria unit), not a separate cafeteria/cafeteria_assignment table. This replaces
// the old numeric cafeteria_id model everywhere it appeared (fmb_options.unit_code,
// request_fmb_selection.unit_code, staff-tasks shared-inbox routing, auth.routes.js's
// cafeteriaId resolution). F&B head-of-department's food-request REVIEW workflow (fmb/
// waterNormal request kinds, dropdown-option management) is unrelated and unchanged — it still
// owns the food_beverage_services unit, not any cafeteria unit.
function seedCafeteriaDomain() {
  const cafeteria1Code = deriveCafeteriaUnitCode('Atrium Cafeteria');
  const cafeteria2Code = deriveCafeteriaUnitCode('Level 3 Food Court');
  db.unit.push(
    { code: cafeteria1Code, description: 'Atrium Cafeteria', is_active: true, archived_at: null },
    { code: cafeteria2Code, description: 'Level 3 Food Court', is_active: true, archived_at: null },
  );

  // role_unit rows for both cafeteria units — makes cafeteria-manager/cafeteria-staff genuinely
  // unit-linked roles the moment the units exist, matching seedRoleUnits()'s pattern for the
  // other protected roles.
  db.role_unit.push(
    { role_code: 'cafeteria-manager', unit_code: cafeteria1Code }, { role_code: 'cafeteria-manager', unit_code: cafeteria2Code },
    { role_code: 'cafeteria-staff', unit_code: cafeteria1Code }, { role_code: 'cafeteria-staff', unit_code: cafeteria2Code },
  );

  // SEED_ACCOUNTS' cafeteria-manager/cafeteria-staff demo accounts were assigned with
  // unit_code=null (cafeteria units didn't exist yet at that point in seeding) — repoint those
  // rows onto Atrium Cafeteria now that it exists, rather than deleting + re-inserting, so the
  // row's identity/assigned_at stays stable.
  for (const row of db.user_unit_roles) {
    if ((row.role_code === 'cafeteria-manager' || row.role_code === 'cafeteria-staff') && !row.unit_code) {
      row.unit_code = cafeteria1Code;
    }
  }
}

function seedCategoriesAndRequirements() {
  const categoryNames = ['Academic & Career', 'Workshops & Training', 'Sports & Wellness', 'Culture & Community', 'Clubs & Societies', 'Entertainment & Social', 'Volunteering'];
  for (const name of categoryNames) db.event_category.push({ event_category_id: nextId('event_category'), name, code: deriveUnitCode(name), active: true, archived_at: null });

  const requirementNames = ['logistics', 'transportation', 'photoVideo', 'soundLight', 'fmb', 'campusTour', 'waterNormal', 'fundingPurchase'];
  for (const name of requirementNames) db.event_requirements.push({ requirement_id: nextId('event_requirements'), requirement_name: name });

  // Previously hardcoded in the Angular proposal form's Event Format dropdown — now an
  // admin-managed, id-backed lookup list (see routes/event-catalog.routes.js), same shape as
  // event_category above: code is server-derived via deriveUnitCode() (same slug convention as
  // unit.code/role.role_code/nav_page.page_code), archived_at powers the shared 7-day soft-delete.
  const eventFormatNames = ['On Campus', 'Online', 'Hybrid', 'Off Campus'];
  for (const name of eventFormatNames) db.event_format.push({ event_format_id: nextId('event_format'), name, code: deriveUnitCode(name), active: true, archived_at: null });
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
  const cafeteriaUnitCodes = db.unit.filter((u) => isCafeteriaUnitCode(u.code)).map((u) => u.code);

  db.logistics_options.push(
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Registration table', description: 'For guest registration and check-in.', active: true, available_quantity: 1, quantity_unit: 'table', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Registration Table</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Chairs', description: null, active: true, available_quantity: 200, quantity_unit: 'chair', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23edf2f7"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">Event Chairs</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Banquet tables', description: null, active: true, available_quantity: 20, quantity_unit: 'table', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23fff5eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23b45309">Banquet Tables</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Directional standees', description: null, active: true, available_quantity: 10, quantity_unit: 'standee', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23f3f0ff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%235b21b6">Directional Standees</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Stage riser', description: null, active: true, available_quantity: 4, quantity_unit: 'section', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23fef2f2"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23b91c1c">Stage Riser</text></svg>' },
    { logistics_option_id: nextId('logistics_options'), requirement_id: requirementId('logistics'), label: 'Queue barriers', description: null, active: true, available_quantity: 16, quantity_unit: 'barrier', item_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23f0fdf4"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23166534">Queue Barriers</text></svg>' },
  );

  db.transportation_options.push(
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'University van', description: null, active: true, passenger_capacity: 10, available_vehicle_count: 3, instructions: null, vehicle_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23ebf8ff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%232b6cb0">University Van</text></svg>' },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Chartered bus', description: null, active: true, passenger_capacity: 44, available_vehicle_count: 2, instructions: null, vehicle_image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23e6fffa"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="%23234e52">Chartered Bus</text></svg>' },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Grab voucher', description: 'Capacity is per vehicle.', active: true, passenger_capacity: 4, available_vehicle_count: 20, instructions: null, vehicle_image_url: null },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'VIP car', description: null, active: true, passenger_capacity: 4, available_vehicle_count: 2, instructions: null, vehicle_image_url: null },
    { transportation_option_id: nextId('transportation_options'), requirement_id: requirementId('transportation'), label: 'Airport pickup', description: null, active: true, passenger_capacity: 6, available_vehicle_count: 2, instructions: null, vehicle_image_url: null },
  );

  db.media_options.push(
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photographer', description: null, active: true },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Videographer', description: null, active: true },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Photo and video team', description: null, active: true },
    { media_option_id: nextId('media_options'), requirement_id: requirementId('photoVideo'), label: 'Livestream support', description: null, active: true },
  );

  db.sound_light_options.push(
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Wireless microphone', description: null, active: true, technical_description: 'Handheld or lapel, standard venue setup.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'PA system', description: null, active: true, technical_description: 'Standard public-address setup for mid-size venues.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Projector support', description: null, active: true, technical_description: 'Includes screen and standard HDMI/VGA connectors.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'Stage lighting', description: null, active: true, technical_description: 'Basic wash and spot lighting rig.' },
    { sound_light_option_id: nextId('sound_light_options'), requirement_id: requirementId('soundLight'), label: 'LED screen', description: null, active: true, technical_description: 'Modular LED wall panels, setup crew required.' },
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
      unit_code: cafeteriaUnitCodes[index % cafeteriaUnitCodes.length],
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

  db.campus_tour_type_options.push(
    { campus_tour_type_option_id: nextId('campus_tour_type_options'), requirement_id: requirementId('campusTour'), label: 'General Campus Tour', description: 'Standard walk-through of main campus facilities.', active: true },
    { campus_tour_type_option_id: nextId('campus_tour_type_options'), requirement_id: requirementId('campusTour'), label: 'Faculty-Focused Tour', description: 'Tour tailored to a specific faculty/school’s facilities.', active: true },
    { campus_tour_type_option_id: nextId('campus_tour_type_options'), requirement_id: requirementId('campusTour'), label: 'Open Day Tour', description: 'Larger-group tour used for open day / admissions events.', active: true },
    { campus_tour_type_option_id: nextId('campus_tour_type_options'), requirement_id: requirementId('campusTour'), label: 'VIP / Guest Tour', description: 'Smaller, escorted tour for VIP guests or delegations.', active: true },
  );

  // Merged catalog — Mineral Water with Logo and Mineral Water Normal used to be two separate
  // tables/admin pages; now there's one water_normal_options table and applicants toggle
  // "With Logo?" on their single Mineral Water request instead of picking a separate option
  // kind. logo_branding_requirement carries over as optional guidance shown when relevant.
  const bottleCounts = [24, 48, 96, 120];
  for (const count of bottleCounts) {
    db.water_normal_options.push({ water_normal_option_id: nextId('water_normal_options'), requirement_id: requirementId('waterNormal'), label: `${count} bottles`, description: null, active: true, number_of_bottles: count, available_stock: 500, ordering_delivery_instructions: null, logo_branding_requirement: 'APU logo artwork is required if requesting bottles with a logo.' });
  }
  db.water_normal_options.push({ water_normal_option_id: nextId('water_normal_options'), requirement_id: requirementId('waterNormal'), label: 'Custom quantity', description: null, active: true, number_of_bottles: 0, available_stock: 500, ordering_delivery_instructions: null, logo_branding_requirement: 'APU logo artwork is required if requesting bottles with a logo.' });

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

// Deliberate, narrow exception to the "no proposals are seeded" rule below: the Logistics
// availability feature (logistics-availability.service.js) has nothing to compute against on a
// fresh boot otherwise, since it reads committed request_logistics rows on completed_approved
// requests. Builds two fully-formed, already-completed requests directly (bypassing
// submitProposal()'s review workflow — these are static historical data, not proposals someone
// is meant to review) so the feature is demonstrable/testable immediately: both book "Chairs"
// (available_quantity 200) on the same date with overlapping windows.
function seedLogisticsAvailabilityDemo() {
  const applicant = db.users.find((u) => u.email === 'applicant@demo.apu.edu.my');
  const chairs = db.logistics_options.find((o) => o.label === 'Chairs');
  if (!applicant || !chairs) return;
  const optionId = `logistics:${chairs.logistics_option_id}`;
  const logisticsRequirementId = db.event_requirements.find((r) => r.requirement_name === 'logistics').requirement_id;

  // Chosen so a 40-chair request for a window overlapping both bookings sees only 25 remaining
  // (200 available - 100 - 75), matching the worked example in the feature spec: A frees 100
  // chairs at its buffered end (10:15), which alone is enough to cover 40 more (25 + 100 = 125).
  const bookings = [
    { title: 'APU Founders Day Dinner', start: '08:00', end: '10:00', quantity: 100 },
    { title: 'Faculty Townhall', start: '09:00', end: '11:00', quantity: 75 },
  ];
  const date = '2026-09-15';
  const onCampusFormat = db.event_format.find((f) => f.name === 'On Campus');

  for (const booking of bookings) {
    const requestId = nextId('request');
    const request = {
      request_id: requestId,
      request_code: `EVT-DEMO-${requestId}`,
      applicant_user_id: applicant.user_id,
      applicant_name: applicant.full_name,
      applicant_email: applicant.email,
      applicant_department_or_school: 'APU Community',
      event_title: booking.title,
      short_introduction: `${booking.title} — seeded demo event for logistics availability checking.`,
      goals_objectives: 'Demonstrate cross-request Logistics availability.',
      expected_benefits: 'N/A — seed data.',
      event_visibility: 'Private',
      event_format_id: onCampusFormat ? onCampusFormat.event_format_id : null,
      event_format_snapshot: 'On Campus',
      registration_approval: 'Automatic',
      promotion_publicity_method: null,
      event_image: null,
      total_pax: booking.quantity,
      max_pax: null,
      cost_amount: null,
      bank_account_name: null,
      bank_account_number: null,
      status: 'completed_approved',
      submitted_at: new Date().toISOString(),
      cancelled_at: null,
      cancelled_by_user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resume_stage: null,
      reviewer_comment: null,
    };
    db.request.push(request);

    db.application_requirements.push({ request_id: request.request_id, requirement_id: logisticsRequirementId });
    db.event_schedule.push({ event_schedule_id: nextId('event_schedule'), request_id: request.request_id, date, start_time: booking.start, end_time: booking.end, location: 'Main Auditorium' });
    db.request_logistics.push({
      request_logistics_id: nextId('request_logistics'),
      request_id: request.request_id,
      option_id: optionId,
      item: chairs.label,
      quantity: booking.quantity,
      date,
      start_time: booking.start,
      end_time: booking.end,
      location: 'Main Auditorium',
      notes: null,
    });
  }
}

// Demonstrates the fully data-driven club identity model (see ems_database_schema.sql's clubs/
// club_categories/club_members/club_join_requests comment block): Club Admin (system-wide) is the
// 'club-admin' flat role, granted via a normal user_unit_roles row exactly like any other role —
// no bespoke table. Club President stays purely clubs.user_id (per-club, not a role — a club has
// exactly one President). One pending join_request is seeded too, so the Club Inbox has something
// to review on first boot.
function seedClubsDemo() {
  const byEmail = (email) => db.users.find((u) => u.email === email);
  const clubAdminUser = byEmail('jordan.lee@staff.apu.edu.my');
  const csPresident = byEmail('student.computing@demo.apu.edu.my'); // Aina Rahman (Computing Student)
  const businessLecturer = byEmail('lecturer.business@demo.apu.edu.my'); // Dr. Siti Nurhaliza
  const csMember = byEmail('student.computing2@demo.apu.edu.my'); // Mei Ling Tan
  const pendingRequester = byEmail('daniel.wong@student.apu.edu.my'); // Daniel Wong
  if (!clubAdminUser || !csPresident || !businessLecturer) return;

  db.user_unit_roles.push({
    user_unit_role_id: nextId('user_unit_roles'),
    user_id: clubAdminUser.user_id,
    unit_code: null,
    role_code: 'club-admin',
    assigned_at: new Date().toISOString(),
  });

  // Club categories are an admin-managed lookup list (Club Admin creates/edits; a club's
  // President may only pick from it) — same pattern as event_category.
  const categoryNames = ['Technology', 'Business & Entrepreneurship', 'Arts & Culture', 'Sports & Recreation', 'Community Service'];
  const categoryByName = {};
  for (const name of categoryNames) {
    const row = { club_category_id: nextId('club_categories'), name, active: true, created_at: new Date().toISOString() };
    db.club_categories.push(row);
    categoryByName[name] = row.club_category_id;
  }

  const csClub = {
    club_id: nextId('clubs'),
    user_id: csPresident.user_id,
    club_name: 'Computing Society',
    description: 'A club for students passionate about software, hardware, and everything in between — workshops, hackathons, and tech talks all year round.',
    image_url: null,
    created_by_user_id: clubAdminUser.user_id,
    active: true,
    created_at: new Date().toISOString(),
  };
  const businessClub = {
    club_id: nextId('clubs'),
    user_id: businessLecturer.user_id,
    club_name: 'Business & Entrepreneurship Club',
    description: 'Connecting future founders and business leaders through mentorship, case competitions, and networking events.',
    image_url: null,
    created_by_user_id: clubAdminUser.user_id,
    active: true,
    created_at: new Date().toISOString(),
  };
  db.clubs.push(csClub, businessClub);

  // A club may carry 1-3 categories — demo the CS club with two to show multi-category display.
  const linkClubCategories = (clubId, names) => {
    for (const name of names) db.club_category_links.push({ club_id: clubId, club_category_id: categoryByName[name] });
  };
  linkClubCategories(csClub.club_id, ['Technology', 'Community Service']);
  linkClubCategories(businessClub.club_id, ['Business & Entrepreneurship']);

  if (csMember) db.club_members.push({ club_id: csClub.club_id, user_id: csMember.user_id, date_joined: new Date().toISOString().slice(0, 10) });
  if (pendingRequester) {
    db.club_join_requests.push({
      club_join_request_id: nextId('club_join_requests'),
      club_id: csClub.club_id,
      requester_user_id: pendingRequester.user_id,
      reason: 'I love building side projects and want to meet other students who are into software and hardware.',
      status: 'pending',
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by_user_id: null,
    });
  }
}

// Admin-managed sidebar catalog (nav_page/nav_page_grants) — see docs/superpowers/specs/
// 2026-08-13-rbac-role-unit-redesign-design.md's Page Visibility section (and the later
// Permissions-tab redesign, which replaced the single permission_mode column with independently
// typed nav_page_grants rows — see that table's comment in ems_database_schema.sql). Seeded to
// reproduce the app's existing top-level sidebar entries so navigation doesn't regress; does not
// attempt to reproduce every conditional sub-branch the old hardcoded role-navigation.ts had (e.g.
// F&B's extra Cafeteria Menus section) — those can be added as additional nav_page rows by an
// admin through the Page Visibility builder, this is a reasonable-fidelity starting catalog, not a
// pixel-perfect port.
//
// These seeded route_path values are real, hand-wired Angular routes (see app.routes.ts) that
// predate admin.routes.js's route auto-derivation (POST/PUT /nav-pages always force route_path =
// '/app/' + page_code for pages created/edited through the admin UI) — several deliberately do
// NOT follow that pattern (e.g. 'dropdown-logistics' routes to /app/dropdown-options/logistics,
// not /app/dropdown-logistics) because they point at pre-existing, already-built pages. Seeding
// writes route_path directly and is never subject to the admin API's derivation, so this mismatch
// is intentional and permanent for these rows — only pages created through the Page Visibility
// builder itself get the auto-derived /app/<page_code> shape.
function seedNavPages() {
  // One grant row now holds MULTIPLE roles/units (role_codes/unit_codes arrays) instead of a
  // single role_code/unit_code pair — a whole role set ("Head of School, Head of Department") is
  // one row, not one row per role. See nav_page_grants' comment in ems_database_schema.sql.
  function grant(pageCode, type, roleCodes, unitCodes) {
    db.nav_page_grants.push({
      grant_id: nextId('nav_page_grants'), page_code: pageCode, grant_type: type,
      role_codes: roleCodes && roleCodes.length ? roleCodes : [],
      unit_codes: unitCodes && unitCodes.length ? unitCodes : [],
      is_active: true,
    });
  }
  // grantAnyUnit() seeds "this set of roles, unrestricted by unit" — the shape most pages in this
  // catalog want. A single 'role' row can only ever hold FLAT roles (validateGrant() rejects a
  // unit-scoped role there, same rule the Permissions tab's Add Permission modal enforces: you
  // cannot pick e.g. Lecturer under Role only). So a mixed list is split into up to two rows:
  //   - flat roles (cfo, cafeteria-admin, cafeteria-staff, system-admin, ...) -> one 'role' row.
  //   - unit-scoped roles -> if the list includes EVERY unit-scoped role that exists, a 'unit' row
  //     covering every active unit is equivalent (any role in that unit = every unit-scoped role,
  //     since there's nothing left out) and reads better in the Permissions table. If it's only
  //     SOME unit-scoped roles (e.g. just Head of School + Head of Department), 'unit' would wrongly
  //     admit every OTHER unit-scoped role too (Student, Lecturer, Staff) — a real access
  //     broadening, not an equivalent rewording — so that case uses 'unit_role' instead: those
  //     specific roles × every active unit, which preserves the original restriction exactly.
  //     Neither row auto-tracks units created later; a newly added unit needs adding to it same as
  //     any other grant, exactly like an admin would have to via the UI.
  function grantAnyUnit(pageCode, roleCodes) {
    const unitScopedCodes = unitScopedRoleCodesAtSeed();
    const flat = roleCodes.filter((code) => !unitScopedCodes.has(code));
    const unitScoped = roleCodes.filter((code) => unitScopedCodes.has(code));
    if (flat.length) grant(pageCode, 'role', flat);
    if (unitScoped.length === unitScopedCodes.size) {
      grant(pageCode, 'unit', [], allActiveUnitCodes());
    } else if (unitScoped.length) {
      grant(pageCode, 'unit_role', unitScoped, allActiveUnitCodes());
    }
  }
  function allActiveUnitCodes() {
    return db.unit.filter((u) => u.is_active).map((u) => u.code);
  }
  // roleCodes = grantAnyUnit(), i.e. up to a 'role' row (flat roles) + a 'unit' row (unit-scoped
  // roles, any unit) — never a raw 'role' row containing a unit-scoped role (see grantAnyUnit()).
  function page(code, label, icon, routePath, roleCodes, sortOrder) {
    db.nav_page.push({ page_code: code, label, entry_type: 'page', icon: resolveSeedIcon(icon), parent_page_code: null, sort_order: sortOrder, route_path: routePath, is_active: true });
    grantAnyUnit(code, roleCodes);
  }

  const ALL_UNIT_ROLES = ['head-of-school', 'head-of-department', 'lecturer', 'staff', 'student'];
  const HEAD_ROLES = ['head-of-school', 'head-of-department'];
  const ALL_INTERNAL_ROLES = [...ALL_UNIT_ROLES, 'cfo', 'cafeteria-admin', 'cafeteria-staff', 'system-admin'];
  // Every active cafeteria unit's code — used throughout this function to scope
  // 'cafeteria-manager' grants to real cafeterias only (never allActiveUnitCodes(), which would
  // wrongly admit non-cafeteria units too).
  const CAFETERIA_UNIT_CODES = db.unit.filter((u) => isCafeteriaUnitCode(u.code)).map((u) => u.code);
  function grantCafeteriaManager(pageCode) { grant(pageCode, 'unit_role', ['cafeteria-manager'], CAFETERIA_UNIT_CODES); }

  // 2026-08-13 sidebar reorg: Inbox/Ongoing/History are now the ONLY 3 nav entries for the
  // "things routed to me" concept — each is a single page (records-hub.ts) with an internal tab
  // bar (Proposals always, Tasks/Requests/Club Requests only for roles that actually have that
  // queue) instead of separate Requests/Tasks pages. Drafts stays its own separate page/goal (a
  // proposer's own unsent work, not something routed to them by someone else). See
  // proposal-visibility.ts's ProposalVisibilitySection for the shared 'inbox'/'ongoing'/'history'
  // bucketing every tab's data source is filtered through.
  page('how-it-works', 'How It Works', 'help_center', '/app/how-it-works', ['lecturer', 'student'], 0);
  page('dashboard', 'Dashboard', 'space_dashboard', '/app/dashboard', HEAD_ROLES, 1);
  // Cafeteria Manager gets Inbox/Ongoing/History (below) for the F&B->Cafeteria-Manager
  // per-selection food approval flow (proposal-visibility.ts) — but NOT My Requests's Drafts, nor
  // Forms/My Events, since a Cafeteria Manager reviews food selections, they don't submit event
  // proposals themselves. Granted via grantCafeteriaManager() (scoped to real cafeteria unit
  // codes only) rather than folded into the roleCodes list here, which would put it in the same
  // allActiveUnitCodes()-scoped row as head-of-school/head-of-department/lecturer/staff/student.
  page('inbox', 'Inbox', 'inbox', '/app/inbox', [...ALL_UNIT_ROLES, 'cfo'], 2);
  grantCafeteriaManager('inbox');
  page('reports', 'Reports', 'analytics', '/app/reports', ['cafeteria-admin'], 3);

  // My Requests groups the submitter-facing proposal-tracking views (Ongoing/History/Drafts) —
  // Inbox stays a separate top-level entry since it's things routed TO the user, not their own
  // submissions. See proposal-visibility.ts's ProposalVisibilitySection for the shared
  // 'inbox'/'ongoing'/'history' bucketing every tab's data source is filtered through.
  //
  // Cafeteria Manager gets Ongoing/History too (their approved/resubmitted/history fmb
  // selections, same records-hub.ts shell as Inbox above) but NOT Drafts — they review food
  // selections routed to them, they don't submit event proposals. A folder gates its own
  // children (see cafeteria-admin-folder below for the same pattern), so the folder's own grant
  // is broadened to include cafeteria-manager alongside the submitter roles, while Drafts keeps
  // its own narrower grant without cafeteria-manager.
  db.nav_page.push({ page_code: 'my-requests', label: 'My Requests', entry_type: 'folder', icon: resolveSeedIcon('assignment'), parent_page_code: null, sort_order: 4, route_path: null, is_active: true });
  grantAnyUnit('my-requests', [...ALL_UNIT_ROLES, 'cfo']);
  grantCafeteriaManager('my-requests');
  page('ongoing', 'Ongoing', 'schedule', '/app/ongoing', [...ALL_UNIT_ROLES, 'cfo'], 0);
  grantCafeteriaManager('ongoing');
  page('history', 'History', 'history', '/app/history', [...ALL_UNIT_ROLES, 'cfo'], 1);
  grantCafeteriaManager('history');
  page('drafts', 'Drafts', 'draft', '/app/proposals/drafts', ALL_UNIT_ROLES, 2);
  for (const code of ['ongoing', 'history', 'drafts']) db.nav_page.find((p) => p.page_code === code).parent_page_code = 'my-requests';

  db.nav_page.push({ page_code: 'events', label: 'Events', entry_type: 'folder', icon: resolveSeedIcon('event'), parent_page_code: null, sort_order: 5, route_path: null, is_active: true });
  grantAnyUnit('events', ALL_INTERNAL_ROLES);
  page('explore-events', 'Explore Events', 'explore', '/app/events/explore-events', ALL_INTERNAL_ROLES, 0);
  page('my-events', 'My Events', 'favorite', '/app/events/my-events', ALL_UNIT_ROLES, 1);
  for (const code of ['explore-events', 'my-events']) db.nav_page.find((p) => p.page_code === code).parent_page_code = 'events';

  db.nav_page.push({ page_code: 'forms', label: 'Forms', entry_type: 'folder', icon: resolveSeedIcon('note_add'), parent_page_code: null, sort_order: 6, route_path: null, is_active: true });
  grantAnyUnit('forms', ALL_UNIT_ROLES);
  page('proposal-form', 'Proposal', 'note_add', '/app/forms/event-proposal', ALL_UNIT_ROLES, 0);
  db.nav_page.find((p) => p.page_code === 'proposal-form').parent_page_code = 'forms';

  // 2026-08-17: F&B (head-of-department @ food_beverage_services) does NOT get 'My Menu' — F&B
  // reviews food REQUESTS (fmb/waterNormal request kinds, dropdown-option management below) but
  // isn't itself a cafeteria and owns no menu of its own; "My Menu" belongs to whoever actually
  // runs a specific cafeteria. As of this pass, that's really the 'cafeteria-manager' role (see
  // seedCafeteriaDomain()) — granted below, scoped to the actual cafeteria unit codes so a
  // manager only ever sees their own cafeteria's menu (request-option-management.ts's
  // ownCafeteriaCode filter). /app/cafeteria-menus (F&B's old read-only dropdown-based viewer)
  // is removed entirely; /app/cafeterias/menu-oversight (below, cafeteria-admin-folder) is the
  // one read-only cross-cafeteria menu view in the system, reachable by any role a System Admin
  // grants it to — F&B included, via Page Visibility, not a hardcoded route.
  db.nav_page.push({ page_code: 'menu', label: 'My Menu', entry_type: 'page', icon: resolveSeedIcon('restaurant_menu'), parent_page_code: null, sort_order: 9, route_path: '/app/menu', is_active: true });
  grantCafeteriaManager('menu');

  // Cafeteria Manager's own staff-roster workflow — My Staff (request add/edit/remove, routed to
  // Cafeteria Admin for approval — see server/routes/cafeterias.routes.js's /staff-requests) and
  // History (the manager's own request outcomes). Kept as its own folder rather than folded into
  // My Menu (a standalone page, not a folder, left alone above so it stays reachable by whichever
  // OTHER role a System Admin might grant it to later without dragging staff-request pages along).
  db.nav_page.push({ page_code: 'my-cafeteria-folder', label: 'My Cafeteria', entry_type: 'folder', icon: resolveSeedIcon('storefront'), parent_page_code: null, sort_order: 9.5, route_path: null, is_active: true });
  grantCafeteriaManager('my-cafeteria-folder');
  db.nav_page.push({ page_code: 'cafeteria-my-staff', label: 'My Staff', entry_type: 'page', icon: resolveSeedIcon('assignment_ind'), parent_page_code: 'my-cafeteria-folder', sort_order: 0, route_path: '/app/cafeterias/my-staff', is_active: true });
  grantCafeteriaManager('cafeteria-my-staff');
  db.nav_page.push({ page_code: 'cafeteria-my-staff-history', label: 'History', entry_type: 'page', icon: resolveSeedIcon('history'), parent_page_code: 'my-cafeteria-folder', sort_order: 1, route_path: '/app/cafeterias/my-staff-history', is_active: true });
  grantCafeteriaManager('cafeteria-my-staff-history');

  // Each dropdown kind's grant must match requestOptionManagerGuard's actual per-kind check
  // (managerOptionKinds(user).includes(optionKind), backed by department-workflow.config.ts's
  // UNIT_DEPARTMENT_WORKFLOWS/FLAT_DEPARTMENT_WORKFLOWS — a unit's head-of-department only
  // manages ITS OWN department's option kinds, never another department's) — a uniform grant
  // across all 11 kinds would put a sidebar link in front of e.g. a Logistics head for the Sound
  // & Light dropdown, which the guard would then reject on click. head-of-school never appears in
  // any UNIT_DEPARTMENT_WORKFLOWS entry (it heads a School, not a Service department), so it gets
  // no dropdown grants at all — matches managerOptionKinds() always returning [] for it.
  db.nav_page.push({ page_code: 'dropdown-settings', label: 'Dropdown Settings', entry_type: 'folder', icon: resolveSeedIcon('tune'), parent_page_code: null, sort_order: 16, route_path: null, is_active: true });
  grant('dropdown-settings', 'unit_role', ['head-of-department'], ['logistics_and_facilities', 'student_services', 'food_beverage_services', 'a_v_services', 'photography_services', 'transport_services']);
  grant('dropdown-settings', 'role', ['cfo']);
  const dropdownKinds = [
    ['logistics', 'Logistics Items', 'inventory_2', '/app/dropdown-options/logistics', 'logistics_and_facilities'],
    ['transportation', 'Transportation Types', 'directions_bus', '/app/dropdown-options/transportation', 'transport_services'],
    ['photoVideo', 'Photography Services', 'photo_camera', '/app/dropdown-options/photoVideo', 'photography_services'],
    ['soundLight', 'Sound & Light', 'settings_input_component', '/app/dropdown-options/soundLight', 'a_v_services'],
    ['dietaryInformation', 'Dietary Information', 'nutrition', '/app/dropdown-options/dietaryInformation', 'food_beverage_services'],
    ['servingUnit', 'Serving Units', 'straighten', '/app/dropdown-options/servingUnit', 'food_beverage_services'],
    ['campusTourStart', 'Campus Tour Starting Points', 'location_on', '/app/dropdown-options/campusTourStart', 'student_services'],
    ['campusTourType', 'Campus Tour Types', 'tour', '/app/dropdown-options/campusTourType', 'student_services'],
    ['waterNormal', 'Mineral Water', 'water_drop', '/app/dropdown-options/waterNormal', 'food_beverage_services'],
    ['fundingMain', 'Funding Main Items', 'account_balance_wallet', '/app/dropdown-options/fundingMain', null],
    ['fundingSub', 'Funding Sub-items', 'account_tree', '/app/dropdown-options/fundingSub', null],
  ];
  dropdownKinds.forEach(([kind, label, icon, routePath, unitCode], index) => {
    db.nav_page.push({ page_code: `dropdown-${kind}`, label, entry_type: 'page', icon: resolveSeedIcon(icon), parent_page_code: 'dropdown-settings', sort_order: index, route_path: routePath, is_active: true });
    if (unitCode) grant(`dropdown-${kind}`, 'unit_role', ['head-of-department'], [unitCode]);
    else grant(`dropdown-${kind}`, 'role', ['cfo']); // fundingMain/fundingSub are CFO's flat-role workflow, no unit
  });

  // Cafeteria Admin (flat role, 2026-08-17 refactor) — creates cafeteria units and assigns
  // cafeteria-manager/cafeteria-staff to them. System Admin still sees cafeteria units/users in
  // the normal Units/Users tables (they're ordinary unit/user rows, no visibility carve-out
  // there), but these 3 dedicated pages are cafeteria-admin's own workflow, same "flat oversight
  // role gets its own folder" pattern as Club Admin above.
  //
  // Menu Oversight (read-only, any role) also grants F&B's head-of-department — a folder gates
  // its own children (a user who fails the folder's grant sees none of what's inside, even with
  // their own grant on a specific child page — see nav-tree.service.js's navTreeFor()), so the
  // folder's own grant is broadened to include F&B alongside cafeteria-admin. F&B still won't see
  // Manage Cafeterias/Staff Assignments (those keep their own cafeteria-admin-only grants), same
  // "sees the folder, only their own items inside it" pattern as Dropdown Settings above.
  db.nav_page.push({ page_code: 'cafeteria-admin-folder', label: 'Cafeterias', entry_type: 'folder', icon: resolveSeedIcon('storefront'), parent_page_code: null, sort_order: 16.5, route_path: null, is_active: true });
  grant('cafeteria-admin-folder', 'role', ['cafeteria-admin']);
  grant('cafeteria-admin-folder', 'unit_role', ['head-of-department'], ['food_beverage_services']);
  page('cafeteria-manage', 'Manage Cafeterias', 'storefront', '/app/cafeterias/manage', ['cafeteria-admin'], 0);
  page('cafeteria-staff-assignments', 'Staff Assignments', 'assignment_ind', '/app/cafeterias/staff-assignments', ['cafeteria-admin'], 1);
  db.nav_page.push({ page_code: 'cafeteria-menu-oversight', label: 'Menu Oversight', entry_type: 'page', icon: resolveSeedIcon('restaurant_menu'), parent_page_code: null, sort_order: 2, route_path: '/app/cafeterias/menu-oversight', is_active: true });
  grant('cafeteria-menu-oversight', 'role', ['cafeteria-admin']);
  grant('cafeteria-menu-oversight', 'unit_role', ['head-of-department'], ['food_beverage_services']);
  for (const code of ['cafeteria-manage', 'cafeteria-staff-assignments', 'cafeteria-menu-oversight']) {
    db.nav_page.find((p) => p.page_code === code).parent_page_code = 'cafeteria-admin-folder';
  }

  db.nav_page.push({ page_code: 'admin-directory', label: 'Internal Directory', entry_type: 'folder', icon: resolveSeedIcon('folder_shared'), parent_page_code: null, sort_order: 17, route_path: null, is_active: true });
  grant('admin-directory', 'role', ['system-admin']);
  // "Assignments" is a TAB inside the Users page (/app/users), not its own routed nav_page —
  // AdminDirectoryComponent renders it when adminEntity === 'users'.
  page('admin-users', 'Users', 'group', '/app/users', ['system-admin'], 0);
  page('admin-units', 'Units', 'domain', '/app/units', ['system-admin'], 1);
  page('admin-roles', 'Roles', 'badge', '/app/roles', ['system-admin'], 2);
  page('admin-page-visibility', 'Page Visibility', 'visibility', '/app/admin/page-visibility', ['system-admin'], 3);
  for (const code of ['admin-users', 'admin-units', 'admin-roles', 'admin-page-visibility']) {
    const row = db.nav_page.find((p) => p.page_code === code);
    row.parent_page_code = 'admin-directory';
  }

  // Club Admin (the 'club-admin' flat role, 2026-08-17 refactor) manages clubs system-wide —
  // these 4 routes already existed (app.routes.ts) but were never in the nav_page catalog, so no
  // role had a sidebar path to them. Wired in the same way as every other role's pages: a
  // 'role' grant row via grantAnyUnit() (club-admin is flat, no unit).
  // My Clubs / Discover Clubs / Pending Requests are also open to any student or lecturer (they
  // can browse/join/request clubs, President status aside) — this used to be a hardcoded check in
  // role-navigation.ts's clubCanAccess() (isSchoolStudentOrLecturer), invisible to the Page
  // Visibility admin screen. Folded into a real nav_page_grants row instead (2026-08-17) so
  // Page Visibility is the single, complete, accurate source for every page's access rule — no
  // access decision lives only in frontend code any more. Manage Clubs stays club-admin-only.
  db.nav_page.push({ page_code: 'manage-clubs', label: 'Clubs', entry_type: 'folder', icon: resolveSeedIcon('groups'), parent_page_code: null, sort_order: 18, route_path: null, is_active: true });
  grantAnyUnit('manage-clubs', ['club-admin', 'student', 'lecturer']);
  page('clubs-manage', 'Manage Clubs', 'admin_panel_settings', '/app/clubs/manage', ['club-admin'], 0);
  // 'clubs-my' is granted the HUB'S BASE PATH '/app/clubs' (not '/app/clubs/my-clubs') on purpose:
  // roleCanAccess() only allow-lists exact nav_page route_path values (+ their own subpaths via
  // startsWith(route + '/')), same as 'inbox'/'ongoing'/'history' granting '/app/inbox' etc. so
  // their non-nav_page child tabs (proposals/tasks/requests) stay reachable. ClubHubComponent's
  // 3 tabs (my-clubs/pending/history) were merged out of separate nav_page rows into one tabbed
  // page, so granting only '/app/clubs/my-clubs' would 403 a click on the Pending/History tabs —
  // granting the shell's own path covers all 3 tabs as one unit. Angular still resolves the bare
  // '/app/clubs' link to the my-clubs tab via the { path: '', redirectTo: 'my-clubs' } child route.
  page('clubs-my', 'My Clubs', 'groups', '/app/clubs', ['club-admin', 'student', 'lecturer'], 1);
  page('clubs-discover', 'Discover Clubs', 'explore', '/app/clubs/discover', ['club-admin', 'student', 'lecturer'], 2);
  for (const code of ['clubs-manage', 'clubs-my', 'clubs-discover']) {
    const row = db.nav_page.find((p) => p.page_code === code);
    row.parent_page_code = 'manage-clubs';
  }

  db.nav_page.push({ page_code: 'system-config', label: 'System Configuration', entry_type: 'folder', icon: resolveSeedIcon('settings'), parent_page_code: null, sort_order: 19, route_path: null, is_active: true });
  grant('system-config', 'role', ['system-admin']);
  // Each of these routes to its own top-level route under admin/settings/... (see app.routes.ts)
  // — previously a single 'Settings' sidebar entry opened one page with an in-page tab strip for
  // Policies/Categories/Formats; now each is its own sidebar page/route so opening one doesn't
  // eagerly fetch the other two's data.
  page('admin-settings-policies', 'Approval Workflows & Policies', 'rule', '/app/admin/settings/policies', ['system-admin'], 0);
  page('admin-settings-categories', 'Event Categories', 'category', '/app/admin/settings/categories', ['system-admin'], 1);
  page('admin-settings-formats', 'Event Formats', 'grid_view', '/app/admin/settings/formats', ['system-admin'], 2);
  page('admin-matrix', 'Routing Matrix', 'account_tree', '/app/admin/matrix', ['system-admin'], 3);
  for (const code of ['admin-settings-policies', 'admin-settings-categories', 'admin-settings-formats', 'admin-matrix']) {
    const row = db.nav_page.find((p) => p.page_code === code);
    row.parent_page_code = 'system-config';
  }
}

function seedFresh() {
  resetCounters();
  seedRoles();
  seedUsersAndUnits();
  seedRoleUnits();
  seedCafeteriaDomain();
  seedCategoriesAndRequirements();
  seedConfigValues();
  seedDropdownOptions();
  seedClubsDemo();
  seedNavPages();
  // Inbox/Ongoing/History/Drafts/Explore Events intentionally start empty — no proposals,
  // registrations, tasks, or workflow history are seeded. Only what's submitted through the
  // app itself (real HTTP requests hitting server/routes/*) will ever populate those tables.
  // Exception: seedLogisticsAvailabilityDemo() below seeds two already-completed requests so the
  // Logistics availability feature has real committed data to compute against on first boot.
  seedLogisticsAvailabilityDemo();
}

workflowService.init(db, nextId);
require('./services/user-access.service').init(db);
require('./services/nav-tree.service').init(db);

// Every soft-deletable table (see server/services/soft-delete.service.js's registry — Users, Nav
// Pages, Nav Page Grants, the 11 Dropdown Option kinds, Club Categories; Units/Role already had
// this column pre-redesign) needs an `archived_at` field present on every row for the shared
// service's `!row.archived_at` filters to behave consistently. Backfilling here (once, after
// seed/load) instead of hand-adding `archived_at: null` to every seed literal keeps the seed data
// itself readable and makes it impossible to forget the field on a newly added table/row shape.
const SOFT_DELETE_TABLES = [
  'users', 'nav_page', 'nav_page_grants', 'club_categories',
  'logistics_options', 'transportation_options', 'media_options', 'sound_light_options',
  'dietary_information_options', 'serving_unit_options', 'fmb_options',
  'campus_tour_start_options', 'campus_tour_type_options', 'water_normal_options',
  'funding_main_options', 'funding_sub_options', 'event_category', 'event_format',
];
function backfillArchivedAt() {
  for (const table of SOFT_DELETE_TABLES) {
    for (const row of db[table]) {
      if (row.archived_at === undefined) row.archived_at = null;
    }
  }
}

// Removes the 'admin-assignments' nav_page (+ its grant) from a DB that was persisted while
// Assignments briefly existed as its own routed page — it's now a tab inside /app/users instead
// (AdminDirectoryComponent), so a leftover row here would be a dead nav link with no route behind it.
function backfillRemoveAssignmentsNavPage() {
  const before = db.nav_page.length;
  db.nav_page = db.nav_page.filter((p) => p.page_code !== 'admin-assignments');
  if (db.nav_page.length === before) return;
  db.nav_page_grants = db.nav_page_grants.filter((g) => g.page_code !== 'admin-assignments');
  saveDb();
}

// Re-resolves any nav_page.icon that isn't real SVG markup yet — covers rows persisted by a
// backfill (or seed edit) that referenced an icon name added to seed-icons.js's ICONS map AFTER
// that row was already written to disk, so resolveSeedIcon() at seed time fell through to the
// raw ligature name instead of expanding it. Idempotent: re-running is a no-op once every row is
// already SVG markup.
function backfillResolveNavIcons() {
  let changed = false;
  for (const row of db.nav_page) {
    if (row.icon && !/^\s*<svg[\s>]/i.test(row.icon)) {
      const resolved = resolveSeedIcon(row.icon);
      if (resolved !== row.icon) { row.icon = resolved; changed = true; }
    }
  }
  if (changed) saveDb();
}

// Adds `code` to event_category/event_format rows that predate that column (id-backed catalog
// redesign, 2026-08-16 — see routes/event-catalog.routes.js), and derives event_format_id/
// event_format_snapshot + request_categories.category_name for `request`/`request_categories`
// rows saved before the FK + label-snapshot columns existed. Idempotent — every check is
// `=== undefined`, so re-running on an already-migrated db.json is a no-op.
function backfillEventCatalog() {
  let changed = false;
  for (const row of db.event_category) {
    if (row.code === undefined) { row.code = deriveUnitCode(row.name); changed = true; }
  }
  for (const row of db.event_format) {
    if (row.code === undefined) { row.code = deriveUnitCode(row.name); changed = true; }
  }
  for (const row of db.request_categories) {
    if (row.category_name === undefined) {
      const category = db.event_category.find((c) => c.event_category_id === row.category_id);
      row.category_name = category ? category.name : 'Unknown';
      changed = true;
    }
  }
  for (const row of db.request) {
    if (row.event_format_snapshot === undefined) {
      // Old rows stored the raw name directly on `event_format` — that IS already the snapshot,
      // just under the old column name; resolve event_format_id by name for the new FK column.
      const name = row.event_format;
      const format = db.event_format.find((f) => f.name === name);
      row.event_format_snapshot = name || null;
      row.event_format_id = format ? format.event_format_id : null;
      changed = true;
    }
  }
  if (changed) saveDb();
}

// A db.json persisted before event_category/event_format existed as tables loads those arrays
// empty (loadFromDisk() falls back to [] for any table absent from the file) — backfillEventCatalog()
// only migrates rows that are already there, so an empty table stays permanently empty (e.g. the
// Event Format dropdown on the proposal form has nothing to show). Reseed the defaults in that case.
// Splits the old single 'admin-settings' sidebar entry (-> /app/admin/settings, an in-page tab
// strip for Policies/Categories/Formats) into three sibling nav_page rows under the same
// 'system-config' folder, one per tab's own route (see app.routes.ts's admin/settings children).
// Mirrors backfillRemoveAssignmentsNavPage()'s replace-a-stale-nav-row pattern. Idempotent: a
// no-op once 'admin-settings' is gone (either never existed, or already migrated).
function backfillSplitSystemConfigNavPages() {
  const staleIndex = db.nav_page.findIndex((p) => p.page_code === 'admin-settings');
  if (staleIndex === -1) return;
  db.nav_page.splice(staleIndex, 1);
  db.nav_page_grants = db.nav_page_grants.filter((g) => g.page_code !== 'admin-settings');
  const newPages = [
    { page_code: 'admin-settings-policies', label: 'Approval Workflows & Policies', icon: 'rule', route_path: '/app/admin/settings/policies', sort_order: 0 },
    { page_code: 'admin-settings-categories', label: 'Event Categories', icon: 'category', route_path: '/app/admin/settings/categories', sort_order: 1 },
    { page_code: 'admin-settings-formats', label: 'Event Formats', icon: 'grid_view', route_path: '/app/admin/settings/formats', sort_order: 2 },
  ];
  for (const entry of newPages) {
    db.nav_page.push({ page_code: entry.page_code, label: entry.label, entry_type: 'page', icon: resolveSeedIcon(entry.icon), parent_page_code: 'system-config', sort_order: entry.sort_order, route_path: entry.route_path, is_active: true });
    db.nav_page_grants.push({ grant_id: nextId('nav_page_grants'), page_code: entry.page_code, grant_type: 'role', role_codes: ['system-admin'], unit_codes: [], is_active: true });
  }
  const matrix = db.nav_page.find((p) => p.page_code === 'admin-matrix');
  if (matrix) matrix.sort_order = 3;
  saveDb();
}

function backfillMissingCatalogDefaults() {
  if (db.event_category.length === 0) {
    const categoryNames = ['Academic & Career', 'Workshops & Training', 'Sports & Wellness', 'Culture & Community', 'Clubs & Societies', 'Entertainment & Social', 'Volunteering'];
    for (const name of categoryNames) db.event_category.push({ event_category_id: nextId('event_category'), name, code: deriveUnitCode(name), active: true, archived_at: null });
    saveDb();
  }
  if (db.event_format.length === 0) {
    const eventFormatNames = ['On Campus', 'Online', 'Hybrid', 'Off Campus'];
    for (const name of eventFormatNames) db.event_format.push({ event_format_id: nextId('event_format'), name, code: deriveUnitCode(name), active: true, archived_at: null });
    saveDb();
  }
}

// seedCategoriesAndRequirements()'s requirementNames list was missing 'waterNormal' until this
// fix — any db.json persisted before this point has no event_requirements row for it, which
// meant Mineral Water could never be recorded in application_requirements (it silently vanished
// from "selected requirements" on every save/resubmit even though request_mineral_water rows
// themselves are written unconditionally from requestRows). Idempotent: a no-op once the row
// exists, matching backfillEventCatalog()'s pattern above.
function backfillWaterNormalRequirement() {
  let changed = false;
  let waterNormal = db.event_requirements.find((r) => r.requirement_name === 'waterNormal');
  if (!waterNormal) {
    waterNormal = { requirement_id: nextId('event_requirements'), requirement_name: 'waterNormal' };
    db.event_requirements.push(waterNormal);
    changed = true;
  }
  // The seed used to point every water_normal_options row at requirementId('fmb') by mistake
  // (copy-paste from the block above it) — repoint any row still carrying that wrong id.
  for (const row of db.water_normal_options) {
    if (row.requirement_id !== waterNormal.requirement_id) { row.requirement_id = waterNormal.requirement_id; changed = true; }
  }
  if (changed) saveDb();
}

if (fs.existsSync(DB_FILE)) {
  loadFromDisk();
} else {
  seedFresh();
  saveDb();
}
backfillArchivedAt();
backfillRemoveAssignmentsNavPage();
backfillSplitSystemConfigNavPages();
backfillResolveNavIcons();
backfillEventCatalog();
backfillMissingCatalogDefaults();
backfillWaterNormalRequirement();

require('./services/admin-deletion.registry').init(db);

module.exports = { db, nextId, TABLE_NAMES, saveDb };
