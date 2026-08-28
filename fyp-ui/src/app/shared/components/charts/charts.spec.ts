import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { PanelWidget, Series, StatWidget } from '../../../core/dashboard/dashboard.models';
import { ChartFrameComponent } from './chart-frame';
import { ChartPanelComponent } from './chart-panel';
import { StatTileComponent } from './stat-tile';
import { formatValue, niceDomain, rampColor, slotColor } from './viz';

function panel(overrides: Partial<PanelWidget> = {}): PanelWidget {
  return {
    id: 'test_panel',
    kind: 'panel',
    state: 'ok',
    title: 'Where the lane time goes',
    subtitle: 'Median hours per week',
    chart: 'stacked-bar',
    data: null,
    series: [],
    axes: { x: { type: 'date' }, y: { type: 'linear', format: 'hours' } },
    annotations: [],
    caption: null,
    caveat: null,
    empty: 'No tasks have completed a full cycle in this period yet.',
    filters: [],
    drill: null,
    signature: false,
    mobile: null,
    ...overrides,
  };
}

function stat(overrides: Partial<StatWidget> = {}): StatWidget {
  return {
    id: 'test_kpi',
    kind: 'kpi',
    state: 'ok',
    label: 'Decision latency',
    value: 31,
    format: 'hours',
    secondary: 'p90 74h',
    caption: '12 decisions in period',
    target: { max: 48, label: 'target <= 48h' },
    status: 'good',
    delta: { value: -4, percent: -0.11, direction: 'down', isGood: true },
    sparkline: [],
    definition: 'M10',
    caveat: null,
    drill: null,
    empty: null,
    ...overrides,
  };
}

function series(count: number): Series[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `s${index}`,
    label: `Series ${index + 1}`,
    colorSlot: index + 1,
    points: [
      { x: '2026-08-03', y: 4 + index },
      { x: '2026-08-10', y: 6 + index },
      { x: '2026-08-17', y: 5 + index },
    ],
  }));
}

@Component({
  selector: 'app-frame-host',
  imports: [ChartFrameComponent],
  template: `<app-chart-frame [panel]="current()" [empty]="empty()"><p class="chart-body">chart</p></app-chart-frame>`,
})
class FrameHost {
  readonly current = signal<PanelWidget>(panel());
  readonly empty = signal(false);
}

describe('chart-frame', () => {
  let fixture: ComponentFixture<FrameHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FrameHost] }).compileComponents();
    fixture = TestBed.createComponent(FrameHost);
  });

  it('shows a legend at two series and hides it at one', () => {
    fixture.componentInstance.current.set(panel({ series: series(1) }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dash-panel__legend')).toBeNull();

    fixture.componentInstance.current.set(panel({ series: series(2) }));
    fixture.detectChanges();
    const legend = fixture.nativeElement.querySelector('.dash-panel__legend');
    expect(legend).not.toBeNull();
    expect(legend.querySelectorAll('.dash-legend__item')).toHaveLength(2);
  });

  it('names what would populate an empty panel rather than saying "no data"', () => {
    fixture.componentInstance.empty.set(true);
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('.viz-empty').textContent.trim();
    expect(text).toBe('No tasks have completed a full cycle in this period yet.');
    expect(text.toLowerCase()).not.toBe('no data');
  });

  it('renders an inline retry on an error without blanking the card', () => {
    fixture.componentInstance.current.set(panel({ state: 'error', message: 'This panel could not be loaded.' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dash-panel__title').textContent).toContain('Where the lane time goes');
    expect(fixture.nativeElement.querySelector('.dash-panel__retry')).not.toBeNull();
  });

  it('renders the chart body with no table/CSV escape hatch', () => {
    fixture.componentInstance.current.set(panel({ series: series(1) }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-body')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dash-panel__tool')).toBeNull();
  });
});

@Component({
  selector: 'app-panel-host',
  imports: [ChartPanelComponent],
  template: `<app-chart-panel [panel]="current()" />`,
})
class PanelHost {
  readonly current = signal<PanelWidget>(panel());
}

describe('chart-panel', () => {
  let fixture: ComponentFixture<PanelHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PanelHost] }).compileComponents();
    fixture = TestBed.createComponent(PanelHost);
  });

  it('renders a panel naming a chart form it has never been configured for', () => {
    // The declarative-layout guarantee: the component knows chart forms, not
    // dashboards. A profile it has never seen must still render.
    for (const chart of ['line-chart', 'area-chart', 'column-chart', 'bar-chart', 'dot-plot'] as const) {
      fixture.componentInstance.current.set(panel({ id: `p_${chart}`, chart, series: series(2) }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.dash-panel__title')).not.toBeNull();
    }
  });

  it('lays a stacked bar horizontally when the category axis is y', () => {
    const component = fixture.debugElement.children[0].componentInstance as ChartPanelComponent;
    fixture.componentInstance.current.set(panel({ chart: 'stacked-bar', axes: { y: { type: 'category' } }, series: series(2) }));
    fixture.detectChanges();
    expect(component.form()).toBe('bar');

    fixture.componentInstance.current.set(panel({ chart: 'stacked-bar', axes: { x: { type: 'date' }, y: { type: 'linear' } }, series: series(2) }));
    fixture.detectChanges();
    expect(component.form()).toBe('column');
  });

  it('treats a panel with no populated series as empty', () => {
    const component = fixture.debugElement.children[0].componentInstance as ChartPanelComponent;
    fixture.componentInstance.current.set(panel({ chart: 'line-chart', series: [] }));
    fixture.detectChanges();
    expect(component.isEmpty()).toBe(true);

    fixture.componentInstance.current.set(panel({ chart: 'line-chart', series: series(1) }));
    fixture.detectChanges();
    expect(component.isEmpty()).toBe(false);
  });

  it('prefers a mark own identity over the panel default when drilling', () => {
    const component = fixture.debugElement.children[0].componentInstance as ChartPanelComponent;
    const seen: { route: string; params: Record<string, unknown> }[] = [];
    component.drill.subscribe((event) => seen.push(event));

    fixture.componentInstance.current.set(
      panel({ chart: 'bar-chart', drill: { route: '/app/inbox/requests', params: { requestKind: 'soundLight' } } }),
    );
    fixture.detectChanges();

    component.onMark({ seriesKey: 's0', point: { requestId: 42, label: 'x' } });
    expect(seen[0].route).toBe('/app/proposals/review/42');

    component.onMark({ seriesKey: 's0', point: { optionId: 7, label: 'Speakers' } });
    expect(seen[1].route).toBe('/app/inbox/requests');
    expect(seen[1].params).toEqual({ requestKind: 'soundLight', item: 7 });
  });
});

