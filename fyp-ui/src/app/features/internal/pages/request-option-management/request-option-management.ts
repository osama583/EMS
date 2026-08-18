import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { managerOptionKinds } from '../../../../core/request-options/request-option.permissions';
import { ArchivedRequestOption, RequestOption, RequestOptionDraft, RequestOptionKind } from '../../../../core/request-options/request-option.models';
import { RequestOptionService } from '../../../../core/request-options/request-option.service';
import { DeletionPreview } from '../../../../shared/models/deletion.models';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DeleteConfirmDialogComponent } from '../../../../shared/components/delete-confirm-dialog/delete-confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalFilterControlsComponent, InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalPageHeaderConfig, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { SearchableDropdownComponent } from '../../../../shared/components/searchable-dropdown/searchable-dropdown';
import { StatusToggleComponent } from '../../../../shared/components/status-toggle/status-toggle';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { OptionCardGridComponent } from '../../../../shared/components/option-card-grid/option-card-grid';
import { OptionCardViewModel } from '../../../../shared/components/option-card-grid/option-card-grid.models';
import { OptionItemDetailsModalComponent } from '../../../../shared/components/option-item-details-modal/option-item-details-modal';

interface ManagerField {
  readonly key: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'number' | 'select';
  readonly required?: boolean;
  readonly min?: number;
  readonly options?: readonly SelectOption[];
  readonly placeholder?: string;
}

const KIND_LABELS: Readonly<Record<RequestOptionKind, string>> = {
  logistics: 'Logistics', transportation: 'Transportation', photoVideo: 'Photographer / Videographer', soundLight: 'Sound & Light', fmb: 'My Menu',
  dietaryInformation: 'Dietary Information', servingUnit: 'Serving Unit',
  campusTourStart: 'Campus Tour — Starting Points', campusTourType: 'Campus Tour — Types of Tour', waterNormal: 'Mineral Water',
  fundingMain: 'Funding — Main Items', fundingSub: 'Funding — Sub-items',
};

import { ImageUploadFieldComponent } from '../../../../shared/components/image-upload-field/image-upload-field';
import { ViewToggleComponent } from '../../../../shared/components/view-toggle/view-toggle';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';

const CAFETERIA_OPTION_KINDS: readonly RequestOptionKind[] = ['fmb', 'servingUnit'];

// The deleted-items table names its first column differently per page (identity / name / label),
// so the confirmation reads whichever cell actually carries the record's display name.
function restoreLabelFor(record: InternalDataRecord): string {
  const named = Object.values(record.cells).find((cell) => !!cell?.primary);
  return named?.primary ? String(named.primary) : String(record.id);
}

