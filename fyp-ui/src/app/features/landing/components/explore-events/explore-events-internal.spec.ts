import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { testRole, testTokens, testUser } from '../../../../core/auth/auth.test-fixtures';
import { ExploreEventsComponent } from './explore-events';
import { MOCK_PUBLISHED_EVENTS, SEARCH_URL, searchResponse } from './explore-events.spec';

// Internal Explore Events (variant="internal") — the server-searched, fully-filtered view. See
// explore-events.spec.ts for the public landing-page variant and the shared fixtures/helpers.
describe('ExploreEventsComponent (internal variant)', () => {
  let fixture: ComponentFixture<ExploreEventsComponent>;
  let component: ExploreEventsComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    localStorage.removeItem('apu-ems-auth-user');
    localStorage.removeItem('apu-ems-event-engagement');
    await TestBed.configureTestingModule({
      imports: [ExploreEventsComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(ExploreEventsComponent);
    fixture.componentRef.setInput('variant', 'internal');
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    // loadSchoolOptions() calls GET /events/schools directly (see explore-events.ts) rather than
    // deriving schools from the full published-events list.
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

  it('offers the filter button and dialog', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-filter-button button')).not.toBeNull();
    expect(component.filterGroups().map((group) => group.key)).toContain('category');
  });

  it('sends applied filters as query params on the next search request', () => {
    component.openFilters();
    component.toggleDraftFilter('cost', 'Paid');
    component.applyFilters();
    fixture.detectChanges();

    const request = httpMock.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.getAll('cost')).toEqual(['Paid']);
    request.flush(searchResponse([]));
  });

  it('removes an applied filter chip and re-searches without it', () => {
    component.openFilters();
    component.toggleDraftFilter('cost', 'Paid');
    component.applyFilters();
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse([]));
    fixture.detectChanges();

    expect(component.appliedFilterChips()).toHaveLength(1);
    component.removeAppliedFilter('cost', 'Paid');
    fixture.detectChanges();

    const request = httpMock.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.has('cost')).toBe(false);
    request.flush(searchResponse(MOCK_PUBLISHED_EVENTS));
  });

  it('loads school filter options from every published event, not just the current page', () => {
    const schoolGroup = component.filterGroups().find((group) => group.key === 'school');
    expect(schoolGroup?.options).toContain('School of Technology');
    expect(schoolGroup?.options).toContain('Student Affairs');
  });

  it('rolls a clicked heart back to gray when the save API rejects it', () => {
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      { email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant' },
    ), testTokens());
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse(MOCK_PUBLISHED_EVENTS));
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/events/me/registration-statuses`).flush({});
    fixture.detectChanges();
    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;

    saveButton.click();
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');

    httpMock.expectOne((req) => req.method === 'PUT' && req.url === `${environment.apiBaseUrl}/events/me/saved/evt-1`)
      .flush('Server error', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // The save did not happen, so the heart must not claim it did — otherwise the card
    // contradicts itself on the next reload.
    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
    expect(saveButton.classList.contains('save-event--saved')).toBe(false);
  });
  it('keeps the same heart element mounted and blue across a search refresh', () => {
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      { email: 'applicant@demo.apu.edu.my', displayName: 'Demo Applicant' },
    ), testTokens());
    fixture.detectChanges();
    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse(MOCK_PUBLISHED_EVENTS));
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/events/me/registration-statuses`).flush({});
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;
    saveButton.click();
    fixture.detectChanges();
    httpMock.expectOne((req) => req.method === 'PUT').flush({ eventId: 'evt-1', saved: true });
    fixture.detectChanges();
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');

    // A refresh must NOT tear the grid down: the skeleton replacing it would destroy this very
    // button, which is exactly how the heart used to lose its state mid-session.
    component.onSearchTerm('research');
    fixture.detectChanges();
    expect(component.showSkeleton()).toBe(false);
    expect(fixture.nativeElement.contains(saveButton)).toBe(true);

    httpMock.expectOne((req) => req.url === SEARCH_URL).flush(searchResponse(MOCK_PUBLISHED_EVENTS));
    httpMock.expectOne((req) => req.url === `${environment.apiBaseUrl}/events/me/registration-statuses`).flush({});
    fixture.detectChanges();

    // Same element, still blue, without a re-fetch of the saved list.
    expect(fixture.nativeElement.contains(saveButton)).toBe(true);
    expect(saveButton.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.classList.contains('save-event--saved')).toBe(true);
  });
});
