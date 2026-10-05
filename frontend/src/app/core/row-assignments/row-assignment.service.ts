import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { AssignableStaff, MyRowAssignment, MyRowAssignmentQuery, Page, RowAssignment, RowAssignmentsForTask, RowAssignmentStatus } from './row-assignment.models';
import { ROW_ASSIGNMENT_REPOSITORY } from './row-assignment.repository';

@Injectable({ providedIn: 'root' })
export class RowAssignmentService {
  private readonly repository = inject(ROW_ASSIGNMENT_REPOSITORY);

  taskIdForDepartment(proposalId: number, requirementName: DepartmentRequestKind): Observable<number> {
    return this.repository.taskIdForDepartment(proposalId, requirementName);
  }

  assignableStaff(taskId: number): Observable<readonly AssignableStaff[]> {
    return this.repository.assignableStaff(taskId);
  }

  rowAssignments(taskId: number, requirementName: DepartmentRequestKind): Observable<RowAssignmentsForTask> {
    return this.repository.rowAssignments(taskId, requirementName);
  }

  assignToRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void> {
    return this.repository.assignToRow(taskId, requirementName, rowId, staffUserId);
  }

  unassignFromRow(taskId: number, requirementName: DepartmentRequestKind, rowId: number, staffUserId: number): Observable<void> {
    return this.repository.unassignFromRow(taskId, requirementName, rowId, staffUserId);
  }

  updateRowStatus(rowAssignmentId: number, status: RowAssignmentStatus): Observable<RowAssignment> {
    return this.repository.updateRowStatus(rowAssignmentId, status);
  }

  myRowAssignments(query: MyRowAssignmentQuery): Observable<Page<MyRowAssignment>> {
    return this.repository.myRowAssignments(query);
  }

  myRowAssignmentDates(mode: 'active' | 'history'): Observable<readonly string[]> {
    return this.repository.myRowAssignmentDates(mode);
  }
}
