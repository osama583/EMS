import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';

export interface ProposalWorkflowRepository {
  list(): Observable<readonly ProposalReviewRecord[]>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord>;
  deleteDraft(id: number): Observable<void>;
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord>;
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord>;
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord>;
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord>;
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord>;
  resubmitFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord>;
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
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/approve`, { reviewerRole }); }
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/reject`, { reviewerRole, reason }); }
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit`, { reviewerRole, comment }); }
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/confirm-department`, { department, confirmedByEmail }); }
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-department`, { department, comment }); }
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-applicant`, updates); }
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/cancel`, { cancelledBy }); }
  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/approve`, {}); }
  resubmitFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/fmb-selections/${selectionId}/resubmit`, { comment }); }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>('PROPOSAL_WORKFLOW_REPOSITORY', {
  providedIn: 'root', factory: () => inject(ApiProposalWorkflowRepository),
});
