import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { UserRole } from '../../../core/auth/auth.models';
import { roleCanUseSavedEvents } from '../../../core/auth/role-navigation';
import { CtaLinkComponent } from '../cta-link/cta-link';

@Component({
  selector: 'app-site-header',
  imports: [CtaLinkComponent],
  templateUrl: './site-header.html',
  styleUrl: './site-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeaderComponent implements AfterViewInit {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private expandedHeaderBottom?: number;

  @ViewChild('siteHeader', { static: true }) private siteHeader!: ElementRef<HTMLElement>;
  @ViewChild('menuToggle') private menuToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('firstNavLink') private firstNavLink?: ElementRef<HTMLAnchorElement>;

  readonly navItems = [
    { label: 'Home', href: '#home' },
    { label: 'Life at APU', href: '#campus-life' },
    { label: 'Happening Soon', href: '#happening-soon' },
    { label: 'Explore Events', href: '#explore-events' },
    { label: 'Event Calendar', href: '#event-calendar' },
  ] as const;

  readonly isScrolled = signal(false);
  readonly forceCompact = input(false);
  readonly menuOpen = signal(false);
  readonly activeSection = signal('#home');
  readonly isExternalUser = this.auth.isExternalUser;
  readonly showLoginButton = computed(() => !this.auth.authenticated());

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('menu-open');
    });
  }

  ngAfterViewInit(): void {
    this.onWindowScroll();

    const hash = this.document.defaultView?.location.hash;
    if (hash && this.isSectionHash(hash)) {
      requestAnimationFrame(() => this.scrollToSection(hash, 'auto', false));
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const hero = this.document.getElementById('home');
    const headerBottom = this.siteHeader.nativeElement.getBoundingClientRect().bottom;

    if (!this.isScrolled() && headerBottom > 0) {
      this.expandedHeaderBottom = headerBottom;
    }

    const triggerLine = this.expandedHeaderBottom ?? headerBottom;
    const hasPassedHero = hero
      ? hero.getBoundingClientRect().bottom <= triggerLine
      : (this.document.defaultView?.scrollY ?? 0) > 24;

    this.isScrolled.set(hasPassedHero);
    this.updateActiveSection(hasPassedHero);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isScrolled()) {
      this.expandedHeaderBottom = undefined;
    }
    this.onWindowScroll();
  }

  @HostListener('window:hashchange')
  onHashChange(): void {
    const hash = this.document.defaultView?.location.hash;
    if (hash && this.isSectionHash(hash)) {
      requestAnimationFrame(() => this.scrollToSection(hash, 'auto', false));
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) {
      this.closeMenu(true);
    }
  }

  toggleMenu(): void {
    const willOpen = !this.menuOpen();
    this.menuOpen.set(willOpen);
    this.document.body.classList.toggle('menu-open', willOpen);

    if (willOpen) {
      queueMicrotask(() => this.firstNavLink?.nativeElement.focus());
    }
  }

  closeMenu(restoreFocus = false): void {
    this.menuOpen.set(false);
    this.document.body.classList.remove('menu-open');

    if (restoreFocus) {
      queueMicrotask(() => this.menuToggle?.nativeElement.focus());
    }
  }

  navigateToSection(event: Event, href: string): void {
    event.preventDefault();
    this.closeMenu();
    if (!this.document.getElementById(href.slice(1))) {
      void this.router.navigate(['/'], { fragment: href.slice(1) });
      return;
    }
    this.scrollToSection(href, 'smooth', true);
  }

  savedEventsHref(): string {
    const user = this.auth.user();
    if (!user) return '/my-events/saved';
    return user.role === UserRole.ExternalUser ? '/my-events/saved' : '/app/events/my-events/saved';
  }

  openSavedEvents(event: Event): void {
    const user = this.auth.user();
    if (!user) {
      event.preventDefault();
      this.closeMenu();
      void this.router.navigate(['/login'], { queryParams: { returnUrl: '/my-events/saved' } });
      return;
    }
    if (!roleCanUseSavedEvents(user.role)) event.preventDefault();
    this.closeMenu();
  }

  openLogin(event: Event, returnUrl: string | null = null): void {
    event.preventDefault();
    this.closeMenu();
    void this.router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : undefined });
  }

  logout(): void {
    this.closeMenu();
    this.auth.logout();
  }

  private scrollToSection(href: string, behavior: ScrollBehavior, updateHistory: boolean): void {
    const view = this.document.defaultView;
    const section = this.document.getElementById(href.slice(1));

    if (!view || !section) {
      return;
    }

    const top =
      href === '#home'
        ? 0
        : section.getBoundingClientRect().top + view.scrollY - this.compactHeaderHeight();
    const prefersReducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    view.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion ? 'auto' : behavior,
    });

    if (updateHistory && view.location.hash !== href) {
      view.history.pushState(null, '', href);
    }

    this.activeSection.set(href);
  }

  private updateActiveSection(hasPassedHero: boolean): void {
    const headerLine = hasPassedHero
      ? this.compactHeaderHeight()
      : this.siteHeader.nativeElement.getBoundingClientRect().bottom;
    let activeHref: (typeof this.navItems)[number]['href'] = this.navItems[0].href;

    for (const item of this.navItems) {
      const section = this.document.getElementById(item.href.slice(1));
      if (!section) {
        continue;
      }

      if (section.getBoundingClientRect().top <= headerLine + 1) {
        activeHref = item.href;
      } else {
        break;
      }
    }

    this.activeSection.set(activeHref);
  }

  private compactHeaderHeight(): number {
    const view = this.document.defaultView;
    if (!view) {
      return 88;
    }

    const rootStyles = view.getComputedStyle(this.document.documentElement);
    const value = rootStyles.getPropertyValue('--site-header-compact-height').trim();
    const size = Number.parseFloat(value);

    if (!Number.isFinite(size)) {
      return 88;
    }

    if (value.endsWith('rem')) {
      return size * Number.parseFloat(rootStyles.fontSize || '16');
    }

    return size;
  }

  private isSectionHash(hash: string): boolean {
    return this.navItems.some((item) => item.href === hash);
  }
}
