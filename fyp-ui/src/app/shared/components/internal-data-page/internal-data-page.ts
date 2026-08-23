import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { InternalTableWorkspaceComponent } from '../internal-table-workspace/internal-table-workspace';
import {
  InternalCellClickEvent,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
  InternalSortChange,
  InternalSortState,
} from './internal-data-page.models';
import {
  InternalDataTableComponent,
  InternalFilterControlsComponent,
  InternalMobileRecordListComponent,
  InternalPageHeaderComponent,
  InternalPageStateComponent,
  InternalResetButtonComponent,
  InternalSearchFieldComponent,
} from './internal-data-page-parts';
import { ListViewMode, ViewToggleComponent } from '../view-toggle/view-toggle';

@Component({
  selector: 'app-internal-data-page',
  imports: [
    InternalTableWorkspaceComponent,
    InternalPageHeaderComponent,
    InternalSearchFieldComponent,
    InternalFilterControlsComponent,
    InternalResetButtonComponent,
    InternalDataTableComponent,
    InternalPageStateComponent,
    InternalMobileRecordListComponent,
    ViewToggleComponent,
  ],
  templateUrl: './internal-data-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalDataPageComponent {
  readonly config = input.required<InternalDataPageConfig>();
  readonly records = input.required<readonly InternalDataRecord[]>();
  readonly filters = input.required<readonly InternalFilterConfig[]>();
  readonly searchValue = input('');
  readonly loading = input(false);
  readonly totalPages = input(1);
  readonly page = input(1);
  readonly pageSize = input(10);
  readonly hideHeader = input(false);
  readonly hideControls = input(false);
  // undefined = this page doesn't offer server-side column sorting (the vast majority of pages).
  readonly sort = input<InternalSortState | undefined>(undefined);
  // Card/table switch (system specification §8A). Every list page gets the same control; pages
  // that genuinely have nothing card-shaped to show can opt out with [showViewToggle]="false".
  readonly showViewToggle = input(true);

  readonly searchChange = output<string>();
  readonly filterChange = output<InternalFilterChange>();
  readonly reset = output<void>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly rowAction = output<InternalRowActionEvent>();
  readonly recordOpen = output<InternalDataRecord>();
  readonly primaryAction = output<void>();
  readonly cellClick = output<InternalCellClickEvent>();
  readonly sortChange = output<InternalSortChange>();

  // Local to the component: which view the user picked. Table is the default on desktop, and
  // narrow viewports always render cards regardless (handled in CSS), so this only decides the
  // desktop presentation.
  readonly viewMode = signal<ListViewMode>('table');
  setViewMode(mode: ListViewMode): void { this.viewMode.set(mode); }

  readonly shouldShowClear = computed(() => {
    if (this.records().length > 0) return false;
    const searchActive = this.searchValue().trim().length > 0;
    const filtersActive = this.filters().some(f => f.value !== '' && f.value.toLowerCase() !== 'all' && f.value.toLowerCase() !== 'any');
    return searchActive || filtersActive;
  });
}
