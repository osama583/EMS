// In-memory database. Every table listed below mirrors ems_database_schema.sql exactly —
// same table name, same column names, snake_case throughout. Populated by seed-*.js modules
// (Task 3.2) at require-time. Resets to this seed state every time the process restarts —
// no disk persistence, by design (see the design spec's "Behavior" section).
//
// Table count verified against the corrected schema (post Task 1.1) via:
//   grep -c "^CREATE TABLE" cloud/system_logic/ems_database_schema.sql
// which returns 49 — NOT the stale "51" figure from the original design spec (Task 1.1
// dropped campus_tour_area_options and campus_tour_map_options, taking 51 -> 49).

const seedUsers = require('./db/seed-users');
const seedCafeteria = require('./db/seed-cafeteria');
const seedCategories = require('./db/seed-categories');
const seedConfig = require('./db/seed-config');
const seedOptions = require('./db/seed-options');

const TABLE_NAMES = [
  // Identity & Organization
  'users', 'staff', 'student', 'unit', 'unit_users', 'clubs', 'student_clubs',
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
];

const db = {};
for (const table of TABLE_NAMES) db[table] = [];

const counters = {};
function nextId(table) {
  counters[table] = (counters[table] || 0) + 1;
  return counters[table];
}

function resetCounters() {
  for (const table of TABLE_NAMES) counters[table] = 0;
}

resetCounters();

seedUsers(db, nextId);
seedCafeteria(db, nextId);
seedCategories(db, nextId);
seedConfig(db, nextId);
seedOptions(db, nextId);

module.exports = { db, nextId, TABLE_NAMES };
