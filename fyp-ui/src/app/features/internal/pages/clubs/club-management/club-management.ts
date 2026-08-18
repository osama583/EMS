import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubCategoryRecord, ClubDraft, ClubRecord, ClubUserSummary } from '../../../../../core/clubs/club.models';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalFilterControlsComponent, InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { SearchableDropdownComponent } from '../../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { StatusToggleComponent } from '../../../../../shared/components/status-toggle/status-toggle';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { OptionCardGridComponent } from '../../../../../shared/components/option-card-grid/option-card-grid';
import { OptionCardViewModel } from '../../../../../shared/components/option-card-grid/option-card-grid.models';
import { ImageUploadFieldComponent } from '../../../../../shared/components/image-upload-field/image-upload-field';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ClubCategoryManagerComponent } from '../../../../../shared/components/club-category-manager/club-category-manager';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-club-management',
  imports: [
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent,
    FeedbackBannerComponent, OptionCardGridComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent, ImageUploadFieldComponent,
    ClubCategoryManagerComponent,
  ],
  templateUrl: './club-management.html',
  styleUrl: './club-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubManagementComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  protected readonly currentUserId = this.auth.user()?.id ?? '';

  readonly clubs = signal<readonly ClubRecord[]>([]);
  readonly eligiblePresidents = signal<readonly ClubUserSummary[]>([]);
  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly categoryFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly viewMode = signal<ViewMode>('card');
  readonly modalOpen = signal(false);
  readonly categoryManagerOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<{ name: string; description: string; imageUrl: string; imageFileName: string; presidentUserId: string; categoryIds: readonly string[]; active: boolean }>(this.emptyDraft());
  readonly imageError = signal('');
  readonly errorMessage = signal('');
  readonly deleteTarget = signal<ClubRecord | null>(null);
  readonly deactivating = signal(false);

  // `user.role` here is server-side isEligibleForClub()'s already-filtered eligible-presidents
  // list, so it's always exactly 'student' or 'staff' (the Unit + Level model's generic level
  // markers) — 'staff' among an eligibility-filtered list always means a School Lecturer, since
  // Service department staff never pass isEligibleForClub().
  readonly presidentOptions = computed<readonly SelectOption[]>(() =>
    this.eligiblePresidents().map((user) => ({ value: user.id, label: user.displayName, description: `${user.role === 'student' ? 'Student' : 'Lecturer'} · ${user.email}` })),
  );
  readonly categoryOptions = computed<readonly SelectOption[]>(() =>
    this.categories().filter((category) => category.active).map((category) => ({ value: category.id, label: category.name })),
  );
  readonly filteredClubs = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.clubs().filter((club) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === club.active)
      && (this.categoryFilter() === 'all' || club.categories.some((category) => category.id === this.categoryFilter()))
      && (!search || `${club.name} ${club.description} ${club.president?.displayName ?? ''}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredClubs().length / this.pageSize())));
  readonly visibleClubs = computed(() => this.filteredClubs().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  readonly formValid = computed(() =>
    Boolean(this.draft().name.trim()) && Boolean(this.draft().presidentUserId)
    && this.draft().categoryIds.length >= 1 && this.draft().categoryIds.length <= 3,
  );

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Clubs', paginationLabel: 'Club pages', rowsPerPageLabel: 'Clubs per page', mobileListLabel: 'Club cards',
    header: { title: 'Clubs', description: 'Create clubs and assign a President from eligible students and lecturers.', countLabel: `${this.filteredClubs().length} club${this.filteredClubs().length === 1 ? '' : 's'}`, primaryActionLabel: 'Add club' },
    search: { ariaLabel: 'Search clubs', placeholder: 'Search club name, description, or president' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'category', label: 'Category' }, { key: 'president', label: 'President' }, { key: 'members', label: 'Members' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'edit', label: 'Edit club', icon: 'edit' }, { key: 'status', label: 'Change active status', icon: 'power_settings_new' }],
    emptyTitle: 'No clubs found', emptyDescription: 'Add a club or change the current search and filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly cardHeaderConfig = computed<InternalPageHeaderConfig>(() => ({ title: this.config().header.title, description: this.config().header.description, countLabel: this.config().header.countLabel }));
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter clubs by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { key: 'category', ariaLabel: 'Filter clubs by category', value: this.categoryFilter(), options: [{ value: 'all', label: 'All categories' }, ...this.categories().map((category) => ({ value: category.id, label: category.name }))] },
  ]);
  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleClubs().map((club) => ({
    id: club.id,
    cells: {
      club: { primary: club.name, secondary: club.description || 'No description' },
      category: { primary: club.categories.map((category) => category.name).join(', ') || 'Uncategorized' },
      president: { primary: club.president?.displayName ?? 'Unassigned' },
      members: { primary: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}${club.pendingRequestCount ? ` · ${club.pendingRequestCount} pending` : ''}` },
      status: { primary: club.active ? 'Active' : 'Inactive', badge: true, tone: club.active ? 'success' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: club.president?.displayName ?? 'Unassigned', status: club.active ? 'Active' : 'Inactive', title: club.name,
      details: [{ icon: 'category', text: club.categories.map((category) => category.name).join(', ') || 'Uncategorized' }, { icon: 'group', text: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}` }, { icon: 'info', text: club.description || 'No description' }],
    },
  })));
  readonly cardData = computed<readonly OptionCardViewModel[]>(() => this.visibleClubs().map((club) => ({
    id: club.id,
    label: club.name,
    description: club.description || 'No description provided.',
    active: club.active,
    imageDataUrl: club.imageUrl ?? '',
    imageFileName: club.name,
    metaFields: [
      { label: 'Category', value: club.categories.map((category) => category.name).join(', ') || 'Uncategorized', icon: 'category' },
      { label: 'President', value: club.president?.displayName ?? 'Unassigned', icon: 'how_to_reg' },
      { label: 'Members', value: `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}`, icon: 'group' },
      ...(club.pendingRequestCount ? [{ label: 'Pending', value: `${club.pendingRequestCount} join request${club.pendingRequestCount === 1 ? '' : 's'}`, icon: 'pending_actions', isBadge: true, badgeTone: 'amber' as const }] : []),
    ],
  })));

  constructor() {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    forkJoin({ clubs: this.clubService.getClubs(), presidents: this.clubService.getEligiblePresidents(), categories: this.clubService.getCategories() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ clubs, presidents, categories }) => { this.clubs.set(clubs); this.eligiblePresidents.set(presidents); this.categories.set(categories); this.loading.set(false); },
        error: () => { this.errorMessage.set('Clubs could not be loaded. Please try again.'); this.loading.set(false); },
      });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'category') this.categoryFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.categoryFilter.set('all'); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }
  setViewMode(mode: ViewMode): void { this.viewMode.set(mode); }

  openAdd(): void { this.editingId.set(null); this.draft.set(this.emptyDraft()); this.imageError.set(''); this.modalOpen.set(true); this.errorMessage.set(''); }
  editClub(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (!club) return;
    this.editingId.set(club.id);
    this.draft.set({ name: club.name, description: club.description, imageUrl: club.imageUrl ?? '', imageFileName: '', presidentUserId: club.president?.id ?? '', categoryIds: club.categories.map((category) => category.id), active: club.active });
    this.imageError.set('');
    this.modalOpen.set(true);
    this.errorMessage.set('');
  }
  openCategoryManager(): void { this.categoryManagerOpen.set(true); }
  closeCategoryManager(): void { this.categoryManagerOpen.set(false); this.refreshCategories(); }
  private refreshCategories(): void {
    this.clubService.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((categories) => {
      this.categories.set(categories);
      // Re-fetch clubs too so category renames/removals show up immediately in the table/cards.
      this.clubService.getClubs().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((clubs) => this.clubs.set(clubs));
    });
  }
  handleAction(event: InternalRowActionEvent): void {
    const club = this.clubs().find((item) => item.id === event.record.id);
    if (!club) return;
    if (event.action.key === 'edit') { this.editClub(club.id); return; }
    this.changeStatus(club);
  }
  toggleActiveById(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (club) this.changeStatus(club);
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft<K extends keyof ReturnType<typeof this.emptyDraft>>(key: K, value: string | boolean): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }
  setDraftCategoryIds(value: readonly string[]): void {
    this.draft.update((draft) => ({ ...draft, categoryIds: value }));
  }
  selectImageFile(file: File): void {
    if (!file.type.startsWith('image/')) { this.imageError.set('Select a valid image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { this.imageError.set('Club image must be 5 MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = () => { this.draft.update((draft) => ({ ...draft, imageUrl: String(reader.result ?? ''), imageFileName: file.name })); this.imageError.set(''); };
    reader.onerror = () => this.imageError.set('The image could not be read. Please choose another file.');
    reader.readAsDataURL(file);
  }
  removeImage(): void { this.draft.update((draft) => ({ ...draft, imageUrl: '', imageFileName: '' })); }

  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.errorMessage.set('');
    const id = this.editingId();
    const draft = this.draft();
    const payload: ClubDraft = { name: draft.name.trim(), description: draft.description.trim(), imageUrl: draft.imageUrl || null, presidentUserId: draft.presidentUserId || null, categoryIds: draft.categoryIds, active: draft.active };
    const request = id ? this.clubService.updateClub(id, payload) : this.clubService.createClub(payload, this.currentUserId);
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (club) => {
        this.clubs.update((clubs) => id ? clubs.map((item) => item.id === club.id ? club : item) : [...clubs, club]);
        this.modalOpen.set(false);
        this.toast.success(id ? 'Club updated' : 'Club created', `${club.name} was ${id ? 'updated' : 'created'} successfully.`);
      },
      error: () => this.errorMessage.set('The club could not be saved. Please try again.'),
    });
  }

  private changeStatus(club: ClubRecord): void {
    this.clubService.setClubActive(club.id, !club.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.clubs.update((clubs) => clubs.map((item) => item.id === updated.id ? updated : item));
        this.toast.success(club.active ? 'Club deactivated' : 'Club activated', `${club.name} is now ${club.active ? 'inactive' : 'active'}.`);
      },
      error: () => this.toast.error('Could not change status', 'Please try again.'),
    });
  }
  private emptyDraft() { return { name: '', description: '', imageUrl: '', imageFileName: '', presidentUserId: '', categoryIds: [] as readonly string[], active: true }; }
}
