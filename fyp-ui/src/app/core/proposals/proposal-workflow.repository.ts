import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalConversation } from './proposal-conversation.models';
import { ProposalDepartmentRequest, ProposalReviewRecord } from './proposal-review.models';

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

// FmbSelectionDraft/Edit's fmbOptionId is a RequestOption id, the composite "fmb:<n>" form
// (see request-option.service.ts/options.py's option_id()) - POST/PATCH /cafeteria-orders,
// unlike the general /options catalogue routes, wants just the bare row number, and has no
// parse_option_id() of its own to unwrap a composite id server-side. `Number("fmb:3")` is NaN,
// which JSON.stringify sends as `null`, which the backend's required() rejects as "missing" -
// this strips the "fmb:" prefix before it ever leaves the client.
function fmbOptionRowId(optionId: string): number {
  return Number(optionId.includes(':') ? optionId.split(':')[1] : optionId);
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
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export type ProposalBucket = 'inbox' | 'ongoing' | 'history' | 'drafts';
export type ProposalSortKey = 'updatedAt' | 'schedule' | 'eventTitle' | 'applicant' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface ProposalListQuery {
  readonly bucket: ProposalBucket;
  readonly page: number;
  readonly pageSize: number;
  readonly sort?: ProposalSortKey;
  readonly order?: SortOrder;
  // Substring match on proposal id / event title / applicant name (server-side, case-insensitive).
  readonly q?: string;
  // Exact match on the bucket's human-readable status label — see listStatusLabels().
  readonly statusLabel?: string;
  // Exact match on one of the proposal's event categories — see listCategories(). Drafts only.
  readonly category?: string;
  // 'mine' = the caller is the applicant. 'co-owned' = the caller is a co-owner, not the
  // applicant. 'acted-on' = neither owner nor co-owner, but the caller reviewed/actioned it
  // (head-of-school/department, FMB head, CFO, department staff) — only offered to those
  // roles by hub-proposals.ts. Omit for all three. History's Requester filter.
  readonly requester?: 'mine' | 'co-owned' | 'acted-on';
}

export type DepartmentRequestBucket = 'inbox' | 'ongoing' | 'history';
export type DepartmentRequestSortKey = 'schedule' | 'event' | 'status';

export interface DepartmentRequestListQuery {
  readonly bucket: DepartmentRequestBucket;
  readonly page: number;
  readonly pageSize: number;
  // Omit to get every one of the caller's routed department kinds in one list (hub-requests.ts's
  // current behaviour); pass one to scope to just that department.
  readonly requestKind?: DepartmentRequestKind;
  // Substring match on proposal code / event title / item (server-side, case-insensitive).
  readonly q?: string;
  readonly sort?: DepartmentRequestSortKey;
  readonly order?: SortOrder;
}

/** One cafeteria order placed against an fmb/waterNormal request row — one raw ask can fan out
 * into several of these (one per cafeteria), each independently staffed. */
export interface DepartmentRequestOrder {
  readonly cafeteriaName: string;
  readonly claimedByName: string | null;
  readonly status: string;
}

/** One row of GET /proposals/requests — a single department_review task's request detail,
 * with just enough of the parent proposal to display and open it. See proposals.py's
 * list_department_requests(); mirrors what hub-requests.ts used to assemble client-side from a
 * full ProposalReviewRecord (proposal.requests / proposal.workflow.departmentConfirmations). */
export interface DepartmentRequestListItem {
  readonly proposalId: number;
  readonly proposalCode: string;
  // null for a cafeteria manager's own order rows (_cafeteria_manager_order_rows) — those aren't
  // backed by a request_task at all, only by a request_fmb_selection order.
  readonly requestTaskId: number | null;
  readonly taskStatus: string;
  readonly taskComment: string | null;
  readonly eventTitle: string;
  readonly shortIntroduction: string;
  readonly goals: string;
  readonly applicant: string;
  readonly applicantEmail: string;
  readonly applicantInitials: string;
  readonly schedule: string;
  readonly request: ProposalDepartmentRequest;
  // Every staff member currently on this row — for the 5 row-assignable departments, every
  // co-assignee sharing the row's status; for fmb/waterNormal, every order's claimant.
  readonly assignedTo: readonly string[];
  // The row-assignment's own step status (assigned/preparing/completed) for the 5 row-assignable
  // departments; null for fmb/waterNormal (see `orders` instead) and fundingPurchase.
  readonly progressStatus: string | null;
  // fmb/waterNormal only: every cafeteria order placed against this ask, each with its own status.
  readonly orders: readonly DepartmentRequestOrder[];
  // Present only on a cafeteria manager's own order rows — which cafeteria the order belongs to.
  readonly cafeteriaName?: string;
}

export interface ProposalWorkflowRepository {
  /**
   * Proposals the CALLER may see — their own, ones they co-own, and ones
   * awaiting their decision. Scoped server-side; the client no longer filters.
   */
  list(): Observable<readonly ProposalReviewRecord[]>;
  /**
   * One list page's worth of proposals, already scoped to a bucket (inbox /
   * ongoing / history / drafts), paginated and sorted server-side - the query
   * itself decides which page of which bucket comes back, not the client
   * slicing a bigger fetch. See proposals.py's list_proposals().
   */
  listPage(query: ProposalListQuery): Observable<Page<ProposalReviewRecord>>;
  /** Every status label that appears anywhere in this bucket, for its status filter dropdown. */
  listStatusLabels(bucket: ProposalBucket): Observable<readonly string[]>;
  /** Every event category that appears anywhere in this bucket, for its category filter dropdown. */
  listCategories(bucket: ProposalBucket): Observable<readonly string[]>;
  /**
   * One list page's worth of department requests routed to the caller (the Requests hub) -
   * bucketed by the OWNING TASK's own status, not the whole proposal's, so a department's row
   * moves to history the moment their own work is done even while sibling departments are still
   * in progress. See proposals.py's list_department_requests().
   */
  listDepartmentRequests(query: DepartmentRequestListQuery): Observable<Page<DepartmentRequestListItem>>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  deleteDraft(id: number): Observable<void>;

  approveAsReviewer(id: number): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reason: string): Observable<ProposalReviewRecord>;
  sendBackAsReviewer(id: number, comment: string): Observable<ProposalReviewRecord>;

  confirmDepartment(id: number, department: DepartmentRequestKind): Observable<ProposalReviewRecord>;
  sendBackAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;

  /** `payload` is the proposal form's full submission shape, including child rows and a required `comment` reply. */
  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  /**
   * Fix and resend ONE department's request rows only - everything else on the
   * proposal (other departments' rows, already-approved content) is untouched.
   * `comment` is the applicant's required reply to that department.
   * See proposals.py's resubmit_department_task().
   */
  resubmitDepartmentTask(id: number, department: DepartmentRequestKind, rows: readonly Record<string, unknown>[], comment: string): Observable<ProposalReviewRecord>;
  /** Persist in-progress edits without advancing the stage or clearing the comment. */
  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number): Observable<ProposalReviewRecord>;
  /**
   * Per-partner resubmission chat threads on this proposal, already scoped
   * server-side to what the caller may see (the applicant/co-owners see every
   * thread; anyone else sees only their own). See proposals.py's
   * get_conversations() / history.py's conversations_for().
   */
  getConversations(id: number): Observable<readonly ProposalConversation[]>;

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

  listPage(query: ProposalListQuery): Observable<Page<ProposalReviewRecord>> {
    const params: Record<string, string | number> = {
      bucket: query.bucket,
      page: query.page,
      pageSize: query.pageSize,
    };
    if (query.sort) params['sort'] = query.sort;
    if (query.order) params['order'] = query.order;
    if (query.q) params['q'] = query.q;
    if (query.statusLabel && query.statusLabel !== 'All') params['statusLabel'] = query.statusLabel;
    if (query.category && query.category !== 'All') params['category'] = query.category;
    if (query.requester) params['requester'] = query.requester;
    return this.http.get<Page<ProposalReviewRecord>>(this.baseUrl, { params });
  }

  listStatusLabels(bucket: ProposalBucket): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/status-labels`, { params: { bucket } });
  }

  listCategories(bucket: ProposalBucket): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/categories`, { params: { bucket } });
  }

  listDepartmentRequests(query: DepartmentRequestListQuery): Observable<Page<DepartmentRequestListItem>> {
    const params: Record<string, string | number> = { bucket: query.bucket, page: query.page, pageSize: query.pageSize };
    if (query.requestKind) params['requestKind'] = query.requestKind;
    if (query.q) params['q'] = query.q;
    if (query.sort) params['sort'] = query.sort;
    if (query.order) params['order'] = query.order;
    return this.http.get<Page<DepartmentRequestListItem>>(`${this.baseUrl}/requests`, { params });
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

  resubmitDepartmentTask(id: number, department: DepartmentRequestKind, rows: readonly Record<string, unknown>[], comment: string): Observable<ProposalReviewRecord> {
    return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/department-tasks/${department}/resubmission`, { rows, comment });
  }

  getConversations(id: number): Observable<readonly ProposalConversation[]> {
    return this.http.get<readonly ProposalConversation[]>(`${this.baseUrl}/${id}/conversations`);
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
        fmbOptionId: fmbOptionRowId(draft.fmbOptionId),
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
    if (edit.fmbOptionId !== undefined) body['fmbOptionId'] = fmbOptionRowId(edit.fmbOptionId);
    return this.http
      .patch(`${this.ordersUrl}/${selectionId}`, body)
      .pipe(switchMap(() => this.reload(id)));
  }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>(
  'PROPOSAL_WORKFLOW_REPOSITORY',
  { providedIn: 'root', factory: () => inject(ApiProposalWorkflowRepository) },
);
