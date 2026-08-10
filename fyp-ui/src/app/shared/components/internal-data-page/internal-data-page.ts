import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { InternalTableWorkspaceComponent } from '../internal-table-workspace/internal-table-workspace';
import {
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalRowActionEvent,
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

  readonly searchChange = output<string>();
  readonly filterChange = output<InternalFilterChange>();
  readonly reset = output<void>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly rowAction = output<InternalRowActionEvent>();
  readonly recordOpen = output<InternalDataRecord>();
  readonly primaryAction = output<void>();

  readonly shouldShowClear = computed(() => {
    if (this.records().length > 0) return false;
    const searchActive = this.searchValue().trim().length > 0;
    const filtersActive = this.filters().some(f => f.value !== '' && f.value.toLowerCase() !== 'all' && f.value.toLowerCase() !== 'any');
    return searchActive || filtersActive;
  });
}
