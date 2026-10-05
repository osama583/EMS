// cafeteria_staff_audit_log — one row per direct staff create/edit/suspend/restore/remove
// (backend/app/api/cafeterias.py's assignment endpoints, migration 016). Distinct from the old
// approval-request workflow (removed): this is a plain audit trail, no status/decision.
export type CafeteriaStaffAuditAction = 'create' | 'edit' | 'suspend' | 'restore' | 'remove';

export interface CafeteriaStaffAuditEntry {
  readonly id: string;
  readonly cafeteriaCode: string;
  readonly cafeteriaName: string;
  readonly action: CafeteriaStaffAuditAction;
  readonly targetUserId: string;
  readonly targetDisplayName: string;
  readonly targetEmail: string;
  readonly roleCode: string;
  readonly roleLabel: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
  readonly actorRole: 'cafeteria-admin' | 'cafeteria-manager' | 'system-admin';
  readonly createdAt: string;
}

/** The server's paginated envelope — mirrors cafeteria-order.models.ts's Page<T>. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export type CafeteriaStaffAuditSortKey = 'createdAt' | 'cafeteria' | 'target' | 'actor' | 'action';
export type SortOrder = 'asc' | 'desc';

// Filters by WHO performed the action — a Cafeteria Manager vs. a Cafeteria Admin (or a System
// Admin standing in) — so a Manager can tell what they are and are not responsible for.
export type CafeteriaStaffAuditActorRole = 'cafeteria-manager' | 'cafeteria-admin' | 'system-admin';

/** Every search/filter/sort/page control on this page is a real server query param — see
 * GET /catalog/cafeterias/staff-requests-history in api/cafeterias.py. Nothing here is
 * filtered, sorted, or paginated client-side. */
export interface CafeteriaStaffAuditQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly cafeteriaCode?: string;
  readonly action?: CafeteriaStaffAuditAction;
  readonly actorRole?: CafeteriaStaffAuditActorRole;
  readonly sort?: CafeteriaStaffAuditSortKey;
  readonly order?: SortOrder;
}
