import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AssignableCafeteriaUser, Cafeteria, CafeteriaAssignment, CafeteriaAssignmentDraft, CafeteriaDraft, CafeteriaStaffAccountDraft } from './cafeteria.models';
import { Archived } from '../admin-directory/admin-directory.models';

@Injectable({ providedIn: 'root' })
export class CafeteriaService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/catalog/cafeterias`;
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);

  // Every non-admin cafeteria picker (F&B's read-only Cafeteria Menus viewer) still just calls
  // list() directly, unaffected by the cache below — only Manage Cafeterias/Staff Assignments
  // need live refresh-on-mutation semantics.
  list(): Observable<readonly Cafeteria[]> {
    return this.http.get<readonly Cafeteria[]>(this.baseUrl);
  }

  readonly cafeterias$ = this.refreshRequests.pipe(switchMap(() => this.list()), shareReplay({ bufferSize: 1, refCount: true }));

  create(draft: CafeteriaDraft): Observable<Cafeteria> {
    return this.http.post<Cafeteria>(this.baseUrl, { name: draft.name, active: draft.active }).pipe(tap(() => this.refresh()));
  }
  update(code: string, draft: Partial<CafeteriaDraft>): Observable<Cafeteria> {
    return this.http.put<Cafeteria>(`${this.baseUrl}/${encodeURIComponent(code)}`, draft).pipe(tap(() => this.refresh()));
  }
  setActive(code: string, active: boolean): Observable<Cafeteria> {
    return this.update(code, { active });
  }
  // Soft-delete — kept recoverable for 7 days, same lifecycle as every other Admin Settings
  // entity (see cafeterias.routes.js's GET /deleted, POST /:code/restore, DELETE /:code/purge).
  delete(code: string): Observable<Cafeteria> {
    return this.http.delete<Cafeteria>(`${this.baseUrl}/${encodeURIComponent(code)}`).pipe(tap(() => this.refresh()));
  }
  getDeleted(): Observable<readonly Archived<Cafeteria>[]> {
    return this.http.get<readonly Archived<Cafeteria>[]>(`${this.baseUrl}/deleted`);
  }
  restore(code: string): Observable<Cafeteria> {
    return this.http.post<Cafeteria>(`${this.baseUrl}/${encodeURIComponent(code)}/restore`, {}).pipe(tap(() => this.refresh()));
  }
  purge(code: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(code)}/purge`).pipe(tap(() => this.refresh()));
  }

  readonly assignments$ = this.refreshRequests.pipe(switchMap(() => this.getAssignments()), shareReplay({ bufferSize: 1, refCount: true }));
  getAssignments(): Observable<readonly CafeteriaAssignment[]> {
    return this.http.get<readonly CafeteriaAssignment[]>(`${this.baseUrl}/assignments`);
  }
  getAssignableUsers(): Observable<readonly AssignableCafeteriaUser[]> {
    return this.http.get<readonly AssignableCafeteriaUser[]>(`${this.baseUrl}/assignable-users`);
  }
  assign(userId: string, cafeteriaCode: string, roleCode: string): Observable<CafeteriaAssignment> {
    return this.http.post<CafeteriaAssignment>(`${this.baseUrl}/assignments`, { userId, cafeteriaCode, roleCode }).pipe(tap(() => this.refresh()));
  }
  // Creates the account and its posting in one call — the server does both in one transaction, so
  // a half-made staff member (account with no cafeteria) is not a reachable state.
  assignNewAccount(draft: CafeteriaStaffAccountDraft): Observable<CafeteriaAssignment> {
    return this.http.post<CafeteriaAssignment>(`${this.baseUrl}/assignments`, draft).pipe(tap(() => this.refresh()));
  }
  setAssignmentActive(assignmentId: string, active: boolean): Observable<CafeteriaAssignment> {
    return this.http.patch<CafeteriaAssignment>(`${this.baseUrl}/assignments/${encodeURIComponent(assignmentId)}/status`, { active }).pipe(tap(() => this.refresh()));
  }
  updateAssignment(assignmentId: string, draft: CafeteriaAssignmentDraft): Observable<CafeteriaAssignment> {
    return this.http.put<CafeteriaAssignment>(`${this.baseUrl}/assignments/${encodeURIComponent(assignmentId)}`, draft).pipe(tap(() => this.refresh()));
  }
  removeAssignment(assignmentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/assignments/${encodeURIComponent(assignmentId)}`).pipe(tap(() => this.refresh()));
  }

  refresh(): void { this.refreshRequests.next(); }
}
