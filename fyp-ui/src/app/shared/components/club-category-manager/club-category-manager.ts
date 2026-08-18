import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ClubCategoryRecord } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { DeletionMetadata, DeletionPreview } from '../../models/deletion.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { DeleteConfirmDialogComponent } from '../delete-confirm-dialog/delete-confirm-dialog';
import { ToastService } from '../toast/toast.service';

@Component({
  selector: 'app-club-category-manager',
  imports: [FormModalComponent, DeleteConfirmDialogComponent],
  templateUrl: './club-category-manager.html',
  styleUrl: './club-category-manager.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubCategoryManagerComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly currentUserId = input.required<string>();
  readonly close = output<void>();
  readonly categoriesChanged = output<void>();

  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly newName = signal('');
  readonly editingId = signal<string | null>(null);
  readonly editingName = signal('');

  readonly showDeleted = signal(false);
  readonly deletedCategories = signal<readonly (ClubCategoryRecord & DeletionMetadata)[]>([]);
  readonly deletedLoading = signal(false);
  readonly restoringId = signal<string | null>(null);

  readonly deleteTarget = signal<ClubCategoryRecord | null>(null);
  readonly deletePreview = signal<DeletionPreview | null>(null);
  readonly checkingDeletion = signal(false);
  readonly deleting = signal(false);

  loadIfNeeded(): void {
    if (!this.open()) return;
    this.loading.set(true);
    this.clubService.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => { this.categories.set(categories); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  setNewName(value: string): void { this.newName.set(value); }

  addCategory(): void {
    const name = this.newName().trim();
    if (!name || this.saving()) return;
    this.saving.set(true);
    this.clubService.createCategory(name, this.currentUserId()).pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (category) => {
        this.categories.update((list) => [...list, category]);
        this.newName.set('');
        this.categoriesChanged.emit();
      },
      error: (err) => this.toast.error('Category could not be created', err?.error?.message ?? 'Please try again.'),
    });
  }

  startEdit(category: ClubCategoryRecord): void { this.editingId.set(category.id); this.editingName.set(category.name); }
  cancelEdit(): void { this.editingId.set(null); this.editingName.set(''); }
  setEditingName(value: string): void { this.editingName.set(value); }

  saveEdit(category: ClubCategoryRecord): void {
    const name = this.editingName().trim();
    if (!name) return;
    this.clubService.updateCategory(category.id, name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.categories.update((list) => list.map((item) => item.id === updated.id ? updated : item));
        this.editingId.set(null);
        this.categoriesChanged.emit();
      },
      error: (err) => this.toast.error('Category could not be updated', err?.error?.message ?? 'Please try again.'),
    });
  }

  toggleActive(category: ClubCategoryRecord): void {
    this.clubService.setCategoryActive(category.id, !category.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.categories.update((list) => list.map((item) => item.id === updated.id ? updated : item));
        this.categoriesChanged.emit();
      },
      error: () => this.toast.error('Could not change status', 'Please try again.'),
    });
  }

  // ---------------------------------------------------------------------------
  // Delete / restore
  // ---------------------------------------------------------------------------
  targetLabel(): string {
    const target = this.deleteTarget();
    return target ? `"${target.name}"` : '';
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
        this.categories.update((list) => list.filter((item) => item.id !== category.id));
        this.categoriesChanged.emit();
        this.toast.success('Category deleted', 'It can be restored within 7 days.');
      },
      error: (err) => this.toast.error('Category could not be deleted', err?.error?.message ?? 'It may still be in use by a club.'),
    });
  }

  toggleDeletedView(): void {
    this.showDeleted.update((value) => !value);
    if (this.showDeleted()) this.loadDeleted();
  }
  private loadDeleted(): void {
    this.deletedLoading.set(true);
    this.clubService.getDeletedCategories().pipe(finalize(() => this.deletedLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => this.deletedCategories.set(categories),
      error: () => this.toast.error('Could not load deleted categories', 'Please try again.'),
    });
  }
  restoreCategory(id: string): void {
    this.restoringId.set(id);
    this.clubService.restoreCategory(id).pipe(finalize(() => this.restoringId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Category restored', '');
        this.loadDeleted();
        this.loadIfNeeded();
        this.categoriesChanged.emit();
      },
      error: (err) => this.toast.error('Could not restore category', err?.error?.message ?? 'Please try again.'),
    });
  }
  formatDate(iso: string): string { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
}
