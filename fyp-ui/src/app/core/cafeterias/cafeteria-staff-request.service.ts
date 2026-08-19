import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, switchMap, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CafeteriaStaffRequest, CafeteriaStaffRequestDraft } from './cafeteria-staff-request.models';

@Injectable({ providedIn: 'root' })
export class CafeteriaStaffRequestService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${`${environment.apiBaseUrl}/catalog/cafeterias`}/staff-requests`;
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);

  submit(draft: CafeteriaStaffRequestDraft): Observable<CafeteriaStaffRequest> {
    return this.http.post<CafeteriaStaffRequest>(this.baseUrl, draft).pipe(tap(() => this.refresh()));
  }

  mine(requesterUserId: string): Observable<readonly CafeteriaStaffRequest[]> {
    return this.http.get<readonly CafeteriaStaffRequest[]>(`${this.baseUrl}/mine`, { params: { requesterUserId } });
  }

  readonly inbox$ = this.refreshRequests.pipe(switchMap(() => this.getInbox()), shareReplay({ bufferSize: 1, refCount: true }));
  getInbox(): Observable<readonly CafeteriaStaffRequest[]> {
    return this.http.get<readonly CafeteriaStaffRequest[]>(`${this.baseUrl}/inbox`);
  }

  // Decided requests. Shares the refresh trigger with inbox$ so approving something moves it from
  // one list to the other without either going stale.
  readonly history$ = this.refreshRequests.pipe(switchMap(() => this.getHistory()), shareReplay({ bufferSize: 1, refCount: true }));
  getHistory(): Observable<readonly CafeteriaStaffRequest[]> {
    return this.http.get<readonly CafeteriaStaffRequest[]>(`${this.baseUrl}/history`);
  }

  approve(id: string, resolvedByUserId: string): Observable<CafeteriaStaffRequest> {
    return this.http.post<CafeteriaStaffRequest>(`${this.baseUrl}/${encodeURIComponent(id)}/approve`, { resolvedByUserId }).pipe(tap(() => this.refresh()));
  }

  reject(id: string, resolvedByUserId: string, comment: string): Observable<CafeteriaStaffRequest> {
    return this.http.post<CafeteriaStaffRequest>(`${this.baseUrl}/${encodeURIComponent(id)}/reject`, { resolvedByUserId, comment }).pipe(tap(() => this.refresh()));
  }

  refresh(): void { this.refreshRequests.next(); }
}
