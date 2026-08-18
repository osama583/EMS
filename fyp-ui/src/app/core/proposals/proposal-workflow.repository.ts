import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';

/**
 * No method here takes an acting-user identity.
 *
 * The previous mock backend resolved the actor from a client-supplied field
 * (`reviewerEmail`, `actorEmail`, `cancelledBy` — it varied per route), which
 * meant any client could claim to be anyone. The Flask API reads the actor from
 * the bearer token, so those parameters are gone entirely rather than merely
 * ignored.
 */

export interface FmbSelectionDraft {
  readonly requestFmbId: number;
  readonly cafeteriaCode: string;
  readonly fmbOptionId: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly notes?: string;
}

export interface FmbSelectionEdit {
  readonly cafeteriaCode?: string;
  readonly fmbOptionId?: string;
  readonly menuItemLabel?: string;
  readonly quantity?: number;
  readonly notes?: string;
  readonly cancel?: boolean;
}

/** The server's paginated envelope for list endpoints. */
interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ProposalWorkflowRepository {
  /**
   * Proposals the CALLER may see — their own, ones they co-own, and ones
   * awaiting their decision. Scoped server-side; the client no longer filters.
   */
  list(): Observable<readonly ProposalReviewRecord[]>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  deleteDraft(id: number): Observable<void>;

  approveAsReviewer(id: number): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reason: string): Observable<ProposalReviewRecord>;
  sendBackAsReviewer(id: number, comment: string): Observable<ProposalReviewRecord>;

  confirmDepartment(id: number, department: DepartmentRequestKind): Observable<ProposalReviewRecord>;
  sendBackAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;

  /** `payload` is the proposal form's full submission shape, including child rows. */
  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  /** Persist in-progress edits without advancing the stage or clearing the comment. */
  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number): Observable<ProposalReviewRecord>;

  createFmbSelection(id: number, draft: FmbSelectionDraft): Observable<ProposalReviewRecord>;
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord>;
  sendBackFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord>;
  /** Change dish, quantity or cafeteria, or cancel. Saving IS the re-send. */
  editFmbSelection(id: number, selectionId: number, edit: FmbSelectionEdit): Observable<ProposalReviewRecord>;
}

@Injectable({ providedIn: 'root' })
export class ApiProposalWorkflowRepository implements ProposalWorkflowRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/proposals`;
  private readonly tasksUrl = `${environment.apiBaseUrl}/tasks`;
  private readonly ordersUrl = `${environment.apiBaseUrl}/cafeteria-orders`;

  list(): Observable<readonly ProposalReviewRecord[]> {
    return this.http
      .get<Page<ProposalReviewRecord>>(this.baseUrl, { params: { pageSize: 200 } })
      .pipe(map((page) => page.items));
  }

  getById(id: number): Observable<ProposalReviewRecord | undefined> {
    return this.http.get<ProposalReviewRecord>(`${this.baseUrl}/${id}`);
  }

  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(this.baseUrl, payload);
  }

  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/drafts`, payload);
  }

  deleteDraft(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // The three reviewer verbs share one endpoint: they differ only in outcome.
  approveAsReviewer(id: number): Observable<ProposalReviewRecord> {
    return this.decide(id, 'approve');
  }

  rejectAsReviewer(id: number, reason: string): Observable<ProposalReviewRecord> {
    return this.decide(id, 'reject', reason);
  }

  sendBackAsReviewer(id: number, comment: string): Observable<ProposalReviewRecord> {
    return this.decide(id, 'send-back', comment);
  }

  private decide(id: number, decision: string, comment?: string): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/decision`, { decision, comment });
  }

  confirmDepartment(id: number, department: DepartmentRequestKind): Observable<ProposalReviewRecord> {
    return this.departmentDecision(id, department, 'approve');
  }

  sendBackAsDepartment(
    id: number,
    department: DepartmentRequestKind,
    comment: string,
  ): Observable<ProposalReviewRecord> {
    return this.departmentDecision(id, department, 'send-back', comment);
  }

  /**
   * Department actions address the TASK, not the proposal, so the task id is
   * resolved first. The extra round trip buys a genuinely RESTful task
   * resource that the staff-assignment screens also use.
   */
  private departmentDecision(
    id: number,
    department: DepartmentRequestKind,
    decision: string,
    comment?: string,
  ): Observable<ProposalReviewRecord> {
    return this.http
      .get<readonly { request_task_id: number; requirement_name: string }[]>(`${this.baseUrl}/${id}/tasks`)
      .pipe(
        map((tasks) => {
          const task = tasks.find((candidate) => candidate.requirement_name === department);
          if (!task) throw new Error(`No ${department} task exists on this proposal.`);
          return task.request_task_id;
        }),
        switchMap((taskId) => this.http.post(`${this.tasksUrl}/${taskId}/decision`, { decision, comment })),
        switchMap(() => this.reload(id)),
      );
  }

  /** Re-read the proposal so callers always receive the full, current record. */
  private reload(id: number): Observable<ProposalReviewRecord> {
    return this.http.get<ProposalReviewRecord>(`${this.baseUrl}/${id}`);
  }

  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmission`, payload);
  }

  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.http.patch<ProposalReviewRecord>(`${this.baseUrl}/${id}`, payload);
  }

  cancelProposal(id: number): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/cancellation`, {});
  }

  createFmbSelection(id: number, draft: FmbSelectionDraft): Observable<ProposalReviewRecord> {
    return this.http
      .post(this.ordersUrl, {
        requestId: id,
        cafeteriaCode: draft.cafeteriaCode,
        fmbOptionId: Number(draft.fmbOptionId),
        menuItemLabel: draft.menuItemLabel,
        quantity: draft.quantity,
        notes: draft.notes,
      })
      .pipe(switchMap(() => this.reload(id)));
  }

  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.http
      .post(`${this.ordersUrl}/${selectionId}/decision`, { decision: 'approve' })
      .pipe(switchMap(() => this.reload(id)));
  }

  sendBackFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord> {
    return this.http
      .post(`${this.ordersUrl}/${selectionId}/decision`, { decision: 'send-back', comment })
      .pipe(switchMap(() => this.reload(id)));
  }

  editFmbSelection(
    id: number,
    selectionId: number,
    edit: FmbSelectionEdit,
  ): Observable<ProposalReviewRecord> {
    const body: Record<string, unknown> = { ...edit };
    if (edit.fmbOptionId !== undefined) body['fmbOptionId'] = Number(edit.fmbOptionId);
    return this.http
      .patch(`${this.ordersUrl}/${selectionId}`, body)
      .pipe(switchMap(() => this.reload(id)));
  }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>(
  'PROPOSAL_WORKFLOW_REPOSITORY',
  { providedIn: 'root', factory: () => inject(ApiProposalWorkflowRepository) },
);
