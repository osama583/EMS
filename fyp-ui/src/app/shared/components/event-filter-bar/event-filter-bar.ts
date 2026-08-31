import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ExpandableSearchComponent } from '../expandable-search/expandable-search';
import { FilterButtonComponent } from '../filter-button/filter-button';
import { EventFilterState } from './event-filter.state';

/**
 * Explore Events' search/filter/count toolbar and its applied-filter chips, as one component so
 * every event list (Explore, and each My Events tab) presents the same control, in the same
 * place, with the same labels. The dialog the Filters button opens lives in its sibling
 * `<app-event-filter-dialog>`, which is rendered at the page root so its overlay is not trapped
 * inside a section's stacking context.
 *
 * `display: contents` on the host: the toolbar and the chip row stay direct children of whatever
 * lays the page out, so wrapping them in a component changes no spacing.
 */
@Component({
  selector: 'app-event-filter-bar',
  imports: [ExpandableSearchComponent, FilterButtonComponent],
  template: `
    <div class="explore-toolbar" [class.explore-toolbar--internal]="flushTop()" role="search">
      <div class="explore-toolbar__controls">
        @if (showFilters()) {
          <app-filter-button
            label="Filters"
            ariaLabel="Open event filters"
            [count]="state().appliedCount()"
            [expanded]="state().filterOpen()"
            (triggered)="state().open()"
          />
        }

        <app-expandable-search
          [ariaLabel]="searchLabel()"
          [placeholder]="searchLabel()"
          [value]="state().searchTerm()"
          (valueChange)="onSearchTerm($event)"
        />
      </div>

      <div class="explore-toolbar__right">
        <p class="explore-toolbar__count" aria-live="polite">
          <strong>{{ resultCount() }}</strong>
          {{ resultCount() === 1 ? countNoun() : countNounPlural() }} found
        </p>

        @if (showFilters()) {
          <button type="button" class="explore-toolbar__reset" (click)="onClear()">
            <span class="material-symbols-rounded" aria-hidden="true">refresh</span>
            Reset
          </button>
        }
      </div>
    </div>

    @if (showFilters() && state().appliedChips().length > 0) {
      <div class="applied-filters" aria-label="Applied filters">
        @for (chip of state().appliedChips(); track chip.group + chip.value) {
          <button
            type="button"
            class="applied-filter"
            [attr.aria-label]="'Remove ' + chip.value + ' filter'"
            (click)="onRemoveChip(chip.group, chip.value)"
          >
            <span>{{ chip.value }}</span>
            <span aria-hidden="true">×</span>
          </button>
        }
        <button type="button" class="applied-filters__clear" (click)="onClear()">Clear all</button>
      </div>
    }
  `,
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFilterBarComponent {
  readonly state = input.required<EventFilterState>();
  readonly resultCount = input(0);
  readonly showFilters = input(true);
  /** Drops the toolbar's top margin, for a page that already spaces the element above it. */
  readonly flushTop = input(false);
  readonly searchLabel = input('Search events, categories or venues');
  readonly countNoun = input('event');
  readonly countNounPlural = input('events');

  /**
   * Any change that alters what the list should show. The consumer reloads from page 1 on this
   * rather than watching the state's individual signals, so "the query changed" and "go back to
   * page 1" stay one decision.
   */
  readonly queryChange = output<void>();

  onSearchTerm(value: string): void {
    this.state().setSearchTerm(value);
    this.queryChange.emit();
  }

  onRemoveChip(group: Parameters<EventFilterState['removeApplied']>[0], value: string): void {
    this.state().removeApplied(group, value);
    this.queryChange.emit();
  }

  onClear(): void {
    this.state().clearApplied();
    this.queryChange.emit();
  }
}
