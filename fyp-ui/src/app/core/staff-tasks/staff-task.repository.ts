import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StaffTask, StaffTaskAssignmentDraft, StaffTaskRepository, StaffTaskRoutingKey, StaffTaskStatus } from './staff-task.models';

@Injectable({ providedIn: 'root' })
export class ApiStaffTaskRepository implements StaffTaskRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/tasks`;
  list(role: StaffTaskRoutingKey, assignedToEmail: string): Observable<readonly StaffTask[]> { return this.http.get<readonly StaffTask[]>(this.baseUrl, { params: { role, assignedToEmail } }); }
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask> { return this.http.post<StaffTask>(`${this.baseUrl}/assignments`, draft); }
  updateStatus(id: string, status: StaffTaskStatus, staffEmail: string): Observable<StaffTask> { return this.http.patch<StaffTask>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { status, staffEmail }); }
}

export const STAFF_TASK_REPOSITORY = new InjectionToken<StaffTaskRepository>('STAFF_TASK_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiStaffTaskRepository),
});
