import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../../environments/environment';
import { DashboardDocument, PanelWidget, StatWidget } from '../../../../core/dashboard/dashboard.models';
import { DashboardComponent } from './dashboard';

/**
 * The load-bearing test is the first one: the component renders a document
 * naming widgets it has never been told about. That guarantee is why adding the
 * ninth and tenth role dashboards cost a server-side `PROFILES` entry and no
 * change here.
 */

function stat(id: string, overrides: Partial<StatWidget> = {}): StatWidget {
  return {
    id,
    kind: 'kpi',
    state: 'ok',
    label: `Label for ${id}`,
    value: 12,
    format: 'count',
    secondary: null,
    caption: null,
    target: null,
    status: 'good',
    delta: null,
    sparkline: [],
    definition: null,
    caveat: null,
    drill: null,
    empty: null,
    ...overrides,
  };
}

function panel(id: string, overrides: Partial<PanelWidget> = {}): PanelWidget {
  return {
    id,
    kind: 'panel',
    state: 'ok',
    title: `Panel ${id}`,
    subtitle: null,
    chart: 'bar-chart',
    data: null,
    series: [
      { key: 'a', label: 'A', colorSlot: 1, points: [{ x: 3, label: 'One' }, { x: 1, label: 'Two' }] },
    ],
    axes: { x: { type: 'linear', format: 'count' } },
    annotations: [],
    caption: null,
    caveat: null,
    empty: 'Nothing here yet.',
    filters: [],
    drill: null,
    signature: false,
    mobile: null,
    ...overrides,
  };
}

/** A profile nothing in the client has heard of: unknown key, unknown widget
 *  ids. */
