import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { AdminDirectoryService } from '../../../core/admin-directory/admin-directory.service';
import { AuthService } from '../../../core/auth/auth.service';
import { UserRole } from '../../../core/auth/auth.models';
import { staffRoleForManager } from '../../../core/departments/department-workflow.config';
import { departmentsForRole, FmbSelection, ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../core/proposals/proposal-workflow.service';
import { StaffTaskService } from '../../../core/staff-tasks/staff-task.service';
import { EditableRow } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { ProposalFieldComponent } from '../proposal-field/proposal-field';
import { ProposalKpiBarComponent } from '../proposal-kpi-bar/proposal-kpi-bar';
import { ProposalSectionComponent } from '../proposal-section/proposal-section';
import { ProposalTableColumn, ProposalTableComponent } from '../proposal-table/proposal-table';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';

interface ReviewerComment {
  readonly stage: string;
  readonly reviewer: string;
  readonly initials: string;
  readonly text: string;
}

@Component({
  selector: 'app-proposal-department-view',
  imports: [
    ProposalTableComponent,
    SearchableDropdownComponent,
    FormModalComponent,
    ProposalKpiBarComponent,
    ProposalSectionComponent,
    ProposalFieldComponent,
  ],
  template: `
    @if (proposal(); as item) {
      <!-- Top summary info boxes (KPI Bar) -->
      <app-proposal-kpi-bar [proposal]="item" />

      <!-- Two-column dashboard content -->
      <div class="prv-layout">

        <!-- LEFT — Proposal Details & Department Requests -->
        <div class="prv-main">

          @if (actionMessage()) {
            <div class="prv-status-banner" role="status" [attr.data-kind]="actionBannerKind()">
              <span class="material-symbols-rounded" aria-hidden="true">{{ actionBannerIcon() }}</span>
              {{ actionMessage() }}
            </div>
          }

          <!-- Section: Event Overview -->
          <app-proposal-section icon="description" title="Event Overview" description="General information, registration and publicity.">
            <div class="prv-grid prv-grid--3">
              <app-proposal-field label="Event Title" [value]="item.eventTitle" span="2" />
              <app-proposal-field label="Visibility" [value]="item.eventVisibility" />
              <app-proposal-field label="Format" [value]="item.eventFormat" />
              <app-proposal-field label="Registration" [value]="item.registrationMode" />
              <app-proposal-field label="Total Pax" [value]="item.totalPax" />
              <div class="prv-grid-row--2 prv-field--full">
                <app-proposal-field label="External Pax" [value]="item.externalPax" />
                <app-proposal-field label="Categories" [value]="item.eventCategories.join(', ')" />
              </div>
              <app-proposal-field label="Publicity" [value]="item.publicity" span="full" />
              <app-proposal-field label="Short Introduction" [value]="item.shortIntroduction" span="full" />
              <app-proposal-field label="Goals &amp; Objectives" [value]="item.goals" span="full" />
              <app-proposal-field label="Expected Benefits" [value]="item.benefits" span="full" />
            </div>
            @if (item.eventImage) {
              <img class="prv-event-image" [src]="item.eventImage.url" [alt]="item.eventTitle + ' event image'" />
            }
          </app-proposal-section>

          <!-- Section: Department Requests -->
          <app-proposal-section icon="inventory_2" title="Your Department's Requested Items" description="Only requests assigned to your department are shown.">
            <div class="prv-table-wrap">
              <h4 class="prv-table-wrap__label">Department Requests</h4>
              <app-proposal-table
                tableId="department-proposal-requests"
                [columns]="requestColumns"
                [rows]="requestRows()"
                [readOnly]="true"
                emptyIcon="assignment_late"
                emptyMessage="No request details are assigned to this department."
              />
            </div>
          </app-proposal-section>

          <!-- Section: F&B Cafeteria Selections (Cafeteria Manager only, on the fmb department) -->
          @if (isCafeteriaSelectionView()) {
            <app-proposal-section icon="restaurant" title="Cafeteria Order Selections" description="F&B has picked a cafeteria and menu item for each order. Approve or resubmit each one independently.">
              <div class="prv-fmb-selections">
                @for (selection of myCafeteriaSelections(); track selection.id) {
                  <div class="prv-fmb-selection" [attr.data-status]="selection.status">
                    <div class="prv-fmb-selection__body">
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Menu item</span>
                        <strong>{{ selection.menuItemLabel }}</strong>
                      </div>
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Quantity</span>
                        <span>{{ selection.quantity }}</span>
                      </div>
                      @if (selection.notes) {
                        <div class="prv-fmb-selection__row">
                          <span class="prv-fmb-selection__label">Notes</span>
                          <span>{{ selection.notes }}</span>
                        </div>
                      }
                      <span class="prv-fmb-selection__status">{{ selectionStatusLabel(selection.status) }}</span>
                    </div>
                    @if (selection.status === 'pending') {
                      <div class="prv-fmb-selection__actions">
                        <button type="button" class="prv-btn prv-btn--approve" [disabled]="selectionActionPending() === selection.id" (click)="openApproveSelectionModal(selection)">
                          <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">task_alt</span>
                          <span class="prv-btn__label">Approve</span>
                        </button>
                        <button type="button" class="prv-btn prv-btn--resubmit" [disabled]="selectionActionPending() === selection.id" (click)="openResubmitSelectionModal(selection)">
                          <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">rate_review</span>
                          <span class="prv-btn__label">Resubmit to F&amp;B</span>
                        </button>
                      </div>
                    }
                  </div>
                }
                @if (!myCafeteriaSelections().length) {
                  <p class="prv-fmb-selections__empty">No orders have been placed with your cafeteria yet for this proposal.</p>
                }
              </div>
            </app-proposal-section>
          }

        </div><!-- /prv-main -->

        <!-- RIGHT — Sticky Reviewer Panel -->
        <aside class="prv-panel">

          @if (!isCafeteriaSelectionView()) {
            <!-- Workflow Actions card (hidden entirely for the per-selection Cafeteria Manager view — its actions live inline above, per selection row) -->
            <div class="prv-panel-card prv-panel-card--actions">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">gavel</span>
                <div>
                  <h3 class="prv-panel-card__title">Workflow Actions</h3>
                  <p class="prv-panel-card__subtitle">Fulfilment confirmation for your department.</p>
                </div>
              </div>

              @if (canAct()) {
                <!-- Comment area -->
                <div class="prv-comment-area">
                  <label class="prv-comment-area__label" for="dept-reviewer-comment">
                    <span class="material-symbols-rounded" aria-hidden="true">chat_bubble</span>
                    Reviewer comment
                    @if (commentRequired()) { <span class="prv-comment-area__required">required for resubmit</span> }
                  </label>
                  <textarea
                    id="dept-reviewer-comment"
                    class="prv-comment-area__input"
                    [class.prv-comment-area__input--required]="commentValidationError()"
                    rows="4"
                    placeholder="Add a comment visible to all reviewers…"
                    [value]="comment()"
                    (input)="onCommentInput($event)"
                  ></textarea>
                  @if (commentValidationError()) {
                    <p class="prv-comment-area__error" role="alert">
                      <span class="material-symbols-rounded" aria-hidden="true">error</span>
                      Explain what needs to change so the applicant can fix it.
                    </p>
                  }
                </div>

                <!-- Action buttons -->
                <div class="prv-actions prv-actions--row">
                  <button
                    type="button"
                    class="prv-btn prv-btn--approve"
                    [disabled]="confirming() || resubmitting()"
                    (click)="openApproveModal()"
                  >
                    <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">task_alt</span>
                    <span class="prv-btn__label">Approve</span>
                  </button>
                  <button
                    type="button"
                    class="prv-btn prv-btn--resubmit"
                    [disabled]="confirming() || resubmitting()"
                    (click)="openResubmitModal()"
                  >
                    <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">rate_review</span>
                    <span class="prv-btn__label">Resubmit</span>
                  </button>
                </div>
              } @else {
                <div class="prv-no-action">
                  <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
                  <p>Fulfilment confirmed for your department.</p>
                </div>
              }
            </div>
          }

          <!-- Section: Assign Department Work -->
          @if (!readOnly() && allowAssignment() && !isCafeteriaSelectionView() && staffRole(); as assignmentRole) {
            <div class="prv-panel-card">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">person_add</span>
                <div>
                  <h3 class="prv-panel-card__title">Assign Department Work</h3>
                  <p class="prv-panel-card__subtitle">Select team member for these tasks.</p>
                </div>
              </div>
              <div class="proposal-department-view__assignment-controls">
                <app-searchable-dropdown
                  controlId="department-assignee"
                  label="Assigned team member"
                  placeholder="Select a team member"
                  [required]="true"
                  [options]="staffOptions()"
                  [value]="assigneeEmail()"
                  (valueChange)="assigneeEmail.set($any($event)); assignmentMessage.set('')"
                />
                <button
                  type="button"
                  class="prv-btn prv-btn--approve"
                  [disabled]="!assigneeEmail() || assigning() || !requestRows().length"
                  (click)="assignRequests()"
                >
                  <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">assignment_ind</span>
                  <span class="prv-btn__label">{{ assigning() ? 'Assigning...' : 'Assign Tasks' }}</span>
                </button>
              </div>
              @if (assignmentMessage()) {
                <p class="proposal-department-view__assignment-message" role="status">{{ assignmentMessage() }}</p>
              }
            </div>
          }

          <!-- Reviewer Comments card -->
          @if (reviewerComments().length) {
            <div class="prv-panel-card prv-panel-card--comments">
              <div class="prv-panel-card__head">
                <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">forum</span>
                <div>
                  <h3 class="prv-panel-card__title">Reviewer Comments</h3>
                  <p class="prv-panel-card__subtitle">Comments left by reviewers in this chain.</p>
                </div>
              </div>
              <ul class="prv-comments-list">
                @for (entry of reviewerComments(); track entry.stage) {
                  <li class="prv-comment-entry">
                    <div class="prv-comment-entry__avatar" aria-hidden="true">{{ entry.initials }}</div>
                    <div class="prv-comment-entry__body">
                      <div class="prv-comment-entry__meta">
                        <strong>{{ entry.reviewer }}</strong>
                        <span class="prv-comment-entry__stage">{{ entry.stage }}</span>
                      </div>
                      <p class="prv-comment-entry__text">{{ entry.text }}</p>
                    </div>
                  </li>
                }
              </ul>
            </div>
          }

        </aside><!-- /prv-panel -->

      </div><!-- /prv-layout -->
    }

    <!-- Approve confirmation modal popup (whole-department flow) -->
    <app-form-modal
      [open]="approveConfirm()"
      title="Confirm department fulfilment"
      primaryLabel="Confirm Approval"
      secondaryLabel="Cancel"
      [loading]="confirming()"
      (close)="approveConfirm.set(false)"
      (cancel)="approveConfirm.set(false)"
      (submit)="confirmApprove()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">task_alt</span>
          Confirm that your department can fulfill all requested items for this proposal.
        </p>
      </div>
    </app-form-modal>

    <!-- Resubmit confirmation modal popup (whole-department flow) -->
    <app-form-modal
      [open]="resubmitConfirm()"
      title="Resubmit with comment"
      primaryLabel="Send back to applicant"
      secondaryLabel="Cancel"
      [loading]="resubmitting()"
      (close)="resubmitConfirm.set(false)"
      (cancel)="resubmitConfirm.set(false)"
      (submit)="confirmResubmit()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__warn prv-action-modal__warn--amber">
          <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>
          Explain what needs to change so the applicant can update their submission before this continues.
        </p>
      </div>
    </app-form-modal>

    <!-- Approve confirmation modal popup (per-selection Cafeteria Manager flow) -->
    <app-form-modal
      [open]="approveSelectionConfirm() !== null"
      title="Approve this order"
      primaryLabel="Confirm Approval"
      secondaryLabel="Cancel"
      [loading]="selectionActionPending() !== null"
      (close)="approveSelectionConfirm.set(null)"
      (cancel)="approveSelectionConfirm.set(null)"
      (submit)="confirmApproveSelection()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">task_alt</span>
          This order moves into your Cafeteria Staff's shared task inbox for preparation.
        </p>
      </div>
    </app-form-modal>

    <!-- Resubmit confirmation modal popup (per-selection Cafeteria Manager flow) -->
    <app-form-modal
      [open]="resubmitSelectionConfirm() !== null"
      title="Resubmit this order to F&B"
      primaryLabel="Send to F&B"
      secondaryLabel="Cancel"
      [loading]="selectionActionPending() !== null"
      (close)="resubmitSelectionConfirm.set(null)"
      (cancel)="resubmitSelectionConfirm.set(null)"
      (submit)="confirmResubmitSelection()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__warn prv-action-modal__warn--amber">
          <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>
          F&amp;B will edit or reassign this specific order (dish, quantity, or cafeteria) and re-send it —
          other orders for this proposal are not affected.
        </p>
        <div class="prv-comment-area">
          <label class="prv-comment-area__label" for="selection-reviewer-comment">
            <span class="material-symbols-rounded" aria-hidden="true">chat_bubble</span>
            Reviewer comment
            <span class="prv-comment-area__required">required for resubmit</span>
          </label>
          <textarea
            id="selection-reviewer-comment"
            class="prv-comment-area__input"
            [class.prv-comment-area__input--required]="selectionCommentValidationError()"
            rows="4"
            placeholder="Explain what needs to change for this order…"
            [value]="selectionComment()"
            (input)="onSelectionCommentInput($event)"
          ></textarea>
          @if (selectionCommentValidationError()) {
            <p class="prv-comment-area__error" role="alert">
              <span class="material-symbols-rounded" aria-hidden="true">error</span>
              Explain what needs to change so F&amp;B can fix this order.
            </p>
          }
        </div>
      </div>
    </app-form-modal>
  `,
  styleUrl: './proposal-department-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalDepartmentViewComponent {
  private readonly directory = inject(AdminDirectoryService);
  private readonly auth = inject(AuthService);
  private readonly tasks = inject(StaffTaskService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);

  readonly proposal = input<ProposalReviewRecord | null>(null);
  readonly role = input.required<UserRole>();
  readonly allowAssignment = input(true);
  readonly readOnly = input(false);
  readonly actionComplete = output<number>();

  readonly departments = computed(() => departmentsForRole(this.role()));
  readonly staffRole = computed(() => staffRoleForManager(this.role()));
  readonly staffUsers = signal<readonly { email: string; displayName: string }[]>([]);
  readonly assigneeEmail = signal('');
  readonly assigning = signal(false);
  readonly assignmentMessage = signal('');
  readonly staffOptions = computed(() => this.staffUsers().map((user) => ({ value: user.email, label: user.displayName, description: user.email })));

  readonly confirming = signal(false);
  readonly resubmitting = signal(false);
  readonly approveConfirm = signal(false);
  readonly resubmitConfirm = signal(false);
  readonly actionMessage = signal('');
  readonly actionBannerKind = signal<'success' | 'error' | 'info'>('info');
  readonly comment = signal('');
  readonly commentValidationError = signal(false);

  // Per-selection F&B/Cafeteria state — only relevant when isCafeteriaSelectionView() is true.
  readonly selectionActionPending = signal<number | null>(null);
  readonly approveSelectionConfirm = signal<FmbSelection | null>(null);
  readonly resubmitSelectionConfirm = signal<FmbSelection | null>(null);
  readonly selectionComment = signal('');
  readonly selectionCommentValidationError = signal(false);

  // The Cafeteria Manager reviews F&B's fmb department task differently from every other
  // manager: instead of one atomic approve/resubmit for the whole task, each cafeteria
  // selection (request_fmb_selection row) has its own independent lifecycle. This flag
  // switches the template from the shared department-wide panel to the per-selection list.
  readonly isCafeteriaSelectionView = computed(() =>
    this.role() === UserRole.CafeteriaManager && this.departments().includes('fmb'),
  );

  readonly myCafeteriaSelections = computed<readonly FmbSelection[]>(() => {
    const cafeteriaId = this.auth.user()?.cafeteriaId;
    const selections = this.proposal()?.fmbSelections ?? [];
    if (cafeteriaId === undefined) return [];
    return selections.filter((selection) => selection.cafeteriaId === cafeteriaId);
  });

  readonly canAct = computed(() => {
    if (this.readOnly()) return false;
    const proposal = this.proposal();
    if (!proposal) return false;
    const department = this.departments()[0];
    if (!department) return false;
    return !proposal.workflow.departmentConfirmations.find((entry) => entry.department === department)?.confirmed;
  });

  readonly commentRequired = computed(() => this.comment().trim().length === 0);

  readonly actionBannerIcon = computed(() => {
    const kind = this.actionBannerKind();
    if (kind === 'success') return 'check_circle';
    if (kind === 'error') return 'error';
    return 'info';
  });

  readonly reviewerComments = computed<readonly ReviewerComment[]>(() => {
    const proposal = this.proposal();
    if (!proposal?.workflow.reviewerComment) return [];
    return [{
      stage: 'Reviewer Comment',
      reviewer: 'Reviewer',
      initials: 'REV',
      text: proposal.workflow.reviewerComment,
    }];
  });

  readonly requestColumns: readonly ProposalTableColumn[] = [
    { key: 'item', label: 'Requirement / Item', width: '15rem' },
    { key: 'quantity', label: 'Quantity', width: '10rem' },
    { key: 'schedule', label: 'Schedule', width: '15rem' },
    { key: 'location', label: 'Location', width: '12rem' },
    { key: 'notes', label: 'Notes', width: '17rem' },
  ];

  readonly requestRows = computed<readonly EditableRow[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const departments = this.departments();
    return proposal.requests.filter((request) => !departments.length || departments.includes(request.department)).map((request) => ({ ...request }));
  });

  constructor() {
    this.directory.users$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((users) => {
      const role = this.staffRole();
      this.staffUsers.set(role ? users.filter((user) => user.active && user.role === role).map(({ email, displayName }) => ({ email, displayName })) : []);
    });
  }

  onCommentInput(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
    if (this.commentValidationError()) this.commentValidationError.set(false);
  }

  selectionStatusLabel(status: FmbSelection['status']): string {
    switch (status) {
      case 'pending': return 'Awaiting your review';
      case 'approved': return 'Approved — in Cafeteria Staff inbox';
      case 'resubmitted': return 'Sent back to F&B';
      case 'preparing': return 'Being prepared';
      case 'fulfilled': return 'Fulfilled';
      case 'cancelled': return 'Cancelled';
    }
  }

  openApproveModal(): void {
    this.approveConfirm.set(true);
  }

  confirmApprove(): void {
    this.approveConfirm.set(false);
    this.approve();
  }

  approve(): void {
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    this.confirming.set(true);
    this.actionMessage.set('');
    const confirmedByEmail = this.auth.user()?.email ?? '';
    this.workflow.confirmDepartment(proposal.id, department, confirmedByEmail).pipe(finalize(() => this.confirming.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('success'); this.actionMessage.set('Fulfilment confirmed.'); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not confirm fulfilment. Please try again.'); },
    });
  }

  openResubmitModal(): void {
    if (this.comment().trim().length === 0) {
      this.commentValidationError.set(true);
      return;
    }
    this.commentValidationError.set(false);
    this.resubmitConfirm.set(true);
  }

  confirmResubmit(): void {
    this.resubmitConfirm.set(false);
    this.resubmit(this.comment().trim());
  }

  resubmit(comment: string): void {
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    this.resubmitting.set(true);
    this.workflow.resubmitAsDepartment(proposal.id, department, comment).pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('info'); this.actionMessage.set('Sent back to the applicant with your comment.'); this.comment.set(''); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not resubmit. Please try again.'); },
    });
  }

  openApproveSelectionModal(selection: FmbSelection): void {
    this.approveSelectionConfirm.set(selection);
  }

  confirmApproveSelection(): void {
    const selection = this.approveSelectionConfirm();
    this.approveSelectionConfirm.set(null);
    if (selection) this.approveSelection(selection);
  }

  private approveSelection(selection: FmbSelection): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.selectionActionPending.set(selection.id);
    this.actionMessage.set('');
    this.workflow.approveFmbSelection(proposal.id, selection.id).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('success'); this.actionMessage.set('Order approved and sent to Cafeteria Staff.'); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not approve this order. Please try again.'); },
    });
  }

  onSelectionCommentInput(event: Event): void {
    this.selectionComment.set((event.target as HTMLTextAreaElement).value);
    if (this.selectionCommentValidationError()) this.selectionCommentValidationError.set(false);
  }

  openResubmitSelectionModal(selection: FmbSelection): void {
    if (this.selectionComment().trim().length === 0) {
      this.selectionCommentValidationError.set(true);
      this.resubmitSelectionConfirm.set(selection);
      return;
    }
    this.selectionCommentValidationError.set(false);
    this.resubmitSelectionConfirm.set(selection);
  }

  confirmResubmitSelection(): void {
    if (this.selectionComment().trim().length === 0) {
      this.selectionCommentValidationError.set(true);
      return;
    }
    const selection = this.resubmitSelectionConfirm();
    this.resubmitSelectionConfirm.set(null);
    if (selection) this.resubmitSelection(selection, this.selectionComment().trim());
  }

  private resubmitSelection(selection: FmbSelection, comment: string): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.selectionActionPending.set(selection.id);
    this.workflow.resubmitFmbSelection(proposal.id, selection.id, comment).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('info'); this.actionMessage.set('Sent back to F&B for this order only.'); this.selectionComment.set(''); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not resubmit this order. Please try again.'); },
    });
  }

  assignRequests(): void {
    const proposal = this.proposal();
    const assignedToEmail = this.assigneeEmail();
    const role = this.staffRole();
    const departments = this.departments();
    if (!proposal || !assignedToEmail || !role) return;
    const requests = proposal.requests.filter((request) => departments.includes(request.department));
    if (!requests.length) return;
    this.assigning.set(true);
    forkJoin(requests.map((request) => this.tasks.assign({
      role, assignedToEmail, eventCode: proposal.proposalId, eventTitle: proposal.eventTitle,
      request: request.item, quantity: request.quantity, schedule: request.schedule, location: request.location,
      detailLabel: 'Department notes', detail: request.notes,
    }))).pipe(finalize(() => this.assigning.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.assignmentMessage.set(`Assigned to ${this.staffUsers().find((user) => user.email === assignedToEmail)?.displayName ?? assignedToEmail}.`),
      error: () => this.assignmentMessage.set('The request could not be assigned. Please try again.'),
    });
  }
}
