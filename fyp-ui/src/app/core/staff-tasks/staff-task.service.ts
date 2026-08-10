import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskStatus } from './staff-task.models';
import { STAFF_TASK_REPOSITORY } from './staff-task.repository';

@Injectable({ providedIn: 'root' })
export class StaffTaskService {
  private readonly repository = inject(STAFF_TASK_REPOSITORY);
  list(role: UserRole, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.repository.list(role, assignedToEmail); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.repository.assign(draft); }
  updateStatus(id: string, status: StaffTaskStatus): Observable<StaffTask> { return this.repository.updateStatus(id, status); }
}