function inventedDocument(): DashboardDocument {
  return {
    profile: {
      id: 'hod_hydroponics:hydroponics_unit',
      key: 'hod_hydroponics',
      variant: null,
      roleCode: 'head-of-department',
      unitCode: 'hydroponics_unit',
      unitLabel: 'Hydroponics',
      title: 'Hydroponics',
      eyebrow: 'Greenhouse operations',
      switchable: [],
      outlets: [],
      activeOutlet: 'all',
    },
    period: {
      key: '30d',
      label: 'Last 30 days',
      from: '2026-07-29',
      to: '2026-08-28',
      comparedTo: { from: '2026-06-29', to: '2026-07-29', label: 'previous 30 days' },
    },
    requestCounts: null,
    hero: stat('hyd_nutrient_balance', { kind: 'hero', label: 'Nutrient balance', value: 0.94, format: 'ratio' }),
    kpis: [stat('hyd_ph_drift'), stat('hyd_light_hours'), stat('hyd_yield')],
    signature: panel('hyd_bed_occupancy', { signature: true, title: 'Bed occupancy', chart: 'heatmap', data: { rows: ['Bed 1'], columns: ['2026-08-27'], cells: [{ label: 'Bed 1', date: '2026-08-27', ratio: 0.4 }], threshold: 1 } }),
    panels: [panel('hyd_flow_rate'), panel('hyd_harvest_window', { chart: 'column-chart' })],
    alerts: panel('hyd_at_risk', { chart: 'alert-list', title: 'At risk', data: { stalled: { count: 3, thresholdHours: 96 } } }),
    quickActions: [{ key: 'review_inbox', label: 'Review inbox', icon: 'inbox', route: '/app/inbox/requests', params: {}, badge: 4 }],
    mobile: { kpiOrder: ['hyd_yield', 'hyd_ph_drift', 'hyd_light_hours'] },
    extras: {},
    meta: {
      generatedAt: '2026-08-27T09:14:00',
      queryMs: 214,
      suppressedBuckets: 2,
      foldedSeries: 1,
      cached: false,
      widgetCount: 8,
    },
  };
}

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  function flush(document: Record<string, unknown>): void {
    fixture.detectChanges();
    httpMock.expectOne((request) => request.url === `${environment.apiBaseUrl}/dashboard`).flush(document);
    fixture.detectChanges();
  }

  it('renders a profile document it has never seen, driven only by widget ids', () => {
    flush(inventedDocument() as unknown as Record<string, unknown>);
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Hydroponics');
    expect(text).toContain('Greenhouse operations');
    // Hero, three KPI tiles.
    expect(fixture.nativeElement.querySelectorAll('app-stat-tile')).toHaveLength(4);
    expect(text).toContain('Nutrient balance');
    // Signature, two supporting panels, and the alerts rail.
    expect(fixture.nativeElement.querySelectorAll('app-chart-panel').length).toBeGreaterThanOrEqual(3);
    expect(text).toContain('Bed occupancy');
  });

  /**
   * The CFO's funding pair. The behaviour under test is the *toggle*: a reader
   * who narrows the sub-item chart has to be able to get back out of it, and a
   * one-way filter with no exit is the failure mode worth a test.
   */
  describe('cross-filtered panels', () => {
    function fundingDocument(): DashboardDocument {
      const main = panel('cfo_funding_main_usage', {
        title: 'Funding main items',
        crossFilter: {
          target: 'cfo_funding_sub_usage',
          pointKey: 'optionId',
          targetKey: 'mainOptionId',
          labelKey: 'label',
        },
        series: [
          {
            key: 'selections',
            label: 'Selections',
            colorSlot: 1,
            points: [
              { x: 3, label: 'Equipment Rental', optionId: 5 },
              { x: 1, label: 'Speaker & Talent', optionId: 4 },
            ],
          },
        ],
      });
      const sub = panel('cfo_funding_sub_usage', {
        title: 'Funding sub-items',
        series: [
          {
            key: 'selections',
            label: 'Selections',
            colorSlot: 2,
            points: [
              { x: 2, label: 'AV Equipment Hire', optionId: 9, mainOptionId: 5 },
              { x: 1, label: 'Furniture Hire', optionId: 10, mainOptionId: 5 },
              { x: 1, label: 'Speaker Honorarium', optionId: 7, mainOptionId: 4 },
            ],
          },
        ],
      });
      return { ...inventedDocument(), panels: [main, sub] };
    }

    function subPoints() {
      return fixture.componentInstance.panels().find((p) => p.id === 'cfo_funding_sub_usage')!.series[0].points;
    }

    const selectEquipmentRental = {
      source: 'cfo_funding_main_usage',
      target: 'cfo_funding_sub_usage',
      targetKey: 'mainOptionId',
      value: 5,
      label: 'Equipment Rental',
    };

    it('shows every sub-item until a main item is selected', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      expect(subPoints()).toHaveLength(3);
    });

    it('narrows the sub-items to the selected main item', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.detectChanges();

      const points = subPoints();
      expect(points).toHaveLength(2);
      expect(points.map((p) => p.label)).toEqual(['AV Equipment Hire', 'Furniture Hire']);
      // Every survivor belongs to the selected main item.
      expect(points.every((p) => p['mainOptionId'] === 5)).toBe(true);
    });

    it('says which main item is in force, and how to leave', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.detectChanges();

      const sub = fixture.componentInstance.panels().find((p) => p.id === 'cfo_funding_sub_usage')!;
      expect(sub.subtitle).toContain('Equipment Rental');
      expect(sub.subtitle).toContain('select it again');
    });

    it('mutes the unselected bars on the panel doing the filtering', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.detectChanges();

      const main = fixture.componentInstance.panels().find((p) => p.id === 'cfo_funding_main_usage')!;
      expect(main.series[0].points.map((p) => p['muted'])).toEqual([false, true]);
    });

    it('restores the overall view when the same main item is selected again', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.detectChanges();
      expect(subPoints()).toHaveLength(2);

      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.detectChanges();
      expect(subPoints()).toHaveLength(3);
    });

    it('replaces the selection when a different main item is chosen', () => {
      flush(fundingDocument() as unknown as Record<string, unknown>);
      fixture.componentInstance.onFilterSelect(selectEquipmentRental);
      fixture.componentInstance.onFilterSelect({ ...selectEquipmentRental, value: 4, label: 'Speaker & Talent' });
      fixture.detectChanges();

      const points = subPoints();
      expect(points).toHaveLength(1);
      expect(points[0].label).toBe('Speaker Honorarium');
    });
  });

  it('renders the R8 footnote when the server withheld buckets', () => {
    flush(inventedDocument() as unknown as Record<string, unknown>);
    const footer = fixture.nativeElement.querySelector('.dash__footer').textContent as string;
    // Silently dropping buckets would misstate every chart on the page.
    expect(footer).toContain('2 bucket(s) below the reporting threshold');
    expect(footer).toContain('1 series folded');
  });

  it('fails closed to a no-access panel rather than a blank page', () => {
    flush({ profile: null, reason: 'no_dashboard_profile', message: 'You do not hold a role with a dashboard.' });
    expect(fixture.nativeElement.querySelector('.dash__no-access')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('You do not hold a role with a dashboard.');
    expect(fixture.nativeElement.querySelector('app-chart-panel')).toBeNull();
  });

  it('sends the period as a query parameter and re-requests on a change', () => {
    flush(inventedDocument() as unknown as Record<string, unknown>);
    fixture.componentInstance.setPeriod('90d');
    fixture.detectChanges();
    const request = httpMock.expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/dashboard`);
    expect(request.request.params.get('period')).toBe('90d');
    request.flush(inventedDocument() as unknown as Record<string, unknown>);
  });

  it('never sends a unit parameter', () => {
    // R4: unit scope comes from the principal's own assignments. A client that
    // could ask for another unit's data would make the rule unenforceable.
    fixture.detectChanges();
    const request = httpMock.expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/dashboard`);
    expect(request.request.params.has('unit')).toBe(false);
    request.flush(inventedDocument() as unknown as Record<string, unknown>);
  });

  it('holds the previous render when a refresh fails, and says so', () => {
    flush(inventedDocument() as unknown as Record<string, unknown>);
    fixture.componentInstance.refresh();
    fixture.detectChanges();
    httpMock
      .expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/dashboard`)
      .error(new ProgressEvent('offline'));
    fixture.detectChanges();

    // The numbers stay on screen; only their freshness is in question.
    expect(fixture.nativeElement.textContent).toContain('Nutrient balance');
    expect(fixture.nativeElement.querySelector('.dash__banner--error')).not.toBeNull();
  });

  it('renders the request counts strip when the server sends one', () => {
    const document = inventedDocument();
    document.requestCounts = {
      kind: 'counts',
      items: [
        { key: 'inbox', label: 'Inbox', value: 3, status: 'unknown', drill: null },
        { key: 'ongoing', label: 'Ongoing', value: 5, status: 'unknown', drill: null },
        { key: 'completed', label: 'Completed', value: 40, status: 'good', drill: null },
        { key: 'late', label: 'Late', value: 1, status: 'critical', drill: null },
      ],
    };
    flush(document as unknown as Record<string, unknown>);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Inbox');
    expect(text).toContain('Late');
    expect(fixture.nativeElement.querySelectorAll('.dash-counts__item')).toHaveLength(4);
  });

  it('scrolls to an in-page anchor rather than navigating for a panel drill', () => {
    flush(inventedDocument() as unknown as Record<string, unknown>);
    // The rendered signature panel carries its own anchor id, which is what a
    // KPI drill targets.
    const anchor = document.getElementById('panel-hyd_bed_occupancy');
    expect(anchor).not.toBeNull();
    let scrolled = false;
    anchor!.scrollIntoView = () => {
      scrolled = true;
    };

    fixture.componentInstance.navigate({ route: '#panel-hyd_bed_occupancy', params: {} });
    expect(scrolled).toBe(true);
  });

  afterEach(() => {
    httpMock.verify({ ignoreCancelled: true });
  });
});
