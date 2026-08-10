import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { PublishedEvent } from '../../../../core/events/published-event.models';
import { ExploreEventsComponent } from './explore-events';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserRole } from '../../../../core/auth/auth.models';

const MOCK_PUBLISHED_EVENTS: readonly PublishedEvent[] = Array.from({ length: 8 }, (_, index) => ({
  id: `evt-${index + 1}`,
  eventTitle: `Mock Event ${index + 1}`,
  shortIntroduction: 'Mock introduction.',
  goals: 'Mock goals.',
  expectedBenefits: 'Mock benefits.',
  categories: ['Academic & Career'],
  eventVisibility: 'Public',
  eventFormat: 'On Campus',
  eventImage: { url: '/assets/events/mock.jpg', fileName: 'mock.jpg', mimeType: 'image/jpeg', sizeBytes: 0, status: 'uploaded' },
  schoolDepartment: 'Student Affairs',
  audience: ['APU Community'],
  schedule: [{ date: '2026-12-01', start: '10:00', end: '12:00', location: 'APU Atrium' }],
  totalExpectedPax: 100,
  registrationMode: 'Automatic',
  confirmedRegistrationCount: 10,
  pendingRegistrationCount: 0,
  isFree: true,
}));

describe('ExploreEventsComponent', () => {
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
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(environment.eventsApiUrl).flush(MOCK_PUBLISHED_EVENTS);
    httpMock.expectOne(environment.configApiUrl).flush({
      paxReviewerThreshold: 50,
      cancellationDaysLimit: 3,
      eventCategories: [],
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    fixture.destroy();
    TestBed.resetTestingModule();
    document.body.classList.remove('filters-open');
  });

  it('renders the discovery controls and the first six detailed event cards', () => {
    const element = fixture.nativeElement as HTMLElement;
    const cards = element.querySelectorAll('.explore-card');
    const detailLabels = [...element.querySelectorAll('.explore-card__details dt')].map((label) =>
      label.textContent?.trim(),
    );

    expect(element.querySelector('#explore-events-title')?.textContent).toContain(
      'Discover Your Campus',
    );
    expect(element.querySelector('input[type="search"]')).not.toBeNull();
    expect(element.querySelector('app-filter-button button')).not.toBeNull();
    expect(cards).toHaveLength(6);
    expect(element.querySelectorAll('.explore-card__action')).toHaveLength(6);
    expect(detailLabels).toContain('Date');
    expect(detailLabels).toContain('Time');
    expect(detailLabels).toContain('Venue');
  });

  it('toggles clear saved and unsaved states', () => {
    TestBed.inject(AuthService).establishSession({
      email: 'applicant@demo.apu.edu.my',
      displayName: 'Demo Applicant',
      username: 'applicant',
      role: UserRole.Applicant,
      accountType: 'internal',
      roleLabel: 'Applicant',
      department: 'School of Computing',
    });
    const saveButton = fixture.nativeElement.querySelector('.save-event') as HTMLButtonElement;

    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
    saveButton.click();
    fixture.detectChanges();

    httpMock.expectOne((req) => req.method === 'POST' && req.url === `${environment.eventEngagementApiUrl}/saved`)
      .flush({ eventId: 'evt-1', saved: true });
    fixture.detectChanges();

    expect(saveButton.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.classList.contains('save-event--saved')).toBe(true);

    saveButton.click();
    fixture.detectChanges();

    httpMock.expectOne((req) => req.method === 'DELETE' && req.url.startsWith(`${environment.eventEngagementApiUrl}/saved/`))
      .flush({ eventId: 'evt-1', saved: false });
    fixture.detectChanges();

    expect(saveButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('searches events and presents an empty state when nothing matches', () => {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'an event that does not exist';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.matchingEvents()).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.explore-empty')).not.toBeNull();

    input.value = 'career';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.matchingEvents().length).toBeGreaterThan(0);
  });

  it('supports multi-select filters, a live result count, and removable applied chips', () => {
    component.openFilters();
    component.toggleDraftFilter('category', 'Sports & Wellness');
    component.toggleDraftFilter('cost', 'Paid');
    fixture.detectChanges();

    expect(component.filterOpen()).toBe(true);
    expect(document.body.classList.contains('filters-open')).toBe(true);
    expect(component.draftResultCount()).toBe(1);

    component.applyFilters();
    fixture.detectChanges();

    expect(component.filterOpen()).toBe(false);
    expect(component.matchingEvents()).toHaveLength(1);
    expect(component.appliedFilterChips()).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.applied-filter')).toHaveLength(2);

    component.removeAppliedFilter('cost', 'Paid');
    expect(component.appliedFilterChips()).toHaveLength(1);
  });

  it('paginates the event cards across pages', () => {
    expect(component.pagedEvents()).toHaveLength(6);
    expect(component.totalPages()).toBe(2);

    component.goToPage(2);
    fixture.detectChanges();

    expect(component.currentPage()).toBe(2);
    expect(component.pagedEvents()).toHaveLength(2);
  });

  it('loads school and department filters from the available event data', () => {
    const schoolGroup = component.filterGroups().find((group) => group.key === 'school');

    expect(schoolGroup?.options).toEqual(component.schoolOptions());
    expect(schoolGroup?.options).toContain('School of Technology');
    expect(schoolGroup?.options).toContain('Student Affairs');
  });
});
