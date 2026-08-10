import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay, switchMap, tap } from 'rxjs';
import { ADMIN_DIRECTORY_REPOSITORY } from './admin-directory.repository';
import { AdminUnitDraft, AdminUnitRecord, AdminUserDraft, AdminUserRecord } from './admin-directory.models';

@Injectable({ providedIn: 'root' })
export class AdminDirectoryService {
  private readonly repository = inject(ADMIN_DIRECTORY_REPOSITORY);
  private readonly refreshRequests = new BehaviorSubject<void>(undefined);
  readonly users$ = this.refreshRequests.pipe(switchMap(() => this.repository.getUsers()), shareReplay({ bufferSize: 1, refCount: true }));
  readonly units$ = this.refreshRequests.pipe(switchMap(() => this.repository.getUnits()), shareReplay({ bufferSize: 1, refCount: true }));
  createUser(draft: AdminUserDraft): Observable<AdminUserRecord> { return this.repository.createUser(draft).pipe(tap(() => this.refresh())); }
  updateUser(id: string, draft: AdminUserDraft): Observable<AdminUserRecord> { return this.repository.updateUser(id, draft).pipe(tap(() => this.refresh())); }
  setUserActive(id: string, active: boolean): Observable<AdminUserRecord> { return this.repository.setUserActive(id, active).pipe(tap(() => this.refresh())); }
  createUnit(draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.repository.createUnit(draft).pipe(tap(() => this.refresh())); }
  updateUnit(id: string, draft: AdminUnitDraft): Observable<AdminUnitRecord> { return this.repository.updateUnit(id, draft).pipe(tap(() => this.refresh())); }
  setUnitActive(id: string, active: boolean): Observable<AdminUnitRecord> { return this.repository.setUnitActive(id, active).pipe(tap(() => this.refresh())); }
  refresh(): void { this.refreshRequests.next(); }
}

