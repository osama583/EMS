import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { AdminDirectoryService } from '../../../../core/admin-directory/admin-directory.service';
import { Archived, AdminNavPageDraft, AdminNavPageRecord, AdminRoleRecord, AdminUnitRecord, NavEntryType, NavGrantType } from '../../../../core/admin-directory/admin-directory.models';
import { DeletionPreview } from '../../../../shared/models/deletion.models';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { ImageUploadFieldComponent } from '../../../../shared/components/image-upload-field/image-upload-field';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { PopoverComponent } from '../../../../shared/components/popover/popover';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellClickEvent, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

// Server-side derivation this mirrors exactly: services/unit-code.js's deriveUnitCode(), also
// used server-side to auto-slug label -> page_code (admin.routes.js POST /nav-pages).
function derivePageCode(label: string): string {
  return (label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

// Strips whatever can legally precede the root element in a standalone .svg file — a UTF-8 BOM,
// an XML declaration (<?xml ... ?>), a DOCTYPE, and/or comments — so an SVG exported straight from
// a design tool (which always includes the <?xml ... ?> prolog) still validates. What's left after
// this is stored/rendered, so the saved value is always a bare <svg>...</svg> document, matching
// every hand-authored seed icon's shape.
function stripSvgProlog(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->\s*)*/, '')
    .trim();
}

function readAsText(file: File): Observable<string> {
  return new Observable((subscriber) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => { subscriber.next(String(reader.result)); subscriber.complete(); });
    reader.addEventListener('error', () => subscriber.error(new Error('The icon file could not be read.')));
    reader.readAsText(file);
    return () => reader.abort();
  });
}

type PageVisibilityTab = 'pages' | 'permissions' | 'deleted';

interface PageVisibilityDraft {
  readonly label: string;
  readonly entryType: NavEntryType;
  readonly icon: string;
  readonly iconFileName: string;
  readonly parentPageCode: string;
  readonly active: boolean;
}

const EMPTY_DRAFT: PageVisibilityDraft = {
  label: '', entryType: 'page', icon: '', iconFileName: '', parentPageCode: '', active: true,
};

// Sentinel for the Add Permission modal's Folder dropdown — never a real page_code (those are
// derived from a label via deriveUnitCode(), which never produces double-underscore-wrapped
// values), so it can't collide with an actual folder.
const STANDALONE_PAGES_VALUE = '__standalone__';

const GRANT_TYPE_OPTIONS: readonly { readonly value: NavGrantType; readonly label: string; readonly description: string }[] = [
  { value: 'role', label: 'Role only', description: 'Anyone holding this role, in any unit. Flat roles only (e.g. CFO, System Admin).' },
  { value: 'unit_role', label: 'Unit + role', description: 'Anyone holding this role SPECIFICALLY in this unit — e.g. "Staff, but only in Food & Beverage Services".' },
  { value: 'unit', label: 'Unit only', description: 'Anyone holding ANY role in this unit — e.g. "everyone in Finance".' },
  { value: 'cafeteria', label: 'All cafeterias', description: 'Anyone holding this role in ANY cafeteria — including outlets added later. No need to pick outlets one by one.' },
];

// Roles a 'cafeteria' grant can name. Every outlet accepts exactly these two, so the picker offers
// them without a round trip — and the server rejects anything else (see _assert_grant_is_legal).
const CAFETERIA_ROLE_CODES: readonly string[] = ['cafeteria-manager', 'cafeteria-staff'];

// The deleted-items table names its first column differently per page (identity / name / label),
// so the confirmation reads whichever cell actually carries the record's display name.
function restoreLabelFor(record: InternalDataRecord): string {
  const named = Object.values(record.cells).find((cell) => !!cell?.primary);
  return named?.primary ? String(named.primary) : String(record.id);
}

