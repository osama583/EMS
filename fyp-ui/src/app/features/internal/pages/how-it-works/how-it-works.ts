import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

interface ProcessStep {
  readonly number: number;
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly timingLabel: string;
  readonly timing: string;
  readonly condition?: string;
  readonly totals?: readonly string[];
  readonly note?: string;
}

interface ProcessPathPoint {
  readonly x: number;
  readonly y: number;
}

interface ProcessPathPosition extends ProcessPathPoint {
  readonly angle: number;
}

interface ProcessPathMarker extends ProcessPathPosition {
  readonly progress: number;
}

/** A step's share of the route, as start/end fractions of total path length. */
interface ProcessStepBand {
  readonly start: number;
  readonly end: number;
}

@Component({
  selector: 'app-how-it-works',
  imports: [RouterLink],
  templateUrl: './how-it-works.html',
  styleUrl: './how-it-works.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HowItWorksComponent implements AfterViewInit {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private animationFrame?: number;
  private scrollFrame?: number;
  private reducedMotionQuery?: MediaQueryList;
  private resizeObserver?: ResizeObserver;
  private rebuildPathOnNextFrame = false;

  @ViewChild('timeline') private timeline?: ElementRef<HTMLElement>;
  @ViewChild('routePath') private routePathRef?: ElementRef<SVGPathElement>;

  readonly timelineProgress = signal(0);
  readonly processPath = signal('');
  readonly processViewBox = signal('0 0 1 1');
  readonly pathTotalLength = signal(1);
  readonly pathDashOffset = computed(
    () => this.pathTotalLength() * (1 - this.timelineProgress() / 100),
  );
  readonly pathMarkers = signal<readonly ProcessPathMarker[]>([]);
  readonly trackerPosition = signal<ProcessPathPosition>({ x: 0, y: 0, angle: 0 });
  readonly trackerTransform = computed(() => {
    const position = this.trackerPosition();
    return `translate(${position.x} ${position.y}) rotate(${position.angle})`;
  });
  /**
   * Each step's slice of the route, measured off the rendered path. The steps do
   * not get equal shares: the route runs the full width across step 1, bends,
   * and runs all the way back, so step 1 owns nearly a third of the total length
   * while the rest own about a sixth each. Splitting scroll progress evenly
   * instead drifts the highlight up to half a step away from the drawn line.
   */
  readonly stepBoundaries = signal<readonly ProcessStepBand[]>([]);
  readonly activeStepIndex = computed(() => {
    const progress = this.timelineProgress();
    if (progress <= 0) {
      return -1;
    }

    const fraction = Math.min(progress, 99.999) / 100;
    const bands = this.stepBoundaries();
    if (bands.length !== this.steps.length) {
      return Math.min(this.steps.length - 1, Math.floor(fraction * this.steps.length));
    }

    let index = 0;
    for (let step = 0; step < bands.length; step += 1) {
      if (fraction >= bands[step].start) {
        index = step;
      }
    }

    return index;
  });
  readonly steps: readonly ProcessStep[] = [
    {
      number: 1,
      icon: 'edit_note',
      title: 'Fill Out the Form',
      description:
        'Complete the proposal with the event information, schedule, participants, required services, and budget details.',
      timingLabel: 'Estimated completion time',
      timing: '10–20 minutes',
    },
    {
      number: 2,
      icon: 'approval_delegation',
      title: 'HOS/HOD Approval',
      description:
        'The proposal is sent to the relevant Head of School or Head of Department for review.',
      timingLabel: 'Maximum processing time',
      timing: '5 working days',
    },
    {
      number: 3,
      icon: 'account_tree',
      title: 'Additional Approval',
      description:
        'When the event has more than 50 participants, the proposal is sent to FMB or CFO for the required additional approval.',
      timingLabel: 'Maximum processing time',
      timing: '5 working days',
      condition: 'Only for events with more than 50 participants',
    },
    {
      number: 4,
      icon: 'domain_verification',
      title: 'Department Review',
      description:
        'Approved requests are sent to the departments responsible for the selected services. Each department confirms whether the requirements can be provided.',
      timingLabel: 'Maximum processing time',
      timing: '3 working days',
    },
    {
      number: 5,
      icon: 'task_alt',
      title: 'Proposal Completed',
      description:
        'After every required approval and department review is completed, the proposal status is updated and the applicant receives final confirmation.',
      timingLabel: 'Expected total processing time',
      timing: '',
      totals: [
        '50 participants or fewer: up to 8 working days',
        'More than 50 participants: up to 13 working days',
      ],
      note: 'Time spent waiting for applicant revisions is not included.',
    },
  ];

  ngAfterViewInit(): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }

    this.rebuildProcessPath();
    this.reducedMotionQuery = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (this.reducedMotionQuery?.matches) {
      this.timelineProgress.set(100);
      this.updateTrackerPosition(1);
    } else {
      this.updateTimelineProgress();
    }

    if (typeof view.ResizeObserver === 'function' && this.timeline?.nativeElement) {
      this.resizeObserver = new view.ResizeObserver(() => this.scheduleViewportUpdate(true));
      this.resizeObserver.observe(this.timeline.nativeElement);
    }

    this.destroyRef.onDestroy(() => {
      if (this.animationFrame !== undefined) {
        view.cancelAnimationFrame(this.animationFrame);
      }

      if (this.scrollFrame !== undefined) {
        view.cancelAnimationFrame(this.scrollFrame);
      }

      this.resizeObserver?.disconnect();
    });
  }

  @HostListener('window:scroll')
  onViewportChange(): void {
    if (this.reducedMotionQuery?.matches) {
      return;
    }

    // Scroll fires far more often than the browser can paint — batch every scroll tick
    // into a single read+write per animation frame so the fill never lags or stutters.
    const view = this.document.defaultView;
    if (!view || this.scrollFrame !== undefined) {
      return;
    }

    this.scrollFrame = view.requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      this.updateTimelineProgress();
    });
  }

  @HostListener('window:resize')
  onViewportResize(): void {
    this.scheduleViewportUpdate(true);
  }

  private scheduleViewportUpdate(rebuildPath: boolean): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }

    this.rebuildPathOnNextFrame ||= rebuildPath;
    if (this.animationFrame !== undefined) {
      return;
    }

    this.animationFrame = view.requestAnimationFrame(() => {
      this.animationFrame = undefined;
      if (this.rebuildPathOnNextFrame) {
        this.rebuildPathOnNextFrame = false;
        this.rebuildProcessPath();
      }

      if (!this.reducedMotionQuery?.matches) {
        this.updateTimelineProgress();
      }
    });
  }

  isStepActive(index: number): boolean {
    return this.stepProgress(index) >= 0.12;
  }

  isCurrentStep(index: number): boolean {
    return this.activeStepIndex() === index;
  }

  stepProgress(index: number): number {
    const fraction = this.timelineProgress() / 100;
    const band = this.stepBoundaries()[index];
    if (!band || band.end <= band.start) {
      return Math.max(0, Math.min(1, fraction * this.steps.length - index));
    }

    return Math.max(0, Math.min(1, (fraction - band.start) / (band.end - band.start)));
  }

  private updateTimelineProgress(): void {
    const view = this.document.defaultView;
    const timeline = this.timeline?.nativeElement;
    if (!view || !timeline) {
      return;
    }

    const rect = timeline.getBoundingClientRect();
    if (rect.height <= 0) {
      this.timelineProgress.set(100);
      this.updateTrackerPosition(1);
      return;
    }

    const viewportAnchor = view.innerHeight * 0.62;
    const progress = ((viewportAnchor - rect.top) / rect.height) * 100;
    const clampedProgress = Math.max(0, Math.min(100, progress));
    this.timelineProgress.set(clampedProgress);
    this.updateTrackerPosition(clampedProgress / 100);
  }

  private rebuildProcessPath(): void {
    const view = this.document.defaultView;
    const timeline = this.timeline?.nativeElement;
    if (!view || !timeline) {
      return;
    }

    const stepElements = Array.from(timeline.querySelectorAll<HTMLElement>('.process-step'));
    const measuredWidth = timeline.clientWidth || timeline.getBoundingClientRect().width;
    const width = Math.max(1, measuredWidth || 1000);
    const isCompact = view.innerWidth <= 768;

    const fallbackStepHeight = isCompact ? 420 : 520;
    const bands = stepElements.map((element, index) => {
      const height = element.offsetHeight || fallbackStepHeight;
      const top = element.offsetHeight ? element.offsetTop : index * fallbackStepHeight;
      return { top, bottom: top + height };
    });

    if (bands.length === 0) {
      return;
    }

    const pathHeight = Math.max(
      1,
      timeline.scrollHeight || timeline.getBoundingClientRect().height || bands.at(-1)!.bottom,
    );
    let path = '';

    const format = (value: number): string => value.toFixed(2);
    const moveTo = (point: ProcessPathPoint): void => {
      path = `M ${format(point.x)} ${format(point.y)}`;
    };
    const lineTo = (point: ProcessPathPoint): void => {
      path += ` L ${format(point.x)} ${format(point.y)}`;
    };
    const curveTo = (
      controlOne: ProcessPathPoint,
      controlTwo: ProcessPathPoint,
      end: ProcessPathPoint,
    ): void => {
      path += ` C ${format(controlOne.x)} ${format(controlOne.y)} ${format(controlTwo.x)} ${format(controlTwo.y)} ${format(end.x)} ${format(end.y)}`;
    };

    if (isCompact) {
      const lineX = Math.min(24, width * 0.08);
      moveTo({ x: lineX, y: bands[0].top });
      lineTo({ x: lineX, y: bands.at(-1)!.bottom });
    } else {
      const bendWidth = Math.max(72, Math.min(112, width * 0.07));
      moveTo({ x: width, y: bands[0].top });

      bands.forEach((band, index) => {
        const bendsLeft = index % 2 === 0;
        const isLast = index === bands.length - 1;

        if (bendsLeft) {
          lineTo({ x: bendWidth, y: band.top });
          curveTo(
            { x: 0, y: band.top },
            { x: 0, y: band.bottom },
            { x: bendWidth, y: band.bottom },
          );
          lineTo({ x: isLast ? width : width - bendWidth, y: band.bottom });
        } else {
          lineTo({ x: width - bendWidth, y: band.top });
          curveTo(
            { x: width, y: band.top },
            { x: width, y: band.bottom },
            { x: width - bendWidth, y: band.bottom },
          );
          lineTo({ x: isLast ? 0 : bendWidth, y: band.bottom });
        }
      });
    }

    this.processPath.set(path);
    this.processViewBox.set(`0 0 ${format(width)} ${format(pathHeight)}`);

    // Read the native geometry back from the rendered <path> so the fill
    // (stroke-dasharray/dashoffset) and the tracker (getPointAtLength) walk
    // the exact same browser-computed arc length — they can't drift apart.
    view.requestAnimationFrame(() => {
      const pathEl = this.routePathRef?.nativeElement;
      // Same guard as positionAtProgress(): SVG geometry APIs are not universally implemented.
      if (!pathEl || typeof pathEl.getTotalLength !== 'function') {
        return;
      }

      const totalLength = pathEl.getTotalLength();
      this.pathTotalLength.set(Math.max(1, totalLength));
      this.stepBoundaries.set(
        bands.map((band) => ({
          start: this.lengthAtDepth(pathEl, totalLength, band.top) / totalLength,
          end: this.lengthAtDepth(pathEl, totalLength, band.bottom) / totalLength,
        })),
      );
      this.pathMarkers.set(
        Array.from({ length: this.steps.length * 2 }, (_, index) => {
          const progress = (index + 1) / (this.steps.length * 2 + 1);
          return { ...this.positionAtProgress(progress), progress };
        }),
      );
      this.updateTrackerPosition(this.timelineProgress() / 100);
    });
  }

  /**
   * First length along the path at which it has descended to `depth`. The route
   * only ever runs level or downwards, so y is monotonic along it and a binary
   * search is exact; 20 halvings put a ~10,000-unit path inside a hundredth of a unit.
   */
  private lengthAtDepth(pathEl: SVGPathElement, totalLength: number, depth: number): number {
    let low = 0;
    let high = totalLength;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const middle = (low + high) / 2;
      if (pathEl.getPointAtLength(middle).y < depth) {
        low = middle;
      } else {
        high = middle;
      }
    }

    return high;
  }

  private updateTrackerPosition(progress: number): void {
    this.trackerPosition.set(this.positionAtProgress(progress));
  }

  private positionAtProgress(progress: number): ProcessPathPosition {
    const pathEl = this.routePathRef?.nativeElement;
    // getTotalLength/getPointAtLength are SVG geometry APIs that some environments (notably
    // jsdom, used by the test runner) do not implement. Guard rather than throw: the timeline
    // still renders, just without the animated tracker.
    if (!pathEl || typeof pathEl.getTotalLength !== 'function' || typeof pathEl.getPointAtLength !== 'function') {
      return { x: 0, y: 0, angle: 0 };
    }

    const totalLength = pathEl.getTotalLength();
    if (totalLength <= 0) {
      return { x: 0, y: 0, angle: 0 };
    }

    const clamped = Math.max(0, Math.min(1, progress));
    const targetLength = clamped * totalLength;
    const point = pathEl.getPointAtLength(targetLength);

    // Sample a point slightly behind to derive the tangent angle at this position.
    const lookBehind = Math.max(0, targetLength - 1);
    const behind = pathEl.getPointAtLength(lookBehind);

    return {
      x: point.x,
      y: point.y,
      angle: (Math.atan2(point.y - behind.y, point.x - behind.x) * 180) / Math.PI,
    };
  }
}
