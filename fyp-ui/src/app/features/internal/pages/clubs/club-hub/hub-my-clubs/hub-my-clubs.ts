import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../../core/clubs/club.service';
import { ClubRecord } from '../../../../../../core/clubs/club.models';
import { FeedbackBannerComponent } from '../../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterConfig, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ClubCategoryPickerComponent } from '../../../../../../shared/components/club-category-picker/club-category-picker';
import { ViewToggleComponent } from '../../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-hub-my-clubs',
  imports: [ViewToggleComponent, FeedbackBannerComponent, InternalPageHeaderComponent, InternalDataPageComponent, ClubCategoryPickerComponent, InternalSearchFieldComponent, InternalResetButtonComponent],
  templateUrl: './hub-my-clubs.html',
  styleUrl: './hub-my-clubs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubMyClubsComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly currentUserId = this.auth.user()?.id ?? '';

  readonly clubs = signal<readonly ClubRecord[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly categoryPickerClub = signal<ClubRecord | null>(null);
  readonly viewMode = signal<ViewMode>('card');
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly myClubs = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.clubs()
      .filter((club) => club.viewerIsMember || club.viewerIsPresident)
      .filter((club) => !search || `${club.name} ${club.description}`.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.myClubs().length / this.pageSize())));
  readonly visibleClubs = computed(() => this.myClubs().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'My Clubs',
    description: 'Clubs you belong to as a member or preside over.',
    countLabel: `${this.myClubs().length} club${this.myClubs().length === 1 ? '' : 's'}`,
  }));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'My clubs', paginationLabel: 'Club pages', rowsPerPageLabel: 'Clubs per page', mobileListLabel: 'Club cards',
    header: { title: this.headerConfig().title, description: this.headerConfig().description, countLabel: this.headerConfig().countLabel },
    search: { ariaLabel: 'Search clubs', placeholder: 'Search club name' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'category', label: 'Categories' }, { key: 'role', label: 'Your role' }, { key: 'members', label: 'Members' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'categories', label: 'Edit categories', icon: 'tune' }],
    emptyTitle: 'You haven\'t joined a club yet', emptyDescription: 'Head over to Discover Clubs to find one that fits your interests.', pageSizeOptions: [5, 10, 25],
  }));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleClubs().map((club) => ({
    id: club.id,
    cells: {
      club: { primary: club.name, secondary: club.description || 'No description' },
      category: { primary: club.categories.map((category) => category.name).join(', ') || 'No categories set' },
      role: { primary: club.viewerIsPresident ? 'President' : 'Member', badge: true, tone: club.viewerIsPresident ? 'blue' : 'neutral' },
      members: { primary: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}` },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: club.viewerIsPresident ? 'President' : 'Member', status: '', title: club.name,
      details: [{ icon: 'category', text: club.categories.map((category) => category.name).join(', ') || 'No categories set' }, { icon: 'group', text: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}` }],
    },
    actionKeys: club.viewerIsPresident ? ['categories'] : [],
  })));
  readonly filters: readonly InternalFilterConfig[] = [];

  constructor() {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    this.clubService.getClubs({ viewerUserId: this.currentUserId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (clubs) => { this.clubs.set(clubs); this.loading.set(false); },
        error: () => { this.errorMessage.set('Clubs could not be loaded. Please try again.'); this.loading.set(false); },
      });
  }

  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  reset(): void { this.search.set(''); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const club = this.clubs().find((item) => item.id === event.record.id);
    if (club?.viewerIsPresident) this.openCategoryPicker(club);
  }

  openCategoryPicker(club: ClubRecord): void { this.categoryPickerClub.set(club); }
  closeCategoryPicker(): void { this.categoryPickerClub.set(null); }
  // Merge only `categories` in — the PATCH /clubs/:id/categories response is a plain ClubRecord
  // without the viewer* flags (those are only computed by GET /clubs's viewerUserId projection),
  // so replacing the whole record would wipe viewerIsMember/viewerIsPresident and silently drop
  // the club out of myClubs().
  onCategoriesSaved(updated: ClubRecord): void {
    this.clubs.update((clubs) => clubs.map((item) => item.id === updated.id ? { ...item, categories: updated.categories } : item));
    this.categoryPickerClub.set(null);
  }
}
