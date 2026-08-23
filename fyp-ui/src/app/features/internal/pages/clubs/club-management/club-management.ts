import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, finalize, switchMap } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { EVENT_IMAGE_UPLOAD_API } from '../../../../../core/events/event-image-upload.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubCategoryRecord, ClubDraft, ClubMemberRecord, ClubRecord, ClubUserSummary } from '../../../../../core/clubs/club.models';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalFilterControlsComponent, InternalPageHeaderComponent, InternalPaginationComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent, InternalSortChange, InternalSortState } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { SearchableDropdownComponent } from '../../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { StatusToggleComponent } from '../../../../../shared/components/status-toggle/status-toggle';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { OptionCardGridComponent } from '../../../../../shared/components/option-card-grid/option-card-grid';
import { OptionCardViewModel } from '../../../../../shared/components/option-card-grid/option-card-grid.models';
import { ImageUploadFieldComponent } from '../../../../../shared/components/image-upload-field/image-upload-field';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ViewToggleComponent } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-club-management',
  imports: [ViewToggleComponent,
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent,
    FeedbackBannerComponent, OptionCardGridComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent, InternalPaginationComponent, ImageUploadFieldComponent,
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
  private readonly imageUpload = inject(EVENT_IMAGE_UPLOAD_API);
  protected readonly currentUserId = this.auth.user()?.id ?? '';

  readonly clubs = signal<readonly ClubRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly eligiblePresidents = signal<readonly ClubUserSummary[]>([]);
  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('all');
  readonly categoryFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly sort = signal<InternalSortState>({ key: 'name', order: 'asc' });
  readonly viewMode = signal<ViewMode>('card');
  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<{ name: string; description: string; imageUrl: string; imageFileName: string; presidentUserId: string; categoryIds: readonly string[]; active: boolean }>(this.emptyDraft());
  readonly imageError = signal('');
  readonly imageUploading = signal(false);
  readonly errorMessage = signal('');
  readonly deleteTarget = signal<ClubRecord | null>(null);
  readonly deactivating = signal(false);
  readonly detailsTarget = signal<ClubRecord | null>(null);
  readonly detailsMembers = signal<readonly ClubMemberRecord[]>([]);
  readonly detailsMembersLoading = signal(false);

  private readonly reloadTick = signal(0);

  // Server-side /clubs/eligible-presidents only returns students - a club president must be one.
  readonly presidentOptions = computed<readonly SelectOption[]>(() =>
    this.eligiblePresidents().map((user) => ({ value: user.id, label: user.displayName, description: `Student · ${user.email}` })),
  );
  readonly categoryOptions = computed<readonly SelectOption[]>(() =>
    this.categories().filter((category) => category.active).map((category) => ({ value: category.id, label: category.name })),
  );
  readonly formValid = computed(() =>
    Boolean(this.draft().name.trim()) && Boolean(this.draft().presidentUserId)
    && this.draft().categoryIds.length >= 1 && this.draft().categoryIds.length <= 3,
  );

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Clubs', paginationLabel: 'Club pages', rowsPerPageLabel: 'Clubs per page', mobileListLabel: 'Club cards',
    header: { title: 'Clubs', description: 'Create clubs and assign a President from eligible students.', countLabel: `${this.total()} club${this.total() === 1 ? '' : 's'}`, primaryActionLabel: 'Add club' },
    search: { ariaLabel: 'Search clubs', placeholder: 'Search club name, description, or president' },
    columns: [
      { key: 'club', label: 'Club', sortKey: 'name' },
      { key: 'category', label: 'Category' },
      { key: 'president', label: 'President', sortKey: 'president' },
      { key: 'members', label: 'Members', sortKey: 'members' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [{ key: 'edit', label: 'Edit club', icon: 'edit' }, { key: 'status', label: 'Change active status', icon: 'power_settings_new' }],
    emptyTitle: 'No clubs found', emptyDescription: 'Add a club or change the current search and filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly cardHeaderConfig = computed<InternalPageHeaderConfig>(() => ({ title: this.config().header.title, description: this.config().header.description, countLabel: this.config().header.countLabel }));
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter clubs by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { key: 'category', ariaLabel: 'Filter clubs by category', value: this.categoryFilter(), options: [{ value: 'all', label: 'All categories' }, ...this.categories().map((category) => ({ value: category.id, label: category.name }))] },
  ]);
  readonly records = computed<readonly InternalDataRecord[]>(() => this.clubs().map((club) => ({
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
  readonly cardData = computed<readonly OptionCardViewModel[]>(() => this.clubs().map((club) => ({
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
    // Presidents/categories back the Add/Edit form and filter dropdown — loaded once, not on
    // every search/filter/sort/page change the way the club list itself is below.
    this.clubService.getEligiblePresidents().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((presidents) => this.eligiblePresidents.set(presidents));
    this.clubService.getCategories().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categories.set(categories));

    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    // Every search/filter/sort/page control below is a real server query param (GET
    // /clubs/search) — the browser never loads the full club table to filter/sort/paginate it
    // locally, same treatment as cafeteria-staff-requests-history.ts's staffAuditLog().
    // reload$ folds into the same query signal (via reloadTick) so a save/status-change mutation
    // re-runs the current search/filter/sort/page exactly as-is, same as the categories page.
    const query$ = toObservable(computed(() => ({
      q: this.debouncedSearch(),
      status: this.statusFilter(),
      category: this.categoryFilter(),
      sort: this.sort(),
      page: this.page(),
      pageSize: this.pageSize(),
      tick: this.reloadTick(),
    })));

    query$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.clubService.searchClubs({
            search: query.q || undefined,
            status: query.status as 'all' | 'active' | 'inactive',
            categoryId: query.category === 'all' ? undefined : query.category,
            sort: query.sort.key as 'name' | 'president' | 'members' | 'createdAt',
            order: query.sort.order,
            page: query.page,
            pageSize: query.pageSize,
          }).pipe(finalize(() => this.loading.set(false)));
        }),
      )
      .subscribe({
        next: (result) => {
          this.clubs.set(result.items);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
        },
        error: () => this.errorMessage.set('Clubs could not be loaded. Please try again.'),
      });
  }

  private triggerReload(): void { this.reloadTick.update((tick) => tick + 1); }

  setSearch(value: string): void { this.search.set(value); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'category') this.categoryFilter.set(change.value);
    this.page.set(1);
  }
  setSort(change: InternalSortChange): void { this.sort.set({ key: change.key, order: change.order }); this.page.set(1); }
  reset(): void {
    this.search.set(''); this.debouncedSearch.set('');
    this.statusFilter.set('all'); this.categoryFilter.set('all');
    this.sort.set({ key: 'name', order: 'asc' });
    this.page.set(1);
  }
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
  viewClubDetails(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (!club) return;
    this.detailsTarget.set(club);
    this.detailsMembers.set([]);
    this.detailsMembersLoading.set(true);
    this.clubService.getClubMembers(club.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (members) => { this.detailsMembers.set(members); this.detailsMembersLoading.set(false); },
      error: () => this.detailsMembersLoading.set(false),
    });
  }
  closeDetails(): void { this.detailsTarget.set(null); }
  formatJoinDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft<K extends keyof ReturnType<typeof this.emptyDraft>>(key: K, value: string | boolean): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
  }
  setDraftCategoryIds(value: readonly string[]): void {
    this.draft.update((draft) => ({ ...draft, categoryIds: value }));
  }
  // Uploads and stores the returned URL, never the data URL itself: clubs.image_url is
  // VARCHAR(255), so an inlined base64 photo overflows the column and the save fails with a 500
  // (same reason EVENT_IMAGE_UPLOAD_API exists — see event-image-upload.service.ts).
  selectImageFile(file: File): void {
    if (!file.type.startsWith('image/')) { this.imageError.set('Select a valid image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { this.imageError.set('Club image must be 5 MB or smaller.'); return; }
    this.imageError.set('');
    this.imageUploading.set(true);
    this.imageUpload.upload({ file }).pipe(
      finalize(() => this.imageUploading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ image }) => this.draft.update((draft) => ({ ...draft, imageUrl: image.url, imageFileName: file.name })),
      error: () => this.imageError.set('The image could not be uploaded. Please try again.'),
    });
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
        this.modalOpen.set(false);
        this.toast.success(id ? 'Club updated' : 'Club created', `${club.name} was ${id ? 'updated' : 'created'} successfully.`);
        this.triggerReload();
      },
      error: () => this.errorMessage.set('The club could not be saved. Please try again.'),
    });
  }

  private changeStatus(club: ClubRecord): void {
    this.clubService.setClubActive(club.id, !club.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(club.active ? 'Club deactivated' : 'Club activated', `${club.name} is now ${club.active ? 'inactive' : 'active'}.`);
        this.triggerReload();
      },
      error: () => this.toast.error('Could not change status', 'Please try again.'),
    });
  }
  private emptyDraft() { return { name: '', description: '', imageUrl: '', imageFileName: '', presidentUserId: '', categoryIds: [] as readonly string[], active: true }; }
}
