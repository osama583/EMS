#!/usr/bin/env node
// One-time migration script: converts an existing server/data/db.json from the OLD collapsed
// per-department role strings (logistics-manager, hos-hod, lecturer, student, applicant, staff,
// fmb, etc.) to the Unit + Level model (users.function_level + unit_users link, per
// ems_database_schema.sql's comment above CREATE TABLE users).
//
// This demonstrates the migration PATH — the shipped server/db.js already seeds fresh data
// directly in the new shape, so this script's primary real-world value is showing how an
// existing db.json with old-shape data gets converted, not migrating production data (per the
// plan's decision #1: db.json is disposable demo data, so a clean reseed is the normal path;
// this script exists for completeness/demonstration per the original migration prompt's spec).
//
// Usage: node server/scripts/migrate-unit-level-roles.js [path/to/db.json]
// Defaults to server/data/db.json.
//
// Steps (mirrors docs/system-logic/rbac-unit-level-migration-prompt.md's Migration section):
//   1. Back up db.json first (never write without a backup).
//   2. Collapsed department roles (logistics-manager, av-technician, etc.) -> (unit_code,
//      function_level), deriving the unit from ROLE_DEPARTMENTS + creating unit_users if missing.
//   3. hos-hod/lecturer/student -> School unit link + function_level (manager/staff/student).
//   4. applicant -> student + School unit link.
//   5. Generic 'staff' with no resolvable School/Service-department home -> flagged in report,
//      function_level left null, NOT guessed (matches decision #2's jordan.lee precedent).
//   6. F&B unit ensured to exist; existing fmb manager(s) linked with function_level='manager'.
//   7. Console summary + machine-readable report file.

const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const REPORT_PATH = path.join(__dirname, '..', 'data', 'migration-report-unit-level.json');