@Component({
  selector: 'app-page-visibility',
  imports: [ConfirmDialogComponent, InternalDataPageComponent, FormModalComponent, FormFieldComponent, FeedbackBannerComponent, ImageUploadFieldComponent, SearchableDropdownComponent, PopoverComponent, DeleteConfirmDialogComponent],
  templateUrl: './page-visibility.html',
  styleUrl: './page-visibility.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageVisibilityComponent {
  private readonly toast = inject(ToastService);
  private readonly service = inject(AdminDirectoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal<PageVisibilityTab>('pages');
  readonly grantTypeOptions = GRANT_TYPE_OPTIONS;

  readonly navPages = signal<readonly AdminNavPageRecord[]>([]);
  readonly roles = signal<readonly AdminRoleRecord[]>([]);
  readonly units = signal<readonly AdminUnitRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly iconError = signal('');

  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly typeFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly modalOpen = signal(false);
  readonly editingCode = signal<string | null>(null);
  readonly draft = signal<PageVisibilityDraft>(EMPTY_DRAFT);

  // Delete-confirmation flow for a page (dependency-checked before the admin can confirm) — see
  // DeleteConfirmDialogComponent. Grant-row deletion has no dialog (nothing ever blocks it — a
  // grant has no dependents of its own — so it stays a direct action, same as before).
  readonly deleteTarget = signal<AdminNavPageRecord | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deletingPage = signal(false);

  // Deleted tab — pages and grants share one list since restoring either is the same "undo a
  // delete" action from the admin's point of view.
  readonly deletedPages = signal<readonly Archived<AdminNavPageRecord>[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringCode = signal<string | null>(null);

  readonly flatRoles = computed<readonly AdminRoleRecord[]>(() => this.roles().filter((r) => r.unitCodes.length === 0));
  readonly activeUnits = computed<readonly AdminUnitRecord[]>(() => this.units().filter((u) => u.active));
  readonly folderOptions = computed<readonly SelectOption[]>(() => this.navPages().filter((p) => p.entryType === 'folder' && p.pageCode !== this.editingCode()).map((p) => ({ value: p.pageCode, label: p.label })));

  // ---------------------------------------------------------------------------
  // Pages tab — label/icon/parent/route/sort order/active only. Permissions are managed
  // exclusively in the Permissions tab below.
  // ---------------------------------------------------------------------------

  readonly orderedPages = computed<readonly { readonly page: AdminNavPageRecord; readonly depth: number }[]>(() => {
    const pages = this.navPages();
    const byParent = new Map<string | null, AdminNavPageRecord[]>();
    for (const page of pages) {
      const key = page.parentPageCode || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(page);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    const result: { page: AdminNavPageRecord; depth: number }[] = [];
    const walk = (parentCode: string | null, depth: number) => {
      for (const page of byParent.get(parentCode) || []) {
        result.push({ page, depth });
        if (page.entryType === 'folder') walk(page.pageCode, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  });

  readonly filteredPages = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.orderedPages().filter(({ page }) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === page.active)
      && (this.typeFilter() === 'all' || page.entryType === this.typeFilter())
      && (!search || `${page.label} ${page.pageCode} ${page.routePath ?? ''}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredPages().length / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.pageRecords());
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Sidebar pages', paginationLabel: 'Page visibility pages', rowsPerPageLabel: 'Pages per page', mobileListLabel: 'Page cards',
    header: {
      title: 'Page Visibility',
      description: 'Manage the sidebar tree: add pages and folders, then switch to the Permissions tab to choose who can see each one.',
      countLabel: `${this.filteredPages().length} page${this.filteredPages().length === 1 ? '' : 's'}`,
      primaryActionLabel: 'Add page',
    },
    search: { ariaLabel: 'Search pages', placeholder: 'Search label, code, or route' },
    columns: [
      { key: 'identity', label: 'Page' },
      { key: 'type', label: 'Type' },
      { key: 'parent', label: 'Parent folder' },
      { key: 'route', label: 'Route' },
      { key: 'grants', label: 'Permissions' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Edit page', icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: 'Delete page', icon: 'delete' },
    ],
    emptyTitle: 'No pages found', emptyDescription: 'Add a page or change the current search and filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    { key: 'type', ariaLabel: 'Filter by entry type', value: this.typeFilter(), options: [{ value: 'all', label: 'All types' }, { value: 'page', label: 'Page' }, { value: 'folder', label: 'Folder' }] },
    { key: 'status', ariaLabel: 'Filter pages by status', value: this.statusFilter(), options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]);

  // ImageUploadFieldComponent (reused here for the file-picker chrome — drag/replace/remove,
  // filename display) previews via a plain <img src>, which can't apply currentColor recoloring;
  // that's fine for this confirmation thumbnail (the real recolored render is NavIconComponent,
  // used everywhere the icon actually appears — table rows, popover, sidebar) — a data: URL lets
  // its <img> show the uploaded SVG without introducing a second upload/storage path.
  readonly iconPreviewDataUrl = computed(() => {
    const icon = this.draft().icon;
    // Legacy seeded pages store a Material Symbol ligature name (e.g. "help_center") in `icon`
    // rather than SVG markup — building a data URL from that yields an invalid SVG document the
    // <img> can't render, so only preview when it's actually SVG.
    return /^\s*<svg[\s>]/i.test(icon) ? `data:image/svg+xml;utf8,${encodeURIComponent(icon)}` : null;
  });

  readonly derivedPageCode = computed(() => derivePageCode(this.draft().label));
  readonly derivedRoutePath = computed(() => this.entryType() === 'folder' ? null : `/app/${this.derivedPageCode() || '…'}`);
  readonly entryType = computed(() => this.draft().entryType);
  readonly formValid = computed(() => !!this.draft().label.trim() && !this.labelError());

  constructor() {
    this.service.navPages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pages) => { this.navPages.set(pages); this.loading.set(false); },
      error: () => { this.errorMessage.set('The page visibility data could not be loaded.'); this.loading.set(false); },
    });
    this.service.roles$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (roles) => this.roles.set(roles) });
    this.service.units$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (units) => this.units.set(units) });
  }

  setTab(tab: PageVisibilityTab): void {
    this.activeTab.set(tab);
    this.clearMessages();
    if (tab === 'deleted') this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.service.getDeletedNavPages().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pages) => this.deletedPages.set(pages),
      error: () => this.errorMessage.set('The deleted pages could not be loaded.'),
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    if (change.key === 'type') this.typeFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.typeFilter.set('all'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(parentPageCode?: string): void {
    this.editingCode.set(null); this.clearMessages();
    this.draft.set({ ...EMPTY_DRAFT, parentPageCode: parentPageCode || '' });
    this.modalOpen.set(true);
  }
  openEdit(page: AdminNavPageRecord): void {
    this.editingCode.set(page.pageCode); this.clearMessages();
    this.draft.set({
      label: page.label, entryType: page.entryType, icon: page.icon || '', iconFileName: page.icon ? 'Current icon' : '',
      parentPageCode: page.parentPageCode || '', active: page.active,
    });
    this.modalOpen.set(true);
  }
  handleAction(event: InternalRowActionEvent): void {
    const page = this.navPages().find((item) => item.pageCode === event.record.id);
    if (!page) return;
    if (event.action.key === 'edit') { this.openEdit(page); return; }
    if (event.action.key === 'delete') { this.requestDeletePage(page); return; }
    this.toggleActive(page);
  }
  handleCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'grants') return;
    const page = this.navPages().find((p) => p.pageCode === event.record.id);
    if (page) this.goToPermissionsFor(page);
  }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }

  setLabel(value: string): void { this.draft.update((d) => ({ ...d, label: value })); }
  setEntryType(value: NavEntryType): void {
    this.draft.update((d) => ({ ...d, entryType: value, parentPageCode: value === 'folder' ? '' : d.parentPageCode }));
  }
  setParentPageCode(value: string): void { this.draft.update((d) => ({ ...d, parentPageCode: value })); }
  setActive(value: boolean): void { this.draft.update((d) => ({ ...d, active: value })); }

  onIconFile(file: File): void {
    this.iconError.set('');
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      this.iconError.set('Icon must be an SVG file.');
      return;
    }
    readAsText(file).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (text) => {
        const svg = stripSvgProlog(text);
        if (!/^<svg[\s>]/i.test(svg)) { this.iconError.set('That file does not contain a valid SVG document.'); return; }
        this.draft.update((d) => ({ ...d, icon: svg, iconFileName: file.name }));
      },
      error: () => this.iconError.set('The icon file could not be read.'),
    });
  }
  removeIcon(): void {
    this.iconError.set('');
    this.draft.update((d) => ({ ...d, icon: '', iconFileName: '' }));
  }

  labelError(): string {
    const value = this.draft().label.trim();
    if (!value || this.editingCode()) return '';
    const code = derivePageCode(value);
    if (this.navPages().some((p) => p.pageCode === code)) return 'A page with this derived code already exists — choose a different Label.';
    return '';
  }

  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const code = this.editingCode();
    const d = this.draft();
    const draft: Partial<AdminNavPageDraft> = {
      label: d.label.trim(),
      entryType: d.entryType,
      // Legacy seeded pages carry a Material Symbol ligature name (e.g. "settings") in `icon`
      // rather than SVG markup — resending that verbatim fails server-side sanitizeSvgIcon()
      // (expects a full <svg>...</svg> document) and 400s the save. Only forward `icon` when the
      // draft actually holds SVG markup (freshly uploaded or already-SVG); otherwise omit the
      // field so the existing value is left untouched.
      icon: /^\s*<svg[\s>]/i.test(d.icon) ? d.icon : undefined,
      // sortOrder is never client-supplied — new pages/folders always land at the end of their
      // sibling list, and moving to a different parent re-appends there too (see
      // nextSiblingSortOrder() in admin.routes.js). There is no manual reordering UI.
      parentPageCode: d.entryType === 'page' ? (d.parentPageCode || null) : null,
      active: d.active,
    };

    const request = code ? this.service.updateNavPage(code, draft) : this.service.createNavPage(draft as AdminNavPageDraft);
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.toast.success(`Page ${code ? 'updated' : 'created'} successfully.`);
      },
      error: (err) => this.toast.error('The page could not be saved', apiErrorMessage(err, 'Please try again.')),
    });
  }
  requestDeletePage(page: AdminNavPageRecord): void {
    this.clearMessages();
    this.deleteTarget.set(page);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.service.checkNavPageDeletion(page.pageCode).pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check whether this page can be deleted'),
    });
  }
  cancelDeletePage(): void { if (!this.deletingPage()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDeletePage(): void {
    const target = this.deleteTarget();
    const preview = this.deletePreview();
    if (!target || !preview || !preview.canDelete) return;
    this.deletingPage.set(true);
    this.service.deleteNavPage(target.pageCode).pipe(finalize(() => this.deletingPage.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success('Page deleted', 'It can be restored from the Deleted tab within 7 days.');
      },
      error: (err) => this.toast.error('The page could not be deleted', apiErrorMessage(err, 'Please try again.')),
    });
  }
  toggleActive(page: AdminNavPageRecord): void {
    this.clearMessages();
    this.service.updateNavPage(page.pageCode, { active: !page.active }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`Page is now ${page.active ? 'inactive' : 'active'}.`),
      error: (err) => this.toast.error('The active status could not be changed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  roleLabel(roleCode: string): string { return this.roles().find((r) => r.roleCode === roleCode)?.roleName || roleCode; }
  unitLabel(unitCode: string): string { return this.units().find((u) => u.code === unitCode)?.name || unitCode; }
  grantTypeLabel(type: NavGrantType): string { return GRANT_TYPE_OPTIONS.find((o) => o.value === type)?.label || type; }

  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.label}"` : '';
  }

  // ---------------------------------------------------------------------------
  // Deleted tab — soft-deleted pages, restorable within 7 days.
  // ---------------------------------------------------------------------------
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.deletedPages().map((page) => ({
    id: page.pageCode,
    actionKeys: ['restore', 'purge'],
    cells: {
      identity: { primary: page.label, secondary: page.pageCode },
      deletedAt: { primary: this.formatDate(page.deletedAt) },
      remaining: { primary: page.daysRemaining > 0 ? `${page.daysRemaining} day${page.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: page.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${page.daysRemaining}d left`, title: page.label, identity: page.pageCode, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(page.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(page.permanentDeletionAt)}` }] },
  })));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Deleted pages', paginationLabel: 'Deleted page rows', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted page cards',
    header: {
      title: 'Deleted Pages',
      description: 'Soft-deleted pages are kept for 7 days before being permanently removed (their permissions go with them). Restore a page any time within that window.',
      countLabel: `${this.deletedPages().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'identity', label: 'Page' }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'restore', label: 'Restore', icon: 'restore_from_trash' },
      { key: 'purge', label: 'Delete forever', icon: 'delete_forever' },
    ],
    emptyTitle: 'No deleted pages', emptyDescription: 'Pages you delete will appear here for 7 days before being permanently removed.', pageSizeOptions: [5, 10, 25],
  }));
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'restore') { this.restoreTarget.set({ id: String(event.record.id), label: restoreLabelFor(event.record) }); return; }
    if (event.action.key === 'purge') this.requestPurgePage(String(event.record.id));
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
    if (target) this.restorePage(target.id);
  }

  restorePage(code: string): void {
    this.clearMessages();
    this.restoringCode.set(code);
    this.service.restoreNavPage(code).pipe(finalize(() => this.restoringCode.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Page restored'); this.loadDeleted(); },
      error: (err) => this.toast.error('The page could not be restored', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // Deleted tab — "Delete forever" (purge), immediate and unrecoverable, alongside Restore above.
  // ---------------------------------------------------------------------------
  readonly purgeTargetCode = signal<string | null>(null);
  readonly purgePreview = signal<DeletionPreview | null>(null);
  readonly checkingPurge = signal(false);
  readonly purgingPage = signal(false);
  requestPurgePage(code: string): void {
    this.clearMessages();
    this.purgeTargetCode.set(code);
    // Dependencies are re-checked server-side at purge time, so ask before offering the button.
    this.purgePreview.set(null);
    this.checkingPurge.set(true);
    this.service.checkNavPageDeletion(code).pipe(
      finalize(() => this.checkingPurge.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.purgePreview.set(preview),
      error: () => this.toast.error('Could not check page', 'Please try again.'),
    });
  }
  cancelPurgePage(): void {
    if (!this.purgingPage()) { this.purgeTargetCode.set(null); this.purgePreview.set(null); }
  }
  purgeTargetLabel(): string {
    const code = this.purgeTargetCode();
    const page = code ? this.deletedPages().find((p) => p.pageCode === code) : null;
    return page ? `"${page.label}"` : '';
  }
  confirmPurgePage(): void {
    const code = this.purgeTargetCode();
    if (!code) return;
    this.purgingPage.set(true);
    this.service.purgeNavPage(code).pipe(finalize(() => this.purgingPage.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.purgeTargetCode.set(null); this.purgePreview.set(null); this.toast.success('Page permanently deleted'); this.loadDeleted(); },
      error: (err) => this.toast.error('The page could not be permanently deleted', apiErrorMessage(err, 'Please try again.')),
    });
  }
  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }

  private clearMessages(): void { this.errorMessage.set(''); }
  private pageSlice<T>(records: readonly T[]): readonly T[] { return records.slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()); }
  private pageRecords(): readonly InternalDataRecord[] {
    return this.pageSlice(this.filteredPages()).map(({ page, depth }) => {
      const parent = page.parentPageCode ? this.navPages().find((p) => p.pageCode === page.parentPageCode) : null;
      const grantCount = page.grants.length;
      const grantLabel = grantCount === 0 ? 'No access' : `${grantCount} permission${grantCount === 1 ? '' : 's'}`;
      const indent = depth > 0 ? '— '.repeat(depth) : '';
      return {
        id: page.pageCode,
        actionKeys: ['edit', 'status', 'delete'],
        cells: {
          identity: { primary: `${indent}${page.label}`, secondary: page.pageCode },
          type: { primary: page.entryType === 'folder' ? 'Folder' : 'Page', badge: true, tone: page.entryType === 'folder' ? 'blue' : 'neutral' },
          parent: { primary: parent?.label ?? '—' },
          route: { primary: page.routePath || '—' },
          grants: { primary: grantLabel, badge: true, tone: grantCount ? 'blue' : 'warning', clickable: true, badgeIcon: 'admin_panel_settings' },
          status: { primary: page.active ? 'Active' : 'Inactive', badge: true, tone: page.active ? 'success' : 'neutral' },
          actions: { primary: '' },
        },
        mobile: {
          eyebrow: page.entryType === 'folder' ? 'Folder' : 'Page', status: page.active ? 'Active' : 'Inactive', title: page.label, identity: page.pageCode,
          details: [
            { icon: 'route', text: page.routePath || 'No route' },
            { icon: 'admin_panel_settings', text: grantLabel },
            ...(parent ? [{ icon: 'folder', text: `Inside ${parent.label}` }] : []),
          ],
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions tab — same table shell as the Pages tab (app-internal-data-page), one row per
  // (page, grant) pair. "Add page" opens a modal: pick a page, then add a permission row to it.
  // Each grant is independently typed and OR'd together — see AdminNavPageGrant's comment.
  // ---------------------------------------------------------------------------

  readonly permissionsSearch = signal('');
  readonly permissionsTypeFilter = signal('all');
  readonly permissionsPage = signal(1);
  readonly permissionsPageSize = signal(10);

  readonly permissionRows = computed(() =>
    this.navPages().flatMap((page) => page.grants.map((grant) => ({ page, grant }))),
  );
  readonly filteredPermissionRows = computed(() => {
    const search = this.permissionsSearch().trim().toLowerCase();
    const type = this.permissionsTypeFilter();
    return this.permissionRows().filter(({ page, grant }) =>
      (type === 'all' || grant.grantType === type)
      && (!search || `${page.label} ${page.pageCode}`.toLowerCase().includes(search)),
    );
  });
  readonly permissionsTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredPermissionRows().length / this.permissionsPageSize())));
  readonly permissionRecords = computed<readonly InternalDataRecord[]>(() => this.buildPermissionRecords());
  readonly permissionsConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Page permissions', paginationLabel: 'Permission rows', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Permission cards',
    header: {
      title: 'Permissions',
      description: 'Every permission row for every page — a user sees a page if they match ANY of its rows. Mix as many types as you need on the same page.',
      countLabel: `${this.filteredPermissionRows().length} permission${this.filteredPermissionRows().length === 1 ? '' : 's'}`,
      primaryActionLabel: 'Add page',
    },
    search: { ariaLabel: 'Search permissions by page', placeholder: 'Search by page label or code' },
    columns: [
      { key: 'page', label: 'Page' },
      { key: 'type', label: 'Type' },
      { key: 'grant', label: 'Grants access to' },
      { key: 'status', label: 'Status' },
      { key: 'actions', label: 'Actions', actions: true },
    ],
    actions: [
      { key: 'edit', label: 'Edit permission', icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'remove', label: 'Remove permission', icon: 'delete' },
    ],
    emptyTitle: 'No permissions found', emptyDescription: 'Click "Add page" to grant a page its first permission.', pageSizeOptions: [10, 25, 50],
  }));
  readonly permissionsFilters = computed(() => [
    { key: 'type', ariaLabel: 'Filter by permission type', value: this.permissionsTypeFilter(), options: [{ value: 'all', label: 'All types' }, ...this.grantTypeOptions.map((o) => ({ value: o.value, label: o.label }))] },
  ]);

  setPermissionsSearch(value: string): void { this.permissionsSearch.set(value); this.permissionsPage.set(1); }
  setPermissionsFilter(change: InternalFilterChange): void {
    if (change.key === 'type') this.permissionsTypeFilter.set(change.value);
    this.permissionsPage.set(1);
  }
  resetPermissionsFilters(): void { this.permissionsSearch.set(''); this.permissionsTypeFilter.set('all'); this.permissionsPage.set(1); }
  setPermissionsPage(value: number): void { this.permissionsPage.set(Math.max(1, Math.min(value, this.permissionsTotalPages()))); }
  setPermissionsPageSize(value: number): void { this.permissionsPageSize.set(value); this.permissionsPage.set(1); }

  handlePermissionAction(event: InternalRowActionEvent): void {
    const [pageCode, grantId] = String(event.record.id).split('::');
    if (event.action.key === 'edit') { this.openEditPermission(pageCode, Number(grantId)); return; }
    if (event.action.key === 'status') { this.toggleGrantActive(pageCode, Number(grantId)); return; }
    if (event.action.key === 'remove') this.requestRemoveGrant(pageCode, Number(grantId));
  }

  // Grants have no dependents of their own — nothing can ever block removing one — so this skips
  // the dependency-preview fetch page/unit/role deletes go through, but it still shows the same
  // confirmation dialog with an always-clear preview (requirement: never delete without asking).
  readonly deleteGrantTarget = signal<{ readonly pageCode: string; readonly grantId: number; readonly label: string } | null>(null);
  readonly deletingGrant = signal(false);
  requestRemoveGrant(pageCode: string, grantId: number): void {
    this.clearMessages();
    const page = this.navPages().find((p) => p.pageCode === pageCode);
    const grant = page?.grants.find((g) => g.grantId === grantId);
    if (!page || !grant) return;
    const items = this.grantSummaryItems(grant);
    const label = items.length === 1 ? items[0] : `${items.length} grants on "${page.label}"`;
    this.deleteGrantTarget.set({ pageCode, grantId, label });
  }
  cancelRemoveGrant(): void { if (!this.deletingGrant()) this.deleteGrantTarget.set(null); }
  confirmRemoveGrant(): void {
    const target = this.deleteGrantTarget();
    if (!target) return;
    this.deletingGrant.set(true);
    this.removeGrant(target.pageCode, target.grantId, () => this.deletingGrant.set(false));
  }

  // The individual names a grant row resolves to — 'role': each role name; 'unit': each unit name;
  // 'unit_role': every "role in unit" pair in the row's cross-product. Feeds both the single-item
  // badge label and the popover's list when there's more than one.
  grantSummaryItems(grant: { readonly grantType: NavGrantType; readonly roleCodes: readonly string[]; readonly unitCodes: readonly string[] }): readonly string[] {
    if (grant.grantType === 'role') return grant.roleCodes.map((code) => `${this.roleLabel(code)} · any unit`);
    if (grant.grantType === 'unit') return grant.unitCodes.map((code) => `Anyone in ${this.unitLabel(code)}`);
    // No unit names to list — the grant covers every cafeteria, present and future.
    if (grant.grantType === 'cafeteria') return grant.roleCodes.map((code) => `${this.roleLabel(code)} · all cafeterias`);
    const items: string[] = [];
    for (const roleCode of grant.roleCodes) {
      for (const unitCode of grant.unitCodes) items.push(`${this.roleLabel(roleCode)} in ${this.unitLabel(unitCode)}`);
    }
    return items;
  }

  private toggleGrantActive(pageCode: string, grantId: number): void {
    this.clearMessages();
    const page = this.navPages().find((p) => p.pageCode === pageCode);
    const grant = page?.grants.find((g) => g.grantId === grantId);
    if (!grant) return;
    this.service.setNavPageGrantActive(pageCode, grantId, !grant.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`Permission is now ${grant.active ? 'inactive' : 'active'}.`),
      error: (err) => this.toast.error('The active status could not be changed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private removeGrant(pageCode: string, grantId: number, onDone?: () => void): void {
    this.clearMessages();
    this.service.removeNavPageGrant(pageCode, grantId).pipe(finalize(() => onDone?.()), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.deleteGrantTarget.set(null); this.toast.success('Permission removed', 'It can be restored from the Deleted tab within 7 days.'); },
      error: (err) => this.toast.error('The permission could not be removed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private buildPermissionRecords(): readonly InternalDataRecord[] {
    const start = (this.permissionsPage() - 1) * this.permissionsPageSize();
    return this.filteredPermissionRows().slice(start, start + this.permissionsPageSize()).map(({ page, grant }) => {
      const items = this.grantSummaryItems(grant);
      // Single match: show its name directly as the badge (hover → primary color, like any other
      // clickable badge). Several matches: show a count + share icon instead — clicking either
      // opens the popover (single-item badge opens Edit instead, handled by handlePermissionCellClick).
      const grantLabel = items.length === 1 ? items[0] : items.length === 0 ? 'No access' : `${items.length} grants`;
      return {
        id: `${page.pageCode}::${grant.grantId}`,
        actionKeys: ['edit', 'status', 'remove'],
        cells: {
          page: { primary: page.label, secondary: page.pageCode },
          type: { primary: this.grantTypeLabel(grant.grantType), badge: true, tone: grant.grantType === 'role' ? 'blue' : grant.grantType === 'unit' ? 'success' : grant.grantType === 'cafeteria' ? 'neutral' : 'warning' },
          grant: { primary: grantLabel, badge: true, tone: items.length ? 'blue' : 'warning', clickable: true, badgeIcon: items.length > 1 ? 'share' : undefined },
          status: { primary: grant.active ? 'Active' : 'Inactive', badge: true, tone: grant.active ? 'success' : 'neutral' },
          actions: { primary: '' },
        },
        mobile: {
          eyebrow: this.grantTypeLabel(grant.grantType), status: grant.active ? 'Active' : 'Inactive', title: page.label, identity: page.pageCode,
          details: items.map((item) => ({ icon: 'admin_panel_settings', text: item })),
        },
      };
    });
  }

  // Which permission row's "Grants access to" popover is open (record id, i.e. `${pageCode}::${grantId}`) — null when closed.
  readonly grantPopoverRecordId = signal<string | null>(null);
  readonly grantPopoverItems = computed<readonly string[]>(() => {
    const id = this.grantPopoverRecordId();
    if (!id) return [];
    const [pageCode, grantId] = id.split('::');
    const page = this.navPages().find((p) => p.pageCode === pageCode);
    const grant = page?.grants.find((g) => g.grantId === Number(grantId));
    return grant ? this.grantSummaryItems(grant) : [];
  });
  handlePermissionCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'grant') return;
    const id = String(event.record.id);
    const [pageCode, grantId] = id.split('::');
    const page = this.navPages().find((p) => p.pageCode === pageCode);
    const grant = page?.grants.find((g) => g.grantId === Number(grantId));
    if (!grant) return;
    const items = this.grantSummaryItems(grant);
    // One match: the badge already shows the full answer, so clicking it opens Edit like any
    // other row action shortcut. Several matches: open the popover listing every one instead.
    if (items.length <= 1) { this.openEditPermission(pageCode, Number(grantId)); return; }
    this.grantPopoverRecordId.set(this.grantPopoverRecordId() === id ? null : id);
  }
  closeGrantPopover(): void { this.grantPopoverRecordId.set(null); }

  // ---------------------------------------------------------------------------
  // Add-permission modal — opened by the Permissions tab's "Add page" button. Folder dropdown
  // narrows the Page dropdown below it (defaults to STANDALONE_PAGES_VALUE = top-level pages with
  // no parent, so the common case doesn't require picking a folder first) + the same
  // grant-type/role/unit picker used to add any permission row.
  // ---------------------------------------------------------------------------

  readonly grantModalOpen = signal(false);
  // Set only when editing an existing permission row — save() then PUTs the edited role/unit sets
  // onto this grant instead of POSTing a new row (server has one row per grant_type per page).
  readonly editingGrantId = signal<number | null>(null);
  readonly grantModalFolderCode = signal(STANDALONE_PAGES_VALUE);
  readonly grantModalPageCode = signal('');
  readonly newGrantType = signal<NavGrantType>('role');
  // Multi-select: a row can hold several roles and/or several units at once.
  readonly newGrantRoleCodes = signal<readonly string[]>([]);
  readonly newGrantUnitCodes = signal<readonly string[]>([]);
  readonly grantSaving = signal(false);
  readonly grantError = signal('');
  readonly grantEligibleRoles = signal<readonly AdminRoleRecord[] | null>(null);
  readonly grantEligibleRolesLoading = signal(false);

  // Folders only — offered above the Page dropdown to narrow it down first, since a flat list of
  // every page/folder gets long fast. STANDALONE_PAGES_VALUE stays selected by default (the most
  // common case: pages with no parent).
  readonly grantModalFolderOptions = computed<readonly SelectOption[]>(() => [
    { value: STANDALONE_PAGES_VALUE, label: 'Standalone pages', description: 'Top-level pages with no parent folder' },
    ...this.navPages().filter((p) => p.entryType === 'folder' && p.active).map((p) => ({ value: p.pageCode, label: p.label, description: p.pageCode })),
  ]);
  // Only active pages are offered — matches the rest of the admin surface treating inactive pages
  // as effectively archived. Scoped to whichever folder is currently picked (or top-level pages
  // when STANDALONE_PAGES_VALUE is selected) so the list stays short and easy to search.
  readonly grantModalPageOptions = computed<readonly SelectOption[]>(() => {
    const folder = this.grantModalFolderCode();
    const wantParent = folder === STANDALONE_PAGES_VALUE ? null : folder;
    return this.navPages()
      .filter((p) => p.entryType === 'page' && p.active && (p.parentPageCode || null) === wantParent)
      .map((p) => ({ value: p.pageCode, label: p.label, description: p.pageCode }));
  });
  readonly grantModalPage = computed<AdminNavPageRecord | null>(() => {
    const code = this.effectiveGrantPageCode();
    return code ? this.navPages().find((p) => p.pageCode === code) ?? null : null;
  });
  // 'role' offers flat roles only (a unit-scoped role has no meaning without a unit — same rule
  // the server enforces). 'unit_role' offers whatever's eligible across the currently-picked units
  // (union — see eligibleRolesForUnits' comment in role-eligibility.service.js).
  readonly newGrantRoleOptions = computed<readonly SelectOption[]>(() => {
    if (this.newGrantType() === 'role') return this.flatRoles().map((r) => ({ value: r.roleCode, label: r.roleName }));
    // 'cafeteria' spans every outlet, so its roles come from the fixed cafeteria set rather than
    // from whichever units happen to be picked.
    if (this.newGrantType() === 'cafeteria') {
      return this.roles()
        .filter((r) => CAFETERIA_ROLE_CODES.includes(r.roleCode))
        .map((r) => ({ value: r.roleCode, label: r.roleName }));
    }
    return (this.grantEligibleRoles() ?? []).map((r) => ({ value: r.roleCode, label: r.roleName }));
  });
  readonly newGrantUnitOptions = computed<readonly SelectOption[]>(() => this.activeUnits().map((u) => ({ value: u.code, label: u.name })));
  // The effective target page code: either the explicitly picked page, or — when only a folder is
  // selected and no page is picked — the folder itself (folders need their own grants to be visible).
  readonly effectiveGrantPageCode = computed(() => {
    const page = this.grantModalPageCode();
    if (page) return page;
    const folder = this.grantModalFolderCode();
    return folder !== STANDALONE_PAGES_VALUE ? folder : '';
  });
  readonly newGrantValid = computed(() => {
    if (!this.effectiveGrantPageCode()) return false;
    const type = this.newGrantType();
    if (type === 'role' || type === 'cafeteria') return this.newGrantRoleCodes().length > 0;
    if (type === 'unit') return this.newGrantUnitCodes().length > 0;
    return this.newGrantRoleCodes().length > 0 && this.newGrantUnitCodes().length > 0;
  });

  openAddPermission(): void {
    this.resetGrantModal();
    this.grantModalOpen.set(true);
  }
  // Jumps to the Permissions tab with the add-permission modal already open and pre-scoped to
  // `page` — used by the Pages tab's Permissions-badge click and right after creating a brand-new
  // page (which starts with zero grants).
  goToPermissionsFor(page: AdminNavPageRecord): void {
    this.activeTab.set('permissions');
    this.resetGrantModal();
    this.grantModalFolderCode.set(page.parentPageCode || STANDALONE_PAGES_VALUE);
    this.grantModalPageCode.set(page.pageCode);
    this.grantModalOpen.set(true);
  }
  // Opens the same Add Permission modal pre-filled with an existing row's values. addGrant() below
  // PUTs the edited role/unit sets onto `editingGrantId` when it's set, instead of POSTing a new
  // row (the server allows only one row per grant_type per page).
  openEditPermission(pageCode: string, grantId: number): void {
    const page = this.navPages().find((p) => p.pageCode === pageCode);
    const grant = page?.grants.find((g) => g.grantId === grantId);
    if (!page || !grant) return;
    this.clearMessages();
    this.editingGrantId.set(grantId);
    this.grantModalFolderCode.set(page.parentPageCode || STANDALONE_PAGES_VALUE);
    this.grantModalPageCode.set(page.pageCode);
    this.newGrantType.set(grant.grantType);
    this.newGrantRoleCodes.set(grant.roleCodes);
    this.newGrantUnitCodes.set(grant.unitCodes);
    this.grantEligibleRoles.set(null);
    this.grantError.set('');
    if (grant.grantType === 'unit_role' && grant.unitCodes.length) this.fetchGrantEligibleRoles(grant.unitCodes);
    this.grantModalOpen.set(true);
  }
  closeGrantModal(): void { if (!this.grantSaving()) this.grantModalOpen.set(false); }

  setGrantModalFolderCode(value: string): void {
    this.grantModalFolderCode.set(value || STANDALONE_PAGES_VALUE);
    this.grantModalPageCode.set('');
    this.grantError.set('');
  }
  setGrantModalPageCode(value: string): void { this.grantModalPageCode.set(value); this.grantError.set(''); }
  setNewGrantType(type: NavGrantType): void {
    this.newGrantType.set(type);
    this.newGrantRoleCodes.set([]);
    this.grantEligibleRoles.set(null);
    this.grantError.set('');
  }
  setNewGrantRoleCodes(values: readonly string[]): void { this.newGrantRoleCodes.set(values); }
  setNewGrantUnitCodes(values: readonly string[]): void {
    this.newGrantUnitCodes.set(values);
    this.newGrantRoleCodes.set([]);
    this.grantEligibleRoles.set(null);
    if (this.newGrantType() === 'unit_role' && values.length) this.fetchGrantEligibleRoles(values);
  }
  // "Select all" / "Clear" shortcuts next to each multi-select — picking every currently-offered
  // option is equivalent to "all roles"/"all units" since the row re-evaluates live against
  // whatever roles/units exist, but expressing it as an explicit list (rather than a magic "any"
  // sentinel) keeps the grant row's meaning self-contained and inspectable.
  selectAllGrantRoles(): void { this.setNewGrantRoleCodes(this.newGrantRoleOptions().map((o) => o.value)); }
  selectAllGrantUnits(): void { this.setNewGrantUnitCodes(this.newGrantUnitOptions().map((o) => o.value)); }

  private fetchGrantEligibleRoles(unitCodes: readonly string[]): void {
    this.grantEligibleRolesLoading.set(true);
    this.service.eligibleRolesForUnits(unitCodes).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (roles) => { this.grantEligibleRoles.set(roles); this.grantEligibleRolesLoading.set(false); },
      error: () => this.grantEligibleRolesLoading.set(false),
    });
  }

  addGrant(): void {
    const page = this.grantModalPage();
    if (!page || !this.newGrantValid()) return;
    this.grantSaving.set(true); this.grantError.set('');
    const type = this.newGrantType();
    const editingId = this.editingGrantId();
    const grantDraft = {
      grantType: type,
      roleCodes: type === 'unit' ? undefined : this.newGrantRoleCodes(),
      // 'cafeteria' takes its units from the code prefix, so it sends none.
      unitCodes: type === 'role' || type === 'cafeteria' ? undefined : this.newGrantUnitCodes(),
    };
    const request = editingId
      ? this.service.updateNavPageGrant(page.pageCode, editingId, grantDraft)
      : this.service.addNavPageGrant(page.pageCode, grantDraft);
    request.pipe(finalize(() => this.grantSaving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.grantModalOpen.set(false); this.toast.success(editingId ? 'Permission updated.' : 'Permission added.'); },
      error: (err) => {
        const message = apiErrorMessage(err, 'Please try again.');
        this.grantError.set(message);
        this.toast.error(editingId ? 'The permission could not be updated' : 'The permission could not be added', message);
      },
    });
  }

  private resetGrantModal(): void {
    this.editingGrantId.set(null);
    this.grantModalFolderCode.set(STANDALONE_PAGES_VALUE);
    this.grantModalPageCode.set('');
    this.newGrantType.set('role');
    this.newGrantRoleCodes.set([]);
    this.newGrantUnitCodes.set([]);
    this.grantEligibleRoles.set(null);
    this.grantError.set('');
  }
}
