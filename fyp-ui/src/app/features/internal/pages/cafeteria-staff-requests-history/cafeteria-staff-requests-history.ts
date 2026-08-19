import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CafeteriaStaffRequest, CafeteriaStaffRequestAction } from '../../../../core/cafeterias/cafeteria-staff-request.models';
import { CafeteriaStaffRequestService } from '../../../../core/cafeterias/cafeteria-staff-request.service';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalPageHeaderComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalCellTone, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ViewToggleComponent } from '../../../../shared/components/view-toggle/view-toggle';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';

const ACTION_LABELS: Readonly<Record<CafeteriaStaffRequestAction, string>> = {
  add: 'Add staff', edit: 'Edit details', remove: 'Remove staff',
  suspend: 'Suspend staff', restore: 'Restore staff',
};
const STATUS_TONE: Readonly<Record<CafeteriaStaffRequest['status'], InternalCellTone>> = {
  pending: 'warning', approved: 'success', rejected: 'danger',
};
const STATUS_LABEL: Readonly<Record<CafeteriaStaffRequest['status'], string>> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
};

// Read-only record of every staffing request the Cafeteria Admin has already decided. Separate
// from the Staff Requests queue because the two answer different questions: that page is work
// outstanding, this is what was done and why.
@Component({
  selector: 'app-cafeteria-staff-requests-history',
  imports: [
    InternalDataPageComponent, FeedbackBannerComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent,
    ViewToggleComponent, LoadingStateComponent,
  ],
  templateUrl: './cafeteria-staff-requests-history.html',
  styleUrl: './cafeteria-staff-requests-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaStaffRequestsHistoryComponent {
  private readonly service = inject(CafeteriaStaffRequestService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<readonly CafeteriaStaffRequest[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly actionFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly viewMode = signal<'table' | 'card'>('table');

  readonly filtered = computed(() => {
    const search = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const action = this.actionFilter();
    return this.items().filter((r) =>
      (status === 'all' || r.status === status)
      && (action === 'all' || r.action === action)
      && (!search || `${r.displayName} ${r.email} ${r.cafeteriaName} ${r.requestedByName}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  private readonly pageSlice = computed(() =>
    this.filtered().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()),
  );
  readonly cards = computed(() => this.pageSlice());

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Staff Request History',
    description: 'Every My Staff request you have approved or rejected.',
    countLabel: `${this.filtered().length} decided`,
  }));

  readonly filters = computed(() => [
    {
      key: 'status', ariaLabel: 'Filter by outcome', value: this.statusFilter(),
      options: [
        { value: 'all', label: 'All outcomes' },
        { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' },
      ],
    },
    {
      key: 'action', ariaLabel: 'Filter by request type', value: this.actionFilter(),
      options: [{ value: 'all', label: 'All types' }, ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))],
    },
  ]);

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Staff request history', paginationLabel: 'History pages', rowsPerPageLabel: 'Requests per page', mobileListLabel: 'Request cards',
    header: this.headerConfig(),
    search: { ariaLabel: 'Search request history', placeholder: 'Search name, email, cafeteria, or manager' },
    columns: [
      { key: 'request', label: 'Request' },
      { key: 'staff', label: 'Staff Member' },
      { key: 'cafeteria', label: 'Cafeteria' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'decided', label: 'Decided' },
    ],
    // Read-only: a decided request is a record, not something to act on again.
    actions: [],
    emptyTitle: 'No decided requests yet',
    emptyDescription: 'Requests you approve or reject are recorded here.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() => this.pageSlice().map((r) => ({
    id: r.id,
    cells: {
      request: { primary: ACTION_LABELS[r.action] ?? r.action, secondary: `by ${r.requestedByName}` },
      staff: { primary: this.subjectOf(r), secondary: r.email },
      cafeteria: { primary: r.cafeteriaName },
      outcome: { primary: STATUS_LABEL[r.status], badge: true, tone: STATUS_TONE[r.status] },
      decided: { primary: this.decidedOn(r), secondary: r.resolvedByName ?? '' },
    },
    mobile: {
      eyebrow: ACTION_LABELS[r.action] ?? r.action, status: STATUS_LABEL[r.status],
      title: this.subjectOf(r), identity: r.email,
      details: [
        { icon: 'storefront', text: r.cafeteriaName },
        { icon: 'schedule', text: this.decidedOn(r) },
        ...(r.comment ? [{ icon: 'comment', text: r.comment }] : []),
      ],
    },
  })));

  constructor() {
    this.service.history$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: () => { this.errorMessage.set('Request history could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  actionLabel(action: CafeteriaStaffRequestAction): string { return ACTION_LABELS[action] ?? action; }
  statusLabel(status: CafeteriaStaffRequest['status']): string { return STATUS_LABEL[status]; }
  statusTone(status: CafeteriaStaffRequest['status']): string { return STATUS_TONE[status]; }
  subjectOf(request: CafeteriaStaffRequest): string {
    return request.displayName || request.email || 'Unnamed staff member';
  }
  decidedOn(request: CafeteriaStaffRequest): string {
    const iso = request.resolvedAt ?? request.createdAt;
    return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }

  setViewMode(mode: 'table' | 'card'): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'action') this.actionFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.actionFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
}
