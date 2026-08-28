import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, finalize, switchMap } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalSortKey, SortOrder } from '../../../../core/proposals/proposal-workflow.repository';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
  InternalSortChange,
  InternalSortState,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';

type RecordsPageKind = 'drafts' | 'notifications';

interface CollectionRecord {
  readonly id: number;
  readonly title: string;
  readonly summary: string;
  readonly reference: string;
  readonly category: string;
  readonly owner: string;
  readonly initials: string;
  readonly date: string;
  readonly status: string;
  readonly unread?: boolean;
}

interface RecordsPageDefinition {
  readonly title: string;
  readonly description: string;
  readonly searchPlaceholder: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly statusLabel: string;
  readonly categoryLabel: string;
  readonly actions: readonly { key: string; label: string; icon: string }[];
  readonly records: readonly CollectionRecord[];
}

// 'drafts' is fetched server-side, one page at a time, filtered/sorted by GET
// /proposals?bucket=drafts — see the constructor. Its `records` array below is left empty and
// never read; only the display metadata (title/description/etc.) is used from this definition
// table.
// FLAGGED GAP (system specification §8F — flag, do not implement): 'notifications' is the ONLY
// list in the app still backed by hardcoded client-side rows. There is no `notification` table in
// ems_database_schema.sql and the specification describes no notification concept, so building a
// real feed would mean inventing a new concept (a table, delivery rules, read state, and a
// producer for every workflow transition). The sample rows below are therefore illustrative
// placeholders, not data — everything else on every other page comes from the API.
const PAGE_DEFINITIONS: Readonly<Record<RecordsPageKind, RecordsPageDefinition>> = {
  drafts: {
    title: 'Drafts',
    description: 'Continue event proposals that have not been submitted.',
    searchPlaceholder: 'Event title, draft code, or category',
    emptyTitle: 'No draft proposals found',
    emptyDescription: 'Try changing your search or filters.',
    statusLabel: 'All draft statuses',
    categoryLabel: 'All categories',
    actions: [
      { key: 'edit', label: 'Continue draft', icon: 'edit' },
      { key: 'delete', label: 'Delete draft', icon: 'delete' },
    ],
    records: [],
  },
  notifications: {
    title: 'Notifications',
    description: 'Stay informed about proposal progress and required actions.',
    searchPlaceholder: 'Notification, proposal, or category',
    emptyTitle: 'No notifications found',
    emptyDescription: 'Try changing your search or notification filters.',
    statusLabel: 'All notifications',
    categoryLabel: 'All types',
    actions: [
      { key: 'open', label: 'Open notification', icon: 'visibility' },
      { key: 'read', label: 'Mark as read', icon: 'done' },
    ],
    records: [
      { id: 401, title: 'Approval stage completed', summary: 'APU Cultural Night has moved to department review.', reference: 'APU Cultural Night 2026', category: 'Proposal update', owner: 'APU Events System', initials: 'AE', date: '31 Jul 2026, 4:20 PM', status: 'Unread', unread: true },
      { id: 402, title: 'Action required', summary: 'Budget details are required for Student Innovation Day.', reference: 'Student Innovation Day', category: 'Required action', owner: 'Finance Office', initials: 'FO', date: '30 Jul 2026, 3:08 PM', status: 'Unread', unread: true },
      { id: 403, title: 'Venue confirmed', summary: 'The requested venue has been reserved.', reference: 'International Student Meetup', category: 'Service update', owner: 'Facilities Management', initials: 'FM', date: '30 Jul 2026, 9:20 AM', status: 'Read' },
      { id: 404, title: 'Additional approval completed', summary: 'FMB approval has been recorded.', reference: 'APU Sports Carnival', category: 'Proposal update', owner: 'FMB Review Team', initials: 'FR', date: '29 Jul 2026, 5:30 PM', status: 'Read' },
      { id: 405, title: 'New inbox reply', summary: 'Technology Services replied to your equipment request.', reference: 'Creative Media Workshop', category: 'Message', owner: 'Technology Services', initials: 'TS', date: '27 Jul 2026, 2:36 PM', status: 'Read' },
    ],
  },
};

