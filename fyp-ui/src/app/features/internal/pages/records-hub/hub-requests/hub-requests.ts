import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { DepartmentRequestKind } from '../../../../../core/departments/department-workflow.config';
import { FmbSelection } from '../../../../../core/proposals/proposal-review.models';
import { DepartmentRequestListItem, DepartmentRequestSortKey, SortOrder } from '../../../../../core/proposals/proposal-workflow.repository';
import { ProposalWorkflowService } from '../../../../../core/proposals/proposal-workflow.service';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellTone, InternalDataPageConfig, InternalDataRecord, InternalSortChange, InternalSortState } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { RecordsHubBucket } from '../records-hub';

const BUCKET_COPY: Readonly<Record<RecordsHubBucket, { title: string; description: string; empty: string }>> = {
  inbox: { title: 'Requests', description: 'Requests newly awaiting your action.', empty: 'Nothing needs your action' },
  ongoing: { title: 'Requests', description: 'Active event-service requests and assigned work.', empty: 'No ongoing requests found' },
  history: { title: 'Requests', description: 'Completed and historical event-service requests.', empty: 'No request history found' },
};

// request_task.status's real values (workflow/constants.py), for a row that has no assignee yet
// (progressStatus is null) or isn't row-assignable (fundingPurchase) - shown as-is rather than
// collapsed into one "In progress" bucket.
const TASK_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Awaiting confirmation',
  approved: 'Approved — not yet staffed',
  preparing: 'Preparing',
  completed: 'Fulfilled',
  resubmitted: 'Sent back',
  cancelled: 'Cancelled',
};

// Once a row HAS an assignee, its real progress is the row-assignment's own step
// (assigned/preparing/completed) rather than the task-level status above - per-department wording
// mirrors staff-tasks.ts's ROLE_PRESENTATION (the same steps the assigned staff member sees and
// acts on: "Start Preparation" -> "Preparation Completed", etc.).
const PROGRESS_STATUS_LABEL: Readonly<Partial<Record<DepartmentRequestKind, Readonly<Record<string, string>>>>> = {
  logistics: { assigned: 'Assigned — awaiting preparation', preparing: 'Preparing', completed: 'Preparation completed' },
  campusTour: { assigned: 'Assigned — awaiting tour', preparing: 'Tour in progress', completed: 'Tour completed' },
  soundLight: { assigned: 'Assigned — awaiting setup', preparing: 'Setting up', completed: 'Setup completed' },
  photoVideo: { assigned: 'Assigned — awaiting coverage', preparing: 'Coverage in progress', completed: 'Coverage completed' },
  transportation: { assigned: 'Assigned — awaiting trip', preparing: 'Trip in progress', completed: 'Trip completed' },
};

// request_fmb_selection.status's own pipeline (migration 013) - what a cafeteria order actually
// goes through, distinct from the task-level "Orders pending review" bucket above.
const ORDER_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Awaiting cafeteria review',
  approved: 'Unclaimed',
  resubmitted: 'Resubmitted to F&B',
  preparing: 'Preparing',
  ready: 'Ready for delivery',
  fulfilled: 'Delivered',
  cancelled: 'Cancelled',
};

