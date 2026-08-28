import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { EventSearchParams, EventVisibility, PublishedEvent, RegistrationResult, RegistrationStatus } from '../../../../core/events/published-event.models';
import { EventCatalogRepositoryImpl } from '../../../../core/event-catalog/event-catalog.repository';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { EventFavouriteService } from '../../../../core/events/event-favourite.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { isSchoolStudentOrLecturer } from '../../../../core/auth/role-access';
import { GuestRegistrationFlowService } from '../../../../core/auth/external-registration.service';
import { EventCardComponent } from '../../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../../shared/components/event-details-modal/event-details-modal';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalPaginationComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { ExpandableSearchComponent } from '../../../../shared/components/expandable-search/expandable-search';
import { FilterButtonComponent } from '../../../../shared/components/filter-button/filter-button';
import { LoadingStateComponent } from '../../../../shared/components/loading-state/loading-state';
import { ToastService } from '../../../../shared/components/toast/toast.service';

type FilterKey =
  | 'visibility'
  | 'category'
  | 'school'
  | 'format'
  | 'date'
  | 'time'
  | 'registration'
  | 'cost';

type FilterSelection = Record<FilterKey, readonly string[]>;

interface FilterGroup {
  readonly key: FilterKey;
  readonly label: string;
  readonly options: readonly string[];
  readonly wide?: boolean;
}

interface AppliedFilterChip {
  readonly group: FilterKey;
  readonly value: string;
}

const PUBLIC_PAGE_SIZE = 6;
const INTERNAL_PAGE_SIZE = 9;

