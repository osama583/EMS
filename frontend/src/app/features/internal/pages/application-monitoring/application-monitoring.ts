import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ProposalReviewRecord } from '../../../../core/proposals/proposal-review.models';
import { ProposalSortKey, SortOrder } from '../../../../core/proposals/proposal-workflow.repository';
import { ProposalWorkflowService } from '../../../../core/proposals/proposal-workflow.service';
import { DEPARTMENT_LABELS, DepartmentConfirmation, ProposalStage } from '../../../../core/proposals/proposal-status.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { PopoverComponent } from '../../../../shared/components/popover/popover';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { Tracking, buildTracking } from './application-tracking';
import {
  InternalCellTone,
  InternalCellClickEvent,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
  InternalSortChange,
  InternalSortState,
} from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { formatScheduleDate, formatScheduleTime, joinScheduleRows } from '../records-hub/hub-proposals/hub-proposals';

/** One line of the status popover: a department task, or a single requested item once in
 *  Implementation, and where it has got to. */
export interface SubStatusEntry {
  readonly label: string;
  readonly status: string;
  readonly tone: InternalCellTone;
  readonly assignees: string;
  // Quantity/pax for an implementation item; empty for a department-level entry.
  readonly detail: string;
  // Whether an empty `assignees` is worth saying out loud. A cafeteria order is fulfilled by the
  // outlet and never has staff assigned, so "Nobody assigned yet" would read as a problem there.
  readonly needsAssignee: boolean;
  readonly comment: string;
}

// The two requirements routed to a cafeteria as an ORDER rather than to staff as work.
const ORDER_DEPARTMENTS = new Set(['fmb', 'waterNormal']);

// The human label for a request_task's own status — deliberately distinct from the whole
// proposal's stage label, because the point of this page is that the two disagree: a proposal
// reading 'Department review' can hold an approved Logistics task beside a pending F&B one.
const TASK_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  approved: 'Approved',
  resubmitted: 'Changes requested',
  preparing: 'Preparing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const TASK_STATUS_TONES: Readonly<Record<string, InternalCellTone>> = {
  pending: 'blue',
  approved: 'success',
  resubmitted: 'warning',
  preparing: 'blue',
  completed: 'success',
  cancelled: 'danger',
  // Implementation-only: an item's own step, plus the two "nobody has picked this up" states the
  // server reports for a requested item with no assignment or cafeteria order behind it yet.
  assigned: 'blue',
  fulfilled: 'success',
  ready: 'success',
  unassigned: 'warning',
  unordered: 'warning',
};

const ITEM_STATUS_LABELS: Readonly<Record<string, string>> = {
  ...TASK_STATUS_LABELS,
  assigned: 'In progress',
  fulfilled: 'Fulfilled',
  ready: 'Ready',
  unassigned: 'Not assigned',
  unordered: 'Not ordered',
};

// A status counts as finished for the "3/4" summary. Kept as one list so the badge count and the
// popover's tones can never disagree about what "done" means.
const DONE_STATUSES = new Set(['approved', 'completed', 'fulfilled', 'ready']);

// Once an application has finished, its own outcome IS the status — the department tally stops
// meaning anything and only misleads: a cancelled application's tasks are cancelled too, which read
// as "0/1 done" when in truth nothing is outstanding, and an approved one's "2/2" merely restates
// 'Approved'. The count answers "how far along is this", a question a finished application no
// longer has.
const TERMINAL_STAGES = new Set<string>([
  ProposalStage.Approved,
  ProposalStage.Rejected,
  ProposalStage.Cancelled,
]);

export function isTerminal(proposal: ProposalReviewRecord): boolean {
  const stage = proposal.workflow.stage as string;
  // The escalation job's overdue_* statuses (workflow/constants.py's OVERDUE_STATUSES) are terminal
  // too — the event date passed undecided, so the application is a record, not live work. They have
  // no ProposalStage member and reach the client as their raw value, so they are matched by prefix
  // rather than by enum; without this an overdue row would show a progress count for work that can
  // never advance.
  return TERMINAL_STAGES.has(stage) || stage.startsWith('overdue');
}

export function subStatusesFor(proposal: ProposalReviewRecord): readonly SubStatusEntry[] {
  // In Implementation the departments have all approved, so a per-department list would read
  // "Approved" six times over while the actual work sits in individual items at different steps.
  // Those items are the answer there; department confirmations are the answer everywhere else.
  const items = proposal.implementationItems;
  if (items?.length) {
    return items.map((item) => ({
      label: `${DEPARTMENT_LABELS[item.department] ?? item.department} · ${item.item}`,
      status: ITEM_STATUS_LABELS[item.status] ?? item.status,
      tone: TASK_STATUS_TONES[item.status] ?? 'neutral',
      assignees: item.assignees.join(', '),
      detail: item.detail,
      needsAssignee: !ORDER_DEPARTMENTS.has(item.department),
      comment: '',
    }));
  }
  return (proposal.workflow.departmentConfirmations ?? []).map((entry: DepartmentConfirmation) => {
    const status = entry.status ?? (entry.confirmed ? 'approved' : 'pending');
    return {
      label: DEPARTMENT_LABELS[entry.department] ?? entry.department,
      status: TASK_STATUS_LABELS[status] ?? status,
      tone: TASK_STATUS_TONES[status] ?? 'neutral',
      assignees: (entry.assignees ?? []).join(', '),
      detail: '',
      needsAssignee: !ORDER_DEPARTMENTS.has(entry.department),
      comment: entry.comment ?? '',
    };
  });
}

