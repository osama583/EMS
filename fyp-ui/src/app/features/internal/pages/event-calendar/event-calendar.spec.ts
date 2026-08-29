import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { MasterEventCalendarComponent } from './event-calendar';

// The component fetches the master-calendar range on construction, and EventCategoryService
// fetches the category catalog (which drives the color slots). Both must be answered or
// HttpTestingController.verify() fails in afterEach.
function flushCatalog(httpMock: HttpTestingController): void {
  httpMock
    .match((request) => request.url.startsWith(`${environment.apiBaseUrl}/catalog`))
    .forEach((request) => request.flush([{ id: 1, name: 'Workshop' }, { id: 2, name: 'Sports' }]));
}

function flushCalendar(httpMock: HttpTestingController, body: Record<string, unknown>): void {
  const requests = httpMock.match((request) =>
    request.url === `${environment.apiBaseUrl}/events/master-calendar`,
  );
  requests.forEach((request) => request.flush(body));
}

// One visible public event, one Club Only event the viewer may NOT see (server already redacted
// it to a placeholder), and a date carrying private events as a bare count. This mirrors exactly
// what events.py's master_calendar() returns for an ordinary internal viewer.
const RESPONSE = {
  events: [
    {
      id: '1',
      restricted: false,
      eventTitle: 'Robotics Workshop',
      shortIntroduction: 'Hands-on session.',
      eventVisibility: 'Public',
      eventFormat: 'Physical',
      eventImage: null,
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
    },
    {
      id: '2',
      restricted: true,
      restrictedLabel: 'Restricted Club Event',
      eventVisibility: 'Club Only',
      schedule: [{ date: '2026-09-10', start: '', end: '', location: '' }],
    },
    {
      id: '3',
      restricted: false,
      eventTitle: 'Inter-Faculty Futsal',
      shortIntroduction: 'Open tournament.',
      eventVisibility: 'Internal',
      eventFormat: 'Physical',
      eventImage: null,
      schoolDepartment: 'Student Services',
      organiser: 'Marcus Tan',
      // Still at department_review: on the calendar, but not fully approved.
      proposalStatus: 'department_review',
      categories: ['Sports'],
      clubs: [],
      schedule: [{ date: '2026-09-12', start: '16:00', end: '18:00', location: 'Court 1' }],
      totalExpectedPax: 80,
      maxPax: null,
      registrationMode: 'Manual',
      confirmedRegistrationCount: 30,
      cost: 15,
      isFree: false,
    },
  ],
  privateCounts: { '2026-09-10': 3 },
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
    // Navigate to the month the fixture data lives in so the entries land on visible days.
    component.viewMode.set('day');
    fixture.detectChanges();
    flushCatalog(httpMock);
    flushCalendar(httpMock, RESPONSE);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('expands each schedule row into its own dated entry', () => {
    const entries = component.entries();
    expect(entries.length).toBe(3);
    expect(entries.map((entry) => entry.dateKey).sort()).toEqual(['2026-09-10', '2026-09-10', '2026-09-12']);
  });

  it('keeps a redacted club event on the grid but strips every detail field', () => {
    const restricted = component.entries().find((entry) => entry.restricted);
    expect(restricted).toBeTruthy();
    expect(restricted!.title).toBe('Restricted Club Event');
    // The whole point of the redaction: the date is occupied, nothing else is disclosed.
    expect(restricted!.venue).toBe('');
    expect(restricted!.time).toBe('');
    expect(restricted!.organiser).toBe('');
    expect(restricted!.description).toBe('');
  });

  it('refuses to open a detail dialog for a redacted event', () => {
    const restricted = component.entries().find((entry) => entry.restricted)!;
    component.openEntry(restricted);
    expect(component.selectedEntry()).toBeNull();
  });

  it('opens the dialog for an event the viewer is entitled to see', () => {
    const visible = component.entries().find((entry) => !entry.restricted)!;
    component.openEntry(visible);
    expect(component.selectedEntry()?.title).toBe('Robotics Workshop');
    component.closeDialog();
    expect(component.selectedEntry()).toBeNull();
  });

  it('marks a department_review event as provisional and an approved one as final', () => {
    const byTitle = new Map(component.entries().map((entry) => [entry.title, entry]));
    expect(byTitle.get('Inter-Faculty Futsal')!.provisional).toBe(true);
    expect(byTitle.get('Robotics Workshop')!.provisional).toBe(false);
  });

  it('surfaces private events only as a per-date count, never as entries', () => {
    expect(component.privateCounts()['2026-09-10']).toBe(3);
    // No entry may originate from a private event - the server sent none.
    expect(component.entries().some((entry) => entry.visibility === 'Private')).toBe(false);
    expect(component.privateLabel(3)).toBe('3 Private Events');
    expect(component.privateLabel(1)).toBe('1 Private Event');
  });

  it('excludes redacted rows once the viewer narrows by search, since they cannot match', () => {
    component.onSearch('Robotics');
    fixture.detectChanges();
    component.focusedDate.set(new Date(2026, 8, 10));
    const shown = component.focusedDay().entries;
    expect(shown.length).toBe(1);
    expect(shown[0].title).toBe('Robotics Workshop');
  });

  it('re-queries when the visible range changes', () => {
    component.setView('month');
    fixture.detectChanges();
    // Switching view changes queryRange, which triggers a fresh fetch.
    const requests = httpMock.match((request) =>
      request.url === `${environment.apiBaseUrl}/events/master-calendar`,
    );
    expect(requests.length).toBeGreaterThan(0);
    requests.forEach((request) => request.flush({ events: [], privateCounts: {} }));
  });
});
