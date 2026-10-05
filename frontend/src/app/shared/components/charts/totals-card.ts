import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TotalsWidget } from '../../../core/dashboard/dashboard.models';

/**
 * The proposal totals card — one number, with a toggle choosing which.
 *
 * Sits directly under the Inbox strip and answers the neighbouring question.
 * The strip says where work is sitting relative to *your* gate; this says what
 * happened to proposals over the period, which is the same four words
 * ("created", "needs action", "completed", "cancelled") for every reader.
 *
 * One number at a time rather than four tiles: only one of the four is being
 * asked at any moment, and four permanent tiles would compete with the KPI row
 * above for a question the reader is not currently asking.
 *
 * The figure itself does not navigate, for the reason the stat tiles do not:
 * the dashboard is somewhere you read. Only the toggle is interactive.
 *
 * The selection is local state and deliberately not in the URL — it is a glance,
 * not a view worth sharing, and putting it in the query string would make the
 * back button step through toggle presses.
 */
@Component({
  selector: 'app-totals-card',
  imports: [],
  template: `
    <section class="dash-card dash-totals">
      <div class="dash-totals__head">
        <p class="dash-label">{{ totals().title }}</p>
        <div class="dash-totals__toggle" role="group" [attr.aria-label]="totals().title">
          @for (option of totals().options; track option.key) {
            <button
              type="button"
              class="dash-totals__option"
              [class.dash-totals__option--on]="option.key === activeKey()"
              [attr.aria-pressed]="option.key === activeKey()"
              (click)="choose(option.key)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>

      @if (active(); as option) {
        <div class="dash-totals__figure">
          <span class="dash-value">{{ option.value }}</span>
          <span class="dash-caption">{{ option.caption }}</span>
        </div>
      }
    </section>
  `,
  styleUrl: './totals-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TotalsCardComponent {
  readonly totals = input.required<TotalsWidget>();

  private readonly chosen = signal<string | null>(null);

  /** Falls back to the first option, so the card is never blank before the
   *  reader has touched the toggle — and recovers if a chosen key disappears
   *  from a later document. */
  readonly activeKey = computed(() => {
    const options = this.totals().options;
    const chosen = this.chosen();
    if (chosen && options.some((option) => option.key === chosen)) return chosen;
    return options[0]?.key ?? null;
  });

  readonly active = computed(() => this.totals().options.find((option) => option.key === this.activeKey()) ?? null);

  choose(key: string): void {
    this.chosen.set(key);
  }
}
