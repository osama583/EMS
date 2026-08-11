import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { userOwnsCurrentProposalAction } from '../../../../core/proposals/proposal-visibility';
import { UserRole } from '../../../../core/auth/auth.models';

// Real `ProposalReviewRecord`s carry no per-department "requestKind" tag of their own (unlike the
// old hardcoded demo rows) — department ownership is derived purely from
// `userOwnsCurrentProposalAction`'s own reading of `workflow.departmentConfirmations` /
// `selectedRequirements`, so `filteredItems` no longer needs a `requestKind` per row to filter on.
type InboxItem = ProposalReviewRecord;

const INBOX_STATUSES: readonly string[] = ['Revision required', 'Department review', 'HOS/HOD review', 'Additional approval', 'Submitted'];

@Component({
  selector: 'app-inbox',
  imports: [InternalDataPageComponent],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InboxComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly service = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);
  readonly role = this.auth.user()?.role ?? UserRole.Applicant;
  readonly searchDraft = signal('');
  readonly statusFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly items = signal<readonly InboxItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() {
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: () => { this.error.set('Inbox items could not be loaded.'); this.loading.set(false); },
    });
  }

  readonly filteredItems = computed(() => {
    const query = this.searchDraft().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    const user = this.auth.user();

    return this.items().filter((item) => {
      // Permission gate: only show proposals where the current stage's action actually belongs
      // to this role right now (reviewer-stage ownership, or an unconfirmed department they
      // manage — checked against the proposal's own departmentConfirmations). This must run
      // before any display filter — restricted items should never render, not render-then-block
      // when opened. Real records carry no per-row requestKind tag, so
      // `userOwnsCurrentProposalAction` is called without one; it derives department ownership
      // entirely from the proposal's own `workflow.departmentConfirmations`.
      if (!userOwnsCurrentProposalAction(user, item)) return false;
      const matchesQuery = query.length === 0 || `${item.proposalId} ${item.eventTitle} ${item.applicant}`.toLocaleLowerCase().includes(query);
      const matchesStatus = status === 'All' || item.status === status;
      return matchesQuery && matchesStatus;
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredItems().length / this.pageSize())));
  readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));
  readonly visibleItems = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredItems().slice(start, start + this.pageSize());
  });

  readonly pageConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Inbox',
    paginationLabel: 'Inbox pagination',
    rowsPerPageLabel: 'Items per page',
    mobileListLabel: 'Inbox cards',
    header: {
      title: 'Inbox',
      description: 'Proposals and requests that need your action.',
      countLabel: `${this.filteredItems().length} require action`,
    },
    search: { ariaLabel: 'Search inbox', placeholder: 'Proposal ID, event title, or applicant' },
    columns: [
      { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
      { key: 'eventTitle', label: 'Event Title', width: '17rem' },
      { key: 'applicant', label: 'Applicant', width: '13rem' },
      { key: 'schedule', label: 'Event Schedule', width: '18rem' },
      { key: 'pax', label: 'Total Pax', width: '7rem' },
      { key: 'status', label: 'Status', width: '11rem' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ],
    actions: [
      { key: 'view', label: 'View proposal', icon: 'visibility' },
      { key: 'print', label: 'Print form', icon: 'print' },
    ],
    emptyTitle: 'Nothing needs your action',
    emptyDescription: 'Try changing your search or status filter.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => [
    {
      key: 'status',
      ariaLabel: 'Status',
      value: this.statusFilter(),
      options: [{ value: 'All', label: 'All statuses' }, ...INBOX_STATUSES.map((value) => ({ value, label: value }))],
    },
  ]);

  readonly sharedRecords = computed<readonly InternalDataRecord[]>(() => this.visibleItems().map((item): InternalDataRecord => ({
    id: item.id,
    emphasized: item.status === 'Revision required',
    cells: {
      proposalId: { primary: item.proposalId },
      eventTitle: { primary: item.eventTitle },
      applicant: { primary: item.applicant },
      schedule: { primary: item.schedule },
      pax: { primary: String(item.totalPax) },
      status: { primary: item.status, badge: true, tone: this.statusTone(item.status) },
    },
    mobile: {
      eyebrow: item.proposalId,
      status: item.status,
      title: item.eventTitle,
      identity: item.applicant,
      initials: item.applicantInitials,
      unread: item.status === 'Revision required',
      details: [
        { icon: 'schedule', text: item.schedule },
        { icon: 'groups', text: `${item.totalPax} expected pax` },
      ],
    },
    actionKeys: ['view', 'print'],
  })));

  updateSearchDraft(value: string): void {
    this.searchDraft.set(value);
    this.page.set(1);
  }

  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }

  handleRowAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'view') this.openProposal(Number(event.record.id));
  }

  openRecord(record: InternalDataRecord): void {
    this.openProposal(Number(record.id));
  }

  resetFilters(): void {
    this.searchDraft.set('');
    this.statusFilter.set('All');
    this.page.set(1);
  }

  updatePage(nextPage: number): void {
    this.page.set(nextPage);
  }

  updatePageSize(nextSize: number): void {
    this.pageSize.set(nextSize);
    this.page.set(1);
  }

  private openProposal(id: number): void {
    const item = this.items().find((entry) => entry.id === id);
    if (!item) return;
    void this.router.navigate(['/app/proposals/review', id], {
      state: { proposal: item },
      queryParams: { returnTo: this.router.url },
    });
  }

  private statusTone(status: string): InternalCellTone {
    if (status === 'Revision required') return 'warning';
    if (status === 'Submitted') return 'blue';
    return 'blue';
  }
}