// Same lowercase_with_underscores derivation as services/unit-code.js — duplicated here
// (not required) so this script has zero dependency on the live server module graph and can be
// run standalone against an arbitrary db.json snapshot.
function deriveUnitCode(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

// Old role string -> { level, departmentFallback } for the collapsed per-department roles.
// departmentFallback is only used if the user has no staff/student extension row to read a real
// department/school from (defensive — the seed data always has one, but a real migrated dataset
// might not).
const MANAGER_STAFF_ROLES = {
  'logistics-manager': { level: 'manager', department: 'Logistics and Facilities' },
  'logistics-staff': { level: 'staff', department: 'Logistics and Facilities' },
  'transport-manager': { level: 'manager', department: 'Transport Services' },
  'transport-staff': { level: 'staff', department: 'Transport Services' },
  'photography-manager': { level: 'manager', department: 'Photography Services' },
  'photography-staff': { level: 'staff', department: 'Photography Services' },
  'av-manager': { level: 'manager', department: 'A/V Services' },
  'av-technician': { level: 'staff', department: 'A/V Services' },
  'student-services-manager': { level: 'manager', department: 'Student Services' },
  'student-services-member': { level: 'staff', department: 'Student Services' },
};

const SCHOOL_LEVEL_ROLES = {
  'hos-hod': 'manager',
  lecturer: 'staff',
  student: 'student',
};

const SERVICE_UNIT_KINDS = new Set([
  'Logistics and Facilities', 'Transport Services', 'Photography Services',
  'A/V Services', 'Student Services', 'Food & Beverage Services',
]);
const FMB_DEPARTMENT = 'Food & Beverage Services';
const FMB_UNIT_CODE = deriveUnitCode(FMB_DEPARTMENT);

function unitKindFor(department) {
  if (!department) return undefined;
  if (SERVICE_UNIT_KINDS.has(department)) return 'service_department';
  if (/school/i.test(department)) return 'school';
  return undefined;
}

function findOrCreateUnit(db, nextIdRef, description) {
  const kind = unitKindFor(description);
  const code = deriveUnitCode(description);
  let unit = db.tables.unit.find((u) => u.code === code);
  if (!unit) {
    unit = { code, description, unit_kind: kind, head_user_id: null, is_active: true };
    db.tables.unit.push(unit);
  } else if (!unit.unit_kind && kind) {
    unit.unit_kind = kind;
  }
  return unit;
}

function ensureUnitUsersLink(db, userId, unitCode) {
  const existing = db.tables.unit_users.find((uu) => uu.user_id === userId);
  if (existing) {
    existing.unit_code = unitCode;
  } else {
    db.tables.unit_users.push({ user_id: userId, unit_code: unitCode });
  }
}

function departmentForUser(db, user) {
  const staffRow = db.tables.staff.find((s) => s.user_id === user.user_id);
  if (staffRow && staffRow.department_or_school) return staffRow.department_or_school;
  const studentRow = db.tables.student.find((s) => s.user_id === user.user_id);
  if (studentRow && studentRow.school) return studentRow.school;
  return undefined;
}

function migrate(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.error(`No db.json found at ${dbPath} — nothing to migrate. (A fresh server boot will seed directly in the new shape.)`);
    process.exit(1);
  }

  // Step 1: back up first, always.
  const backupPath = `${dbPath}.pre-unit-level-migration.bak`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Backed up ${dbPath} -> ${backupPath}`);

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  if (!db.tables || !db.tables.users) {
    console.error('db.json does not look like the expected { counters, tables } shape — aborting without writing.');
    process.exit(1);
  }
  // Older db.json snapshots (from before the club system consolidation) may not have
  // unit_users/unit/staff/student tables populated as arrays — defend against undefined.
  for (const table of ['unit', 'unit_users', 'staff', 'student']) {
    if (!Array.isArray(db.tables[table])) db.tables[table] = [];
  }

  let nextUnitId = Math.max(0, ...db.tables.unit.map(() => 0)); // unit has no numeric id (code is PK); kept for symmetry, unused.

  const migratedCleanly = [];
  const flaggedForReview = [];

  for (const user of db.tables.users) {
    const oldRole = user.role;

    // Step 2: collapsed department manager/staff roles.
    if (MANAGER_STAFF_ROLES[oldRole]) {
      const { level, department: fallbackDepartment } = MANAGER_STAFF_ROLES[oldRole];
      const department = departmentForUser(db, user) || fallbackDepartment;
      const unit = findOrCreateUnit(db, null, department);
      ensureUnitUsersLink(db, user.user_id, unit.code);
      user.role = level;
      user.function_level = level;
      migratedCleanly.push({ userId: user.user_id, email: user.email, from: oldRole, toLevel: level, unitCode: unit.code });
      continue;
    }

    // Step 3: School-level roles (hos-hod/lecturer/student).
    if (SCHOOL_LEVEL_ROLES[oldRole]) {
      const level = SCHOOL_LEVEL_ROLES[oldRole];
      const department = departmentForUser(db, user);
      if (!department) {
        user.function_level = null;
        flaggedForReview.push({ userId: user.user_id, email: user.email, reason: `role '${oldRole}' has no resolvable School (no staff/student extension row with a department_or_school/school value)`, previousRole: oldRole });
        continue;
      }
      const unit = findOrCreateUnit(db, null, department);
      if (unit.unit_kind !== 'school') unit.unit_kind = 'school'; // trust the role-derived kind over a heuristic guess
      ensureUnitUsersLink(db, user.user_id, unit.code);
      user.role = level;
      user.function_level = level;
      migratedCleanly.push({ userId: user.user_id, email: user.email, from: oldRole, toLevel: level, unitCode: unit.code });
      continue;
    }

    // Step 4: applicant -> student.
    if (oldRole === 'applicant') {
      const existingDepartment = departmentForUser(db, user);
      const department = existingDepartment || 'School of Computing'; // sensible fallback School, flagged below when used
      const unit = findOrCreateUnit(db, null, department);
      unit.unit_kind = unit.unit_kind || 'school';
      ensureUnitUsersLink(db, user.user_id, unit.code);
      user.role = 'student';
      user.function_level = 'student';
      if (!db.tables.student.some((s) => s.user_id === user.user_id)) {
        db.tables.student.push({ student_id: (Math.max(0, ...db.tables.student.map((s) => s.student_id || 0)) + 1), user_id: user.user_id, school: department });
      }
      migratedCleanly.push({ userId: user.user_id, email: user.email, from: oldRole, toLevel: 'student', unitCode: unit.code });
      if (!existingDepartment) {
        flaggedForReview.push({ userId: user.user_id, email: user.email, reason: 'applicant migrated to student with a FALLBACK School (School of Computing) — no real department/school data existed to derive from; verify manually', previousRole: oldRole });
      }
      continue;
    }

    // Step 5: generic 'staff' role — only migrate if resolvable to a real School or one of the
    // 6 Service departments; otherwise flag, do not guess (decision #2 / jordan.lee precedent).
    if (oldRole === 'staff') {
      const department = departmentForUser(db, user);
      const kind = unitKindFor(department);
      if (!department || !kind) {
        user.function_level = null;
        flaggedForReview.push({ userId: user.user_id, email: user.email, reason: `generic 'staff' role with department '${department || '(none)'}' does not resolve to a known School or Service department — left unresolved, no unit_users link created`, previousRole: oldRole, department: department || null });
        continue;
      }
      const unit = findOrCreateUnit(db, null, department);
      ensureUnitUsersLink(db, user.user_id, unit.code);
      user.role = 'staff';
      user.function_level = 'staff';
      migratedCleanly.push({ userId: user.user_id, email: user.email, from: oldRole, toLevel: 'staff', unitCode: unit.code });
      continue;
    }

    // Step 6: fmb -> Food & Beverage Services unit, function_level='manager'.
    if (oldRole === 'fmb') {
      const unit = findOrCreateUnit(db, null, FMB_DEPARTMENT);
      unit.unit_kind = 'service_department';
      ensureUnitUsersLink(db, user.user_id, unit.code);
      user.role = 'manager';
      user.function_level = 'manager';
      migratedCleanly.push({ userId: user.user_id, email: user.email, from: oldRole, toLevel: 'manager', unitCode: unit.code });
      continue;
    }

    // Everything else (system-admin/cfo/cafeteria-*/external-user, or already-migrated
    // manager/staff/student) is untouched — flat roles stay flat, already-new-shape rows are
    // idempotent no-ops if this script is run twice.
    if (user.function_level === undefined) user.function_level = null;
  }

  // Step 6 (continued): ensure the F&B unit exists even if no fmb-role user was found (e.g. a
  // dataset that already dropped that account) — mirrors db.js's SEED_ACCOUNTS adding a staff-
  // level F&B account by default; this script can't invent a NEW user, only ensure the unit row
  // itself exists so a System Admin can assign staff to it afterward.
  if (!db.tables.unit.some((u) => u.code === FMB_UNIT_CODE)) {
    db.tables.unit.push({ code: FMB_UNIT_CODE, description: FMB_DEPARTMENT, unit_kind: 'service_department', head_user_id: null, is_active: true });
    console.log(`Created missing F&B unit '${FMB_UNIT_CODE}' (no existing fmb-role user found to derive it from).`);
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: dbPath,
    backupFile: backupPath,
    migratedCleanlyCount: migratedCleanly.length,
    flaggedForReviewCount: flaggedForReview.length,
    migratedCleanly,
    flaggedForReview,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Step 7: console summary.
  console.log('');
  console.log('=== Unit + Level migration summary ===');
  console.log(`Migrated cleanly: ${migratedCleanly.length}`);
  console.log(`Flagged for manual review: ${flaggedForReview.length}`);
  if (flaggedForReview.length > 0) {
    console.log('');
    console.log('Flagged accounts (see full detail in the report file):');
    for (const entry of flaggedForReview) {
      console.log(`  - ${entry.email} (user_id=${entry.userId}): ${entry.reason}`);
    }
  }
  console.log('');
  console.log(`Backup written to: ${backupPath}`);
  console.log(`Full report written to: ${REPORT_PATH}`);
  console.log('Review the report before trusting this data in a live session.');
}

if (require.main === module) {
  const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DB_PATH;
  migrate(dbPath);
}

module.exports = { migrate, deriveUnitCode };
