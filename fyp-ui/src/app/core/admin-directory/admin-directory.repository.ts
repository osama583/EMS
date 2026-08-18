import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeletionPreview } from '../../shared/models/deletion.models';
import { Archived, AdminDirectoryRepository, AdminNavPageDraft, AdminNavPageGrant, AdminNavPageGrantDraft, AdminNavPageRecord, AdminRoleDraft, AdminRoleRecord, AdminUnitDraft, AdminUnitRecord, AdminUserAssignment, AdminUserDraft, AdminUserRecord } from './admin-directory.models';

@Injectable({ providedIn: 'root' })
export class ApiAdminDirectoryRepository implements AdminDirectoryRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/admin`;
  getUsers(): Observable<readonly AdminUserRecord[]> { return this.http.get<readonly AdminUserRecord[]>(`${this.baseUrl}/users`); }
  getUnits(): Observable<readonly AdminUnitRecord[]> { return this.http.get<readonly AdminUnitRecord[]>(`${this.baseUrl}/units`); }
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.post<AdminUserRecord>(`${this.baseUrl}/users`, draft); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.http.put<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}`, draft); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> { return this.http.patch<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}/status`, { active }); }
  checkUserDeletion(id: string): Observable<DeletionPreview> { return this.http.get<DeletionPreview>(`${this.baseUrl}/users/${encodeURIComponent(id)}/deletion-check`); }
  deleteUser(id: string): Observable<AdminUserRecord> { return this.http.delete<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}`); }
  restoreUser(id: string): Observable<AdminUserRecord> { return this.http.post<AdminUserRecord>(`${this.baseUrl}/users/${encodeURIComponent(id)}/restore`, {}); }
  purgeUser(id: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/users/${encodeURIComponent(id)}/purge`); }
  getDeletedUsers(): Observable<readonly Archived<AdminUserRecord>[]> { return this.http.get<readonly Archived<AdminUserRecord>[]>(`${this.baseUrl}/users/deleted`); }
  getUserAssignments(userId: string): Observable<readonly AdminUserAssignment[]> { return this.http.get<readonly AdminUserAssignment[]>(`${this.baseUrl}/users/${encodeURIComponent(userId)}/assignments`); }
  assignRole(userId: string, roleCode: string, unitCode?: string): Observable<readonly AdminUserAssignment[]> { return this.http.post<readonly AdminUserAssignment[]>(`${this.baseUrl}/users/${encodeURIComponent(userId)}/assignments`, { roleCode, unitCode }); }
  removeAssignment(userId: string, assignmentId: string): Observable<readonly AdminUserAssignment[]> { return this.http.delete<readonly AdminUserAssignment[]>(`${this.baseUrl}/users/${encodeURIComponent(userId)}/assignments/${encodeURIComponent(assignmentId)}`); }
  getEligibleRolesForUnit(unitCode: string): Observable<readonly AdminRoleRecord[]> { return this.http.get<readonly AdminRoleRecord[]>(`${this.baseUrl}/units/${encodeURIComponent(unitCode)}/eligible-roles`); }
  getFlatRoles(): Observable<readonly AdminRoleRecord[]> { return this.http.get<readonly AdminRoleRecord[]>(`${this.baseUrl}/roles/flat`); }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.post<AdminUnitRecord>(`${this.baseUrl}/units`, draft); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.http.put<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}`, draft); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> { return this.http.patch<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}/status`, { active }); }
  checkUnitDeletion(id: string): Observable<DeletionPreview> { return this.http.get<DeletionPreview>(`${this.baseUrl}/units/${encodeURIComponent(id)}/deletion-check`); }
  deleteUnit(id: string): Observable<AdminUnitRecord> { return this.http.delete<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}`); }
  restoreUnit(id: string): Observable<AdminUnitRecord> { return this.http.post<AdminUnitRecord>(`${this.baseUrl}/units/${encodeURIComponent(id)}/restore`, {}); }
  purgeUnit(id: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/units/${encodeURIComponent(id)}/purge`); }
  getDeletedUnits(): Observable<readonly Archived<AdminUnitRecord>[]> { return this.http.get<readonly Archived<AdminUnitRecord>[]>(`${this.baseUrl}/units/archive`); }
  getRoles(): Observable<readonly AdminRoleRecord[]> { return this.http.get<readonly AdminRoleRecord[]>(`${this.baseUrl}/roles`); }
  createRole(draft: AdminRoleDraft): Observable<AdminRoleRecord> { return this.http.post<AdminRoleRecord>(`${this.baseUrl}/roles`, draft); }
  updateRole(code: string, draft: Partial<AdminRoleDraft>): Observable<AdminRoleRecord> { return this.http.put<AdminRoleRecord>(`${this.baseUrl}/roles/${encodeURIComponent(code)}`, draft); }
  checkRoleDeletion(code: string): Observable<DeletionPreview> { return this.http.get<DeletionPreview>(`${this.baseUrl}/roles/${encodeURIComponent(code)}/deletion-check`); }
  deleteRole(code: string): Observable<AdminRoleRecord> { return this.http.delete<AdminRoleRecord>(`${this.baseUrl}/roles/${encodeURIComponent(code)}`); }
  restoreRole(code: string): Observable<AdminRoleRecord> { return this.http.post<AdminRoleRecord>(`${this.baseUrl}/roles/${encodeURIComponent(code)}/restore`, {}); }
  purgeRole(code: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/roles/${encodeURIComponent(code)}/purge`); }
  getDeletedRoles(): Observable<readonly Archived<AdminRoleRecord>[]> { return this.http.get<readonly Archived<AdminRoleRecord>[]>(`${this.baseUrl}/roles/archive`); }
  getNavPages(): Observable<readonly AdminNavPageRecord[]> { return this.http.get<readonly AdminNavPageRecord[]>(`${this.baseUrl}/nav-pages`); }
  createNavPage(draft: AdminNavPageDraft): Observable<AdminNavPageRecord> { return this.http.post<AdminNavPageRecord>(`${this.baseUrl}/nav-pages`, draft); }
  updateNavPage(code: string, draft: Partial<AdminNavPageDraft>): Observable<AdminNavPageRecord> { return this.http.put<AdminNavPageRecord>(`${this.baseUrl}/nav-pages/${encodeURIComponent(code)}`, draft); }
  checkNavPageDeletion(code: string): Observable<DeletionPreview> { return this.http.get<DeletionPreview>(`${this.baseUrl}/nav-pages/${encodeURIComponent(code)}/deletion-check`); }
  deleteNavPage(code: string): Observable<AdminNavPageRecord> { return this.http.delete<AdminNavPageRecord>(`${this.baseUrl}/nav-pages/${encodeURIComponent(code)}`); }
  restoreNavPage(code: string): Observable<AdminNavPageRecord> { return this.http.post<AdminNavPageRecord>(`${this.baseUrl}/nav-pages/${encodeURIComponent(code)}/restore`, {}); }
  purgeNavPage(code: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/nav-pages/${encodeURIComponent(code)}/purge`); }
  getDeletedNavPages(): Observable<readonly Archived<AdminNavPageRecord>[]> { return this.http.get<readonly Archived<AdminNavPageRecord>[]>(`${this.baseUrl}/nav-pages/deleted`); }
  eligibleRolesForUnits(unitCodes: readonly string[]): Observable<readonly AdminRoleRecord[]> {
    return this.http.get<readonly AdminRoleRecord[]>(`${this.baseUrl}/nav-pages/eligible-roles`, { params: { unitCodes: unitCodes.join(',') } });
  }
  addNavPageGrant(pageCode: string, draft: AdminNavPageGrantDraft): Observable<AdminNavPageGrant> {
    return this.http.post<AdminNavPageGrant>(`${this.baseUrl}/nav-pages/${encodeURIComponent(pageCode)}/grants`, draft);
  }
  updateNavPageGrant(pageCode: string, grantId: number, draft: AdminNavPageGrantDraft): Observable<AdminNavPageGrant> {
    return this.http.put<AdminNavPageGrant>(`${this.baseUrl}/nav-pages/${encodeURIComponent(pageCode)}/grants/${grantId}`, draft);
  }
  setNavPageGrantActive(pageCode: string, grantId: number, active: boolean): Observable<AdminNavPageGrant> {
    return this.http.patch<AdminNavPageGrant>(`${this.baseUrl}/nav-pages/${encodeURIComponent(pageCode)}/grants/${grantId}`, { active });
  }
  removeNavPageGrant(pageCode: string, grantId: number): Observable<AdminNavPageGrant> {
    return this.http.delete<AdminNavPageGrant>(`${this.baseUrl}/nav-pages/${encodeURIComponent(pageCode)}/grants/${grantId}`);
  }
}

export const ADMIN_DIRECTORY_REPOSITORY = new InjectionToken<AdminDirectoryRepository>('ADMIN_DIRECTORY_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiAdminDirectoryRepository),
});
