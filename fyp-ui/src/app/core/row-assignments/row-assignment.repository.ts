import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import {
  AssignableStaff,
  MyRowAssignment,
  MyRowAssignmentQuery,
  Page,
  RowAssignment,
  RowAssignmentRepository,
  RowAssignmentsForTask,
  RowAssignmentStatus,
} from './row-assignment.models';

interface RawRowAssignment {
  readonly request_row_assignment_id: number;
  readonly requirement_name?: string;
  readonly row_id: number;
  readonly staff_user_id: number;
  readonly full_name?: string;
  readonly email?: string;
  readonly status: RowAssignmentStatus;
  readonly assigned_at: string;
  readonly resolved_at?: string;
}

function toRowAssignment(raw: RawRowAssignment, requirementName: DepartmentRequestKind): RowAssignment {
  return {
    id: raw.request_row_assignment_id,
    requirementName: (raw.requirement_name as DepartmentRequestKind) ?? requirementName,
    rowId: raw.row_id,
    staffUserId: raw.staff_user_id,
    staffName: raw.full_name ?? '',
    staffEmail: raw.email ?? '',
    status: raw.status,
    assignedAt: raw.assigned_at,
    resolvedAt: raw.resolved_at,
  };
}

@Injectable({ providedIn: 'root' })
export class ApiRowAssignmentRepository implements RowAssignmentRepository {
  private readonly http = inject(HttpClient);
  private readonly tasksUrl = `${environment.apiBaseUrl}/tasks`;
  private readonly proposalsUrl = `${environment.apiBaseUrl}/proposals`;

  taskIdForDepartment(proposalId: number, requirementName: DepartmentRequestKind): Observable<number> {
    return this.http
      .get<readonly { request_task_id: number; requirement_name: string }[]>(`${this.proposalsUrl}/${proposalId}/tasks`)
      .pipe(
        map((tasks) => {
          const task = tasks.find((candidate) => candidate.requirement_name === requirementName);
          if (!task) throw new Error(`No ${requirementName} task exists on this proposal.`);
          return task.request_task_id;
        }),
      );
  }

  assignableStaff(taskId: number): Observable<readonly AssignableStaff[]> {
    return this.http
      .get<readonly { user_id: number; full_name: string; email: string }[]>(`${this.tasksUrl}/${taskId}/assignable-staff`)
      .pipe(map((rows) => rows.map((row) => ({ userId: row.user_id, displayName: row.full_name, email: row.email }))));
  }

  rowAssignments(taskId: number, requirementName: DepartmentRequestKind): Observable<RowAssignmentsForTask> {
    return this.http
      .get<{ assignments: readonly RawRowAssignment[]; fullyStaffed: boolean }>(
        `${this.tasksUrl}/${taskId}/rows/${requirementName}/assignments`,
      )
      .pipe(
        map((result) => ({
          assignments: result.assignments.map((raw) => toRowAssignment(raw, requirementName)),
          fullyStaffed: result.fullyStaffed,
        })),
      );
  }

  assignToRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void> {
    return this.http
      .post(`${this.tasksUrl}/${taskId}/rows/${requirementName}/${rowId}/assignments`, { staffUserId })
      .pipe(map(() => undefined));
  }

  unassignFromRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void> {
    return this.http
      .delete(`${this.tasksUrl}/${taskId}/rows/${requirementName}/${rowId}/assignments/${staffUserId}`)
      .pipe(map(() => undefined));
  }

  updateRowStatus(rowAssignmentId: number, status: RowAssignmentStatus): Observable<RowAssignment> {
    return this.http
      .patch<RawRowAssignment>(`${this.tasksUrl}/row-assignments/${rowAssignmentId}`, { status })
      .pipe(map((raw) => toRowAssignment(raw, raw.requirement_name as DepartmentRequestKind)));
  }

  myRowAssignments(query: MyRowAssignmentQuery): Observable<Page<MyRowAssignment>> {
    let params = new HttpParams()
      .set('mode', query.mode)
      .set('page', query.page)
      .set('pageSize', query.pageSize);
    if (query.status) params = params.set('status', query.status);
    if (query.q) params = params.set('q', query.q);
    if (query.dateStart) params = params.set('dateStart', query.dateStart);
    if (query.dateEnd) params = params.set('dateEnd', query.dateEnd);
    if (query.sort) params = params.set('sort', query.sort);
    if (query.order) params = params.set('order', query.order);

    return this.http
      .get<
        Page<{
          request_row_assignment_id: number;
          requirement_name: DepartmentRequestKind;
          row_id: number;
          status: RowAssignmentStatus;
          assigned_at: string;
          resolved_at?: string;
          request_id: number;
          request_code: string;
          event_title: string;
          request_status: string;
          item: string;
          quantity: string;
          schedule: string;
          location: string;
          notes: string;
          deadline: string;
          partners: readonly string[];
        }>
      >(`${this.tasksUrl}/my-row-assignments`, { params })
      .pipe(
        map((page) => ({
          ...page,
          items: page.items.map((row) => ({
            id: row.request_row_assignment_id,
            requirementName: row.requirement_name,
            rowId: row.row_id,
            status: row.status,
            assignedAt: row.assigned_at,
            resolvedAt: row.resolved_at,
            requestId: row.request_id,
            proposalId: row.request_code,
            eventTitle: row.event_title,
            requestStatus: row.request_status,
            item: row.item,
            quantity: row.quantity,
            schedule: row.schedule,
            location: row.location,
            notes: row.notes,
            deadline: row.deadline,
            partners: row.partners ?? [],
          })),
        })),
      );
  }

  myRowAssignmentDates(mode: 'active' | 'history'): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.tasksUrl}/my-row-assignments/dates`, { params: { mode } });
  }
}

export const ROW_ASSIGNMENT_REPOSITORY = new InjectionToken<RowAssignmentRepository>('ROW_ASSIGNMENT_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(ApiRowAssignmentRepository),
});
