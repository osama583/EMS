import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SiteHeaderComponent } from './site-header';

describe('SiteHeaderComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeaderComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body
      .querySelectorAll('[data-header-test-section]')
      .forEach((element) => element.remove());
    document.body.classList.remove('menu-open');
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('opens and closes the mobile navigation', () => {
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.menu-toggle') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.classList.contains('menu-open')).toBe(true);

    fixture.componentInstance.onEscape();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.classList.contains('menu-open')).toBe(false);
  });

  it('routes Request an Event through login while preserving How It Works', () => {
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();

    const requestLink = fixture.nativeElement.querySelector('app-cta-link .cta-link') as HTMLAnchorElement;

    expect(requestLink.getAttribute('href')).toContain('/login');
    expect(requestLink.getAttribute('href')).toContain('returnUrl');
  });

  it('marks only the section currently aligned below the header as active', () => {
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    fixture.componentInstance.activeSection.set('#explore-events');
    fixture.detectChanges();

    const links = [...fixture.nativeElement.querySelectorAll('.nav-link')] as HTMLAnchorElement[];

    expect(links[3].getAttribute('aria-current')).toBe('location');
    expect(links[3].classList.contains('nav-link--active')).toBe(true);
    expect(
      links.filter((_, index) => index !== 3).every((link) => !link.hasAttribute('aria-current')),
    ).toBe(true);
  });

  it('scrolls a navigation target to the exact compact-header offset', () => {
    const target = document.createElement('section');
    target.id = 'explore-events';
    target.dataset['headerTestSection'] = '';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(400);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const event = new Event('click', { cancelable: true });

    fixture.componentInstance.navigateToSection(event, '#explore-events');

    expect(event.defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 612, behavior: 'smooth' });
    expect(fixture.componentInstance.activeSection()).toBe('#explore-events');
  });

  it('updates the highlighted item from the section under the header while scrolling', () => {
    const positions = [-1200, -850, -120, 140, 900];
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    const component = fixture.componentInstance;

    component.navItems.forEach((item, index) => {
      const section = document.createElement('section');
      section.id = item.href.slice(1);
      section.dataset['headerTestSection'] = '';
      document.body.appendChild(section);
      vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
        top: positions[index],
        bottom: index === 0 ? -300 : positions[index] + 500,
      } as DOMRect);
    });

    fixture.detectChanges();
    component.onWindowScroll();

    expect(component.activeSection()).toBe('#happening-soon');
  });

  it('switches theme exactly when the header bottom reaches the hero end', () => {
    const hero = document.createElement('section');
    hero.id = 'home';
    hero.dataset['headerTestSection'] = '';
    document.body.appendChild(hero);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const header = fixture.nativeElement.querySelector('.site-header') as HTMLElement;
    const rect = { bottom: 120 } as DOMRect;

    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
      bottom: 88,
    } as DOMRect);
    vi.spyOn(hero, 'getBoundingClientRect').mockReturnValue(rect);
    component.onWindowScroll();
    expect(component.isScrolled()).toBe(false);

    vi.mocked(hero.getBoundingClientRect).mockReturnValue({
      bottom: 88,
    } as DOMRect);
    component.onWindowScroll();
    expect(component.isScrolled()).toBe(true);

    vi.mocked(hero.getBoundingClientRect).mockReturnValue({
      bottom: 89,
    } as DOMRect);
    component.onWindowScroll();
    expect(component.isScrolled()).toBe(false);
  });
});
