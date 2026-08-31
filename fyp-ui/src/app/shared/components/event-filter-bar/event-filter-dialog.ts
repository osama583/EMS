import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { FormModalComponent } from '../form-modal/form-modal';
import { EventFilterState } from './event-filter.state';

/**
 * The filter dialog behind `<app-event-filter-bar>`'s Filters button — one fieldset per group,
 * a draft selection that only reaches the list on Show Results, and the custom date range.
 *
 * Rendered at the page root (not inside the list's section) so its fixed overlay is not confined
 * to a section's stacking context. `draftResultCount` is supplied by the consumer, which owns the
 * debounced count request — that request differs per list (Explore searches everything, a My
 * Events tab searches its own scope), which is the one thing this dialog cannot know.
 */
@Component({
  selector: 'app-event-filter-dialog',
  imports: [FormModalComponent],
  template: `
    <app-form-modal
      [open]="state().filterOpen()"
      title="Filter events"
      [primaryLabel]="'Show ' + draftResultCount() + (draftResultCount() === 1 ? ' Result' : ' Results')"
      secondaryLabel="Reset filters"
      (close)="state().close()"
      (cancel)="state().resetDraft()"
      (submit)="onApply()"
    >
      <div class="filter-dialog__body">
        @for (group of state().groups(); track group.key) {
          <fieldset class="filter-group" [class.filter-group--wide]="group.wide">
            <legend>{{ group.label }}</legend>
            <div class="filter-options">
              @for (option of group.options; track option) {
                <button
                  type="button"
                  class="filter-option"
                  [class.filter-option--selected]="state().isDraftSelected(group.key, option)"
                  [attr.aria-pressed]="state().isDraftSelected(group.key, option)"
                  (click)="state().toggleDraft(group.key, option)"
                >
                  @if (state().isDraftSelected(group.key, option)) {
                    <span class="filter-option__check" aria-hidden="true">&#10003;</span>
                  }
                  <span>{{ option }}</span>
                </button>
              }
            </div>

            @if (group.key === 'date' && state().isDraftSelected('date', 'Custom Date Range')) {
              <div class="custom-range">
                <label>
                  <span>From</span>
                  <input type="date" [value]="state().draftCustomFrom()" (input)="onCustomDate($event, 'from')" />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" [value]="state().draftCustomTo()" (input)="onCustomDate($event, 'to')" />
                </label>
              </div>
            }
          </fieldset>
        }
      </div>
    </app-form-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFilterDialogComponent {
  readonly state = input.required<EventFilterState>();
  readonly draftResultCount = input(0);

  /** Emitted once the draft selection has become the applied one — reload from page 1. */
  readonly applied = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.state().filterOpen()) this.state().close();
  }

  onApply(): void {
    this.state().apply();
    this.applied.emit();
  }

  onCustomDate(event: Event, edge: 'from' | 'to'): void {
    this.state().setCustomDate(edge, (event.target as HTMLInputElement).value);
  }
}
