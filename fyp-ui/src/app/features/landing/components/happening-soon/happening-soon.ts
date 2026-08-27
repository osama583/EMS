import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PublishedEvent, ProposalEventSchedule, RegistrationResult } from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { EventDetailsModalComponent } from '../../../../shared/components/event-details-modal/event-details-modal';
import { CtaLinkComponent } from '../../../../shared/components/cta-link/cta-link';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { EVENT_IMAGE_PLACEHOLDER } from '../../../../shared/event-image-placeholder';

interface EventDate {
  readonly iso: string;
  readonly short: string;
  readonly long: string;
}

export interface UpcomingEvent {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly venue: string;
  readonly time: string;
  readonly description: string;
  readonly image: string;
  readonly date: EventDate;
  readonly daysFromNow: number;
}

interface EventCard {
  readonly event: UpcomingEvent;
  readonly index: number;
}

interface ExpandingCard {
  readonly image: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly targetLeft: number;
  readonly targetTop: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
}

const AUTO_ADVANCE_MS = 15_000;
const COUNTER_SWAP_MS = 420;
const IMAGE_TAKEOVER_MS = 560;
const EXPANDER_RELEASE_MS = 980;
const TRANSITION_FINISH_MS = 1080;

type TransitionPhase = 'idle' | 'leaving' | 'image-in' | 'details-in';
type QueueDirection = 'forward' | 'backward' | 'direct';

