import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ProposalTableComponent, ProposalTableColumn } from '../../../../shared/components/proposal-table/proposal-table';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import { EditableRow, EditableTableColumn, SelectOption, FormControlType } from '../../../../shared/components/form-controls/form-controls.models';
import { RequestOption } from '../../../../core/request-options/request-option.models';
import { RequestOptionService } from '../../../../core/request-options/request-option.service';
import {
  DepartmentRequestDefinition,
  buildDepartmentRequestDefinitions,
  optionKindForDepartmentField,
  resolveDepartmentRowLabels,
} from '../../../../core/departments/department-request-columns';
import { DepartmentRequestKind } from '../../../../core/departments/department-workflow.config';
import { ProposalConversation } from '../../../../core/proposals/proposal-conversation.models';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { userIsApplicantForProposal } from '../../../../core/proposals/proposal-visibility';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { ReviewerCommentsDrawerComponent } from '../../../../shared/components/reviewer-comments-drawer/reviewer-comments-drawer';
import { ReviewerCommentEntry, allCommentEntries } from '../../../../core/proposals/proposal-status.models';

// A department can only send its OWN task back with a comment (it has no reject) - see
// tasks.py's send_task_back. This page is the applicant's answer to exactly that: fix and resend
// ONE department's request rows, with everything else on the proposal (other departments' rows,
// already-approved content) left untouched server-side (see proposals.py's
// resubmit_department_task/write_single_requirement_rows). It deliberately does NOT reuse
// event-proposal.ts's full form - that component edits the whole proposal, which is correct only
// when a REVIEWER stage sent everything back (status=resubmission_required), not when a single
// department's task is 'resubmitted' while the rest of department review continues in parallel.
// See docs/superpowers/specs/2026-08-20-proposal-api-bug-patterns.md.
@Component({
  selector: 'app-department-resubmit',
  imports: [FormFieldComponent, SearchableDropdownComponent, FormModalComponent, ProposalTableComponent, LoadingStateComponent, ReviewerCommentsDrawerComponent],
  templateUrl: './department-resubmit.html',
  styleUrl: './department-resubmit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepartmentResubmitComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly optionService = inject(RequestOptionService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private nextRowId = 1;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly proposal = signal<ProposalReviewRecord | null>(null);
  readonly rows = signal<readonly EditableRow[]>([]);

  readonly requestOptionCatalog = signal<readonly RequestOption[]>([]);
  readonly requestCatalogLoading = signal(true);

  readonly modalOpen = signal(false);
  readonly editingIndex = signal<number | null>(null);
  readonly draft = signal<EditableRow>({});
  readonly conversations = signal<readonly ProposalConversation[]>([]);
  readonly resubmitConfirmOpen = signal(false);
  // The applicant's required reply to this department, sent together with the resend so it lands
  // in the same conversation as the department's original send-back comment.
  readonly replyComment = signal('');

  // The route config (department-resubmit/:id/:department) is reused across in-place navigations
  // the same way proposal-review-page.ts's is — always read the live paramMap, never a one-shot
  // snapshot. See that component's comment for the "eye icon does nothing" failure this avoids.
  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  readonly proposalId = computed(() => Number(this.params().get('id')));
  readonly department = computed(() => this.params().get('department') as DepartmentRequestKind);

  readonly definitions = computed<readonly DepartmentRequestDefinition[]>(() =>
    buildDepartmentRequestDefinitions(this.optionService, this.requestOptionCatalog()),
  );
  readonly definition = computed<DepartmentRequestDefinition | null>(() =>
    this.definitions().find((item) => item.key === this.department()) ?? null,
  );
  readonly columns = computed<readonly ProposalTableColumn[]>(() =>
    (this.definition()?.columns ?? []).map((column) => ({ key: column.key, label: column.label, width: column.width ?? '12rem' })),
  );
  // Table rows for display only — resolves each select column's stored catalog id (e.g.
  // "transportation:2") to its label, since ProposalTableComponent renders row values raw. The
  // edit modal keeps using rows()/draft() directly with the real ids; only this read-only view
  // needs the resolved text.
  readonly displayRows = computed<readonly EditableRow[]>(() => {
    const definition = this.definition();
    if (!definition) return this.rows();
    return resolveDepartmentRowLabels(definition.key, definition.columns, this.rows(), this.requestOptionCatalog());
  });

  // Every comment currently waiting on the applicant across the WHOLE proposal, not just this one
  // department's - matches event-proposal.ts's reviewerComments so the applicant sees the same
  // full picture in the same drawer UI, whichever department's request they're resending here.
  // (Two or more departments pushed back at once is rare in this workflow, but when it happens
  // there's no reason to hide the other one's comment just because this page only edits one of them.)
  readonly reviewerComments = computed<readonly ReviewerCommentEntry[]>(() => {
    const proposal = this.proposal();
    return proposal ? allCommentEntries(proposal.workflow) : [];
  });

  // This page always exists to answer ONE specific department's own send-back (the route already
  // names it via :department), so the drawer should default straight into that department's
  // conversation rather than the Conversations list — unlike event-proposal.ts, there's no
  // ambiguity to resolve here, the department is already known from the route.
  //
  // A task-thread conversation's partnerName is the RAW requirement key (e.g. "photoVideo" —
  // see history.py's conversations_for(), which sets it from event_requirements.requirement_name
  // unmapped), not a display label — reviewer-comments-drawer.ts's own conversationSummaries()
  // maps it through DEPARTMENT_LABELS only for rendering. Comparing against a mapped label here
  // (as this used to) compares "Photography / Videography" against the raw "photoVideo" and never
  // matches, so match the raw department key directly instead.
  readonly pendingRequesterConversationId = computed<string | null>(() => {
    const department = this.department();
    return this.conversations().find((c) => c.partnerName === department)?.conversationId ?? null;
  });

  // True only while the server still reports this exact task as 'resubmitted' - guards against
  // resending an already-answered task (e.g. a second browser tab open on the same page).
  readonly canResubmit = computed(() => {
    const department = this.department();
    const proposal = this.proposal();
    if (!proposal) return false;
    return userIsApplicantForProposal(this.auth.user(), proposal)
      && proposal.workflow.departmentConfirmations.some((entry) => entry.department === department && entry.status === 'resubmitted');
  });

  constructor() {
    this.optionService.watchActiveCatalog().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => { this.requestOptionCatalog.set(options); this.requestCatalogLoading.set(false); },
      error: () => this.requestCatalogLoading.set(false),
    });

    this.route.paramMap.pipe(
      switchMap((params) => {
        this.loading.set(true);
        return this.workflow.getById(Number(params.get('id')));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((record) => {
      this.proposal.set(record ?? null);
      const department = this.department();
      const existingRows = record?.requestRows?.[department] ?? [];
      this.rows.set(existingRows.map((row) => ({ ...row, id: row['id'] ?? this.nextRowId++ })));
      this.loading.set(false);
    });

    this.route.paramMap.pipe(
      switchMap((params) => this.workflow.getConversations(Number(params.get('id')))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (conversations) => this.conversations.set(conversations),
      error: () => undefined,
    });
  }

  goBack(): void {
    void this.router.navigateByUrl('/app/inbox/proposals');
  }

  openAdd(): void {
    this.editingIndex.set(null);
    this.draft.set({});
    this.modalOpen.set(true);
  }

  edit(index: number): void {
    this.editingIndex.set(index);
    this.draft.set({ ...this.rows()[index] });
    this.modalOpen.set(true);
  }

  deleteRow(index: number): void {
    this.rows.update((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingIndex.set(null);
    this.draft.set({});
  }

  draftValue(key: string): string | number { return this.draft()[key] ?? ''; }

  setDraftValue(key: string, value: string): void {
    const column = this.definition()?.columns.find((item) => item.key === key);
    const next: Record<string, string | number> = { ...this.draft(), [key]: column?.type === 'number' ? (value === '' ? '' : Number(value)) : value };
    if (this.department() === 'fundingPurchase' && key === 'mainItem') {
      const selectedSub = this.optionService.find(this.requestOptionCatalog(), next['subItem']);
      const allowed = this.fieldOptions({ key: 'subItem', label: '', type: 'select', parentKey: 'mainItem' });
      if (!allowed.some((item) => item.value === selectedSub?.id)) next['subItem'] = '';
    }
    this.draft.set(next);
  }

  fieldType(column: EditableTableColumn): FormControlType {
    return column.type === 'select' || column.type === 'staff' || column.type === 'readonly' ? 'text' : column.type;
  }

  fieldOptions(column: EditableTableColumn): readonly SelectOption[] {
    const department = this.department();
    const kind = optionKindForDepartmentField(department, column.key);
    if (!kind) return column.options ?? [];
    let options = this.requestOptionCatalog().filter((option) => option.kind === kind && option.active);
    if (kind === 'fundingSub') {
      const selectedMain = this.optionService.find(this.requestOptionCatalog(), this.draft()['mainItem']);
      options = options.filter((option) => option.kind === 'fundingSub' && option.parentId === selectedMain?.id);
    }
    const selected = this.optionService.find(this.requestOptionCatalog(), this.draft()[column.key]);
    if (selected?.kind === kind && !options.some((option) => option.id === selected.id)) options = [...options, selected];
    return this.optionService.toSelectOptions(options);
  }

  fieldDisabled(column: EditableTableColumn): boolean {
    return !!column.parentKey && !String(this.draft()[column.parentKey] ?? '').trim();
  }

  fieldPlaceholder(column: EditableTableColumn): string {
    return this.fieldDisabled(column) ? 'Select a main item first' : 'Select an option';
  }

  fieldError(column: EditableTableColumn): string {
    const raw = this.draft()[column.key];
    if (raw === '' || raw === undefined || raw === null) return '';
    const value = Number(raw);
    if (this.department() === 'transportation' && column.key === 'requestedPax') {
      if (!Number.isInteger(value) || value <= 0) return 'Requested Pax must be a positive whole number.';
    }
    if (column.key === 'end' && this.draft()['start'] && String(raw) <= String(this.draft()['start'])) return 'End Time must be after Start Time.';
    if (column.type === 'number' && (!Number.isFinite(value) || value <= 0)) return `${column.label} must be greater than 0.`;
    if (column.type === 'text' && !column.readOnly && String(raw).trim() === '') return `${column.label} cannot be blank.`;
    return '';
  }

  formValid(): boolean {
    const definition = this.definition();
    if (!definition) return false;
    return definition.columns.filter((column) => column.required).every((column) => String(this.draft()[column.key] ?? '').trim() !== '')
      && definition.columns.every((column) => !this.fieldError(column))
      && !this.requestCatalogLoading();
  }

  saveRow(): void {
    if (!this.formValid()) return;
    const draft = { id: this.editingIndex() === null ? this.nextRowId++ : this.rows()[this.editingIndex()!]['id'], ...this.draft() };
    const editingIndex = this.editingIndex();
    this.rows.update((current) => editingIndex === null ? [...current, draft] : current.map((row, index) => index === editingIndex ? draft : row));
    this.closeModal();
  }

  modalTitle(): string {
    const definition = this.definition();
    return `${this.editingIndex() === null ? 'Add' : 'Edit'} ${definition?.label ?? 'request'}`;
  }

  openResubmitConfirm(): void {
    if (!this.rows().length) return;
    this.resubmitConfirmOpen.set(true);
  }

  closeResubmitConfirm(): void {
    this.resubmitConfirmOpen.set(false);
  }

  resubmit(): void {
    const proposalId = this.proposalId();
    const department = this.department();
    const comment = this.replyComment().trim();
    if (!proposalId || !department || !this.rows().length || !comment) return;
    this.saving.set(true);
    this.workflow.resubmitDepartmentTask(proposalId, department, this.rows(), comment).subscribe({
      next: () => {
        this.saving.set(false);
        this.resubmitConfirmOpen.set(false);
        this.toastService.success('Resent to the department', `${this.definition()?.label ?? 'Your request'} has been resent for review.`);
        void this.router.navigateByUrl('/app/inbox/proposals');
      },
      error: (error) => {
        this.saving.set(false);
        this.toastService.error('Could not resend', apiErrorMessage(error, 'Please try again.'));
      },
    });
  }
}
