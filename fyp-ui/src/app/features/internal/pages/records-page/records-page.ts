import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { proposalForTitle } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { userIsApplicantForProposal } from '../../../../core/proposals/proposal-visibility';
import { ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
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

// 'drafts' is populated at runtime from real ProposalReviewRecords (see buildConvertedRecords() /
// this component's constructor) — its `records` array below is left empty and never read; only
// the display metadata (title/description/etc.) is used from this definition table.
// 'notifications' remains intentionally hardcoded — no `notification` table exists in the
// corrected schema (ems_database_schema.sql). 2026-08-13 sidebar reorg: 'pending'/'history'/
// 'request-ongoing'/'request-history' kinds were removed from this component entirely — they now
// live in records-hub's Ongoing/History pages (hub-proposals.ts / hub-requests.ts), which reuse
// the same underlying data sources bucketed by proposalSectionForUser instead of a page-per-kind.
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
  imports: [InternalDataPageComponent],
  template: `
    <app-internal-data-page
      [config]="pageConfig()"
      [records]="sharedRecords()"
      [filters]="filterConfigs()"
      [searchValue]="search()"
      [totalPages]="totalPages()"
      [page]="currentPage()"
      [pageSize]="pageSize()"
      (searchChange)="updateSearch($event)"
      (filterChange)="updateFilter($event)"
      (reset)="resetFilters()"
      (pageChange)="page.set($event)"
      (pageSizeChange)="updatePageSize($event)"
      (rowAction)="handleAction($event)"
      (recordOpen)="openRecord($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly service = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);
  readonly kind = (this.route.snapshot.data['collectionPage'] ?? 'drafts') as RecordsPageKind;
  readonly definition = PAGE_DEFINITIONS[this.kind];
  readonly records = signal<readonly CollectionRecord[]>(this.definition.records);
  readonly search = signal('');
  readonly status = signal('All');
  readonly category = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly loading = signal(this.kind === 'drafts');
  readonly error = signal('');

  // Real ProposalReviewRecords backing 'drafts' — keyed by id so proposalDetails()/openReview()
  // can pass the FULL real record via router state instead of round-tripping through a mock-data
  // lookup.
  private readonly proposalsById = new Map<number, ProposalReviewRecord>();

  constructor() {
    if (this.kind !== 'drafts') return;
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (proposals) => {
        const user = this.auth.user();
        const relevant = proposals.filter((proposal) => userIsApplicantForProposal(user, proposal) && proposal.status === 'Draft');
        this.proposalsById.clear();
        for (const proposal of relevant) this.proposalsById.set(proposal.id, proposal);
        this.records.set(relevant.map((proposal) => this.toCollectionRecord(proposal)));
        this.loading.set(false);
      },
      error: () => { this.error.set(`${this.definition.title} could not be loaded.`); this.loading.set(false); },
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
      status: proposal.status,
    };
  }

  readonly filteredRecords = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.records().filter((record) => {
      const matchesQuery = !query || `${record.title} ${record.summary} ${record.reference} ${record.owner} ${record.category} ${record.status}`.toLocaleLowerCase().includes(query);
      return matchesQuery && (this.status() === 'All' || record.status === this.status()) && (this.category() === 'All' || record.category === this.category());
    });
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRecords().length / this.pageSize())));
  readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));
  readonly visibleRecords = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredRecords().slice(start, start + this.pageSize());
  });
  readonly unreadCount = computed(() => this.records().filter((record) => record.unread).length);
  readonly pageConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `${this.definition.title} records`,
    paginationLabel: `${this.definition.title} pagination`,
    rowsPerPageLabel: `${this.definition.title} rows per page`,
    mobileListLabel: `${this.definition.title} cards`,
    header: {
      title: this.definition.title,
      description: this.definition.description,
      countLabel: this.kind === 'notifications' ? `${this.unreadCount()} unread` : `${this.filteredRecords().length} records`,
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
          { key: 'schedule', label: 'Event Schedule', width: '17rem' },
          { key: 'introduction', label: 'Short Introduction', width: '20rem' },
          { key: 'pax', label: 'Total Pax', width: '7rem' },
          { key: 'status', label: 'Status', width: '10rem' },
          { key: 'actions', label: 'Actions', actions: true, width: '8rem' },
        ],
    actions: this.definition.actions,
    emptyTitle: this.definition.emptyTitle,
    emptyDescription: this.definition.emptyDescription,
    pageSizeOptions: [5, 10, 25],
  }));
  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => [
    {
      key: 'status', ariaLabel: 'Status', value: this.status(),
      options: [{ value: 'All', label: this.definition.statusLabel }, ...this.uniqueValues('status').map((value) => ({ value, label: value }))],
    },
    {
      key: 'category', ariaLabel: 'Category', value: this.category(),
      options: [{ value: 'All', label: this.definition.categoryLabel }, ...this.uniqueValues('category').map((value) => ({ value, label: value }))],
    },
  ]);
  readonly sharedRecords = computed<readonly InternalDataRecord[]>(() => this.visibleRecords().map((record): InternalDataRecord => {
    if (this.kind === 'notifications') return { id: record.id, emphasized: record.unread, cells: { title: { primary: record.title, secondary: record.summary }, reference: { primary: record.reference, secondary: record.category }, owner: { primary: record.owner, avatar: record.initials }, date: { primary: record.date }, status: { primary: record.status, badge: true, tone: this.statusTone(record.status) } }, mobile: { eyebrow: record.category, status: record.status, title: record.title, identity: record.owner, initials: record.initials, unread: record.unread, details: [{ icon: 'description', text: record.reference }, { icon: 'schedule', text: record.date }] } };
    const proposal = this.proposalDetails(record);
    return { id: record.id, cells: { proposalId: { primary: proposal.proposalId }, title: { primary: proposal.eventTitle }, applicant: { primary: proposal.applicant }, schedule: { primary: proposal.schedule }, introduction: { primary: proposal.shortIntroduction }, pax: { primary: String(proposal.totalPax) }, status: { primary: record.status, badge: true, tone: this.statusTone(record.status) } }, mobile: { eyebrow: proposal.proposalId, status: record.status, title: proposal.eventTitle, identity: proposal.applicant, initials: proposal.applicantInitials, details: [{ icon: 'schedule', text: proposal.schedule }, { icon: 'groups', text: `${proposal.totalPax} expected pax` }, { icon: 'notes', text: proposal.shortIntroduction }] } };
  }));

  updateSearch(value: string): void { this.search.set(value); this.page.set(1); }
  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.status.set(change.value);
    if (change.key === 'category') this.category.set(change.value);
    this.page.set(1);
  }
  resetFilters(): void { this.search.set(''); this.status.set('All'); this.category.set('All'); this.page.set(1); }
  updatePageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  openRecord(record: InternalDataRecord): void {
    if (this.kind === 'notifications') { this.markRead(Number(record.id)); return; }
    this.openDraft(Number(record.id));
  }
  handleAction(event: InternalRowActionEvent): void {
    if (this.kind === 'notifications' && (event.action.key === 'open' || event.action.key === 'read')) this.markRead(Number(event.record.id));
    if (this.kind === 'drafts' && event.action.key === 'delete') this.deleteDraft(Number(event.record.id));
    if (event.action.key === 'view' || event.action.key === 'edit') this.openDraft(Number(event.record.id));
  }

  private deleteDraft(id: number): void {
    this.service.deleteDraft(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.records.update((records) => records.filter((record) => record.id !== id)),
      error: () => { this.error.set('The draft could not be deleted.'); },
    });
  }

  private markRead(id: number): void {
    this.records.update((records) => records.map((record) => record.id === id ? { ...record, unread: false, status: 'Read' } : record));
  }
  private openDraft(id: number): void {
    void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: id } });
  }
  private proposalDetails(record: CollectionRecord): ProposalReviewRecord {
    // For 'drafts', record.id keys directly into the real fetched ProposalReviewRecord — no
    // mock-lookup/status-string translation needed.
    const real = this.proposalsById.get(record.id);
    if (real) return real;
    const proposal = proposalForTitle(record.title, record.id);
    return {
      ...proposal,
      id: record.id,
      proposalId: record.reference,
      eventTitle: record.title,
      shortIntroduction: record.summary || proposal.shortIntroduction,
      status: record.status,
      category: record.category,
      workflow: { ...proposal.workflow, stage: this.stageForStatus(record.status, proposal.workflow.stage) },
    };
  }
  private stageForStatus(status: string, fallback: ProposalStage): ProposalStage {
    if (status === 'Approved' || status === 'Completed') return ProposalStage.Approved;
    if (status === 'Rejected' || status === 'Cancelled') return ProposalStage.Rejected;
    if (status === 'Revision required' || status === 'Details missing' || status === 'Required action') return ProposalStage.ResubmissionRequired;
    if (status === 'Department review' || status === 'In progress' || status === 'Assigned' || status === 'Scheduled' || status === 'Awaiting assignment') return ProposalStage.DepartmentReview;
    if (status === 'Additional approval' || status === 'CFO review') return ProposalStage.CfoReview;
    if (status === 'F&B review') return ProposalStage.FmbReview;
    if (status === 'Submitted' || status === 'HOS/HOD review') return ProposalStage.HosHodReview;
    return fallback;
  }
  private uniqueValues(key: 'status' | 'category'): string[] { return [...new Set(this.records().map((record) => record[key]))]; }
  private statusTone(status: string): InternalCellTone {
    if (['Completed', 'Approved', 'Read'].includes(status)) return 'success';
    if (['Rejected', 'Cancelled'].includes(status)) return 'danger';
    if (['Details missing', 'Required action', 'Unread'].includes(status)) return 'warning';
    return 'blue';
  }
}
