import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../../core/auth/auth.service';
import { hasRole, isHeadOfAnyUnit } from '../../../../../core/auth/role-access';
import { ProposalReviewRecord } from '../../../../../core/proposals/proposal-review.models';
import { EditableRow } from '../../../../../shared/components/form-controls/form-controls.models';
import { ProposalSortKey, SortOrder } from '../../../../../core/proposals/proposal-workflow.repository';
import { ProposalWorkflowService } from '../../../../../core/proposals/proposal-workflow.service';
import { departmentsAwaitingApplicant, proposalNeedsApplicantAction, userIsApplicantForProposal } from '../../../../../core/proposals/proposal-visibility';
import { ProposalStage, DEPARTMENT_LABELS } from '../../../../../core/proposals/proposal-status.models';
import { DepartmentRequestKind } from '../../../../../core/departments/department-workflow.config';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
  InternalSortChange,
  InternalSortState,
} from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { RecordsHubBucket } from '../records-hub';

const BUCKET_COPY: Readonly<Record<RecordsHubBucket, { title: string; description: string; empty: string }>> = {
  inbox: { title: 'Proposals', description: 'Proposals that need your action.', empty: 'Nothing needs your action' },
  ongoing: { title: 'Proposals', description: 'Proposals moving through review that are not currently waiting on you.', empty: 'No ongoing proposals found' },
  history: { title: 'Proposals', description: 'Completed proposals — approved, rejected, or cancelled.', empty: 'No proposal history found' },
};

// --- Schedule cell formatting ---------------------------------------------
// Module-level and exported so they can be tested without standing up the component's
// router/auth/http dependencies. All three columns walk the SAME rows in the SAME order, so
// the second date, the second time and the second location still line up as one reading
// across the row — nothing is deduplicated or collapsed into a range.

