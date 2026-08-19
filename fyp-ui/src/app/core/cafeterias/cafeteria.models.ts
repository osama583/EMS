// A Cafeteria is a `unit` row (CAFETERIA_UNIT_PREFIX-coded) under the hood — see
// server/db.js's seedCafeteriaDomain() and services/unit-code.js's isCafeteriaUnitCode().
export interface Cafeteria {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly active: boolean;
  readonly archivedAt?: string;
}

export type CafeteriaDraft = { readonly name: string; readonly active: boolean };

export type CafeteriaStaffRoleCode = 'cafeteria-manager' | 'cafeteria-staff';

export interface CafeteriaAssignment {
  readonly assignmentId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly username?: string;
  // Two independent flags: `active` is this posting (suspended staff keep their account),
  // `userActive` is the account itself.
  readonly active?: boolean;
  readonly userActive?: boolean;
  readonly roleCode: CafeteriaStaffRoleCode;
  readonly roleLabel: string;
  readonly cafeteriaCode: string;
  readonly cafeteriaName: string;
}

export interface AssignableCafeteriaUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

// Editing an existing assignment only ever changes which cafeteria/role it's for — reassigning
// to a different user is remove + add (see cafeterias.routes.js's PUT /assignments/:id, which
// deliberately doesn't accept a userId).
export type CafeteriaAssignmentDraft = {
  readonly cafeteriaCode?: string;
  readonly roleCode?: CafeteriaStaffRoleCode;
  // The person's own details, editable on the same form as their posting.
  readonly displayName?: string;
  readonly username?: string;
  readonly email?: string;
  readonly password?: string;
  readonly userActive?: boolean;
};

// Creating a posting also creates the account it is for: a cafeteria hire is a new person far
// more often than an existing user changing jobs.
export type CafeteriaStaffAccountDraft = {
  readonly displayName: string;
  readonly username?: string;
  readonly email: string;
  readonly password?: string;
  readonly active: boolean;
  readonly cafeteriaCode: string;
  readonly roleCode: CafeteriaStaffRoleCode;
};
