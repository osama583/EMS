import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../../core/clubs/club.service';
import { ClubRecord } from '../../../../../../core/clubs/club.models';
import { FeedbackBannerComponent } from '../../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterConfig, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ClubCategoryPickerComponent } from '../../../../../../shared/components/club-category-picker/club-category-picker';
import { ClubRosterModalComponent } from '../../../../../../shared/components/club-roster-modal/club-roster-modal';
import { PresidentChangeRequestModalComponent } from '../../../../../../shared/components/president-change-request-modal/president-change-request-modal';
import { ViewToggleComponent, defaultListViewMode } from '../../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-hub-my-clubs',
  imports: [ViewToggleComponent, FeedbackBannerComponent, InternalPageHeaderComponent, InternalDataPageComponent, ClubCategoryPickerComponent, ClubRosterModalComponent, PresidentChangeRequestModalComponent, InternalSearchFieldComponent, InternalResetButtonComponent],
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
  readonly rosterClub = signal<ClubRecord | null>(null);
  readonly presidentChangeClub = signal<ClubRecord | null>(null);
  // Which card's "⋯" action menu is open, by club id — a plain string rather than a per-card
  // component-local flag, since only one menu should ever be open across the whole grid at once.
  readonly menuOpenFor = signal<string | null>(null);
  readonly viewMode = signal<ViewMode>(defaultListViewMode());
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
    actions: [
      { key: 'roster', label: 'View members', icon: 'group' },
      { key: 'categories', label: 'Edit categories', icon: 'tune' },
      { key: 'president-change', label: 'Request President change', icon: 'swap_horiz' },
    ],
    emptyTitle: 'You haven\'t joined a club yet', emptyDescription: 'Head over to Discover Clubs to find one that fits your interests.',
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
    actionKeys: club.viewerIsPresident ? ['roster', 'categories', 'president-change'] : ['roster'],
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
    if (!club) return;
    if (event.action.key === 'roster') this.openRoster(club);
    else if (event.action.key === 'categories' && club.viewerIsPresident) this.openCategoryPicker(club);
    else if (event.action.key === 'president-change' && club.viewerIsPresident) this.openPresidentChange(club);
  }

  openRoster(club: ClubRecord): void { this.rosterClub.set(club); }
  closeRoster(): void { this.rosterClub.set(null); }
  // The roster modal already updated the membership row itself — just reload this list so
  // memberCount reflects it, and (if the viewer just left) the club drops out of myClubs().
  onMembershipChanged(): void { this.loadAll(); }

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

  openPresidentChange(club: ClubRecord): void { this.presidentChangeClub.set(club); }
  closePresidentChange(): void { this.presidentChangeClub.set(null); }
  onPresidentChangeSubmitted(): void { this.presidentChangeClub.set(null); }

  toggleMenu(clubId: string, event: Event): void {
    event.stopPropagation();
    this.menuOpenFor.set(this.menuOpenFor() === clubId ? null : clubId);
  }
  closeMenu(): void { this.menuOpenFor.set(null); }

  // A click anywhere outside an open menu closes it — the panel itself stops propagation (see the
  // template), so this only ever fires for a genuine outside click.
  @HostListener('document:click')
  onDocumentClick(): void { this.closeMenu(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeMenu(); }
}
