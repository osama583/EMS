// request_fmb_selection — one cafeteria order (migration 013 adds 'ready' + delivery photo).
// Staff-facing lifecycle: approved -> preparing ("Start Preparing") -> ready ("Done Preparing")
// -> fulfilled ("Delivered", requires deliveryPhotoUrl). The DB/API value stays 'fulfilled' so
// F&B's existing read-only order view keeps working — only this staff-facing UI calls it
// "Delivered".
export type CafeteriaOrderStatus = 'pending' | 'approved' | 'resubmitted' | 'preparing' | 'ready' | 'fulfilled' | 'cancelled';

export interface CafeteriaOrder {
  readonly id: number;
  readonly cafeteriaCode: string;
  readonly cafeteriaName: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly status: CafeteriaOrderStatus;
  readonly notes: string;
  readonly claimedByUserId: number | null;
  readonly requestId: number;
  readonly requestCode: string;
  readonly eventTitle: string;
  // Raw date/time the food is due to be served — the parent request_fmb's own schedule. Used for
  // the same-day-start gate and the 3-hour deadline reminder.
  readonly serveDate: string;
  readonly serveTime: string;
  readonly deliveryPhotoUrl: string | null;
  readonly deliveredAt: string | null;
}

/** The server's paginated envelope — mirrors proposal-workflow.repository.ts's Page<T>. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export type CafeteriaOrderSortKey = 'schedule' | 'event' | 'status';
export type SortOrder = 'asc' | 'desc';

/** Every filter/sort/page control on the Cafeteria queue is a real server query param — see
 * GET /cafeteria-orders in api/tasks.py. Nothing here is filtered client-side. */
export interface CafeteriaOrderQuery {
  readonly mode: 'active' | 'history';
  readonly page: number;
  readonly pageSize: number;
  readonly status?: string;
  readonly q?: string;
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly sort?: CafeteriaOrderSortKey;
  readonly order?: SortOrder;
}
