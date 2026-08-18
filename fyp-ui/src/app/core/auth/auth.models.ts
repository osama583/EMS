// RBAC redesign (2026-08-13, see docs/superpowers/specs/2026-08-13-rbac-role-unit-redesign-
// design.md): role + function_level + unit_kind are gone. A user holds zero or more
// (roleCode, unitCode?) assignments — AuthUser.roles below — and the server computes their
// nav tree directly (AuthUser.nav) rather than the client deriving it from a role/unit
// combination. There is no more UserRole enum: role identity is always a role_code string.

export interface AuthUserRole {
  readonly roleCode: string;
  readonly roleName: string;
  readonly unitCode: string | null;
  readonly unitDescription: string | null;
}

export interface AuthNavigationItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
}

// Mirrors the server's nav_page tree shape (nav-tree.service.js's navTreeFor()) — a folder has
// entryType='folder' and a non-empty children array; a page has entryType='page', a routePath,
// and an empty children array.
export interface AuthNavNode {
  readonly pageCode: string;
  readonly label: string;
  readonly entryType: 'page' | 'folder';
  readonly icon: string | null;
  readonly routePath: string | null;
  readonly children: readonly AuthNavNode[];
}

export type UserAccountType = 'internal' | 'external';

export interface AuthUser {
  // Opaque string form of the server's users.user_id (String(user_id), same convention as
  // AdminUserRecord.id / ClubUserSummary.id) — the identity a logged-in user acts "as" when
  // calling endpoints that need their own numeric id (e.g. sending a club join request,
  // approving one as President).
  readonly id?: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly accountType: UserAccountType;
  // Every (roleCode, unitCode?) pair this user holds. A flat role (cfo/cafeteria-admin/
  // external-user/system-admin) has unitCode=null; a unit-scoped role
  // (head-of-school/head-of-department/lecturer/staff/student) has unitCode set. A user can hold
  // several rows: multiple roles, multiple units, or both.
  readonly roles: readonly AuthUserRole[];
  // Display-only convenience fields, server-computed from `roles` (user-access.service.js's
  // roleLabel()/departmentFor()) — the first role's "{roleName} — {unitDescription}" label and
  // unit description, or generic fallbacks for a user with no role at all.
  readonly roleLabel: string;
  readonly department: string;
  // Server-computed sidebar tree (nav-tree.service.js's navTreeFor()) — the single source of
  // truth for what this user's nav looks like; the client renders it directly rather than
  // deriving it from role/unit combinations itself (see role-navigation.ts).
  readonly nav: readonly AuthNavNode[];
  readonly photoUrl?: string;
  // Set only for someone holding the 'cafeteria-manager' role — identifies which cafeteria unit
  // (unit.code, CAFETERIA_UNIT_PREFIX-coded) they're scoped to run. Undefined for everyone else,
  // including F&B's head-of-department (an unrelated role — food-request REVIEW workflow, not
  // any specific cafeteria).
  readonly cafeteriaCode?: string;
  // Club President is data-driven, not role-driven (see ems_database_schema.sql's clubs table
  // comment) — no role_code represents it, a club has exactly one President via clubs.user_id.
  // Club Admin IS the 'club-admin' flat role under the hood (2026-08-17), but is still surfaced
  // here as a plain boolean (computed server-side from that role) for the UI's convenience — same
  // shape either way, so no frontend call site needs a roles[]-scanning check. These two fields
  // carry that data down from the login response so the UI can gate "Manage Clubs" nav / "Club
  // Only" visibility / the President inbox.
  readonly isClubAdmin?: boolean;
  readonly presidentOfClubIds?: readonly string[];
}

export interface AuthNavigationSection {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly items: readonly AuthNavigationItem[];
}

// A single top-level sidebar row: either a direct link (standalone page) or an expandable group
// (folder). Kept as one ordered array — rather than separate primary/sections lists — so pages
// and folders interleave in their real sort order (oldest first, newest last) instead of every
// standalone page always rendering above every folder regardless of when each was added.
export type RoleNavigationEntry =
  | { readonly kind: 'item'; readonly item: AuthNavigationItem }
  | { readonly kind: 'section'; readonly section: AuthNavigationSection };

export interface RoleNavigation {
  readonly defaultRoute: string;
  readonly entries: readonly RoleNavigationEntry[];
}
