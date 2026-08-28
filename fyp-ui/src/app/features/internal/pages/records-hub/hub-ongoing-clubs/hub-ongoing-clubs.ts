import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubJoinRequestRecord } from '../../../../../core/clubs/club.models';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterConfig, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { ViewToggleComponent, defaultListViewMode } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

// Ongoing → Clubs: club join requests the viewer sent that are still awaiting the President's
// decision. Single direction only — requests waiting on the VIEWER's own decision (as President)
// belong in Inbox instead (hub-club-requests), since those need action now rather than tracking.
@Component({
  selector: 'app-hub-ongoing-clubs',
  imports: [ViewToggleComponent, FeedbackBannerComponent, InternalPageHeaderComponent, InternalDataPageComponent, FormModalComponent, InternalSearchFieldComponent, InternalResetButtonComponent],
  templateUrl: './hub-ongoing-clubs.html',
  styleUrl: './hub-ongoing-clubs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubOngoingClubsComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly requests = signal<readonly ClubJoinRequestRecord[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly detailsTarget = signal<ClubJoinRequestRecord | null>(null);
  readonly viewMode = signal<ViewMode>(defaultListViewMode());
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly pendingRequests = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.requests()
      .filter((request) => request.status === 'pending')
      .filter((request) => !search || request.clubName.toLowerCase().includes(search))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.pendingRequests().length / this.pageSize())));
  readonly visibleRequests = computed(() => this.pendingRequests().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Clubs',
    description: 'Clubs you have asked to join, awaiting the President’s review.',
    countLabel: `${this.pendingRequests().length} request${this.pendingRequests().length === 1 ? '' : 's'}`,
  }));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending club requests', paginationLabel: 'Request pages', rowsPerPageLabel: 'Requests per page', mobileListLabel: 'Request cards',
    header: { title: this.headerConfig().title, description: this.headerConfig().description, countLabel: this.headerConfig().countLabel },
    search: { ariaLabel: 'Search requests', placeholder: 'Search club name' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'status', label: 'Status' }, { key: 'requested', label: 'Requested' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'view', label: 'View details', icon: 'visibility' }],
    emptyTitle: 'No pending requests', emptyDescription: 'You have no clubs awaiting a decision right now.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters: readonly InternalFilterConfig[] = [];

  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleRequests().map((request) => ({
    id: request.id,
    cells: {
      club: { primary: request.clubName },
      status: { primary: 'Pending', badge: true, tone: 'warning' },
      requested: { primary: this.formatDate(request.createdAt) },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: 'Pending', status: 'Pending', title: request.clubName,
      details: [{ icon: 'schedule', text: `Requested ${this.formatDate(request.createdAt)}` }],
    },
  })));

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.clubService.getMyRequests(this.currentUserId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (requests) => { this.requests.set(requests); this.loading.set(false); },
      error: () => { this.errorMessage.set('Your pending requests could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  reset(): void { this.search.set(''); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const request = this.requests().find((item) => item.id === event.record.id);
    if (request) this.openDetails(request);
  }

  openDetails(request: ClubJoinRequestRecord): void { this.detailsTarget.set(request); }
  closeDetails(): void { this.detailsTarget.set(null); }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
