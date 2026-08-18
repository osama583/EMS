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
export type CafeteriaAssignmentDraft = { readonly cafeteriaCode?: string; readonly roleCode?: CafeteriaStaffRoleCode };
