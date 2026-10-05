import { Observable } from 'rxjs';
import { DepartmentRequestKind } from '../departments/department-workflow.config';

export type RowAssignmentStatus = 'assigned' | 'preparing' | 'completed';

/** One staff member assigned to one specific requested row (see migration 012). */
export interface RowAssignment {
  readonly id: number;
  readonly requirementName: DepartmentRequestKind;
  readonly rowId: number;
  readonly staffUserId: number;
  readonly staffName: string;
  readonly staffEmail: string;
  readonly status: RowAssignmentStatus;
  readonly assignedAt: string;
  readonly resolvedAt?: string;
}

export interface RowAssignmentsForTask {
  readonly assignments: readonly RowAssignment[];
  /** True once every row of this task's requirement has at least one assignee — the Approve modal's gate. */
  readonly fullyStaffed: boolean;
}

/** A candidate the picker may assign — see GET /tasks/:id/assignable-staff. */
export interface AssignableStaff {
  readonly userId: number;
  readonly displayName: string;
  readonly email: string;
}

/** One row assignment as it appears on the assigned staff member's own My Tasks page. */
export interface MyRowAssignment {
  readonly id: number;
  readonly requirementName: DepartmentRequestKind;
  readonly rowId: number;
  readonly status: RowAssignmentStatus;
  readonly assignedAt: string;
  readonly resolvedAt?: string;
  readonly requestId: number;
  readonly proposalId: string;
  readonly eventTitle: string;
  readonly requestStatus: string;
  // The row's own display fields — same per-row projection the manager's department view reads
  // (see proposals.py's flatten_requests()), so a staff member sees the actual item/quantity/
  // schedule/location they were assigned to, not just an opaque row id.
  readonly item: string;
  readonly quantity: string;
  readonly schedule: string;
  readonly location: string;
  readonly notes: string;
  // Raw ISO date-time (YYYY-MM-DDTHH:mm:ss) of the row's own scheduled start — unlike `schedule` (a
  // pre-formatted display string), this is for date math: the My Tasks calendar's day-dot indicator
  // and the same-day-start gate (see department-workflow.config.ts's requiresSameDayStart).
  readonly deadline: string;
  // Display names of every OTHER staff member assigned to this SAME row (see migration 012 — a
  // row can have several assignees, e.g. two Logistics staff on one big chairs/tables setup).
  // Empty when this staff member is the sole assignee.
  readonly partners: readonly string[];
}

/** The server's paginated envelope — mirrors proposal-workflow.repository.ts's Page<T>. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export type MyRowAssignmentSortKey = 'schedule' | 'event' | 'status';
export type SortOrder = 'asc' | 'desc';

/** Every filter/sort/page control on My Tasks is a real server query param — see
 * GET /tasks/my-row-assignments in api/tasks.py. Nothing here is filtered client-side. */
export interface MyRowAssignmentQuery {
  readonly mode: 'active' | 'history';
  readonly page: number;
  readonly pageSize: number;
  readonly status?: string;
  readonly q?: string;
  readonly dateStart?: string;
  readonly dateEnd?: string;
  readonly sort?: MyRowAssignmentSortKey;
  readonly order?: SortOrder;
}

export interface RowAssignmentRepository {
  taskIdForDepartment(proposalId: number, requirementName: DepartmentRequestKind): Observable<number>;
  assignableStaff(taskId: number): Observable<readonly AssignableStaff[]>;
  rowAssignments(taskId: number, requirementName: DepartmentRequestKind): Observable<RowAssignmentsForTask>;
  assignToRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void>;
  unassignFromRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void>;
  updateRowStatus(rowAssignmentId: number, status: RowAssignmentStatus): Observable<RowAssignment>;
  myRowAssignments(query: MyRowAssignmentQuery): Observable<Page<MyRowAssignment>>;
  /** Distinct deadline days (YYYY-MM-DD) — feeds the calendar's dot indicator. */
  myRowAssignmentDates(mode: 'active' | 'history'): Observable<readonly string[]>;
}
