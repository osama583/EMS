import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { MasterEventCalendarComponent } from './event-calendar';

// Mirrors SEARCH_DEBOUNCE_MS in event-calendar.ts.
const SEARCH_DEBOUNCE_MS = 250;

const SUMMARY_URL = `${environment.apiBaseUrl}/events/master-calendar`;
const DAY_URL = `${SUMMARY_URL}/day`;
const DETAIL_URL = `${SUMMARY_URL}/1`;

// The component fetches the visible range on construction, and EventCategoryService fetches the
// category catalog (which drives the color slots). Both must be answered or verify() fails.
function flushCatalog(httpMock: HttpTestingController): void {
  httpMock
    .match((request) => request.url.startsWith(`${environment.apiBaseUrl}/catalog`))
    .forEach((request) => request.flush([{ id: 1, name: 'Workshop' }, { id: 2, name: 'Sports' }]));
}

function pendingSummary(httpMock: HttpTestingController) {
  return httpMock.match((request) => request.url === SUMMARY_URL);
}

function pendingDay(httpMock: HttpTestingController) {
  return httpMock.match((request) => request.url === DAY_URL);
}

// match() returns [] when nothing is pending, so both of these are safe no-ops. The mobile day
// panel is only fetched below the compact breakpoint, which the karma window may or may not be.
function flushSummary(httpMock: HttpTestingController, body: Record<string, unknown>): void {
  pendingSummary(httpMock).forEach((request) => request.flush(body));
}

function flushDay(httpMock: HttpTestingController, body: Record<string, unknown>): void {
  pendingDay(httpMock).forEach((request) => request.flush(body));
}

// TIER 1 - what the grid gets, and all it gets. One visible public event, one Club Only event the
// viewer may NOT see (already redacted server-side to a date and nothing more), and a date
// carrying private events as a bare count. Note what is absent: no description, image, organiser,
// venue, pax, cost or registration count. Those belong to tiers 2 and 3.
const SUMMARY = {
  occurrences: [
    {
      occurrenceId: '11',
      eventId: '1',
      date: '2026-09-10',
      start: '09:00',
      end: '11:00',
      title: 'Robotics Workshop',
      category: 'Workshop',
      provisional: false,
      restricted: false,
    },
    { occurrenceId: '12', date: '2026-09-10', restricted: true },
    {
      occurrenceId: '13',
      eventId: '3',
      date: '2026-09-12',
      start: '16:00',
      end: '18:00',
      title: 'Inter-Faculty Futsal',
      category: 'Sports',
      // Still at department_review: on the calendar, but not fully approved.
      provisional: true,
      restricted: false,
    },
  ],
  privateCounts: { '2026-09-10': 3 },
};

// TIER 2 - the same rows for one day, plus the venue and organiser a list row shows.
const DAY = {
  occurrences: [
    {
      occurrenceId: '11',
      eventId: '1',
      date: '2026-09-10',
      start: '09:00',
      end: '11:00',
      title: 'Robotics Workshop',
      category: 'Workshop',
      provisional: false,
      restricted: false,
      venue: 'Lab 4',
      organiser: 'Aisha Rahman',
    },
    { occurrenceId: '12', date: '2026-09-10', restricted: true },
  ],
  privateCount: 3,
};

// TIER 3 - the dialog's payload, fetched only when a dialog opens.
const DETAIL = {
  id: '1',
  eventTitle: 'Robotics Workshop',
  shortIntroduction: 'Hands-on session.',
  eventVisibility: 'Public',
  eventFormat: 'Physical',
  schoolDepartment: 'School of Computing',
  organiser: 'Aisha Rahman',
  proposalStatus: 'completed_approved',
  categories: ['Workshop'],
  clubs: [],
  schedule: [{ date: '2026-09-10', start: '09:00', end: '11:00', location: 'Lab 4' }],
  totalExpectedPax: 40,
  maxPax: 60,
  registrationMode: 'Automatic',
  confirmedRegistrationCount: 12,
  cost: null,
  isFree: true,
};

