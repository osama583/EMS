import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  InternalCellClickEvent,
  InternalDataPageConfig,
  InternalDataRecord,
  InternalFilterChange,
  InternalFilterConfig,
  InternalPageHeaderConfig,
  InternalRowAction,
  InternalRowActionEvent,
  InternalSearchConfig,
  InternalSortChange,
  InternalSortOrder,
  InternalSortState,
  InternalTableColumn,
  PAGE_SIZE_OPTIONS,
} from './internal-data-page.models';
import { SkeletonComponent } from '../skeleton/skeleton';

@Component({
  selector: 'app-internal-page-header',
  template: `
    <div class="shared-page-header__title-row">
      <div>
        <h1>{{ config().title }}</h1>
        <p>{{ config().description }}</p>
      </div>
      <div class="shared-page-header__actions">
        @if (config().countLabel) {
          <span class="shared-page-header__count">
            <span class="material-symbols-rounded" aria-hidden="true">{{ config().countIcon ?? 'inbox' }}</span>
            {{ config().countLabel }}
          </span>
        }
        <!-- Card/Table toggle and any page-specific header buttons sit HERE, on the same row as the
             title + description (title left, controls right) rather than in their own strip below
             the header or inside the search/filter card. -->
        <ng-content select="[headerTrailing]"></ng-content>
        @if (config().primaryActionLabel) {
          <button type="button" class="table-control table-control--primary" (click)="primaryAction.emit()">
            <span class="material-symbols-rounded" aria-hidden="true">{{ config().primaryActionIcon ?? 'add' }}</span>
            {{ config().primaryActionLabel }}
          </button>
        }
      </div>
    </div>
  `,
  host: { class: 'shared-page-header' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalPageHeaderComponent {
  readonly config = input.required<InternalPageHeaderConfig>();
  readonly primaryAction = output<void>();
}

@Component({
  selector: 'app-internal-search-field',
  template: `
    <label class="shared-search-field__label">
      <span class="visually-hidden">{{ config().ariaLabel }}</span>
      <span class="shared-search-field__shell">
        <span class="material-symbols-rounded" aria-hidden="true">search</span>
        <input
          type="search"
          [attr.aria-label]="config().ariaLabel"
          [placeholder]="config().placeholder"
          [value]="value()"
          (input)="onInput($event)"
        />
      </span>
    </label>
  `,
  host: { class: 'shared-search-field' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalSearchFieldComponent {
  readonly config = input.required<InternalSearchConfig>();
  readonly value = input('');
  readonly valueChange = output<string>();

  onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }
}

@Component({
  selector: 'app-internal-filter-controls',
  template: `
    @for (filter of filters(); track filter.key) {
      <label>
        <span class="visually-hidden">{{ filter.ariaLabel }}</span>
        <select
          [attr.aria-label]="filter.ariaLabel"
          [value]="filter.value"
          (change)="onChange(filter.key, $event)"
        >
          @for (option of filter.options; track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
        <span class="shared-filter-controls__arrow material-symbols-rounded" aria-hidden="true">expand_more</span>
      </label>
    }
  `,
  host: { class: 'shared-filter-controls' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalFilterControlsComponent {
  readonly filters = input.required<readonly InternalFilterConfig[]>();
  readonly filterChange = output<InternalFilterChange>();

  onChange(key: string, event: Event): void {
    this.filterChange.emit({ key, value: (event.target as HTMLSelectElement).value });
  }
}

@Component({
  selector: 'app-internal-reset-button',
  template: `
    <button type="button" (click)="reset.emit()">
      <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
      {{ label() }}
    </button>
  `,
  host: { class: 'shared-reset-button' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalResetButtonComponent {
  readonly label = input('Reset');
  readonly reset = output<void>();
}

@Component({
  selector: 'app-internal-data-table',
  template: `
    <table class="shared-data-table" [attr.aria-label]="ariaLabel()">
      <colgroup>
        @for (column of columns(); track column.key) { <col [style.width]="column.width ?? null" /> }
      </colgroup>
      <thead>
        <tr>
          @for (column of columns(); track column.key) {
            <th
              scope="col"
              [attr.data-actions]="column.actions ? '' : null"
              [attr.aria-sort]="ariaSortFor(column)"
              [style.width]="column.width ?? null"
            >
              @if (column.sortKey) {
                <button type="button" class="shared-data-table__sort" (click)="toggleSort(column)">
                  {{ column.label }}
                  <span class="material-symbols-rounded" aria-hidden="true">{{ sortIconFor(column) }}</span>
                </button>
              } @else {
                {{ column.label }}
              }
            </th>
          }
        </tr>
      </thead>
      <tbody>
        @for (record of records(); track record.id) {
          <tr [class.shared-data-table__row--emphasized]="record.emphasized" [attr.data-row-tone]="record.rowTone ?? null">
            @for (column of columns(); track column.key) {
              @if (column.actions) {
                <td data-actions>
                  <div class="shared-table-actions">
                    @for (action of visibleActions(record); track action.key) {
                      <button
                        type="button"
                        [attr.aria-label]="action.label + ': ' + record.mobile.title"
                        [title]="action.label"
                        (click)="actionSelect.emit({ action, record })"
                      >
                        <span class="material-symbols-rounded" aria-hidden="true">
                          {{ action.icon }}
                        </span>
                      </button>
                    }
                  </div>
                </td>
              } @else {
                @let cell = record.cells[column.key];
                <td>
                  @if (cell) {
                    <div class="shared-data-cell" [class.shared-data-cell--avatar]="cell.avatar">
                      @if (cell.avatar) {
                        <span class="shared-data-cell__avatar" aria-hidden="true">
                          {{ cell.avatar }}
                        </span>
                      }
                      <span class="shared-data-cell__copy">
                        @if (cell.badge && cell.clickable) {
                          <button
                            type="button"
                            class="shared-data-cell__badge shared-data-cell__badge--clickable"
                            [attr.data-tone]="cell.tone ?? 'neutral'"
                            (click)="cellClick.emit({ columnKey: column.key, record })"
                          >
                            @if (cell.badgeIcon) {
                              <span class="material-symbols-rounded shared-data-cell__badge-icon" aria-hidden="true">{{ cell.badgeIcon }}</span>
                            }
                            {{ cell.primary }}
                          </button>
                        } @else if (cell.badge) {
                          <span class="shared-data-cell__badge" [attr.data-tone]="cell.tone ?? 'neutral'">
                            {{ cell.primary }}
                          </span>
                        } @else {
                          <strong>{{ cell.primary }}</strong>
                        }
                        @if (cell.secondary) {
                          <small>{{ cell.secondary }}</small>
                        }
                      </span>
                    </div>
                  }
                </td>
              }
            }
          </tr>
        }
      </tbody>
    </table>
  `,
  host: { class: 'shared-data-table-host' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalDataTableComponent {
  readonly ariaLabel = input('Data table');
  readonly columns = input.required<readonly InternalTableColumn[]>();
  readonly records = input.required<readonly InternalDataRecord[]>();
  readonly actions = input.required<readonly InternalRowAction[]>();
  // undefined when the page doesn't sort server-side — every sortKey-less column ignores this.
  readonly sort = input<InternalSortState | undefined>(undefined);
  readonly actionSelect = output<InternalRowActionEvent>();
  readonly cellClick = output<InternalCellClickEvent>();
  readonly sortChange = output<InternalSortChange>();
  visibleActions(record: InternalDataRecord): readonly InternalRowAction[] {
    return record.actionKeys ? this.actions().filter((action) => record.actionKeys!.includes(action.key)) : this.actions();
  }
  private isActive(column: InternalTableColumn): boolean {
    return !!column.sortKey && this.sort()?.key === column.sortKey;
  }
  ariaSortFor(column: InternalTableColumn): 'ascending' | 'descending' | null {
    if (!this.isActive(column)) return null;
    return this.sort()!.order === 'asc' ? 'ascending' : 'descending';
  }
  sortIconFor(column: InternalTableColumn): string {
    if (!this.isActive(column)) return 'unfold_more';
    return this.sort()!.order === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }
  // First click on a column sorts ascending; clicking the already-active column flips order.
  toggleSort(column: InternalTableColumn): void {
    if (!column.sortKey) return;
    const next: InternalSortOrder = this.isActive(column) && this.sort()!.order === 'asc' ? 'desc' : 'asc';
    this.sortChange.emit({ key: column.sortKey, order: next });
  }
}

@Component({
  selector: 'app-internal-page-state',
  imports: [SkeletonComponent],
  template: `
    @if (loading()) {
      <app-skeleton variant="table" [count]="skeletonRows()" [columns]="skeletonColumns()" [label]="loadingLabel()" />
    } @else {
      <div class="shared-page-state__empty" role="status">
        <span class="material-symbols-rounded" aria-hidden="true">{{ icon() }}</span>
        <h2>{{ title() }}</h2>
        <p>{{ description() }}</p>
        @if (showClear()) { <button type="button" (click)="clear.emit()">Clear filters</button> }
      </div>
    }
  `,
  host: { class: 'shared-page-state' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalPageStateComponent {
  readonly loading = input(false);
  readonly icon = input('inbox');
  readonly title = input('No results found');
  readonly description = input('Try changing your search or filters.');
  readonly showClear = input(true);
  readonly clear = output<void>();
  // Shape of the skeleton drawn while loading. Defaults suit a typical list; the
  // data page passes its real column count so the bones line up with the table
  // that replaces them.
  readonly skeletonRows = input(5);
  readonly skeletonColumns = input(4);
  readonly loadingLabel = input('Loading results…');
}

@Component({
  selector: 'app-internal-mobile-record-list',
  template: `
    @for (record of records(); track record.id) {
      <article class="shared-mobile-card" [class.shared-mobile-card--unread]="record.mobile.unread" [attr.data-row-tone]="record.rowTone ?? null">
        <button
          type="button"
          class="shared-mobile-card__open"
          [attr.aria-label]="'Open: ' + record.mobile.title"
          (click)="open.emit(record)"
        >
          <span class="shared-mobile-card__topline">
            <span class="shared-mobile-card__eyebrow">{{ record.mobile.eyebrow }}</span>
            <span class="shared-mobile-card__status" [class.shared-mobile-card__status--unread]="record.mobile.unread">
              <span aria-hidden="true"></span>
              {{ record.mobile.status }}
            </span>
          </span>
          <strong>{{ record.mobile.title }}</strong>
          @if (record.mobile.identity) {
            <span class="shared-mobile-card__identity">
              @if (record.mobile.initials) {
                <span aria-hidden="true">{{ record.mobile.initials }}</span>
              }
              {{ record.mobile.identity }}
            </span>
          }
          <span class="shared-mobile-card__details">
            @for (detail of record.mobile.details; track detail.icon + detail.text) {
              <span>
                <span class="material-symbols-rounded" aria-hidden="true">{{ detail.icon }}</span>
                {{ detail.text }}
              </span>
            }
          </span>
        </button>
        @if (visibleActions(record).length > 0) {
          <div class="shared-mobile-card__menu">
            <button
              type="button"
              [attr.aria-label]="'Actions for ' + record.mobile.title"
              [attr.aria-expanded]="menuOpenFor() === record.id"
              (click)="toggleMenu(record.id, $event)"
            >
              <span class="material-symbols-rounded" aria-hidden="true">more_horiz</span>
            </button>
            @if (menuOpenFor() === record.id) {
              <div role="menu" (click)="$event.stopPropagation()">
                @for (action of visibleActions(record); track action.key) {
                  <button type="button" role="menuitem" (click)="closeMenu(); actionSelect.emit({ action, record })">
                    <span class="material-symbols-rounded" aria-hidden="true">{{ action.icon }}</span>
                    {{ action.label }}
                  </button>
                }
              </div>
            }
          </div>
        }
      </article>
    }
  `,
  host: { class: 'shared-mobile-list' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalMobileRecordListComponent {
  readonly records = input.required<readonly InternalDataRecord[]>();
  readonly actions = input.required<readonly InternalRowAction[]>();
  readonly open = output<InternalDataRecord>();
  readonly actionSelect = output<InternalRowActionEvent>();

  // Only one card's menu open at a time, closed by an outside click or Escape — matches the hand-
  // rolled menu in hub-my-clubs.ts.
  readonly menuOpenFor = signal<string | number | null>(null);

  visibleActions(record: InternalDataRecord): readonly InternalRowAction[] {
    return record.actionKeys ? this.actions().filter((action) => record.actionKeys!.includes(action.key)) : this.actions();
  }

  toggleMenu(recordId: string | number, event: Event): void {
    event.stopPropagation();
    this.menuOpenFor.set(this.menuOpenFor() === recordId ? null : recordId);
  }
  closeMenu(): void { this.menuOpenFor.set(null); }

  @HostListener('document:click')
  onDocumentClick(): void { this.closeMenu(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeMenu(); }
}

interface PaginationPageItem {
  readonly key: string;
  readonly type: 'page';
  readonly value: number;
}

interface PaginationEllipsisItem {
  readonly key: string;
  readonly type: 'ellipsis';
}

type PaginationItem = PaginationPageItem | PaginationEllipsisItem;

@Component({
  selector: 'app-internal-pagination',
  template: `
    <nav class="workspace-pagination" [attr.aria-label]="paginationLabel()">
      <button
        type="button"
        class="workspace-pagination__control"
        aria-label="Previous page"
        [disabled]="safePage() === 1"
        (click)="goToPage(safePage() - 1)"
      >
        <span class="material-symbols-rounded" aria-hidden="true">chevron_left</span>
      </button>
      @for (item of paginationItems(); track item.key) {
        @if (item.type === 'page') {
          <button
            type="button"
            class="workspace-pagination__control workspace-pagination__page"
            [class.workspace-pagination__page--active]="item.value === safePage()"
            [attr.aria-current]="item.value === safePage() ? 'page' : null"
            [attr.aria-label]="'Page ' + item.value"
            (click)="goToPage(item.value)"
          >{{ item.value }}</button>
        } @else {
          <span class="workspace-pagination__ellipsis" aria-hidden="true">&hellip;</span>
        }
      }
      <button
        type="button"
        class="workspace-pagination__control"
        aria-label="Next page"
        [disabled]="safePage() === safeTotalPages()"
        (click)="goToPage(safePage() + 1)"
      >
        <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
      </button>
    </nav>
    <label class="workspace-page-size">
      <span class="visually-hidden">{{ rowsPerPageLabel() }}</span>
      <select [value]="pageSize()" (change)="updatePageSize($event)">
        @for (option of pageSizeOptions(); track option) {
          <option [value]="option">{{ option }} per page</option>
        }
      </select>
      <span class="material-symbols-rounded" aria-hidden="true">expand_more</span>
    </label>
  `,
  host: { class: 'shared-pagination' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalPaginationComponent {
  readonly paginationLabel = input('Pagination');
  readonly rowsPerPageLabel = input('Rows per page');
  readonly totalPages = input(1);
  readonly page = input(1);
  readonly pageSize = input(10);
  readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  readonly safeTotalPages = computed(() => Math.max(1, Math.floor(this.totalPages())));
  readonly safePage = computed(() => Math.max(1, Math.min(Math.floor(this.page()), this.safeTotalPages())));
  readonly paginationItems = computed<readonly PaginationItem[]>(() => {
    const total = this.safeTotalPages();
    const current = this.safePage();
    if (total <= 7) return Array.from({ length: total }, (_, index) => this.pageItem(index + 1));

    const visible = new Set<number>([1, total, current - 1, current, current + 1]);
    if (current <= 4) [2, 3, 4, 5].forEach((value) => visible.add(value));
    if (current >= total - 3) [total - 4, total - 3, total - 2, total - 1].forEach((value) => visible.add(value));
    const pages = [...visible].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
    const items: PaginationItem[] = [];
    pages.forEach((value, index) => {
      const previous = pages[index - 1];
      if (index > 0 && value - previous > 1) items.push({ key: `ellipsis-${previous}-${value}`, type: 'ellipsis' });
      items.push(this.pageItem(value));
    });
    return items;
  });

  goToPage(value: number): void {
    const next = Math.max(1, Math.min(Math.floor(value), this.safeTotalPages()));
    if (next !== this.safePage()) this.pageChange.emit(next);
  }

  updatePageSize(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(value) && value > 0) this.pageSizeChange.emit(value);
  }

  private pageItem(value: number): PaginationPageItem {
    return { key: `page-${value}`, type: 'page', value };
  }
}
