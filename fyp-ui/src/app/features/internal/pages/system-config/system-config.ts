import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { SystemConfigService } from '../../../../core/config/system-config.service';
import { FormFieldComponent } from '../../../../shared/components/form-controls/form-field';
import { FeedbackBannerComponent } from '../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { InternalDataPageComponent } from '../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalRowActionEvent } from '../../../../shared/components/internal-data-page/internal-data-page.models';

@Component({
  selector: 'app-system-config',
  imports: [FormFieldComponent, FeedbackBannerComponent, FormModalComponent, ConfirmDialogComponent, InternalDataPageComponent],
  templateUrl: './system-config.html',
  styleUrl: './system-config.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemConfigComponent {
  private readonly configService = inject(SystemConfigService);
  private readonly destroyRef = inject(DestroyRef);
  readonly paxThreshold = signal(this.configService.paxReviewerThreshold());
  readonly cancellationDays = signal(this.configService.cancellationDaysLimit());
  readonly policiesSaved = signal(false);
  readonly saving = signal(false);

  readonly categories = signal<readonly string[]>([...this.configService.eventCategories()]);
  readonly search = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly modalOpen = signal(false);
  readonly editingIndex = signal<number | null>(null);
  readonly draft = signal('');
  readonly deleteTarget = signal<string | null>(null);
  readonly successMessage = signal('');
  readonly errorMessage = signal('');

  readonly filteredCategories = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.categories()
      .map((name, index) => ({ name, index }))
      .filter((entry) => !search || entry.name.toLowerCase().includes(search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredCategories().length / this.pageSize())));
  readonly visibleCategories = computed(() => this.filteredCategories().slice((this.page() - 1) * this.pageSize(), this.page() * this.pageSize()));
  readonly records = computed<readonly InternalDataRecord[]>(() => this.visibleCategories().map((entry) => ({
    id: entry.index,
    cells: {
      name: { primary: entry.name },
      actions: { primary: '' },
    },
    mobile: { eyebrow: 'Event category', status: '', title: entry.name, details: [] },
  })));
  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Event categories', paginationLabel: 'Category pages', rowsPerPageLabel: 'Categories per page', mobileListLabel: 'Category cards',
    header: {
      title: 'Event Categories',
      description: 'These categories are used in the Event Proposal form and filter the Public Explore Events page.',
      countLabel: `${this.filteredCategories().length} categor${this.filteredCategories().length === 1 ? 'y' : 'ies'}`,
      primaryActionLabel: 'Add category',
    },
    search: { ariaLabel: 'Search event categories', placeholder: 'Search category name' },
    columns: [{ key: 'name', label: 'Category Name' }, { key: 'actions', label: 'Actions', actions: true }],
    actions: [{ key: 'edit', label: 'Edit category', icon: 'edit' }, { key: 'delete', label: 'Delete category', icon: 'delete' }],
    emptyTitle: 'No categories found', emptyDescription: 'Add a category or change the current search.', pageSizeOptions: [5, 10, 25],
  }));
  readonly formValid = computed(() => !!this.draft().trim() && !this.fieldError());

  setPaxThreshold(value: string | number): void {
    this.paxThreshold.set(Number(value) || 50);
    this.policiesSaved.set(false);
  }

  setCancellationDays(value: string | number): void {
    this.cancellationDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  savePolicies(): void {
    this.persist(() => {
      this.policiesSaved.set(true);
      setTimeout(() => this.policiesSaved.set(false), 2000);
    });
  }

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  resetSearch(): void { this.search.set(''); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  openAdd(): void {
    this.editingIndex.set(null);
    this.draft.set('');
    this.modalOpen.set(true);
    this.clearMessages();
  }

  handleAction(event: InternalRowActionEvent): void {
    const index = Number(event.record.id);
    const name = this.categories()[index];
    if (name === undefined) return;
    if (event.action.key === 'edit') {
      this.editingIndex.set(index);
      this.draft.set(name);
      this.modalOpen.set(true);
      this.clearMessages();
      return;
    }
    if (event.action.key === 'delete') {
      this.clearMessages();
      this.deleteTarget.set(name);
    }
  }

  setDraft(value: string): void { this.draft.set(value); }

  fieldError(): string {
    const value = this.draft().trim().toLowerCase();
    if (!value) return '';
    const index = this.editingIndex();
    const clashes = this.categories().some((name, i) => i !== index && name.toLowerCase() === value);
    return clashes ? 'This category already exists.' : '';
  }

  closeModal(): void { if (!this.saving()) this.modalOpen.set(false); }

  save(): void {
    if (!this.formValid()) return;
    const name = this.draft().trim();
    const index = this.editingIndex();
    this.categories.update((items) => {
      const next = [...items];
      if (index === null) next.push(name);
      else next[index] = name;
      return next;
    });
    this.persist(() => {
      this.modalOpen.set(false);
      this.successMessage.set(index === null ? 'Category added successfully.' : 'Category updated successfully.');
    });
  }

  cancelDelete(): void { this.deleteTarget.set(null); }

  confirmDelete(): void {
    const name = this.deleteTarget();
    if (name === null) return;
    this.categories.update((items) => items.filter((item) => item !== name));
    this.persist(() => {
      this.deleteTarget.set(null);
      this.successMessage.set(`${name} was deleted.`);
      this.page.set(Math.max(1, Math.min(this.page(), this.totalPages())));
    });
  }

  private clearMessages(): void { this.successMessage.set(''); this.errorMessage.set(''); }

  private persist(onSuccess: () => void): void {
    this.clearMessages();
    this.saving.set(true);
    this.configService.updateConfig({
      paxReviewerThreshold: this.paxThreshold(),
      cancellationDaysLimit: this.cancellationDays(),
      eventCategories: this.categories(),
    }).pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => onSuccess(),
      error: () => this.errorMessage.set('The configuration could not be saved. Please try again.'),
    });
  }
}
