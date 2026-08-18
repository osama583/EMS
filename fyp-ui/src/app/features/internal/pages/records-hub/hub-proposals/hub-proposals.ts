import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ProposalReviewRecord } from '../../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../../core/proposals/proposal-workflow.service';
import { ProposalStage } from '../../../../../core/proposals/proposal-status.models';
import { proposalSectionForUser, userIsApplicantForProposal } from '../../../../../core/proposals/proposal-visibility';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
} from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { RecordsHubBucket } from '../records-hub';

const BUCKET_COPY: Readonly<Record<RecordsHubBucket, { title: string; description: string; empty: string }>> = {
  inbox: { title: 'Proposals', description: 'Proposals that need your action.', empty: 'Nothing needs your action' },
  ongoing: { title: 'Proposals', description: 'Proposals moving through review that are not currently waiting on you.', empty: 'No ongoing proposals found' },
  history: { title: 'Proposals', description: 'Completed proposals — approved, rejected, or cancelled.', empty: 'No proposal history found' },
};

// Reused for all 3 buckets — same data source (ProposalWorkflowService.list()) split by
// proposalSectionForUser()'s existing 'inbox' | 'ongoing' | 'history' classification, which
// already encodes "does this belong to this viewer, and is it waiting on them right now" per
// proposal-visibility.ts. Replaces the old separate InboxProposalsComponent and
// RecordsPageComponent's 'drafts'-free pending/history kinds.
@Component({
  selector: 'app-hub-proposals',
  imports: [InternalDataPageComponent],
  templateUrl: './hub-proposals.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubProposalsComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly bucket = this.route.parent!.snapshot.data['bucket'] as RecordsHubBucket;
  private readonly copy = BUCKET_COPY[this.bucket];

  readonly search = signal('');
  readonly statusFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly items = signal<readonly ProposalReviewRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() {
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: () => { this.error.set('Proposals could not be loaded.'); this.loading.set(false); },
    });
  }

  readonly bucketedItems = computed(() => {
    const user = this.auth.user();
    return this.items().filter((item) => proposalSectionForUser(user, item) === this.bucket);
  });

  readonly filteredItems = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    return this.bucketedItems().filter((item) => {
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
    ariaLabel: this.copy.title,
    paginationLabel: `${this.copy.title} pagination`,
    rowsPerPageLabel: 'Items per page',
    mobileListLabel: `${this.copy.title} cards`,
    header: { title: this.copy.title, description: this.copy.description, countLabel: `${this.filteredItems().length} proposal${this.filteredItems().length === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search proposals', placeholder: 'Proposal ID, event title, or applicant' },
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
    emptyTitle: this.copy.empty,
    emptyDescription: 'Try changing your search or status filter.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => {
    const statuses = [...new Set(this.bucketedItems().map((item) => item.status))];
    return [{ key: 'status', ariaLabel: 'Status', value: this.statusFilter(), options: [{ value: 'All', label: 'All statuses' }, ...statuses.map((value) => ({ value, label: value }))] }];
  });

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

  updateSearchDraft(value: string): void { this.search.set(value); this.page.set(1); }
  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }
  handleRowAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'view') this.openProposal(Number(event.record.id));
  }
  openRecord(record: InternalDataRecord): void { this.openProposal(Number(record.id)); }
  resetFilters(): void { this.search.set(''); this.statusFilter.set('All'); this.page.set(1); }
  updatePage(nextPage: number): void { this.page.set(nextPage); }
  updatePageSize(nextSize: number): void { this.pageSize.set(nextSize); this.page.set(1); }

  private openProposal(id: number): void {
    const item = this.items().find((entry) => entry.id === id);
    if (!item) return;
    // An applicant whose own proposal was sent back for changes edits it in the same form used to
    // create it, not the reviewer-facing /proposals/review page — mirrors records-page.ts's
    // openDraft() for the 'drafts' bucket, just keyed off ResubmissionRequired instead of 'Draft'.
    if (item.workflow.stage === ProposalStage.ResubmissionRequired && userIsApplicantForProposal(this.auth.user(), item)) {
      void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: id } });
      return;
    }
    void this.router.navigate(['/app/proposals/review', id], {
      state: { proposal: item },
      queryParams: { returnTo: this.router.url, readOnly: this.bucket !== 'inbox' },
    });
  }

  private statusTone(status: string): InternalCellTone {
    if (status === 'Revision required') return 'warning';
    if (status === 'Rejected' || status === 'Cancelled') return 'danger';
    if (status === 'Approved') return 'success';
    return 'blue';
  }
}