/** How many of a proposal's sub-entries are finished, for the status badge's "3/4". */
export function doneCountFor(proposal: ProposalReviewRecord): number {
  const items = proposal.implementationItems;
  if (items?.length) return items.filter((item) => DONE_STATUSES.has(item.status)).length;
  return (proposal.workflow.departmentConfirmations ?? [])
    .filter((entry) => DONE_STATUSES.has(entry.status ?? (entry.confirmed ? 'approved' : 'pending')))
    .length;
}

// Application Monitoring: every application in the system, for the admins who track them — the same
// table, filters and server-side paging as Ongoing/History, minus the per-caller scoping (?scope=all,
// gated server-side on this page's own grant). Its one addition is the status cell: where a stage runs
// several departments in PARALLEL, the single stage label hides which of them is actually holding
// things up, so the cell becomes a clickable badge that opens the per-department breakdown.
@Component({
  selector: 'app-application-monitoring',
  imports: [DatePipe, InternalDataPageComponent, PopoverComponent, FormModalComponent],
  templateUrl: './application-monitoring.html',
  styleUrl: './application-monitoring.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationMonitoringComponent {
  private readonly router = inject(Router);
  private readonly service = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'updatedAt', order: 'desc' });

  readonly items = signal<readonly ProposalReviewRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly statusOptions = signal<readonly string[]>([]);

  // Tracking modal: the full audit trail of one application, loaded on demand — the list rows carry
  // only current state, and fetching every application's history up front would be wasteful.
  readonly trackingProposal = signal<ProposalReviewRecord | null>(null);
  readonly tracking = signal<Tracking | null>(null);
  readonly trackingLoading = signal(false);
  readonly trackingError = signal('');

  readonly subStatusRecordId = signal<number | null>(null);
  readonly subStatusEntries = computed<readonly SubStatusEntry[]>(() => {
    const id = this.subStatusRecordId();
    const proposal = id === null ? undefined : this.items().find((item) => item.id === id);
    return proposal && !isTerminal(proposal) ? subStatusesFor(proposal) : [];
  });
  readonly subStatusTitle = computed(() => {
    const id = this.subStatusRecordId();
    const proposal = id === null ? undefined : this.items().find((item) => item.id === id);
    if (!proposal) return '';
    const scope = proposal.implementationItems?.length ? 'item progress' : 'department progress';
    return `${proposal.proposalId} · ${scope}`;
  });

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      statusLabel: this.statusFilter(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.service.listPage({
            scope: 'all',
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort.key as ProposalSortKey,
            order: query.sort.order as SortOrder,
            q: query.q,
            statusLabel: query.statusLabel,
          }).pipe(
            // Caught inside switchMap so one failed query cannot tear down the subscription and
            // leave every later filter/sort/page change doing nothing.
            catchError(() => {
              this.error.set('Applications could not be loaded.');
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

    this.service.listStatusLabels('all').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (labels) => this.statusOptions.set(labels),
      error: () => this.statusOptions.set([]),
    });
  }

  readonly pageConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Application Monitoring',
    paginationLabel: 'Applications pagination',
    rowsPerPageLabel: 'Items per page',
    mobileListLabel: 'Application cards',
    header: {
      title: 'Application Monitoring',
      description: 'Every application in the system. Click a status to see each department’s progress.',
      countLabel: `${this.total()} application${this.total() === 1 ? '' : 's'}`,
    },
    search: { ariaLabel: 'Search applications', placeholder: 'Proposal ID, event title, or applicant' },
    columns: [
      { key: 'proposalId', label: 'Proposal ID', width: '9rem' },
      { key: 'eventTitle', label: 'Event Title', width: '14rem', sortKey: 'eventTitle' },
      { key: 'applicant', label: 'Applicant', width: '11rem', sortKey: 'applicant' },
      { key: 'department', label: 'School / Department', width: '12rem' },
      { key: 'schedule', label: 'Event Date', width: '11rem', sortKey: 'schedule' },
      { key: 'time', label: 'Time', width: '9rem' },
      { key: 'location', label: 'Location', width: '11rem' },
      { key: 'pax', label: 'Total Pax', width: '6rem' },
      { key: 'status', label: 'Status', width: '13rem', sortKey: 'status' },
      { key: 'actions', label: 'Actions', actions: true, width: '7rem' },
    ],
    actions: [
      { key: 'track', label: 'Track progress', icon: 'timeline' },
      { key: 'view', label: 'View application', icon: 'visibility' },
    ],
    emptyTitle: 'No applications found',
    emptyDescription: 'Try changing your search or status filter.',
  }));

  readonly filterConfigs = computed<readonly InternalFilterConfig[]>(() => [
    {
      key: 'status', ariaLabel: 'Status', value: this.statusFilter(),
      options: [{ value: 'All', label: 'All statuses' }, ...this.statusOptions().map((value) => ({ value, label: value }))],
    },
  ]);

  readonly records = computed<readonly InternalDataRecord[]>(() => this.items().map((item) => {
    const status = item.statusLabel ?? item.status;
    // A finished application shows its outcome and nothing else — see isTerminal(). Everywhere else
    // the count is the honest summary of a parallel stage: "3/6 done" says more about where the
    // application actually stands than the stage name, which is identical for all six.
    const subStatuses = isTerminal(item) ? [] : subStatusesFor(item);
    const label = subStatuses.length ? `${status} · ${doneCountFor(item)}/${subStatuses.length}` : status;
    const rows = item.scheduleRows ?? [];
    return {
      id: item.id,
      rowTone: item.urgency === 'urgent' ? 'danger' : item.urgency === 'warning' ? 'warning' : undefined,
      cells: {
        proposalId: { primary: item.proposalId },
        eventTitle: { primary: item.eventTitle },
        applicant: { primary: item.applicant },
        department: { primary: item.applicantDepartment || '—' },
        schedule: { primary: joinScheduleRows(rows, (row) => formatScheduleDate(String(row['date'] ?? ''))) },
        time: { primary: joinScheduleRows(rows, (row) => formatScheduleTime(String(row['start'] ?? ''), String(row['end'] ?? ''))) },
        location: { primary: joinScheduleRows(rows, (row) => String(row['location'] ?? '')) },
        pax: { primary: String(item.totalPax) },
        status: {
          primary: label,
          badge: true,
          tone: this.statusTone(status),
          clickable: subStatuses.length > 0,
          ...(subStatuses.length ? { badgeIcon: 'account_tree' } : {}),
        },
      },
      mobile: {
        eyebrow: item.proposalId,
        status: label,
        title: item.eventTitle,
        identity: item.applicant,
        initials: item.applicantInitials,
        details: [
          { icon: 'school', text: item.applicantDepartment || 'No school recorded' },
          { icon: 'schedule', text: item.schedule },
          { icon: 'groups', text: `${item.totalPax} expected pax` },
        ],
      },
      actionKeys: ['track', 'view'],
    };
  }));

  updateSearchDraft(value: string): void { this.search.set(value); }
  updateFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }
  updateSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  updatePage(nextPage: number): void { this.page.set(nextPage); }
  updatePageSize(nextSize: number): void { this.pageSize.set(nextSize); this.page.set(1); }
  resetFilters(): void { this.search.set(''); this.debouncedSearch.set(''); this.statusFilter.set('All'); this.page.set(1); }

  handleCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'status') return;
    const id = Number(event.record.id);
    this.subStatusRecordId.set(this.subStatusRecordId() === id ? null : id);
  }
  closeSubStatus(): void { this.subStatusRecordId.set(null); }

  handleRowAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'view') this.openProposal(event.record.id);
    if (event.action.key === 'track') this.openTracking(Number(event.record.id));
  }

  openTracking(id: number): void {
    const proposal = this.items().find((item) => item.id === id);
    if (!proposal) return;
    this.trackingProposal.set(proposal);
    this.tracking.set(null);
    this.trackingError.set('');
    this.trackingLoading.set(true);
    // destroyRef passed explicitly: this runs from a click handler, outside an injection context.
    this.service.listHistory(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (history) => {
        this.tracking.set(buildTracking(history, proposal.workflow.stage));
        this.trackingLoading.set(false);
      },
      error: () => {
        this.trackingError.set('This application’s history could not be loaded.');
        this.trackingLoading.set(false);
      },
    });
  }

  closeTracking(): void { this.trackingProposal.set(null); }
  openRecord(record: InternalDataRecord): void { this.openProposal(record.id); }

  // Always read-only: this page is for tracking applications, not acting on them. Whoever also owns
  // the action still has it in their own Inbox.
  private openProposal(id: string | number): void {
    void this.router.navigate(['/app/proposals/review', Number(id)], {
      queryParams: { returnTo: this.router.url, readOnly: true },
    });
  }

  private statusTone(status: string): InternalCellTone {
    if (status === 'Revision required' || status === 'Changes requested') return 'warning';
    if (status === 'Rejected' || status === 'Cancelled') return 'danger';
    if (status === 'Approved') return 'success';
    if (status.startsWith('Overdue')) return 'danger';
    return 'blue';
  }
}