@Component({
  selector: 'app-happening-soon',
  imports: [EventDetailsModalComponent, CtaLinkComponent, LoadingStateComponent],
  templateUrl: './happening-soon.html',
  styleUrl: './happening-soon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HappeningSoonComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly publishedEventService = inject(PublishedEventService);
  private readonly toast = inject(ToastService);
  private autoTimer?: ReturnType<typeof setTimeout>;
  private transitionTimers: ReturnType<typeof setTimeout>[] = [];
  private observer?: IntersectionObserver;
  private isInView = false;
  private pointerPaused = false;
  private expansionFrame?: number;
  private expansionAnimation?: Animation;
  private expandingImageAnimation?: Animation;
  private readonly preloadedImages: HTMLImageElement[] = [];

  // Click-and-drag (or touch-swipe) horizontal scrolling for the card deck — mirrors
  // native touch scrolling but also works with a held-down mouse for desktop trackpad-less use.
  private dragState: { pointerId: number; startX: number; scrollLeft: number } | null = null;
  private didDrag = false;

  readonly events = signal<readonly UpcomingEvent[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');

  readonly activeIndex = signal(0);
  readonly activeEvent = computed(() => this.events()[this.activeIndex()]);
  readonly counterLabel = computed(() => (this.activeIndex() + 1).toString().padStart(2, '0'));
  readonly progressWidth = computed(
    () => `${((this.activeIndex() + 1) / Math.max(1, this.events().length)) * 100}%`,
  );
  readonly queueIndexes = signal<readonly number[]>([]);
  readonly backgroundIndex = signal<number | null>(null);
  readonly backgroundCard = signal<ExpandingCard | null>(null);
  readonly outgoingIndex = signal<number | null>(null);
  readonly shiftingIndexes = signal<readonly number[]>([]);
  readonly returningIndex = signal<number | null>(null);
  readonly queueDirection = signal<QueueDirection>('direct');
  readonly queueCards = computed<readonly EventCard[]>(() =>
    this.queueIndexes().map((index) => ({ event: this.events()[index], index })),
  );
  readonly eventCards = computed<readonly EventCard[]>(() => {
    const backgroundIndex = this.backgroundIndex();

    if (backgroundIndex !== null) {
      return [
        { event: this.events()[backgroundIndex], index: backgroundIndex },
        ...this.queueCards(),
      ];
    }

    const outgoingIndex = this.outgoingIndex();
    return outgoingIndex === null
      ? this.queueCards()
      : [...this.queueCards(), { event: this.events()[outgoingIndex], index: outgoingIndex }];
  });
  readonly transitionPhase = signal<TransitionPhase>('idle');
  readonly isTransitioning = signal(false);
  readonly expandingCard = signal<ExpandingCard | null>(null);
  readonly expandingIndex = signal<number | null>(null);
  readonly isExpanded = signal(false);
  readonly isTakeoverSettled = signal(false);
  readonly isQueueAdvancing = signal(false);
  readonly progressCycle = signal(0);
  readonly isProgressPaused = signal(true);
  readonly selectedPublishedEvent = signal<PublishedEvent | null>(null);
  private readonly publishedEventsById = signal<ReadonlyMap<string, PublishedEvent>>(new Map());

  registrationCount(id: string): number { return this.publishedEventsById().get(id)?.confirmedRegistrationCount ?? 0; }
  openEvent(): void { this.selectedPublishedEvent.set(this.publishedEventsById().get(this.activeEvent().id) ?? null); }
  closeEvent(): void { this.selectedPublishedEvent.set(null); }
  onModalRegistered(result: RegistrationResult): void {
    const eventTitle = this.selectedPublishedEvent()?.eventTitle ?? 'the event';
    this.closeEvent();
    if (result.status === 'rejected' || result.status === 'duplicate') {
      this.toast.error('Registration not completed', result.message);
    } else {
      this.toast.success(`You're registered for ${eventTitle}`, result.status === 'pending' ? 'Your registration is pending approval.' : undefined);
    }
  }

  constructor() {
    this.loadPublishedEvents();
  }

  // GET /events/happening-soon already returns exactly the next-10-days window (falling back to
  // the soonest events overall server-side when that window is empty), capped at 5 — no local
  // filtering/slicing of the full published-events table needed here any more.
  private loadPublishedEvents(): void {
    this.publishedEventService.getHappeningSoon().subscribe({
      next: (events) => {
        this.publishedEventsById.set(new Map(events.map((event) => [event.id, event])));
        const upcoming = events.map((event) => this.toUpcomingEvent(event));
        this.events.set(upcoming);
        this.queueIndexes.set(upcoming.slice(1).map((_, index) => index + 1));
        this.activeIndex.set(0);
        this.loading.set(false);
        this.preloadEventImages();
        this.startCarouselIfInView();
      },
      error: () => {
        this.publishedEventsById.set(new Map());
        this.loadError.set('Events could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  private toUpcomingEvent(event: PublishedEvent): UpcomingEvent {
    const schedule = event.schedule[0];
    return {
      id: event.id,
      title: event.eventTitle,
      category: event.categories[0] ?? '',
      venue: schedule?.location || 'To be confirmed',
      time: schedule ? `${this.formatTime(schedule.start)} – ${this.formatTime(schedule.end)}` : 'To be confirmed',
      description: event.shortIntroduction,
      image: event.eventImage?.url || EVENT_IMAGE_PLACEHOLDER,
      date: this.eventDateFor(schedule),
      daysFromNow: this.daysFromNowFor(schedule),
    };
  }

  private formatTime(value: string): string {
    const [hours = '0', minutes = '00'] = value.split(':');
    const hour = Number(hours);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${minutes} ${suffix}`;
  }

  private eventDateFor(schedule: ProposalEventSchedule | undefined): EventDate {
    if (!schedule?.date) {
      const fallback = new Date();
      return { iso: fallback.toISOString(), short: 'TBC', long: 'Date to be confirmed' };
    }
    const date = new Date(`${schedule.date}T12:00:00`);
    return {
      iso: date.toISOString(),
      short: new Intl.DateTimeFormat('en-MY', { day: '2-digit', month: 'short' }).format(date),
      long: new Intl.DateTimeFormat('en-MY', { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
    };
  }

  private daysFromNowFor(schedule: ProposalEventSchedule | undefined): number {
    if (!schedule?.date) return Number.POSITIVE_INFINITY;
    const eventDate = new Date(`${schedule.date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  ngAfterViewInit(): void {
    this.startCarouselIfInView();
  }

  private startCarouselIfInView(): void {
    const section = this.host.nativeElement.querySelector<HTMLElement>('.happening');

    if (!section || this.events().length === 0 || this.observer) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      this.isInView = true;
      this.queueAutoAdvance();
      return;
    }

    this.observer = new IntersectionObserver(
      ([entry]) => {
        this.isInView = entry.isIntersecting;
        if (entry.isIntersecting) {
          this.queueAutoAdvance();
        } else {
          this.isProgressPaused.set(true);
          this.clearAutoTimer();
        }
      },
      { threshold: 0.35 },
    );
    this.observer.observe(section);
  }

  next(): void {
    const target = this.queueIndexes()[0];

    if (target === undefined) {
      return;
    }

    const firstCard = this.host.nativeElement.querySelector<HTMLElement>(
      '.event-deck__cards .event-card:not(.event-card--background)',
    );
    this.goTo(target, firstCard ?? undefined, 'forward');
  }

  previous(): void {
    const queue = this.queueIndexes();
    const target = queue[queue.length - 1];

    if (target === undefined) {
      return;
    }

    const lastCard = this.host.nativeElement.querySelector<HTMLElement>(
      `.event-deck__cards [data-event-index="${target}"]`,
    );
    this.goTo(target, lastCard ?? undefined, 'backward');
  }

  onCardsPointerDown(event: PointerEvent): void {
    const cards = event.currentTarget as HTMLElement;
    // Only relevant when the deck is actually a native scroll container (mobile/touch
    // layout) — on desktop it's a fixed-size grid with no overflow to drag.
    if (cards.scrollWidth <= cards.clientWidth) {
      return;
    }

    this.dragState = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: cards.scrollLeft };
    this.didDrag = false;
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    const cards = event.currentTarget as HTMLElement;
    const deltaX = event.clientX - this.dragState.startX;

    if (!this.didDrag && Math.abs(deltaX) < 4) {
      return;
    }

    if (!this.didDrag) {
      this.didDrag = true;
      cards.setPointerCapture(event.pointerId);
      cards.classList.add('event-deck__cards--dragging');
    }

    event.preventDefault();
    cards.scrollLeft = this.dragState.scrollLeft - deltaX;
  }

  onCardsPointerUp(event: PointerEvent): void {
    if (!this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    const cards = event.currentTarget as HTMLElement;
    if (cards.hasPointerCapture(event.pointerId)) {
      cards.releasePointerCapture(event.pointerId);
    }
    cards.classList.remove('event-deck__cards--dragging');
    this.dragState = null;
    // Leave didDrag true for this tick so the click that follows the pointerup on the
    // same card is suppressed by onCardClick; it resets on the next pointerdown.
  }

  onCardClick(targetIndex: number, source: HTMLElement, event: MouseEvent): void {
    if (this.didDrag) {
      event.preventDefault();
      this.didDrag = false;
      return;
    }

    this.goTo(targetIndex, source);
  }

  goTo(targetIndex: number, source?: HTMLElement, direction: QueueDirection = 'direct'): void {
    if (
      targetIndex === this.activeIndex() ||
      targetIndex < 0 ||
      targetIndex >= this.events().length ||
      this.isTransitioning()
    ) {
      return;
    }

    this.clearAutoTimer();
    this.isTransitioning.set(true);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (reduceMotion) {
      this.finishSelection(targetIndex, direction);
      return;
    }

    const shiftsQueue = this.queueIndexes().includes(targetIndex);
    this.startCardTakeover(targetIndex, source, shiftsQueue, direction);
  }

  pauseCarousel(): void {
    this.pointerPaused = true;
    this.isProgressPaused.set(true);
    this.clearAutoTimer();
  }

  resumeCarousel(): void {
    this.pointerPaused = false;
    this.queueAutoAdvance();
  }

  ngOnDestroy(): void {
    this.clearAutoTimer();
    this.transitionTimers.forEach((timer) => clearTimeout(timer));
    if (this.expansionFrame !== undefined) {
      cancelAnimationFrame(this.expansionFrame);
    }
    this.expansionAnimation?.cancel();
    this.expandingImageAnimation?.cancel();
    this.observer?.disconnect();
  }

  private finishSelection(targetIndex: number, direction: QueueDirection): void {
    const nextQueue = this.queueAfterSelection(targetIndex, this.activeIndex(), direction);
    this.activeIndex.set(targetIndex);
    this.queueIndexes.set(nextQueue);
    this.resetTransitionVisuals();
    this.transitionPhase.set('idle');
    this.completeTransition();
  }

  private startCardTakeover(
    targetIndex: number,
    source: HTMLElement | undefined,
    shiftsQueue: boolean,
    direction: QueueDirection,
  ): void {
    const section = this.host.nativeElement.querySelector<HTMLElement>('.happening');
    const layout = this.host.nativeElement.querySelector<HTMLElement>('.happening__layout');
    const sourceCard =
      source ??
      this.host.nativeElement.querySelector<HTMLElement>(`[data-event-index="${targetIndex}"]`);

    if (!section || !layout || !sourceCard) {
      this.startSoftTransition(targetIndex, shiftsQueue, direction);
      return;
    }

    const sectionRect = section.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const cardRect = sourceCard.getBoundingClientRect();
    const sourceImage = sourceCard.querySelector<HTMLImageElement>('img');
    const cardStyle = getComputedStyle(sourceCard);
    const imageStyle = sourceImage ? getComputedStyle(sourceImage) : null;
    const outgoingEventIndex = this.activeIndex();
    const nextQueue = this.queueAfterSelection(targetIndex, outgoingEventIndex, direction);
    const selectedQueuePosition = this.queueIndexes().indexOf(targetIndex);
    const isBackward =
      direction === 'backward' && selectedQueuePosition === this.queueIndexes().length - 1;
    const shiftingIndexes =
      shiftsQueue && selectedQueuePosition >= 0
        ? isBackward
          ? this.queueIndexes().slice(0, selectedQueuePosition)
          : [...this.queueIndexes().slice(selectedQueuePosition + 1), outgoingEventIndex]
        : [];

    const cardGeometry: ExpandingCard = {
      image: this.events()[targetIndex].image,
      left: cardRect.left - layoutRect.left,
      top: cardRect.top - layoutRect.top,
      width: cardRect.width,
      height: cardRect.height,
      targetLeft: sectionRect.left - layoutRect.left,
      targetTop: sectionRect.top - layoutRect.top,
      targetWidth: sectionRect.width,
      targetHeight: sectionRect.height,
    };
    this.expandingCard.set(cardGeometry);
    this.backgroundIndex.set(null);
    this.backgroundCard.set(null);
    this.expandingIndex.set(targetIndex);
    this.outgoingIndex.set(outgoingEventIndex);
    this.shiftingIndexes.set(shiftingIndexes);
    this.returningIndex.set(isBackward ? outgoingEventIndex : null);
    this.queueDirection.set(direction);
    this.isQueueAdvancing.set(shiftsQueue);
    this.transitionPhase.set('leaving');

    // Commit and measure the card-sized state before requesting the full-screen state.
    // This guarantees that the browser has two distinct layouts to interpolate between.
    this.changeDetector.detectChanges();
    sourceCard.getBoundingClientRect();

    if (typeof sourceCard.animate === 'function') {
      this.expansionAnimation?.cancel();
      this.expandingImageAnimation?.cancel();
      this.expansionAnimation = sourceCard.animate(
        [
          {
            top: `${cardGeometry.top}px`,
            left: `${cardGeometry.left}px`,
            width: `${cardGeometry.width}px`,
            height: `${cardGeometry.height}px`,
            borderColor: cardStyle.borderColor,
            borderRadius: cardStyle.borderRadius,
            boxShadow: cardStyle.boxShadow,
          },
          {
            top: `${cardGeometry.targetTop}px`,
            left: `${cardGeometry.targetLeft}px`,
            width: `${cardGeometry.targetWidth}px`,
            height: `${cardGeometry.targetHeight}px`,
            borderColor: 'transparent',
            borderRadius: '0',
            boxShadow: 'none',
          },
        ],
        {
          duration: IMAGE_TAKEOVER_MS,
          easing: 'cubic-bezier(0.42, 0, 1, 1)',
          fill: 'forwards',
        },
      );
      if (sourceImage && imageStyle && typeof sourceImage.animate === 'function') {
        this.expandingImageAnimation = sourceImage.animate(
          [
            {
              filter: imageStyle.filter || 'none',
              transform: imageStyle.transform || 'none',
            },
            {
              filter: 'none',
              transform: 'none',
            },
          ],
          {
            duration: IMAGE_TAKEOVER_MS,
            easing: 'cubic-bezier(0.42, 0, 1, 1)',
            fill: 'forwards',
          },
        );
      }
      this.isExpanded.set(true);
      this.transitionPhase.set('image-in');
    } else {
      this.expansionFrame = requestAnimationFrame(() => {
        this.isExpanded.set(true);
        this.transitionPhase.set('image-in');
      });
    }

    this.transitionTimers.push(
      setTimeout(() => this.activeIndex.set(targetIndex), COUNTER_SWAP_MS),
      setTimeout(() => {
        this.isTakeoverSettled.set(true);
        this.transitionPhase.set('details-in');
      }, IMAGE_TAKEOVER_MS),
      setTimeout(() => {
        const expandedCard = this.expandingCard();
        this.isQueueAdvancing.set(false);
        this.shiftingIndexes.set([]);
        this.returningIndex.set(null);
        this.queueDirection.set('direct');
        this.queueIndexes.set(nextQueue);
        this.backgroundCard.set(expandedCard);
        this.backgroundIndex.set(targetIndex);
        this.expandingCard.set(null);
        this.expandingIndex.set(null);
        this.outgoingIndex.set(null);
        this.changeDetector.detectChanges();
        this.expansionAnimation?.cancel();
        this.expandingImageAnimation?.cancel();
        this.expansionAnimation = undefined;
        this.expandingImageAnimation = undefined;
      }, EXPANDER_RELEASE_MS),
      setTimeout(() => {
        this.isExpanded.set(false);
        this.isTakeoverSettled.set(false);
        this.isQueueAdvancing.set(false);
        this.transitionPhase.set('idle');
        this.completeTransition();
      }, TRANSITION_FINISH_MS),
    );
  }

  private startSoftTransition(
    targetIndex: number,
    shiftsQueue: boolean,
    direction: QueueDirection,
  ): void {
    const nextQueue = this.queueAfterSelection(targetIndex, this.activeIndex(), direction);
    this.backgroundIndex.set(null);
    this.backgroundCard.set(null);
    this.transitionPhase.set('leaving');
    this.transitionTimers.push(
      setTimeout(() => this.activeIndex.set(targetIndex), COUNTER_SWAP_MS),
      setTimeout(() => {
        this.isQueueAdvancing.set(shiftsQueue);
        this.transitionPhase.set('details-in');
      }, IMAGE_TAKEOVER_MS),
      setTimeout(() => {
        this.isQueueAdvancing.set(false);
        this.queueIndexes.set(nextQueue);
      }, EXPANDER_RELEASE_MS),
      setTimeout(() => {
        this.transitionPhase.set('idle');
        this.completeTransition();
      }, TRANSITION_FINISH_MS),
    );
  }

  private resetTransitionVisuals(): void {
    this.backgroundIndex.set(null);
    this.backgroundCard.set(null);
    this.expandingCard.set(null);
    this.expandingIndex.set(null);
    this.outgoingIndex.set(null);
    this.shiftingIndexes.set([]);
    this.returningIndex.set(null);
    this.queueDirection.set('direct');
    this.isExpanded.set(false);
    this.isTakeoverSettled.set(false);
    this.isQueueAdvancing.set(false);
  }

  private completeTransition(): void {
    this.isTransitioning.set(false);
    this.queueAutoAdvance();
  }

  private queueAutoAdvance(): void {
    this.clearAutoTimer();

    if (!this.isInView || this.pointerPaused || this.isTransitioning()) {
      this.isProgressPaused.set(true);
      return;
    }

    this.progressCycle.update((cycle) => cycle + 1);
    this.isProgressPaused.set(false);
    this.autoTimer = setTimeout(() => this.next(), AUTO_ADVANCE_MS);
  }

  private clearAutoTimer(): void {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
    }
  }

  private queueAfterSelection(
    targetIndex: number,
    outgoingIndex: number,
    direction: QueueDirection,
  ): readonly number[] {
    const selectedPosition = this.queueIndexes().indexOf(targetIndex);

    if (selectedPosition < 0) {
      return this.queueIndexes();
    }

    const remainingQueue = [
      ...this.queueIndexes().slice(0, selectedPosition),
      ...this.queueIndexes().slice(selectedPosition + 1),
    ];

    return direction === 'backward'
      ? [outgoingIndex, ...remainingQueue]
      : [...remainingQueue, outgoingIndex];
  }

  private preloadEventImages(): void {
    this.events().forEach((event) => {
      const image = new Image();
      image.src = event.image;
      this.preloadedImages.push(image);
      void image.decode?.().catch(() => undefined);
    });
  }

}
