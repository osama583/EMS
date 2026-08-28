import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CountsWidget, Drill } from '../../../core/dashboard/dashboard.models';

/**
 * The Inbox / Ongoing / Completed / Late strip.
 *
 * Deliberately not four stat-tiles: a full-size card per number is oversized
 * for what is just a plain status count, and the compact-card requirement
 * calls for these to sit together as one row rather than as four more tiles
 * competing with the hero and KPIs for attention.
 */
@Component({
  selector: 'app-counts-strip',
  imports: [],
  template: `
    <div class="dash-counts">
      @for (item of counts().items; track item.key) {
        <button
          type="button"
          class="dash-counts__item"
          [class]="'dash-counts__item--' + item.status"
          [disabled]="!item.drill"
          (click)="item.drill && drill.emit(item.drill)"
        >
          <span class="dash-counts__value">{{ item.value }}</span>
          <span class="dash-counts__label">{{ item.label }}</span>
        </button>
      }
    </div>
  `,
  styleUrl: './counts-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountsStripComponent {
  readonly counts = input.required<CountsWidget>();
  readonly drill = output<Drill>();
}
