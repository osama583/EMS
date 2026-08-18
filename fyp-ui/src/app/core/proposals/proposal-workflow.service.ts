import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalReviewRecord } from './proposal-review.models';
import { FmbSelectionDraft, FmbSelectionEdit, PROPOSAL_WORKFLOW_REPOSITORY } from './proposal-workflow.repository';

/**
 * Thin pass-through to the repository. No method takes an acting-user identity:
 * the API resolves the actor from the bearer token, so a caller cannot claim to
 * be someone else. See the repository for the full note.
 */
@Injectable({ providedIn: 'root' })
export class ProposalWorkflowService {
  private readonly repository = inject(PROPOSAL_WORKFLOW_REPOSITORY);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.repository.list(); }
  getById(id: number): Observable<ProposalReviewRecord | undefined> { return this.repository.getById(id); }
  create(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.create(payload); }
  saveDraft(payload: Record<string, unknown>): Observable<ProposalReviewRecord> { return this.repository.saveDraft(payload); }
  deleteDraft(id: number): Observable<void> { return this.repository.deleteDraft(id); }

  approveAsReviewer(id: number): Observable<ProposalReviewRecord> {
    return this.repository.approveAsReviewer(id);
  }

  rejectAsReviewer(id: number, reason: string): Observable<ProposalReviewRecord> {
    return this.repository.rejectAsReviewer(id, reason);
  }

  sendBackAsReviewer(id: number, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.sendBackAsReviewer(id, comment);
  }

  confirmDepartment(id: number, department: DepartmentRequestKind): Observable<ProposalReviewRecord> {
    return this.repository.confirmDepartment(id, department);
  }

  sendBackAsDepartment(id: number, department: DepartmentRequestKind, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.sendBackAsDepartment(id, department, comment);
  }

  resubmitFromApplicant(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.repository.resubmitFromApplicant(id, payload);
  }

  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.repository.saveEdits(id, payload);
  }

  cancelProposal(id: number): Observable<ProposalReviewRecord> {
    return this.repository.cancelProposal(id);
  }

  createFmbSelection(id: number, draft: FmbSelectionDraft): Observable<ProposalReviewRecord> {
    return this.repository.createFmbSelection(id, draft);
  }

  approveFmbSelection(id: number, selectionId: number): Observable<ProposalReviewRecord> {
    return this.repository.approveFmbSelection(id, selectionId);
  }

  sendBackFmbSelection(id: number, selectionId: number, comment: string): Observable<ProposalReviewRecord> {
    return this.repository.sendBackFmbSelection(id, selectionId, comment);
  }

  editFmbSelection(id: number, selectionId: number, edit: FmbSelectionEdit): Observable<ProposalReviewRecord> {
    return this.repository.editFmbSelection(id, selectionId, edit);
  }
}
