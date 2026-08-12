import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { PublishedEvent } from '../../../../core/events/published-event.models';
import { HappeningSoonComponent } from './happening-soon';

const inDays = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

// Mirrors the old hardcoded 5-event fixture (titles/images/day offsets 1/3/5/7/9, all inside the
// "Next 10 days" window) so this spec's pre-existing carousel-behaviour assertions still hold once
// the deck is driven by a real HTTP-fetched `PublishedEvent[]` instead of a literal array.
const MOCK_EVENT_FIXTURES: readonly { title: string; days: number; image: string }[] = [
  { title: 'Future Forward: Tech Expo', days: 1, image: '/assets/events/tech-expo.jpg' },
  { title: 'One World Cultural Night', days: 3, image: '/assets/events/cultural-night.jpg' },
  { title: 'APU Esports Showdown', days: 5, image: '/assets/events/esports-showdown.jpg' },
  { title: 'Campus After Dark', days: 7, image: '/assets/events/campus-after-dark.jpg' },
  { title: 'Wellness Run & Community Day', days: 9, image: '/assets/events/wellness-run.jpg' },
];

const MOCK_PUBLISHED_EVENTS: readonly PublishedEvent[] = MOCK_EVENT_FIXTURES.map((fixture, index) => ({
  id: `evt-${index + 1}`,
  eventTitle: fixture.title,
  shortIntroduction: 'Mock introduction.',
  goals: 'Mock goals.',
  expectedBenefits: 'Mock benefits.',
  categories: ['Entertainment & Social'],
  eventVisibility: 'Public',
  eventFormat: 'On Campus',
  eventImage: { url: fixture.image, fileName: fixture.image.split('/').at(-1) ?? 'mock.jpg', mimeType: 'image/jpeg', sizeBytes: 0, status: 'uploaded' },
  schoolDepartment: 'Student Affairs',
  audience: ['APU Community'],
  schedule: [{ date: inDays(fixture.days), start: '10:00', end: '12:00', location: 'APU Atrium' }],
  totalExpectedPax: 100,
  registrationMode: 'Automatic',
  confirmedRegistrationCount: 10,
  pendingRegistrationCount: 0,
  isFree: true,
}));

