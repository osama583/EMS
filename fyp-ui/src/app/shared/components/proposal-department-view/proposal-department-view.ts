import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
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
import { ToastService, apiErrorMessage } from '../toast/toast.service';

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
          @if (isFmbCreateOrderView() && resubmittedSelections().length) {
            <app-proposal-section icon="assignment_return" title="Orders Sent Back To You" description="A cafeteria manager asked for changes. Edit the dish, quantity or cafeteria — saving re-sends the order.">
              <div class="prv-fmb-selections">
                @for (selection of resubmittedSelections(); track selection.id) {
                  <div class="prv-fmb-selection" [attr.data-status]="selection.status">
                    <div class="prv-fmb-selection__body">
                      <div class="prv-fmb-selection__row">
                        <span class="prv-fmb-selection__label">Order</span>
                        <strong>{{ selection.cafeteriaName }} · {{ selection.menuItemLabel }} × {{ selection.quantity }}</strong>
                      </div>
                      @if (selection.managerComment) {
                        <div class="prv-fmb-selection__row">
                          <span class="prv-fmb-selection__label">Manager's comment</span>
                          <span>{{ selection.managerComment }}</span>
                        </div>
                      }
                      <span class="prv-fmb-selection__status">{{ selectionStatusLabel(selection.status) }}</span>
                    </div>
                    <div class="prv-fmb-selection__actions">
                      <button type="button" class="prv-btn prv-btn--approve" [disabled]="selectionActionPending() === selection.id" (click)="openEditOrderModal(selection)">
                        <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">edit</span>
                        <span class="prv-btn__label">Edit &amp; Re-send</span>
                      </button>
                      <button type="button" class="prv-btn prv-btn--resubmit" [disabled]="selectionActionPending() === selection.id" (click)="openCancelOrderModal(selection)">
                        <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">cancel</span>
                        <span class="prv-btn__label">Cancel Order</span>
                      </button>
                    </div>
                  </div>
                }
              </div>
            </app-proposal-section>
          }

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
                  (valueChange)="assigneeEmail.set($any($event))"
                />
                <button
                  type="button"
                  class="prv-btn prv-btn--approve"
                  [disabled]="!assigneeEmail() || assigning() || !requestRows().length"
                  (click)="assignConfirm.set(true)"
                >
                  <span class="prv-btn__icon material-symbols-rounded" aria-hidden="true">assignment_ind</span>
                  <span class="prv-btn__label">{{ assigning() ? 'Assigning...' : 'Assign Tasks' }}</span>
                </button>
              </div>
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

    <!-- Assign confirmation modal (every critical action is confirmed before it runs) -->
    <app-form-modal
      [open]="assignConfirm()"
      title="Assign this work"
      primaryLabel="Assign Tasks"
      secondaryLabel="Cancel"
      [loading]="assigning()"
      (close)="assignConfirm.set(false)"
      (cancel)="assignConfirm.set(false)"
      (submit)="confirmAssign()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">assignment_ind</span>
          Assign all {{ requestRows().length }} of this department's requested item(s) to
          <strong>{{ assigneeName() }}</strong>? They will see the work in their Inbox immediately.
        </p>
      </div>
    </app-form-modal>

    <!-- Edit Order modal (F&B answering a Cafeteria Manager's push-back) -->
    <app-form-modal
      [open]="editOrderTarget() !== null"
      title="Edit and re-send this order"
      primaryLabel="Save &amp; Re-send"
      secondaryLabel="Cancel"
      [loading]="creatingOrder()"
      [disabled]="!createOrderValid()"
      (close)="closeEditOrderModal()"
      (cancel)="closeEditOrderModal()"
      (submit)="confirmEditOrder()"
    >
      <div class="prv-action-modal-body">
        @if (editOrderTarget(); as selection) {
          @if (selection.managerComment) {
            <p class="prv-action-modal__warn prv-action-modal__warn--amber">
              <span class="material-symbols-rounded" aria-hidden="true">rate_review</span>
              {{ selection.managerComment }}
            </p>
          }
        }
        <app-searchable-dropdown
          controlId="edit-order-cafeteria"
          label="Cafeteria"
          placeholder="Select a cafeteria"
          [required]="true"
          [options]="cafeteriaSelectOptions()"
          [value]="createOrderCafeteria()"
          (valueChange)="selectCreateOrderCafeteria($any($event))"
        />
        <app-searchable-dropdown
          controlId="edit-order-menu-item"
          label="Menu item"
          placeholder="Select a menu item"
          [required]="true"
          [disabled]="!createOrderCafeteria()"
          [options]="menuItemSelectOptions()"
          [value]="createOrderMenuItemId()"
          (valueChange)="selectCreateOrderMenuItem($any($event))"
        />
        <div class="prv-comment-area">
          <label class="prv-comment-area__label" for="edit-order-quantity">Quantity</label>
          <input id="edit-order-quantity" class="prv-comment-area__input" type="number" min="1" [value]="createOrderQuantity()" (input)="setCreateOrderQuantity($any($event.target).value)" />
        </div>
        <div class="prv-comment-area">
          <label class="prv-comment-area__label" for="edit-order-notes">Notes (optional)</label>
          <textarea id="edit-order-notes" class="prv-comment-area__input" rows="3" [value]="createOrderNotes()" (input)="setCreateOrderNotes($any($event.target).value)"></textarea>
        </div>
        @if (createOrderError()) {
          <p class="prv-comment-area__error" role="alert">
            <span class="material-symbols-rounded" aria-hidden="true">error</span>
            {{ createOrderError() }}
          </p>
        }
      </div>
    </app-form-modal>

    <!-- Cancel Order confirmation (irreversible, so it is confirmed explicitly) -->
    <app-form-modal
      [open]="cancelOrderTarget() !== null"
      title="Cancel this order"
      primaryLabel="Cancel Order"
      secondaryLabel="Keep Order"
      [danger]="true"
      [loading]="creatingOrder()"
      (close)="cancelOrderTarget.set(null)"
      (cancel)="cancelOrderTarget.set(null)"
      (submit)="confirmCancelOrder()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__warn prv-action-modal__warn--amber">
          <span class="material-symbols-rounded" aria-hidden="true">warning</span>
          Are you sure you want to cancel this order? This cannot be undone — you will need to
          create a new order to cover this part of the request.
        </p>
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
  private readonly toast = inject(ToastService);

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
  readonly assignConfirm = signal(false);
  readonly staffOptions = computed(() => this.staffUsers().map((user) => ({ value: user.email, label: user.displayName, description: user.email })));
  readonly assigneeName = computed(() => this.staffUsers().find((user) => user.email === this.assigneeEmail())?.displayName ?? this.assigneeEmail());

  readonly confirming = signal(false);
  readonly resubmitting = signal(false);
  readonly approveConfirm = signal(false);
  readonly resubmitConfirm = signal(false);
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

  // Orders a Cafeteria Manager sent back — F&B's own action queue on this proposal.
  readonly resubmittedSelections = computed<readonly FmbSelection[]>(() =>
    (this.proposal()?.fmbSelections ?? []).filter((selection) => selection.status === 'resubmitted'),
  );

  readonly cafeteriaOptions = signal<readonly Cafeteria[]>([]);
  readonly createOrderTarget = signal<EditableRow | null>(null);
  // Same modal fields are reused for editing an order a Cafeteria Manager pushed back.
  readonly editOrderTarget = signal<FmbSelection | null>(null);
  readonly cancelOrderTarget = signal<FmbSelection | null>(null);
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
    const confirmedByEmail = this.auth.user()?.email ?? '';
    this.workflow.confirmDepartment(proposal.id, department, confirmedByEmail).pipe(finalize(() => this.confirming.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Fulfilment confirmed', 'Assign a team member to complete the work.'); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not confirm fulfilment', apiErrorMessage(err, 'Please try again.')),
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
    this.workflow.resubmitAsDepartment(proposal.id, department, comment, this.auth.user()?.email ?? '').pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.info('Sent back to the applicant', 'Other departments continue unaffected.'); this.comment.set(''); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not send this back', apiErrorMessage(err, 'Please try again.')),
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
    this.workflow.approveFmbSelection(proposal.id, selection.id, this.auth.user()!.email).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Order approved', 'It is now in your Cafeteria Staff shared inbox.'); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not approve this order', apiErrorMessage(err, 'Please try again.')),
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
      next: () => { this.toast.info('Sent back to F&B', 'Only this order is affected — the rest continue as normal.'); this.selectionComment.set(''); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not send this order back', apiErrorMessage(err, 'Please try again.')),
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
      next: () => { this.createOrderTarget.set(null); this.toast.success('Order created', 'It is now awaiting that cafeteria manager\u2019s approval.'); this.actionComplete.emit(proposal.id); },
      error: (err) => { this.createOrderError.set(apiErrorMessage(err, 'Could not create this order. Please try again.')); this.toast.error('Could not create this order', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  confirmAssign(): void {
    this.assignConfirm.set(false);
    this.assignRequests();
  }

  assignRequests(): void {
    const proposal = this.proposal();
    const assignedToEmail = this.assigneeEmail();
    const unitCode = this.staffUnitCode();
    const assignedByEmail = this.auth.user()?.email ?? '';
    const departments = this.departments();
    if (!proposal || !assignedToEmail || !unitCode) return;
    const requests = proposal.requests.filter((request) => departments.includes(request.department));
    if (!requests.length) return;
    this.assigning.set(true);
    // One request_task covers the whole department, so a single assign call is enough — issuing
    // one per requested row used to make the backend reject every call after the first as a
    // duplicate assignment.
    const first = requests[0];
    this.tasks.assign({
      role: unitCode, assignedToEmail, assignedByEmail, eventCode: proposal.proposalId, eventTitle: proposal.eventTitle,
      request: first.item, quantity: first.quantity, schedule: first.schedule, location: first.location,
      detailLabel: 'Department notes', detail: first.notes,
    }).pipe(finalize(() => this.assigning.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Work assigned', `${this.assigneeName()} will see it in their Inbox.`);
        this.assigneeEmail.set('');
      },
      error: (err) => this.toast.error('Could not assign this work', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // F&B: edit or cancel an order a Cafeteria Manager pushed back. Saving IS the re-send.
  // ---------------------------------------------------------------------------
  openEditOrderModal(selection: FmbSelection): void {
    this.editOrderTarget.set(selection);
    this.createOrderQuantity.set(selection.quantity);
    this.createOrderNotes.set(selection.notes ?? '');
    this.createOrderError.set('');
    this.createOrderMenuItemId.set('');
    this.selectCreateOrderCafeteria(selection.cafeteriaCode);
    // Preselect the current menu item once that cafeteria's menu has loaded.
    this.options.watchByCafeteria(selection.cafeteriaCode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.editOrderTarget()?.id === selection.id && !this.createOrderMenuItemId()) {
        this.createOrderMenuItemId.set(selection.fmbOptionId);
      }
    });
  }

  closeEditOrderModal(): void {
    if (!this.creatingOrder()) this.editOrderTarget.set(null);
  }

  confirmEditOrder(): void {
    const proposal = this.proposal();
    const selection = this.editOrderTarget();
    const menuItem = this.createOrderMenuItems().find((item) => item.id === this.createOrderMenuItemId());
    if (!proposal || !selection || !menuItem || !this.createOrderValid()) return;
    this.creatingOrder.set(true);
    this.createOrderError.set('');
    this.workflow.editFmbSelection(proposal.id, selection.id, {
      cafeteriaCode: this.createOrderCafeteria(),
      fmbOptionId: menuItem.id,
      menuItemLabel: menuItem.label,
      quantity: Number(this.createOrderQuantity()),
      notes: this.createOrderNotes().trim(),
    }, this.auth.user()!.email).pipe(finalize(() => this.creatingOrder.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.editOrderTarget.set(null); this.toast.success('Order re-sent', 'It is back with the cafeteria manager for approval.'); this.actionComplete.emit(proposal.id); },
      error: (err) => { this.createOrderError.set(apiErrorMessage(err, 'Could not save this order.')); this.toast.error('Could not re-send this order', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  openCancelOrderModal(selection: FmbSelection): void {
    this.cancelOrderTarget.set(selection);
  }

  confirmCancelOrder(): void {
    const proposal = this.proposal();
    const selection = this.cancelOrderTarget();
    if (!proposal || !selection) return;
    this.creatingOrder.set(true);
    this.workflow.editFmbSelection(proposal.id, selection.id, { cancel: true }, this.auth.user()!.email)
      .pipe(finalize(() => this.creatingOrder.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.cancelOrderTarget.set(null); this.toast.warning('Order cancelled', 'Create a new order if this part of the request still needs covering.'); this.actionComplete.emit(proposal.id); },
        error: (err) => { this.cancelOrderTarget.set(null); this.toast.error('Could not cancel this order', apiErrorMessage(err, 'Please try again.')); },
      });
  }
}
