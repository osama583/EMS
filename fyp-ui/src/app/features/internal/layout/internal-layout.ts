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
import { FALLBACK_NAVIGATION } from '../../../core/auth/role-navigation';
import { isSystemAdmin } from '../../../core/auth/role-access';
import { NavIconComponent } from '../../../shared/components/nav-icon/nav-icon';
import { EventReminderSweepService } from '../../../core/admin-directory/event-reminder-sweep.service';
import { PurgeSweepService } from '../../../core/admin-directory/purge-sweep.service';
import { ToastService, apiErrorMessage } from '../../../shared/components/toast/toast.service';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-internal-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, NavIconComponent],
  templateUrl: './internal-layout.html',
  styleUrl: './internal-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InternalLayoutComponent {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly purgeSweep = inject(PurgeSweepService);
  private readonly reminderSweep = inject(EventReminderSweepService);
  private readonly toast = inject(ToastService);
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
  // The 7-day retention sweep (see PurgeSweepService) has no server to schedule it on yet, so a
  // System Admin triggers it here on demand instead of it running automatically. Restricted to
  // system-admin the same way every purge/purge-adjacent backend endpoint already is.
  readonly canRunPurgeSweep = computed(() => {
    const user = this.auth.user();
    return !!user && isSystemAdmin(user);
  });
  readonly purgingDeleted = signal(false);
  // Same story as the purge sweep above: the event reminders are meant to run
  // from cron once a day (backend/scripts/send_event_reminders.py), but there is
  // no always-on host to install that crontab on, so a System Admin can run the
  // identical sweep on demand. Gated to system-admin exactly as the endpoint is.
  readonly canSendReminders = this.canRunPurgeSweep;
  readonly sendingReminders = signal(false);

  // No more UserRole to default to for a not-yet-resolved/unauthenticated session — the shared
  // FALLBACK_NAVIGATION stands in until the real one loads (same constant navigationFor() itself
  // falls back to in role-navigation.ts for an unresolvable AuthUser).
  readonly navigation = computed(() => this.auth.navigation() ?? FALLBACK_NAVIGATION);
  // Single ordered list — folders and standalone pages interleaved in their real sort order (oldest
  // first, newest last) — rendered by the templates as one sidebar list instead of two separate
  // item/section blocks (which used to always show every standalone page above every folder,
  // regardless of when each was added).
  readonly navEntries = computed(() => this.navigation().entries);
  readonly sections = computed(() => this.navEntries().flatMap((entry) => (entry.kind === 'section' ? [entry.section] : [])));
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

    const primaryItem = this.navEntries()
      .flatMap((entry) => (entry.kind === 'item' ? [entry.item] : []))
      .find((item) => currentRoute.startsWith(item.route));
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

  runPurgeSweep(): void {
    if (this.purgingDeleted()) return;
    if (!this.document.defaultView?.confirm(
      'Permanently remove everything that has sat in a Deleted bin for more than 7 days? '
        + 'Anything still referenced elsewhere is skipped and left in the bin. This cannot be undone.',
    )) {
      return;
    }
    this.purgingDeleted.set(true);
    this.purgeSweep.run().pipe(
      finalize(() => this.purgingDeleted.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        this.toast.success(
          'Purge sweep complete',
          result.totalPurged
            ? `${result.totalPurged} record(s) permanently removed${result.totalBlocked ? `, ${result.totalBlocked} left in the bin (still referenced elsewhere)` : ''}.`
            : 'Nothing was due for permanent removal.',
        );
      },
      error: (err) => this.toast.error('The purge sweep could not run', apiErrorMessage(err, 'Please try again.')),
    });
  }

  // Preview first, then confirm, then send. Reminder emails go to real people and
  // cannot be recalled, so the admin is shown the actual count (and the
  // thresholds it was computed with) before anything leaves the building - the
  // same thing `--dry-run` prints on the command line.
  sendEventReminders(): void {
    if (this.sendingReminders()) return;
    this.sendingReminders.set(true);

    this.reminderSweep.preview().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (preview) => {
        if (preview.total === 0) {
          this.sendingReminders.set(false);
          this.toast.info('No reminders are due', 'Nothing has crossed a threshold or come into range yet.');
          return;
        }

        const { savedCapacity, savedStarting, registeredStarting } = preview.byKind;
        const breakdown = [
          savedCapacity ? `${savedCapacity} "saved event filling up"` : '',
          savedStarting ? `${savedStarting} "saved event starting soon"` : '',
          registeredStarting ? `${registeredStarting} "registered event starting soon"` : '',
        ].filter(Boolean).join(', ');

        const confirmed = this.document.defaultView?.confirm(
          `Send ${preview.total} reminder email(s) now?

${breakdown}.

`
            + `Thresholds: ${preview.capacityPercent}% full, ${preview.leadDays} day(s) ahead.

`
            + 'Anyone already emailed about the same event is skipped automatically. This cannot be undone.',
        );
        if (!confirmed) {
          this.sendingReminders.set(false);
          return;
        }

        this.reminderSweep.run().pipe(
          finalize(() => this.sendingReminders.set(false)),
          takeUntilDestroyed(this.destroyRef),
        ).subscribe({
          next: (result) => this.toast.success(
            'Reminders sent',
            `${result.total} email(s) sent. Anyone already reminded about the same event was skipped.`,
          ),
          error: (err) => this.toast.error('The reminders could not be sent', apiErrorMessage(err, 'Please try again.')),
        });
      },
      error: (err) => {
        this.sendingReminders.set(false);
        this.toast.error('Could not check which reminders are due', apiErrorMessage(err, 'Please try again.'));
      },
    });
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
