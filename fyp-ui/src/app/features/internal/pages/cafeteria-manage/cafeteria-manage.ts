import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, debounceTime, finalize, switchMap } from 'rxjs';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { Cafeteria } from '../../../../core/cafeterias/cafeteria.models';
import { Archived } from '../../../../core/admin-directory/admin-directory.models';
import { DeletionPreview } from '../../../../shared/models/deletion.models';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

type CafeteriaManageTab = 'active' | 'deleted';

// Cafeteria Admin's own CRUD screen for cafeteria units — a Cafeteria is a `unit` row under the
// hood (CAFETERIA_UNIT_PREFIX-coded, see server/services/unit-code.js), so this is intentionally
// the exact same shape as the System Admin Units page, just scoped to CafeteriaService's
// dedicated /api/cafeterias endpoints instead of every unit in the system. Deleted tab follows
// the same 7-day soft-delete/restore/purge lifecycle as every other Admin Settings entity.
// The deleted-items table names its first column differently per page (identity / name / label),
// so the confirmation reads whichever cell actually carries the record's display name.
function restoreLabelFor(record: InternalDataRecord): string {
  const named = Object.values(record.cells).find((cell) => !!cell?.primary);
  return named?.primary ? String(named.primary) : String(record.id);
}

@Component({
  selector: 'app-cafeteria-manage',
  imports: [ConfirmDialogComponent, InternalDataPageComponent, FormModalComponent, FormFieldComponent, StatusToggleComponent, FeedbackBannerComponent, DeleteConfirmDialogComponent],
  templateUrl: './cafeteria-manage.html',
  styleUrl: './cafeteria-manage.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaManageComponent {
  private readonly toast = inject(ToastService);
  private readonly service = inject(CafeteriaService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tab = signal<CafeteriaManageTab>('active');
  readonly cafeterias = signal<readonly Cafeteria[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingCode = signal<string | null>(null);
  readonly draft = signal<{ name: string; active: boolean }>({ name: '', active: true });
  readonly errorMessage = signal('');

  readonly deleteTarget = signal<Cafeteria | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);

  // Deleted tab
  readonly deletedCafeterias = signal<readonly Archived<Cafeteria>[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringCode = signal<string | null>(null);
  readonly purgeTargetCode = signal<string | null>(null);
  readonly purgePreview = signal<DeletionPreview | null>(null);
  readonly checkingPurge = signal(false);
  readonly purging = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.cafeteriaRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Cafeterias', paginationLabel: 'Cafeteria pages', rowsPerPageLabel: 'Cafeterias per page', mobileListLabel: 'Cafeteria cards',
    header: {
      title: 'Manage Cafeterias',
      description: 'Create and manage the cafeterias available for staff assignment and menu oversight.',
      countLabel: `${this.total()} cafeteria${this.total() === 1 ? '' : 's'}`,
      primaryActionLabel: 'Add cafeteria',
    },
    search: { ariaLabel: 'Search cafeterias', placeholder: 'Search cafeteria name' },
    columns: [
      { key: 'identity', label: 'Cafeteria' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Edit cafeteria', icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: 'Delete cafeteria', icon: 'delete' },
    ],
    emptyTitle: 'No cafeterias found', emptyDescription: 'Add a cafeteria or change the current search and filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    { key: 'status', ariaLabel: 'Filter cafeterias by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]);
  readonly formValid = computed(() => Boolean(this.draft().name.trim()));

  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedCafeterias().map((c) => ({
    id: c.code,
    actionKeys: ['restore', 'purge'],
    cells: {
      identity: { primary: c.name, secondary: c.code },
      deletedAt: { primary: this.formatDate(c.deletedAt) },
      remaining: { primary: c.daysRemaining > 0 ? `${c.daysRemaining} day${c.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: c.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${c.daysRemaining}d left`, title: c.name, identity: c.code, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(c.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(c.permanentDeletionAt)}` }] },
  })));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted cafeterias', paginationLabel: 'Deleted cafeteria pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted cafeteria cards',
    header: {
      title: 'Deleted Cafeterias',
      description: 'Soft-deleted cafeterias are kept for 7 days before being permanently removed. Restore a cafeteria any time within that window.',
      countLabel: `${this.deletedCafeterias().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'identity', label: 'Cafeteria' }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'restore', label: 'Restore', icon: 'restore_from_trash' },
      { key: 'purge', label: 'Delete forever', icon: 'delete_forever' },
    ],
    emptyTitle: 'No deleted cafeterias', emptyDescription: 'Cafeterias you delete will appear here for 7 days before being permanently removed.', pageSizeOptions: [5, 10, 25],
  }));

  // Refetch whenever search/status/page/pageSize change, or the service signals a mutation
  // (create/update/delete/restore) via refreshed$ — the same query params the Manage screen used
  // to compute in the browser (search/statusFilter/pageSlice) are now sent to the server instead.
  private readonly query$ = toObservable(computed(() => ({
    page: this.page(), pageSize: this.pageSize(), q: this.search().trim(), status: this.statusFilter(),
  })));

  constructor() {
    combineLatest([this.query$, this.service.refreshed$]).pipe(
      debounceTime(200),
      switchMap(([q]) => {
        this.loading.set(true);
        return this.service.search({
          page: q.page, pageSize: q.pageSize, q: q.q || undefined,
          status: q.status === 'active' || q.status === 'inactive' ? q.status : undefined,
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => { this.cafeterias.set(result.items); this.total.set(result.total); this.loading.set(false); },
      error: () => { this.errorMessage.set('The cafeterias could not be loaded.'); this.loading.set(false); },
    });
  }

  setTab(tab: CafeteriaManageTab): void {
    this.tab.set(tab);
    this.clearMessages();
    if (tab === 'deleted') this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.service.getDeleted().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cafeterias) => this.deletedCafeterias.set(cafeterias),
      error: () => this.errorMessage.set('The deleted cafeterias could not be loaded.'),
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(): void {
    this.editingCode.set(null); this.clearMessages();
    this.draft.set({ name: '', active: true });
    this.modalOpen.set(true);
  }
  handleAction(event: InternalRowActionEvent): void {
    const cafeteria = this.cafeterias().find((c) => c.code === event.record.id);
    if (!cafeteria) return;
    if (event.action.key === 'edit') {
      this.editingCode.set(cafeteria.code);
      this.draft.set({ name: cafeteria.name, active: cafeteria.active });
      this.modalOpen.set(true); this.clearMessages(); return;
    }
    if (event.action.key === 'delete') { this.requestDelete(cafeteria); return; }
    this.changeStatus(cafeteria);
  }
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'restore') { this.restoreTarget.set({ id: String(event.record.id), label: restoreLabelFor(event.record) }); return; }
    if (event.action.key === 'purge') this.requestPurge(String(event.record.id));
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setName(value: string): void { this.draft.update((d) => ({ ...d, name: value })); }
  setActive(value: boolean): void { this.draft.update((d) => ({ ...d, active: value })); }

  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const code = this.editingCode();
    const request = code
      ? this.service.update(code, this.draft())
      : this.service.create(this.draft());
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.modalOpen.set(false); this.toast.success(`Cafeteria ${code ? 'updated' : 'created'} successfully.`); },
      error: (err) => this.toast.error('The cafeteria could not be saved', apiErrorMessage(err, 'Please try again.')),
    });
  }

  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.name}"` : '';
  }
  requestDelete(cafeteria: Cafeteria): void {
    this.clearMessages();
    this.deleteTarget.set(cafeteria);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.service.checkDeletion(cafeteria.code).pipe(
      finalize(() => this.checkingDeletion.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check cafeteria', 'Please try again.'),
    });
  }
  cancelDelete(): void {
    if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); }
  }
  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.deleting.set(true);
    this.service.delete(target.code).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null);
        this.deletePreview.set(null);
        this.toast.success('Cafeteria deleted', 'It can be restored from the Deleted tab within 7 days.');
      },
      error: (err) => {
        this.deleteTarget.set(null);
        this.deletePreview.set(null);
        this.toast.error('The cafeteria could not be deleted', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  // Restoring brings an archived record back into circulation immediately, so it is
  // confirmed first like every other state-changing action.
  readonly restoreTarget = signal<{ id: string; label: string } | null>(null);
  readonly restoreMessage = computed(() => {
    const target = this.restoreTarget();
    return target ? `Restore ${target.label}? It becomes active again straight away.` : '';
  });
  cancelRestore(): void { this.restoreTarget.set(null); }
  confirmRestore(): void {
    const target = this.restoreTarget();
    this.restoreTarget.set(null);
    if (target) this.restore(target.id);
  }

  restore(code: string): void {
    this.clearMessages();
    this.restoringCode.set(code);
    this.service.restore(code).pipe(finalize(() => this.restoringCode.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Cafeteria restored'); this.loadDeleted(); },
      error: (err) => this.toast.error('The cafeteria could not be restored', apiErrorMessage(err, 'Please try again.')),
    });
  }

  purgeTargetLabel(): string {
    const code = this.purgeTargetCode();
    const cafeteria = code ? this.deletedCafeterias().find((c) => c.code === code) : null;
    return cafeteria ? `"${cafeteria.name}"` : '';
  }
  requestPurge(code: string): void {
    this.clearMessages();
    this.purgeTargetCode.set(code);
    // The server re-checks dependencies at purge time, so a cafeteria can be blocked here even
    // though it was clean when it was archived. Ask first, for the same reason delete does.
    this.purgePreview.set(null);
    this.checkingPurge.set(true);
    this.service.checkDeletion(code).pipe(
      finalize(() => this.checkingPurge.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.purgePreview.set(preview),
      error: () => this.toast.error('Could not check cafeteria', 'Please try again.'),
    });
  }
  cancelPurge(): void {
    if (!this.purging()) { this.purgeTargetCode.set(null); this.purgePreview.set(null); }
  }
  confirmPurge(): void {
    const code = this.purgeTargetCode();
    if (!code) return;
    this.purging.set(true);
    this.service.purge(code).pipe(finalize(() => this.purging.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.purgeTargetCode.set(null); this.purgePreview.set(null); this.toast.success('Cafeteria permanently deleted'); this.loadDeleted(); },
      error: (err) => { this.purgeTargetCode.set(null); this.purgePreview.set(null); this.toast.error('The cafeteria could not be permanently deleted', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  private clearMessages(): void { this.errorMessage.set(''); }
  private changeStatus(cafeteria: Cafeteria): void {
    this.clearMessages();
    this.service.setActive(cafeteria.code, !cafeteria.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`Cafeteria is now ${cafeteria.active ? 'inactive' : 'active'}.`),
      error: () => this.toast.error('The active status could not be changed'),
    });
  }
  private cafeteriaRecords(): readonly InternalDataRecord[] {
    return this.cafeterias().map((c) => ({
      id: c.code,
      cells: {
        identity: { primary: c.name, secondary: c.code },
        status: { primary: c.active ? 'Active' : 'Inactive', badge: true, tone: c.active ? 'success' : 'neutral' },
        actions: { primary: '' },
      },
      mobile: { eyebrow: 'Cafeteria', status: c.active ? 'Active' : 'Inactive', title: c.name, identity: c.code, details: [] },
    }));
  }
}