@Component({
  selector: 'app-tile-host',
  imports: [StatTileComponent],
  template: `<app-stat-tile [stat]="current()" />`,
})
class TileHost {
  readonly current = signal<StatWidget>(stat());
}

describe('stat-tile', () => {
  let fixture: ComponentFixture<TileHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TileHost] }).compileComponents();
    fixture = TestBed.createComponent(TileHost);
  });

  it('separates the direction of a change from whether it is good', () => {
    const component = fixture.debugElement.children[0].componentInstance as StatTileComponent;
    // Latency falling is 'down' and good; coverage falling is 'down' and bad.
    expect(component.deltaTone('down', true)).toBe('good');
    expect(component.deltaTone('down', false)).toBe('bad');
    expect(component.deltaTone('flat', false)).toBe('flat');
  });

  it('renders an em dash and an explanation rather than a zero when there is no value', () => {
    fixture.componentInstance.current.set(stat({ value: null, empty: 'No decisions were taken in this period.' }));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(fixture.nativeElement.querySelector('.dash-value--empty').textContent.trim()).toBe('—');
    expect(text).toContain('No decisions were taken in this period.');
    expect(text).not.toContain('0h');
  });

  it('renders the caveat inside the card, not as a footnote', () => {
    fixture.componentInstance.current.set(stat({ caveat: 'Assumes a uniform 8h shift (gap G2).' }));
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.dash-stat');
    expect(card.querySelector('.dash-caveat').textContent).toContain('gap G2');
  });

  it('renders status as icon plus word plus colour, never colour alone', () => {
    fixture.componentInstance.current.set(stat({ status: 'critical', target: null }));
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.dash-status--critical');
    expect(badge.querySelector('.material-symbols-rounded')).not.toBeNull();
    expect(badge.textContent.trim().length).toBeGreaterThan(1);
  });

  it('hides a sparkline that has too few points to be a trend', () => {
    fixture.componentInstance.current.set(stat({ sparkline: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dash-sparkline')).toBeNull();

    fixture.componentInstance.current.set(
      stat({ sparkline: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }, { x: 'c', y: 3 }, { x: 'd', y: 2 }] }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dash-sparkline')).not.toBeNull();
  });
});

describe('viz palette and scales', () => {
  it('maps colour slots to the documented tokens and clamps out of range', () => {
    expect(slotColor(1)).toBe('var(--viz-slot-1)');
    expect(slotColor(8)).toBe('var(--viz-slot-8)');
    // The categorical ramp is eight slots. Past that the server folds to
    // "Other" — the client must not invent a ninth hue.
    expect(slotColor(9)).toBe('var(--viz-slot-8)');
    expect(slotColor(0)).toBe('var(--viz-slot-1)');
    expect(slotColor(undefined)).toBe('var(--viz-slot-1)');
  });

  it('starts an ordinal ramp no lighter than the documented floor', () => {
    expect(rampColor(0, 250)).toBe('var(--viz-seq-250)');
    expect(rampColor(0, 100)).toBe('var(--viz-seq-100)');
    expect(rampColor(1, 100)).toBe('var(--viz-seq-650)');
    expect(rampColor(null, 100)).toBe('var(--viz-plane)');
  });

  it('anchors an additive axis at zero', () => {
    // A bar chart whose axis starts above zero exaggerates every difference on
    // it, and that is the one distortion a reader cannot correct for.
    const [min] = niceDomain([12, 14, 15]);
    expect(min).toBe(0);
  });

  it('formats an absent value as an em dash rather than zero', () => {
    expect(formatValue(null, 'percent')).toBe('—');
    expect(formatValue(undefined, 'count')).toBe('—');
    expect(formatValue(0, 'count')).toBe('0');
    expect(formatValue(0.54, 'percent')).toBe('54%');
    expect(formatValue(72, 'hours')).toBe('3d');
    expect(formatValue(31, 'hours')).toBe('31h');
  });
});