describe('MasterEventCalendarComponent', () => {
  let fixture: ComponentFixture<MasterEventCalendarComponent>;
  let component: MasterEventCalendarComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MasterEventCalendarComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MasterEventCalendarComponent);
    httpMock = TestBed.inject(HttpTestingController);
    component = fixture.componentInstance;
    // Move to the month the fixture data lives in BEFORE the first render, so the initial fetch
    // is the only one and its entries land on visible days.
    component.currentMonth.set(new Date(2026, 8, 1));
    component.focusedDate.set(new Date(2026, 8, 10));
    fixture.detectChanges();
    flushCatalog(httpMock);
    flushSummary(httpMock, SUMMARY);
    flushDay(httpMock, DAY);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  function entriesOn(dateKey: string) {
    return component.monthDays().find((day) => day.key === dateKey)!.entries;
  }

  // --- the tiering itself, which is the point of the split -----------------
  it('opens the page with the range feed alone - no day and no event detail', () => {
    // beforeEach already answered the range request; if the page had also asked for an event's
    // detail up front, verify() in afterEach would fail on the unmatched request. Assert it
    // directly as well, so the reason a regression fails is legible.
    httpMock.expectNone(DETAIL_URL);
  });

  it('asks for an event detail only when its dialog opens, and only once', () => {
    const visible = entriesOn('2026-09-10').find((entry) => !entry.restricted)!;
    httpMock.expectNone(DETAIL_URL);

    component.openEntry(visible);
    httpMock.expectOne(DETAIL_URL).flush(DETAIL);
    expect(component.selectedDetail()?.shortIntroduction).toBe('Hands-on session.');

    // Reopening the same event is served from memory rather than refetched.
    component.closeDialog();
    component.openEntry(visible);
    httpMock.expectNone(DETAIL_URL);
    expect(component.selectedDetail()?.id).toBe('1');
    component.closeDialog();
  });

  it('serves the day view from the day feed alone, never the range feed too', () => {
    component.setView('day');
    fixture.detectChanges();

    // The day IS the whole view here, so asking the range endpoint for the same single date
    // would be the same data fetched twice.
    expect(pendingSummary(httpMock).length).toBe(0);
    const requests = pendingDay(httpMock);
    expect(requests.length).toBe(1);
    expect(requests[0].request.params.get('date')).toBe('2026-09-10');
    requests[0].flush(DAY);
    fixture.detectChanges();

    const listed = component.selectedDayEntries();
    // The redacted row is listed here as well - #listRow has a restricted branch for it, so the
    // day reads as occupied without disclosing anything, exactly as the grid does.
    expect(listed.map((entry) => entry.title)).toEqual(['Robotics Workshop', 'Restricted Club Event']);
    // Venue and organiser exist HERE and only here - the grid tier never carried them.
    expect(listed[0].venue).toBe('Lab 4');
    expect(listed[0].organiser).toBe('Aisha Rahman');
  });

  // This app is zoneless - zone.js is not even a dependency - so fakeAsync()/tick() cannot be
  // used here. They throw while the suite is being COLLECTED, which takes down every test in
  // this file rather than just this one, which is how the whole spec came to be silently
  // running zero tests.
  it('narrows the calendar server-side, sending the search term as a debounced query param', async () => {
    component.onSearch('Robotics');
    fixture.detectChanges();
    // Waited out for real: the term crosses an rxjs debounce and then two Angular effects
    // (toObservable -> toSignal -> the range effect), and only the first of those is a clock.
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
    fixture.detectChanges();

    const requests = pendingSummary(httpMock);
    expect(requests.length).toBe(1);
    expect(requests[0].request.params.get('q')).toBe('Robotics');
    requests[0].flush({ occurrences: [SUMMARY.occurrences[0]], privateCounts: {} });
    flushDay(httpMock, { occurrences: [DAY.occurrences[0]], privateCount: 0 });
    fixture.detectChanges();

    expect(entriesOn('2026-09-10').map((entry) => entry.title)).toEqual(['Robotics Workshop']);
  });

  // --- what the grid tier renders ------------------------------------------
  it('expands each occurrence onto its own date', () => {
    expect(entriesOn('2026-09-10').length).toBe(2);
    expect(entriesOn('2026-09-12').map((entry) => entry.title)).toEqual(['Inter-Faculty Futsal']);
    expect(component.totalVisibleCount()).toBe(3);
  });

  it('keeps a redacted club event on the grid carrying its date and nothing else', () => {
    const restricted = entriesOn('2026-09-10').find((entry) => entry.restricted)!;
    expect(restricted.title).toBe('Restricted Club Event');
    // The whole point of the redaction: the date is occupied, nothing else is disclosed - and
    // with the tiering, not even an event id it could be looked up by.
    expect(restricted.time).toBe('');
    expect(restricted.eventId).toBe('');
    expect(restricted.category).toBe('');
  });

  it('refuses to open a detail dialog for a redacted event', () => {
    const restricted = entriesOn('2026-09-10').find((entry) => entry.restricted)!;
    component.openEntry(restricted);
    expect(component.selectedEntry()).toBeNull();
    httpMock.expectNone(DETAIL_URL);
  });

  it('marks a department_review event as provisional and an approved one as final', () => {
    expect(entriesOn('2026-09-12')[0].provisional).toBe(true);
    expect(entriesOn('2026-09-10').find((entry) => !entry.restricted)!.provisional).toBe(false);
  });

  it('surfaces private events only as a per-date count, never as entries', () => {
    const day = component.monthDays().find((entry) => entry.key === '2026-09-10')!;
    expect(day.privateCount).toBe(3);
    expect(component.totalPrivateCount()).toBe(3);
    expect(component.privateLabel(3)).toBe('3 Private Events');
    expect(component.privateLabel(1)).toBe('1 Private Event');
  });

  it('builds the legend from the categories actually in the loaded range', () => {
    expect(component.categoryOptions().map((option) => option.name)).toEqual(['Sports', 'Workshop']);
  });

  it('re-queries the range when the visible period changes', () => {
    component.setView('week');
    fixture.detectChanges();
    const requests = pendingSummary(httpMock);
    expect(requests.length).toBe(1);
    requests[0].flush({ occurrences: [], privateCounts: {} });
    flushDay(httpMock, { occurrences: [], privateCount: 0 });
  });

  // --- surviving a failed request ------------------------------------------
  // A range request errors for ordinary reasons: the API is down, a session expires, one blip on
  // the wire. What must NOT happen is the calendar going dead - if the error reaches the
  // subscriber of the switchMap, rxjs tears the whole subscription down and the page never
  // requests anything again for as long as it stays open. Navigating, searching and switching
  // views all silently stop working, and only a reload brings it back.
  it('keeps serving the range after a failed request rather than going dead', () => {
    component.navigate(1);
    fixture.detectChanges();

    const failed = pendingSummary(httpMock);
    expect(failed.length).toBe(1);
    failed[0].error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(component.loadError()).not.toBe('');

    // The pipeline is still live: the next month issues a NEW request, and a good response
    // clears the error rather than leaving it on screen forever.
    component.navigate(1);
    fixture.detectChanges();

    const retried = pendingSummary(httpMock);
    expect(retried.length).toBe(1);
    retried[0].flush({ occurrences: [], privateCounts: {} });
    fixture.detectChanges();
    expect(component.loadError()).toBe('');
  });

  it('keeps serving day rows after a failed day request', () => {
    component.setView('day');
    fixture.detectChanges();
    pendingDay(httpMock)[0].error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(component.selectedDayEntries()).toEqual([]);

    // Same rule one tier down: moving to another day has to ask again.
    component.navigate(1);
    fixture.detectChanges();

    const retried = pendingDay(httpMock);
    expect(retried.length).toBe(1);
    expect(retried[0].request.params.get('date')).toBe('2026-09-11');
    retried[0].flush(DAY);
    fixture.detectChanges();
    // Both DAY rows land - the visible one and the redacted one.
    expect(component.selectedDayEntries().length).toBe(2);
  });
});
