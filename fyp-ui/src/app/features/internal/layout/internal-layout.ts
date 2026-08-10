import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthNavigationSection } from '../../../core/auth/auth.models';
import { UserRole } from '../../../core/auth/auth.models';
import { ROLE_NAVIGATION } from '../../../core/auth/role-navigation';

@Component({
  selector: 'app-internal-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './internal-layout.html',
  styleUrl: './internal-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalLayoutComponent {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly expandedSectionKey = 'apu-internal-expanded-section';
  private readonly pinnedKey = 'apu-internal-sidebar-pinned';
  private readonly activeRouteKey = 'apu-internal-active-route';

  readonly pinned = signal(false);
  readonly hovered = signal(false);
  readonly manuallyExpanded = signal(false);
  readonly isCompactScreen = signal(false);
  readonly openGroup = signal<string | null>(null);
  readonly activeRoute = signal('');
  readonly isScrolled = signal(false);
  readonly expanded = computed(() =>
    this.isCompactScreen()
      ? this.manuallyExpanded()
      : this.pinned() || this.hovered() || this.manuallyExpanded(),
  );
  // On compact screens the drawer's open state is the same underlying flag as the
  // desktop sidebar's manual-expand state — this alias just gives the mobile template
  // its own clearly-named signal rather than reusing "manuallyExpanded" everywhere.
  readonly mobileNavOpen = computed(() => this.manuallyExpanded());
  readonly currentUserName = computed(() => this.auth.user()?.displayName ?? '');

  readonly navigation = computed(() => this.auth.navigation() ?? ROLE_NAVIGATION[UserRole.Applicant]);
  readonly primaryItems = computed(() => this.navigation().primary);
  readonly sections = computed(() => this.navigation().sections);
  readonly defaultRoute = computed(() => this.navigation().defaultRoute);
  readonly selectedChildPage = computed(() => {
    const currentRoute = this.activeRoute();
    return this.sections()
      .flatMap((section) => section.items)
      .find((item) => currentRoute.startsWith(item.route));
  });
  readonly breadcrumbItems = computed(() => {
    const currentRoute = this.activeRoute();
    const section = this.sections().find((entry) =>
      entry.items.some((item) => currentRoute.startsWith(item.route)),
    );

    if (section) {
      const child = section.items.find((item) => currentRoute.startsWith(item.route));
      return child ? [section.label, child.label] : [section.label];
    }

    const primaryItem = this.primaryItems().find((item) => currentRoute.startsWith(item.route));
    if (primaryItem) {
      return [primaryItem.label];
    }

    if (currentRoute.startsWith('/app/profile')) {
      return ['Profile'];
    }

    if (currentRoute.startsWith('/app/logout')) {
      return ['Logout'];
    }

    return ['How It Works'];
  });

  constructor() {
    this.updateCompactScreen();
    this.restoreNavigationState();
    this.syncRouteState(this.router.url);

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.syncRouteState(event.urlAfterRedirects);
        this.closeMobileDrawer();
      });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateCompactScreen();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.isScrolled.set((this.document.defaultView?.scrollY ?? 0) > 0);
  }

  onSidebarEnter(): void {
    if (!this.pinned() && !this.isCompactScreen()) {
      this.hovered.set(true);
    }
  }

  onSidebarLeave(): void {
    if (!this.pinned() && !this.isCompactScreen()) {
      this.hovered.set(false);
    }
  }

  togglePinned(): void {
    const willPin = !this.pinned();
    this.pinned.set(willPin);
    this.writeStorage(this.pinnedKey, `${willPin}`);

    if (!willPin) {
      this.hovered.set(false);
      this.manuallyExpanded.set(false);
    }
  }

  toggleGroup(group: string): void {
    const wasCollapsed = !this.expanded();
    if (wasCollapsed) {
      this.manuallyExpanded.set(true);
    }

    if (wasCollapsed && this.openGroup() === group) {
      return;
    }

    const nextGroup = this.openGroup() === group ? null : group;
    this.openGroup.set(nextGroup);
    this.persistExpandedSection(nextGroup);
  }

  onBrandClick(event: Event): void {
    if (!this.expanded()) {
      event.preventDefault();
      this.manuallyExpanded.set(true);
    }
  }

  onNavigate(): void {
    this.closeMobileDrawer();
  }

  toggleMobileNav(): void {
    this.manuallyExpanded.update((value) => !value);
  }

  closeMobileDrawer(): void {
    if (this.isCompactScreen()) {
      this.manuallyExpanded.set(false);
      this.hovered.set(false);
    }
  }

  isGroupOpen(group: string): boolean {
    return this.openGroup() === group;
  }

  isGroupActive(section: AuthNavigationSection): boolean {
    const currentRoute = this.activeRoute();
    return section.items.some((item) => currentRoute.startsWith(item.route));
  }

  private restoreNavigationState(): void {
    const storedSection = this.readStorage(this.expandedSectionKey);
    if (storedSection && this.sections().some((section) => section.key === storedSection)) {
      this.openGroup.set(storedSection);
    }

    this.pinned.set(this.readStorage(this.pinnedKey) === 'true');
  }

  private syncRouteState(url: string): void {
    const cleanUrl = url.split(/[?#]/, 1)[0] ?? url;
    this.activeRoute.set(cleanUrl);
    this.writeStorage(this.activeRouteKey, cleanUrl);

    const routeGroup = this.groupForRoute(cleanUrl);
    if (routeGroup) {
      this.openGroup.set(routeGroup);
      this.persistExpandedSection(routeGroup);
    }
  }

  private groupForRoute(route: string): string | null {
    return this.sections().find((section) => section.items.some((item) => route.startsWith(item.route)))?.key ?? null;
  }

  private persistExpandedSection(group: string | null): void {
    if (group) {
      this.writeStorage(this.expandedSectionKey, group);
    } else {
      this.removeStorage(this.expandedSectionKey);
    }
  }

  private updateCompactScreen(): void {
    const view = this.document.defaultView;
    this.isCompactScreen.set(view?.matchMedia?.('(max-width: 48rem)').matches ?? false);
  }

  private readStorage(key: string): string | null {
    try {
      return this.document.defaultView?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      this.document.defaultView?.localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }
  }

  private removeStorage(key: string): void {
    try {
      this.document.defaultView?.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }
  }
}
