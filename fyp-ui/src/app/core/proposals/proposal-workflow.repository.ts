import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';

export interface FmbSelectionDraft {
  readonly requestFmbId: number;
  readonly cafeteriaCode: string;
  readonly fmbOptionId: string;
  readonly menuItemLabel: string;
  readonly quantity: number;
  readonly notes?: string;
}

export interface ProposalWorkflowRepository {
  list(): Observable<readonly ProposalReviewRecord[]>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  deleteDraft(id: number): Observable<void>;
  // Unit + Level model: the acting reviewer is now identified by their own email (resolved
  // server-side to the real logged-in user), not a role string — 'manager'/'staff' would be
  // ambiguous across every School/Service department unit. See server/routes/proposal-workflow.
  // routes.js's resolveActorByEmail().
  approveAsReviewer(id: number, reviewerEmail: string): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reviewerEmail: string, reason: string): Observable<ProposalReviewRecord>;
  resubmitAsReviewer(id: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord>;
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord>;
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;
  // `payload` is the event-proposal form's FULL submission shape (same as create()/saveDraft()) —
  // every field including child tables is persisted, not just a handful of scalar columns. See
  // server/services/workflow.service.js's applicantResubmit().
  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  // "Save without resubmitting" — persists a resubmission-required proposal's in-progress edits
  // (same full payload shape) without transitioning its stage or clearing the reviewer's comment.
  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord>;
  createFmbSelection(id: number, draft: FmbSelectionDraft, reviewerEmail: string): Observable<ProposalReviewRecord>;
  approveFmbSelection(id: number, selectionId: number, reviewerEmail: string): Observable<ProposalReviewRecord>;
  resubmitFmbSelection(id: number, selectionId: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord>;
}

@Injectable({ providedIn: 'root' })
export class ApiProposalWorkflowRepository implements ProposalWorkflowRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.proposalWorkflowApiUrl;
  list(): Observable<readonly ProposalReviewRecord[]> { return this.http.get<readonly ProposalReviewRecord[]>(this.baseUrl); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.http.get<ProposalReviewRecord>(`${this.baseUrl}/${id}`); }
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(this.baseUrl, payload); }
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/draft`, payload); }
  deleteDraft(id: number): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/${id}`); }
  approveAsReviewer(id: number, reviewerEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/approve`, { reviewerEmail }); }
  rejectAsReviewer(id: number, reviewerEmail: string, reason: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/reject`, { reviewerEmail, reason }); }
  resubmitAsReviewer(id: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit`, { reviewerEmail, comment }); }
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/confirm-department`, { department, confirmedByEmail }); }
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-department`, { department, comment }); }
  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-applicant`, payload); }
  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/save-edits`, payload); }
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/cancel`, { cancelledBy }); }
  createFmbSelection(id: number, draft: FmbSelectionDraft, reviewerEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections`, { ...draft, reviewerEmail }); }
  approveFmbSelection(id: number, selectionId: number, reviewerEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/approve`, { reviewerEmail }); }
  resubmitFmbSelection(id: number, selectionId: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/resubmit`, { reviewerEmail, comment }); }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>('PROPOSAL_WORKFLOW_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiProposalWorkflowRepository),
});
