// Registers every System-Admin-managed entity that supports the 7-day soft-delete/restore/purge
// workflow (soft-delete.service.js) with its table/PK, display label, and dependency checks. One
// place to see the full deletion-constraint picture across Admin Settings, per the design's "use
// an appropriate and consistent approach across all admin-managed tables" requirement.
//
// Users/Units/Roles/Nav Pages/Nav Page Grants/Dropdown Options/Club Categories are covered here.
// Units and Roles already had their own archive/restore/purge logic pre-dating this module (with
// slightly different dependency wording); admin.routes.js's Units/Roles routes are NOT rewired
// onto this registry to avoid disturbing their existing, already-correct behavior and response
// shapes — but they follow the exact same lifecycle (archived_at, 7-day retention, dependency
// check before delete AND before purge) and are swept by the same runRetentionSweep(), via their
// own registration further down.
let db;
function init(dbRef) {
  db = dbRef;
  const softDelete = require('./soft-delete.service');
  softDelete.init(db);
  registerAll(softDelete);
}

function registerAll(softDelete) {
  const { register } = softDelete;

  // ---------------------------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------------------------
  register('user', {
    table: 'users', pk: 'user_id', displayName: 'User',
    label: (row) => `"${row.full_name}"`,
    dependencies: [
      {
        count: (db, row) => db.user_unit_roles.filter((uur) => uur.user_id === row.user_id).length,
        reason: (count) => `assigned to ${count} role${count === 1 ? '' : 's'}/permission${count === 1 ? '' : 's'} — remove ${count === 1 ? 'it' : 'them'} first`,
      },
      {
        count: (db, row) => db.request.filter((r) => r.applicant_user_id === row.user_id).length,
        reason: (count) => `has ${count} submitted request${count === 1 ? '' : 's'}`,
      },
      {
        count: (db, row) => db.clubs.filter((c) => c.user_id === row.user_id).length,
        reason: (count) => `is President of ${count} club${count === 1 ? '' : 's'}`,
      },
      // Club Admin is now the 'club-admin' flat role — already covered by the user_unit_roles
      // check above, no separate dependency needed.
    ],
  });

  // ---------------------------------------------------------------------------------------------
  // Nav Pages (Page Visibility)
  // ---------------------------------------------------------------------------------------------
  register('navPage', {
    table: 'nav_page', pk: 'page_code', displayName: 'Page',
    label: (row) => `"${row.label}"`,
    dependencies: [
      {
        count: (db, row) => db.nav_page.filter((p) => p.parent_page_code === row.page_code && !p.archived_at).length,
        reason: (count) => `still has ${count} page${count === 1 ? '' : 's'} inside it — move or delete ${count === 1 ? 'it' : 'them'} first`,
      },
    ],
    // A page's grant rows are its own child data (not a separate admin-managed entity a user
    // would restore independently) — they're cleaned up alongside it on purge, matching the prior
    // hard-delete behavior's cascade.
    onPurge: (db, row) => { db.nav_page_grants = db.nav_page_grants.filter((g) => g.page_code !== row.page_code); },
  });

  // Nav page grants are soft-deletable individually too (e.g. undoing "remove permission" within
  // the 7-day window) even though they're also cascade-purged with their parent page above.
  register('navPageGrant', {
    table: 'nav_page_grants', pk: 'grant_id', displayName: 'Permission',
    label: (row) => `the ${row.grant_type.replace('_', ' + ')} permission on "${row.page_code}"`,
    dependencies: [],
  });

  // ---------------------------------------------------------------------------------------------
  // Dropdown Options (11 kinds) — each kind's table/PK from request-options.routes.js's
  // KIND_TO_TABLE/KIND_TO_PK. Request snapshot rows (request_logistics.option_id etc.) store a
  // free-text label, not the numeric option id, at submission time (see workflow.service.js) —
  // they are NEVER a real foreign-key reference in this codebase's actual data model despite the
  // documented schema implying otherwise, so no dependency check is registered against them here;
  // checking a column that can structurally never match would be dead code pretending to protect
  // something it can't. The one dependency that IS real and enforced: funding sub-items reference
  // their parent main item, and F&B menu items reference a serving unit + dietary info row.
  const SIMPLE_KINDS = [
    ['logistics_options', 'logistics_option_id', 'Logistics item'],
    ['transportation_options', 'transportation_option_id', 'Transportation option'],
    ['media_options', 'media_option_id', 'Photography/Videography option'],
    ['sound_light_options', 'sound_light_option_id', 'Sound & Light option'],
    ['campus_tour_start_options', 'campus_tour_start_option_id', 'Campus tour starting point'],
    ['campus_tour_type_options', 'campus_tour_type_option_id', 'Campus tour type'],
    ['water_normal_options', 'water_normal_option_id', 'Mineral water option'],
  ];
  for (const [table, pk, displayName] of SIMPLE_KINDS) {
    register(table, { table, pk, displayName, label: (row) => `"${row.label}"`, dependencies: [] });
  }

  register('serving_unit_options', {
    table: 'serving_unit_options', pk: 'serving_unit_option_id', displayName: 'Serving unit',
    label: (row) => `"${row.label}"`,
    dependencies: [{
      count: (db, row) => db.fmb_options.filter((f) => f.serving_unit_option_id === row.serving_unit_option_id && !f.archived_at).length,
      reason: (count) => `used by ${count} menu item${count === 1 ? '' : 's'} — change ${count === 1 ? 'its' : 'their'} serving unit first`,
    }],
  });

  register('dietary_information_options', {
    table: 'dietary_information_options', pk: 'dietary_information_option_id', displayName: 'Dietary information option',
    label: (row) => `"${row.label}"`,
    dependencies: [{
      count: (db, row) => db.fmb_options.filter((f) => f.dietary_information_option_id === row.dietary_information_option_id && !f.archived_at).length,
      reason: (count) => `used by ${count} menu item${count === 1 ? '' : 's'} — change ${count === 1 ? 'its' : 'their'} dietary information first`,
    }],
  });

  register('fmb_options', {
    table: 'fmb_options', pk: 'fmb_option_id', displayName: 'Menu item',
    label: (row) => `"${row.label}"`,
    dependencies: [],
  });

  register('funding_main_options', {
    table: 'funding_main_options', pk: 'funding_main_option_id', displayName: 'Funding main item',
    label: (row) => `"${row.label}"`,
    dependencies: [{
      count: (db, row) => db.funding_sub_options.filter((s) => s.main_option_id === row.funding_main_option_id && !s.archived_at).length,
      reason: (count) => `has ${count} funding sub-item${count === 1 ? '' : 's'} under it — remove ${count === 1 ? 'it' : 'them'} first`,
    }],
  });

  register('funding_sub_options', {
    table: 'funding_sub_options', pk: 'funding_sub_option_id', displayName: 'Funding sub-item',
    label: (row) => `"${row.label}"`,
    dependencies: [],
  });

  // ---------------------------------------------------------------------------------------------
  // Event Categories / Event Formats — request_categories.category_name and
  // request.event_format_snapshot freeze the label at proposal-save time, so — exactly like the
  // request-option snapshot rows above — no existing request can ever block a delete/purge here.
  // ---------------------------------------------------------------------------------------------
  register('eventCategory', {
    table: 'event_category', pk: 'event_category_id', displayName: 'Event category',
    label: (row) => `"${row.name}"`,
    dependencies: [],
  });
  register('eventFormat', {
    table: 'event_format', pk: 'event_format_id', displayName: 'Event format',
    label: (row) => `"${row.name}"`,
    dependencies: [],
  });

  // ---------------------------------------------------------------------------------------------
  // Club Categories
  // ---------------------------------------------------------------------------------------------
  register('clubCategory', {
    table: 'club_categories', pk: 'club_category_id', displayName: 'Club category',
    label: (row) => `"${row.name}"`,
    dependencies: [{
      count: (db, row) => new Set(db.club_category_links.filter((l) => l.club_category_id === row.club_category_id).map((l) => l.club_id)).size,
      reason: (count) => `used by ${count} club${count === 1 ? '' : 's'} — change ${count === 1 ? 'its' : 'their'} categories first`,
    }],
  });

  // ---------------------------------------------------------------------------------------------
  // Units / Roles — already had archive/restore/purge logic in admin.routes.js pre-dating this
  // module. Registered here too (same table/pk/dependency shape their existing routes already
  // enforce) purely so runRetentionSweep() covers them for automatic 7-day purge — their
  // hand-written routes remain the source of truth for the manual delete/restore/purge endpoints
  // themselves, unchanged.
  // ---------------------------------------------------------------------------------------------
  register('unit', {
    table: 'unit', pk: 'code', displayName: 'Unit',
    label: (row) => `"${row.description}"`,
    dependencies: [{
      count: (db, row) => db.user_unit_roles.filter((uur) => uur.unit_code === row.code).length,
      reason: (count) => `${count} user${count === 1 ? ' is' : 's are'} still assigned to this unit`,
    }],
  });
  register('role', {
    table: 'role', pk: 'role_code', displayName: 'Role',
    label: (row) => `"${row.role_name}"`,
    dependencies: [{
      count: (db, row) => db.user_unit_roles.filter((uur) => uur.role_code === row.role_code).length,
      reason: (count) => `${count} user${count === 1 ? '' : 's'} currently hold this role`,
    }],
  });
}

module.exports = { init };
