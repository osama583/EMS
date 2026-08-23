import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DepartmentRequestKind } from '../departments/department-workflow.config';
import { ProposalConversation } from './proposal-conversation.models';
import { ProposalReviewRecord } from './proposal-review.models';
import {
  DepartmentRequestListItem,
  DepartmentRequestListQuery,
  FmbSelectionDraft,
  FmbSelectionEdit,
  Page,
  PROPOSAL_WORKFLOW_REPOSITORY,
  ProposalBucket,
  ProposalListQuery,
} from './proposal-workflow.repository';

/**
 * Thin pass-through to the repository. No method takes an acting-user identity:
 * the API resolves the actor from the bearer token, so a caller cannot claim to
 * be someone else. See the repository for the full note.
 */
@Injectable({ providedIn: 'root' })
export class ProposalWorkflowService {
  private readonly repository = inject(PROPOSAL_WORKFLOW_REPOSITORY);

  list(): Observable<readonly ProposalReviewRecord[]> { return this.repository.list(); }
  listPage(query: ProposalListQuery): Observable<Page<ProposalReviewRecord>> { return this.repository.listPage(query); }
  listStatusLabels(bucket: ProposalBucket): Observable<readonly string[]> { return this.repository.listStatusLabels(bucket); }
  listCategories(bucket: ProposalBucket): Observable<readonly string[]> { return this.repository.listCategories(bucket); }
  listDepartmentRequests(query: DepartmentRequestListQuery): Observable<Page<DepartmentRequestListItem>> { return this.repository.listDepartmentRequests(query); }
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

  resubmitDepartmentTask(id: number, department: DepartmentRequestKind, rows: readonly Record<string, unknown>[], comment: string): Observable<ProposalReviewRecord> {
    return this.repository.resubmitDepartmentTask(id, department, rows, comment);
  }

  saveEdits(id: number, payload: Record<string, unknown>): Observable<ProposalReviewRecord> {
    return this.repository.saveEdits(id, payload);
  }

  cancelProposal(id: number): Observable<ProposalReviewRecord> {
    return this.repository.cancelProposal(id);
  }

  getConversations(id: number): Observable<readonly ProposalConversation[]> {
    return this.repository.getConversations(id);
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
