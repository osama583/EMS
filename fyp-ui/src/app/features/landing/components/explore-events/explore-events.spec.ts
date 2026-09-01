import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { EventSearchResponse, PublishedEvent } from '../../../../core/events/published-event.models';
import { ExploreEventsComponent } from './explore-events';
import { AuthService } from '../../../../core/auth/auth.service';
import { testRole, testTokens, testUser } from '../../../../core/auth/auth.test-fixtures';

// Both variants (public landing page, internal Explore Events) are driven by the SAME server
// search — GET /events/search — with the same filter groups, and there is no separate
// client-side filtering path to keep in sync with the backend's. See explore-events.ts's
// buildSearchParams()/load(). The internal-variant suite lives in
// explore-events-internal.spec.ts (kept in a separate file: Angular's TestBed cannot be
// reconfigured across a second describe() block in the same file).
export const SEARCH_URL = `${environment.apiBaseUrl}/events/search`;

export const MOCK_EVENT_FIXTURES: readonly { title: string; category: PublishedEvent['categories'][number]; school: string; isFree: boolean }[] = [
  { title: 'Startup Pitch Night', category: 'Academic & Career', school: 'School of Technology', isFree: true },
  { title: 'Career Connect Fair', category: 'Academic & Career', school: 'School of Business', isFree: true },
  { title: 'Community Green Day', category: 'Volunteering', school: 'Student Affairs', isFree: true },
  { title: 'Future Forward: Tech Expo', category: 'Workshops & Training', school: 'School of Technology', isFree: true },
  { title: 'One World Cultural Night', category: 'Culture & Community', school: 'Student Affairs', isFree: true },
  { title: 'APU Esports Showdown', category: 'Entertainment & Social', school: 'School of Computing', isFree: true },
];

export const MOCK_PUBLISHED_EVENTS: readonly PublishedEvent[] = MOCK_EVENT_FIXTURES.map((fixture, index) => ({
  id: `evt-${index + 1}`,
  eventTitle: fixture.title,
  shortIntroduction: 'Mock introduction.',
  goals: 'Mock goals.',
  expectedBenefits: 'Mock benefits.',
  categories: [fixture.category],
  eventVisibility: 'Public',
  eventFormat: 'On Campus',
  eventImage: { url: '/assets/events/mock.jpg', fileName: 'mock.jpg', mimeType: 'image/jpeg', sizeBytes: 0, status: 'uploaded' },
  schoolDepartment: fixture.school,
  organiser: 'Mock Organiser',
  clubs: [],
  audience: ['APU Community'],
  schedule: [{ date: '2026-12-01', start: '10:00', end: '12:00', location: 'APU Atrium' }],
  totalExpectedPax: 100,
  maxPax: null,
  registrationMode: 'Automatic',
  confirmedRegistrationCount: 10,
  pendingRegistrationCount: 0,
  cost: fixture.isFree ? null : 25,
  bankAccountName: null,
  bankAccountNumber: null,
  isFree: fixture.isFree,
}));

export function searchResponse(items: readonly PublishedEvent[]): EventSearchResponse {
  return { items, total: items.length, page: 1, pageSize: items.length };
}

