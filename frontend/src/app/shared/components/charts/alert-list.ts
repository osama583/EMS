import { ChangeDetectionStrategy, Component, computed, output } from '@angular/core';
import { Drill } from '../../../core/dashboard/dashboard.models';
import { VizChartBase } from './viz-chart.base';
import { formatValue } from './viz';

/**
 * The alerts rail — everything that needs a person, in one column.
 *
 * Not a chart: these are counts of things to act on, and a bar chart of "3
 * stalled, 2 unpriced, 1 stranded" would be three bars and no information. Each
 * row states the count, the soonest date where there is one, and links to the
 * filtered list.
 *
 * Rows are only emitted when they have something to say. A rail padded with
 * zeroes teaches people to skim past it, which is the failure mode that costs
 * the one row that mattered.
 */
@Component({
  selector: 'app-alert-list',
  imports: [],
  template: `
    @if (rows().length) {
      <ul class="viz-alerts">
        @for (row of rows(); track row.key) {
          <li class="viz-alert" [class]="'viz-alert--' + row.tone">
            <span class="material-symbols-rounded viz-alert__icon" aria-hidden="true">{{ row.icon }}</span>
            <span class="viz-alert__body">
              <span class="viz-alert__title">{{ row.title }}</span>
              @if (row.detail) { <span class="viz-alert__detail">{{ row.detail }}</span> }
            </span>
            <span class="viz-alert__count">{{ row.count }}</span>
          </li>
        }
      </ul>
    } @else {
      <!-- The same neutral viz-empty container every other panel uses when it
           has nothing to draw. A green "all clear" card reads as a result —
           the one positive-coloured block on a page whose colours otherwise all
           mean "act on me" — and it drew the eye hardest when it had the least
           to say. Empty is empty, in every panel, in the same grey. -->
      <p class="viz-empty">Nothing needs attention right now.</p>
    }

    @if (items().length) {
      <ul class="viz-alerts__items">
        @for (item of items(); track $index) {
          <li>
            <button type="button" class="viz-alerts__item" (click)="open.emit({ route: '/app/proposals/review/' + item.requestId, params: {} })">
              <span class="viz-alerts__item-date">{{ dateOf(item.date) }}</span>
              <span class="viz-alerts__item-title">{{ item.eventTitle || item.requestCode }}</span>
              <span class="viz-alerts__item-status">{{ item.status }}</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './alert-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertListComponent extends VizChartBase {
  readonly open = output<Drill>();

  protected plotHeight(): number {
    return 0;
  }

  readonly items = computed(
    () =>
      ((this.data()?.['items'] as { requestId: number; requestCode: string; date: string; eventTitle: string; status: string }[]) ?? []).slice(
        0,
        6,
      ),
  );

  readonly rows = computed(() => {
    const data = this.data() ?? {};
    const out: { key: string; title: string; detail: string | null; count: string; icon: string; tone: string }[] = [];

    const items = this.items();
    if (items.length) {
      out.push({
        key: 'at-risk',
        title: 'Inside the risk window',
        detail: `soonest ${this.dateOf(items[0].date)}`,
        count: String((data['items'] as unknown[]).length),
        icon: 'schedule',
        tone: 'critical',
      });
    }

    const counts = data['counts'] as { pending?: number; approved?: number; preparing?: number; count?: number } | undefined;
    if (counts?.count) {
      out.push({
        key: 'orders',
        title: 'Live orders at risk',
        detail: `${counts.pending ?? 0} to accept · ${counts.approved ?? 0} unclaimed · ${counts.preparing ?? 0} in the kitchen`,
        count: String(counts.count),
        icon: 'restaurant',
        tone: counts.pending || counts.approved ? 'critical' : 'warning',
      });
    }

    const stalled = data['stalled'] as { count?: number; thresholdHours?: number } | undefined;
    if (stalled?.count) {
      out.push({
        key: 'stalled',
        title: 'Stalled work',
        detail: `open beyond ${formatValue(stalled.thresholdHours, 'hours')} — twice this unit's own median`,
        count: String(stalled.count),
        icon: 'hourglass_bottom',
        tone: 'serious',
      });
    }

    const locked = data['cancellationLocked'];
    if (typeof locked === 'number' && locked > 0) {
      out.push({
        key: 'locked',
        title: 'Past the cancellation deadline',
        detail: 'these can no longer be cancelled, so the work must be delivered',
        count: String(locked),
        icon: 'lock_clock',
        tone: 'warning',
      });
    }

    const gate = data['gateQueue'] as { count?: number; oldest?: string | null } | undefined;
    if (gate?.count) {
      out.push({
        key: 'gate',
        title: 'Waiting at your gate',
        detail: gate.oldest ? `oldest submitted ${this.dateOf(gate.oldest)}` : null,
        count: String(gate.count),
        icon: 'gavel',
        tone: 'serious',
      });
    }

    const uncollected = data['uncollected'];
    if (typeof uncollected === 'number' && uncollected > 0) {
      out.push({
        key: 'uncollected',
        title: 'Earned and not received',
        detail: 'registration payments still outstanding',
        count: formatValue(uncollected, 'currency'),
        icon: 'payments',
        tone: 'serious',
      });
    }

    const unpriced = (data['unpriced'] as { label: string }[]) ?? [];
    if (unpriced.length) {
      out.push({
        key: 'unpriced',
        title: 'Unpriced items with live orders',
        detail: `starting with ${unpriced[0].label} — each understates every cost figure`,
        count: String(unpriced.length),
        icon: 'price_change',
        tone: 'warning',
      });
    }

    const concentration = data['claimConcentration'] as { name: string; share: number } | null | undefined;
    if (concentration) {
      out.push({
        key: 'claims',
        title: `${concentration.name} claims most of the pool`,
        detail: 'may simply be their shift — worth a look either way',
        count: formatValue(concentration.share, 'percent'),
        icon: 'group',
        tone: 'warning',
      });
    }

    const stranded = (data['stranded'] as { count: number; unitLabel: string }[]) ?? [];
    if (stranded.length) {
      const total = stranded.reduce((sum, entry) => sum + entry.count, 0);
      out.push({
        key: 'stranded',
        title: 'Stranded with no qualifying reviewer',
        detail: `from ${stranded.map((entry) => entry.unitLabel).join(', ')} — needs a System Administrator`,
        count: String(total),
        icon: 'report',
        tone: 'critical',
      });
    }

    return out;
  });

  dateOf(value: string | null | undefined): string {
    return value ? formatValue(value, 'date') : '—';
  }
}
