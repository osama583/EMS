// 'suspend'/'restore' stand someone down without discarding the assignment, so a spell of leave
// keeps its history rather than becoming a delete-and-re-add (migration 008).
export type CafeteriaStaffRequestAction = 'add' | 'edit' | 'remove' | 'suspend' | 'restore';
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
  readonly username: string;
  // What the request proposes, and what the target looks like now — so the Admin can see what
  // approving actually changes rather than only what it asks for.
  readonly proposedActive?: boolean | null;
  readonly setsPassword?: boolean;
  readonly currentDisplayName?: string | null;
  readonly currentEmail?: string | null;
  readonly currentUsername?: string | null;
  readonly currentActive?: boolean | null;
  readonly assignmentActive?: boolean | null;
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
  readonly username?: string;
  // Sent once, hashed server-side before it is stored, and copied into the account only when the
  // Cafeteria Admin approves — the request table never holds a usable secret.
  readonly password?: string;
  readonly active?: boolean;
  readonly roleCode?: string;
}
