import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, delay, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { MOCK_ADMIN_UNITS, MOCK_ADMIN_USERS } from './admin-directory.mock-data';
import { AdminDirectoryRepository, AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from './admin-directory.models';

@Injectable({ providedIn: 'root' })
export class MockAdminDirectoryRepository implements AdminDirectoryRepository {
  private readonly users = new BehaviorSubject<readonly AdminUserRecord[]>(MOCK_ADMIN_USERS);
  private readonly units = new BehaviorSubject<readonly AdminUnitRecord[]>(MOCK_ADMIN_UNITS);

  getUsers(): Observable<readonly AdminUserRecord[]> { return this.users; }
  getUnits(): Observable<readonly AdminUnitRecord[]> { return this.units; }
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.saveUser(`user-${Date.now()}`, draft, false); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.saveUser(id, draft, true); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> {
    const current = this.users.value.find((user) => user.id === id);
    if (!current) return throwError(() => new Error('User not found.'));
    const updated = { ...current, active };
    return of(updated).pipe(delay(140), tap((record) => this.users.next(this.users.value.map((user) => user.id === id ? record : user))));
  }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.saveUnit(`unit-${Date.now()}`, draft, false); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.saveUnit(id, draft, true); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> {
    const current = this.units.value.find((unit) => unit.id === id);
    if (!current) return throwError(() => new Error('Unit not found.'));
    const updated = { ...current, active };
    return of(updated).pipe(delay(140), tap((record) => this.units.next(this.units.value.map((unit) => unit.id === id ? record : unit))));
  }

  private saveUser(id: string, draft: AdminUserDraft, editing: boolean): Observable<AdminUserRecord> {
    if (editing && !this.users.value.some((user) => user.id === id)) return throwError(() => new Error('User not found.'));
    const unit = this.units.value.find((item) => item.id === draft.unitId);
    const roleLabel = this.roleLabel(draft.role);
    const record: AdminUserRecord = { ...draft, id, roleLabel, department: unit?.name ?? 'Unassigned' };
    return of(record).pipe(delay(180), tap((saved) => this.users.next(editing ? this.users.value.map((user) => user.id === id ? saved : user) : [...this.users.value, saved])));
  }
  private saveUnit(id: string, draft: AdminUnitDraft, editing: boolean): Observable<AdminUnitRecord> {
    if (editing && !this.units.value.some((unit) => unit.id === id)) return throwError(() => new Error('Unit not found.'));
    const record: AdminUnitRecord = { ...draft, id };
    return of(record).pipe(delay(180), tap((saved) => this.units.next(editing ? this.units.value.map((unit) => unit.id === id ? saved : unit) : [...this.units.value, saved])));
  }
  private roleLabel(role: UserRole): string { return MOCK_ADMIN_USERS.find((user) => user.role === role)?.roleLabel ?? role; }
}

@Injectable({ providedIn: 'root' })
export class ApiAdminDirectoryRepository implements AdminDirectoryRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.adminDirectoryApiUrl;
  getUsers(): Observable<readonly AdminUserRecord[]> { return this.http.get<readonly AdminUserRecord[]>(`${this.baseUrl}/users`); }
  getUnits(): Observable<readonly AdminUnitRecord[]> { return this.http.get<readonly AdminUnitRecord[]>(`${this.baseUrl}/units`); }
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.post<AdminUserRecord>(`${this.baseUrl}/users`, draft); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.put<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}`, draft); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> { return this.http.patch<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}/status`, { active }); }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.post<AdminUnitRecord>(`${this.baseUrl}/units`, draft); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.put<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}`, draft); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> { return this.http.patch<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}/status`, { active }); }
}

export const ADMIN_DIRECTORY_REPOSITORY = new InjectionToken<AdminDirectoryRepository>('ADMIN_DIRECTORY_REPOSITORY', {
  providedIn: 'root', factory: () => environment.useMockAdminDirectory ? inject(MockAdminDirectoryRepository) : inject(ApiAdminDirectoryRepository),
});

