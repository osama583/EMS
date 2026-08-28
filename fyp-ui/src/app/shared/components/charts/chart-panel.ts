import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Drill, FilterSelect, PanelWidget } from '../../../core/dashboard/dashboard.models';
import { AlertListComponent } from './alert-list';
import { BarChartComponent } from './bar-chart';
import { ChartFrameComponent } from './chart-frame';
import { ColumnChartComponent } from './column-chart';
import { DonutChartComponent } from './donut-chart';
import { DotPlotComponent } from './dot-plot';
import { FunnelComponent } from './funnel';
import { HeatmapComponent } from './heatmap';
import { LineChartComponent } from './line-chart';
import { MeterComponent } from './meter';
import { TimelineChartComponent } from './timeline-chart';
import { MarkEvent } from './viz-chart.base';
import { hasData } from './viz';

/**
 * One panel, rendered.
 *
 * This is where the declarative-layout guarantee is cashed in: the component
 * knows the ten chart forms and nothing about the ten dashboards. A new profile
 * is a server-side `PROFILES` entry naming widget ids — no case is added here,
 * no import changes, and the component renders a document it has never seen.
 *
 * Orientation is derived, not passed. `stacked-bar` with a categorical y-axis
 * is horizontal (the F&B fan-out board, one row per outlet); with a date x-axis
 * it is a stacked column (the lane-time bar, one column per week). The contract
 * already says which, so the client does not need a second flag that could
 * disagree with it.
 */
@Component({
  selector: 'app-chart-panel',
  imports: [
    ChartFrameComponent,
    LineChartComponent,
    ColumnChartComponent,
    BarChartComponent,
    DonutChartComponent,
    HeatmapComponent,
    TimelineChartComponent,
    DotPlotComponent,
    FunnelComponent,
    MeterComponent,
    AlertListComponent,
  ],
  template: `
    <app-chart-frame [panel]="panel()" [empty]="isEmpty()" [suppressed]="panel().suppressed ?? 0" (retry)="retry.emit($event)">
      @switch (form()) {
        @case ('line') {
          <app-line-chart mode="line" [series]="panel().series" [axes]="panel().axes" [annotations]="panel().annotations" (markSelect)="onMark($event)" />
        }
        @case ('area') {
          <app-line-chart mode="area" [series]="panel().series" [axes]="panel().axes" [annotations]="panel().annotations" (markSelect)="onMark($event)" />
        }
        @case ('column') {
          <app-column-chart [series]="panel().series" [axes]="panel().axes" [annotations]="panel().annotations" [data]="panel().data ?? null" [stacked]="panel().chart === 'stacked-bar'" (markSelect)="onMark($event)" />
        }
        @case ('bar') {
          <app-bar-chart [series]="panel().series" [axes]="panel().axes" [annotations]="panel().annotations" [stacked]="panel().series.length > 1" (markSelect)="onMark($event)" />
        }
        @case ('heatmap') {
          <app-heatmap [data]="panel().data ?? null" [axes]="panel().axes" [annotations]="panel().annotations" (markSelect)="onMark($event)" />
        }
        @case ('timeline') {
          <app-timeline-chart [data]="panel().data ?? null" [axes]="panel().axes" (markSelect)="onMark($event)" />
        }
        @case ('dot') {
          <app-dot-plot [series]="panel().series" [axes]="panel().axes" [annotations]="panel().annotations" (markSelect)="onMark($event)" />
        }
        @case ('funnel') {
          <app-funnel [data]="panel().data ?? null" (markSelect)="onMark($event)" />
        }
        @case ('donut') {
          <app-donut-chart [data]="panel().data ?? null" [axes]="panel().axes" (markSelect)="onMark($event)" />
        }
        @case ('meter') {
          <app-meter [data]="panel().data ?? null" (markSelect)="onMark($event)" />
        }
        @case ('alerts') {
          <app-alert-list [data]="panel().data ?? null" (open)="drill.emit($event)" (markSelect)="onMark($event)" />
        }
      }
    </app-chart-frame>
  `,
  styles: [':host { display: block; height: 100%; } app-chart-frame { height: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartPanelComponent {
  readonly panel = input.required<PanelWidget>();
  readonly drill = output<Drill>();
  readonly retry = output<string>();
  /** Emitted instead of `drill` when the panel declares a `crossFilter`. */
  readonly filterSelect = output<FilterSelect>();

  readonly form = computed(() => {
    const panel = this.panel();
    switch (panel.chart) {
      case 'line-chart':
        return 'line';
      case 'area-chart':
        return 'area';
      case 'column-chart':
        return 'column';
      case 'stacked-bar':
        // Horizontal when the category axis is y — long outlet names read
        // badly rotated, which is the whole reason that orientation exists.
        return panel.axes.y?.type === 'category' ? 'bar' : 'column';
      case 'bar-chart':
        return 'bar';
      case 'heatmap':
        return 'heatmap';
      case 'timeline-chart':
        return 'timeline';
      case 'dot-plot':
        return 'dot';
      case 'funnel':
        return 'funnel';
      case 'donut-chart':
        return 'donut';
      case 'meter':
        return 'meter';
      case 'alert-list':
        return 'alerts';
      default:
        return 'table';
    }
  });

  readonly isEmpty = computed(() => {
    const panel = this.panel();
    if (panel.state === 'error') return false;
    const form = this.form();
    if (['line', 'area', 'column', 'bar', 'dot'].includes(form)) return !hasData(panel.series);
    if (form === 'heatmap') return !((panel.data?.['cells'] as unknown[]) ?? []).length;
    if (form === 'timeline') return !((panel.data?.['lanes'] as unknown[]) ?? []).length;
    if (form === 'funnel') return !((panel.data?.['stages'] as { value: number | null }[]) ?? []).some((s) => s.value);
    if (form === 'donut') return !((panel.data?.['segments'] as { value: number | null }[]) ?? []).some((s) => s.value);
    if (form === 'meter') return !((panel.data?.['meters'] as unknown[]) ?? []).length;
    if (form === 'alerts') return false; // The rail renders its own "nothing needs attention".
    return true; // An unrecognised chart kind has nothing to render.
  });

  onMark(event: MarkEvent): void {
    const panel = this.panel();
    const point = event.point as Record<string, unknown>;
    // A filtering panel never navigates: clicking one of its marks narrows the
    // panel it names. Checked before every other branch, so a mark that also
    // carries a requestId cannot navigate out from under the filter.
    const cross = panel.crossFilter;
    if (cross) {
      const value = point[cross.pointKey];
      if (value === null || value === undefined) return;
      this.filterSelect.emit({
        source: panel.id,
        target: cross.target,
        targetKey: cross.targetKey,
        value: value as string | number,
        label: String(point[cross.labelKey] ?? value),
      });
      return;
    }
    // A mark's own identity wins over the panel default, so clicking one bar
    // lands on that item rather than the panel's unfiltered list.
    if (typeof point['requestId'] === 'number') {
      this.drill.emit({ route: `/app/proposals/review/${point['requestId']}`, params: {} });
      return;
    }
    if (!panel.drill) return;
    const params: Record<string, string | number | boolean> = { ...panel.drill.params };
    if (point['date']) params['date'] = String(point['date']);
    else if (typeof point['x'] === 'string' && panel.axes.x?.type === 'date') params['date'] = point['x'];
    if (typeof point['optionId'] === 'number') params['item'] = point['optionId'];
    if (typeof point['userId'] === 'number') params['assignee'] = point['userId'];
    if (point['code']) params['outlet'] = String(point['code']);
    this.drill.emit({ route: panel.drill.route, params });
  }
}
