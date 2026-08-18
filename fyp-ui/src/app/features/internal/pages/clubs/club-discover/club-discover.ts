import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubCategoryRecord, ClubRecord } from '../../../../../core/clubs/club.models';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalFilterControlsComponent, InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { ProposalCommentDialogComponent } from '../../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-club-discover',
  imports: [
    InternalDataPageComponent, FeedbackBannerComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent,
    ProposalCommentDialogComponent,
  ],
  templateUrl: './club-discover.html',
  styleUrl: './club-discover.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubDiscoverComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly clubs = signal<readonly ClubRecord[]>([]);
  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly categoryFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly viewMode = signal<ViewMode>('card');
  readonly requestingId = signal<string | null>(null);
  readonly requestTarget = signal<ClubRecord | null>(null);

  readonly discoverClubs = computed(() => this.clubs().filter((club) => !club.viewerIsMember && !club.viewerIsPresident && !club.viewerHasPendingRequest));
  readonly filteredClubs = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.discoverClubs().filter((club) =>
      (this.categoryFilter() === 'all' || club.categories.some((category) => category.id === this.categoryFilter()))
      && (!search || `${club.name} ${club.description}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredClubs().length / this.pageSize())));
  readonly visibleClubs = computed(() => this.filteredClubs().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Discover clubs', paginationLabel: 'Club pages', rowsPerPageLabel: 'Clubs per page', mobileListLabel: 'Club cards',
    header: { title: 'Discover Clubs', description: 'Browse active clubs and send a request to join.', countLabel: `${this.filteredClubs().length} club${this.filteredClubs().length === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search clubs', placeholder: 'Search club name or description' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'category', label: 'Category' }, { key: 'president', label: 'President' }, { key: 'members', label: 'Members' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'join', label: 'Request to join', icon: 'person_add' }],
    emptyTitle: 'No clubs found', emptyDescription: 'Try a different search or category filter.', pageSizeOptions: [5, 10, 25],
  }));
  readonly cardHeaderConfig = computed<InternalPageHeaderConfig>(() => ({ title: this.config().header.title, description: this.config().header.description, countLabel: this.config().header.countLabel }));
  readonly filters = computed(() => [
    { key: 'category', ariaLabel: 'Filter clubs by category', value: this.categoryFilter(), options: [{ value: 'all', label: 'All categories' }, ...this.categories().map((category) => ({ value: category.id, label: category.name }))] },
  ]);
  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleClubs().map((club) => ({
    id: club.id,
    cells: {
      club: { primary: club.name, secondary: club.description || 'No description' },
      category: { primary: club.categories.map((category) => category.name).join(', ') || 'Uncategorized' },
      president: { primary: club.president?.displayName ?? 'Unassigned' },
      members: { primary: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}` },
      actions: { primary: this.requestingId() === club.id ? 'Sending…' : '' },
    },
    mobile: {
      eyebrow: club.categories[0]?.name ?? 'Uncategorized', status: '', title: club.name,
      details: [{ icon: 'how_to_reg', text: club.president?.displayName ?? 'Unassigned' }, { icon: 'group', text: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}` }],
    },
  })));
  constructor() {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    forkJoin({ clubs: this.clubService.getClubs({ activeOnly: true, viewerUserId: this.currentUserId }), categories: this.clubService.getCategories({ activeOnly: true }) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ clubs, categories }) => { this.clubs.set(clubs); this.categories.set(categories); this.loading.set(false); },
        error: () => { this.errorMessage.set('Clubs could not be loaded. Please try again.'); this.loading.set(false); },
      });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'category') this.categoryFilter.set(change.value); this.page.set(1); }
  reset(): void { this.search.set(''); this.categoryFilter.set('all'); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }
  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }

  handleAction(event: InternalRowActionEvent): void {
    const club = this.clubs().find((item) => item.id === event.record.id);
    if (club) this.openRequestDialog(club);
  }

  openRequestDialog(club: ClubRecord): void { this.requestTarget.set(club); }
  closeRequestDialog(): void { if (!this.requestingId()) this.requestTarget.set(null); }

  requestToJoin(reason: string): void {
    const club = this.requestTarget();
    if (!club) return;
    this.requestingId.set(club.id);
    this.clubService.sendJoinRequest(club.id, this.currentUserId, reason).pipe(finalize(() => this.requestingId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.clubs.update((clubs) => clubs.map((item) => item.id === club.id ? { ...item, viewerHasPendingRequest: true } : item));
        this.requestTarget.set(null);
        this.toast.success('Request sent', `Your request to join ${club.name} was sent to the President.`);
      },
      error: (err) => this.toast.error('Request could not be sent', err?.error?.message ?? 'Please try again.'),
    });
  }
}