@Component({
  selector: 'app-explore-events',
  imports: [FormModalComponent,
    EventDetailsModalComponent,
    EventCardComponent,
    InternalPaginationComponent,
    ExpandableSearchComponent,
    FilterButtonComponent,
    LoadingStateComponent,
  ],
  templateUrl: './explore-events.html',
  styleUrl: './explore-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreEventsComponent {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly eventCatalogRepository = inject(EventCatalogRepositoryImpl);
  private readonly guestFlow = inject(GuestRegistrationFlowService);
  private readonly publishedEventService = inject(PublishedEventService);
  private readonly toast = inject(ToastService);
  readonly favourites = inject(EventFavouriteService);
  readonly variant = input<'public' | 'internal'>('public');
  readonly registeringEventId = signal<string | null>(null);

  readonly loading = signal(true);
  // Only the FIRST load may replace the grid with a skeleton. Later loads (a filter, a search, a
  // page change) keep the existing cards mounted and swap their data in place — tearing the grid
  // down mid-session destroys every card's DOM, which is what made the heart appear to "reset".
  readonly hasLoadedOnce = signal(false);
  readonly showSkeleton = computed(() => this.loading() && !this.hasLoadedOnce());
  readonly loadError = signal('');

  readonly searchTerm = signal('');
  readonly selectedPublishedEvent = signal<PublishedEvent | null>(null);
  readonly filterOpen = signal(false);
  readonly appliedFilters = signal<FilterSelection>(this.emptyFilters());
  readonly draftFilters = signal<FilterSelection>(this.emptyFilters());
  readonly appliedCustomFrom = signal('');
  readonly appliedCustomTo = signal('');
  readonly draftCustomFrom = signal('');
  readonly draftCustomTo = signal('');
  readonly currentPage = signal(1);
  // Writable — the internal variant's pagination control lets the user pick 9/18/27 (see
  // changePageSize). Its per-variant DEFAULT is seeded reactively in the constructor (an effect
  // keyed off variant(), not a one-time check) so it's still correct even if the variant input
  // arrives after construction — e.g. TestBed's setInput(), or any binding path that resolves
  // later than a static template attribute would. The public variant never exposes a page-size
  // control, so this only ever changes there via that reactive default.
  readonly pageSize = signal(INTERNAL_PAGE_SIZE);

  // The single source of truth for what's on screen, for BOTH variants — always the current
  // page of GET /events/search results. There is no separate client-side filtering path: the
  // public landing page is just this same server search, permanently scoped to Public-visibility
  // events (see buildSearchParams), with no filter UI offered. One filter implementation, one
  // place it can drift from the backend's (the backend's _list_events_filters already mirrors it).
  private readonly pageEvents = signal<readonly PublishedEvent[]>([]);
  readonly resultCount = signal(0);
  readonly pagedPublishedEvents = computed(() => this.pageEvents());
  private readonly publishedEventsById = computed(() => new Map(this.pagedPublishedEvents().map((event) => [event.id, event])));
  private readonly registrationStatusByEventId = signal<ReadonlyMap<string, RegistrationStatus | null>>(new Map());

  // School options span every published event the caller can see, not just the current page —
  // fetched once, independently of the paged search, the same way category/format catalogs are.
  private readonly allSchools = signal<readonly string[]>([]);

  // Category/format filter options — fetched active-only directly from the catalog (not via
  // EventCategoryService/EventFormatService's shared entries(), which intentionally includes
  // inactive rows for admin management and event-proposal's archived-format lookups).
  private readonly activeCategoryNames = signal<readonly string[]>([]);
  private readonly activeFormatNames = signal<readonly string[]>([]);

  // Debounced live "Show N Results" preview while the filter dialog is open (internal variant only
  // — the public variant offers no filter dialog at all, see draftResultCount below).
  private readonly draftPreviewCount = signal<number | null>(null);
  private readonly draftPreviewRequests = new Subject<void>();

  registrationCount(id: string): number { return this.publishedEventsById().get(id)?.confirmedRegistrationCount ?? 0; }
  publishedEvent(id: string): PublishedEvent | undefined { return this.publishedEventsById().get(id); }
  openEvent(id: string): void { this.selectedPublishedEvent.set(this.publishedEventsById().get(id) ?? null); }
  closeEvent(): void { this.selectedPublishedEvent.set(null); }

  // Handles registration completed via the details modal's own form (paid events, or explicit
  // email confirmation) — mirrors registerForEvent()'s quick-register toast/refresh/close
  // behavior below so both entry points give the same confirmation UX.
  onModalRegistered(result: RegistrationResult): void {
    const eventTitle = this.selectedPublishedEvent()?.eventTitle ?? 'the event';
    this.closeEvent();
    this.load();
    if (result.status === 'rejected' || result.status === 'duplicate') {
      this.toast.error('Registration not completed', result.message);
    } else {
      this.toast.success(`You're registered for ${eventTitle}`, result.status === 'pending' ? 'Your registration is pending approval.' : undefined);
    }
  }

  // Events can carry a null/blank schoolDepartment, and a null in here used to throw
  // (null.localeCompare) from inside a computed — which aborts Angular's whole change-detection
  // pass, freezing every other binding on the page (the save-event heart included).
  readonly schoolOptions = computed(() =>
    [...this.allSchools()].filter((name): name is string => !!name).sort((a, b) => a.localeCompare(b)),
  );

  // Only Students and Lecturers can ever be part of a club (as a member or as President — see
  // AuthUser.presidentOfClubIds, a data fact, not a role) — every other internal role has no
  // path to club participation, so offering the "Club Only" filter to them would be misleading
  // UI, not just a functional gap. RBAC redesign: 'student'/'lecturer' are now literal role_codes
  // (same eligibility rule as club-identity.service.js's isEligibleForClub() server-side).
  private readonly canSeeClubOnlyFilter = computed(() => {
    const user = this.auth.user();
    if (!user) return false;
    return isSchoolStudentOrLecturer(user);
  });

  // Filter groups only exist for the internal variant — the public landing page has no filter UI
  // at all, just search (see explore-events.html).
  readonly filterGroups = computed<readonly FilterGroup[]>(() => [
    {
      key: 'visibility' as const,
      label: 'Event Visibility',
      options: this.canSeeClubOnlyFilter()
        ? ['Public', 'Internal', 'Club Only']
        : ['Public', 'Internal'],
    },
    {
      key: 'category',
      label: 'Category',
      options: this.activeCategoryNames(),
      wide: true,
    },
    {
      key: 'school',
      label: 'School or Department',
      options: this.schoolOptions(),
      wide: true,
    },
    {
      key: 'format',
      label: 'Event Format',
      options: this.activeFormatNames(),
    },
    {
      key: 'date',
      label: 'Date',
      options: ['Today', 'Tomorrow', 'This Week', 'This Weekend', 'This Month', 'Custom Date Range'],
      wide: true,
    },
    {
      key: 'time',
      label: 'Time',
      options: ['Morning', 'Afternoon', 'Evening'],
    },
    {
      key: 'registration',
      label: 'Registration',
      options: ['No Registration Required', 'Registration Required'],
    },
    {
      key: 'cost',
      label: 'Cost',
      options: ['Free', 'Paid'],
    },
  ]);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resultCount() / this.pageSize())));
  // draftResultCount shows the live, debounced preview while the filter dialog is open (internal
  // variant only); before the first preview response lands it falls back to the applied count so
  // the button never shows a jarring 0.
  readonly draftResultCount = computed(() => this.draftPreviewCount() ?? this.resultCount());
  readonly appliedFilterChips = computed<readonly AppliedFilterChip[]>(() =>
    (Object.entries(this.appliedFilters()) as [FilterKey, readonly string[]][]).flatMap(
      ([group, values]) => values.map((value) => ({ group, value })),
    ),
  );
  readonly appliedFilterCount = computed(() => this.appliedFilterChips().length);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.document.body.classList.remove('filters-open');
    });

    // Deep link from anywhere that links to a specific event by id (currently
    // the AI assistant's event-card sources — see ai-assistant.ts) — a
    // ?event=<id> query param opens that event's details modal directly,
    // fetching it on its own if the current page/filter happened not to
    // include it rather than requiring the caller to already be on the page
    // that lists it.
    const eventId = this.route.snapshot.queryParamMap.get('event');
    if (eventId) {
      this.publishedEventService.getEventDetails(eventId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (event) => { if (event) this.selectedPublishedEvent.set(event); },
        error: () => { /* Event no longer available (unpublished/cancelled) - nothing to open. */ },
      });
    }

    this.draftPreviewRequests
      .pipe(
        debounceTime(300),
        // Only `total` is ever read (see the subscribe below) — countOnly skips building/
        // decorating a page of full event records server-side just to report how many exist.
        switchMap(() => this.publishedEventService.searchEvents({
          ...this.buildSearchParams(this.draftFilters(), this.draftCustomFrom(), this.draftCustomTo(), 1, 1),
          countOnly: true,
        })),
      )
      .subscribe({
        next: (response) => this.draftPreviewCount.set(response.total),
        error: () => this.draftPreviewCount.set(null),
      });

    // variant() is a signal input, so it is not guaranteed to be readable at its final value the
    // moment the constructor runs — a static template attribute (`variant="internal"`) resolves
    // before construction, but other binding paths (TestBed's setInput(), a structural directive)
    // resolve after. A one-time `if (this.variant() === ...)` check in the constructor body would
    // silently lock the component onto whatever variant() happened to read at that instant. This
    // effect instead reacts to variant() itself, seeding the per-variant page size once and
    // firing the internal-only setup (school/catalog option fetches) once, whenever variant()
    // actually resolves — construction-time or not.
    let setupDoneFor: 'public' | 'internal' | null = null;
    effect(() => {
      const current = this.variant();
      if (setupDoneFor === current) return;
      setupDoneFor = current;
      this.pageSize.set(current === 'public' ? PUBLIC_PAGE_SIZE : INTERNAL_PAGE_SIZE);
      if (current === 'internal') {
        this.loadSchoolOptions();
        this.loadCatalogFilterOptions();
      }
    });

    // Re-fetches whenever applied filters, search term, or pagination change — this IS the data
    // load for both variants, not a client-side re-filter of an already-fetched list.
    effect(() => {
      this.appliedFilters();
      this.appliedCustomFrom();
      this.appliedCustomTo();
      this.searchTerm();
      this.currentPage();
      this.pageSize();
      this.load();
    });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set('');
    const params = this.buildSearchParams(this.appliedFilters(), this.appliedCustomFrom(), this.appliedCustomTo(), this.currentPage(), this.pageSize());
    this.publishedEventService.searchEvents(params).subscribe({
      next: (response) => {
        this.pageEvents.set(response.items);
        this.resultCount.set(response.total);
        this.loading.set(false);
        this.hasLoadedOnce.set(true);
        this.loadRegistrationStatuses(response.items);
      },
      error: () => {
        this.pageEvents.set([]);
        this.resultCount.set(0);
        this.loadError.set('Events could not be loaded.');
        this.loading.set(false);
        this.hasLoadedOnce.set(true);
      },
    });
  }

  private loadSchoolOptions(): void {
    this.publishedEventService.getEventSchools().subscribe({
      next: (schools) => this.allSchools.set(schools),
      error: () => this.allSchools.set([]),
    });
  }

  private loadCatalogFilterOptions(): void {
    this.eventCatalogRepository.getEntries('categories', true).subscribe({
      next: (entries) => this.activeCategoryNames.set(entries.map((entry) => entry.name)),
      error: () => this.activeCategoryNames.set([]),
    });
    this.eventCatalogRepository.getEntries('formats', true).subscribe({
      next: (entries) => this.activeFormatNames.set(entries.map((entry) => entry.name)),
      error: () => this.activeFormatNames.set([]),
    });
  }

  private buildSearchParams(filters: FilterSelection, customFrom: string, customTo: string, page: number, pageSize: number): EventSearchParams {
    // The public variant offers no filter UI, no auth-aware exclusion, and only ever wants
    // Public-visibility events — everything else (category/school/format/date/time/
    // registration/cost/visibility) is the internal variant's applied filters, which stay
    // empty here since filterGroups/openFilters are never reachable on the public variant.
    if (this.variant() === 'public') {
      return {
        q: this.searchTerm().trim() || undefined,
        visibility: ['Public'],
        page,
        pageSize,
      };
    }
    return {
      q: this.searchTerm().trim() || undefined,
      visibility: filters.visibility as readonly EventVisibility[],
      category: filters.category,
      school: filters.school,
      format: filters.format,
      time: filters.time as EventSearchParams['time'],
      registration: filters.registration as EventSearchParams['registration'],
      cost: filters.cost as EventSearchParams['cost'],
      date: filters.date,
      dateFrom: filters.date.includes('Custom Date Range') ? customFrom || undefined : undefined,
      dateTo: filters.date.includes('Custom Date Range') ? customTo || undefined : undefined,
      // Once a user has a confirmed or pending registration for an event, it drops out of Explore
      // Events permanently (not just as a one-off post-register removal) — they can still manage
      // it from My Events. Guests are unaffected (never registered for anything).
      excludeRegistered: !!this.auth.user(),
      page,
      pageSize,
    };
  }

  // The listing already excludes registered/pending events server-side (excludeRegistered) — this
  // only powers the card/details-modal status badge for anything else (e.g. a past 'rejected').
  // One batched request for the whole page instead of one getMyRegistration() call per event.
  private loadRegistrationStatuses(events: readonly PublishedEvent[]): void {
    if (!this.auth.user() || events.length === 0) {
      this.registrationStatusByEventId.set(new Map());
      return;
    }
    this.publishedEventService.getRegistrationStatuses(events.map((event) => event.id)).subscribe({
      next: (statuses) => this.registrationStatusByEventId.set(statuses),
      error: () => this.registrationStatusByEventId.set(new Map()),
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.filterOpen()) {
      this.closeFilters();
    }
  }

  onSearchTerm(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  goToPage(page: number): void { this.currentPage.set(page); }
  changePageSize(size: number): void { this.pageSize.set(size); this.currentPage.set(1); }

  openFilters(): void {
    this.draftFilters.set(this.cloneFilters(this.appliedFilters()));
    this.draftCustomFrom.set(this.appliedCustomFrom());
    this.draftCustomTo.set(this.appliedCustomTo());
    this.draftPreviewCount.set(null);
    this.filterOpen.set(true);
    this.document.body.classList.add('filters-open');
  }

  closeFilters(): void {
    this.filterOpen.set(false);
    this.document.body.classList.remove('filters-open');
  }

  toggleDraftFilter(group: FilterKey, value: string): void {
    this.draftFilters.update((filters) => {
      const current = filters[group];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];

      return { ...filters, [group]: next };
    });
    this.draftPreviewRequests.next();
  }

  isDraftSelected(group: FilterKey, value: string): boolean {
    return this.draftFilters()[group].includes(value);
  }

  onCustomDate(event: Event, edge: 'from' | 'to'): void {
    const value = (event.target as HTMLInputElement).value;
    if (edge === 'from') {
      this.draftCustomFrom.set(value);
    } else {
      this.draftCustomTo.set(value);
    }
    this.draftPreviewRequests.next();
  }

  resetDraftFilters(): void {
    this.draftFilters.set(this.emptyFilters());
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
    this.draftPreviewRequests.next();
  }

  applyFilters(): void {
    this.appliedFilters.set(this.cloneFilters(this.draftFilters()));
    this.appliedCustomFrom.set(this.draftCustomFrom());
    this.appliedCustomTo.set(this.draftCustomTo());
    this.currentPage.set(1);
    this.closeFilters();
  }

  removeAppliedFilter(group: FilterKey, value: string): void {
    const remove = (filters: FilterSelection): FilterSelection => ({
      ...filters,
      [group]: filters[group].filter((item) => item !== value),
    });

    this.appliedFilters.update(remove);
    this.draftFilters.update(remove);
    if (group === 'date' && value === 'Custom Date Range') {
      this.appliedCustomFrom.set('');
      this.appliedCustomTo.set('');
      this.draftCustomFrom.set('');
      this.draftCustomTo.set('');
    }
    this.currentPage.set(1);
  }

  clearAppliedFilters(): void {
    this.appliedFilters.set(this.emptyFilters());
    this.draftFilters.set(this.emptyFilters());
    this.appliedCustomFrom.set('');
    this.appliedCustomTo.set('');
    this.draftCustomFrom.set('');
    this.draftCustomTo.set('');
    this.currentPage.set(1);
  }

  toggleSaved(eventId: string): void { this.favourites.toggle(eventId); }

  // A method (not a template-bound signal expression) reading this component's OWN signal is
  // still tracked correctly by zoneless change detection — unlike the old isSaved() wrapper this
  // replaced, which read a signal owned by an INJECTED service and silently missed its updates
  // (see explore-events.html's [saved] binding, now reading favourites.savedEventIds() directly).
  registrationStatus(eventId: string): RegistrationStatus | null {
    return this.registrationStatusByEventId().get(eventId) ?? null;
  }

  registerForEvent(eventId: string): void {
    if (!this.auth.user()) {
      this.guestFlow.requestForEvent(eventId);
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    if (this.registeringEventId()) return;
    const event = this.publishedEventsById().get(eventId);
    // Manual-approval events need a reason for attending, and paid events need proof of payment.
    // Neither can be collected from a one-click card button, so open the details modal (which
    // owns both fields) instead of firing a registration the server would reject.
    if (event && (event.registrationMode === 'Manual' || (event.cost != null && event.cost > 0))) {
      this.openEvent(eventId);
      return;
    }
    this.registeringEventId.set(eventId);
    const eventTitle = event?.eventTitle ?? 'the event';
    this.publishedEventService.registerForEvent(eventId).subscribe({
      next: (result) => {
        this.registeringEventId.set(null);
        // Refreshing registration statuses is what actually drops this event out of the grid (the
        // server's excludeRegistered filter) — the modal close below is separate, since
        // registration can also happen from the quick-register button with no modal open.
        this.load();
        if (this.selectedPublishedEvent()?.id === eventId) this.closeEvent();
        if (result.status === 'rejected' || result.status === 'duplicate') {
          this.toast.error('Registration not completed', result.message);
        } else {
          this.toast.success(`You're registered for ${eventTitle}`, result.status === 'pending' ? 'Your registration is pending approval.' : undefined);
        }
      },
      error: () => {
        this.registeringEventId.set(null);
        this.toast.error('Registration failed', 'Please try again.');
      },
    });
  }

  private emptyFilters(): FilterSelection {
    return {
      visibility: [],
      category: [],
      school: [],
      format: [],
      date: [],
      time: [],
      registration: [],
      cost: [],
    };
  }

  private cloneFilters(filters: FilterSelection): FilterSelection {
    return {
      visibility: [...filters.visibility],
      category: [...filters.category],
      school: [...filters.school],
      format: [...filters.format],
      date: [...filters.date],
      time: [...filters.time],
      registration: [...filters.registration],
      cost: [...filters.cost],
    };
  }

}
