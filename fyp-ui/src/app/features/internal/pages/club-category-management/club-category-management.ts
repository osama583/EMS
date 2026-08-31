import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, finalize, Subject, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ClubService } from '../../../../core/clubs/club.service';
import { ClubCategoryRecord, ClubCategoryStatus } from '../../../../core/clubs/club.models';
import { DeletionMetadata, DeletionPreview } from '../../../../shared/models/deletion.models';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalSortChange, InternalSortState, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Club category management, on its own page (same shell as My Menu / Dropdown Box Options at request-
// option-management.ts) instead of the old ClubCategoryManagerComponent popup.
@Component({
  selector: 'app-club-category-management',
  imports: [
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, StatusToggleComponent,
    FeedbackBannerComponent, DeleteConfirmDialogComponent, ConfirmDialogComponent,
  ],
  templateUrl: './club-category-management.html',
  styleUrl: './club-category-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubCategoryManagementComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly statusFilter = signal<ClubCategoryStatus>('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  // Created is the only sortable column on this table; oldest first, so the
  // catalogue reads in the order it was built up.
  readonly sort = signal<InternalSortState>({ key: 'created', order: 'asc' });

  readonly showDeleted = signal(false);
  readonly deletedCategories = signal<readonly (ClubCategoryRecord & DeletionMetadata)[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringId = signal<string | null>(null);
  readonly restoreTarget = signal<ClubCategoryRecord | null>(null);

  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draftName = signal('');
  readonly draftActive = signal(true);
  readonly formError = signal('');

  readonly deleteTarget = signal<ClubCategoryRecord | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);

  private readonly reload$ = new Subject<void>();

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Club categories', paginationLabel: 'Category pages', rowsPerPageLabel: 'Categories per page', mobileListLabel: 'Category cards',
    header: {
      title: 'Club Categories',
      description: 'Categories a club President may pick from when setting up their club — every club carries 1 to 3.',
      countLabel: `${this.total()} categor${this.total() === 1 ? 'y' : 'ies'}`,
      primaryActionLabel: 'Add category',
    },
    search: { ariaLabel: 'Search categories', placeholder: 'Search category name' },
    columns: [
      { key: 'name', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'created', label: 'Created', sortKey: 'created' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Edit category', icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: 'Delete category', icon: 'delete' },
    ],
    emptyTitle: 'No categories found',
    emptyDescription: 'Add a category or change the search and status filters.',
  }));

  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted club categories', paginationLabel: 'Deleted category pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted category cards',
    header: {
      title: 'Deleted Categories',
      description: 'Soft-deleted categories are kept for 7 days before being permanently removed. Restore a category any time within that window.',
      countLabel: `${this.deletedCategories().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'name', label: 'Category' }, { key: 'created', label: 'Deleted' }, { key: 'status', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'restore', label: 'Restore', icon: 'restore_from_trash' }],
    emptyTitle: 'No deleted categories', emptyDescription: 'Categories you delete will appear here for 7 days before being permanently removed.',
  }));

  // "All" leads and is the default: the question this page is opened with is "what categories are
  // there", and answering it used to mean reading Active, then Inactive, and holding both lists in
  // your head — the one view that showed the whole table did not exist.
  readonly filters = computed(() => [{
    key: 'status', ariaLabel: 'Filter categories by status', value: this.statusFilter(),
    options: [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  }]);

  readonly records = computed<readonly InternalDataRecord[]>(() => this.categories().map((category) => ({
    id: category.id,
    cells: {
      name: { primary: category.name },
      status: { primary: category.active ? 'Active' : 'Inactive', badge: true, tone: category.active ? 'success' : 'neutral' },
      created: { primary: this.formatDate(category.createdAt) },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: 'Category', status: category.active ? 'Active' : 'Inactive', title: category.name,
      details: [{ icon: 'schedule', text: `Created ${this.formatDate(category.createdAt)}` }],
    },
  })));

  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedCategories().map((category) => ({
    id: category.id,
    actionKeys: ['restore'],
    cells: {
      name: { primary: category.name },
      created: { primary: `Deleted ${this.formatDate(category.deletedAt)}` },
      status: { primary: category.daysRemaining > 0 ? `${category.daysRemaining} day${category.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: category.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${category.daysRemaining}d left`, title: category.name, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(category.deletedAt)}` }] },
  })));

  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
    this.triggerReload();
  }

  readonly formValid = computed(() => this.draftName().trim().length > 0);

  constructor() {
    this.reload$.pipe(
      debounceTime(0),
      switchMap(() => {
        this.loading.set(true);
        return this.clubService.searchCategories({
          search: this.search().trim(),
          status: this.statusFilter(),
          page: this.page(),
          pageSize: this.pageSize(),
          order: this.sort().order,
        }).pipe(finalize(() => this.loading.set(false)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        // Taken exactly as returned. The status filter is now a real query param, so the server
        // decides the set, counts it and slices it — the page no longer re-filters the response
        // (which made `total` count rows the table was not showing, and left the last page of an
        // "Inactive" view mostly empty).
        this.categories.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(Math.max(1, result.totalPages));
      },
      error: () => { this.errorMessage.set('Categories could not be loaded. Please try again.'); this.loading.set(false); },
    });
    this.reload$.next();
  }

  private triggerReload(): void { this.reload$.next(); }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); this.triggerReload(); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value as ClubCategoryStatus);
    this.page.set(1);
    this.triggerReload();
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.page.set(1); this.triggerReload(); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); this.triggerReload(); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); this.triggerReload(); }

  openAdd(): void {
    this.editingId.set(null);
    this.draftName.set('');
    this.draftActive.set(true);
    this.formError.set('');
    this.modalOpen.set(true);
  }

  handleAction(event: InternalRowActionEvent): void {
    const category = this.categories().find((item) => item.id === event.record.id);
    if (!category) return;
    if (event.action.key === 'edit') { this.openEdit(category); return; }
    if (event.action.key === 'delete') { this.requestDelete(category); return; }
    this.changeStatus(category);
  }

  private openEdit(category: ClubCategoryRecord): void {
    this.editingId.set(category.id);
    this.draftName.set(category.name);
    this.draftActive.set(category.active);
    this.formError.set('');
    this.modalOpen.set(true);
  }

  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraftName(value: string): void { this.draftName.set(value); }
  setDraftActive(value: boolean): void { this.draftActive.set(value); }

  save(): void {
    if (!this.formValid()) return;
    const name = this.draftName().trim();
    const id = this.editingId();
    this.saving.set(true);
    this.formError.set('');
    const request$ = id ? this.clubService.updateCategory(id, name) : this.clubService.createCategory(name, this.currentUserId);
    request$.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.modalOpen.set(false);
        this.toast.success(id ? 'Category updated' : 'Category added', `"${saved.name}" was ${id ? 'updated' : 'created'}.`);
        this.triggerReload();
      },
      error: (err) => this.formError.set(apiErrorMessage(err, 'The category could not be saved. Please try again.')),
    });
  }

  private changeStatus(category: ClubCategoryRecord): void {
    this.clubService.setCategoryActive(category.id, !category.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success(`${category.name} is now ${category.active ? 'inactive' : 'active'}.`); this.triggerReload(); },
      error: (err) => this.toast.error('Could not change status', apiErrorMessage(err, 'Please try again.')),
    });
  }

  requestDelete(category: ClubCategoryRecord): void {
    this.deleteTarget.set(category);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.clubService.checkCategoryDeletion(category.id).pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check category', 'Please try again.'),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const category = this.deleteTarget();
    const preview = this.deletePreview();
    if (!category || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.clubService.deleteCategory(category.id).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success('Category deleted', 'It can be restored within 7 days.');
        this.triggerReload();
      },
      error: (err) => this.toast.error('Category could not be deleted', apiErrorMessage(err, 'It may still be in use by a club.')),
    });
  }

  // ---------------------------------------------------------------------------
  // Deleted tab — a page-level section switch (same treatment as My Menu | Deleted), only fetched the
  // first time it's opened so a viewer who never looks at it never pays for the call.
  setDeletedTab(deleted: boolean): void {
    if (this.showDeleted() === deleted) return;
    this.showDeleted.set(deleted);
    this.errorMessage.set('');
    if (deleted) this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.clubService.getDeletedCategories().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => this.deletedCategories.set(categories),
      error: () => this.errorMessage.set('The deleted categories could not be loaded.'),
    });
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key !== 'restore') return;
    const category = this.deletedCategories().find((item) => item.id === event.record.id);
    if (category) this.restoreTarget.set(category);
  }
  readonly restoreMessage = computed(() => {
    const target = this.restoreTarget();
    return target ? `Restore "${target.name}"? It becomes active again straight away.` : '';
  });
  cancelRestore(): void { this.restoreTarget.set(null); }
  confirmRestore(): void {
    const target = this.restoreTarget();
    this.restoreTarget.set(null);
    if (target) this.restoreCategory(target.id);
  }
  private restoreCategory(id: string): void {
    this.restoringId.set(id);
    this.clubService.restoreCategory(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Category restored'); this.loadDeleted(); this.triggerReload(); },
      error: (err) => this.toast.error('Could not restore category', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
