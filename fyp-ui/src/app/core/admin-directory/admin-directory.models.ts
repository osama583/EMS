import { DeletionMetadata, DeletionPreview } from '../../shared/models/deletion.models';

export interface AdminUserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleLabel: string;
  readonly department: string;
  readonly active: boolean;
  readonly roles: readonly AdminUserAssignment[];
  readonly isClubAdmin?: boolean;
  readonly presidentOfClubIds?: readonly string[];
}

// GET .../deleted responses add these on top of the entity's normal fields (see
// soft-delete.service.js's archivedList()) — kept as a generic intersection so every soft-deletable
// admin entity's "Deleted" record shape stays consistent.
export type Archived<T> = T & DeletionMetadata;

export interface AdminUnitRecord {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly description?: string;
  readonly active: boolean;
  readonly archivedAt?: string;
  // Role codes directly linked to this unit via the role_unit join table.
  readonly roleCodes: readonly string[];
}

export interface AdminRoleRecord {
  readonly roleCode: string;
  readonly roleName: string;
  readonly description: string;
  readonly isProtected: boolean;
  readonly active: boolean;
  readonly archivedAt?: string;
  // Unit codes directly linked to this role via the role_unit join table. Empty = Flat Role.
  readonly unitCodes: readonly string[];
}

// One row of GET /users/:id/assignments — same shape as AuthUserRole plus the id needed to target
// a DELETE (AuthUserRole itself stays id-less since the login/session payload never needs one).
export interface AdminUserAssignment {
  readonly assignmentId: string;
  readonly roleCode: string;
  readonly roleName: string;
  readonly unitCode: string | null;
  readonly unitDescription: string | null;
}

// `password` is optional and write-only: on create, omitting it leaves the account with a random
// hash nobody holds (reachable only through a reset); on edit, omitting it leaves the existing
// password alone. It is never returned by any read.
export type AdminUserDraft = { readonly displayName: string; readonly email: string; readonly password?: string; readonly active: boolean };
export type AdminUnitDraft = { readonly description: string; readonly active: boolean; readonly roleCodes: readonly string[] };
export type AdminRoleDraft = { readonly roleName: string; readonly description: string; readonly unitCodes: readonly string[]; readonly active: boolean };

export type NavEntryType = 'page' | 'folder';

// A page is visible to a user if they match ANY of its grant rows — rows are OR'd together, each
// independently typed, and a page has at most ONE row per grant_type (max 3 rows total).
export type NavGrantType = 'role' | 'unit_role' | 'unit' | 'cafeteria';

export interface AdminNavPageGrant {
  readonly grantId: number;
  readonly grantType: NavGrantType;
  readonly roleCodes: readonly string[];
  readonly unitCodes: readonly string[];
  readonly active: boolean;
}

export type AdminNavPageGrantDraft = {
  readonly grantType: NavGrantType;
  readonly roleCodes?: readonly string[];
  readonly unitCodes?: readonly string[];
};

export interface AdminNavPageRecord {
  readonly pageCode: string;
  readonly label: string;
  readonly entryType: NavEntryType;
  // Raw inline SVG markup (validated/sanitized server-side), not a Material Symbol name — render
  // with [innerHTML] and `fill: currentColor` so it inherits the surrounding text color, sized via
  // CSS on the wrapping element.
  readonly icon?: string;
  readonly parentPageCode?: string;
  readonly sortOrder: number;
  // Always '/app/' + pageCode, server-derived — never editable from the client.
  readonly routePath?: string;
  readonly active: boolean;
  readonly grants: readonly AdminNavPageGrant[];
}

// label/icon/parentPageCode/active only — permissions are managed separately via
// AdminDirectoryRepository's grant methods (the Permissions tab), never through this draft.
export type AdminNavPageDraft = {
  readonly label: string;
  readonly entryType: NavEntryType;
  readonly icon?: string;
  readonly parentPageCode?: string | null;
  readonly active?: boolean;
};

