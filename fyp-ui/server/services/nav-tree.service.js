// Builds the sidebar nav tree for a logged-in user from the admin-managed nav_page /
// nav_page_grants tables — replaces the old hardcoded ROLE_NAVIGATION / unitNavigationFor() maps
// in src/app/core/auth/role-navigation.ts. See docs/superpowers/specs/
// 2026-08-13-rbac-role-unit-redesign-design.md's Page Visibility section (and the later
// Permissions-tab redesign — nav_page_grants' comment in ems_database_schema.sql — which replaced
// the single permission_mode column with independently typed, OR'd-together grant rows).
let db;
function init(dbRef) {
  db = dbRef;
}

const { rolesFor } = require('./user-access.service');

// True if a single grant row matches the user's roles — see nav_page_grants' comment in
// ems_database_schema.sql for what each grant_type means. Each row now holds a SET of
// roles/units (role_codes/unit_codes arrays, multi-select) rather than one of each.
function userSatisfiesGrant(userRoles, grantRow) {
  const roleCodes = grantRow.role_codes || [];
  const unitCodes = grantRow.unit_codes || [];
  if (grantRow.grant_type === 'role') return userRoles.some((r) => roleCodes.includes(r.roleCode));
  if (grantRow.grant_type === 'unit') return userRoles.some((r) => unitCodes.includes(r.unitCode));
  // unit_role: cross-product WITHIN this row — any role in role_codes held in any unit in
  // unit_codes (e.g. "Staff or Lecturer, in Finance or School of Computing").
  return userRoles.some((r) => roleCodes.includes(r.roleCode) && unitCodes.includes(r.unitCode));
}

// True if `userRoles` (the array rolesFor() returns) satisfies ANY of `page`'s grant rows — rows
// are OR'd together, each independently typed (role / unit_role / unit). A page with zero grant
// rows is visible to nobody (fail closed, matches the old "empty role list => false" behavior).
function userSatisfiesPage(userRoles, page) {
  // is_active !== false (not a truthy check): rows persisted before this column existed have no
  // is_active field at all and must still count as active, matching projectGrant()'s same backfill.
  const grants = db.nav_page_grants.filter((g) => g.page_code === page.page_code && g.is_active !== false && !g.archived_at);
  if (grants.length === 0) return false;
  return grants.some((g) => userSatisfiesGrant(userRoles, g));
}

// Returns the filtered, ordered nav tree for `userId`: top-level entries (no parent) each with
// a `children` array. A folder is dropped entirely if the user fails ITS OWN gate, regardless of
// whether individual children would pass; a folder the user passes still has each child
// individually filtered.
function navTreeFor(userId) {
  const userRoles = rolesFor(userId);
  const activePages = db.nav_page.filter((p) => p.is_active && !p.archived_at);

  function visible(page) {
    return userSatisfiesPage(userRoles, page);
  }

  function buildChildren(parentCode) {
    return activePages
      .filter((p) => p.parent_page_code === parentCode && visible(p))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({
        pageCode: p.page_code,
        label: p.label,
        entryType: p.entry_type,
        icon: p.icon,
        routePath: p.route_path,
        children: p.entry_type === 'folder' ? buildChildren(p.page_code) : [],
      }));
  }

  return buildChildren(null);
}

module.exports = { init, navTreeFor, userSatisfiesPage };
