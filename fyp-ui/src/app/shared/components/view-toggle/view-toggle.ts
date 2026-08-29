import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ListViewMode = 'card' | 'table';

/**
 * The width at which a list stops being table-shaped. Matches the `48rem`
 * breakpoint the workspace stylesheet already uses, so the mode a page opens in
 * and the layout the CSS gives it can never disagree.
 */
export const LIST_VIEW_BREAKPOINT = '(max-width: 48rem)';

/**
 * Which view a list page opens in: **cards on a phone, table on a desktop.**
 *
 * One function rather than a default per page. Every list picked its own before
 * this - six of them opened in cards on a 27" monitor, one opened in a table,
 * and the shared data-page opened in a table on a phone, where the toggle is
 * authoritative at every width and so rendered a table to be scrolled
 * sideways. All three were the same decision made three ways.
 *
 * Read once, when the page is created. It is a DEFAULT, not a binding: resizing
 * the window must not throw away a choice the reader has made, and every route
 * change builds the component again, so each navigation re-asks the question.
 *
 * Guarded for non-browser rendering the same way the rest of the app is.
 */
export function defaultListViewMode(): ListViewMode {
  if (typeof window === 'undefined') return 'table';
  return window.matchMedia?.(LIST_VIEW_BREAKPOINT).matches ? 'card' : 'table';
}

// The ONE card/table switch used by every list in the app (system specification §8A: "If any page
// offers switching between card and table view, all pages that display lists must implement the same
// toggle with identical design").
@Component({
  selector: 'app-view-toggle',
  template: `
    <div class="shared-view-toggle" role="group" [attr.aria-label]="ariaLabel()">
      <button type="button" [class.active]="mode() === 'card'" [attr.aria-pressed]="mode() === 'card'" (click)="modeChange.emit('card')">
        <span class="material-symbols-rounded" aria-hidden="true">grid_view</span>
        Card View
      </button>
      <button type="button" [class.active]="mode() === 'table'" [attr.aria-pressed]="mode() === 'table'" (click)="modeChange.emit('table')">
        <span class="material-symbols-rounded" aria-hidden="true">table_rows</span>
        Table
      </button>
    </div>
  `,
  styleUrl: './view-toggle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewToggleComponent {
  readonly mode = input<ListViewMode>('table');
  readonly ariaLabel = input('Choose view');
  readonly modeChange = output<ListViewMode>();
}
