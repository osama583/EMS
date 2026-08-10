import { UserRole } from '../auth/auth.models';

export interface AdminUserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  readonly role: UserRole;
  readonly roleLabel: string;
  readonly unitId: string;
  readonly department: string;
  readonly active: boolean;
}

export interface AdminUnitRecord {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly description?: string;
  readonly active: boolean;
}

export type AdminUserDraft = Omit<AdminUserRecord, 'id' | 'roleLabel' | 'department'>;
export type AdminUnitDraft = Omit<AdminUnitRecord, 'id'>;

export interface AdminDirectoryRepository {
  getUsers(): import('rxjs').Observable<readonly AdminUserRecord[]>;
  getUnits(): import('rxjs').Observable<readonly AdminUnitRecord[]>;
  createUser(draft: AdminUserDraft): import('rxjs').Observable<AdminUserRecord>;
  updateUser(id: string, draft: AdminUserDraft): import('rxjs').Observable<AdminUserRecord>;
  setUserActive(id: string, active: boolean): import('rxjs').Observable<AdminUserRecord>;
  createUnit(draft: AdminUnitDraft): import('rxjs').Observable<AdminUnitRecord>;
  updateUnit(id: string, draft: AdminUnitDraft): import('rxjs').Observable<AdminUnitRecord>;
  setUnitActive(id: string, active: boolean): import('rxjs').Observable<AdminUnitRecord>;
}

