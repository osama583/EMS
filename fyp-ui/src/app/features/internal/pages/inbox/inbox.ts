import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { PROPOSAL_REVIEW_RECORDS } from '../../../../core/proposals/proposal-review.mock-data';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { DepartmentRequestKind, requestKindsForRole } from '../../../../core/departments/department-workflow.config';
import { userOwnsCurrentProposalAction } from '../../../../core/proposals/proposal-visibility';
import { UserRole } from '../../../../core/auth/auth.models';

interface InboxItem extends ProposalReviewRecord {
  readonly requestKind?: DepartmentRequestKind;
}

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
  readonly role = this.auth.user()?.role ?? UserRole.Applicant;
  readonly searchDraft = signal('');
  readonly statusFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly items = signal<readonly InboxItem[]>([
    { ...PROPOSAL_REVIEW_RECORDS[1], status: 'Revision required' },
    { ...PROPOSAL_REVIEW_RECORDS[2], status: 'Additional approval' },
    { ...PROPOSAL_REVIEW_RECORDS[0], status: 'Department review', requestKind: 'logistics' },
    { ...PROPOSAL_REVIEW_RECORDS[3], status: 'Submitted' },
    { ...PROPOSAL_REVIEW_RECORDS[4], status: 'Department review', requestKind: 'fmb' },
    { ...PROPOSAL_REVIEW_RECORDS[0], id: 906, proposalId: 'EVT-260142-T', status: 'Department review', requestKind: 'campusTour' },
    { ...PROPOSAL_REVIEW_RECORDS[0], id: 907, proposalId: 'EVT-260142-W', status: 'Department review', requestKind: 'waterLogo' },
    { ...PROPOSAL_REVIEW_RECORDS[0], id: 908, proposalId: 'EVT-260142-P', status: 'Department review', requestKind: 'photoVideo' },
    { ...PROPOSAL_REVIEW_RECORDS[0], id: 909, proposalId: 'EVT-260142-AV', status: 'Department review', requestKind: 'soundLight' },
    { ...PROPOSAL_REVIEW_RECORDS[0], id: 910, proposalId: 'EVT-260142-TR', status: 'Department review', requestKind: 'transportation' },
  ]);

  readonly filteredItems = computed(() => {
    const query = this.searchDraft().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    const routedKinds = requestKindsForRole(this.role);
    const user = this.auth.user();

    return this.items().filter((item) => {
      // Permission gate: only show proposals where the current stage's action actually belongs
      // to this role right now (reviewer-stage ownership, or an unconfirmed department they
      // manage — checked against the proposal's own departmentConfirmations, not just which
      // request kinds the role happens to be tagged with, since a role like CFO is both a
      // reviewer-chain gate and a department owner and must not have one capacity filtered by
      // the other). This must run before any display filter — restricted items should never
      // render, not render-then-block when opened.
      if (!userOwnsCurrentProposalAction(user, item, item.requestKind)) return false;
      // A department manager/staff role only ever owns their own request kind — a row explicitly
      // tagged with a different kind (e.g. a synthetic per-department demo row) must not leak in
      // even though the underlying proposal's workflow state passed the check above.
      if (item.requestKind && routedKinds.length && !routedKinds.includes(item.requestKind)) return false;
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
