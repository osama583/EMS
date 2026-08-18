import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskRoutingKey, StaffTaskStatus } from './staff-task.models';
import { STAFF_TASK_REPOSITORY } from './staff-task.repository';

@Injectable({ providedIn: 'root' })
export class StaffTaskService {
  private readonly repository = inject(STAFF_TASK_REPOSITORY);
  list(role: StaffTaskRoutingKey, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.repository.list(role, assignedToEmail); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.repository.assign(draft); }
  updateStatus(id: string, status: StaffTaskStatus, staffEmail: string): Observable<StaffTask> { return this.repository.updateStatus(id, status, staffEmail); }
}
