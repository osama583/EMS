import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCalendarComponent } from './event-calendar';

describe('EventCalendarComponent', () => {
  let fixture: ComponentFixture<EventCalendarComponent>;
  let component: EventCalendarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventCalendarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCalendarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
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

    expect(fixture.nativeElement.querySelector('.calendar-filter-dialog')).not.toBeNull();
    expect(document.body.classList.contains('calendar-filter-open')).toBe(true);

    component.toggleDraftCategory('Culture & Community');
    fixture.detectChanges();
    component.applyCalendarFilters();
    fixture.detectChanges();

    expect(component.appliedCategories()).toEqual(['Culture & Community']);
    expect(
      component
        .monthDays()
        .flatMap((day) => day.events)
        .every((event) => event.category === 'Culture & Community'),
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
    expect(fixture.nativeElement.querySelector('#day-dialog-title')).not.toBeNull();
    expect(document.body.classList.contains('calendar-dialog-open')).toBe(true);
  });

  it('opens and closes the complete event-details popup', () => {
    const event = component.events[0];

    component.openEvent(event);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('.calendar-dialog') as HTMLElement;
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
