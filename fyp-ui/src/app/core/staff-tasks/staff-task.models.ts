import { Observable } from 'rxjs';

// 'cancelled' arrives when the applicant cancels the whole proposal — the task leaves the
// assignee's active list and appears in their History as cancelled (system specification §4).
export type StaffTaskStatus = 'assigned' | 'preparing' | 'completed' | 'cancelled';

// `role` on the wire is a routing key, not a UserRole: for the 5 Service department-routed
// requirement kinds it's the unit's own unitCode (see server/routes/staff-tasks.routes.js and
// department-workflow.config.ts's UNIT_DEPARTMENT_WORKFLOWS unitCode values); for the two
// flat-routed kinds it stays a flat role string ('cafeteria-staff' for the F&B cafeteria fan-out).
export type StaffTaskRoutingKey = string;

export interface StaffTask {
  // request_task_id — several StaffTask entries can share one id when a single department task
  // covers multiple requested rows (three logistics items, two vehicles, …). Acting on any of
  // them progresses the same underlying task.
  readonly id: string;
  // Stable per-row identity for list rendering, since `id` is not unique across rows.
  readonly rowKey: string;
  readonly role: StaffTaskRoutingKey;
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

export type StaffTaskAssignmentDraft = Omit<StaffTask, 'id' | 'rowKey' | 'status' | 'completedAt'> & { readonly assignedByEmail: string };

export interface StaffTaskRepository {
  list(role: StaffTaskRoutingKey, assignedToEmail: string): Observable<readonly StaffTask[]>;
  assign(draft: StaffTaskAssignmentDraft): Observable<StaffTask>;
  updateStatus(id: string, status: StaffTaskStatus, staffEmail: string): Observable<StaffTask>;
}
