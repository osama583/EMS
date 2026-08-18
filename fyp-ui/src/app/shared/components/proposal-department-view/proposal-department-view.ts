import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { AdminDirectoryService } from '../../../core/admin-directory/admin-directory.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser } from '../../../core/auth/auth.models';
import { hasRole } from '../../../core/auth/role-access';
import { CafeteriaService } from '../../../core/cafeterias/cafeteria.service';
import { Cafeteria } from '../../../core/cafeterias/cafeteria.models';
import { staffUnitCodeForManager } from '../../../core/departments/department-workflow.config';
import { departmentsForRole, FmbSelection, ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../core/proposals/proposal-workflow.service';
import { RequestOptionService } from '../../../core/request-options/request-option.service';
import { FoodRequestOption } from '../../../core/request-options/request-option.models';
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

          <!-- Section: Create Cafeteria Orders (F&B only, on the fmb department) — pick a
               cafeteria and menu item for each raw food/water request row, one order at a time,
               until the requested quantity is covered. Each order then goes to that cafeteria's
               own Cafeteria Manager for approval — F&B never approves its own order. -->
          @if (isFmbCreateOrderView()) {
            <app-proposal-section icon="restaurant" title="Cafeteria Orders" description="Pick a cafeteria and menu item to fulfill each request. Create as many orders per request as needed.">
              <div class="prv-fmb-selections">
                @for (row of requestRows(); track row['id']) {
                  <div class="prv-fmb-selection">
                    <div class="prv-fmb-selection__body">
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Requested</span>
                        <strong>{{ row['item'] }} — {{ row['quantity'] }}</strong>
                      </div>
                      @if (ordersFor($any(row['id'])).length) {
                        <div class="prv-fmb-selection__row">
                          <span class="prv-fmb-selection__label">Orders placed</span>
                          <span>
                            @for (order of ordersFor($any(row['id'])); track order.id) {
                              {{ order.cafeteriaName }} · {{ order.menuItemLabel }} × {{ order.quantity }} ({{ selectionStatusLabel(order.status) }})@if (!$last) {, }
                            }
                          </span>
                        </div>
                      }
                    </div>
                    <div class="prv-fmb-selection__actions">
                      <button type="button" class="prv-btn prv-btn--approve" (click)="openCreateOrderModal(row)">
                        <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">add_circle</span>
                        <span class="prv-btn__label">Create Order</span>
                      </button>
                    </div>
                  </div>
                }
                @if (!requestRows().length) {
                  <p class="prv-fmb-selections__empty">No food or water requests on this proposal.</p>
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
          @if (!readOnly() && allowAssignment() && !isCafeteriaSelectionView() && staffUnitCode(); as assignmentRole) {
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

    <!-- Create Order modal popup (F&B flow: pick cafeteria + menu item + quantity for one request row) -->
    <app-form-modal
      [open]="createOrderTarget() !== null"
      title="Create cafeteria order"
      primaryLabel="Create Order"
      secondaryLabel="Cancel"
      [loading]="creatingOrder()"
      [disabled]="!createOrderValid()"
      (close)="closeCreateOrderModal()"
      (cancel)="closeCreateOrderModal()"
      (submit)="confirmCreateOrder()"
    >
      <div class="prv-action-modal-body">
        @if (createOrderTarget(); as row) {
          <p class="prv-action-modal__info">
            <span class="material-symbols-rounded" aria-hidden="true">restaurant</span>
            Fulfilling: {{ row['item'] }} — {{ row['quantity'] }}
          </p>
        }
        <app-searchable-dropdown
          controlId="create-order-cafeteria"
          label="Cafeteria"
          placeholder="Select a cafeteria"
          [required]="true"
          [options]="cafeteriaSelectOptions()"
          [value]="createOrderCafeteria()"
          (valueChange)="selectCreateOrderCafeteria($any($event))"
        />
        <app-searchable-dropdown
          controlId="create-order-menu-item"
          label="Menu item"
          placeholder="Select a menu item"
          [required]="true"
          [disabled]="!createOrderCafeteria()"
          [options]="menuItemSelectOptions()"
          [value]="createOrderMenuItemId()"
          (valueChange)="selectCreateOrderMenuItem($any($event))"
        />
        <div class="prv-comment-area">
          <label class="prv-comment-area__label" for="create-order-quantity">Quantity</label>
          <input
            id="create-order-quantity"
            class="prv-comment-area__input"
            type="number"
            min="1"
            [value]="createOrderQuantity()"
            (input)="setCreateOrderQuantity($any($event.target).value)"
          />
        </div>
        <div class="prv-comment-area">
          <label class="prv-comment-area__label" for="create-order-notes">Notes (optional)</label>
          <textarea
            id="create-order-notes"
            class="prv-comment-area__input"
            rows="3"
            placeholder="Delivery time, allergy notes, etc…"
            [value]="createOrderNotes()"
            (input)="setCreateOrderNotes($any($event.target).value)"
          ></textarea>
        </div>
        @if (createOrderError()) {
          <p class="prv-comment-area__error" role="alert">
            <span class="material-symbols-rounded" aria-hidden="true">error</span>
            {{ createOrderError() }}
          </p>
        }
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
  private readonly cafeterias = inject(CafeteriaService);
  private readonly options = inject(RequestOptionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly proposal = input<ProposalReviewRecord | null>(null);
  // RBAC redesign: the department manager viewing this component is identified by their full
  // AuthUser (roles[] holding head-of-department for a Service department, or head-of-department
  // on food_beverage_services for F&B — there's no separate flat CafeteriaManager role any more).
  readonly role = input.required<AuthUser>();
  readonly allowAssignment = input(true);
  readonly readOnly = input(false);
  readonly actionComplete = output<number>();

  readonly departments = computed(() => departmentsForRole(this.role()));
  readonly staffUnitCode = computed(() => staffUnitCodeForManager(this.role()));
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

  // Cafeteria Manager reviews the fmb selections routed to their OWN cafeteria differently from
  // every other manager: instead of one atomic approve/resubmit for the whole department task,
  // each cafeteria selection (request_fmb_selection row) has its own independent lifecycle. This
  // flag switches the template from the shared department-wide panel to the per-selection list.
  readonly isCafeteriaSelectionView = computed(() => hasRole(this.role(), 'cafeteria-manager'));

  readonly myCafeteriaSelections = computed<readonly FmbSelection[]>(() => {
    const cafeteriaCode = this.auth.user()?.cafeteriaCode;
    const selections = this.proposal()?.fmbSelections ?? [];
    if (cafeteriaCode === undefined) return [];
    return selections.filter((selection) => selection.cafeteriaCode === cafeteriaCode);
  });

  // F&B's head-of-department fans each raw food/water request out into one or more concrete
  // cafeteria orders (createFmbSelection, one row per order) — a SEPARATE view from
  // isCafeteriaSelectionView above: F&B creates orders, the owning Cafeteria Manager approves
  // them. Both can be true for the SAME proposal (F&B creating a new order while earlier orders
  // for other cafeterias sit in their managers' inboxes), but never for the same viewing user,
  // since 'cafeteria-manager' and F&B's 'head-of-department' are different roles.
  readonly isFmbCreateOrderView = computed(() =>
    hasRole(this.role(), 'head-of-department', 'food_beverage_services') && this.departments().includes('fmb'),
  );

  readonly cafeteriaOptions = signal<readonly Cafeteria[]>([]);
  readonly createOrderTarget = signal<EditableRow | null>(null);
  readonly createOrderCafeteria = signal('');
  readonly createOrderMenuItems = signal<readonly FoodRequestOption[]>([]);
  readonly createOrderMenuItemId = signal('');
  readonly createOrderQuantity = signal<number | ''>('');
  readonly createOrderNotes = signal('');
  readonly creatingOrder = signal(false);
  readonly createOrderError = signal('');

  readonly cafeteriaSelectOptions = computed(() => this.cafeteriaOptions().filter((c) => c.active).map((c) => ({ value: c.code, label: c.name })));
  readonly menuItemSelectOptions = computed(() => this.createOrderMenuItems().map((item) => ({ value: item.id, label: item.label, description: item.description })));
  readonly createOrderValid = computed(() => !!this.createOrderCafeteria() && !!this.createOrderMenuItemId() && Number(this.createOrderQuantity()) > 0);

  // Existing selections for the request row currently being fulfilled — read-only for F&B (they
  // don't approve their own orders), shown so F&B can see how much of the request is already
  // covered before creating another order.
  ordersFor(requestFmbId: number): readonly FmbSelection[] {
    return (this.proposal()?.fmbSelections ?? []).filter((selection) => selection.requestFmbId === requestFmbId);
  }

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
      const unitCode = this.staffUnitCode();
      // Staff of this department share the SAME unitCode as their head under the RBAC redesign
      // — exclude head-of-department/head-of-school holders so the assignment dropdown still
      // only offers actual frontline staff, matching the old role-filter's intent.
      this.staffUsers.set(unitCode ? users.filter((user) => user.active && user.roles.some((r) => r.unitCode === unitCode && r.roleCode !== 'head-of-department' && r.roleCode !== 'head-of-school')).map(({ email, displayName }) => ({ email, displayName })) : []);
    });
    this.cafeterias.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cafeterias) => this.cafeteriaOptions.set(cafeterias));
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
    this.workflow.approveFmbSelection(proposal.id, selection.id, this.auth.user()!.email).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.workflow.resubmitFmbSelection(proposal.id, selection.id, this.auth.user()!.email, comment).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.actionBannerKind.set('info'); this.actionMessage.set('Sent back to F&B for this order only.'); this.selectionComment.set(''); this.actionComplete.emit(proposal.id); },
      error: () => { this.actionBannerKind.set('error'); this.actionMessage.set('Could not resubmit this order. Please try again.'); },
    });
  }

  // ---------------------------------------------------------------------------
  // F&B: create a cafeteria order (request_fmb_selection row) fulfilling a raw food/water
  // request row. One row = one order; F&B repeats this per cafeteria/dish until the request's
  // pax/quantity is covered — see createFmbSelection() in workflow.service.js.
  // ---------------------------------------------------------------------------
  openCreateOrderModal(row: EditableRow): void {
    this.createOrderTarget.set(row);
    this.createOrderCafeteria.set('');
    this.createOrderMenuItems.set([]);
    this.createOrderMenuItemId.set('');
    this.createOrderQuantity.set('');
    this.createOrderNotes.set('');
    this.createOrderError.set('');
  }

  closeCreateOrderModal(): void {
    if (!this.creatingOrder()) this.createOrderTarget.set(null);
  }

  selectCreateOrderCafeteria(value: string | readonly string[]): void {
    const code = Array.isArray(value) ? value[0] ?? '' : value;
    this.createOrderCafeteria.set(code);
    this.createOrderMenuItemId.set('');
    this.createOrderMenuItems.set([]);
    if (!code) return;
    this.options.watchByCafeteria(code).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((items) => {
      this.createOrderMenuItems.set((items as readonly FoodRequestOption[]).filter((item) => item.active));
    });
  }

  selectCreateOrderMenuItem(value: string | readonly string[]): void {
    this.createOrderMenuItemId.set(Array.isArray(value) ? value[0] ?? '' : value);
  }

  setCreateOrderQuantity(value: string): void {
    this.createOrderQuantity.set(value === '' ? '' : Number(value));
  }

  setCreateOrderNotes(value: string): void {
    this.createOrderNotes.set(value);
  }

  confirmCreateOrder(): void {
    const proposal = this.proposal();
    const row = this.createOrderTarget();
    const menuItem = this.createOrderMenuItems().find((item) => item.id === this.createOrderMenuItemId());
    if (!proposal || !row || !menuItem || !this.createOrderValid()) return;
    this.creatingOrder.set(true);
    this.createOrderError.set('');
    this.workflow.createFmbSelection(proposal.id, {
      requestFmbId: Number(row['id']),
      cafeteriaCode: this.createOrderCafeteria(),
      fmbOptionId: menuItem.id,
      menuItemLabel: menuItem.label,
      quantity: Number(this.createOrderQuantity()),
      notes: this.createOrderNotes().trim() || undefined,
    }, this.auth.user()!.email).pipe(finalize(() => this.creatingOrder.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.createOrderTarget.set(null); this.actionBannerKind.set('success'); this.actionMessage.set('Order created and sent to the cafeteria manager for approval.'); this.actionComplete.emit(proposal.id); },
      error: (err) => this.createOrderError.set(err?.error?.message || 'Could not create this order. Please try again.'),
    });
  }

  assignRequests(): void {
    const proposal = this.proposal();
    const assignedToEmail = this.assigneeEmail();
    const unitCode = this.staffUnitCode();
    const departments = this.departments();
    if (!proposal || !assignedToEmail || !unitCode) return;
    const requests = proposal.requests.filter((request) => departments.includes(request.department));
    if (!requests.length) return;
    this.assigning.set(true);
    forkJoin(requests.map((request) => this.tasks.assign({
      role: unitCode, assignedToEmail, eventCode: proposal.proposalId, eventTitle: proposal.eventTitle,
      request: request.item, quantity: request.quantity, schedule: request.schedule, location: request.location,
      detailLabel: 'Department notes', detail: request.notes,
    }))).pipe(finalize(() => this.assigning.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.assignmentMessage.set(`Assigned to ${this.staffUsers().find((user) => user.email === assignedToEmail)?.displayName ?? assignedToEmail}.`),
      error: () => this.assignmentMessage.set('The request could not be assigned. Please try again.'),
    });
  }
}
