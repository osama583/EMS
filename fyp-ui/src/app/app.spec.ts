import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('creates the landing page', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
  }, 10_000);

  it('renders the APU event hero and primary actions', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const headline = element.querySelector('h1');
    const cta = element.querySelector<HTMLAnchorElement>('.hero-cta-reveal app-cta-link .cta-link');
    const brand = element.querySelector<HTMLAnchorElement>('.brand');
    const logoParts = element.querySelectorAll<HTMLImageElement>('.brand img');
    const support = element.querySelector('.hero-support');
    const happeningSoon = element.querySelector('#happening-soon');
    const exploreEvents = element.querySelector('#explore-events');
    const eventCalendar = element.querySelector('#event-calendar');
    const navigation = [...element.querySelectorAll('.nav-link')].map((link) =>
      link.textContent?.trim(),
    );

    expect(headline?.getAttribute('aria-label')).toBe('There’s always something happening at APU');
    expect(cta?.getAttribute('href')).toBe('#explore-events');
    expect(brand?.getAttribute('aria-label')).toBe('APU Events home');
    expect(logoParts).toHaveLength(2);
    expect(support?.textContent).toContain('Discover upcoming activities');
    expect(happeningSoon?.textContent).toContain('Next 10 days');
    expect(exploreEvents?.querySelector('#explore-events-title')?.textContent).toContain(
      'Discover Your Campus',
    );
    expect(eventCalendar?.querySelector('#event-calendar-title')?.textContent).toContain(
      'Plan Your APU Experience',
    );
    expect(element.querySelectorAll('.section-title')).toHaveLength(4);
    expect(navigation).toEqual([
      'Home',
      'Life at APU',
      'Happening Soon',
      'Explore Events',
      'Event Calendar',
      'Saved Events',
    ]);
    expect(element.querySelector('app-cta-link .cta-link')?.getAttribute('href')).toContain('/login');
  });

  it('keeps the hero video muted and removes playback controls', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    fixture.detectChanges();

    const videos = [...fixture.nativeElement.querySelectorAll('video')] as HTMLVideoElement[];

    expect(videos).toHaveLength(2);
    expect(videos.every((video) => video.muted)).toBe(true);
    expect(fixture.nativeElement.querySelector('.playback-control')).toBeNull();
  });

  it('keeps the internal application separate from the public landing page', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const { AuthService } = await import('./core/auth/auth.service');
    const { testUser, testRole, testNavPage, testTokens } = await import('./core/auth/auth.test-fixtures');
    // The sidebar is rendered straight from the server-supplied nav tree, so the session needs a
    // real nav node for the route under test to be reachable.
    TestBed.inject(AuthService).establishSession(testUser(
      [testRole('student', 'school_of_computing', 'School of Computing')],
      {
        email: 'applicant@demo.apu.edu.my',
        displayName: 'Demo Applicant',
        nav: [testNavPage('how-it-works', 'How It Works')],
      },
    ), testTokens());
    await TestBed.inject(Router).navigateByUrl('/app/how-it-works');
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.internal-sidebar')).not.toBeNull();
    expect(element.querySelector('.how-intro__eyebrow')?.textContent).toContain('How It Works');
    expect(element.querySelector('#internal-page-title')?.textContent).toContain(
      'Create and Submit Your Event Proposal',
    );
    expect(element.querySelector('#home')).toBeNull();
  });
});
