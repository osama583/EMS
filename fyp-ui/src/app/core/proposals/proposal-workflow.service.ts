import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';
import { PROPOSAL_WORKFLOW_REPOSITORY } from './proposal-workflow.repository';

@Injectable({ providedIn: 'root' })
export class ProposalWorkflowService {
  private readonly repository = inject(PROPOSAL_WORKFLOW_REPOSITORY);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.repository.list(); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.repository.getById(id); }
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.create(payload); }
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.saveDraft(payload); }
  deleteDraft(id: number): Observable<void> { return this.repository.deleteDraft(id); }

  approveAsReviewer(id: number, reviewerRole: UserRole): Observable<ProposalReviewRecord> {
    return this.repository.approveAsReviewer(id, reviewerRole);
  }

  rejectAsReviewer(id: number, reviewerRole: UserRole, reason: string): Observable<ProposalReviewRecord> {
    return this.repository.rejectAsReviewer(id, reviewerRole, reason);
  }

  resubmitAsReviewer(id: number, reviewerRole: UserRole, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsReviewer(id, reviewerRole, comment);
  }

  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.confirmDepartment(id, department, confirmedByEmail);
  }

  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsDepartment(id, department, comment);
  }

  resubmitFromApplicant(id: number, updates: Partial<ProposalReviewRecord>): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFromApplicant(id, updates);
  }

  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> {
    return this.repository.cancelProposal(id, cancelledBy);
  }

  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.approveFmbSelection(id, selectionId);
  }

  resubmitFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFmbSelection(id, selectionId, comment);
  }
}
