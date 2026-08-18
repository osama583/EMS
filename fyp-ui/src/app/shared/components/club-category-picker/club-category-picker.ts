import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ClubCategoryRecord, ClubRecord } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { SelectOption } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';
import { ToastService } from '../toast/toast.service';

export const CLUB_CATEGORY_MIN = 1;
export const CLUB_CATEGORY_MAX = 3;

// President self-service popup: change which 1-3 categories a club they preside over is listed
// under. Categories themselves stay a Club Admin-managed lookup list (see
// ClubCategoryManagerComponent) — this picker only assigns from the active list, data-driven
// end to end via ClubService.setClubCategories() -> PATCH /clubs/:id/categories.
@Component({
  selector: 'app-club-category-picker',
  imports: [FormModalComponent, SearchableDropdownComponent],
  templateUrl: './club-category-picker.html',
  styleUrl: './club-category-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubCategoryPickerComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly club = input<ClubRecord | null>(null);
  readonly currentUserId = input.required<string>();
  readonly close = output<void>();
  readonly saved = output<ClubRecord>();

  readonly categories = signal<readonly ClubCategoryRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly selectedIds = signal<readonly string[]>([]);
  readonly errorMessage = signal('');

  readonly minSelections = CLUB_CATEGORY_MIN;
  readonly maxSelections = CLUB_CATEGORY_MAX;

  readonly categoryOptions = computed<readonly SelectOption[]>(() =>
    this.categories().filter((category) => category.active).map((category) => ({ value: category.id, label: category.name })),
  );
  readonly isValid = computed(() => this.selectedIds().length >= this.minSelections && this.selectedIds().length <= this.maxSelections);

  constructor() {
    effect(() => {
      const club = this.club();
      if (this.open() && club) {
        this.selectedIds.set(club.categories.map((category) => category.id));
        this.errorMessage.set('');
        this.loadCategories();
      }
    });
  }

  private loadCategories(): void {
    this.loading.set(true);
    this.clubService.getCategories({ activeOnly: true }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories) => { this.categories.set(categories); this.loading.set(false); },
      error: () => { this.errorMessage.set('Categories could not be loaded.'); this.loading.set(false); },
    });
  }

  setSelectedIds(value: readonly string[]): void { this.selectedIds.set(value); }

  save(): void {
    const club = this.club();
    if (!club || !this.isValid() || this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    this.clubService.setClubCategories(club.id, this.selectedIds(), this.currentUserId())
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.saved.emit(updated);
          this.toast.success('Categories updated', `${club.name} is now listed under ${updated.categories.map((category) => category.name).join(', ')}.`);
        },
        error: (err) => this.errorMessage.set(err?.error?.message ?? 'The categories could not be saved. Please try again.'),
      });
  }
}
