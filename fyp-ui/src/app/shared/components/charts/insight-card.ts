import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { InsightCard } from '../../../core/dashboard/dashboard.models';
import { formatValue } from './viz';

const SEVERITY_ICON: Record<string, string> = {
  critical: 'dangerous',
  serious: 'warning',
  warning: 'error',
  info: 'lightbulb',
};

/**
 * One decision-support card.
 *
 * Severity is icon + word + colour. `warning` and `serious` sit below 3:1 on
 * white by design, and the icon and the word are what carry them — a reader
 * with a colour vision deficiency, or a printed page, loses nothing.
 *
 * **Evidence is always rendered.** The metric id, the value and the window are
 * printed under the body so a reader can disagree with the card on the merits
 * rather than on faith.
 *
 * **No action means no button.** AI-31 detects a routing defect nobody can fix
 * from a dashboard; offering a link the API would refuse is worse than offering
 * none.
 */
@Component({
  selector: 'app-insight-card',
  imports: [],
  template: `
    <article class="dash-insight" [class]="'dash-insight--' + card().severity">
      <header class="dash-insight__head">
        <span class="dash-insight__severity">
          <span class="material-symbols-rounded" aria-hidden="true">{{ icon() }}</span>
          {{ card().severity }}
        </span>
        <h4 class="dash-insight__title">{{ card().title }}</h4>
      </header>

      <p class="dash-insight__body">{{ card().body }}</p>

      <p class="dash-insight__evidence">
        @for (fact of evidence(); track fact.key) {
          <span class="dash-insight__fact">{{ fact.text }}</span>
        }
      </p>

      @if (card().action; as action) {
        <button type="button" class="dash-insight__action" (click)="act.emit(card())">
          {{ action.label }}
          <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
        </button>
      } @else {
        <p class="dash-insight__no-action">Nothing on this page can resolve this.</p>
      }
    </article>
  `,
  styleUrl: './insight-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightCardComponent {
  readonly card = input.required<InsightCard>();
  readonly act = output<InsightCard>();

  readonly icon = computed(() => SEVERITY_ICON[this.card().severity] ?? 'info');

  readonly evidence = computed(() => {
    const evidence = this.card().evidence ?? {};
    const out: { key: string; text: string }[] = [];
    if (evidence['metric']) out.push({ key: 'metric', text: String(evidence['metric']) });
    if (evidence['value'] !== undefined && evidence['value'] !== null) {
      const value = evidence['value'];
      out.push({
        key: 'value',
        text: typeof value === 'number' && value <= 1 && value >= 0 && !Number.isInteger(value)
          ? formatValue(value, 'percent')
          : formatValue(value, 'number'),
      });
    }
    if (evidence['window']) out.push({ key: 'window', text: String(evidence['window']) });
    if (evidence['sample']) out.push({ key: 'sample', text: `${evidence['sample']} observations` });
    if (evidence['date']) out.push({ key: 'date', text: formatValue(evidence['date'], 'date') });
    if (evidence['target'] !== undefined && evidence['target'] !== null) {
      out.push({ key: 'target', text: `target ${formatValue(evidence['target'], 'number')}` });
    }
    return out;
  });
}