@Component({
  selector: 'app-records-page',
  imports: [InternalDataPageComponent, ConfirmDialogComponent],
  template: `
    <app-internal-data-page
      [config]="pageConfig()"
      [records]="sharedRecords()"
      [filters]="filterConfigs()"
      [searchValue]="search()"
      [loading]="loading()"
      [totalPages]="totalPages()"
      [page]="currentPage()"
      [pageSize]="pageSize()"
      [sort]="sort()"
      (searchChange)="updateSearch($event)"
      (filterChange)="updateFilter($event)"
      (reset)="resetFilters()"
      (pageChange)="page.set($event)"
      (pageSizeChange)="updatePageSize($event)"
      (rowAction)="handleAction($event)"
      (recordOpen)="openRecord($event)"
      (sortChange)="updateSort($event)"
    />

    <!-- Deleting a draft is irreversible, so it is always confirmed first (spec §8B). -->
    <app-confirm-dialog
      [open]="deleteTarget() !== null"
      title="Delete draft"
      [message]="'Are you sure you want to delete the draft ' + (deleteTarget()?.title || 'this proposal') + '? This cannot be undone.'"
      confirmLabel="Delete Draft"
      [loading]="deleting()"
      (confirm)="confirmDelete()"
      (cancel)="deleteTarget.set(null)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly deleteTarget = signal<CollectionRecord | null>(null);
  readonly deleting = signal(false);
  readonly kind = (this.route.snapshot.data['collectionPage'] ?? 'drafts') as RecordsPageKind;
  readonly definition = PAGE_DEFINITIONS[this.kind];

  // 'notifications' stays exactly as it was: a static, client-side-only signal (see the FLAGGED
  // GAP note above — there is no real backing endpoint for it).
  readonly notificationRecords = signal<readonly CollectionRecord[]>(this.definition.records);

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly status = signal('All');
  readonly category = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'updatedAt', order: 'desc' });
  readonly loading = signal(this.kind === 'drafts');
  readonly error = signal('');

  readonly statusOptions = signal<readonly string[]>([]);
  readonly categoryOptions = signal<readonly string[]>([]);

  // Real ProposalReviewRecords backing 'drafts', keyed by id so openDraft()/proposalDetails() can
  // route with the full record rather than a display-only projection of it.
  private readonly proposalsById = new Map<number, ProposalReviewRecord>();
  readonly draftTotal = signal(0);
  readonly draftTotalPages = signal(1);
  private readonly draftRecords = signal<readonly CollectionRecord[]>([]);

  constructor() {
    if (this.kind !== 'drafts') return;

    // Debounces the search box only — every other control changes at a human pace already.
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      statusLabel: this.status(),
      category: this.category(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.service.listPage({
            bucket: 'drafts',
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort.key as ProposalSortKey,
            order: query.sort.order as SortOrder,
            q: query.q,
            statusLabel: query.statusLabel,
            category: query.category,
          });
        }),
      )
      .subscribe({
        next: (result) => {
          this.proposalsById.clear();
          for (const proposal of result.items) this.proposalsById.set(proposal.id, proposal);
          this.draftRecords.set(result.items.map((proposal) => this.toCollectionRecord(proposal)));
          this.draftTotal.set(result.total);
          this.draftTotalPages.set(result.totalPages);
          this.loading.set(false);
          this.error.set('');
        },
        error: () => { this.error.set(`${this.definition.title} could not be loaded.`); this.toast.error(`${this.definition.title} could not be loaded`, 'Please refresh and try again.'); this.loading.set(false); },
      });

    this.service.listStatusLabels('drafts').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (labels) => this.statusOptions.set(labels),
      error: () => this.statusOptions.set([]),
    });
    this.service.listCategories('drafts').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => this.categoryOptions.set(categories),
      error: () => this.categoryOptions.set([]),
    });
  }

  private toCollectionRecord(proposal: ProposalReviewRecord): CollectionRecord {
    return {
      id: proposal.id,
      title: proposal.eventTitle,
      summary: proposal.shortIntroduction,
      reference: proposal.proposalId,
      category: proposal.category,
      owner: proposal.applicant,
      initials: proposal.applicantInitials,
      date: proposal.schedule,
      status: proposal.statusLabel ?? (proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)),
    };
  }

  // 'notifications' keeps its original client-side search/filter/paginate over the static list
  // (unchanged behaviour — there is no server endpoint for it, see the FLAGGED GAP note above).
  // 'drafts' is already filtered/sorted/paginated server-side, so filteredNotifications() /
  // visibleNotifications() are simply not on its path.
  private readonly filteredNotifications = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.notificationRecords().filter((record) => {
      const matchesQuery = !query || `${record.title} ${record.summary} ${record.reference} ${record.owner} ${record.category} ${record.status}`.toLocaleLowerCase().includes(query);
      return matchesQuery && (this.status() === 'All' || record.status === this.status()) && (this.category() === 'All' || record.category === this.category());
    });
  });
  private readonly notificationTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredNotifications().length / this.pageSize())));
  private readonly notificationCurrentPage = computed(() => Math.min(this.page(), this.notificationTotalPages()));
  private readonly visibleNotifications = computed(() => {
    const start = (this.notificationCurrentPage() - 1) * this.pageSize();
    return this.filteredNotifications().slice(start, start + this.pageSize());
  });

  readonly records = computed(() => this.kind === 'notifications' ? this.visibleNotifications() : this.draftRecords());
  readonly totalPages = computed(() => this.kind === 'notifications' ? this.notificationTotalPages() : this.draftTotalPages());
  // Drafts trusts the server's page number as-is; notifications clamps client-side (unchanged
  // behaviour) since it paginates a static in-memory list rather than a server response.
  readonly currentPage = computed(() => this.kind === 'notifications' ? this.notificationCurrentPage() : this.page());
  readonly unreadCount = computed(() => this.notificationRecords().filter((record) => record.unread).length);
  readonly pageConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `${this.definition.title} records`,
    paginationLabel: `${this.definition.title} pagination`,
    rowsPerPageLabel: `${this.definition.title} rows per page`,
    mobileListLabel: `${this.definition.title} cards`,
    header: {
      title: this.definition.title,
      description: this.definition.description,
      countLabel: this.kind === 'notifications' ? `${this.unreadCount()} unread` : `${this.draftTotal()} records`,
    },
    search: { ariaLabel: `Search ${this.definition.title.toLocaleLowerCase()}`, placeholder: this.definition.searchPlaceholder },
    columns: this.kind === 'notifications'
      ? [
          { key: 'title', label: 'Notification' },
          { key: 'reference', label: 'Related Proposal' },
          { key: 'owner', label: 'From' },
          { key: 'date', label: 'Received' },
          { key: 'status', label: 'Status' },
          { key: 'actions', label: 'Actions', actions: true },
        ]
      : [
          { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
          { key: 'title', label: 'Event Title', width: '16rem' },
          { key: 'applicant', label: 'Applicant', width: '13rem' },
          { key: 'schedule', label: 'Event Schedule', width: '17rem', sortKey: 'schedule' },
          { key: 'introduction', label: 'Short Introduction', width: '20rem' },
          { key: 'pax', label: 'Total Pax', width: '7rem' },
          { key: 'status', label: 'Status', width: '10rem' },
          { key: 'actions', label: 'Actions', actions: true, width: '8rem' },
        ],
    actions: this.definition.actions,
    emptyTitle: this.definition.emptyTitle,
    emptyDescription: this.definition.emptyDescription,
  }));
  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => this.kind === 'notifications'
    ? [
        { key: 'status', ariaLabel: 'Status', value: this.status(), options: [{ value: 'All', label: this.definition.statusLabel }, ...this.notificationUniqueValues('status').map((value) => ({ value, label: value }))] },
        { key: 'category', ariaLabel: 'Category', value: this.category(), options: [{ value: 'All', label: this.definition.categoryLabel }, ...this.notificationUniqueValues('category').map((value) => ({ value, label: value }))] },
      ]
    : [
        { key: 'status', ariaLabel: 'Status', value: this.status(), options: [{ value: 'All', label: this.definition.statusLabel }, ...this.statusOptions().map((value) => ({ value, label: value }))] },
        { key: 'category', ariaLabel: 'Category', value: this.category(), options: [{ value: 'All', label: this.definition.categoryLabel }, ...this.categoryOptions().map((value) => ({ value, label: value }))] },
      ]);
  readonly sharedRecords = computed<readonly InternalDataRecord[]>(() => this.records().map((record): InternalDataRecord => {
    if (this.kind === 'notifications') return { id: record.id, emphasized: record.unread, cells: { title: { primary: record.title, secondary: record.summary }, reference: { primary: record.reference, secondary: record.category }, owner: { primary: record.owner, avatar: record.initials }, date: { primary: record.date }, status: { primary: record.status, badge: true, tone: this.statusTone(record.status) } }, mobile: { eyebrow: record.category, status: record.status, title: record.title, identity: record.owner, initials: record.initials, unread: record.unread, details: [{ icon: 'description', text: record.reference }, { icon: 'schedule', text: record.date }] } };
    const proposal = this.proposalDetails(record);
    // Falls back to the row's own display fields rather than inventing a
    // proposal: a row with no backing record still renders truthfully.
    if (!proposal) {
      return { id: record.id, cells: { proposalId: { primary: record.reference }, title: { primary: record.title }, applicant: { primary: record.owner }, schedule: { primary: record.date }, introduction: { primary: record.summary }, pax: { primary: '—' }, status: { primary: record.status, badge: true, tone: this.statusTone(record.status) } }, mobile: { eyebrow: record.reference, status: record.status, title: record.title, identity: record.owner, initials: record.initials, details: [{ icon: 'schedule', text: record.date }] } };
    }
    return { id: record.id, cells: { proposalId: { primary: proposal.proposalId }, title: { primary: proposal.eventTitle }, applicant: { primary: proposal.applicant }, schedule: { primary: proposal.schedule }, introduction: { primary: proposal.shortIntroduction }, pax: { primary: String(proposal.totalPax) }, status: { primary: record.status, badge: true, tone: this.statusTone(record.status) } }, mobile: { eyebrow: proposal.proposalId, status: record.status, title: proposal.eventTitle, identity: proposal.applicant, initials: proposal.applicantInitials, details: [{ icon: 'schedule', text: proposal.schedule }, { icon: 'groups', text: `${proposal.totalPax} expected pax` }, { icon: 'notes', text: proposal.shortIntroduction }] } };
  }));

  updateSearch(value: string): void {
    if (this.kind === 'notifications') { this.search.set(value); this.page.set(1); return; }
    this.search.set(value);
  }
  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.status.set(change.value);
    if (change.key === 'category') this.category.set(change.value);
    this.page.set(1);
  }
  updateSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  resetFilters(): void { this.search.set(''); this.debouncedSearch.set(''); this.status.set('All'); this.category.set('All'); this.page.set(1); }
  updatePageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  openRecord(record: InternalDataRecord): void {
    if (this.kind === 'notifications') { this.markRead(Number(record.id)); return; }
    this.openDraft(Number(record.id));
  }
  handleAction(event: InternalRowActionEvent): void {
    if (this.kind === 'notifications' && (event.action.key === 'open' || event.action.key === 'read')) this.markRead(Number(event.record.id));
    if (this.kind === 'drafts' && event.action.key === 'delete') this.askDeleteDraft(Number(event.record.id));
    if (event.action.key === 'view' || event.action.key === 'edit') this.openDraft(Number(event.record.id));
  }

  private askDeleteDraft(id: number): void {
    const record = this.records().find((entry) => entry.id === id);
    if (record) this.deleteTarget.set(record);
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleting.set(true);
    this.service.deleteDraft(target.id).pipe(
      finalize(() => this.deleting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.draftRecords.update((records) => records.filter((record) => record.id !== target.id));
        this.draftTotal.update((total) => Math.max(0, total - 1));
        this.deleteTarget.set(null);
        this.toast.success('Draft deleted', `${target.title} has been removed.`);
      },
      error: (err) => {
        this.deleteTarget.set(null);
        this.toast.error('Could not delete this draft', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  private markRead(id: number): void {
    this.notificationRecords.update((records) => records.map((record) => record.id === id ? { ...record, unread: false, status: 'Read' } : record));
  }
  private openDraft(id: number): void {
    void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: id } });
  }
  /**
   * The real record this row came from, or null.
   *
   * Every row is now backed by a proposal fetched from the API, so a miss means
   * something is genuinely wrong. This used to synthesise a plausible-looking
   * proposal from the row's display text, which put fabricated data in front of
   * a reviewer; callers navigate by id instead and let the detail page load the
   * real thing.
   */
  private proposalDetails(record: CollectionRecord): ProposalReviewRecord | null {
    return this.proposalsById.get(record.id) ?? null;
  }
  private notificationUniqueValues(key: 'status' | 'category'): string[] { return [...new Set(this.notificationRecords().map((record) => record[key]))]; }
  private statusTone(status: string): InternalCellTone {
    if (['Completed', 'Approved', 'Read'].includes(status)) return 'success';
    if (['Rejected', 'Cancelled'].includes(status)) return 'danger';
    if (['Details missing', 'Required action', 'Unread'].includes(status)) return 'warning';
    return 'blue';
  }
}
