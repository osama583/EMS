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
  private pathPoints: readonly ProcessPathPoint[] = [];
  private pathLengths: readonly number[] = [];

  @ViewChild('timeline') private timeline?: ElementRef<HTMLElement>;

  readonly timelineProgress = signal(0);
  readonly processPath = signal('');
  readonly processViewBox = signal('0 0 1 1');
  readonly pathMarkers = signal<readonly ProcessPathMarker[]>([]);
  readonly trackerPosition = signal<ProcessPathPosition>({ x: 0, y: 0, angle: 0 });
  readonly trackerTransform = computed(() => {
    const position = this.trackerPosition();
    return `translate(${position.x} ${position.y}) rotate(${position.angle})`;
  });
  readonly activeStepIndex = computed(() => {
    const progress = this.timelineProgress();
    if (progress <= 0) {
      return -1;
    }

    return Math.min(
      this.steps.length - 1,
      Math.floor((Math.min(progress, 99.999) / 100) * this.steps.length),
    );
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
    const scaledProgress = (this.timelineProgress() / 100) * this.steps.length;
    return Math.max(0, Math.min(1, scaledProgress - index));
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
    const points: ProcessPathPoint[] = [];
    let path = '';

    const format = (value: number): string => value.toFixed(2);
    const moveTo = (point: ProcessPathPoint): void => {
      path = `M ${format(point.x)} ${format(point.y)}`;
      points.push(point);
    };
    const lineTo = (point: ProcessPathPoint): void => {
      const previous = points.at(-1);
      if (previous && previous.x === point.x && previous.y === point.y) {
        return;
      }

      path += ` L ${format(point.x)} ${format(point.y)}`;
      points.push(point);
    };
    const curveTo = (
      controlOne: ProcessPathPoint,
      controlTwo: ProcessPathPoint,
      end: ProcessPathPoint,
    ): void => {
      const start = points.at(-1);
      if (!start) {
        return;
      }

      path += ` C ${format(controlOne.x)} ${format(controlOne.y)} ${format(controlTwo.x)} ${format(controlTwo.y)} ${format(end.x)} ${format(end.y)}`;
      for (let sample = 1; sample <= 28; sample += 1) {
        const t = sample / 28;
        const inverse = 1 - t;
        points.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse ** 2 * t * controlOne.x +
            3 * inverse * t ** 2 * controlTwo.x +
            t ** 3 * end.x,
          y:
            inverse ** 3 * start.y +
            3 * inverse ** 2 * t * controlOne.y +
            3 * inverse * t ** 2 * controlTwo.y +
            t ** 3 * end.y,
        });
      }
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

    this.pathPoints = points;
    this.pathLengths = points.reduce<number[]>((lengths, point, index) => {
      if (index === 0) {
        lengths.push(0);
        return lengths;
      }

      const previous = points[index - 1];
      lengths.push(lengths[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
      return lengths;
    }, []);

    this.processPath.set(path);
    this.processViewBox.set(`0 0 ${format(width)} ${format(pathHeight)}`);
    this.pathMarkers.set(
      Array.from({ length: this.steps.length * 2 }, (_, index) => {
        const progress = (index + 1) / (this.steps.length * 2 + 1);
        return { ...this.positionAtProgress(progress), progress };
      }),
    );
    this.updateTrackerPosition(this.timelineProgress() / 100);
  }

  private updateTrackerPosition(progress: number): void {
    this.trackerPosition.set(this.positionAtProgress(progress));
  }

  private positionAtProgress(progress: number): ProcessPathPosition {
    if (this.pathPoints.length < 2 || this.pathLengths.length < 2) {
      return { x: 0, y: 0, angle: 0 };
    }

    const totalLength = this.pathLengths.at(-1) ?? 0;
    const targetLength = Math.max(0, Math.min(1, progress)) * totalLength;
    let index = this.pathLengths.findIndex((length) => length >= targetLength);
    if (index <= 0) {
      index = 1;
    }

    const start = this.pathPoints[index - 1];
    const end = this.pathPoints[index];
    const segmentStart = this.pathLengths[index - 1];
    const segmentLength = Math.max(this.pathLengths[index] - segmentStart, Number.EPSILON);
    const amount = (targetLength - segmentStart) / segmentLength;

    return {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      angle: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
    };
  }
}
