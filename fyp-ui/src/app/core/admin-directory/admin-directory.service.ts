import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay, switchMap, tap } from 'rxjs';
import { ADMIN_DIRECTORY_REPOSITORY } from './admin-directory.repository';
import { DeletionPreview } from '../../shared/models/deletion.models';
import { Archived, AdminNavPageDraft, AdminNavPageGrant, AdminNavPageGrantDraft, AdminNavPageRecord, AdminRoleDraft, AdminRoleRecord, AdminUnitDraft, AdminUnitRecord, AdminUserAssignment, AdminUserDraft, AdminUserRecord } from './admin-directory.models';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class AdminDirectoryService {
  private readonly repository = inject(ADMIN_DIRECTORY_REPOSITORY);
  private readonly auth = inject(AuthService);
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);
  readonly users$ = this.refreshRequests.pipe(switchMap(() => this.repository.getUsers()), shareReplay({ bufferSize: 1, refCount: true }));
  readonly units$ = this.refreshRequests.pipe(switchMap(() => this.repository.getUnits()), shareReplay({ bufferSize: 1, refCount: true }));
  readonly roles$ = this.refreshRequests.pipe(switchMap(() => this.repository.getRoles()), shareReplay({ bufferSize: 1, refCount: true }));
  readonly navPages$ = this.refreshRequests.pipe(switchMap(() => this.repository.getNavPages()), shareReplay({ bufferSize: 1, refCount: true }));
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.repository.createUser(draft).pipe(tap(() => this.refresh())); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.repository.updateUser(id, draft).pipe(tap(() => this.refresh())); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> { return this.repository.setUserActive(id, active).pipe(tap(() => this.refresh())); }
  checkUserDeletion(id: string): Observable<DeletionPreview> { return this.repository.checkUserDeletion(id); }
  deleteUser(id: string): Observable<AdminUserRecord> { return this.repository.deleteUser(id).pipe(tap(() => this.refresh())); }
  restoreUser(id: string): Observable<AdminUserRecord> { return this.repository.restoreUser(id).pipe(tap(() => this.refresh())); }
  purgeUser(id: string): Observable<void> { return this.repository.purgeUser(id).pipe(tap(() => this.refresh())); }
  getDeletedUsers(): Observable<readonly Archived<AdminUserRecord>[]> { return this.repository.getDeletedUsers(); }
  getUserAssignments(userId: string): Observable<readonly AdminUserAssignment[]> { return this.repository.getUserAssignments(userId); }
  assignRole(userId: string, roleCode: string, unitCode?: string): Observable<readonly AdminUserAssignment[]> { return this.repository.assignRole(userId, roleCode, unitCode).pipe(tap(() => this.refresh())); }
  removeAssignment(userId: string, assignmentId: string): Observable<readonly AdminUserAssignment[]> { return this.repository.removeAssignment(userId, assignmentId).pipe(tap(() => this.refresh())); }
  getEligibleRolesForUnit(unitCode: string): Observable<readonly AdminRoleRecord[]> { return this.repository.getEligibleRolesForUnit(unitCode); }
  getFlatRoles(): Observable<readonly AdminRoleRecord[]> { return this.repository.getFlatRoles(); }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.repository.createUnit(draft).pipe(tap(() => this.refresh())); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.repository.updateUnit(id, draft).pipe(tap(() => this.refresh())); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> { return this.repository.setUnitActive(id, active).pipe(tap(() => this.refresh())); }
  checkUnitDeletion(id: string): Observable<DeletionPreview> { return this.repository.checkUnitDeletion(id); }
  deleteUnit(id: string): Observable<AdminUnitRecord> { return this.repository.deleteUnit(id).pipe(tap(() => this.refresh())); }
  restoreUnit(id: string): Observable<AdminUnitRecord> { return this.repository.restoreUnit(id).pipe(tap(() => this.refresh())); }
  purgeUnit(id: string): Observable<void> { return this.repository.purgeUnit(id).pipe(tap(() => this.refresh())); }
  getDeletedUnits(): Observable<readonly Archived<AdminUnitRecord>[]> { return this.repository.getDeletedUnits(); }
  createRole(draft: AdminRoleDraft): Observable<AdminRoleRecord> { return this.repository.createRole(draft).pipe(tap(() => this.refresh())); }
  updateRole(code: string, draft: Partial<AdminRoleDraft>): Observable<AdminRoleRecord> { return this.repository.updateRole(code, draft).pipe(tap(() => this.refresh())); }
  checkRoleDeletion(code: string): Observable<DeletionPreview> { return this.repository.checkRoleDeletion(code); }
  deleteRole(code: string): Observable<AdminRoleRecord> { return this.repository.deleteRole(code).pipe(tap(() => this.refresh())); }
  restoreRole(code: string): Observable<AdminRoleRecord> { return this.repository.restoreRole(code).pipe(tap(() => this.refresh())); }
  purgeRole(code: string): Observable<void> { return this.repository.purgeRole(code).pipe(tap(() => this.refresh())); }
  getDeletedRoles(): Observable<readonly Archived<AdminRoleRecord>[]> { return this.repository.getDeletedRoles(); }
  createNavPage(draft: AdminNavPageDraft): Observable<AdminNavPageRecord> { return this.repository.createNavPage(draft).pipe(tap(() => this.refresh())); }
  updateNavPage(code: string, draft: Partial<AdminNavPageDraft>): Observable<AdminNavPageRecord> { return this.repository.updateNavPage(code, draft).pipe(tap(() => this.refresh())); }
  checkNavPageDeletion(code: string): Observable<DeletionPreview> { return this.repository.checkNavPageDeletion(code); }
  deleteNavPage(code: string): Observable<AdminNavPageRecord> { return this.repository.deleteNavPage(code).pipe(tap(() => this.refresh())); }
  restoreNavPage(code: string): Observable<AdminNavPageRecord> { return this.repository.restoreNavPage(code).pipe(tap(() => this.refresh())); }
  purgeNavPage(code: string): Observable<void> { return this.repository.purgeNavPage(code).pipe(tap(() => this.refresh())); }
  getDeletedNavPages(): Observable<readonly Archived<AdminNavPageRecord>[]> { return this.repository.getDeletedNavPages(); }
  eligibleRolesForUnits(unitCodes: readonly string[]): Observable<readonly AdminRoleRecord[]> { return this.repository.eligibleRolesForUnits(unitCodes); }
  addNavPageGrant(pageCode: string, draft: AdminNavPageGrantDraft): Observable<AdminNavPageGrant> { return this.repository.addNavPageGrant(pageCode, draft).pipe(tap(() => this.refresh())); }
  updateNavPageGrant(pageCode: string, grantId: number, draft: AdminNavPageGrantDraft): Observable<AdminNavPageGrant> { return this.repository.updateNavPageGrant(pageCode, grantId, draft).pipe(tap(() => this.refresh())); }
  setNavPageGrantActive(pageCode: string, grantId: number, active: boolean): Observable<AdminNavPageGrant> { return this.repository.setNavPageGrantActive(pageCode, grantId, active).pipe(tap(() => this.refresh())); }
  removeNavPageGrant(pageCode: string, grantId: number): Observable<AdminNavPageGrant> { return this.repository.removeNavPageGrant(pageCode, grantId).pipe(tap(() => this.refresh())); }
  // Every mutation above (users/units/roles/nav pages) can change what the CURRENT admin's own
  // sidebar should show — a role gaining/losing a nav_page grant, a unit being renamed, a page
  // being added — so every one of them re-syncs the logged-in session's nav tree here, not just
  // this page's own table. Subscribing to the auth refresh is fire-and-forget: it already
  // swallows its own errors (see AuthService.refreshSession()) and this page's own success/error
  // messaging is driven by the mutation's own request, not by this side effect.
  refresh(): void {
    this.refreshRequests.next();
    this.auth.refreshSession().subscribe();
  }
}
