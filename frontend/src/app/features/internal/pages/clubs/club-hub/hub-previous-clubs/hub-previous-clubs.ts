import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import { ClubService } from '../../../../../../core/clubs/club.service';
import { PreviousClubAction, PreviousClubRecord, PreviousClubStatus } from '../../../../../../core/clubs/club.models';
import { FeedbackBannerComponent } from '../../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page';
import {
  InternalCellTone,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalSortChange,
  InternalSortState,
} from '../../../../../../shared/components/internal-data-page/internal-data-page.models';

// How a membership ended, phrased from the reader's own point of view — this is their page, so
// "You left" rather than "Left" and "Removed by the President" rather than a bare status word.
const ACTION_LABELS: Record<PreviousClubAction, string> = {
  left: 'You left',
  removed: 'Removed',
  president_stepped_down: 'Stepped down as President',
};
const ACTION_TONES: Record<PreviousClubAction, InternalCellTone> = {
  left: 'neutral',
  removed: 'danger',
  president_stepped_down: 'blue',
};

/**
 * /app/clubs/my-clubs/previous — clubs the reader used to belong to.
 *
 * Every filter is a server query param (clubs.py's my_previous_clubs()): the search box, the
 * status dropdown and page/pageSize all go to SQL, so the browser only ever holds the one page it
 * is about to draw. Nothing here narrows a list it fetched in full.
 *
 * Rows come from club_membership_log, which only started recording departures at migration 040 —
 * a club left before then left no trace to recover, so this page is complete going forward and
 * silent about anything earlier.
 */
@Component({
  selector: 'app-hub-previous-clubs',
  imports: [InternalDataPageComponent, FeedbackBannerComponent],
  templateUrl: './hub-previous-clubs.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubPreviousClubsComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);

  readonly entries = signal<readonly PreviousClubRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  readonly search = signal('');
  readonly statusFilter = signal<PreviousClubStatus>('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'occurredAt', order: 'desc' });

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Previous clubs',
    paginationLabel: 'Previous club pages',
    rowsPerPageLabel: 'Clubs per page',
    mobileListLabel: 'Previous club cards',
    header: {
      title: 'Previous Clubs',
      description: 'Clubs you were a member of and have since left.',
      countLabel: `${this.total()} club${this.total() === 1 ? '' : 's'}`,
    },
    search: { ariaLabel: 'Search previous clubs', placeholder: 'Search club name' },
    columns: [
      { key: 'club', label: 'Club' },
      { key: 'role', label: 'Membership' },
      { key: 'status', label: 'Status' },
      { key: 'occurred', label: 'Date left', sortKey: 'occurredAt' },
    ],
    actions: [],
    emptyTitle: this.isFiltered() ? 'No clubs found' : 'No previous clubs',
    emptyDescription: this.isFiltered()
      ? 'Try a different search, or clear the status filter.'
      : 'A club you leave will be kept here, along with the role you held in it.',
  }));

  readonly filters = computed(() => [{
    key: 'status',
    ariaLabel: 'Filter by how the membership ended',
    value: this.statusFilter(),
    options: [
      { value: 'all', label: 'All' },
      { value: 'left', label: 'You left' },
      { value: 'removed', label: 'Removed' },
      { value: 'stepped-down', label: 'Stepped down as President' },
    ],
  }]);

  private readonly isFiltered = computed(() => !!this.search().trim() || this.statusFilter() !== 'all');

  readonly records = computed<readonly InternalDataRecord[]>(() => this.entries().map((entry) => ({
    id: entry.clubId,
    cells: {
      club: { primary: entry.clubName, secondary: this.membershipSpan(entry) },
      role: { primary: entry.roleLabel },
      status: {
        primary: ACTION_LABELS[entry.action],
        secondary: entry.action === 'removed' && entry.actorName ? `by ${entry.actorName}` : undefined,
        badge: true,
        tone: ACTION_TONES[entry.action],
      },
      occurred: { primary: this.formatDate(entry.occurredAt) },
    },
    mobile: {
      eyebrow: entry.roleLabel,
      status: ACTION_LABELS[entry.action],
      title: entry.clubName,
      details: [
        { icon: 'event_busy', text: `Left ${this.formatDate(entry.occurredAt)}` },
        ...(entry.joinedAt ? [{ icon: 'event_available', text: `Joined ${this.formatDate(entry.joinedAt)}` }] : []),
      ],
    },
  })));

  /** "Member for 4 months" is the useful reading of two dates, but only when both are known. */
  private membershipSpan(entry: PreviousClubRecord): string {
    if (!entry.joinedAt) return '';
    return `${this.formatDate(entry.joinedAt)} — ${this.formatDate(entry.occurredAt)}`;
  }

  // Refetch on every change to a server-resolved input. Debounced so typing in the search box
  // does not put one request on the wire per keystroke.
  private readonly query$ = toObservable(computed(() => ({
    q: this.search().trim(),
    status: this.statusFilter(),
    page: this.page(),
    pageSize: this.pageSize(),
    order: this.sort().order,
  })));

  constructor() {
    this.query$.pipe(
      debounceTime(200),
      switchMap((query) => {
        this.loading.set(true);
        this.errorMessage.set('');
        return this.clubService.getPreviousClubs({
          q: query.q || undefined,
          status: query.status,
          page: query.page,
          pageSize: query.pageSize,
          order: query.order,
        }).pipe(catchError(() => {
          // Handled here rather than in the subscriber: an error delivered to subscribe()
          // ends the outer stream, and the page would then ignore every later search or
          // page change.
          this.errorMessage.set('Your previous clubs could not be loaded. Please try again.');
          return of(null);
        }));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((result) => {
      if (result) {
        this.entries.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
      }
      this.loading.set(false);
    });
  }

  // A narrower list can be shorter than the page you were on, so every query change restarts at
  // page 1 — the same rule every other server-paginated list here follows.
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value as PreviousClubStatus);
    this.page.set(1);
  }
  setSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  setPage(value: number): void { this.page.set(value); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }
  reset(): void {
    this.search.set('');
    this.statusFilter.set('all');
    this.sort.set({ key: 'occurredAt', order: 'desc' });
    this.page.set(1);
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
