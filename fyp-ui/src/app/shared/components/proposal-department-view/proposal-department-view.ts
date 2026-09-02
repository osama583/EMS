import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, concatMap, finalize, forkJoin, from, switchMap, toArray } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthUser } from '../../../core/auth/auth.models';
import { hasRole } from '../../../core/auth/role-access';
import { CafeteriaService } from '../../../core/cafeterias/cafeteria.service';
import { Cafeteria } from '../../../core/cafeterias/cafeteria.models';
import { assignmentRequiredForManager, DepartmentRequestKind, maxAssigneesPerRow, staffUnitCodeForManager } from '../../../core/departments/department-workflow.config';
import { ProposalConversation } from '../../../core/proposals/proposal-conversation.models';
import { departmentsForRole, FmbSelection, ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { DEPARTMENT_LABELS, initialsFor } from '../../../core/proposals/proposal-status.models';
import { ProposalWorkflowService } from '../../../core/proposals/proposal-workflow.service';
import { FmbSelectionDraft } from '../../../core/proposals/proposal-workflow.repository';
import { RowAssignmentService } from '../../../core/row-assignments/row-assignment.service';
import { RequestOptionService } from '../../../core/request-options/request-option.service';
import { FoodRequestOption } from '../../../core/request-options/request-option.models';
import { ConversationThreadComponent } from '../conversation-thread/conversation-thread';
import { EditableRow } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { PopoverComponent } from '../popover/popover';
import { ProposalOverviewComponent } from '../proposal-overview/proposal-overview';
import { ProposalKpiBarComponent } from '../proposal-kpi-bar/proposal-kpi-bar';
import { ProposalSectionComponent } from '../proposal-section/proposal-section';
import { ProposalTableColumn, ProposalTableComponent } from '../proposal-table/proposal-table';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';
import { ToastService, apiErrorMessage } from '../toast/toast.service';
import { COMMENTS_DOCK_QUERY, viewportMatches } from '../../viewport-query';

// A "Create Order" click that hasn't been sent to the server yet — same shape as FmbSelectionDraft
// (what actually gets POSTed) plus a local id and the display text the modal already has on hand
// (cafeteria name, menu item label), so the staged row can render without re-fetching anything.
interface StagedFmbOrder extends FmbSelectionDraft {
  readonly id: number;
  readonly cafeteriaName: string;
}

@Component({
  selector: 'app-proposal-department-view',
  imports: [
    ProposalTableComponent,
    SearchableDropdownComponent,
    FormModalComponent,
    PopoverComponent,
    ProposalKpiBarComponent,
    ProposalSectionComponent,
    ProposalOverviewComponent,
    ConversationThreadComponent,
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
          <app-proposal-overview [proposal]="item" />

          <!-- Section: Department Requests (not shown to the Cafeteria Manager — they only need
               to see the cafeteria orders routed to them, in the section below.) -->
          @if (!isCafeteriaSelectionView()) {
            <app-proposal-section icon="inventory_2" title="Your Department's Requested Items" description="Only requests assigned to your department are shown.">
              <div class="prv-table-wrap">
                <h4 class="prv-table-wrap__label">Department Requests</h4>
                <app-proposal-table
                  tableId="department-proposal-requests"
                  [columns]="requestColumns()"
                  [rows]="requestRows()"
                  [readOnly]="true"
                  emptyIcon="assignment_late"
                  emptyMessage="No request details are assigned to this department."
                />
              </div>
            </app-proposal-section>
          }

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

          <!-- Hidden while a cafeteria manager's pushback is unresolved (see
               resubmittedSelections()/"Orders Sent Back To You" above) — the F&B head's job right
               then is to fix or cancel that one order, not get offered a full "create a new order
               against any request row" workspace on top of it. Reappears once every pushback is
               resolved (edited-and-resent, or cancelled). -->
          @if (isFmbCreateOrderView() && !resubmittedSelections().length) {
            <app-proposal-section icon="restaurant" title="Cafeteria Orders" description="Pick a cafeteria and menu item to fulfill each request. Create as many orders per request as needed.">
              <div class="prv-table-wrap">
                <h4 class="prv-table-wrap__label">Food &amp; Water Requests</h4>
                <section class="prv-orders-table">
                  @if (!requestRows().length) {
                    <div class="prv-orders-table__state">
                      <span class="material-symbols-rounded prv-orders-table__state-icon" aria-hidden="true">restaurant_menu</span>
                      <span>No food or water requests on this proposal yet.</span>
                    </div>
                  } @else {
                    <div class="prv-orders-table__scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col" class="prv-orders-table__index">#</th>
                            <th scope="col">Requested</th>
                            <th scope="col">Orders</th>
                            <th scope="col" class="prv-orders-table__actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of requestRows(); track row['id']; let rowIndex = $index) {
                            <tr>
                              <td class="prv-orders-table__index">{{ rowIndex + 1 }}</td>
                              <td><strong>{{ row['item'] }}</strong> — {{ row['quantity'] }}</td>
                              <td>
                                @if (rowOrderCount($any(row['id']))) {
                                  <button type="button" class="prv-orders-badge" (click)="openOrdersPopover(row)">
                                    <span class="material-symbols-rounded" aria-hidden="true">restaurant</span>
                                    {{ rowOrderCount($any(row['id'])) }} order{{ rowOrderCount($any(row['id'])) === 1 ? '' : 's' }}
                                  </button>
                                } @else {
                                  <span class="prv-orders-empty">No orders yet</span>
                                }
                              </td>
                              <td class="prv-orders-table__actions">
                                <button type="button" class="table-control table-control--primary" (click)="openCreateOrderModal(row)">
                                  <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>
                                  Create Order
                                </button>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                </section>
              </div>
            </app-proposal-section>

            <!-- Orders popup for whichever row's badge was clicked — lists every placed order
                 (with its status) and every staged one (editable/removable, not yet sent). -->
            <app-popover [open]="ordersPopoverRow() !== null" [title]="ordersPopoverTitle()" icon="restaurant" (close)="closeOrdersPopover()">
              <ul class="prv-orders-popover-list">
                @for (order of ordersPopoverPlaced(); track order.id) {
                  <li class="prv-orders-popover-item">
                    <div class="prv-orders-popover-item__main">
                      <span class="prv-orders-popover-item__label">{{ order.cafeteriaName }} · {{ order.menuItemLabel }}</span>
                      <span class="prv-orders-popover-item__meta">× {{ order.quantity }} · {{ selectionStatusLabel(order.status) }}</span>
                    </div>
                  </li>
                }
                @for (staged of ordersPopoverStaged(); track staged.id) {
                  <li class="prv-orders-popover-item prv-orders-popover-item--staged">
                    <div class="prv-orders-popover-item__main">
                      <span class="prv-orders-popover-item__label">{{ staged.cafeteriaName }} · {{ staged.menuItemLabel }}</span>
                      <span class="prv-orders-popover-item__meta">× {{ staged.quantity }} · Not yet sent</span>
                    </div>
                    <div class="prv-orders-popover-item__actions">
                      <button type="button" class="prv-orders-popover-item__action" aria-label="Edit staged order" (click)="editStagedOrder(staged)">
                        <span class="material-symbols-rounded" aria-hidden="true">edit</span>
                      </button>
                      <button type="button" class="prv-orders-popover-item__action" aria-label="Remove staged order" (click)="removeStagedOrderFromPopover(staged.id)">
                        <span class="material-symbols-rounded" aria-hidden="true">close</span>
                      </button>
                    </div>
                  </li>
                }
              </ul>
            </app-popover>
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

          <!-- Reviewer Comments card - this department's own conversation thread with the
               applicant (conversations_for scopes a department caller to their own task's thread
               only, so this never shows another department's or reviewer stage's comments). -->
          @if (activeConversation(); as active) {
            @if (commentsVisible()) {
              <div class="prv-panel-card prv-panel-card--comments" [class.comments-dock-surface]="commentsDocked()">
                <div class="prv-panel-card__head">
                  <span class="prv-panel-card__icon material-symbols-rounded" aria-hidden="true">forum</span>
                  <div>
                    <h3 class="prv-panel-card__title">{{ activeSummary()!.partnerName }}</h3>
                    <p class="prv-panel-card__subtitle">{{ activeSummary()!.partnerRoleLabel }}</p>
                  </div>
                  @if (commentsDocked()) {
                    <button type="button" class="comments-dock-close" (click)="commentsOpen.set(false)" aria-label="Close reviewer comments">
                      <span class="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                  }
                </div>
                <app-conversation-thread [messages]="active.messages" [title]="activeSummary()!.partnerName" />
              </div>
            }
          }

        </aside><!-- /prv-panel -->

      </div><!-- /prv-layout -->

      <!-- Docked comments: the edge tab when collapsed, the dismiss scrim when open. Below the
           dock breakpoint the panel column is gone and the conversation would otherwise sit at
           the very bottom of the page — see styles/_comments-dock.scss. -->
      @if (commentsDocked() && activeConversation()) {
        @if (commentsOpen()) {
          <button
            type="button"
            class="comments-dock-scrim"
            aria-label="Close reviewer comments"
            (click)="commentsOpen.set(false)"
            (document:keydown.escape)="commentsOpen.set(false)"
          ></button>
        } @else {
          <button type="button" class="comments-dock-tab" [attr.aria-expanded]="false" (click)="commentsOpen.set(true)">
            Reviewer comments
          </button>
        }
      }
    }

    <!-- Approve confirmation modal popup (whole-department flow). When this department requires
         naming who does the work, approving IS assigning — one action, one call — so the picker
         lives here instead of a separate "Assign Department Work" card/button the manager had to
         remember to use afterward. -->
    <app-form-modal
      [open]="approveConfirm()"
      title="Confirm department fulfilment"
      primaryLabel="Confirm Approval"
      secondaryLabel="Cancel"
      [loading]="confirming() || assigning() || staffUsersLoading() || sendingStagedOrders()"
      [disabled]="!allRowsAllocated()"
      (close)="approveConfirm.set(false)"
      (cancel)="approveConfirm.set(false)"
      (submit)="confirmApprove()"
    >
      <div class="prv-action-modal-body">
        <p class="prv-action-modal__info">
          <span class="material-symbols-rounded" aria-hidden="true">task_alt</span>
          Confirm that your department can fulfill all requested items for this proposal.
        </p>
        @if (isFmbCreateOrderView() && stagedOrders().length) {
          <p class="prv-action-modal__info">
            <span class="material-symbols-rounded" aria-hidden="true">restaurant</span>
            {{ stagedOrders().length }} order{{ stagedOrders().length === 1 ? '' : 's' }} will be sent to their cafeterias now.
          </p>
        }
        @if (fmbRowsAwaitingOrder().length) {
          <p class="prv-action-modal__warn prv-action-modal__warn--amber">
            <span class="material-symbols-rounded" aria-hidden="true">error</span>
            No cafeteria order yet for {{ fmbRowsAwaitingOrder().length === 1 ? '' : 'these requests: ' }}{{ fmbRowsAwaitingOrder()[0]['item'] }}@for (row of fmbRowsAwaitingOrder().slice(1); track row['id']) {, {{ row['item'] }}}. Approving covers every request, so create one for each first.
          </p>
        }
        @if (assignmentRequired()) {
          <div class="prv-row-assignment-list">
            @for (row of requestRows(); track row['id']) {
              <div class="prv-row-assignment">
                <p class="prv-row-assignment__label">
                  {{ row['item'] }}
                  @if (row['quantity']) { <span>&middot; {{ row['quantity'] }}</span> }
                </p>
                <app-searchable-dropdown
                  [controlId]="'row-assignee-' + row['id']"
                  label="Assigned team member"
                  placeholder="Select a team member"
                  [required]="true"
                  [isMulti]="rowAssigneeLimit() !== 1"
                  [maxSelections]="rowAssigneeLimit()"
                  [loading]="staffUsersLoading()"
                  [options]="staffOptions()"
                  [value]="rowSelection($any(row['id']))"
                  (valueChange)="setRowSelection($any(row['id']), $any($event))"
                />
              </div>
            }
          </div>
        }
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

    <!-- Stage Order modal popup (F&B flow: pick cafeteria + menu item + quantity for one request
         row — this only stages the order locally; nothing is sent until Approve, see approve()). -->
    <app-form-modal
      [open]="createOrderTarget() !== null"
      [title]="editingStagedOrderId() === null ? 'Stage a cafeteria order' : 'Edit staged order'"
      [primaryLabel]="editingStagedOrderId() === null ? 'Add to Approval' : 'Save changes'"
      secondaryLabel="Cancel"
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
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly rowAssignments = inject(RowAssignmentService);
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
  // Emitted instead of actionComplete when an action only disposed of PART of what's on this page
  // (currently: resubmitting one F&B cafeteria selection while sibling selections for the same
  // cafeteria are still pending) — the parent should refresh its copy of the proposal and keep the
  // detail view open, rather than navigating away as it does for actionComplete.
  readonly proposalRefreshed = output<ProposalReviewRecord>();

  readonly departments = computed(() => departmentsForRole(this.role()));
  readonly staffUnitCode = computed(() => staffUnitCodeForManager(this.role()));
  // Whether THIS department's approval requires naming who does the work (Logistics/AV/
  // Photography/Transportation/Campus Tour: yes: F&B/Cafeteria Manager: no, they use the cafeteria-
  // order flow instead).
  readonly assignmentRequired = computed(() => this.allowAssignment() && assignmentRequiredForManager(this.role()));
  // null = unlimited assignees per row (Logistics/Photography/Sound & Light/Campus Tour); 1 =
  // exactly one (Transportation) — drives whether each row's picker renders multi- or single-select.
  readonly rowAssigneeLimit = computed(() => {
    const department = this.departments()[0];
    return department ? maxAssigneesPerRow(department) : null;
  });
  readonly staffUsers = signal<readonly { userId: number; email: string; displayName: string }[]>([]);
  readonly staffUsersLoading = signal(false);
  readonly assigning = signal(false);
  readonly staffOptions = computed(() => this.staffUsers().map((user) => ({ value: String(user.userId), label: user.displayName, description: user.email })));
  // Row assignment state while the Approve modal is open: taskId resolved once, then each row's
  // CURRENT server-side assignees (already-assigned staff, shown pre-selected) plus any pending change
  // the manager makes before hitting Confirm Approval — nothing is sent to the server until then,
  // matching every other confirm-modal action in this component.
  private approveTaskId = signal<number | null>(null);
  private readonly initialRowAssignees = signal<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  readonly rowAssigneeSelections = signal<ReadonlyMap<number, readonly number[]>>(new Map());
  // Food rows with no LIVE cafeteria order placed against them. Staged-but-unsent orders are
  // deliberately excluded here — this drives canAct(), and counting them would make the Workflow
  // Actions card vanish the moment F&B staged its first order, mid-flow.
  // waterNormal rows are excluded too: an order can only reference a request_fmb row, so
  // requiring one for mineral water would block every water request (same rule as the server's
  // unallocated_row_count()).
  private readonly fmbRowsWithoutOrder = computed<readonly EditableRow[]>(() => {
    if (!this.isFmbCreateOrderView()) return [];
    const selections = this.proposal()?.fmbSelections ?? [];
    return this.requestRows().filter((row) => row['department'] === 'fmb'
      && !selections.some((order) => order.requestFmbId === Number(row['id']) && order.status !== 'cancelled'));
  });

  // The Approve gate: every request this department owns has someone (an assignee) or something
  // (a cafeteria order, placed or staged) lined up against it. Approving means "we will fulfil
  // ALL of this" — a department that has allocated one of three requests has not decided yet, and
  // the server refuses the same approval in tasks.py's assert_work_allocated().
  readonly fmbRowsAwaitingOrder = computed<readonly EditableRow[]>(() => {
    const staged = this.stagedOrders();
    return this.fmbRowsWithoutOrder().filter((row) => !staged.some((order) => order.requestFmbId === Number(row['id'])));
  });

  readonly allRowsAllocated = computed(() => {
    if (this.assignmentRequired()) {
      const selections = this.rowAssigneeSelections();
      return this.requestRows().every((row) => (selections.get(Number(row['id'])) ?? []).length > 0);
    }
    return this.fmbRowsAwaitingOrder().length === 0;
  });

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

  // Cafeteria Manager reviews the fmb selections routed to their OWN cafeteria differently from every
  // other manager: instead of one atomic approve/resubmit for the whole department task, each
  // cafeteria selection (request_fmb_selection row) has its own independent lifecycle.
  readonly isCafeteriaSelectionView = computed(() => hasRole(this.role(), 'cafeteria-manager'));

  readonly myCafeteriaSelections = computed<readonly FmbSelection[]>(() => {
    const cafeteriaCode = this.auth.user()?.cafeteriaCode;
    const selections = this.proposal()?.fmbSelections ?? [];
    if (cafeteriaCode === undefined) return [];
    return selections.filter((selection) => selection.cafeteriaCode === cafeteriaCode);
  });

  // F&B's head-of-department fans each raw food/water request out into one or more concrete cafeteria
  // orders (createFmbSelection, one row per order) — a SEPARATE view from isCafeteriaSelectionView
  // above: F&B creates orders, the owning Cafeteria Manager approves them.
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

  // "Create Order" used to POST immediately, one call per order — F&B could not build up a batch
  // without each click round-tripping to the server and to the owning Cafeteria Manager's inbox right
  // away.
  private nextStagedOrderId = -1;
  readonly stagedOrders = signal<readonly StagedFmbOrder[]>([]);
  readonly sendingStagedOrders = signal(false);
  readonly editingStagedOrderId = signal<number | null>(null);

  // Existing selections for the request row currently being fulfilled — read-only for F&B (they
  // don't approve their own orders), shown so F&B can see how much of the request is already
  // covered before creating another order.
  ordersFor(requestFmbId: number): readonly FmbSelection[] {
    return (this.proposal()?.fmbSelections ?? []).filter((selection) => selection.requestFmbId === requestFmbId);
  }

  stagedOrdersFor(requestFmbId: number): readonly StagedFmbOrder[] {
    return this.stagedOrders().filter((order) => order.requestFmbId === requestFmbId);
  }

  rowOrderCount(requestFmbId: number): number {
    return this.ordersFor(requestFmbId).length + this.stagedOrdersFor(requestFmbId).length;
  }

  // Which request row's "N orders" badge was clicked — drives the shared popup below listing
  // every placed + staged order for that one row. Holds the row itself (not just its id) so the
  // popup title can read the item name without a second lookup.
  readonly ordersPopoverRow = signal<EditableRow | null>(null);
  readonly ordersPopoverTitle = computed(() => {
    const row = this.ordersPopoverRow();
    return row ? `${row['item']} — Orders` : 'Orders';
  });
  readonly ordersPopoverPlaced = computed<readonly FmbSelection[]>(() => {
    const row = this.ordersPopoverRow();
    return row ? this.ordersFor(Number(row['id'])) : [];
  });
  readonly ordersPopoverStaged = computed<readonly StagedFmbOrder[]>(() => {
    const row = this.ordersPopoverRow();
    return row ? this.stagedOrdersFor(Number(row['id'])) : [];
  });

  openOrdersPopover(row: EditableRow): void {
    this.ordersPopoverRow.set(row);
  }

  closeOrdersPopover(): void {
    this.ordersPopoverRow.set(null);
  }

  // Same removal as removeStagedOrder, but closes the popup afterward if that was the last order
  // left for this row — nothing left to look at otherwise.
  removeStagedOrderFromPopover(orderId: number): void {
    this.removeStagedOrder(orderId);
    const row = this.ordersPopoverRow();
    if (row && !this.rowOrderCount(Number(row['id']))) this.closeOrdersPopover();
  }

  readonly canAct = computed(() => {
    if (this.readOnly()) return false;
    const proposal = this.proposal();
    if (!proposal) return false;
    const department = this.departments()[0];
    if (!department) return false;
    const entry = proposal.workflow.departmentConfirmations.find((candidate) => candidate.department === department);
    if (!entry?.confirmed) return true;
    // Confirmed, but not actually finished: a task approved while some of its requests were still
    // unallocated leaves the proposal parked in this department's inbox. Hiding the actions card
    // there is what made it unrecoverable — there was no action left that could complete it.
    // Undefined (a projection that didn't compute it) means "no reason to doubt it".
    return entry.fullyAllocated === false;
  });

  readonly commentRequired = computed(() => this.comment().trim().length === 0);

  // A department manager only ever gets back their own department's thread from the server (see
  // conversations_for's per-caller scoping), so there is exactly zero or one conversation here -
  // no list/Back UI needed, unlike the applicant-facing drawer.
  readonly conversations = signal<readonly ProposalConversation[]>([]);
  readonly activeConversation = computed(() => this.conversations()[0] ?? null);

  // Same docked-comments treatment as proposal-reviewer-view: below the breakpoint .prv-layout
  // collapses to one column and the conversation would land under the whole proposal detail, so
  // it becomes an edge tab plus a right-docked overlay instead.
  protected readonly commentsDocked = viewportMatches(COMMENTS_DOCK_QUERY);
  protected readonly commentsOpen = signal(false);
  protected readonly commentsVisible = computed(() => !this.commentsDocked() || this.commentsOpen());
  readonly activeSummary = computed(() => {
    const active = this.activeConversation();
    if (!active) return null;
    const partnerName = active.conversationId.startsWith('task:') ? (DEPARTMENT_LABELS[active.partnerName] ?? active.partnerName) : active.partnerName;
    return { partnerName, partnerRoleLabel: active.partnerRoleLabel, initials: initialsFor(partnerName) };
  });

  // Photography/Videography and Sound & Light never collect a quantity on the applicant's form (see
  // department-request-columns.ts's column definitions for those two keys — no `quantity` column
  // exists), so proposals.py's row projection always sends back "" for it.
  private static readonly QUANTITY_COLUMN: ProposalTableColumn = { key: 'quantity', label: 'Quantity', width: '10rem' };
  private static readonly NO_QUANTITY_DEPARTMENTS: ReadonlySet<DepartmentRequestKind> = new Set(['photoVideo', 'soundLight']);
  readonly requestColumns = computed<readonly ProposalTableColumn[]>(() => {
    const department = this.departments()[0];
    const showQuantity = !department || !ProposalDepartmentViewComponent.NO_QUANTITY_DEPARTMENTS.has(department);
    return [
      { key: 'item', label: 'Requirement / Item', width: '15rem' },
      ...(showQuantity ? [ProposalDepartmentViewComponent.QUANTITY_COLUMN] : []),
      { key: 'schedule', label: 'Schedule', width: '15rem' },
      { key: 'location', label: 'Location', width: '12rem' },
      { key: 'notes', label: 'Notes', width: '17rem' },
    ];
  });

  readonly requestRows = computed<readonly EditableRow[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const departments = this.departments();
    // `requests` is detail-only on ProposalReviewRecord (a list row omits it), and this view is
    // only ever handed a detail record. Empty rather than non-null-asserted: a missing block
    // renders as "nothing to show", which is true, instead of throwing at runtime.
    return (proposal.requests ?? []).filter((request) => !departments.length || departments.includes(request.department)).map((request) => ({ ...request }));
  });

  constructor() {
    // Loaded lazily, per-task, when the Approve modal opens for a department that requires assignment
    // (see openApproveModal() below) — GET /tasks/:id/assignable-staff, the same endpoint the actual
    // assignment call (POST /tasks/:id/assignments) authorizes against, so the picker can never offer
    // someone that call would then reject.
    this.cafeterias.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cafeterias) => this.cafeteriaOptions.set(cafeterias));

    effect(() => {
      const proposal = this.proposal();
      if (!proposal) { this.conversations.set([]); return; }
      this.workflow.getConversations(proposal.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (conversations) => this.conversations.set(conversations),
        error: () => this.conversations.set([]),
      });
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
      case 'ready': return 'Ready for delivery';
      case 'fulfilled': return 'Delivered';
      case 'cancelled': return 'Cancelled';
    }
  }

  openApproveModal(): void {
    this.approveConfirm.set(true);
    this.rowAssigneeSelections.set(new Map());
    this.initialRowAssignees.set(new Map());
    this.approveTaskId.set(null);
    if (!this.assignmentRequired()) return;
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    this.staffUsersLoading.set(true);
    this.rowAssignments.taskIdForDepartment(proposal.id, department).pipe(
      switchMap((taskId) => {
        this.approveTaskId.set(taskId);
        return forkJoin([
          this.rowAssignments.assignableStaff(taskId),
          this.rowAssignments.rowAssignments(taskId, department),
        ]);
      }),
      finalize(() => this.staffUsersLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ([staff, existing]) => {
        this.staffUsers.set(staff);
        const byRow = new Map<number, number[]>();
        for (const assignment of existing.assignments) {
          byRow.set(assignment.rowId, [...(byRow.get(assignment.rowId) ?? []), assignment.staffUserId]);
        }
        this.initialRowAssignees.set(new Map([...byRow.entries()].map(([rowId, ids]) => [rowId, new Set(ids)])));
        this.rowAssigneeSelections.set(new Map([...byRow.entries()]));
      },
      error: (err) => this.toast.error('Could not load team members', apiErrorMessage(err, 'Please try again.')),
    });
  }

  rowSelection(rowId: number): string | readonly string[] {
    const selected = (this.rowAssigneeSelections().get(rowId) ?? []).map(String);
    return this.rowAssigneeLimit() === 1 ? (selected[0] ?? '') : selected;
  }

  setRowSelection(rowId: number, value: string | readonly string[]): void {
    const ids = (Array.isArray(value) ? value : value ? [value] : []).map(Number).filter((id) => id > 0);
    this.rowAssigneeSelections.update((current) => new Map(current).set(rowId, ids));
  }

  confirmApprove(): void {
    this.approveConfirm.set(false);
    this.approve();
  }

  // For a department that requires naming who does the work, approving IS assigning: the first
  // row assignment on a task flips it to 'approved' server-side (see tasks.py's assign_to_row),
  // so there is no separate "approve, then also assign" round trip any more.
  approve(): void {
    const proposal = this.proposal();
    const department = this.departments()[0];
    if (!proposal || !department) return;
    if (this.assignmentRequired()) {
      const taskId = this.approveTaskId();
      if (!taskId) return;
      const initial = this.initialRowAssignees();
      const selections = this.rowAssigneeSelections();
      // Only the NEWLY added assignees per row need a call — anyone already assigned (loaded from
      // the server when the modal opened) is left untouched, so reopening this modal and hitting
      // Confirm again never re-sends or duplicates an assignment that already exists.
      const calls: Observable<void>[] = [];
      for (const [rowId, staffIds] of selections) {
        const already = initial.get(rowId) ?? new Set<number>();
        for (const staffId of staffIds) {
          if (!already.has(staffId)) calls.push(this.rowAssignments.assignToRow(taskId, department, rowId, staffId));
        }
      }
      // Nothing new to assign still means "approve" — every row already has someone, which is
      // exactly the state the confirm below is waiting for. Returning early here is what left a
      // task that had been assigned but never confirmed with no way forward.
      if (!calls.length) { this.confirmDepartmentTask(proposal.id, department); return; }
      this.assigning.set(true);
      // Sequential, not forkJoin: the server only treats the task as approved once its LAST row
      // has an assignee, and two assignments committing concurrently can each fail to see the
      // other's row, leaving a fully staffed task stuck at pending.
      from(calls).pipe(
        concatMap((call) => call),
        toArray(),
        finalize(() => this.assigning.set(false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: () => this.confirmDepartmentTask(proposal.id, department),
        error: (err) => this.toast.error('Could not assign this work', apiErrorMessage(err, 'Please try again.')),
      });
      return;
    }
    // F&B: every staged order (see confirmCreateOrder above) becomes a real request_fmb_selection row
    // now, in one batch — this is the single moment they become visible to the owning Cafeteria
    // Managers, matching every other department's "one action, one send" shape.
    if (this.isFmbCreateOrderView() && this.stagedOrders().length) {
      this.sendingStagedOrders.set(true);
      const staged = this.stagedOrders();
      forkJoin(staged.map((order) => this.workflow.createFmbSelection(proposal.id, order))).pipe(
        finalize(() => this.sendingStagedOrders.set(false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: () => { this.stagedOrders.set([]); this.confirmDepartmentTask(proposal.id, department); },
        error: (err) => this.toast.error('Could not send your orders', apiErrorMessage(err, 'Please try again.')),
      });
      return;
    }
    this.confirmDepartmentTask(proposal.id, department);
  }

  private confirmDepartmentTask(proposalId: number, department: DepartmentRequestKind): void {
    this.confirming.set(true);
    this.workflow.confirmDepartment(proposalId, department).pipe(finalize(() => this.confirming.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Fulfilment confirmed', 'Your department is done with this request.'); this.actionComplete.emit(proposalId); },
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
    this.workflow.sendBackAsDepartment(proposal.id, department, comment).pipe(finalize(() => this.resubmitting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.workflow.approveFmbSelection(proposal.id, selection.id).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (record) => {
        this.toast.success('Order approved', 'It is now in your Cafeteria Staff shared inbox.');
        // Same exception as resubmitSelection below: approving disposes of only ONE order — stay
        // put while this cafeteria still has other pending selections on the proposal, only
        // bouncing to Ongoing once this was the last one.
        const cafeteriaCode = this.auth.user()?.cafeteriaCode;
        const stillPending = (record.fmbSelections ?? []).some(
          (order) => order.cafeteriaCode === cafeteriaCode && order.status === 'pending',
        );
        if (stillPending) this.proposalRefreshed.emit(record);
        else this.actionComplete.emit(proposal.id);
      },
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
    this.workflow.sendBackFmbSelection(proposal.id, selection.id, comment).pipe(finalize(() => this.selectionActionPending.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (record) => {
        this.toast.info('Sent back to F&B', 'Only this order is affected — the rest continue as normal.');
        this.selectionComment.set('');
        // Same exception as approveSelection above: this only disposes of ONE order — if this
        // cafeteria still has other pending selections on the same proposal, stay put so the manager
        // can work through the rest instead of being bounced back to Ongoing after each one.
        const cafeteriaCode = this.auth.user()?.cafeteriaCode;
        const stillPending = (record.fmbSelections ?? []).some(
          (order) => order.cafeteriaCode === cafeteriaCode && order.status === 'pending',
        );
        if (stillPending) this.proposalRefreshed.emit(record);
        else this.actionComplete.emit(proposal.id);
      },
      error: (err) => this.toast.error('Could not send this order back', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // F&B: stage a cafeteria order fulfilling a raw food/water request row. One row = one order; F&B
  // repeats this per cafeteria/dish until the request's pax/quantity is covered.
  openCreateOrderModal(row: EditableRow): void {
    this.editingStagedOrderId.set(null);
    this.createOrderTarget.set(row);
    this.createOrderCafeteria.set('');
    this.createOrderMenuItems.set([]);
    this.createOrderMenuItemId.set('');
    this.createOrderQuantity.set('');
    this.createOrderNotes.set('');
    this.createOrderError.set('');
  }

  // Re-opens the same modal against an order that was staged but not yet sent — the fields are
  // already known locally (no server round trip needed to preselect them, unlike
  // openEditOrderModal's already-sent orders).
  editStagedOrder(order: StagedFmbOrder): void {
    this.closeOrdersPopover();
    this.editingStagedOrderId.set(order.id);
    this.createOrderTarget.set(this.requestRows().find((row) => Number(row['id']) === order.requestFmbId) ?? { id: order.requestFmbId });
    this.createOrderQuantity.set(order.quantity);
    this.createOrderNotes.set(order.notes ?? '');
    this.createOrderError.set('');
    this.createOrderMenuItemId.set('');
    this.selectCreateOrderCafeteria(order.cafeteriaCode);
    this.options.watchByCafeteria(order.cafeteriaCode).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.editingStagedOrderId() === order.id && !this.createOrderMenuItemId()) {
        this.createOrderMenuItemId.set(order.fmbOptionId);
      }
    });
  }

  removeStagedOrder(orderId: number): void {
    this.stagedOrders.update((current) => current.filter((order) => order.id !== orderId));
  }

  closeCreateOrderModal(): void {
    if (!this.creatingOrder()) { this.createOrderTarget.set(null); this.editingStagedOrderId.set(null); }
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
    const row = this.createOrderTarget();
    const menuItem = this.createOrderMenuItems().find((item) => item.id === this.createOrderMenuItemId());
    if (!row || !menuItem || !this.createOrderValid()) return;
    const draft: StagedFmbOrder = {
      id: this.editingStagedOrderId() ?? this.nextStagedOrderId--,
      requestFmbId: Number(row['id']),
      cafeteriaCode: this.createOrderCafeteria(),
      cafeteriaName: this.cafeteriaSelectOptions().find((c) => c.value === this.createOrderCafeteria())?.label ?? this.createOrderCafeteria(),
      fmbOptionId: menuItem.id,
      menuItemLabel: menuItem.label,
      quantity: Number(this.createOrderQuantity()),
      notes: this.createOrderNotes().trim() || undefined,
    };
    const editingId = this.editingStagedOrderId();
    this.stagedOrders.update((current) => editingId === null ? [...current, draft] : current.map((order) => order.id === editingId ? draft : order));
    this.createOrderTarget.set(null);
    this.editingStagedOrderId.set(null);
    this.toast.info('Order staged', 'It will be sent once you Approve.');
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
    }).pipe(finalize(() => this.creatingOrder.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (record) => {
        this.editOrderTarget.set(null);
        this.toast.success('Order re-sent', 'It is back with the cafeteria manager for approval.');
        this.afterResubmittedOrderHandled(proposal.id, record);
      },
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
    this.workflow.editFmbSelection(proposal.id, selection.id, { cancel: true })
      .pipe(finalize(() => this.creatingOrder.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (record) => {
          this.cancelOrderTarget.set(null);
          this.toast.warning('Order cancelled', 'Create a new order if this part of the request still needs covering.');
          this.afterResubmittedOrderHandled(proposal.id, record);
        },
        error: (err) => { this.cancelOrderTarget.set(null); this.toast.error('Could not cancel this order', apiErrorMessage(err, 'Please try again.')); },
      });
  }

  // Same exception as the Cafeteria Manager's approveSelection/resubmitSelection: re-sending or
  // cancelling disposes of only ONE order a manager sent back — if others are still awaiting F&B here
  // (resubmittedSelections, unlike the manager's queue, isn't scoped to a single cafeteria), stay put
  // so F&B can work through the rest instead of being bounced to Ongoing after each one.
  private afterResubmittedOrderHandled(proposalId: number, record: ProposalReviewRecord): void {
    const stillResubmitted = (record.fmbSelections ?? []).some((order) => order.status === 'resubmitted');
    if (stillResubmitted) this.proposalRefreshed.emit(record);
    else this.actionComplete.emit(proposalId);
  }
}
