import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../../core/clubs/club.service';
import { ClubCategoryRecord, ClubRecord } from '../../../../../../core/clubs/club.models';
import { InternalDataPageComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalFilterControlsComponent, InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig } from '../../../../../../shared/components/internal-data-page/internal-data-page.models';
import { FeedbackBannerComponent } from '../../../../../../shared/components/feedback-banner/feedback-banner';
import { ViewToggleComponent } from '../../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-hub-pending',
  imports: [ViewToggleComponent, 
    InternalDataPageComponent, FeedbackBannerComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent,
  ],
  templateUrl: './hub-pending.html',
  styleUrl: './hub-pending.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubPendingComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
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

  readonly pendingClubs = computed(() => this.clubs().filter((club) => club.viewerHasPendingRequest));
  readonly filteredClubs = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.pendingClubs().filter((club) =>
      (this.categoryFilter() === 'all' || club.categories.some((category) => category.id === this.categoryFilter()))
      && (!search || `${club.name} ${club.description}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredClubs().length / this.pageSize())));
  readonly visibleClubs = computed(() => this.filteredClubs().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending club requests', paginationLabel: 'Club pages', rowsPerPageLabel: 'Clubs per page', mobileListLabel: 'Club cards',
    header: { title: 'Pending Requests', description: 'Clubs you have requested to join, awaiting the President’s review.', countLabel: `${this.filteredClubs().length} club${this.filteredClubs().length === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search clubs', placeholder: 'Search club name or description' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'category', label: 'Category' }, { key: 'president', label: 'President' }, { key: 'status', label: 'Status' }],
    actions: [],
    emptyTitle: 'No pending requests', emptyDescription: 'You have no clubs awaiting a decision right now.', pageSizeOptions: [5, 10, 25],
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
      status: { primary: 'Pending', badge: true, tone: 'warning' },
    },
    mobile: {
      eyebrow: club.categories[0]?.name ?? 'Uncategorized', status: 'Pending', title: club.name,
      details: [{ icon: 'how_to_reg', text: club.president?.displayName ?? 'Unassigned' }, { icon: 'schedule', text: 'Awaiting review' }],
    },
  })));

  constructor() {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    forkJoin({ clubs: this.clubService.getClubs({ viewerUserId: this.currentUserId }), categories: this.clubService.getCategories({ activeOnly: true }) })
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
}
