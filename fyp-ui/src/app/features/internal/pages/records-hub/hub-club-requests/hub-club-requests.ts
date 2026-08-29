import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubJoinRequestRecord } from '../../../../../core/clubs/club.models';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent, InternalSortChange, InternalSortState } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { ProposalCommentDialogComponent } from '../../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

export const REJECTION_COMMENT_MIN_LENGTH = 20;

// Inbox tab for club Presidents: requests to join their club, awaiting their decision.
@Component({
  selector: 'app-hub-club-requests',
  imports: [InternalDataPageComponent, FeedbackBannerComponent, ProposalCommentDialogComponent, ConfirmDialogComponent],
  templateUrl: './hub-club-requests.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubClubRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly rejectionCommentMinLength = REJECTION_COMMENT_MIN_LENGTH;

  readonly requests = signal<readonly ClubJoinRequestRecord[]>([]);
  readonly clubOptions = signal<readonly string[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly clubFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  // Oldest first: a join queue is worked front to back, so the request that has
  // waited longest is the one a President should see at the top.
  readonly sort = signal<InternalSortState>({ key: 'requested', order: 'asc' });
  // Bumped after an approve/reject so the query pipeline refetches the current page from the
  // server — with server pagination, splicing the decided request out of the local array would
  // desync `total`/`totalPages` from what the server actually holds.
  private readonly reloadTick = signal(0);

  readonly processingId = signal<string | null>(null);
  readonly approveTarget = signal<ClubJoinRequestRecord | null>(null);
  readonly rejectTarget = signal<ClubJoinRequestRecord | null>(null);
  readonly rejecting = signal(false);

  // Server-side, and back to page 1: the first page of a re-sorted queue is a
  // different set of rows, so holding the old page number would show page 3 of
  // an ordering the reader has not seen the start of.
  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
  }

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending club join requests',
    paginationLabel: 'Request pages',
    rowsPerPageLabel: 'Requests per page',
    mobileListLabel: 'Request cards',
    header: {
      title: 'Clubs',
      description: 'Requests to join your club, awaiting your decision as President.',
      countLabel: `${this.total()} pending`,
    },
    search: { ariaLabel: 'Search club requests', placeholder: 'Name, email, club, or reason' },
    columns: [
      { key: 'requester', label: 'Requester', width: '16rem' },
      { key: 'club', label: 'Club', width: '14rem' },
      { key: 'reason', label: 'Reason', width: '22rem' },
      { key: 'requested', label: 'Requested', width: '12rem', sortKey: 'requested' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ],
    actions: [
      { key: 'approve', label: 'Approve request', icon: 'task_alt' },
      { key: 'reject', label: 'Reject request', icon: 'do_not_disturb_on' },
    ],
    emptyTitle: 'No pending club requests',
    emptyDescription: 'Requests to join your club will appear here for you to approve or reject.',
  }));

  readonly filters = computed(() => [{
    key: 'club', ariaLabel: 'Filter by club', value: this.clubFilter(),
    options: [{ value: 'All', label: 'All clubs' }, ...this.clubOptions().map((value) => ({ value, label: value }))],
  }]);

  readonly records = computed<readonly InternalDataRecord[]>(() => this.requests().map((request) => ({
    id: request.id,
    cells: {
      requester: { primary: request.requester.displayName, secondary: request.requester.email },
      club: { primary: request.clubName },
      reason: { primary: request.reason || '—' },
      requested: { primary: this.formatDate(request.createdAt) },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: request.clubName,
      status: 'Pending',
      title: request.requester.displayName,
      identity: request.requester.email,
      details: [
        { icon: 'chat', text: request.reason || 'No reason given' },
        { icon: 'schedule', text: this.formatDate(request.createdAt) },
      ],
    },
  })));

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    this.clubService.getInboxClubOptions().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((clubs) => this.clubOptions.set(clubs));

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      club: this.clubFilter(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
      reload: this.reloadTick(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.clubService.getInbox({
            q: query.q || undefined,
            club: query.club === 'All' ? undefined : query.club,
            page: query.page,
            pageSize: query.pageSize,
            sort: query.sort.key,
            order: query.sort.order,
          }).pipe(
            // Caught HERE, inside switchMap: an error reaching subscribe()'s error callback ends
            // the outer subscription permanently, so every later filter/search/page change would
            // silently stop doing anything.
            catchError(() => {
              this.errorMessage.set('Join requests could not be loaded. Please try again.');
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
        this.errorMessage.set('');
      });
  }

  setSearch(value: string): void { this.search.set(value); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'club') this.clubFilter.set(change.value); this.page.set(1); }
  reset(): void { this.search.set(''); this.debouncedSearch.set(''); this.clubFilter.set('All'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const request = this.requests().find((item) => item.id === String(event.record.id));
    if (!request) return;
    if (event.action.key === 'approve') this.openApprove(request);
    else if (event.action.key === 'reject') this.openReject(request);
  }

  // Approving adds the requester to the club, so it is confirmed first like every other
  // membership-changing action.
  openApprove(request: ClubJoinRequestRecord): void { this.approveTarget.set(request); }
  closeApprove(): void { if (!this.processingId()) this.approveTarget.set(null); }
  confirmApprove(): void {
    const request = this.approveTarget();
    if (request) this.approve(request);
  }

  approve(request: ClubJoinRequestRecord): void {
    this.processingId.set(request.id);
    this.clubService.approveJoinRequest(request.id, this.currentUserId).pipe(finalize(() => this.processingId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.reloadTick.update((n) => n + 1);
        this.approveTarget.set(null);
        this.toast.success('Request approved', `${request.requester.displayName} was approved to join ${request.clubName}.`);
      },
      error: () => { this.approveTarget.set(null); this.toast.error('Could not approve request', 'Please try again.'); },
    });
  }

  openReject(request: ClubJoinRequestRecord): void { this.rejectTarget.set(request); }
  closeReject(): void { if (!this.rejecting()) this.rejectTarget.set(null); }
  confirmReject(comment: string): void {
    const request = this.rejectTarget();
    if (!request) return;
    this.rejecting.set(true);
    this.clubService.rejectJoinRequest(request.id, this.currentUserId, comment).pipe(finalize(() => this.rejecting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.reloadTick.update((n) => n + 1);
        this.rejectTarget.set(null);
        this.toast.info('Request rejected', `${request.requester.displayName}'s request to join ${request.clubName} was rejected.`);
      },
      error: (err) => this.toast.error('Could not reject request', err?.error?.message ?? 'Please try again.'),
    });
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
