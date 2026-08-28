import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, finalize, switchMap } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { EVENT_IMAGE_UPLOAD_API } from '../../../../../core/events/event-image-upload.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubCategoryName, ClubCategoryRecord, ClubDraft, ClubMemberRecord, ClubRecord, ClubUserSummary } from '../../../../../core/clubs/club.models';
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
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';
import { DeleteConfirmDialogComponent } from '../../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeletionMetadata, DeletionPreview } from '../../../../../shared/models/deletion.models';
import { ViewToggleComponent } from '../../../../../shared/components/view-toggle/view-toggle';

type ViewMode = 'table' | 'card';

@Component({
  selector: 'app-club-management',
  imports: [ViewToggleComponent,
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent,
    FeedbackBannerComponent, OptionCardGridComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent, InternalPaginationComponent, ImageUploadFieldComponent,
    DeleteConfirmDialogComponent, ConfirmDialogComponent,
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
  // Loaded only when the Add/Edit modal actually opens (see openAdd/editClub) — not eagerly on
  // page load, since most visits to this page never open the form at all, and re-fetched on
  // every open rather than cached so a student's eligibility can never go stale while the page
  // sits open in a background tab.
  readonly eligiblePresidents = signal<readonly ClubUserSummary[]>([]);
  readonly presidentsLoading = signal(false);
  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly categoriesLoading = signal(false);
  // Lean id/name projection for the filter dropdown only (?namesOnly=true) — loaded once eagerly,
  // since the filter is visible on every page load and unlike the form's `categories` above never
  // needs `active`/`createdAt`.
  readonly categoryNames = signal<readonly ClubCategoryName[]>([]);
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
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);
  readonly deactivating = signal(false);
  readonly detailsTarget = signal<ClubRecord | null>(null);
  readonly detailsMembers = signal<readonly ClubMemberRecord[]>([]);
  readonly detailsMembersLoading = signal(false);

  // Deleted tab — same page-level section switch as club-category-management.ts, only fetched
  // the first time it's opened so a viewer who never looks at it never pays for the call.
  readonly showDeleted = signal(false);
  readonly deletedClubs = signal<readonly (ClubRecord & DeletionMetadata)[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringId = signal<string | null>(null);
  readonly restoreTarget = signal<ClubRecord | null>(null);

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
    actions: [
      { key: 'edit', label: 'Edit club', icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: 'Delete club', icon: 'delete' },
    ],
    emptyTitle: 'No clubs found', emptyDescription: 'Add a club or change the current search and filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly cardHeaderConfig = computed<InternalPageHeaderConfig>(() => ({ title: this.config().header.title, description: this.config().header.description, countLabel: this.config().header.countLabel }));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted clubs', paginationLabel: 'Deleted club pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted club cards',
    header: {
      title: 'Deleted Clubs',
      description: 'Soft-deleted clubs are kept for 7 days before being permanently removed. Restore a club any time within that window.',
      countLabel: `${this.deletedClubs().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'club', label: 'Club' }, { key: 'created', label: 'Deleted' }, { key: 'status', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'restore', label: 'Restore', icon: 'restore_from_trash' }],
    emptyTitle: 'No deleted clubs', emptyDescription: 'Clubs you delete will appear here for 7 days before being permanently removed.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter clubs by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { key: 'category', ariaLabel: 'Filter clubs by category', value: this.categoryFilter(), options: [{ value: 'all', label: 'All categories' }, ...this.categoryNames().map((category) => ({ value: category.id, label: category.name }))] },
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
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedClubs().map((club) => ({
    id: club.id,
    actionKeys: ['restore'],
    cells: {
      club: { primary: club.name, secondary: club.description || 'No description' },
      created: { primary: `Deleted ${this.formatJoinDate(club.deletedAt)}` },
      status: { primary: club.daysRemaining > 0 ? `${club.daysRemaining} day${club.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: club.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${club.daysRemaining}d left`, title: club.name, details: [{ icon: 'schedule', text: `Deleted ${this.formatJoinDate(club.deletedAt)}` }] },
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
    // Only the lean filter-dropdown projection loads eagerly — it's visible on every page load.
    // eligiblePresidents/categories (the full Add/Edit form data) load lazily, only when the
    // modal actually opens; see openAdd()/editClub().
    this.clubService.getCategoryNames().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categoryNames.set(categories));

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

  openAdd(): void {
    this.editingId.set(null); this.draft.set(this.emptyDraft()); this.imageError.set(''); this.modalOpen.set(true); this.errorMessage.set('');
    this.loadFormOptions();
  }
  editClub(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (!club) return;
    this.editingId.set(club.id);
    this.draft.set({ name: club.name, description: club.description, imageUrl: club.imageUrl ?? '', imageFileName: '', presidentUserId: club.president?.id ?? '', categoryIds: club.categories.map((category) => category.id), active: club.active });
    this.imageError.set('');
    this.modalOpen.set(true);
    this.errorMessage.set('');
    this.loadFormOptions();
  }
  // Eligible presidents and the full category list (with `active`) are only ever needed while
  // this form is open, and re-fetched every time it opens rather than cached — a student's
  // eligibility or a category's active status can change between one open and the next.
  private loadFormOptions(): void {
    this.presidentsLoading.set(true);
    this.clubService.getEligiblePresidents().pipe(finalize(() => this.presidentsLoading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe((presidents) => this.eligiblePresidents.set(presidents));
    this.categoriesLoading.set(true);
    this.clubService.getCategories().pipe(finalize(() => this.categoriesLoading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categories.set(categories));
  }
  handleAction(event: InternalRowActionEvent): void {
    const club = this.clubs().find((item) => item.id === event.record.id);
    if (!club) return;
    if (event.action.key === 'edit') { this.editClub(club.id); return; }
    if (event.action.key === 'delete') { this.requestDelete(club); return; }
    this.changeStatus(club);
  }

  // Delete follows the shared dependency-gated flow: the preview request runs while the dialog
  // is already open, so a club that cannot be deleted says why (and offers deactivation instead)
  // rather than failing after the click. Mirrors club-category-management's delete exactly.
  requestDelete(club: ClubRecord): void {
    this.deleteTarget.set(club);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.clubService.checkClubDeletion(club.id).pipe(
      finalize(() => this.checkingDeletion.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check club', 'Please try again.'),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const club = this.deleteTarget();
    const preview = this.deletePreview();
    if (!club || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.clubService.deleteClub(club.id).pipe(
      finalize(() => this.deleting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success('Club deleted', 'It can be restored within 7 days.');
        this.triggerReload();
      },
      error: (err) => this.toast.error(
        'Club could not be deleted',
        apiErrorMessage(err, 'Deactivate it instead if it is still in use.'),
      ),
    });
  }
  toggleActiveById(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (club) this.changeStatus(club);
  }
  // The card grid emits an id; the table hands over the whole record. Both land on the same
  // requestDelete() so the two views cannot drift apart.
  requestDeleteById(id: string): void {
    const club = this.clubs().find((item) => item.id === id);
    if (club) this.requestDelete(club);
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

  // Deleted tab — mirrors club-category-management.ts's identical section exactly.
  setDeletedTab(deleted: boolean): void {
    if (this.showDeleted() === deleted) return;
    this.showDeleted.set(deleted);
    this.errorMessage.set('');
    if (deleted) this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.clubService.getDeletedClubs().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (clubs) => this.deletedClubs.set(clubs),
      error: () => this.errorMessage.set('The deleted clubs could not be loaded.'),
    });
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key !== 'restore') return;
    const club = this.deletedClubs().find((item) => item.id === event.record.id);
    if (club) this.restoreTarget.set(club);
  }
  readonly restoreMessage = computed(() => {
    const target = this.restoreTarget();
    return target ? `Restore "${target.name}"? It comes back deactivated, so it stays hidden from members until you switch it active again.` : '';
  });
  cancelRestore(): void { this.restoreTarget.set(null); }
  confirmRestore(): void {
    const target = this.restoreTarget();
    this.restoreTarget.set(null);
    if (target) this.restoreClub(target.id);
  }
  private restoreClub(id: string): void {
    this.restoringId.set(id);
    this.clubService.restoreClub(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Club restored'); this.loadDeleted(); this.triggerReload(); },
      error: (err) => this.toast.error('Could not restore club', apiErrorMessage(err, 'Please try again.')),
    });
  }
}