@Component({
  selector: 'app-request-option-management',
  imports: [
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent, FeedbackBannerComponent,
    ConfirmDialogComponent, DeleteConfirmDialogComponent, OptionCardGridComponent, OptionItemDetailsModalComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent, ImageUploadFieldComponent, ViewToggleComponent,
  ],
  templateUrl: './request-option-management.html',
  styleUrl: './request-option-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestOptionManagementComponent {
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly optionService = inject(RequestOptionService);
  private readonly destroyRef = inject(DestroyRef);
  readonly cafeteriaPage = this.route.snapshot.data['optionPage'] === 'menu';
  private readonly explicitKind = this.route.snapshot.data['optionKind'] as RequestOptionKind | undefined;
  private readonly managerKinds = managerOptionKinds(this.auth.user()!);
  readonly permittedKinds: readonly RequestOptionKind[] = this.cafeteriaPage
    ? this.managerKinds.filter((kind) => kind === 'fmb')
    : this.explicitKind && this.managerKinds.includes(this.explicitKind)
      ? [this.explicitKind]
      : this.managerKinds.filter((kind) => !CAFETERIA_OPTION_KINDS.includes(kind));
  readonly loadedKinds: readonly RequestOptionKind[] = Array.from(new Set<RequestOptionKind>([
    ...this.permittedKinds,
    ...(this.cafeteriaPage ? ['servingUnit', 'dietaryInformation'] as const : []),
    ...(this.explicitKind === 'fundingSub' ? ['fundingMain'] as const : []),
  ]));
  readonly selectedKind = signal<RequestOptionKind>(this.permittedKinds[0]);
  readonly allOptions = signal<readonly RequestOption[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly search = signal('');
  readonly statusFilter = signal('all');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<Record<string, string | number | boolean>>({});
  readonly errorMessage = signal('');
  readonly imageError = signal('');
  readonly viewMode = signal<'table' | 'card'>('table');
  readonly deleteTarget = signal<RequestOption | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);
  readonly detailsTarget = signal<OptionCardViewModel | null>(null);

  // Deleted view — a simple toggle rather than a third page mode, since this page already has a
  // table/card toggle per kind; showing deleted options replaces the active list in place.
  readonly showDeleted = signal(false);
  readonly deletedOptions = signal<readonly ArchivedRequestOption[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringId = signal<string | null>(null);

  // Cafeteria Manager only manages their OWN cafeteria's menu items (the 'cafeteria-manager'
  // role, surfaced on the user as cafeteriaCode) — servingUnit/dietaryInformation stay
  // global/shared so this filter only bites for kind === 'fmb'.
  private readonly ownCafeteriaCode = this.auth.user()?.cafeteriaCode;
  readonly currentOptions = computed(() => this.allOptions().filter((option) =>
    option.kind === this.selectedKind()
    && (option.kind !== 'fmb' || this.ownCafeteriaCode === undefined || option.cafeteriaCode === this.ownCafeteriaCode),
  ));
  readonly filteredOptions = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.currentOptions().filter((option) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === option.active)
      && (!search || `${option.label} ${option.description ?? ''} ${this.details(option)}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredOptions().length / this.pageSize())));
  readonly visibleOptions = computed(() => this.filteredOptions().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  readonly showCardToggle = computed(() => ['fmb', 'logistics', 'transportation'].includes(this.selectedKind()));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleOptions().map((option) => ({
    id: option.id,
    cells: {
      name: { primary: option.label, secondary: option.description },
      details: { primary: this.details(option) || 'No additional details' },
      status: { primary: option.active ? 'Active' : 'Inactive', badge: true, tone: option.active ? 'success' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: {
      eyebrow: KIND_LABELS[option.kind], status: option.active ? 'Active' : 'Inactive', title: option.label,
      details: [{ icon: 'info', text: this.details(option) || 'No additional details' }],
    },
    actionKeys: ['fmb', 'logistics', 'transportation'].includes(option.kind) ? ['edit', 'status', 'delete'] : ['edit', 'status'],
  })));
  readonly menuCardData = computed<readonly OptionCardViewModel[]>(() =>
    this.visibleOptions().map((option) => this.toCardViewModel(option)),
  );
  readonly fields = computed(() => this.fieldsFor(this.selectedKind()));
  readonly formValid = computed(() => this.fields().filter((field) => field.required).every((field) => {
    const value = this.draft()[field.key];
    return field.type === 'number' ? value !== '' && value !== undefined && Number(value) >= (field.min ?? 0) : Boolean(String(value ?? '').trim());
  }));
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `${KIND_LABELS[this.selectedKind()]} options`, paginationLabel: 'Option pages', rowsPerPageLabel: 'Options per page', mobileListLabel: 'Option cards',
    header: {
      title: this.cafeteriaPage ? 'My Menu' : this.permittedKinds.length === 1 ? KIND_LABELS[this.selectedKind()] : 'Dropdown Box Options',
      description: this.cafeteriaPage
        ? 'Manage menu items and the serving units available when adding a menu item.'
        : this.selectedKind() === 'dietaryInformation'
          ? 'Manage the dietary information applicants and cafeteria teams can select for menu items.'
          : 'Manage the options and operational information available in applicant request popups.',
      countLabel: `${this.filteredOptions().length} option${this.filteredOptions().length === 1 ? '' : 's'}`,
      primaryActionLabel: this.selectedKind() === 'fmb' ? 'Add menu item' : this.selectedKind() === 'servingUnit' ? 'Add serving unit' : this.selectedKind() === 'dietaryInformation' ? 'Add dietary information' : 'Add option',
    },
    search: { ariaLabel: 'Search options', placeholder: 'Search option name or details' },
    columns: [{ key: 'name', label: 'Option' }, { key: 'details', label: 'Configuration' }, { key: 'status', label: 'Status' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'edit', label: 'Edit option', icon: 'edit' }, { key: 'status', label: 'Change active status', icon: 'power_settings_new' }, { key: 'delete', label: 'Delete option', icon: 'delete' }],
    emptyTitle: 'No options found', emptyDescription: 'Add an option or change the search and status filters.', pageSizeOptions: [5, 10, 25],
  }));
  readonly cardHeaderConfig = computed<InternalPageHeaderConfig>(() => ({
    title: this.config().header.title,
    description: this.config().header.description,
  }));
  readonly deletedConfig = computed<InternalDataPageConfig>(() => ({
    ariaLabel: `Deleted ${KIND_LABELS[this.selectedKind()]} options`, paginationLabel: 'Deleted option pages', rowsPerPageLabel: 'Rows per page', mobileListLabel: 'Deleted option cards',
    header: {
      title: `Deleted ${KIND_LABELS[this.selectedKind()]}`,
      description: 'Soft-deleted options are kept for 7 days before being permanently removed. Restore an option any time within that window.',
      countLabel: `${this.currentDeletedOptions().length} deleted`,
    },
    search: { ariaLabel: '', placeholder: '' },
    columns: [{ key: 'name', label: 'Option' }, { key: 'details', label: 'Deleted' }, { key: 'status', label: 'Permanent deletion' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'restore', label: 'Restore', icon: 'restore_from_trash' }],
    emptyTitle: 'No deleted options', emptyDescription: 'Options you delete will appear here for 7 days before being permanently removed.', pageSizeOptions: [5, 10, 25],
  }));
  readonly filters = computed(() => [
    ...(this.permittedKinds.length > 1 ? [{
      key: 'kind', ariaLabel: 'Filter by option type', value: this.selectedKind(),
      options: this.permittedKinds.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
    }] : []),
    {
      key: 'status', ariaLabel: 'Filter options by status', value: this.statusFilter(),
      options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
    },
  ]);

  constructor() {
    this.optionService.watchAll(this.loadedKinds).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => { this.allOptions.set(options); this.loading.set(false); },
      error: () => { this.errorMessage.set('Options could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'kind' && this.permittedKinds.includes(change.value as RequestOptionKind)) this.selectedKind.set(change.value as RequestOptionKind);
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }
  reset(): void { this.search.set(''); this.statusFilter.set('all'); this.selectedKind.set(this.permittedKinds[0]); this.page.set(1); }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }
  openAdd(): void { this.editingId.set(null); this.draft.set(this.emptyDraft(this.selectedKind())); this.imageError.set(''); this.modalOpen.set(true); this.clearNotices(); }
  handleAction(event: InternalRowActionEvent): void {
    const option = this.allOptions().find((item) => item.id === event.record.id);
    if (!option) return;
    if (event.action.key === 'edit') { this.editingId.set(option.id); this.draft.set({ ...option }); this.imageError.set(''); this.modalOpen.set(true); this.clearNotices(); return; }
    if (event.action.key === 'delete') { this.requestDelete(option); return; }
    this.changeStatus(option);
  }
  setViewMode(mode: 'table' | 'card'): void { this.viewMode.set(mode); }
  editMenuItem(id: string): void {
    const option = this.allOptions().find((item) => item.id === id);
    if (!option) return;
    this.editingId.set(option.id); this.draft.set({ ...option }); this.imageError.set(''); this.modalOpen.set(true); this.clearNotices();
  }
  toggleMenuItemActive(id: string): void {
    const option = this.allOptions().find((item) => item.id === id);
    if (option) this.changeStatus(option);
  }
  deleteMenuItem(id: string): void {
    const option = this.allOptions().find((item) => item.id === id);
    if (option) this.requestDelete(option);
  }
  viewMenuItemDetails(id: string): void {
    const option = this.allOptions().find((item) => item.id === id);
    if (option) this.detailsTarget.set(this.toCardViewModel(option));
  }
  requestDelete(option: RequestOption): void {
    this.clearNotices();
    this.deleteTarget.set(option);
    this.deletePreview.set(null);
    this.checkingDeletion.set(true);
    this.optionService.checkDeletion(option.id).pipe(finalize(() => this.checkingDeletion.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (preview) => this.deletePreview.set(preview),
      error: () => this.toast.error('Could not check whether this option can be deleted'),
    });
  }
  cancelDelete(): void { if (!this.deleting()) { this.deleteTarget.set(null); this.deletePreview.set(null); } }
  confirmDelete(): void {
    const option = this.deleteTarget();
    const preview = this.deletePreview();
    if (!option || !preview || !preview.canDelete) return;
    this.deleting.set(true);
    this.optionService.delete(option.id).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deleteTarget.set(null); this.deletePreview.set(null);
        this.toast.success(`${option.label} was deleted. It can be restored within 7 days.`);
      },
      error: (err) => this.toast.error('The option could not be deleted', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // ---------------------------------------------------------------------------
  // Deleted view
  // ---------------------------------------------------------------------------
  // Options | Deleted is a PAGE-level section switch, so it renders as the shared tab strip above
  // the page title (same treatment as Users/Assignments/Deleted on the Admin Directory) rather
  // than as a button in the header row. Tabs set the section directly instead of flipping it.
  setDeletedTab(deleted: boolean): void {
    if (this.showDeleted() === deleted) return;
    this.showDeleted.set(deleted);
    this.clearNotices();
    if (deleted) this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.optionService.getDeleted().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => this.deletedOptions.set(options),
      error: () => this.errorMessage.set('The deleted options could not be loaded.'),
    });
  }
  readonly currentDeletedOptions = computed(() => this.deletedOptions().filter((option) => option.kind === this.selectedKind()));
  readonly deletedRecords = computed<readonly InternalDataRecord[]>(() => this.currentDeletedOptions().map((option) => ({
    id: option.id,
    actionKeys: ['restore'],
    cells: {
      name: { primary: option.label, secondary: option.description },
      details: { primary: `Deleted ${this.formatDate(option.deletedAt)}` },
      status: { primary: option.daysRemaining > 0 ? `${option.daysRemaining} day${option.daysRemaining === 1 ? '' : 's'} left` : 'Due for permanent deletion', badge: true, tone: option.daysRemaining <= 1 ? 'warning' : 'neutral' },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Deleted', status: `${option.daysRemaining}d left`, title: option.label, details: [{ icon: 'schedule', text: `Deleted ${this.formatDate(option.deletedAt)}` }, { icon: 'delete_forever', text: `Permanently deleted ${this.formatDate(option.permanentDeletionAt)}` }] },
  })));
  handleDeletedAction(event: InternalRowActionEvent): void {
    if (event.action.key === 'restore') { this.restoreTarget.set({ id: String(event.record.id), label: restoreLabelFor(event.record) }); return; }
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
    if (target) this.restoreOption(target.id);
  }

  restoreOption(id: string): void {
    this.clearNotices();
    this.restoringId.set(id);
    this.optionService.restore(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Option restored'); this.loadDeleted(); },
      error: (err) => this.toast.error('The option could not be restored', apiErrorMessage(err, 'Please try again.')),
    });
  }
  private formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  closeDetails(): void { this.detailsTarget.set(null); }
  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }
  setDraft(key: string, value: string | boolean): void {
    const field = this.fields().find((item) => item.key === key);
    this.draft.update((draft) => ({ ...draft, [key]: field?.type === 'number' ? (value === '' ? '' : Number(value)) : value }));
  }
  save(): void {
    if (!this.formValid()) return;
    this.saving.set(true); this.clearNotices();
    const id = this.editingId();
    const request = id ? this.optionService.update(id, this.draft() as unknown as RequestOptionDraft) : this.optionService.create(this.draft() as unknown as RequestOptionDraft);
    request.pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.modalOpen.set(false); this.toast.success(id ? 'Option updated successfully.' : 'Option added successfully.'); },
      error: () => this.toast.error('The option could not be saved', 'Please try again.'),
    });
  }
  fieldValue(key: string): string | number { const value = this.draft()[key]; return typeof value === 'boolean' ? '' : value ?? ''; }
  fieldOptions(field: ManagerField): readonly SelectOption[] { return field.options ?? []; }
  kindLabel(kind: RequestOptionKind): string { return KIND_LABELS[kind]; }
  imagePreview(): string { return String(this.draft()['imageDataUrl'] ?? ''); }
  imageFileName(): string { return String(this.draft()['imageFileName'] ?? ''); }
  supportsImage(): boolean { return ['fmb', 'logistics', 'transportation'].includes(this.selectedKind()); }
  imageFieldLabel(): string {
    switch (this.selectedKind()) {
      case 'logistics': return 'Logistics Item Image';
      case 'transportation': return 'Vehicle / Transport Image';
      default: return 'Menu Image';
    }
  }
  imageEmptyMessage(): string {
    switch (this.selectedKind()) {
      case 'logistics': return 'Add a picture for this logistics item';
      case 'transportation': return 'Add a picture for this transport option';
      default: return 'Add a picture for this menu item';
    }
  }

  selectImageFile(file: File): void {
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.imageError.set('Select a valid image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { this.imageError.set(`${this.imageFieldLabel()} must be 5 MB or smaller.`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      this.draft.update((draft) => ({ ...draft, imageDataUrl: String(reader.result ?? ''), imageFileName: file.name }));
      this.imageError.set('');
    };
    reader.onerror = () => this.imageError.set('The image could not be read. Please choose another file.');
    reader.readAsDataURL(file);
  }

  selectImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.selectImageFile(file);
  }

  removeImage(): void {
    this.draft.update((draft) => ({ ...draft, imageDataUrl: '', imageFileName: '' }));
    this.imageError.set('');
  }

  private changeStatus(option: RequestOption): void {
    this.clearNotices();
    this.optionService.setActive(option.id, !option.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(`${option.label} is now ${option.active ? 'inactive' : 'active'}.`),
      error: () => this.toast.error('The option status could not be changed'),
    });
  }
  private clearNotices(): void { this.errorMessage.set(''); }
  private emptyDraft(kind: RequestOptionKind): Record<string, string | number | boolean> {
    const draft: Record<string, string | number | boolean> = { kind, label: '', description: '', active: true };
    if (kind === 'fmb' && this.auth.user()?.cafeteriaCode !== undefined) draft['cafeteriaCode'] = this.auth.user()!.cafeteriaCode!;
    this.fieldsFor(kind).forEach((field) => { if (!(field.key in draft)) draft[field.key] = field.type === 'number' ? '' : ''; });
    return draft;
  }
  private fieldsFor(kind: RequestOptionKind): readonly ManagerField[] {
    const common: readonly ManagerField[] = [{ key: 'label', label: kind === 'fmb' ? 'Food or Service Type' : 'Option Name', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'textarea' }];
    const specific: Readonly<Record<RequestOptionKind, readonly ManagerField[]>> = {
      logistics: [{ key: 'availableQuantity', label: 'Available Quantity', type: 'number', required: true, min: 0 }, { key: 'quantityUnit', label: 'Quantity Unit', type: 'text', required: true }],
      transportation: [{ key: 'passengerCapacity', label: 'Passenger Capacity', type: 'number', required: true, min: 1 }, { key: 'availableVehicles', label: 'Available Vehicle Count', type: 'number', required: true, min: 0 }, { key: 'instructions', label: 'Instructions', type: 'textarea' }],
      photoVideo: [],
      soundLight: [
        { key: 'setupRequirements', label: 'Technical Description / Setup Requirements', type: 'textarea', required: true },
      ],
      fmb: [
        { key: 'servingUnitId', label: 'Serving Unit', type: 'select', required: true, options: this.managedSelectOptions('servingUnit') },
        { key: 'orderingNotes', label: 'Availability / Ordering Notes', type: 'textarea' },
        { key: 'dietaryInformationId', label: 'Dietary Information', type: 'select', required: true, options: this.managedSelectOptions('dietaryInformation') },
      ],
      dietaryInformation: [],
      servingUnit: [],
      campusTourStart: [{ key: 'meetingInstructions', label: 'Meeting Instructions', type: 'textarea' }, { key: 'maximumGroupSize', label: 'Maximum Group Size', type: 'number', min: 1 }],
      campusTourType: [],
      waterNormal: [
        { key: 'bottleCount', label: 'Number of Bottles', type: 'number', required: true, min: 0 },
        { key: 'availableStock', label: 'Available Stock', type: 'number', required: true, min: 0 },
        { key: 'orderingInstructions', label: 'Ordering / Delivery Instructions', type: 'textarea' },
        { key: 'brandingRequirement', label: 'Logo / Branding Requirement (if requested with logo)', type: 'textarea' },
      ],
      fundingMain: [{ key: 'financeCode', label: 'Budget Category / Finance Code', type: 'text' }, { key: 'purchasingGuidance', label: 'Purchasing Guidance', type: 'textarea' }],
      fundingSub: [{ key: 'parentId', label: 'Parent Main Item', type: 'select', required: true, options: this.allOptions().filter((option) => option.kind === 'fundingMain').map((option) => ({ value: option.id, label: option.label })) }, { key: 'financeCode', label: 'Finance / Procurement Code', type: 'text' }, { key: 'purchasingNote', label: 'Default Unit / Purchasing Note', type: 'textarea' }],
    };
    return [...common, ...specific[kind]];
  }
  private details(option: RequestOption): string {
    switch (option.kind) {
      case 'logistics': return [`${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'} available`, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'transportation': return [`${option.passengerCapacity} passengers`, `${option.availableVehicles} vehicle(s)`, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'photoVideo': return option.description ?? '';
      case 'soundLight': return option.setupRequirements ?? '';
      case 'fmb': return [this.optionLabel(option.servingUnitId), this.optionLabel(option.dietaryInformationId), option.orderingNotes, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'dietaryInformation': case 'servingUnit': return option.description ?? '';
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum ${option.maximumGroupSize}` : '', option.meetingInstructions].filter(Boolean).join(' · ');
      case 'campusTourType': return option.description ?? '';
      case 'waterNormal': return [`${option.bottleCount || 'Custom'} bottles`, `${option.availableStock} in stock`, option.brandingRequirement ? 'Logo option available' : ''].filter(Boolean).join(' · ');
      case 'fundingMain': return [option.financeCode, option.purchasingGuidance].filter(Boolean).join(' · ');
      case 'fundingSub': return [this.allOptions().find((item) => item.id === option.parentId)?.label, option.financeCode].filter(Boolean).join(' · ');
    }
  }

  private managedSelectOptions(kind: RequestOptionKind): readonly SelectOption[] {
    return this.allOptions()
      .filter((option) => option.kind === kind && option.active)
      .map((option) => ({ value: option.id, label: option.label, description: option.description }));
  }

  private optionLabel(id: string | undefined): string {
    return id ? this.allOptions().find((option) => option.id === id)?.label ?? id : '';
  }

  private toCardViewModel(option: RequestOption): OptionCardViewModel {
    const base = {
      id: option.id,
      label: option.label,
      description: option.description ?? '',
      active: option.active,
      imageDataUrl: option.imageDataUrl ?? '',
      imageFileName: option.imageFileName ?? '',
    };
    switch (option.kind) {
      case 'fmb':
        const unit = this.optionLabel(option.servingUnitId);
        const dietary = this.optionLabel(option.dietaryInformationId);
        return {
          ...base,
          servingUnitLabel: unit,
          dietaryInformationLabel: dietary,
          orderingNotes: option.orderingNotes ?? '',
          metaFields: [
            ...(unit ? [{ label: 'Serving unit', value: unit, icon: 'restaurant', isBadge: true, badgeTone: 'blue' as const }] : []),
            ...(dietary ? [{ label: 'Dietary info', value: dietary, icon: 'nutrition', isBadge: true, badgeTone: 'emerald' as const }] : []),
            ...(option.orderingNotes ? [{ label: 'Ordering notes', value: option.orderingNotes, icon: 'notes', isNotes: true }] : []),
          ],
        };
      case 'logistics':
        return {
          ...base,
          metaFields: [
            { label: 'Available quantity', value: `${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'}`, icon: 'inventory_2', isBadge: true, badgeTone: 'blue' as const },
          ],
        };
      case 'transportation':
        return {
          ...base,
          metaFields: [
            { label: 'Capacity', value: `${option.passengerCapacity} passengers`, icon: 'group', isBadge: true, badgeTone: 'blue' as const },
            { label: 'Vehicles', value: `${option.availableVehicles} vehicle(s)`, icon: 'directions_bus', isBadge: true, badgeTone: 'emerald' as const },
            ...(option.instructions ? [{ label: 'Instructions', value: option.instructions, icon: 'article', isNotes: true }] : []),
          ],
        };
      default:
        return {
          ...base,
          metaFields: [],
        };
    }
  }
}
