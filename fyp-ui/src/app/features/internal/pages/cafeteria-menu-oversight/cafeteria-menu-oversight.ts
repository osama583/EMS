import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CafeteriaService } from '../../../../core/cafeterias/cafeteria.service';
import { Cafeteria } from '../../../../core/cafeterias/cafeteria.models';
import { RequestOptionService } from '../../../../core/request-options/request-option.service';
import { FoodRequestOption, RequestOption } from '../../../../core/request-options/request-option.models';
import { InternalPageHeaderComponent, InternalResetButtonComponent, InternalSearchFieldComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalPageHeaderConfig } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { OptionCardGridComponent } from '../../../../shared/components/option-card-grid/option-card-grid';
import { OptionCardViewModel } from '../../../../shared/components/option-card-grid/option-card-grid.models';
import { OptionItemDetailsModalComponent } from '../../../../shared/components/option-item-details-modal/option-item-details-modal';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';

// Read-only cross-cafeteria menu view, one cafeteria at a time via a left-hand list —
// /app/cafeteria-menus (F&B's earlier dropdown-based version of this same idea) was removed
// 2026-08-17; this page is now the SINGLE menu-viewing surface for every role granted it via
// Page Visibility (F&B included), not a bespoke per-role page. No route guard: like every other
// page in the app, access is governed purely by this page's nav_page_grants row (see
// server/db.js's seedNavPages()), enforced by roleGuard's auth.canAccess() check.
@Component({
  selector: 'app-cafeteria-menu-oversight',
  imports: [InternalPageHeaderComponent, InternalSearchFieldComponent, InternalResetButtonComponent, OptionCardGridComponent, OptionItemDetailsModalComponent, LoadingStateComponent],
  templateUrl: './cafeteria-menu-oversight.html',
  styleUrl: './cafeteria-menu-oversight.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CafeteriaMenuOversightComponent {
  private readonly cafeteriaService = inject(CafeteriaService);
  private readonly optionService = inject(RequestOptionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cafeterias = signal<readonly Cafeteria[]>([]);
  readonly cafeteriasLoading = signal(true);
  readonly selectedCafeteriaId = signal<string | null>(null);
  readonly menuItems = signal<readonly RequestOption[]>([]);
  readonly menuLoading = signal(false);
  readonly search = signal('');
  readonly detailsTarget = signal<OptionCardViewModel | null>(null);

  private readonly lookupLabels = signal(new Map<string, string>());
  private readonly menuCountByCafeteria = signal(new Map<string, number>());

  readonly selectedCafeteriaName = computed(() => this.cafeterias().find((c) => c.id === this.selectedCafeteriaId())?.name ?? '');

  readonly filteredItems = computed<readonly FoodRequestOption[]>(() => {
    const search = this.search().trim().toLowerCase();
    return (this.menuItems() as readonly FoodRequestOption[]).filter((item) =>
      !search || `${item.label} ${item.description ?? ''} ${item.orderingNotes ?? ''}`.toLowerCase().includes(search),
    );
  });
  readonly cardData = computed<readonly OptionCardViewModel[]>(() => this.filteredItems().map((option) => this.toCardViewModel(option)));

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Menu Oversight',
    description: this.selectedCafeteriaName()
      ? `Viewing ${this.selectedCafeteriaName()}'s menu — view only. Menus are edited by that cafeteria's Cafeteria Manager.`
      : 'Select a cafeteria to view its menu.',
    countLabel: `${this.filteredItems().length} item${this.filteredItems().length === 1 ? '' : 's'}`,
  }));

  constructor() {
    this.optionService.watchAll(['servingUnit', 'dietaryInformation']).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((options) => {
      this.lookupLabels.set(new Map(options.map((option) => [option.id, option.label])));
    });
    this.optionService.watchAll(['fmb']).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((options) => {
      const counts = new Map<string, number>();
      for (const option of options as readonly FoodRequestOption[]) {
        if (!option.cafeteriaCode) continue;
        counts.set(option.cafeteriaCode, (counts.get(option.cafeteriaCode) ?? 0) + 1);
      }
      this.menuCountByCafeteria.set(counts);
    });
    this.cafeteriaService.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cafeterias) => {
        this.cafeterias.set(cafeterias);
        this.cafeteriasLoading.set(false);
        if (cafeterias.length > 0) this.selectCafeteria(cafeterias[0].id);
      },
      error: () => this.cafeteriasLoading.set(false),
    });
  }

  menuCountFor(cafeteriaId: string): number { return this.menuCountByCafeteria().get(cafeteriaId) ?? 0; }

  selectCafeteria(id: string): void {
    this.selectedCafeteriaId.set(id);
    this.menuLoading.set(true);
    this.optionService.watchByCafeteria(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => { this.menuItems.set(options); this.menuLoading.set(false); },
      error: () => this.menuLoading.set(false),
    });
  }

  setSearch(value: string): void { this.search.set(value); }
  reset(): void { this.search.set(''); }

  viewDetails(id: string): void {
    const option = this.filteredItems().find((item) => item.id === id);
    if (option) this.detailsTarget.set(this.toCardViewModel(option));
  }
  closeDetails(): void { this.detailsTarget.set(null); }

  private optionLabel(id: string | undefined): string { return id ? this.lookupLabels().get(id) ?? id : ''; }
  // Several dietary tags read as one comma-separated phrase in the card's badge.
  private optionLabels(ids: readonly string[] | undefined): string {
    return (ids ?? []).map((id) => this.optionLabel(id)).filter(Boolean).join(', ');
  }

  private toCardViewModel(option: FoodRequestOption): OptionCardViewModel {
    const unit = this.optionLabel(option.servingUnitId);
    const dietary = this.optionLabels(option.dietaryInformationIds);
    return {
      id: option.id,
      label: option.label,
      description: option.description ?? '',
      active: option.active,
      imageDataUrl: option.imageDataUrl ?? '',
      imageFileName: option.imageFileName ?? '',
      servingUnitLabel: unit,
      dietaryInformationLabel: dietary,
      orderingNotes: option.orderingNotes ?? '',
      metaFields: [
        ...(unit ? [{ label: 'Serving unit', value: unit, icon: 'restaurant', isBadge: true, badgeTone: 'blue' as const }] : []),
        ...(dietary ? [{ label: 'Dietary info', value: dietary, icon: 'nutrition', isBadge: true, badgeTone: 'emerald' as const }] : []),
        ...(option.orderingNotes ? [{ label: 'Ordering notes', value: option.orderingNotes, icon: 'notes', isNotes: true }] : []),
      ],
    };
  }
}
