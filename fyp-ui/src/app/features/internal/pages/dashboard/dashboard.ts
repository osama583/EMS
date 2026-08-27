import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardService } from '../../../../core/dashboard/dashboard.service';
import {
  DashboardWidget,
  Drill,
  InsightCard,
  PERIOD_OPTIONS,
  PanelWidget,
  StatWidget,
} from '../../../../core/dashboard/dashboard.models';
import { ChartPanelComponent } from '../../../../shared/components/charts/chart-panel';
import { InsightCardComponent } from '../../../../shared/components/charts/insight-card';
import { StatTileComponent } from '../../../../shared/components/charts/stat-tile';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';

/**
 * `/app/dashboard` — ten role-specific dashboards, one component.
 *
 * The component computes nothing. It walks a profile document naming widget
 * ids, and every number in it arrived pre-aggregated. That is the whole design:
 * adding a Cafeteria Admin dashboard later is a server-side `PROFILES` entry,
 * with no change here, to the route, or to the response contract.
 *
 * The layout is five bands. Bands 1, 3, 4 and 5 share a skeleton across all ten
 * roles; **band 2 — the signature panel — is the role's own instrument** and is
 * the widest, tallest element on the page. That is what makes these ten
 * dashboards rather than one with ten titles.
 *
 * On a phone the order changes rather than the columns collapsing. A department
 * head on a phone is not doing analysis; they are between meetings checking
 * whether anything is on fire, so the alerts rail comes first, the quick actions
 * are promoted above the charts, and band 3 arrives collapsed.
 */
@Component({
  selector: 'app-dashboard',
  imports: [ChartPanelComponent, InsightCardComponent, StatTileComponent, LoadingStateComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly service = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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
    // A profile and a period in the URL make the switcher shareable: "look at
    // the Transport dashboard for this term" is a link rather than a set of
    // instructions. Both are validated server-side against what the caller
    // actually holds, so a hand-edited value can only ever reorder a list they
    // already own (R4).
    const params = this.route.snapshot.queryParamMap;
    const profile = params.get('profile');
    if (profile) this.service.profileId.set(profile);
    const period = params.get('period');
    if (period && PERIOD_OPTIONS.some((option) => option.key === period)) this.service.period.set(period);
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
  }

  readonly announcement = signal('');

  readonly profile = computed(() => this.document()?.profile ?? null);
  readonly noAccess = computed(() => !this.loading() && !!this.document() && !this.document()!.profile);
  readonly isNarrow = computed(() => this.narrow());

  readonly hero = computed(() => this.document()?.hero ?? null);
  readonly signature = computed(() => this.document()?.signature ?? null);
  readonly alerts = computed(() => this.document()?.alerts ?? null);
  readonly insights = computed(() => this.document()?.insights ?? []);
  readonly quickActions = computed(() => this.document()?.quickActions ?? []);
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

  readonly panels = computed<PanelWidget[]>(() => this.document()?.panels ?? []);

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

  /** Grid span for a supporting panel. Band 3 is 6+6, then 4+4+4 — the first
   *  two get the width because they are the ones the role docs put there. */
  spanFor(index: number): string {
    return index < 2 ? 'dash-col-6' : 'dash-col-4';
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
    this.service.setPeriod(key);
    this.syncUrl();
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

  exportHref(panel: PanelWidget): string {
    return this.service.exportUrl(panel.id);
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

  onStat(stat: StatWidget): void {
    this.navigate(stat.drill);
  }

  onInsight(card: InsightCard): void {
    if (!card.action) return;
    this.navigate({ route: card.action.route, params: card.action.params as Record<string, string> });
  }

  onQuickAction(action: { route: string | null; params: Record<string, string | number | boolean> }): void {
    if (!action.route) return;
    this.navigate({ route: action.route, params: action.params });
  }

  protected widgetId(_index: number, widget: DashboardWidget): string {
    return widget.id;
  }
}
