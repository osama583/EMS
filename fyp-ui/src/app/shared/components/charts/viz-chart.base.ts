import { Directive, computed, input, output, signal } from '@angular/core';
import { Annotation, Axes, Point, Series } from '../../../core/dashboard/dashboard.models';
import { MOBILE_BREAKPOINT, formatAxis, formatValue, slotColor, useHostWidth } from './viz';

export interface MarkEvent {
  seriesKey: string;
  point: Point;
}

/**
 * What every SVG chart here shares: a measured width, a plot box, and the
 * hover/focus plumbing.
 *
 * The plot box **includes the axis band**. Fixing a height that excludes it is
 * how a card ends up with a tiny nested scrollbar, and it is the single most
 * common way a hand-rolled chart goes wrong in a responsive grid.
 */
@Directive()
export abstract class VizChartBase {
  readonly series = input<Series[]>([]);
  readonly axes = input<Axes>({});
  readonly annotations = input<Annotation[]>([]);
  readonly data = input<Record<string, unknown> | null>(null);
  readonly markSelect = output<MarkEvent>();

  protected readonly hostWidth = useHostWidth();
  protected readonly hovered = signal<MarkEvent | null>(null);

  /** Below this the desktop form is replaced by the panel's declared fallback:
   *  a 30-column heatmap is unreadable at any cell size on a 390px screen. */
  readonly isNarrow = computed(() => this.hostWidth() < MOBILE_BREAKPOINT);

  /** Plot geometry. Left gutter widens for currency, which is the longest tick
   *  label this app produces. */
  protected readonly padding = computed(() => {
    const currency = this.axes().y?.format === 'currency';
    return {
      top: 14,
      right: 16,
      bottom: 30,
      left: this.isNarrow() ? (currency ? 48 : 36) : currency ? 62 : 46,
    };
  });

  protected abstract plotHeight(): number;

  readonly width = computed(() => Math.max(240, this.hostWidth()));
  readonly height = computed(() => this.plotHeight());
  readonly innerWidth = computed(() => Math.max(40, this.width() - this.padding().left - this.padding().right));
  readonly innerHeight = computed(() => Math.max(40, this.height() - this.padding().top - this.padding().bottom));

  colorFor(slot: number | undefined): string {
    return slotColor(slot);
  }

  axisLabel(value: unknown, axis: 'x' | 'y'): string {
    const spec = this.axes()[axis];
    return formatAxis(value, spec?.format, spec?.type);
  }

  valueLabel(value: unknown): string {
    return formatValue(value, this.axes().y?.format ?? 'number');
  }

  select(seriesKey: string, point: Point): void {
    this.markSelect.emit({ seriesKey, point });
  }

  hover(seriesKey: string, point: Point): void {
    this.hovered.set({ seriesKey, point });
  }

  clearHover(): void {
    this.hovered.set(null);
  }

  isHovered(seriesKey: string, point: Point): boolean {
    const active = this.hovered();
    return !!active && active.seriesKey === seriesKey && active.point === point;
  }
}
