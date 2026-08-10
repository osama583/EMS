import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminDirectoryRepository, AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from './admin-directory.models';

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
  providedIn: 'root', factory: () => inject(ApiAdminDirectoryRepository),
});