export function joinScheduleRows(rows: readonly EditableRow[], format: (row: EditableRow) => string): string {
  const parts = rows.map(format).filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

// Split rather than `new Date(iso)`: that parses a bare date as UTC, which lands on the
// previous day for anyone west of it.
export function formatScheduleDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The server sends "09:00:00"; the seconds are noise in a list.
export function formatScheduleTime(start: string, end: string): string {
  if (!start && !end) return '';
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

// Every list control here (search, status filter, sort, page, page size) is a real server query param
// — GET /proposals?bucket=&q=&statusLabel=&sort=&order=&page=&pageSize= — computed by proposals.py's
// list_proposals()/_BUCKET_SQL/_STATUS_LABEL_SQL.
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
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('All');
  // Who the proposal belongs to, not who acted on it — 'mine' is the viewer's own submissions, 'co-
  // owned' is theirs as a co-owner (not the applicant), 'acted-on' is neither but the viewer
  // reviewed/decided it (heads of school/department and CFO only — see showActedOnOption below).
  readonly requesterFilter = signal<'All' | 'mine' | 'co-owned' | 'acted-on'>('All');

  // 'Acted On' only makes sense for roles that actually review/decide proposals rather than just
  // author or co-own them — head-of-school/department and CFO (FMB head is a head-of-department on the
  // food_beverage_services unit, already covered by isHeadOfAnyUnit).
  private readonly showActedOnOption = computed(() => {
    const user = this.auth.user();
    return !!user && (isHeadOfAnyUnit(user) || hasRole(user, 'cfo'));
  });
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'updatedAt', order: 'desc' });

  readonly items = signal<readonly ProposalReviewRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly statusOptions = signal<readonly string[]>([]);

  constructor() {
    // Debounces the search box only — every other control (filter/sort/page/pageSize) already
    // changes at a human pace and should refetch immediately.
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      bucket: this.bucket,
      q: this.debouncedSearch(),
      statusLabel: this.statusFilter(),
      requester: this.requesterFilter(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.service.listPage({
            bucket: query.bucket,
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort.key as ProposalSortKey,
            order: query.sort.order as SortOrder,
            q: query.q,
            statusLabel: query.statusLabel,
            requester: query.requester === 'All' ? undefined : query.requester,
          }).pipe(
            // Caught HERE, inside switchMap, not in the terminal subscribe's error callback: an error
            // reaching subscribe()'s error handler ends the whole outer subscription permanently, so
            // every later filter/sort/page change would silently do nothing — exactly the "page gets
            // broken, no other API works" symptom one bad filter combo used to cause.
            catchError(() => {
              this.error.set('Proposals could not be loaded.');
              this.loading.set(false);
              return of(null);
            }),
          );
        }),
      )
      .subscribe((result) => {
        if (!result) return;
        this.items.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
        this.loading.set(false);
        this.error.set('');
      });

    this.service.listStatusLabels(this.bucket).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (labels) => this.statusOptions.set(labels),
      error: () => this.statusOptions.set([]),
    });
  }

  readonly pageConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.copy.title,
    paginationLabel: `${this.copy.title} pagination`,
    rowsPerPageLabel: 'Items per page',
    mobileListLabel: `${this.copy.title} cards`,
    header: { title: this.copy.title, description: this.copy.description, countLabel: `${this.total()} proposal${this.total() === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search proposals', placeholder: 'Proposal ID, event title, or applicant' },
    columns: this.bucket === 'history' ? [
      { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
      { key: 'eventTitle', label: 'Event Title', width: '15rem' },
      { key: 'requester', label: 'Requester', width: '13rem' },
      { key: 'schedule', label: 'Event Date', width: '11rem', sortKey: 'schedule' },
      { key: 'time', label: 'Time', width: '9rem' },
      { key: 'location', label: 'Location', width: '12rem' },
      { key: 'pax', label: 'Total Pax', width: '7rem' },
      { key: 'status', label: 'Status', width: '11rem' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ] : [
      { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
      { key: 'eventTitle', label: 'Event Title', width: '15rem' },
      { key: 'applicant', label: 'Applicant', width: '12rem' },
      { key: 'schedule', label: 'Event Date', width: '11rem', sortKey: 'schedule' },
      { key: 'time', label: 'Time', width: '9rem' },
      { key: 'location', label: 'Location', width: '12rem' },
      { key: 'pax', label: 'Total Pax', width: '6rem' },
      { key: 'status', label: 'Status', width: '11rem' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ],
    actions: [
      { key: 'view', label: 'View proposal', icon: 'visibility' },
    ],
    emptyTitle: this.copy.empty,
    emptyDescription: 'Try changing your search or status filter.',
  }));

  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => [
    { key: 'status', ariaLabel: 'Status', value: this.statusFilter(), options: [{ value: 'All', label: 'All statuses' }, ...this.statusOptions().map((value) => ({ value, label: value }))] },
    {
      key: 'requester', ariaLabel: 'Filter by requester', value: this.requesterFilter(),
      options: [
        { value: 'All', label: 'All' },
        { value: 'mine', label: 'My Proposals' },
        { value: 'co-owned', label: 'Co-Owned' },
        ...(this.showActedOnOption() ? [{ value: 'acted-on', label: 'Acted On' }] : []),
      ],
    },
  ]);

  // For the Inbox bucket specifically: an applicant with TWO OR MORE departments simultaneously asking
  // for changes on the same proposal gets one visual row PER department here, not one row for the
  // whole proposal — each department's pushback is answered independently on its own department-
  // resubmit page (see openProposal() below), so each needs its own actionable row, the same way it
  // would if these were genuinely separate proposals.
  readonly sharedRecords = computed<readonly InternalDataRecord[]>(() => this.items().flatMap((item): readonly InternalDataRecord[] => {
    const status = item.statusLabel ?? item.status;
    const splitDepartments = this.bucket === 'inbox' && item.workflow.stage !== ProposalStage.ResubmissionRequired && userIsApplicantForProposal(this.auth.user(), item)
      ? departmentsAwaitingApplicant(item)
      : [];
    if (splitDepartments.length < 2) {
      return [this.toRecord(item, String(item.id), status)];
    }
    return splitDepartments.map((department) => this.toRecord(item, `${item.id}::${department}`, status, department));
  }));

  private toRecord(item: ProposalReviewRecord, id: string, status: string, department?: DepartmentRequestKind): InternalDataRecord {
    const statusLabel = department ? `Changes requested — ${DEPARTMENT_LABELS[department] ?? department}` : status;
    const isMine = userIsApplicantForProposal(this.auth.user(), item);
    const requesterLabel = isMine ? `${item.applicant} (You)` : item.applicant;
    const rows = item.scheduleRows ?? [];
    const urgencyText = this.urgencyText(item);
    return {
      id,
      emphasized:
        status === 'Revision required' ||
        status === 'Changes requested' ||
        item.urgency === 'urgent',
      rowTone: this.rowTone(item),
      cells: {
        proposalId: { primary: item.proposalId },
        eventTitle: { primary: item.eventTitle },
        applicant: { primary: item.applicant },
        requester: { primary: requesterLabel, badge: true, tone: isMine ? 'blue' : 'neutral' },
        // The urgency text rides on the date rather than in a column of its own: it is a
        // statement ABOUT this date, and the row's tint alone would leave a colourblind
        // approver — or a printed copy — with nothing.
        schedule: { primary: joinScheduleRows(rows, (row) => formatScheduleDate(String(row['date'] ?? ''))), secondary: urgencyText },
        time: { primary: joinScheduleRows(rows, (row) => formatScheduleTime(String(row['start'] ?? ''), String(row['end'] ?? ''))) },
        location: { primary: joinScheduleRows(rows, (row) => String(row['location'] ?? '')) },
        pax: { primary: String(item.totalPax) },
        status: { primary: statusLabel, badge: true, tone: this.statusTone(status) },
      },
      mobile: {
        eyebrow: item.proposalId,
        status: statusLabel,
        title: item.eventTitle,
        identity: this.bucket === 'history' ? requesterLabel : item.applicant,
        initials: item.applicantInitials,
        unread: status === 'Revision required' || status === 'Changes requested',
        details: [
          ...(urgencyText ? [{ icon: 'priority_high', text: urgencyText }] : []),
          { icon: 'schedule', text: item.schedule },
          { icon: 'groups', text: `${item.totalPax} expected pax` },
        ],
      },
      actionKeys: ['view'],
    };
  }

  updateSearchDraft(value: string): void { this.search.set(value); }
  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'requester') this.requesterFilter.set(change.value as 'All' | 'mine' | 'co-owned' | 'acted-on');
    this.page.set(1);
  }
  updateSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  handleRowAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'view') this.openProposal(String(event.record.id));
  }
  openRecord(record: InternalDataRecord): void { this.openProposal(String(record.id)); }
  resetFilters(): void { this.search.set(''); this.debouncedSearch.set(''); this.statusFilter.set('All'); this.requesterFilter.set('All'); this.page.set(1); }
  updatePage(nextPage: number): void { this.page.set(nextPage); }
  updatePageSize(nextSize: number): void { this.pageSize.set(nextSize); this.page.set(1); }

  // `compositeId` is either a plain proposal id ("181") or, for a split multi-department inbox
  // row (see sharedRecords above), "181::logistics" — the department half tells us exactly which
  // pushback this specific row represents, so there's no need to re-derive it from the proposal.
  private openProposal(compositeId: string): void {
    const [idPart, splitDepartment] = compositeId.split('::');
    const id = Number(idPart);
    const item = this.items().find((entry) => entry.id === id);
    if (!item) return;
    if (splitDepartment) {
      void this.router.navigate(['/app/proposals/department-resubmit', id, splitDepartment]);
      return;
    }
    if (proposalNeedsApplicantAction(item) && userIsApplicantForProposal(this.auth.user(), item)) {
      // Exactly one department asked for changes: the applicant only needs to fix and resend that ONE
      // department's request, not touch the rest of an already-in-progress proposal — see department-
      // resubmit.ts and proposals.py's resubmit_department_task().
      const awaitingDepartments = departmentsAwaitingApplicant(item);
      if (item.workflow.stage !== ProposalStage.ResubmissionRequired && awaitingDepartments.length === 1) {
        void this.router.navigate(['/app/proposals/department-resubmit', id, awaitingDepartments[0]]);
        return;
      }
      // An applicant whose own proposal was sent back for changes edits it in the same form used
      // to create it, not the reviewer-facing /proposals/review page — mirrors records-page.ts's
      // openDraft() for the 'drafts' bucket.
      void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: id } });
      return;
    }
    // proposal-review-page.ts always fetches the full record by id itself (list rows here are
    // projected without children — requestRows/requests/coOwners/etc. — so they can't substitute
    // for the detail view's data); no router state needs passing.
    void this.router.navigate(['/app/proposals/review', id], {
      queryParams: { returnTo: this.router.url, readOnly: this.bucket !== 'inbox' },
    });
  }

  /**
   * How the whole row is tinted: red for urgent, amber for warning, grey for an event whose
   * date has already passed with nobody deciding. Reads the band the server already computed
   * (and already sorted by — urgent rows come back above warning rows above the rest), so a
   * row can never be one colour here and another in the escalation job.
   */
  private rowTone(item: ProposalReviewRecord): InternalCellTone | undefined {
    if (item.daysUntilEvent == null) return undefined;
    if (item.urgency === 'urgent') return 'danger';
    if (item.urgency === 'warning') return 'warning';
    if (item.urgency === 'overdue') return 'neutral';
    return undefined;
  }

  /**
   * The words the tint is worth. The text is the FACT ("Event in 2 days"), not the band name —
   * "Urgent" tells an approver nothing they can act on, whereas the number does.
   */
  private urgencyText(item: ProposalReviewRecord): string {
    const days = item.daysUntilEvent;
    if (item.urgency == null || item.urgency === 'normal' || days == null) return '';
    if (item.urgency === 'overdue') {
      const late = Math.abs(days);
      return late === 1 ? 'Event was yesterday' : `Event was ${late} days ago`;
    }
    return days === 0 ? 'Event today' : days === 1 ? 'Event tomorrow' : `Event in ${days} days`;
  }


  private statusTone(status: string): InternalCellTone {
    if (status === 'Revision required' || status === 'Changes requested') return 'warning';
    if (status === 'Rejected' || status === 'Cancelled') return 'danger';
    if (status === 'Approved') return 'success';
    return 'blue';
  }
}
