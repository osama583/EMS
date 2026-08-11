import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';
import { proposalForTitle } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { proposalSectionForUser, userIsApplicantForProposal } from '../../../../core/proposals/proposal-visibility';
import { ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { DepartmentRequestKind, requestKindsForRole } from '../../../../core/departments/department-workflow.config';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';

type RecordsPageKind = 'drafts' | 'pending' | 'history' | 'notifications' | 'request-ongoing' | 'request-history';

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
  readonly requestKind?: DepartmentRequestKind;
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

// Drafts/Pending(Ongoing)/History are now populated at runtime from real `ProposalReviewRecord`s
// fetched via `ProposalWorkflowService.list()` (see `buildConvertedRecords()` /
// `RecordsPageComponent`'s constructor) — their `records` arrays below are left empty and are
// never read for these 3 kinds; only `title`/`description`/etc. display metadata is used from
// this definition table. Notifications/request-ongoing/request-history remain intentionally
// hardcoded (see class-level comment).
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
  pending: {
    title: 'Ongoing',
    description: 'Track related proposals that are moving through review and are not currently waiting for your action.',
    searchPlaceholder: 'Event title, proposal code, or reviewer',
    emptyTitle: 'No pending proposals found',
    emptyDescription: 'There are no proposals matching these filters.',
    statusLabel: 'All review stages',
    categoryLabel: 'All categories',
    actions: [{ key: 'view', label: 'View proposal', icon: 'visibility' }],
    records: [],
  },
  history: {
    title: 'History',
    description: 'Review the history and final outcomes of your event proposals.',
    searchPlaceholder: 'Event title, proposal code, or outcome',
    emptyTitle: 'No proposal history found',
    emptyDescription: 'Try changing your search or outcome filters.',
    statusLabel: 'All outcomes',
    categoryLabel: 'All categories',
    actions: [{ key: 'view', label: 'View proposal', icon: 'visibility' }],
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
  'request-ongoing': {
    title: 'Ongoing Requests',
    description: 'Track active event-service requests and assigned work.',
    searchPlaceholder: 'Event, request code, or service',
    emptyTitle: 'No ongoing requests found',
    emptyDescription: 'There are no active requests matching these filters.',
    statusLabel: 'All request stages',
    categoryLabel: 'All services',
    actions: [{ key: 'view', label: 'View request', icon: 'visibility' }],
    records: [
      { id: 501, title: 'APU Cultural Night 2026', summary: 'Catering request is being prepared for the event.', reference: 'REQ-260142', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '31 Jul 2026, 4:18 PM', status: 'In progress', requestKind: 'fmb' },
      { id: 502, title: 'Future Tech Showcase', summary: 'Audio-visual equipment allocation is under review.', reference: 'REQ-260137', category: 'A/V Services', owner: 'A/V Services', initials: 'AV', date: '30 Jul 2026, 11:42 AM', status: 'Assigned', requestKind: 'soundLight' },
      { id: 503, title: 'APU Sports Carnival', summary: 'Transport routing is being coordinated.', reference: 'REQ-260129', category: 'Transport', owner: 'Transport Services', initials: 'TS', date: '29 Jul 2026, 5:27 PM', status: 'In progress', requestKind: 'transportation' },
      { id: 504, title: 'Career Connections Forum', summary: 'Venue layout and logistics support are scheduled.', reference: 'REQ-260121', category: 'Logistics', owner: 'Logistics and Facilities', initials: 'LF', date: '28 Jul 2026, 10:20 AM', status: 'Scheduled', requestKind: 'logistics' },
      { id: 505, title: 'APU Cultural Night 2026', summary: 'Campus tour route is ready for Student Services assignment.', reference: 'REQ-260142-T', category: 'Campus Tour', owner: 'Student Services', initials: 'SS', date: '3 Aug 2026, 9:10 AM', status: 'Awaiting assignment', requestKind: 'campusTour' },
      { id: 506, title: 'APU Cultural Night 2026', summary: 'Mineral-water quantities and delivery details await assignment.', reference: 'REQ-260142-W', category: 'Mineral Water', owner: 'FMB', initials: 'FM', date: '3 Aug 2026, 9:08 AM', status: 'Awaiting assignment', requestKind: 'waterLogo' },
    ],
  },
  'request-history': {
    title: 'Request History',
    description: 'Review completed and historical event-service requests.',
    searchPlaceholder: 'Event, request code, service, or outcome',
    emptyTitle: 'No request history found',
    emptyDescription: 'Try changing your search or filters.',
    statusLabel: 'All outcomes',
    categoryLabel: 'All services',
    actions: [{ key: 'view', label: 'View request', icon: 'visibility' }],
    records: [
      { id: 601, title: 'Graduate Networking Evening', summary: 'Catering service was delivered.', reference: 'REQ-260082', category: 'Catering', owner: 'Cafeteria Services', initials: 'CS', date: '23 Jul 2026, 6:02 PM', status: 'Completed', requestKind: 'fmb' },
      { id: 602, title: 'Clubs and Societies Fair', summary: 'Photography service completed after the event.', reference: 'REQ-260074', category: 'Photography', owner: 'Photography Services', initials: 'PS', date: '18 Jul 2026, 3:44 PM', status: 'Completed', requestKind: 'photoVideo' },
      { id: 603, title: 'Wellness Weekend', summary: 'Transport arrangements completed successfully.', reference: 'REQ-260066', category: 'Transport', owner: 'Transport Services', initials: 'TS', date: '12 Jul 2026, 12:11 PM', status: 'Completed', requestKind: 'transportation' },
      { id: 604, title: 'Campus Film Screening', summary: 'A/V request was cancelled before delivery.', reference: 'REQ-260051', category: 'A/V Services', owner: 'A/V Services', initials: 'AV', date: '5 Jul 2026, 9:30 AM', status: 'Cancelled', requestKind: 'soundLight' },
      { id: 605, title: 'Clubs and Societies Fair', summary: 'Campus tour completed by the assigned Student Services member.', reference: 'REQ-260074-T', category: 'Campus Tour', owner: 'Student Services', initials: 'SS', date: '18 Jul 2026, 4:00 PM', status: 'Completed', requestKind: 'campusTour' },
      { id: 606, title: 'Graduate Networking Evening', summary: 'Mineral-water preparation and delivery completed.', reference: 'REQ-260082-W', category: 'Mineral Water', owner: 'FMB', initials: 'FM', date: '23 Jul 2026, 4:30 PM', status: 'Completed', requestKind: 'waterNormal' },
    ],
  },
};

// 'drafts'/'pending'/'history' are converted to real ProposalWorkflowService-backed data (see
// constructor below). 'notifications'/'request-ongoing'/'request-history' are INTENTIONALLY LEFT
// hardcoded against `PAGE_DEFINITIONS` — no `notification` table exists in the corrected schema
// (ems_database_schema.sql), and "request tracking" as a concept separate from a proposal's own
// department tasks has no backend model in this plan. Do not silently invent a backend for these;
// see task-4.3-brief.md Step 2 for the full rationale.
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
  readonly role = this.auth.user()?.role ?? UserRole.Applicant;
  readonly kind = (this.route.snapshot.data['collectionPage'] ?? 'drafts') as RecordsPageKind;
  readonly definition = PAGE_DEFINITIONS[this.kind];
  readonly records = signal<readonly CollectionRecord[]>(this.definition.records);
  readonly search = signal('');
  readonly status = signal('All');
  readonly category = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly loading = signal(this.isConverted());
  readonly error = signal('');

  // Real `ProposalReviewRecord`s backing 'drafts'/'pending'/'history' — keyed by id so
  // `proposalDetails()`/`openReview()` can pass the FULL real record via router state (matching
  // inbox.ts's `openProposal()`) instead of round-tripping through a mock-data lookup. Kept
  // separate from `records` (which still drives the shared table/filter/pagination plumbing via
  // its lightweight `CollectionRecord` projection) so the 3 unconverted kinds' existing
  // `CollectionRecord`-only flow (via `proposalForTitle()`) is untouched.
  private readonly proposalsById = new Map<number, ProposalReviewRecord>();

  constructor() {
    if (!this.isConverted()) return;
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (proposals) => {
        const user = this.auth.user();
        const relevant = proposals.filter((proposal) => this.matchesKind(user, proposal));
        this.proposalsById.clear();
        for (const proposal of relevant) this.proposalsById.set(proposal.id, proposal);
        this.records.set(relevant.map((proposal) => this.toCollectionRecord(proposal)));
        this.loading.set(false);
      },
      error: () => { this.error.set(`${this.definition.title} could not be loaded.`); this.loading.set(false); },
    });
  }

  private isConverted(): boolean {
    const kind = (this.route.snapshot.data['collectionPage'] ?? 'drafts') as RecordsPageKind;
    return kind === 'drafts' || kind === 'pending' || kind === 'history';
  }

  private matchesKind(user: ReturnType<AuthService['user']>, proposal: ProposalReviewRecord): boolean {
    if (this.kind === 'drafts') {
      // A draft has no ProposalStage enum member of its own (see proposal-status.models.ts) —
      // the server projects an unsubmitted request's DB `status = 'draft'` as the display string
      // `status: 'Draft'` (proposal-projection.service.js's STAGE_LABELS), which is the field
      // this filter checks; `workflow.stage` for the same row is the raw unmapped string
      // `'draft'`, not a valid ProposalStage, so it is intentionally not used here.
      return userIsApplicantForProposal(user, proposal) && proposal.status === 'Draft';
    }
    const section = proposalSectionForUser(user, proposal);
    return section === (this.kind === 'pending' ? 'ongoing' : 'history');
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
    const routedKinds = requestKindsForRole(this.role);
    return this.records().filter((record) => {
      if (this.isRequestTracking() && routedKinds.length && (!record.requestKind || !routedKinds.includes(record.requestKind))) return false;
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
    this.openReview(Number(record.id));
  }
  handleAction(event: InternalRowActionEvent): void {
    if (this.kind === 'notifications' && (event.action.key === 'open' || event.action.key === 'read')) this.markRead(Number(event.record.id));
    // Client-side-only removal: there is no `DELETE /api/proposal-workflow/:id` route in Phase 3
    // (confirmed against proposal-workflow.routes.js), and adding one is out of this task's scope
    // (see task-4.3-brief.md Step 2). This only mutates local signal state — a page reload will
    // bring the "deleted" draft right back since the server was never told to remove it. Known,
    // intentional gap.
    if (this.kind === 'drafts' && event.action.key === 'delete') this.records.update((records) => records.filter((record) => record.id !== event.record.id));
    if (event.action.key === 'view') this.openReview(Number(event.record.id));
  }

  private markRead(id: number): void {
    this.records.update((records) => records.map((record) => record.id === id ? { ...record, unread: false, status: 'Read' } : record));
  }
  private isRequestTracking(): boolean { return this.kind === 'request-ongoing' || this.kind === 'request-history'; }
  private openReview(id: number): void {
    const record = this.records().find((item) => item.id === id);
    if (!record) return;
    void this.router.navigate(['/app/proposals/review', id], {
      state: { proposal: this.proposalDetails(record) },
      queryParams: { returnTo: this.router.url, allowAssignment: this.kind === 'request-ongoing', readOnly: this.kind !== 'notifications' && this.kind !== 'drafts' && this.kind !== 'request-ongoing' },
    });
  }
  private proposalDetails(record: CollectionRecord): ProposalReviewRecord {
    // For the 3 backend-converted kinds, `record.id` keys directly into the real fetched
    // ProposalReviewRecord — no mock-lookup/status-string translation needed, since the server
    // already set `workflow.stage` correctly.
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
