import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';
import { FmbSelectionDraft, FmbSelectionEdit, PROPOSAL_WORKFLOW_REPOSITORY } from './proposal-workflow.repository';

@Injectable({ providedIn: 'root' })
export class ProposalWorkflowService {
  private readonly repository = inject(PROPOSAL_WORKFLOW_REPOSITORY);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.repository.list(); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.repository.getById(id); }
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.create(payload); }
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.saveDraft(payload); }
  deleteDraft(id: number, actorEmail: string): Observable<void> { return this.repository.deleteDraft(id, actorEmail); }

  approveAsReviewer(id: number, reviewerEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.approveAsReviewer(id, reviewerEmail);
  }

  rejectAsReviewer(id: number, reviewerEmail: string, reason: string): Observable<ProposalReviewRecord> {
    return this.repository.rejectAsReviewer(id, reviewerEmail, reason);
  }

  resubmitAsReviewer(id: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsReviewer(id, reviewerEmail, comment);
  }

  confirmDepartment(id: number, department: DepartmentRequestKind, confirmedByEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.confirmDepartment(id, department, confirmedByEmail);
  }

  resubmitAsDepartment(id: number, department: DepartmentRequestKind, comment: string, reviewerEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitAsDepartment(id, department, comment, reviewerEmail);
  }

  resubmitFromApplicant(id: number, payload: Record<string, unknown>, actorEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFromApplicant(id, payload, actorEmail);
  }

  saveEdits(id: number, payload: Record<string, unknown>, actorEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.saveEdits(id, payload, actorEmail);
  }

  cancelProposal(id: number, cancelledBy: string): Observable<ProposalReviewRecord> {
    return this.repository.cancelProposal(id, cancelledBy);
  }

  createFmbSelection(id: number, draft: FmbSelectionDraft, reviewerEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.createFmbSelection(id, draft, reviewerEmail);
  }

  approveFmbSelection(id: number, selectionId: number, reviewerEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.approveFmbSelection(id, selectionId, reviewerEmail);
  }

  resubmitFmbSelection(id: number, selectionId: number, reviewerEmail: string, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFmbSelection(id, selectionId, reviewerEmail, comment);
  }

  editFmbSelection(id: number, selectionId: number, edit: FmbSelectionEdit, reviewerEmail: string): Observable<ProposalReviewRecord> {
    return this.repository.editFmbSelection(id, selectionId, edit, reviewerEmail);
  }
}
