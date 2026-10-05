import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CountsWidget } from '../../../core/dashboard/dashboard.models';

/**
 * The Inbox / Ongoing / Completed / Late strip.
 *
 * Deliberately not four stat-tiles: a full-size card per number is oversized
 * for what is just a plain status count, and the compact-card requirement
 * calls for these to sit together as one row rather than as four more tiles
 * competing with the hero and KPIs for attention.
 *
 * These are figures, not links. Like the stat tiles, a count does not navigate:
 * the dashboard is somewhere you read, and a stray click while scanning four
 * numbers should not throw the page away.
 */
@Component({
  selector: 'app-counts-strip',
  imports: [],
  template: `
    <div class="dash-counts">
      @for (item of counts().items; track item.key) {
        <div class="dash-counts__item" [class]="'dash-counts__item--' + item.status">
          <span class="dash-counts__value">{{ item.value }}</span>
          <span class="dash-counts__label">{{ item.label }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './counts-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountsStripComponent {
  readonly counts = input.required<CountsWidget>();
}
