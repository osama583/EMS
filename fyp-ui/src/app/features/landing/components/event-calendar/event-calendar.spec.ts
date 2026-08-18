import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { PublishedEvent } from '../../../../core/events/published-event.models';
import { EventCalendarComponent } from './event-calendar';

// Mirrors the spread of the old hardcoded fixture (titles/categories/dates relative to today) so
// this spec's pre-existing assertions (search matches, category filter, day overflow, event
// dialog) still hold once the calendar is driven by a real HTTP-fetched `PublishedEvent[]`
// instead of a literal array.
function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

const MOCK_EVENT_FIXTURES: readonly {
  title: string;
  daysFromNow: number;
  start: string;
  end: string;
  venue: string;
  category: PublishedEvent['categories'][number];
}[] = [
  { title: 'Future Forward: Tech Expo', daysFromNow: 0, start: '10:00', end: '11:30', venue: 'APU Atrium', category: 'Workshops & Training' },
  { title: 'Startup Pitch Night', daysFromNow: 1, start: '18:30', end: '20:00', venue: 'APU Atrium', category: 'Academic & Career' },
  { title: 'Career Connect Fair', daysFromNow: 3, start: '10:00', end: '15:00', venue: 'Level 3 Expo Hall', category: 'Academic & Career' },
  { title: 'Design Thinking Sprint', daysFromNow: 3, start: '12:30', end: '14:00', venue: 'Design Studio 2', category: 'Workshops & Training' },
  { title: 'Societies Welcome Mixer', daysFromNow: 3, start: '16:00', end: '18:00', venue: 'Campus Plaza', category: 'Clubs & Societies' },
  { title: 'Research Exchange Forum', daysFromNow: 3, start: '18:00', end: '20:00', venue: 'Auditorium 2', category: 'Academic & Career' },
  { title: 'Community Green Day', daysFromNow: 5, start: '08:00', end: '12:00', venue: 'Bukit Jalil Community Park', category: 'Volunteering' },
];

const MOCK_PUBLISHED_EVENTS: readonly PublishedEvent[] = MOCK_EVENT_FIXTURES.map((fixture, index) => ({
  id: `evt-${index + 1}`,
  eventTitle: fixture.title,
  shortIntroduction: 'Mock introduction.',
  goals: 'Mock goals.',
  expectedBenefits: 'Mock benefits.',
  categories: [fixture.category],
  eventVisibility: 'Public',
  eventFormat: 'On Campus',
  eventImage: { url: '/assets/events/mock.jpg', fileName: 'mock.jpg', mimeType: 'image/jpeg', sizeBytes: 0, status: 'uploaded' },
  schoolDepartment: 'Student Affairs',
  audience: ['APU Community'],
  schedule: [{ date: isoDate(fixture.daysFromNow), start: fixture.start, end: fixture.end, location: fixture.venue }],
  totalExpectedPax: 100,
  maxPax: null,
  registrationMode: 'Automatic',
  confirmedRegistrationCount: 10,
  pendingRegistrationCount: 0,
  cost: null,
  bankAccountName: null,
  bankAccountNumber: null,
  isFree: true,
}));

