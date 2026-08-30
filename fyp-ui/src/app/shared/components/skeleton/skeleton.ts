import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Skeleton shapes. Anything that loads over the API shows the SHAPE of what is
 * coming, not a spinner — a spinner tells the user "wait", a skeleton tells them
 * "here is what you are about to read", which removes the layout jump on arrival.
 *
 * Pick the variant that matches the surface being replaced, so the same kind of
 * page always waits the same way:
 *   table   — a paginated list/table (internal-data-page and friends)
 *   cards   — a responsive card grid (events, clubs, options)
 *   fields  — a stacked form / field list inside a modal or form section
 *   page    — a whole routed page: header + controls + table
 *   detail  — a read view: title banner, then labelled paragraphs
 *   list    — compact stacked rows (mobile record lists, pickers, day agendas)
 *   stats   — a KPI/metric tile row
 *   text    — bare lines, for a paragraph-shaped hole in an existing layout
 */
export type SkeletonVariant =
  | 'table'
  | 'cards'
  | 'fields'
  | 'page'
  | 'detail'
  | 'list'
  | 'stats'
  | 'text';

@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // One live region per skeleton, announced once. The individual bones are
  // decorative and stay hidden from assistive tech.
  host: {
    role: 'status',
    'aria-busy': 'true',
    '[attr.aria-label]': 'label()',
  },
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('text');
  /** How many rows / cards / fields / lines to draw. */
  readonly count = input(4);
  /** Columns per row, for the `table` variant (and the `page` header it wraps). */
  readonly columns = input(4);
  /** Screen-reader announcement. Keep it specific: "Loading events…". */
  readonly label = input('Loading…');

  protected readonly rows = computed(() => this.range(this.count()));
  protected readonly cols = computed(() => this.range(this.columns()));

  /**
   * Line widths repeat on a 4-step cycle rather than being random, so a skeleton
   * renders identically every time. Random widths shimmer differently on each
   * change-detection pass and read as flicker.
   */
  protected width(index: number): string {
    return ['92%', '68%', '84%', '54%'][index % 4];
  }

  private range(n: number): readonly number[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => i);
  }
}
