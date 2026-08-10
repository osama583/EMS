import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { managerOptionKinds } from '../../../../core/request-options/request-option.permissions';
import { RequestOption, RequestOptionDraft, RequestOptionKind } from '../../../../core/request-options/request-option.models';
import { RequestOptionService } from '../../../../core/request-options/request-option.service';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { SelectOption } from '../../../../shared/components/form-controls/form-controls.models';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
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
  logistics: 'Logistics', transportation: 'Transportation', photoVideo: 'Photographer / Videographer', soundLight: 'Sound & Light', fnb: 'My Menu',
  dietaryInformation: 'Dietary Information', servingUnit: 'Serving Unit',
  campusTourStart: 'Campus Tour — Starting Points', campusTourArea: 'Campus Tour — Tour Areas', campusTourMap: 'Campus Map Information', waterLogo: 'Mineral Water with Logo', waterNormal: 'Mineral Water Normal',
  fundingMain: 'Funding — Main Items', fundingSub: 'Funding — Sub-items',
};

import { ImageUploadFieldComponent } from '../../../../shared/components/image-upload-field/image-upload-field';

const CAFETERIA_OPTION_KINDS: readonly RequestOptionKind[] = ['fnb', 'servingUnit'];

@Component({
  selector: 'app-request-option-management',
  imports: [
    InternalDataPageComponent, FormModalComponent, FormFieldComponent, SearchableDropdownComponent, StatusToggleComponent, FeedbackBannerComponent,
    ConfirmDialogComponent, OptionCardGridComponent, OptionItemDetailsModalComponent, InternalPageHeaderComponent,
    InternalSearchFieldComponent, InternalFilterControlsComponent, InternalResetButtonComponent, ImageUploadFieldComponent,
  ],
  templateUrl: './request-option-management.html',
  styleUrl: './request-option-management.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestOptionManagementComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly optionService = inject(RequestOptionService);
  private readonly destroyRef = inject(DestroyRef);
  readonly cafeteriaPage = this.route.snapshot.data['optionPage'] === 'menu';
  private readonly explicitKind = this.route.snapshot.data['optionKind'] as RequestOptionKind | undefined;
  private readonly managerKinds = managerOptionKinds(this.auth.user()!.role);
  readonly permittedKinds: readonly RequestOptionKind[] = this.cafeteriaPage
    ? this.managerKinds.filter((kind) => kind === 'fnb')
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
  readonly successMessage = signal('');
  readonly errorMessage = signal('');
  readonly imageError = signal('');
  readonly viewMode = signal<'table' | 'card'>('table');
  readonly deleteTarget = signal<RequestOption | null>(null);
  readonly deleting = signal(false);
  readonly detailsTarget = signal<OptionCardViewModel | null>(null);

  readonly currentOptions = computed(() => this.allOptions().filter((option) => option.kind === this.selectedKind()));
  readonly filteredOptions = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.currentOptions().filter((option) =>
      (this.statusFilter() === 'all' || (this.statusFilter() === 'active') === option.active)
      && (!search || `${option.label} ${option.description ?? ''} ${this.details(option)}`.toLowerCase().includes(search)),
    );
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredOptions().length / this.pageSize())));
  readonly visibleOptions = computed(() => this.filteredOptions().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  readonly showCardToggle = computed(() => ['fnb', 'logistics', 'transportation'].includes(this.selectedKind()));
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
    actionKeys: ['fnb', 'logistics', 'transportation'].includes(option.kind) ? ['edit', 'status', 'delete'] : ['edit', 'status'],
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
      primaryActionLabel: this.selectedKind() === 'fnb' ? 'Add menu item' : this.selectedKind() === 'servingUnit' ? 'Add serving unit' : this.selectedKind() === 'dietaryInformation' ? 'Add dietary information' : 'Add option',
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
  requestDelete(option: RequestOption): void { this.clearNotices(); this.deleteTarget.set(option); }
  cancelDelete(): void { if (!this.deleting()) this.deleteTarget.set(null); }
  confirmDelete(): void {
    const option = this.deleteTarget();
    if (!option) return;
    this.deleting.set(true);
    this.optionService.delete(option.id).pipe(finalize(() => this.deleting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.deleteTarget.set(null); this.successMessage.set(`${option.label} was deleted.`); },
      error: () => this.errorMessage.set('The option could not be deleted. Please try again.'),
    });
  }
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
      next: () => { this.modalOpen.set(false); this.successMessage.set(id ? 'Option updated successfully.' : 'Option added successfully.'); },
      error: () => this.errorMessage.set('The option could not be saved. Please try again.'),
    });
  }
  fieldValue(key: string): string | number { const value = this.draft()[key]; return typeof value === 'boolean' ? '' : value ?? ''; }
  fieldOptions(field: ManagerField): readonly SelectOption[] { return field.options ?? []; }
  kindLabel(kind: RequestOptionKind): string { return KIND_LABELS[kind]; }
  imagePreview(): string { return String(this.draft()['imageDataUrl'] ?? ''); }
  imageFileName(): string { return String(this.draft()['imageFileName'] ?? ''); }
  supportsImage(): boolean { return ['fnb', 'logistics', 'transportation'].includes(this.selectedKind()); }
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
      next: () => this.successMessage.set(`${option.label} is now ${option.active ? 'inactive' : 'active'}.`),
      error: () => this.errorMessage.set('The option status could not be changed.'),
    });
  }
  private clearNotices(): void { this.successMessage.set(''); this.errorMessage.set(''); }
  private emptyDraft(kind: RequestOptionKind): Record<string, string | number | boolean> {
    const draft: Record<string, string | number | boolean> = { kind, label: '', description: '', active: true };
    this.fieldsFor(kind).forEach((field) => { if (!(field.key in draft)) draft[field.key] = field.type === 'number' ? '' : ''; });
    return draft;
  }
  private fieldsFor(kind: RequestOptionKind): readonly ManagerField[] {
    const common: readonly ManagerField[] = [{ key: 'label', label: kind === 'fnb' ? 'Food or Service Type' : 'Option Name', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'textarea' }];
    const specific: Readonly<Record<RequestOptionKind, readonly ManagerField[]>> = {
      logistics: [{ key: 'availableQuantity', label: 'Available Quantity', type: 'number', required: true, min: 0 }, { key: 'quantityUnit', label: 'Quantity Unit', type: 'text', required: true }],
      transportation: [{ key: 'passengerCapacity', label: 'Passenger Capacity', type: 'number', required: true, min: 1 }, { key: 'availableVehicles', label: 'Available Vehicle Count', type: 'number', required: true, min: 0 }, { key: 'instructions', label: 'Instructions', type: 'textarea' }],
      photoVideo: [{ key: 'maximumPersonnel', label: 'Maximum Personnel / Availability', type: 'number', min: 1 }],
      soundLight: [
        { key: 'availableQuantity', label: 'Available Quantity', type: 'number', required: true, min: 0 },
        { key: 'setupRequirements', label: 'Technical Description / Setup Requirements', type: 'textarea', required: true },
      ],
      fnb: [
        { key: 'servingUnitId', label: 'Serving Unit', type: 'select', required: true, options: this.managedSelectOptions('servingUnit') },
        { key: 'orderingNotes', label: 'Availability / Ordering Notes', type: 'textarea' },
        { key: 'dietaryInformationId', label: 'Dietary Information', type: 'select', required: true, options: this.managedSelectOptions('dietaryInformation') },
      ],
      dietaryInformation: [],
      servingUnit: [],
      campusTourStart: [{ key: 'meetingInstructions', label: 'Meeting Instructions', type: 'textarea' }, { key: 'maximumGroupSize', label: 'Maximum Group Size', type: 'number', min: 1 }],
      campusTourArea: [{ key: 'estimatedDuration', label: 'Estimated Duration (minutes)', type: 'number', min: 1 }, { key: 'restrictions', label: 'Access Restrictions / Availability Notes', type: 'textarea' }],
      campusTourMap: [{ key: 'mapUrl', label: 'Campus Map URL', type: 'text', required: true }, { key: 'accessNotes', label: 'Map / Route Guidance', type: 'textarea' }],
      waterLogo: [{ key: 'bottleCount', label: 'Number of Bottles', type: 'number', required: true, min: 0 }, { key: 'availableStock', label: 'Available Stock', type: 'number', required: true, min: 0 }, { key: 'brandingRequirement', label: 'Logo / Branding Requirement', type: 'textarea' }, { key: 'orderingInstructions', label: 'Lead Time / Ordering Instructions', type: 'textarea' }],
      waterNormal: [{ key: 'bottleCount', label: 'Number of Bottles', type: 'number', required: true, min: 0 }, { key: 'availableStock', label: 'Available Stock', type: 'number', required: true, min: 0 }, { key: 'orderingInstructions', label: 'Ordering / Delivery Instructions', type: 'textarea' }],
      fundingMain: [{ key: 'financeCode', label: 'Budget Category / Finance Code', type: 'text' }, { key: 'purchasingGuidance', label: 'Purchasing Guidance', type: 'textarea' }],
      fundingSub: [{ key: 'parentId', label: 'Parent Main Item', type: 'select', required: true, options: this.allOptions().filter((option) => option.kind === 'fundingMain').map((option) => ({ value: option.id, label: option.label })) }, { key: 'financeCode', label: 'Finance / Procurement Code', type: 'text' }, { key: 'purchasingNote', label: 'Default Unit / Purchasing Note', type: 'textarea' }],
    };
    return [...common, ...specific[kind]];
  }
  private details(option: RequestOption): string {
    switch (option.kind) {
      case 'logistics': return [`${option.availableQuantity} ${option.quantityUnit}${option.availableQuantity === 1 ? '' : 's'} available`, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'transportation': return [`${option.passengerCapacity} passengers`, `${option.availableVehicles} vehicle(s)`, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'photoVideo': return option.maximumPersonnel ? `Maximum ${option.maximumPersonnel} personnel` : '';
      case 'soundLight': return option.availableQuantity === undefined ? option.setupRequirements ?? '' : `${option.availableQuantity} available`;
      case 'fnb': return [this.optionLabel(option.servingUnitId), this.optionLabel(option.dietaryInformationId), option.orderingNotes, option.imageFileName ? 'Image added' : ''].filter(Boolean).join(' · ');
      case 'dietaryInformation': case 'servingUnit': return option.description ?? '';
      case 'campusTourStart': return [option.maximumGroupSize ? `Maximum ${option.maximumGroupSize}` : '', option.meetingInstructions].filter(Boolean).join(' · ');
      case 'campusTourArea': return [option.estimatedDuration ? `${option.estimatedDuration} minutes` : '', option.restrictions].filter(Boolean).join(' · ');
      case 'campusTourMap': return [option.mapUrl, option.accessNotes].filter(Boolean).join(' · ');
      case 'waterLogo': case 'waterNormal': return `${option.bottleCount || 'Custom'} bottles · ${option.availableStock} in stock`;
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
      case 'fnb':
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
