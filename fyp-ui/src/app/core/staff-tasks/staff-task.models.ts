import { Observable } from 'rxjs';
import { UserRole } from '../auth/auth.models';

export type StaffTaskStatus = 'assigned' | 'in-progress' | 'completed';

export interface StaffTask {
  readonly id: string;
  readonly role: UserRole;
  readonly assignedToEmail: string;
  readonly eventCode: string;
  readonly eventTitle: string;
  readonly request: string;
  readonly quantity?: string;
  readonly schedule: string;
  readonly location: string;
  readonly detailLabel: string;
  readonly detail: string;
  readonly status: StaffTaskStatus;
  readonly completedAt?: string;
}

export type StaffTaskAssignmentDraft = Omit<StaffTask, 'id' | 'status' | 'completedAt'>;

export interface StaffTaskRepository {
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]>;
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask>;
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask>;
}
