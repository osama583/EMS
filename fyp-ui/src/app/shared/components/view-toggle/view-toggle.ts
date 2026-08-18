import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ListViewMode = 'card' | 'table';

// The ONE card/table switch used by every list in the app (system specification §8A: "If any page
// offers switching between card and table view, all pages that display lists must implement the
// same toggle with identical design"). The Clubs pages previously each carried their own copy of
// this markup + SCSS while the shared data-page tables had no toggle at all; both now render this
// component, so the control looks and behaves identically everywhere.
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
