import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, delay, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { PROPOSAL_REVIEW_RECORDS } from './proposal-review.mock-data';
import { ProposalReviewRecord } from './proposal-review.models';
import {
  ProposalStage,
  applyApplicantResubmit,
  applyDepartmentConfirmation,
  applyDepartmentResubmit,
  applyReviewerApproval,
  applyReviewerRejection,
  applyReviewerResubmit,
} from './proposal-status.models';

import { SystemConfigService } from '../config/system-config.service';

export interface ProposalWorkflowRepository {
  list(): Observable<readonly ProposalReviewRecord[]>;
  getById(id: number): Observable<ProposalReviewRecord | undefined>;
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord>;
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord>;
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord>;
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord>;
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord>;
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord>;
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord>;
}

function patchStatus(record: ProposalReviewRecord): ProposalReviewRecord {
  const label: Readonly<Record<ProposalStage, string>> = {
    [ProposalStage.HosHodReview]: 'HOS/HOD review',
    [ProposalStage.FmbReviewerPending]: 'F&B review',
    [ProposalStage.CfoReview]: 'Additional approval',
    [ProposalStage.DepartmentReview]: 'Department review',
    [ProposalStage.Approved]: 'Approved',
    [ProposalStage.Rejected]: 'Rejected',
    [ProposalStage.NeedsRevision]: 'Revision required',
  };
  return { ...record, status: record.workflow.stage === ProposalStage.Rejected ? 'Rejected' : (record.status === 'Cancelled' ? 'Cancelled' : label[record.workflow.stage]) };
}

@Injectable({ providedIn: 'root' })
export class MockProposalWorkflowRepository implements ProposalWorkflowRepository {
  private readonly configService = inject(SystemConfigService);
  private readonly records = new BehaviorSubject<readonly ProposalReviewRecord[]>(PROPOSAL_REVIEW_RECORDS);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.records.asObservable(); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> {
    return this.records.pipe(map((items) => items.find((item) => item.id === id)));
  }

  approveAsReviewer(id: number, _reviewerRole: UserRole): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, workflow: applyReviewerApproval(record.workflow, record.totalPax, this.configService.paxReviewerThreshold()) }));
  }

  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, workflow: applyReviewerRejection(record.workflow, reviewerRole, reason) }));
  }

  resubmitAsReviewer(id: number, _reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, workflow: applyReviewerResubmit(record.workflow, record.workflow.stage, comment) }));
  }

  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, workflow: applyDepartmentConfirmation(record.workflow, department, confirmedByEmail) }));
  }

  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, workflow: applyDepartmentResubmit(record.workflow, department, comment) }));
  }

  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, ...updates, workflow: applyApplicantResubmit(record.workflow) }));
  }

  cancelProposal(id: number, _cancelledBy: string): Observable<ProposalReviewRecord> {
    return this.mutate(id, (record) => ({ ...record, status: 'Cancelled' }));
  }

  private mutate(id: number, transform: (record: ProposalReviewRecord) => ProposalReviewRecord): Observable<ProposalReviewRecord> {
    const current = this.records.value.find((item) => item.id === id);
    if (!current) return throwError(() => new Error('Proposal not found.'));
    const updated = patchStatus(transform(current));
    return of(updated).pipe(delay(180), tap((saved) => this.records.next(this.records.value.map((item) => item.id === id ? saved : item))));
  }
}

@Injectable({ providedIn: 'root' })
export class ApiProposalWorkflowRepository implements ProposalWorkflowRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.proposalWorkflowApiUrl;
  list(): Observable<readonly ProposalReviewRecord[]> { return this.http.get<readonly ProposalReviewRecord[]>(this.baseUrl); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.http.get<ProposalReviewRecord>(`${this.baseUrl}/${id}`); }
  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/approve`, { reviewerRole }); }
  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/reject`, { reviewerRole, reason }); }
  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit`, { reviewerRole, comment }); }
  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/confirm-department`, { department, confirmedByEmail }); }
  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-department`, { department, comment }); }
  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/resubmit-applicant`, updates); }
  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> { return this.http.post<ProposalReviewRecord>(`${this.baseUrl}/${id}/cancel`, { cancelledBy }); }
}

export const PROPOSAL_WORKFLOW_REPOSITORY = new InjectionToken<ProposalWorkflowRepository>('PROPOSAL_WORKFLOW_REPOSITORY', {
  providedIn: 'root', factory: () => environment.useMockProposalWorkflow ? inject(MockProposalWorkflowRepository) : inject(ApiProposalWorkflowRepository),
});