describe('ExploreEventsComponent (public variant)', () => {
  let fixture: ComponentFixture<ExploreEventsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.removeItem('apu-ems-auth-user');
    localStorage.removeItem('apu-ems-event-engagement');
    await TestBed.configureTestingModule({
      imports: [ExploreEventsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ExploreEventsComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    // The public variant loads its filter option lists too — every one of those endpoints is
    // reachable without a token (events.py's list_event_schools, catalog.py's list_catalogue).
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/events/schools`).flush(['School of Technology', 'Student Affairs']);
    httpMock.match((request) => request.url.startsWith(`${environment.apiBaseUrl}/catalog`)).forEach((request) => request.flush([]));
    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse(MOCK_PUBLISHED_EVENTS));
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
    TestBed.resetTestingModule();
    document.body.classList.remove('filters-open');
  });

  it('renders the discovery controls, including the same filter button as Explore Events', () => {
    const element = fixture.nativeElement as HTMLElement;
    const cards = element.querySelectorAll('.explore-card');

    expect(element.querySelector('#explore-events-title')?.textContent).toContain('Discover Your Campus');
    expect(element.querySelector('input[type="search"]')).not.toBeNull();
    expect(element.querySelector('app-filter-button button')).not.toBeNull();
    expect(cards).toHaveLength(6);
  });

  it('offers every filter group except Visibility, which the landing page pins to Public', () => {
    const groups = fixture.componentInstance.filterGroups().map((group) => group.key);

    expect(groups).toEqual(['category', 'school', 'format', 'date', 'time', 'registration', 'cost']);
  });

  it('sends the search term as a server query param, scoped to Public visibility', () => {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'career';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const request = httpMock.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.getAll('visibility')).toEqual(['Public']);
    expect(request.request.params.get('q')).toBe('career');
    expect(request.request.params.has('category')).toBe(false);
    request.flush(searchResponse([MOCK_PUBLISHED_EVENTS[1]]));
  });

  // The whole point of the filter here: it narrows the query the SERVER runs, not the page of
  // cards already on screen.
  it('sends an applied filter as a query param on the next search, still scoped to Public', () => {
    const component = fixture.componentInstance;
    component.openFilters();
    component.toggleDraftFilter('cost', 'Paid');
    component.applyFilters();
    fixture.detectChanges();

    const request = httpMock.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.getAll('cost')).toEqual(['Paid']);
    expect(request.request.params.getAll('visibility')).toEqual(['Public']);
    request.flush(searchResponse([]));
    fixture.detectChanges();

    expect(component.appliedFilterChips()).toEqual([{ group: 'cost', value: 'Paid' }]);
  });

  it('re-searches without a filter once its chip is removed', () => {
    const component = fixture.componentInstance;
    component.openFilters();
    component.toggleDraftFilter('cost', 'Paid');
    component.applyFilters();
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse([]));
    fixture.detectChanges();

    component.removeAppliedFilter('cost', 'Paid');
    fixture.detectChanges();

    const request = httpMock.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.has('cost')).toBe(false);
    request.flush(searchResponse(MOCK_PUBLISHED_EVENTS));
  });

  it('turns the heart blue the instant it is clicked, before the PUT resolves', () => {
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      { email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant' },
    ), testTokens());
    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;

    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
    expect(saveButton.classList.contains('save-event--saved')).toBe(false);

    saveButton.click();
    fixture.detectChanges();

    // Optimistic: already blue before the request behind it is flushed — a page reload must
    // never be the thing that makes this true.
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.classList.contains('save-event--saved')).toBe(true);

    httpMock.expectOne((req) => req.method === 'PUT' && req.url === `${environment.apiBaseUrl}/events/me/saved/evt-1`)
      .flush({ eventId: 'evt-1', saved: true });
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('turns the heart gray the instant a saved event is unsaved, before the DELETE resolves', () => {
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      { email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant' },
    ), testTokens());
    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;

    saveButton.click();
    fixture.detectChanges();
    httpMock.expectOne((req) => req.method === 'PUT').flush({ eventId: 'evt-1', saved: true });
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');

    saveButton.click();
    fixture.detectChanges();

    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
    expect(saveButton.classList.contains('save-event--saved')).toBe(false);

    httpMock.expectOne((req) => req.method === 'DELETE' && req.url === `${environment.apiBaseUrl}/events/me/saved/evt-1`)
      .flush({ eventId: 'evt-1', saved: false });
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('rolls the heart back if the server rejects the save', () => {
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      { email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant' },
    ), testTokens());
    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;

    saveButton.click();
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');

    httpMock.expectOne((req) => req.method === 'PUT' && req.url === `${environment.apiBaseUrl}/events/me/saved/evt-1`)
      .flush('Server error', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
  });
});
