export type CafeteriaStaffRequestAction = 'add' | 'edit' | 'remove';
export type CafeteriaStaffRequestStatus = 'pending' | 'approved' | 'rejected';

// A Cafeteria Manager cannot write user_unit_roles directly — every add/edit/remove of a
// cafeteria-staff member at their own cafeteria is a pending request Cafeteria Admin must
// approve or reject first (see server/routes/cafeterias.routes.js's /staff-requests section).
export interface CafeteriaStaffRequest {
  readonly id: string;
  readonly cafeteriaCode: string;
  readonly cafeteriaName: string;
  readonly requestedByUserId: string;
  readonly requestedByName: string;
  readonly action: CafeteriaStaffRequestAction;
  readonly targetAssignmentId?: string;
  readonly targetUserId?: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleCode: string;
  readonly status: CafeteriaStaffRequestStatus;
  readonly comment?: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolvedByName?: string;
}

export interface CafeteriaStaffRequestDraft {
  readonly requestedByUserId: string;
  readonly action: CafeteriaStaffRequestAction;
  readonly targetAssignmentId?: string;
  readonly targetUserId?: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roleCode?: string;
}
