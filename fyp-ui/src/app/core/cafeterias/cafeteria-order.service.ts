import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CafeteriaOrder, CafeteriaOrderQuery, CafeteriaOrderStatus, Page } from './cafeteria-order.models';

interface RawCafeteriaOrder {
  readonly request_fmb_selection_id: number;
  readonly unit_code: string;
  readonly cafeteria_name: string;
  readonly menu_item_label: string;
  readonly quantity: number;
  readonly status: CafeteriaOrderStatus;
  readonly notes: string | null;
  readonly claimed_by_user_id: number | null;
  readonly request_id: number;
  readonly request_code: string;
  readonly event_title: string;
  readonly serve_date: string;
  readonly serve_time: string;
  readonly delivery_photo_url: string | null;
  readonly delivered_at: string | null;
}

function toCafeteriaOrder(raw: RawCafeteriaOrder): CafeteriaOrder {
  return {
    id: raw.request_fmb_selection_id,
    cafeteriaCode: raw.unit_code,
    cafeteriaName: raw.cafeteria_name,
    menuItemLabel: raw.menu_item_label,
    quantity: raw.quantity,
    status: raw.status,
    notes: raw.notes ?? '',
    claimedByUserId: raw.claimed_by_user_id,
    requestId: raw.request_id,
    requestCode: raw.request_code,
    eventTitle: raw.event_title,
    serveDate: raw.serve_date,
    serveTime: raw.serve_time,
    deliveryPhotoUrl: raw.delivery_photo_url,
    deliveredAt: raw.delivered_at,
  };
}

// Cafeteria staff's own shared-pool queue (request_fmb_selection) — distinct from
// CafeteriaService's staff assignment writes, which are for staff ACCOUNTS, not food orders.
@Injectable({ providedIn: 'root' })
export class CafeteriaOrderService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/cafeteria-orders`;

  myQueue(query: CafeteriaOrderQuery): Observable<Page<CafeteriaOrder>> {
    let params = new HttpParams()
      .set('mode', query.mode)
      .set('page', query.page)
      .set('pageSize', query.pageSize);
    if (query.status) params = params.set('status', query.status);
    if (query.q) params = params.set('q', query.q);
    if (query.dateStart) params = params.set('dateStart', query.dateStart);
    if (query.dateEnd) params = params.set('dateEnd', query.dateEnd);
    if (query.sort) params = params.set('sort', query.sort);
    if (query.order) params = params.set('order', query.order);

    return this.http
      .get<Page<RawCafeteriaOrder>>(this.baseUrl, { params })
      .pipe(map((page) => ({ ...page, items: page.items.map(toCafeteriaOrder) })));
  }

  /** Distinct serve days (YYYY-MM-DD) — feeds the calendar's dot indicator. */
  myQueueDates(mode: 'active' | 'history'): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/dates`, { params: { mode } });
  }

  /** Claim an order out of the shared pool — the "Start Preparing" step. */
  startPreparing(orderId: number): Observable<CafeteriaOrder> {
    return this.http.post<RawCafeteriaOrder>(`${this.baseUrl}/${orderId}/claim`, {}).pipe(map(toCafeteriaOrder));
  }

  /** Claimant finishes preparing — the "Done Preparing" step. */
  markReady(orderId: number): Observable<CafeteriaOrder> {
    return this.http.post<RawCafeteriaOrder>(`${this.baseUrl}/${orderId}/ready`, {}).pipe(map(toCafeteriaOrder));
  }

  /** Claimant confirms delivery — the "Delivered" step. A photo URL (from the shared
   * EventImageUploadComponent / POST /uploads) is mandatory. */
  markDelivered(orderId: number, deliveryPhotoUrl: string): Observable<CafeteriaOrder> {
    return this.http.post<RawCafeteriaOrder>(`${this.baseUrl}/${orderId}/fulfilment`, { deliveryPhotoUrl }).pipe(map(toCafeteriaOrder));
  }
}