describe('EventCalendarComponent', () => {
  let fixture: ComponentFixture<EventCalendarComponent>;
  let component: EventCalendarComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.removeItem('apu-ems-auth-user');
    await TestBed.configureTestingModule({
      imports: [EventCalendarComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCalendarComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(environment.eventsApiUrl).flush(MOCK_PUBLISHED_EVENTS);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
    TestBed.resetTestingModule();
    document.body.classList.remove('calendar-dialog-open');
    document.body.classList.remove('calendar-filter-open');
  });

  it('renders a complete seven-column, forty-two-day monthly calendar', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.calendar-weekdays span')).toHaveLength(7);
    expect(element.querySelectorAll('.calendar-day')).toHaveLength(42);
    expect(element.querySelector('.calendar-day--today')).not.toBeNull();
    expect(element.querySelector('.calendar-request')).toBeNull();
    expect(
      Array.from(element.querySelectorAll('.calendar-top-legend span')).map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['Academic & Career', 'Workshops', 'Culture', 'Wellness']);
    expect(element.querySelector('app-expandable-search input')).not.toBeNull();
    expect(element.querySelector('app-filter-button button')).not.toBeNull();
  });

  it('moves between months and returns to today', () => {
    const originalMonth = component.currentMonth().getMonth();

    component.navigate(1);
    expect(component.currentMonth().getMonth()).toBe((originalMonth + 1) % 12);

    component.goToToday();
    expect(component.currentMonth().getMonth()).toBe(originalMonth);
  });

  it('provides a compact mobile date selector with the selected day events', () => {
    const eventDay = component.mobileMonthDays().find((day) => day.events.length > 0);
    const expectedTitle = eventDay?.events[0]?.title;

    expect(component.mobileMonthDays().length).toBeGreaterThanOrEqual(28);
    expect(eventDay).toBeDefined();

    component.selectMobileDate(eventDay!);
    fixture.detectChanges();

    expect(component.mobileFocusedDay().key).toBe(eventDay?.key);
    expect(fixture.nativeElement.querySelector('.calendar-mobile-date--selected')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.calendar-mobile-day')?.textContent).toContain(
      expectedTitle,
    );
  });

  it('switches between month, week and agenda views', () => {
    const select = fixture.nativeElement.querySelector(
      '.calendar-view select',
    ) as HTMLSelectElement;

    select.value = 'week';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.viewMode()).toBe('week');
    expect(fixture.nativeElement.querySelectorAll('.week-day')).toHaveLength(7);

    select.value = 'agenda';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.viewMode()).toBe('agenda');
    expect(fixture.nativeElement.querySelector('.calendar-agenda-view')).not.toBeNull();
  });

  it('searches calendar events by title, category and venue', () => {
    const input = fixture.nativeElement.querySelector(
      'app-expandable-search input',
    ) as HTMLInputElement;

    input.value = 'Startup Pitch';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.searchTerm()).toBe('Startup Pitch');
    expect(
      component
        .monthDays()
        .flatMap((day) => day.events)
        .every((event) => event.title.includes('Startup Pitch')),
    ).toBe(true);
  });

  it('filters the calendar from the compact filter dialog', () => {
    component.openCalendarFilters();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.shared-form-modal')).not.toBeNull();
    expect(document.body.classList.contains('calendar-filter-open')).toBe(true);

    component.toggleDraftCategory('Volunteering');
    fixture.detectChanges();
    component.applyCalendarFilters();
    fixture.detectChanges();

    expect(component.appliedCategories()).toEqual(['Volunteering']);
    expect(
      component
        .monthDays()
        .flatMap((day) => day.events)
        .every((event) => event.category === 'Volunteering'),
    ).toBe(true);
    expect(component.calendarFilterOpen()).toBe(false);
    expect(document.body.classList.contains('calendar-filter-open')).toBe(false);
  });

  it('opens a day agenda when more events are hidden', () => {
    const overflowDay = component.monthDays().find((day) => day.events.length > 3);

    expect(overflowDay).toBeDefined();
    component.openDay(overflowDay!);
    fixture.detectChanges();

    expect(component.selectedDay()?.events).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('.shared-form-modal .day-dialog__events')).not.toBeNull();
    expect(document.body.classList.contains('calendar-dialog-open')).toBe(true);
  });

  it('opens and closes the complete event-details popup', () => {
    const event = component.events()[0];

    component.openEvent(event);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.shared-form-modal') as HTMLElement;
    expect(dialog.textContent).toContain(event.title);
    expect(dialog.textContent).toContain(event.time);
    expect(dialog.textContent).toContain(event.venue);
    expect(dialog.textContent).toContain(event.category);
    expect(dialog.querySelector('.calendar-dialog__action')?.textContent).toContain(
      'Explore Event',
    );

    component.onEscape();
    expect(component.selectedEvent()).toBeNull();
    expect(document.body.classList.contains('calendar-dialog-open')).toBe(false);
  });
});
