import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubJoinRequestRecord } from '../../../../../core/clubs/club.models';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent, InternalFilterControlsComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent, InternalSortChange, InternalSortState } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { ViewToggleComponent, defaultListViewMode } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';
type Requester = 'me' | 'other';

interface RequestHistoryEntry {
  readonly request: ClubJoinRequestRecord;
  // Who asked to join, not who resolved it — 'me' for the viewer's own requests, 'other' for
  // requests to the viewer's club that the viewer decided as President. A President who requested
  // and approved their own club membership collapses to one 'me' row, not two.
  readonly requester: Requester;
}

// History → Clubs: every resolved club join decision — requests the viewer sent that got decided,
// and requests to the viewer's own club that the viewer decided as President. A club with no
// President-role for the viewer only ever contributes 'me' rows.
@Component({
  selector: 'app-hub-history-clubs',
  imports: [ViewToggleComponent, FeedbackBannerComponent, InternalPageHeaderComponent, InternalDataPageComponent, FormModalComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent],
  templateUrl: './hub-history-clubs.html',
  styleUrl: './hub-history-clubs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubHistoryClubsComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly entries = signal<readonly RequestHistoryEntry[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly detailsTarget = signal<RequestHistoryEntry | null>(null);
  readonly viewMode = signal<ViewMode>(defaultListViewMode());
  readonly search = signal('');
  readonly requesterFilter = signal<'all' | Requester>('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  // Newest first, matching what this tab showed before it became sortable.
  readonly sort = signal<InternalSortState>({ key: 'resolved', order: 'desc' });

  readonly resolvedEntries = computed(() => {
    const search = this.search().trim().toLowerCase();
    const requester = this.requesterFilter();
    return this.entries()
      .filter((entry) => requester === 'all' || entry.requester === requester)
      .filter((entry) => !search || entry.request.clubName.toLowerCase().includes(search))
      // This tab MERGES two server-ordered lists (requests I made, and requests I decided as
      // President), so the interleave has to happen somewhere.
      .sort((a, b) => {
        const left = new Date(a.request.resolvedAt ?? a.request.createdAt).getTime();
        const right = new Date(b.request.resolvedAt ?? b.request.createdAt).getTime();
        return this.sort().order === 'asc' ? left - right : right - left;
      });
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resolvedEntries().length / this.pageSize())));
  readonly visibleEntries = computed(() => this.resolvedEntries().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Clubs',
    description: 'Resolved club join requests — the ones you sent, and the ones you decided as President.',
    countLabel: `${this.resolvedEntries().length} request${this.resolvedEntries().length === 1 ? '' : 's'}`,
  }));

  readonly filters = computed<readonly { key: string; ariaLabel: string; value: string; options: readonly { value: string; label: string }[] }[]>(() => [
    {
      key: 'requester', ariaLabel: 'Filter by requester', value: this.requesterFilter(),
      options: [
        { value: 'all', label: 'All' },
        { value: 'me', label: 'Me' },
        { value: 'other', label: 'Other people' },
      ],
    },
  ]);

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Club request history', paginationLabel: 'Request pages', rowsPerPageLabel: 'Requests per page', mobileListLabel: 'Request cards',
    header: { title: this.headerConfig().title, description: this.headerConfig().description, countLabel: this.headerConfig().countLabel },
    search: { ariaLabel: 'Search requests', placeholder: 'Search club name' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'requester', label: 'Requester' }, { key: 'status', label: 'Outcome' }, { key: 'resolved', label: 'Resolved', sortKey: 'resolved' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'view', label: 'View details', icon: 'visibility' }],
    emptyTitle: 'No resolved requests yet', emptyDescription: 'Resolved club join requests — yours or ones you decided as President — will show up here.',
  }));

  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleEntries().map((entry) => ({
    id: `${entry.requester}:${entry.request.id}`,
    cells: {
      club: { primary: entry.request.clubName },
      requester: { primary: this.requesterLabel(entry), badge: true, tone: entry.requester === 'me' ? 'blue' : 'neutral' },
      status: { primary: entry.request.status === 'approved' ? 'Approved' : 'Rejected', badge: true, tone: entry.request.status === 'approved' ? 'success' : 'danger' },
      resolved: { primary: entry.request.resolvedAt ? this.formatDate(entry.request.resolvedAt) : '—' },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: this.requesterLabel(entry),
      status: entry.request.status === 'approved' ? 'Approved' : 'Rejected',
      title: entry.request.clubName,
      details: [{ icon: 'schedule', text: entry.request.resolvedAt ? `Resolved ${this.formatDate(entry.request.resolvedAt)}` : 'Resolved' }],
    },
  })));

  requesterLabel(entry: RequestHistoryEntry): string {
    const name = entry.request.requester?.displayName || entry.request.requester?.email || (entry.requester === 'me' ? 'You' : 'Someone else');
    return entry.requester === 'me' ? `${name} (You)` : name;
  }

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({
      mine: this.clubService.getMyRequests(this.currentUserId, this.sort().order),
      decided: this.clubService.getDecided(this.currentUserId, this.sort().order),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ mine, decided }) => {
        const requested: RequestHistoryEntry[] = mine.filter((r) => r.status !== 'pending').map((request) => ({ request, requester: 'me' as const }));
        const requestedIds = new Set(requested.map((entry) => entry.request.id));
        // A "decided" row where the requester IS the viewer (President approved/rejected their
        // own membership request) is the same real-world request as its "me" counterpart above —
        // skip it here so it doesn't produce a second row for the same person's request.
        const decidedEntries: RequestHistoryEntry[] = decided
          .filter((request) => request.requester?.id !== this.currentUserId || !requestedIds.has(request.id))
          .map((request) => ({ request, requester: (request.requester?.id === this.currentUserId ? 'me' : 'other') as Requester }));
        this.entries.set([...requested, ...decidedEntries]);
        this.loading.set(false);
      },
      error: () => { this.errorMessage.set('Your request history could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }
  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
    this.load();
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'requester') this.requesterFilter.set(change.value as 'all' | Requester); this.page.set(1); }
  reset(): void { this.search.set(''); this.requesterFilter.set('all'); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const entry = this.resolvedEntries().find((item) => `${item.requester}:${item.request.id}` === event.record.id);
    if (entry) this.openDetails(entry);
  }

  openDetails(entry: RequestHistoryEntry): void { this.detailsTarget.set(entry); }
  closeDetails(): void { this.detailsTarget.set(null); }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
