import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService } from '../../../../core/dashboard/dashboard.service';
import {
  DashboardWidget,
  Drill,
  FilterSelect,
  PERIOD_OPTIONS,
  PanelWidget,
  StatWidget,
  customPeriodKey,
  customRangeOf,
  isCustomPeriod,
} from '../../../../core/dashboard/dashboard.models';
import { ChartPanelComponent } from '../../../../shared/components/charts/chart-panel';
import { CountsStripComponent } from '../../../../shared/components/charts/counts-strip';
import { TotalsCardComponent } from '../../../../shared/components/charts/totals-card';
import { TaskCalendarComponent, TaskDateSelection } from '../../../../shared/components/task-calendar/task-calendar';
import { StatTileComponent } from '../../../../shared/components/charts/stat-tile';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton';

/**
 * `/app/dashboard` — ten role-specific dashboards, one component.
 *
 * The component computes nothing. It walks a profile document naming widget
 * ids, and every number in it arrived pre-aggregated. That is the whole design:
 * adding a Cafeteria Admin dashboard later is a server-side `PROFILES` entry,
 * with no change here, to the route, or to the response contract.
 *
 * The layout is four bands. Bands 1, 3 and 4 share a skeleton across all ten
 * roles; **band 2 — the signature panel — is the role's own instrument** and is
 * the widest, tallest element on the page. That is what makes these ten
 * dashboards rather than one with ten titles.
 *
 * On a phone the order changes rather than the columns collapsing. A department
 * head on a phone is not doing analysis; they are between meetings checking
 * whether anything is on fire, so the alerts rail comes first and band 3
 * arrives collapsed.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    SkeletonComponent,
    ChartPanelComponent,
    CountsStripComponent,
    StatTileComponent,
    TotalsCardComponent,
    TaskCalendarComponent,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly service = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly periods = PERIOD_OPTIONS;
  readonly document = this.service.document;
  readonly loading = this.service.loading;
  readonly refetching = this.service.refetching;
  readonly error = this.service.error;
  readonly stale = this.service.stale;
  readonly period = this.service.period;

  /** Band 3 arrives collapsed on a phone: on a 390px screen it is scroll cost,
   *  not analysis, and a head who wants it opens it deliberately. */
  private readonly expanded = signal<Set<string>>(new Set());
  private readonly narrow = signal(false);

  constructor() {
    // A profile and a period in the URL make the switcher shareable: "look at the Transport dashboard
    // for this term" is a link rather than a set of instructions.
    const params = this.route.snapshot.queryParamMap;
    const profile = params.get('profile');
    if (profile) this.service.profileId.set(profile);
    const period = params.get('period');
    // A custom range is `custom:<from>:<to>`, so it is not in PERIOD_OPTIONS —
    // without this a shared link to a specific range silently reverted to the
    // default on load. The server re-validates the dates either way.
    if (period && (isCustomPeriod(period) || PERIOD_OPTIONS.some((option) => option.key === period))) {
      this.service.period.set(period);
    }
    const outlet = params.get('outlet');
    if (outlet && outlet !== 'all') this.service.outlet.set(outlet);

    this.service.load();
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(max-width: 48rem)');
      this.narrow.set(query.matches);
      query.addEventListener('change', (event) => this.narrow.set(event.matches));
    }
    // Announce a change of scope politely — assertive would interrupt a screen
    // reader user mid-sentence and train them to switch the region off.
    effect(() => {
      const document = this.document();
      if (document?.profile) this.announcement.set(`${document.profile.title} dashboard, ${document.period.label}.`);
    });
    // A cross-filter selection is scoped to the document it was made against.
    effect(() => {
      this.service.profileId();
      this.service.period();
      this.service.outlet();
      this.filters.set({});
    });
  }

  readonly announcement = signal('');

  readonly profile = computed(() => this.document()?.profile ?? null);
  readonly noAccess = computed(() => !this.loading() && !!this.document() && !this.document()!.profile);
  readonly isNarrow = computed(() => this.narrow());

  readonly requestCounts = computed(() => this.document()?.requestCounts ?? null);
  readonly proposalTotals = computed(() => this.document()?.proposalTotals ?? null);
  readonly hero = computed(() => this.document()?.hero ?? null);
  readonly signature = computed(() => this.document()?.signature ?? null);
  readonly alerts = computed(() => this.document()?.alerts ?? null);
  readonly meta = computed(() => this.document()?.meta ?? null);

  /**
   * KPI order. On a phone the three tiles a role would check at a bus stop come
   * first — the server decides which, because it is a per-role judgement, not a
   * layout one.
   */
  readonly kpis = computed<StatWidget[]>(() => {
    const document = this.document();
    if (!document) return [];
    if (!this.isNarrow()) return document.kpis;
    const byId = new Map<string, StatWidget>();
    for (const kpi of document.kpis) byId.set(kpi.id, kpi);
    for (const [id, widget] of Object.entries(document.extras ?? {})) {
      if (widget.kind !== 'panel') byId.set(id, widget as StatWidget);
    }
    const ordered = document.mobile.kpiOrder.map((id) => byId.get(id)).filter((widget): widget is StatWidget => !!widget);
    const rest = document.kpis.filter((kpi) => !document.mobile.kpiOrder.includes(kpi.id));
    return [...ordered, ...rest];
  });

  /**
   * Cross-filter selections, keyed by the *target* panel id.
   *
   * Held here rather than in either panel because it is a relationship between
   * two of them, and neither is the owner. Cleared whenever a new document
   * arrives — a selection made against last period's catalogue should not
   * silently survive a period change and narrow a chart to an option that is
   * no longer in it.
   */
  private readonly filters = signal<Record<string, FilterSelect>>({});

  readonly panels = computed<PanelWidget[]>(() => {
    const panels = this.document()?.panels ?? [];
    const active = this.filters();
    if (!Object.keys(active).length) return panels;

    return panels.map((panel) => {
      // The panel that *does* the filtering: mark the selected bar so the click
      // has a visible result on the chart the reader just clicked, not only on
      // its neighbour.
      const bySource = Object.values(active).find((entry) => entry.source === panel.id);
      if (bySource && panel.crossFilter) {
        const key = panel.crossFilter.pointKey;
        return {
          ...panel,
          series: panel.series.map((entry) => ({
            ...entry,
            points: entry.points.map((point) => ({ ...point, muted: point[key] !== bySource.value })),
          })),
        };
      }

      // The panel being filtered: keep only the points whose declared key
      // matches, and say in the subtitle what the reader is looking at and how
      // to get back.
      const selection = active[panel.id];
      if (!selection) return panel;
      return {
        ...panel,
        subtitle: `Under ${selection.label} · select it again to show all`,
        series: panel.series.map((entry) => ({
          ...entry,
          points: entry.points.filter((point) => point[selection.targetKey] === selection.value),
        })),
      };
    });
  });

  /** Toggle: the same mark twice clears the filter and restores the full view. */
  onFilterSelect(event: FilterSelect): void {
    this.filters.update((current) => {
      const existing = current[event.target];
      const next = { ...current };
      if (existing && existing.value === event.value) {
        delete next[event.target];
        this.announcement.set(`${event.label} cleared. Showing all.`);
        return next;
      }
      next[event.target] = event;
      this.announcement.set(`Filtered to ${event.label}.`);
      return next;
    });
  }

  readonly switchable = computed(() => {
    const profile = this.profile();
    return profile && profile.switchable.length > 1 ? profile.switchable : [];
  });

  readonly outlets = computed(() => {
    const profile = this.profile();
    return profile && profile.outlets.length > 1 ? profile.outlets : [];
  });

  readonly generatedLabel = computed(() => {
    const meta = this.meta();
    if (!meta) return '';
    const time = new Date(meta.generatedAt);
    const clock = Number.isNaN(time.getTime())
      ? meta.generatedAt
      : time.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
    return meta.cached || this.stale() ? `Cached ${clock}` : clock;
  });

  /**
   * Grid span for a supporting panel: **two panels per row**, half the width
   * each, with a lone trailing panel taking the full width.
   *
   * Pairs rather than the old 6+6-then-4+4+4 because that shape only packed
   * evenly at exactly two or exactly five panels. At three it produced 6+6 then
   * a single 4, leaving two thirds of the last row empty beside a chart that
   * had been squeezed into a third of the width for no reason; at four it put
   * two full-width-ish panels above two narrow ones, so the same kind of chart
   * rendered at two different sizes on one page.
   *
   * Pairing makes every panel the same width and every row full, which is both
   * the layout asked for and the one that keeps two charts of the same kind
   * comparable — a bar chart at half width beside the same bar chart at a third
   * invites reading the difference as data.
   */
  spanFor(index: number): string {
    const total = this.panels().length;
    // The last panel of an odd-numbered set has no partner, so it takes the row.
    const isLonelyLast = index === total - 1 && total % 2 === 1;
    return isLonelyLast ? 'dash-col-12' : 'dash-col-6';
  }

  isExpanded(panel: PanelWidget): boolean {
    return !this.isNarrow() || this.expanded().has(panel.id);
  }

  togglePanel(panel: PanelWidget): void {
    this.expanded.update((open) => {
      const next = new Set(open);
      if (next.has(panel.id)) next.delete(panel.id);
      else next.add(panel.id);
      return next;
    });
  }

  setPeriod(key: string): void {
    this.pickerOpen.set(false);
    this.service.setPeriod(key);
    this.syncUrl();
  }

  // --- Custom range -------------------------------------------------------
  //
  // The picker holds a *draft* rather than writing straight through to the
  // service. Two dates make one window, and applying on each field's change
  // would fire a request against a half-chosen range - and, worse, briefly show
  // the reader numbers for a window they did not ask for.

  readonly pickerOpen = signal(false);

  private readonly todayIso = toIsoDay(new Date());

  /** The calendar's own selection shape. Held as a draft rather than written
   *  through, because a range is only meaningful once both ends are picked —
   *  applying on the first click would fetch a one-day window nobody asked for. */
  readonly draftSelection = signal<TaskDateSelection>({ start: this.todayIso, end: null });

  readonly isCustomPeriod = computed(() => isCustomPeriod(this.period()));

  /** A range needs both ends. The calendar reports the first click as
   *  `{ start, end: null }`, which is a half-made choice, not a one-day range. */
  readonly draftComplete = computed(() => !!this.draftSelection().end);

  readonly draftHint = computed(() => {
    const { start, end } = this.draftSelection();
    if (!end) return 'Pick the second date to close the range.';
    return `${formatDay(start)} to ${formatDay(end)}`;
  });

  togglePicker(): void {
    if (this.pickerOpen()) {
      this.closePicker();
      return;
    }
    // Reopening on an active custom range shows that range, so the reader is
    // adjusting what they picked rather than starting from a blank calendar.
    const current = customRangeOf(this.period());
    this.draftSelection.set(
      current ? { start: current.from, end: current.to } : { start: this.todayIso, end: null },
    );
    this.pickerOpen.set(true);
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  setDraftSelection(value: TaskDateSelection): void {
    this.draftSelection.set(value);
  }

  applyCustom(): void {
    const { start, end } = this.draftSelection();
    if (!end) return;
    // The calendar already orders the two ends, so no swap is needed here — but
    // the server re-checks anyway, since the key can also arrive from a URL.
    this.pickerOpen.set(false);
    this.service.setPeriod(customPeriodKey(start, end));
    this.syncUrl();
  }

  /** Click-outside and Escape, matching the calendar's behaviour on the
   *  cafeteria queue — a popover that only closes via its own Cancel button is
   *  a popover people leave open by accident. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.pickerOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.pickerOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.pickerOpen.set(false);
  }

  setProfile(event: Event): void {
    this.service.setProfile((event.target as HTMLSelectElement).value);
    this.syncUrl();
  }

  setOutlet(event: Event): void {
    this.service.setOutlet((event.target as HTMLSelectElement).value);
    this.syncUrl();
  }

  /** Reflect the active scope in the URL without adding a history entry — the
   *  back button should leave the dashboard, not step through filter changes. */
  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        profile: this.service.profileId() ?? null,
        period: this.service.period(),
        outlet: this.service.outlet() ?? null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  refresh(): void {
    this.service.load({ refresh: true });
  }

  retry(): void {
    this.service.load({ refresh: true });
  }

  /**
   * Every drill re-authorises at its destination. The dashboard passes filters,
   * never rows or ids the destination would not have granted on its own — a
   * tampered query string yields an empty filtered page rather than a leak.
   */
  navigate(drill: Drill | null | undefined): void {
    if (!drill?.route) return;
    if (drill.route.startsWith('#')) {
      // An in-page anchor: the KPI that names a breach scrolls to the panel
      // showing it rather than reloading the page around it.
      const element = window.document.getElementById(drill.route.slice(1));
      element?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      element?.focus?.();
      return;
    }
    void this.router.navigate([drill.route], { queryParams: drill.params });
  }

  protected widgetId(_index: number, widget: DashboardWidget): string {
    return widget.id;
  }
}

/** `YYYY-MM-DD` in the *local* calendar. `toISOString()` converts to UTC first,
 *  which in Malaysia (UTC+8) rolls the date back a day for most of the evening —
 *  so "today" would have been yesterday from 8am onward. */
function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "1 Aug 2026" from an ISO day, parsed as local rather than UTC for the same
 *  reason as above. */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
