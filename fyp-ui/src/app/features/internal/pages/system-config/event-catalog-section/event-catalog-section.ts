import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { EventCatalogEntryService } from '../../../../../core/event-catalog/event-catalog.service';
import { EventCatalogEntry } from '../../../../../core/event-catalog/event-catalog.models';
import { DeletionPreview } from '../../../../../shared/models/deletion.models';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { DeleteConfirmDialogComponent } from '../../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';

type SectionTab = 'active' | 'deleted';

// Server-side derivation this mirrors exactly: services/unit-code.js's deriveUnitCode() — same
// lowercase_with_underscores slug convention as unit.code/role.role_code/nav_page.page_code
// (see page-visibility.ts's derivePageCode() for the identical client-side duplicate). Duplicated
// client+server since there's no shared module reachable from both Express CommonJS and Angular TS.
function deriveCatalogCode(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

interface Draft {
  readonly name: string;
  readonly active: boolean;
}
const EMPTY_DRAFT: Draft = { name: '', active: true };

// Shared by both the Event Categories and Event Formats tabs in System Configuration — the two
// entities are structurally identical (id, name, code, active + soft-delete), so one generic
// component avoids duplicating the active-list/deleted-list/add-edit-modal logic twice. Mirrors
// page-visibility.ts's Pages/Deleted tab structure (minus the Permissions tab, which has no
// analog here).
@Component({
  selector: 'app-event-catalog-section',
  imports: [InternalDataPageComponent, FormModalComponent, FormFieldComponent, FeedbackBannerComponent, DeleteConfirmDialogComponent],
  templateUrl: './event-catalog-section.html',
  styleUrl: './event-catalog-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCatalogSectionComponent {
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // The injected catalog service (EventCategoryService or EventFormatService) — both satisfy the
  // same EventCatalogEntryService base, so this component never needs to know which one it has.
  readonly service = input.required<EventCatalogEntryService>();
  // "Event category" / "Event format" — used in headings, aria-labels, and messages.
  readonly entityLabel = input.required<string>();
  readonly entityLabelPlural = input.required<string>();

  readonly activeTab = signal<SectionTab>('active');
  readonly loading = computed(() => this.service().loading());
  readonly errorMessage = signal('');

  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  // Set only when editing an existing entry — its persisted `code`, immutable once created (server
  // never re-derives it on PUT). Null when adding, so the modal's code field falls back to a live
  // preview of the name being typed instead.
  readonly editingCode = signal<string | null>(null);
  readonly draft = signal<Draft>(EMPTY_DRAFT);
  readonly saving = signal(false);

  // Add mode: a live preview of what the code WILL be, updating as the admin types the name.
  // Edit mode: the already-persisted code, which does not change even if the name is edited here
  // (code is immutable once created — see event-catalog.routes.js's PUT handler).
  readonly derivedCode = computed(() => this.editingCode() ?? deriveCatalogCode(this.draft().name));
  readonly formValid = computed(() => !!this.draft().name.trim() && !this.nameError());

  readonly filteredEntries = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.service().entries().filter((entry) => !search || `${entry.name} ${entry.code}`.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredEntries().length / this.pageSize())));
  readonly records = computed<readonly InternalDataRecord[]>(() =>
    this.filteredEntries().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()).map((entry) => ({
      id: entry.id,
      actionKeys: ['edit', 'status', 'delete'],
      cells: {
        name: { primary: entry.name, secondary: entry.code },
        status: { primary: entry.active ? 'Active' : 'Inactive', badge: true, tone: entry.active ? 'success' : 'neutral' },
        actions: { primary: '' },
      },
      mobile: { eyebrow: this.entityLabel(), status: entry.active ? 'Active' : 'Inactive', title: entry.name, identity: entry.code, details: [] },
    })),
  );
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.entityLabelPlural(), paginationLabel: `${this.entityLabelPlural()} pages`, rowsPerPageLabel: `${this.entityLabelPlural()} per page`, mobileListLabel: `${this.entityLabelPlural()} cards`,
    header: {
      title: this.entityLabelPlural(),
      description: `These ${this.entityLabelPlural().toLowerCase()} are used in the Event Proposal form and the Explore Events filters.`,
      countLabel: `${this.filteredEntries().length} ${this.filteredEntries().length === 1 ? this.entityLabel().toLowerCase() : this.entityLabelPlural().toLowerCase()}`,
      primaryActionLabel: `Add ${this.entityLabel().toLowerCase()}`,
    },
    search: { ariaLabel: `Search ${this.entityLabelPlural().toLowerCase()}`, placeholder: 'Search name or code' },
    columns: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'edit', label: `Edit ${this.entityLabel().toLowerCase()}`, icon: 'edit' },
      { key: 'status', label: 'Change active status', icon: 'power_settings_new' },
      { key: 'delete', label: `Delete ${this.entityLabel().toLowerCase()}`, icon: 'delete' },
    ],
    emptyTitle: `No ${this.entityLabelPlural().toLowerCase()} found`, emptyDescription: `Add a ${this.entityLabel().toLowerCase()} or change the current search.`, pageSizeOptions: [5, 10, 25],
  }));

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  resetSearch(): void { this.search.set(''); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(): void {
    this.editingId.set(null);
    this.editingCode.set(null);
    this.draft.set(EMPTY_DRAFT);
    this.modalOpen.set(true);
    this.clearMessages();
  }
  handleAction(event: InternalRowActionEvent): void {
    const entry = this.service().entries().find((e) => e.id === event.record.id);
    if (!entry) return;
    if (event.action.key === 'edit') {
      this.editingId.set(entry.id);
      this.editingCode.set(entry.code);
      this.draft.set({ name: entry.name, active: entry.active });
      this.modalOpen.set(true);
      this.clearMessages();
      return;
    }
    if (event.action.key === 'delete') { this.requestDelete(entry); return; }
    this.toggleActive(entry);
  }
  setDraftName(value: string): void { this.draft.update((d) => ({ ...d, name: value })); }
  setDraftActive(value: boolean): void { this.draft.update((d) => ({ ...d, active: value })); }

  nameError(): string {
    const value = this.draft().name.trim().toLowerCase();
    if (!value) return '';
    const id = this.editingId();
    const clashes = this.service().entries().some((e) => e.id !== id && e.name.toLowerCase() === value);
    return clashes ? `A ${this.entityLabel().toLowerCase()} with this name already exists.` : '';
  }

  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }

  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearMessages();
    const id = this.editingId();
    const draft = { name: this.draft().name.trim(), active: this.draft().active };
    const request = id ? this.service().update(id, draft) : this.service().create(draft);
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.toast.success(`${this.entityLabel()} ${id ? 'updated' : 'created'} successfully.`);
      },
      error: (err) => this.toast.error(err?.error?.message || `The ${this.entityLabel().toLowerCase()} could not be saved.`),
    });
  }

  toggleActive(entry: EventCatalogEntry): void {
    this.clearMessages();
    this.service().setActive(entry.id, !entry.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`${this.entityLabel()} is now ${entry.active ? 'inactive' : 'active'}.`),
      error: (err) => this.toast.error('The active status could not be changed', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // Delete (soft) / Deleted tab / Restore / Delete forever (purge) — mirrors page-visibility.ts's
  // deleteTarget/deletePreview/deletedPages structure.
  // ---------------------------------------------------------------------------
  readonly deleteTarget = signal<EventCatalogEntry | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);

  readonly deletedLoading = computed(() => this.service().deletedLoading());
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.service().deletedEntries().map((entry) => ({
    id: entry.id,
    actionKeys: ['restore', 'purge'],
    cells: {
      identity: { primary: entry.name, secondary: entry.code },
      deletedAt: { primary: this.formatDate(entry.deletedAt) },
      remaining: { primary: entry.daysRemaining > 0 ? `${entry.daysRemaining} day${entry.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: entry.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: `Deleted ${this.entityLabel()}`, status: `${entry.daysRemaining}d left`, title: entry.name, identity: entry.code, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(entry.deletedAt)}` }] },
  })));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `Deleted ${this.entityLabelPlural()}`, paginationLabel: `Deleted ${this.entityLabelPlural()} rows`, rowsPerPageLabel: 'Rows per page', mobileListLabel: `Deleted ${this.entityLabelPlural()} cards`,
    header: {
      title: `Deleted ${this.entityLabelPlural()}`,
      description: 'Soft-deleted entries are kept for 7 days before being permanently removed. Restore one any time within that window, or delete it forever right away.',
      countLabel: `${this.service().deletedEntries().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'identity', label: this.entityLabel() }, { key: 'deletedAt', label: 'Deleted' }, { key: 'remaining', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [
      { key: 'restore', label: 'Restore', icon: 'restore_from_trash' },
      { key: 'purge', label: 'Delete forever', icon: 'delete_forever' },
    ],
    emptyTitle: `No deleted ${this.entityLabelPlural().toLowerCase()}`, emptyDescription: `${this.entityLabelPlural()} you delete will appear here for 7 days before being permanently removed.`, pageSizeOptions: [5, 10, 25],
  }));

  setTab(tab: SectionTab): void {
    this.activeTab.set(tab);
    this.clearMessages();
    if (tab === 'deleted') this.service().loadDeleted();
  }

  requestDelete(entry: EventCatalogEntry): void {
    this.clearMessages();
    this.deleteTarget.set(entry);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.service().checkDeletion(entry.id).pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error(`Could not check whether this ${this.entityLabel().toLowerCase()} can be deleted.`),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const target = this.deleteTarget();
    const preview = this.deletePreview();
    if (!target || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.service().delete(target.id).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success(`${this.entityLabel()} deleted. It can be restored from the Deleted tab within 7 days.`);
      },
      error: (err) => this.toast.error(err?.error?.message || `The ${this.entityLabel().toLowerCase()} could not be deleted.`),
    });
  }
  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.name}"` : '';
  }

  readonly restoringId = signal<string | null>(null);
  handleDeletedAction(event: InternalRowActionEvent): void {
    const id = String(event.record.id);
    if (event.action.key === 'restore') { this.restore(id); return; }
    if (event.action.key === 'purge') this.requestPurge(id);
  }
  restore(id: string): void {
    this.clearMessages();
    this.restoringId.set(id);
    this.service().restore(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`${this.entityLabel()} restored.`),
      error: (err) => this.toast.error(err?.error?.message || `The ${this.entityLabel().toLowerCase()} could not be restored.`),
    });
  }

  readonly purgeTargetId = signal<string | null>(null);
  readonly purgePreview = signal<DeletionPreview | null>(null);
  readonly checkingPurge = signal(false);
  readonly purging = signal(false);
  requestPurge(id: string): void {
    this.clearMessages();
    this.purgeTargetId.set(id);
    // Dependencies are re-checked server-side at purge time, so ask before offering the button.
    this.purgePreview.set(null);
    this.checkingPurge.set(true);
    this.service().checkDeletion(id).pipe(
      finalize(() => this.checkingPurge.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => this.purgePreview.set(preview),
      error: () => this.toast.error('Could not check entry', 'Please try again.'),
    });
  }
  cancelPurge(): void {
    if (!this.purging()) { this.purgeTargetId.set(null); this.purgePreview.set(null); }
  }
  purgeTargetLabel(): string {
    const id = this.purgeTargetId();
    const entry = id ? this.service().deletedEntries().find((e) => e.id === id) : null;
    return entry ? `"${entry.name}"` : '';
  }
  confirmPurge(): void {
    const id = this.purgeTargetId();
    if (!id) return;
    this.purging.set(true);
    this.service().purge(id).pipe(finalize(() => this.purging.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.purgeTargetId.set(null);
        this.purgePreview.set(null);
        this.toast.success(`${this.entityLabel()} permanently deleted.`);
      },
      error: (err) => this.toast.error(err?.error?.message || `The ${this.entityLabel().toLowerCase()} could not be permanently deleted.`),
    });
  }

  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  private clearMessages(): void { this.errorMessage.set(''); }
}