export interface AdminDirectoryRepository {
  getUsers(): import('rxjs').Observable<readonly AdminUserRecord[]>;
  getUnits(): import('rxjs').Observable<readonly AdminUnitRecord[]>;
  createUser(draft: AdminUserDraft): import('rxjs').Observable<AdminUserRecord>;
  updateUser(id: string, draft: AdminUserDraft): import('rxjs').Observable<AdminUserRecord>;
  setUserActive(id: string, active: boolean): import('rxjs').Observable<AdminUserRecord>;
  checkUserDeletion(id: string): import('rxjs').Observable<DeletionPreview>;
  deleteUser(id: string): import('rxjs').Observable<AdminUserRecord>;
  restoreUser(id: string): import('rxjs').Observable<AdminUserRecord>;
  getDeletedUsers(): import('rxjs').Observable<readonly Archived<AdminUserRecord>[]>;
  getUserAssignments(userId: string): import('rxjs').Observable<readonly AdminUserAssignment[]>;
  assignRole(userId: string, roleCode: string, unitCode?: string): import('rxjs').Observable<readonly AdminUserAssignment[]>;
  removeAssignment(userId: string, assignmentId: string): import('rxjs').Observable<readonly AdminUserAssignment[]>;
  getEligibleRolesForUnit(unitCode: string): import('rxjs').Observable<readonly AdminRoleRecord[]>;
  getFlatRoles(): import('rxjs').Observable<readonly AdminRoleRecord[]>;
  createUnit(draft: AdminUnitDraft & { readonly code?: string }): import('rxjs').Observable<AdminUnitRecord>;
  updateUnit(id: string, draft: AdminUnitDraft): import('rxjs').Observable<AdminUnitRecord>;
  setUnitActive(id: string, active: boolean): import('rxjs').Observable<AdminUnitRecord>;
  checkUnitDeletion(id: string): import('rxjs').Observable<DeletionPreview>;
  deleteUnit(id: string): import('rxjs').Observable<AdminUnitRecord>;
  restoreUnit(id: string): import('rxjs').Observable<AdminUnitRecord>;
  getDeletedUnits(): import('rxjs').Observable<readonly Archived<AdminUnitRecord>[]>;
  getRoles(): import('rxjs').Observable<readonly AdminRoleRecord[]>;
  createRole(draft: AdminRoleDraft): import('rxjs').Observable<AdminRoleRecord>;
  updateRole(code: string, draft: Partial<AdminRoleDraft>): import('rxjs').Observable<AdminRoleRecord>;
  checkRoleDeletion(code: string): import('rxjs').Observable<DeletionPreview>;
  deleteRole(code: string): import('rxjs').Observable<AdminRoleRecord>;
  restoreRole(code: string): import('rxjs').Observable<AdminRoleRecord>;
  getDeletedRoles(): import('rxjs').Observable<readonly Archived<AdminRoleRecord>[]>;
  getNavPages(): import('rxjs').Observable<readonly AdminNavPageRecord[]>;
  createNavPage(draft: AdminNavPageDraft): import('rxjs').Observable<AdminNavPageRecord>;
  updateNavPage(code: string, draft: Partial<AdminNavPageDraft>): import('rxjs').Observable<AdminNavPageRecord>;
  checkNavPageDeletion(code: string): import('rxjs').Observable<DeletionPreview>;
  deleteNavPage(code: string): import('rxjs').Observable<AdminNavPageRecord>;
  restoreNavPage(code: string): import('rxjs').Observable<AdminNavPageRecord>;
  getDeletedNavPages(): import('rxjs').Observable<readonly Archived<AdminNavPageRecord>[]>;
  eligibleRolesForUnits(unitCodes: readonly string[]): import('rxjs').Observable<readonly AdminRoleRecord[]>;
  addNavPageGrant(pageCode: string, draft: AdminNavPageGrantDraft): import('rxjs').Observable<AdminNavPageGrant>;
  updateNavPageGrant(pageCode: string, grantId: number, draft: AdminNavPageGrantDraft): import('rxjs').Observable<AdminNavPageGrant>;
  setNavPageGrantActive(pageCode: string, grantId: number, active: boolean): import('rxjs').Observable<AdminNavPageGrant>;
  removeNavPageGrant(pageCode: string, grantId: number): import('rxjs').Observable<AdminNavPageGrant>;
}