// One row = one department request on one proposal, fetched already bucketed and paginated by
// GET /proposals/requests?bucket=&page=&pageSize= (see proposals.py's list_department_requests) —
// bucketed by the OWNING TASK's own status, not the whole proposal's, since a department's row
// belongs in ITS OWN History the moment their task is done even while sibling departments (on the
// same proposal) are still working. This used to fetch every visible proposal in full (including
// every OTHER department's requests) and filter client-side per (proposal, requestKind) pair via
// proposalSectionForUser() — see git history.
@Component({
  selector: 'app-hub-requests',
  imports: [InternalDataPageComponent, FormModalComponent],
  templateUrl: './hub-requests.html',
  styleUrl: './hub-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubRequestsComponent {
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly bucket = this.route.parent!.snapshot.data['bucket'] as RecordsHubBucket;
  private readonly copy = BUCKET_COPY[this.bucket];

  readonly rows = signal<readonly DepartmentRequestListItem[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly detailsTarget = signal<DepartmentRequestListItem | null>(null);
  // Loaded on demand when an fmb/waterNormal row's details are opened — see openDetails().
  readonly detailsFmbSelections = signal<readonly FmbSelection[]>([]);
  readonly detailsLoading = signal(false);

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'schedule', order: 'asc' });

  readonly records = computed<readonly InternalDataRecord[]>(() => this.rows().map((row): InternalDataRecord => {
    const assignedToText = this.assignedToText(row);
    return {
      id: `${row.proposalId}:${row.request.department}:${row.request.id}`,
      cells: {
        proposalId: { primary: row.proposalCode },
        eventTitle: { primary: row.eventTitle },
        item: { primary: row.request.item, secondary: row.request.quantity ? `Qty ${row.request.quantity}` : '' },
        assignedTo: { primary: assignedToText },
        schedule: { primary: row.schedule },
        location: { primary: row.request.location || '—' },
        status: { primary: this.statusLabel(row), badge: true, tone: this.statusTone(row) },
      },
      mobile: {
        eyebrow: row.proposalCode, status: this.statusLabel(row), title: row.eventTitle, identity: row.request.item,
        details: [
          { icon: 'person', text: assignedToText },
          { icon: 'schedule', text: row.schedule },
          { icon: 'location_on', text: row.request.location || '—' },
          { icon: 'inventory_2', text: row.request.quantity ? `Qty ${row.request.quantity}` : row.request.item },
        ],
      },
    };
  }));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.copy.title, paginationLabel: `${this.copy.title} pagination`, rowsPerPageLabel: 'Rows per page', mobileListLabel: `${this.copy.title} cards`,
    header: { title: this.copy.title, description: this.copy.description, countLabel: `${this.total()} request${this.total() === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search requests', placeholder: 'Proposal ID, event title, or item' },
    columns: [
      { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
      { key: 'eventTitle', label: 'Event Title', width: '15rem', sortKey: 'event' },
      { key: 'item', label: 'Item Requested', width: '15rem' },
      { key: 'assignedTo', label: 'Assigned To', width: '13rem' },
      { key: 'schedule', label: 'Schedule', width: '15rem', sortKey: 'schedule' },
      { key: 'location', label: 'Location', width: '11rem' },
      { key: 'status', label: 'Status', width: '13rem', sortKey: 'status' },
    ],
    actions: [],
    emptyTitle: this.copy.empty, emptyDescription: 'There are no requests matching this view.', pageSizeOptions: [5, 10, 25],
  }));

  constructor() {
    // Debounces the search box only — every other control (sort/page/pageSize) already changes at
    // a human pace and should refetch immediately. Same reactive pattern as hub-proposals.ts: every
    // control here is a real GET /proposals/requests query param (q/sort/order/page/pageSize),
    // resolved server-side — this used to fetch up to 200 rows once and never page past that.
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.workflow.listDepartmentRequests({
            bucket: this.bucket,
            page: query.page,
            pageSize: query.pageSize,
            q: query.q || undefined,
            sort: query.sort.key as DepartmentRequestSortKey,
            order: query.sort.order as SortOrder,
          });
        }),
      )
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  updateSearchDraft(value: string): void { this.search.set(value); }
  updateSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  updatePage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  updatePageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  resetFilters(): void { this.search.set(''); this.debouncedSearch.set(''); this.sort.set({ key: 'schedule', order: 'asc' }); this.page.set(1); }

  openDetails(record: InternalDataRecord): void {
    const row = this.rows().find((r) => `${r.proposalId}:${r.request.department}:${r.request.id}` === record.id);
    if (!row) return;
    this.detailsTarget.set(row);
    this.detailsFmbSelections.set([]);
    if (row.request.department !== 'fmb' && row.request.department !== 'waterNormal') return;
    // Orders placed against this specific request live on the full proposal record — fetched on
    // demand rather than carried on every list row, since most rows' details are never opened.
    this.detailsLoading.set(true);
    this.workflow.getById(row.proposalId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (proposal) => {
        this.detailsFmbSelections.set((proposal?.fmbSelections ?? []).filter((s) => s.requestFmbId === row.request.id));
        this.detailsLoading.set(false);
      },
      error: () => this.detailsLoading.set(false),
    });
  }
  closeDetails(): void { this.detailsTarget.set(null); this.detailsFmbSelections.set([]); }

  orderStatusLabel(status: string): string {
    return ORDER_STATUS_LABEL[status] ?? status;
  }

  // Every staff member/claimant currently on this row, or an explicit "not yet assigned"/
  // "unclaimed" placeholder rather than a blank cell.
  assignedToText(row: DepartmentRequestListItem): string {
    if (row.assignedTo.length > 0) return row.assignedTo.join(', ');
    const isFmb = row.request.department === 'fmb' || row.request.department === 'waterNormal';
    return isFmb ? 'Unclaimed' : 'Not yet assigned';
  }

  statusLabel(row: DepartmentRequestListItem): string {
    const isFmb = row.request.department === 'fmb' || row.request.department === 'waterNormal';
    if (isFmb) {
      // A cafeteria-manager row IS one order (row.orders has exactly one entry, its own status).
      // An F&B-head row can have several orders (one ask fanned across cafeterias) - summarize
      // progress across them rather than picking just one.
      if (row.orders.length === 0) return TASK_STATUS_LABEL[row.taskStatus] ?? row.taskStatus;
      if (row.orders.length === 1) return ORDER_STATUS_LABEL[row.orders[0].status] ?? row.orders[0].status;
      const delivered = row.orders.filter((o) => o.status === 'fulfilled').length;
      return `${delivered} of ${row.orders.length} delivered`;
    }
    if (row.progressStatus) {
      const perDepartment = PROGRESS_STATUS_LABEL[row.request.department as DepartmentRequestKind];
      return perDepartment?.[row.progressStatus] ?? row.progressStatus;
    }
    return TASK_STATUS_LABEL[row.taskStatus] ?? row.taskStatus;
  }

  private statusTone(row: DepartmentRequestListItem): InternalCellTone {
    const label = this.statusLabel(row);
    if (label.includes('completed') || label.includes('Completed') || label.includes('Delivered') || label.includes('Fulfilled')) return 'success';
    if (label === 'Cancelled') return 'danger';
    if (label.includes('Sent back') || label.includes('Resubmitted')) return 'warning';
    if (label === 'Awaiting confirmation' || label === 'Approved — not yet staffed' || label === 'Unclaimed' || label.startsWith('Assigned —')) return 'warning';
    return 'blue';
  }
}
