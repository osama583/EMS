// Shared unit-code derivation: `lowercase_with_underscores`, no truncation. Used by both
// server/db.js (seeding) and server/routes/admin.routes.js (POST/PUT /units, where the client
// may not supply `code` at all — it's always server-derived from `description`) so the two
// call sites can never drift out of the same convention.
function deriveUnitCode(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

// Role-code derivation: `lowercase-with-hyphens`, no truncation. Separate from deriveUnitCode
// because unit codes stay underscored (e.g. food_beverage_services, hardcoded across seed data
// and route logic) while role codes are hyphenated (e.g. head-of-department, cafeteria-admin —
// the seeded protected roles' convention). Used by server/routes/admin.routes.js's POST /roles
// (the client never supplies role_code — always server-derived from roleName).
function deriveRoleCode(roleName) {
  return String(roleName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Cafeteria units are Units under the hood (unit.code/description, role_unit links, etc.) but
// need to be distinguishable from every other unit so Manage Cafeterias/Staff Assignments only
// ever list cafeterias, never School of Computing/Finance/etc. No schema change is allowed, so
// the marker lives in the code itself: every cafeteria unit's code is prefixed with this token
// server-side at creation (see admin.routes.js's POST /units `source: 'cafeteria'` branch) —
// opaque and enforced server-side, unlike relying on the admin's chosen name containing the word
// "cafeteria" (which isSchoolUnit()'s convention would have required).
const CAFETERIA_UNIT_PREFIX = 'cafeteria__';

function isCafeteriaUnitCode(unitCode) {
  return String(unitCode || '').startsWith(CAFETERIA_UNIT_PREFIX);
}

function deriveCafeteriaUnitCode(name) {
  return CAFETERIA_UNIT_PREFIX + deriveUnitCode(name);
}

module.exports = { deriveUnitCode, deriveRoleCode, CAFETERIA_UNIT_PREFIX, isCafeteriaUnitCode, deriveCafeteriaUnitCode };
