import { PAGE_SIZE_OPTIONS } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, switchMap } from 'rxjs';
import { EventSearchParams, PublishedEvent, RegistrationResult, RegistrationStatus } from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { EventFavouriteService } from '../../../../core/events/event-favourite.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { GuestRegistrationFlowService } from '../../../../core/auth/external-registration.service';
import { EventCardComponent } from '../../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../../shared/components/event-details-modal/event-details-modal';
import { InternalPaginationComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { EventFilterBarComponent } from '../../../../shared/components/event-filter-bar/event-filter-bar';
import { EventFilterDialogComponent } from '../../../../shared/components/event-filter-bar/event-filter-dialog';
import { EventFilterKey, EventFilterQuery, EventFilterState, toEventSearchParams } from '../../../../shared/components/event-filter-bar/event-filter.state';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton';

const PUBLIC_PAGE_SIZE = 6;
const INTERNAL_PAGE_SIZE = 9;

@Component({
  selector: 'app-explore-events',
  imports: [SkeletonComponent,
    EventDetailsModalComponent,
    EventCardComponent,
    InternalPaginationComponent,
    EventFilterBarComponent,
    EventFilterDialogComponent,
  ],
  templateUrl: './explore-events.html',
  styleUrl: './explore-events.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExploreEventsComponent {
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly guestFlow = inject(GuestRegistrationFlowService);
  private readonly publishedEventService = inject(PublishedEventService);
  private readonly toast = inject(ToastService);
  readonly favourites = inject(EventFavouriteService);
  readonly variant = input<'public' | 'internal'>('public');
  readonly registeringEventId = signal<string | null>(null);

  // The search box + filter groups, shared with the landing page, the internal Explore Events
  // page and every My Events tab so no two surfaces can offer different filters — see
  // EventFilterState.
  readonly filters = new EventFilterState();

  readonly loading = signal(true);
  // Only the FIRST load may replace the grid with a skeleton. Later loads (a filter, a search, a
  // page change) keep the existing cards mounted and swap their data in place — tearing the grid
  // down mid-session destroys every card's DOM, which is what made the heart appear to "reset".
  readonly hasLoadedOnce = signal(false);
  readonly showSkeleton = computed(() => this.loading() && !this.hasLoadedOnce());
  readonly loadError = signal('');

  readonly selectedPublishedEvent = signal<PublishedEvent | null>(null);
  readonly currentPage = signal(1);
  // Writable — the internal variant's pagination control lets the user pick 9/18/27 (see
  // changePageSize).
  readonly pageSize = signal(INTERNAL_PAGE_SIZE);

  // The single source of truth for what's on screen, for BOTH variants — always the current page of
  // GET /events/search results.
  private readonly pageEvents = signal<readonly PublishedEvent[]>([]);
  readonly resultCount = signal(0);
  readonly pagedPublishedEvents = computed(() => this.pageEvents());
  private readonly publishedEventsById = computed(() => new Map(this.pagedPublishedEvents().map((event) => [event.id, event])));
  private readonly registrationStatusByEventId = signal<ReadonlyMap<string, RegistrationStatus | null>>(new Map());

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

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.resultCount() / this.pageSize())));
  // draftResultCount shows the live, debounced preview while the filter dialog is open (internal
  // variant only); before the first preview response lands it falls back to the applied count so
  // the button never shows a jarring 0.
  readonly draftResultCount = computed(() => this.filters.draftPreviewCount() ?? this.resultCount());

  // Delegates onto the shared filter state. Kept as members of this component because the
  // template and the Explore Events specs address the filter through the page, not through the
  // bar/dialog components that happen to render it.
  readonly filterGroups = this.filters.groups;
  readonly appliedFilterChips = this.filters.appliedChips;
  readonly appliedFilterCount = this.filters.appliedCount;
  readonly searchTerm = this.filters.searchTerm;
  readonly filterOpen = this.filters.filterOpen;

  constructor() {
    // Deep link from anywhere that links to a specific event by id (currently the AI assistant's
    // event-card sources — see ai-assistant.ts) — a ?event=<id> query param opens that event's details
    // modal directly, fetching it on its own if the current page/filter happened not to include it
    // rather than requiring the caller to already be on the page that lists it.
    const eventId = this.route.snapshot.queryParamMap.get('event');
    if (eventId) {
      this.publishedEventService.getEventDetails(eventId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (event) => { if (event) this.selectedPublishedEvent.set(event); },
        error: () => { /* Event no longer available (unpublished/cancelled) - nothing to open. */ },
      });
    }

    this.filters.draftChanges
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(300),
        // Only `total` is ever read (see the subscribe below) — countOnly skips building/
        // decorating a page of full event records server-side just to report how many exist.
        switchMap(() => this.publishedEventService.searchEvents({
          ...this.buildSearchParams(this.filters.draftQuery(), 1, 1),
          countOnly: true,
        })),
      )
      .subscribe({
        next: (response) => this.filters.draftPreviewCount.set(response.total),
        error: () => this.filters.draftPreviewCount.set(null),
      });

    // variant() is a signal input, so it is not guaranteed to be readable at its final value the
    // moment the constructor runs — a static template attribute (`variant="internal"`) resolves before
    // construction, but other binding paths (TestBed's setInput(), a structural directive) resolve
    // after.
    let setupDoneFor: 'public' | 'internal' | null = null;
    effect(() => {
      const current = this.variant();
      if (setupDoneFor === current) return;
      setupDoneFor = current;
      this.pageSize.set(current === 'public' ? PUBLIC_PAGE_SIZE : INTERNAL_PAGE_SIZE);
      // The landing page is served Public events only whoever is reading it (see
      // buildSearchParams), so a Visibility group there could only offer "Public" and an
      // option that always comes back empty. Every other group applies to both variants.
      this.filters.hiddenGroups.set(current === 'public' ? ['visibility'] : []);
      this.filters.loadOptions();
    });

    // Re-fetches whenever applied filters, search term, or pagination change — this IS the data
    // load for both variants, not a client-side re-filter of an already-fetched list.
    effect(() => {
      this.filters.query();
      this.currentPage();
      this.pageSize();
      this.load();
    });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set('');
    const params = this.buildSearchParams(this.filters.query(), this.currentPage(), this.pageSize());
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

  private buildSearchParams(query: EventFilterQuery, page: number, pageSize: number): EventSearchParams {
    // The public variant runs the same server-side filter query as the internal one — same groups,
    // same params, same GET /events/search (every one of which is public: see events.py's
    // search_events/list_event_schools and catalog.py's list_catalogue). It differs in two things
    // only: visibility is pinned to Public, so a signed-in reader on the landing page still sees
    // the front door rather than their internal listing; and there is no auth-aware exclusion of
    // events they already registered for.
    if (this.variant() === 'public') {
      return { ...toEventSearchParams(query, page, pageSize), visibility: ['Public'] };
    }
    return {
      ...toEventSearchParams(query, page, pageSize),
      // Once a user has a confirmed or pending registration for an event, it drops out of Explore
      // Events permanently (not just as a one-off post-register removal) — they can still manage
      // it from My Events. Guests are unaffected (never registered for anything).
      excludeRegistered: !!this.auth.user(),
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

  onSearchTerm(value: string): void {
    this.filters.setSearchTerm(value);
    this.currentPage.set(1);
  }

  goToPage(page: number): void { this.currentPage.set(page); }
  changePageSize(size: number): void { this.pageSize.set(size); this.currentPage.set(1); }

  openFilters(): void { this.filters.open(); }

  closeFilters(): void { this.filters.close(); }

  toggleDraftFilter(group: EventFilterKey, value: string): void {
    this.filters.toggleDraft(group, value);
  }

  isDraftSelected(group: EventFilterKey, value: string): boolean {
    return this.filters.isDraftSelected(group, value);
  }

  resetDraftFilters(): void { this.filters.resetDraft(); }

  applyFilters(): void {
    this.filters.apply();
    this.currentPage.set(1);
  }

  removeAppliedFilter(group: EventFilterKey, value: string): void {
    this.filters.removeApplied(group, value);
    this.currentPage.set(1);
  }

  clearAppliedFilters(): void {
    this.filters.clearApplied();
    this.currentPage.set(1);
  }

  toggleSaved(eventId: string): void { this.favourites.toggle(eventId); }

  // A method (not a template-bound signal expression) reading this component's OWN signal is still
  // tracked correctly by zoneless change detection — unlike the old isSaved() wrapper this replaced,
  // which read a signal owned by an INJECTED service and silently missed its updates (see explore-
  // events.html's [saved] binding, now reading favourites.savedEventIds() directly).
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
}