describe('HappeningSoonComponent', () => {
  let fixture: ComponentFixture<HappeningSoonComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    await TestBed.configureTestingModule({
      imports: [HappeningSoonComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    vi.useFakeTimers();
    fixture = TestBed.createComponent(HappeningSoonComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(environment.eventsApiUrl).flush(MOCK_PUBLISHED_EVENTS);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('presents five events occurring within the next ten days', () => {
    const component = fixture.componentInstance;
    const section = fixture.nativeElement.querySelector('#happening-soon') as HTMLElement;
    const eventCards = fixture.nativeElement.querySelectorAll('.event-card');

    expect(component.events()).toHaveLength(5);
    expect(
      component.events().every((event) => event.daysFromNow >= 1 && event.daysFromNow <= 10),
    ).toBe(true);
    expect(section).not.toBeNull();
    expect(eventCards).toHaveLength(4);
    expect(component.eventCards()[0].index).toBe(1);
    expect(section.textContent).toContain('Future Forward: Tech Expo');
    expect(section.textContent).toContain('Next 10 days');
  });

  it('expands the selected card, updates the counter, and reveals the new story in order', () => {
    vi.useFakeTimers();
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const firstCard = element.querySelector<HTMLElement>('.event-card');
    const firstImage = firstCard?.querySelector<HTMLImageElement>('img');

    expect(firstCard?.dataset['eventIndex']).toBe('1');
    component.next();
    fixture.detectChanges(false);
    expect(component.transitionPhase()).toBe('leaving');

    vi.advanceTimersByTime(16);
    expect(component.transitionPhase()).toBe('image-in');
    expect(component.activeIndex()).toBe(0);
    expect(component.counterLabel()).toBe('01');
    expect(component.expandingCard()?.image).toContain('cultural-night.jpg');
    expect(component.expandingIndex()).toBe(1);
    expect(component.isExpanded()).toBe(true);
    expect(component.isQueueAdvancing()).toBe(true);
    expect(component.eventCards()[0].index).toBe(1);
    expect(component.eventCards()).toHaveLength(5);
    expect(element.querySelector('.event-expander')).toBeNull();

    vi.advanceTimersByTime(420);
    expect(component.activeIndex()).toBe(1);
    expect(component.counterLabel()).toBe('02');
    expect(component.transitionPhase()).toBe('image-in');

    vi.advanceTimersByTime(140);
    expect(component.transitionPhase()).toBe('details-in');
    expect(component.activeEvent().title).toBe('One World Cultural Night');
    expect(component.isTakeoverSettled()).toBe(true);
    expect(component.isQueueAdvancing()).toBe(true);
    expect(component.eventCards()[0].index).toBe(1);

    vi.advanceTimersByTime(520);
    expect(component.transitionPhase()).toBe('idle');
    expect(component.expandingCard()).toBeNull();
    expect(component.isQueueAdvancing()).toBe(false);
    expect(component.expandingIndex()).toBeNull();
    expect(component.backgroundIndex()).toBe(1);
    expect(component.backgroundCard()?.image).toContain('cultural-night.jpg');
    expect(component.queueCards()[0].index).toBe(2);
    expect(component.queueCards()[0].event.title).toBe('APU Esports Showdown');
    expect(component.queueCards()).toHaveLength(4);
    expect(component.eventCards()).toHaveLength(5);

    fixture.detectChanges(false);
    const persistentCard = element.querySelector<HTMLElement>('[data-event-index="1"]');
    expect(persistentCard).toBe(firstCard);
    expect(persistentCard?.querySelector('img')).toBe(firstImage);
  });

  it('provides labelled carousel controls and event imagery', () => {
    const element = fixture.nativeElement as HTMLElement;
    const images = [...element.querySelectorAll<HTMLImageElement>('.event-card img')];

    expect(element.querySelector('[aria-label="Previous event"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Next event"]')).not.toBeNull();
    expect(
      images.every((image) => Boolean(image.alt) && image.src.includes('/assets/events/')),
    ).toBe(true);
  });

  it('closes only the selected middle-card gap while keeping the first card unchanged', () => {
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const middleCard = element.querySelector<HTMLElement>('[data-event-index="3"]');

    expect(component.queueIndexes()).toEqual([1, 2, 3, 4]);
    component.goTo(3, middleCard ?? undefined);

    expect(component.queueIndexes()).toEqual([1, 2, 3, 4]);
    expect(component.shiftingIndexes()).toEqual([4, 0]);

    vi.advanceTimersByTime(1_096);

    expect(component.activeIndex()).toBe(3);
    expect(component.queueIndexes()).toEqual([1, 2, 4, 0]);
    expect(component.queueCards()[0].index).toBe(1);
    expect(component.queueCards()[2].index).toBe(4);
    expect(component.queueCards()[3].index).toBe(0);
    expect(component.shiftingIndexes()).toEqual([]);
  });

  it('keeps the Explore Events story action visual-only', () => {
    const action = fixture.nativeElement.querySelector('app-cta-link .cta-link') as HTMLButtonElement;

    expect(action.tagName).toBe('BUTTON');
    expect(action.textContent).toContain('Explore Event');
    expect(action.hasAttribute('href')).toBe(false);
  });

  it('opens the first queue card with next and the final queue card with previous', () => {
    const component = fixture.componentInstance;

    expect(component.queueIndexes()).toEqual([1, 2, 3, 4]);
    component.next();
    vi.advanceTimersByTime(1_096);

    expect(component.activeIndex()).toBe(1);
    expect(component.queueIndexes()).toEqual([2, 3, 4, 0]);

    component.previous();
    expect(component.queueDirection()).toBe('backward');
    expect(component.shiftingIndexes()).toEqual([2, 3, 4]);
    expect(component.returningIndex()).toBe(1);
    expect(component.eventCards().map((card) => card.index)).toEqual([2, 3, 4, 0, 1]);
    vi.advanceTimersByTime(1_096);

    expect(component.activeIndex()).toBe(0);
    expect(component.queueIndexes()).toEqual([1, 2, 3, 4]);
    expect(component.queueIndexes()[0]).toBe(1);
    expect(component.queueIndexes()[3]).toBe(4);
    expect(component.queueDirection()).toBe('direct');
    expect(component.returningIndex()).toBeNull();
  });

  it('fills a new fifteen-second progress cycle before each automatic transition', () => {
    const component = fixture.componentInstance;

    component.pauseCarousel();
    const previousCycle = component.progressCycle();
    component.resumeCarousel();

    expect(component.progressCycle()).toBe(previousCycle + 1);
    expect(component.isProgressPaused()).toBe(false);

    vi.advanceTimersByTime(14_999);
    expect(component.activeIndex()).toBe(0);
    expect(component.isTransitioning()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(component.isTransitioning()).toBe(true);

    vi.advanceTimersByTime(420);
    expect(component.activeIndex()).toBe(1);

    vi.advanceTimersByTime(660);
    expect(component.isTransitioning()).toBe(false);
    expect(component.progressCycle()).toBe(previousCycle + 2);
    expect(component.isProgressPaused()).toBe(false);
  });

  it('shows an empty state when there are no upcoming events', async () => {
    httpMock.verify();
    fixture.destroy();
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [HappeningSoonComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const emptyFixture = TestBed.createComponent(HappeningSoonComponent);
    const emptyHttpMock = TestBed.inject(HttpTestingController);
    emptyFixture.detectChanges();
    emptyHttpMock.expectOne(environment.eventsApiUrl).flush([]);
    emptyFixture.detectChanges();

    const element = emptyFixture.nativeElement as HTMLElement;
    expect(element.querySelector('.happening-empty')).not.toBeNull();
    expect(element.textContent).toContain('Nothing happening just yet');

    emptyHttpMock.verify();
    emptyFixture.destroy();
  });
});
