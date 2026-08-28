import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { hasRole } from '../../../../../core/auth/role-access';
import { ClubService } from '../../../../../core/clubs/club.service';
import { PresidentChangeRequestRecord, PresidentChangeRequestSortKey } from '../../../../../core/clubs/club.models';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalRowActionEvent,
  InternalSortChange,
  InternalSortState,
} from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ProposalCommentDialogComponent } from '../../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';

export const PCR_REJECTION_COMMENT_MIN_LENGTH = 20;

const STATUS_LABELS: Record<PresidentChangeRequestRecord['status'], string> = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
};
const STATUS_TONES: Record<PresidentChangeRequestRecord['status'], InternalCellTone> = {
  pending: 'warning', approved: 'success', rejected: 'danger',
};

// Single tab that serves both sides of the President Change Request workflow, scoped entirely by
// the server per role (clubs.py's president_change_requests_inbox/mine/history):
//   - Club Admin / System Admin, Inbox bucket:   pending requests, decide (approve/reject) — this
//                                                  is genuinely actionable for them, so Inbox is
//                                                  the right place.
//   - Club Admin / System Admin, History bucket: every decided request, read-only.
//   - Club President, Ongoing bucket:             their own PENDING submitted request, read-only —
//                                                  someone else (Club Admin) decides it, so it is
//                                                  never actionable for the President themself and
//                                                  does not belong in their Inbox (see records-hub
//                                                  .ts's showPresidentChangeTab split).
//   - Club President, History bucket:             their own DECIDED requests, read-only.
// Mirrors cafeteria-staff-requests-history.ts's server-driven toObservable/switchMap pagination
// pipeline rather than hub-club-requests.ts's older client-side filtered/paginated pattern, since
// this page must be server-paginated/filtered/sorted per the spec.
@Component({
  selector: 'app-hub-president-change-requests',
  imports: [InternalDataPageComponent, FeedbackBannerComponent, ProposalCommentDialogComponent, ConfirmDialogComponent],
  templateUrl: './hub-president-change-requests.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubPresidentChangeRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  // Which bucket ('inbox' | 'ongoing' | 'history') this instance is mounted under — same
  // route-data convention as staff-tasks.ts's `taskPage`, read from the parent RecordsHubComponent's
  // data. 'ongoing' only ever applies to a non-admin President (see records-hub.ts's
  // showPresidentChangeTab) — Club/System Admin never route here.
  readonly bucket = (this.route.snapshot.data['bucket'] as 'inbox' | 'ongoing' | 'history' | undefined) ?? 'inbox';

  readonly rejectionCommentMinLength = PCR_REJECTION_COMMENT_MIN_LENGTH;

  readonly isClubAdmin = computed(() => {
    const user = this.auth.user();
    return !!user && (hasRole(user, 'system-admin') || hasRole(user, 'club-admin') || !!user.isClubAdmin);
  });
  // A President who is not also a Club Admin only ever sees their own requests, read-only.
  readonly canDecide = computed(() => this.isClubAdmin());

  readonly requests = signal<readonly PresidentChangeRequestRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'createdAt', order: 'desc' });

  readonly approveTarget = signal<PresidentChangeRequestRecord | null>(null);
  readonly rejectTarget = signal<PresidentChangeRequestRecord | null>(null);
  readonly processingId = signal<string | null>(null);
  readonly rejecting = signal(false);

  readonly config = computed<InternalDataPageConfig>(() => {
    const admin = this.isClubAdmin();
    const inbox = this.bucket === 'inbox';
    const ongoing = this.bucket === 'ongoing';
    return {
      ariaLabel: 'President change requests', paginationLabel: 'Request pages', rowsPerPageLabel: 'Requests per page', mobileListLabel: 'Request cards',
      header: {
        title: 'President Change Requests',
        description: admin
          ? (inbox ? 'Requests from club Presidents to hand their role to someone else, awaiting your decision.' : 'Every President change request that has been decided.')
          : (ongoing ? 'Your request to hand the President role to someone else, awaiting a Club Admin’s decision.' : 'President change requests you have submitted, and their outcome.'),
        countLabel: `${this.total()} request${this.total() === 1 ? '' : 's'}`,
      },
      search: { ariaLabel: 'Search requests', placeholder: 'Search club or president name' },
      columns: [
        { key: 'club', label: 'Club', width: '13rem' },
        { key: 'currentPresident', label: 'Current President', width: '15rem' },
        { key: 'requestedPresident', label: 'Requested President', width: '15rem' },
        { key: 'requested', label: 'Requested', width: '11rem', sortKey: 'createdAt' },
        { key: 'status', label: 'Status', width: '9rem' },
        ...(admin && inbox ? [{ key: 'actions', label: 'Actions', actions: true, width: '9rem' }] as const : []),
      ],
      actions: admin && inbox
        ? [{ key: 'approve', label: 'Approve request', icon: 'task_alt' }, { key: 'reject', label: 'Reject request', icon: 'do_not_disturb_on' }]
        : [],
      emptyTitle: inbox ? 'No pending requests' : (ongoing ? 'No pending request' : 'No decided requests yet'),
      emptyDescription: admin
        ? (inbox ? 'Requests to change a club President will appear here for you to decide.' : 'Decided President change requests will appear here.')
        : (ongoing ? 'A request you submit to change your club’s President will appear here while it awaits a decision.' : 'Requests you submit to change your club’s President will appear here.'),
    };
  });

  readonly filters = [];

  readonly records = computed<readonly InternalDataRecord[]>(() => this.requests().map((request) => ({
    id: request.id,
    cells: {
      club: { primary: request.clubName },
      currentPresident: { primary: request.currentPresident.displayName, secondary: request.currentPresident.email },
      requestedPresident: { primary: request.requestedPresident.displayName, secondary: request.requestedPresident.email },
      requested: { primary: this.formatDate(request.createdAt) },
      status: { primary: STATUS_LABELS[request.status], badge: true, tone: STATUS_TONES[request.status] },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: request.clubName,
      status: STATUS_LABELS[request.status],
      title: `${request.currentPresident.displayName} → ${request.requestedPresident.displayName}`,
      details: [
        { icon: 'schedule', text: `Requested ${this.formatDate(request.createdAt)}` },
        ...(request.resolvedAt ? [{ icon: 'event_available', text: `${STATUS_LABELS[request.status]} ${this.formatDate(request.resolvedAt)}` }] : []),
      ],
    },
  })));

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({
      admin: this.isClubAdmin(),
      q: this.debouncedSearch(),
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          const options = {
            q: query.q || undefined,
            sort: query.sort.key as PresidentChangeRequestSortKey,
            order: query.sort.order,
            page: query.page,
            pageSize: query.pageSize,
          };
          const request$ = !query.admin
            ? (this.bucket === 'ongoing'
                ? this.clubService.getMyPendingPresidentChangeRequest(options)
                : this.clubService.getMyDecidedPresidentChangeRequests(options))
            : (this.bucket === 'inbox' ? this.clubService.getPresidentChangeInbox(options) : this.clubService.getPresidentChangeHistory(options));
          // Caught HERE, inside switchMap: an error reaching subscribe()'s error callback ends
          // the outer subscription permanently, so every later filter/sort/page change would
          // silently stop doing anything.
          return request$.pipe(
            catchError(() => {
              this.errorMessage.set('Requests could not be loaded. Please try again.');
              this.loading.set(false);
              return of(null);
            }),
          );
        }),
      )
      .subscribe((result) => {
        if (!result) return;
        this.requests.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
        this.loading.set(false);
      });
  }

  setSearch(value: string): void { this.search.set(value); }
  setSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  reset(): void { this.search.set(''); this.debouncedSearch.set(''); this.sort.set({ key: 'createdAt', order: 'desc' }); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const request = this.requests().find((item) => item.id === String(event.record.id));
    if (!request) return;
    if (event.action.key === 'approve') this.openApprove(request);
    else if (event.action.key === 'reject') this.openReject(request);
  }

  openApprove(request: PresidentChangeRequestRecord): void { this.approveTarget.set(request); }
  closeApprove(): void { if (!this.processingId()) this.approveTarget.set(null); }
  confirmApprove(): void {
    const request = this.approveTarget();
    if (request) this.approve(request);
  }
  private approve(request: PresidentChangeRequestRecord): void {
    this.processingId.set(request.id);
    this.clubService.approvePresidentChange(request.id).pipe(finalize(() => this.processingId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.approveTarget.set(null);
        this.toast.success('Request approved', `${request.requestedPresident.displayName} is now President of ${request.clubName}.`);
      },
      error: (err) => { this.approveTarget.set(null); this.toast.error('Could not approve request', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  openReject(request: PresidentChangeRequestRecord): void { this.rejectTarget.set(request); }
  closeReject(): void { if (!this.rejecting()) this.rejectTarget.set(null); }
  confirmReject(comment: string): void {
    const request = this.rejectTarget();
    if (!request) return;
    this.rejecting.set(true);
    this.clubService.rejectPresidentChange(request.id, comment).pipe(finalize(() => this.rejecting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.rejectTarget.set(null);
        this.toast.info('Request rejected', `The request to change ${request.clubName}'s President was rejected.`);
      },
      error: (err) => this.toast.error('Could not reject request', apiErrorMessage(err, 'Please try again.')),
    });
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
