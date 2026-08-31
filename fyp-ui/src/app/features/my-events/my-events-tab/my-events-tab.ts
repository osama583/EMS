import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, finalize, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { EventSearchParams, PublishedEvent, RegistrationResult, RegistrationStatus } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { RegisteredEventsResponse, SavedEventsResponse } from '../../../core/events/event-engagement.models';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { EventCardComponent } from '../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../shared/components/event-details-modal/event-details-modal';
import { EventFilterBarComponent } from '../../../shared/components/event-filter-bar/event-filter-bar';
import { EventFilterDialogComponent } from '../../../shared/components/event-filter-bar/event-filter-dialog';
import { EventFilterQuery, EventFilterState, toEventSearchParams } from '../../../shared/components/event-filter-bar/event-filter.state';
import { InternalPageHeaderComponent, InternalPageStateComponent, InternalPaginationComponent } from '../../../shared/components/internal-data-page/internal-data-page-parts';
import { PAGE_SIZE_OPTIONS, InternalPageHeaderConfig } from '../../../shared/components/internal-data-page/internal-data-page.models';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton';
import { ToastService } from '../../../shared/components/toast/toast.service';

export type MyEventsTabMode = 'saved' | 'pending' | 'registered' | 'history';

interface TabEntry {
  readonly event: PublishedEvent;
  readonly status: RegistrationStatus | null;
}

interface TabPage {
  readonly items: readonly TabEntry[];
  readonly total: number;
  readonly totalPages: number;
}

const EMPTY_PAGE: TabPage = { items: [], total: 0, totalPages: 1 };

// Default rows per page. The reader can change it - PAGE_SIZE_OPTIONS is the
// same set of choices every other list in the app offers, and the default has to be one of them
// or the control opens with nothing selected.
const DEFAULT_PAGE_SIZE = 10;

// Every scope this component renders (saved/pending/registered/history) is a real server query:
// the search box, every filter group and page/pageSize go straight through to events.py's
// search_saved()/my_registrations(), which filter, count and LIMIT/OFFSET in SQL - the browser
// only ever holds the one page of events it's about to show, never a list it narrows itself.
// The filter UI is the same EventFilterState/bar/dialog Explore Events uses, so the two surfaces
// offer the same groups and the same draft/apply flow.
@Component({
  selector: 'app-my-events-tab',
  imports: [
    EventCardComponent,
    EventDetailsModalComponent,
    EventFilterBarComponent,
    EventFilterDialogComponent,
    InternalPageHeaderComponent,
    InternalPageStateComponent,
    InternalPaginationComponent,
    SkeletonComponent,
  ],
  templateUrl: './my-events-tab.html',
  // .shared-page-width is a plain block, not the gapped grid column Explore Events lays its
  // toolbar/grid/pagination out in, so the footer needs its own room under the last row of cards.
  styles: '.my-events-tab__pagination { margin-top: var(--space-5); }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyEventsTabComponent {
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  private readonly auth = inject(AuthService);
  // Public: the template reads savedEvents.savedEventIds() directly (a signal owned by this injected
  // service) rather than through a wrapping isSaved(id) method call — zoneless change detection does
  // not reliably re-check a template after a signal write from a service the component only reaches
  // through a method, since the method call itself isn't a tracked dependency the way a direct signal
  // read in the template is.
  readonly savedEvents = inject(SavedEventsService);
  private readonly eventService = inject(PublishedEventService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = input.required<MyEventsTabMode>();
  // MyEventsComponent's own shell already renders an "My Events" <h1> above this tab's outlet
  // (saved/registered), so this only draws its own header when embedded directly in a bucket
  // (Ongoing/History) route that has no page header of its own — see app.routes.ts's ongoing/events
  // entry, the only place this is set true.
  readonly showHeader = input(false);

  readonly filters = new EventFilterState();

  readonly loading = signal(true);
  // Only the FIRST load may replace the grid with a skeleton — a later load (a filter, a search, a
  // page change) keeps the cards mounted and swaps their data in place, the same way Explore
  // Events does, so the heart on a card survives a refresh.
  readonly hasLoadedOnce = signal(false);
  readonly showSkeleton = computed(() => this.loading() && !this.hasLoadedOnce());
  readonly error = signal('');
  readonly entries = signal<readonly TabEntry[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly page = signal(1);
  readonly selectedEvent = signal<PublishedEvent | null>(null);
  readonly registeringEventId = signal<string | null>(null);

  // The dialog's live "Show N Results" preview counts within THIS tab's scope, not across every
  // event — before the first preview lands it falls back to the applied count so the button never
  // shows a jarring 0.
  readonly draftResultCount = computed(() => this.filters.draftPreviewCount() ?? this.total());

  /** True once the reader has narrowed the list themself — changes what an empty result means. */
  readonly isFiltered = computed(() => this.filters.appliedCount() > 0 || !!this.filters.searchTerm().trim());

  private readonly reloadTick = signal(0);

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Events',
    description: 'Events you have registered for, awaiting the organiser’s decision.',
  }));

  readonly emptyIcon = computed(() => {
    if (this.isFiltered()) return 'search_off';
    switch (this.mode()) {
      case 'saved': return 'favorite';
      case 'pending': return 'hourglass_top';
      case 'registered': return 'event_available';
      default: return 'history';
    }
  });
  readonly emptyTitle = computed(() => {
    if (this.isFiltered()) return 'No events found';
    switch (this.mode()) {
      case 'saved': return 'No saved events yet';
      case 'pending': return 'No pending registrations';
      case 'registered': return 'No active registrations';
      default: return 'No past events yet';
    }
  });
  readonly emptyDescription = computed(() => {
    if (this.isFiltered()) return 'Try another search or remove a few filters.';
    switch (this.mode()) {
      case 'saved': return 'Use the heart on any event card to keep it here.';
      case 'pending': return 'Registrations for manual-approval events will appear here while you wait for the organizer to decide.';
      case 'registered': return 'Register for an event to see it appear here.';
      default: return 'Events you attended will appear here once they end.';
    }
  });

  constructor() {
    // The filter dialog needs its option lists whether or not it has been opened yet, and every
    // tab here shows it.
    this.filters.loadOptions();

    toObservable(computed(() => ({
      mode: this.mode(),
      page: this.page(),
      pageSize: this.pageSize(),
      query: this.filters.query(),
      tick: this.reloadTick(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((request) => {
          if (!this.auth.user()) return of(EMPTY_PAGE);
          this.loading.set(true);
          this.error.set('');
          return this.load(request.mode, request.query, request.page, request.pageSize).pipe(
            // Handled here rather than in the subscriber: an error delivered to subscribe()
            // terminates the outer stream, and the tab would then ignore every later filter,
            // search or page change.
            catchError(() => {
              this.error.set('These events could not be loaded.');
              return of(EMPTY_PAGE);
            }),
            finalize(() => { this.loading.set(false); this.hasLoadedOnce.set(true); }),
          );
        }),
      )
      .subscribe((result) => {
        this.entries.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
      });

    this.filters.draftChanges
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(300),
        switchMap(() => this.count(this.mode(), this.filters.draftQuery()).pipe(catchError(() => of(null)))),
      )
      .subscribe((total) => this.filters.draftPreviewCount.set(total));
  }

  private searchParams(query: EventFilterQuery, page: number, pageSize: number): EventSearchParams {
    return {
      ...toEventSearchParams(query, page, pageSize),
      // Saved only: an event you have a confirmed place on belongs under Registered.
      excludeConfirmed: this.mode() === 'saved',
    };
  }

  private registrations(mode: 'pending' | 'registered' | 'history', params: EventSearchParams): Observable<RegisteredEventsResponse> {
    if (mode === 'pending') return this.eventService.getPendingApprovalRegistrations(params);
    if (mode === 'registered') return this.eventService.getActiveRegistrations(params);
    return this.eventService.getRegistrationHistory(params);
  }

  private load(mode: MyEventsTabMode, query: EventFilterQuery, page: number, pageSize: number): Observable<TabPage> {
    const params = this.searchParams(query, page, pageSize);
    if (mode === 'saved') {
      return this.savedEvents.searchSavedEvents(params).pipe(switchMap((response) => this.withStatuses(response)));
    }
    return this.registrations(mode, params).pipe(map((response) => ({
      items: response.items.map((item): TabEntry => ({ event: item.event, status: item.status })),
      total: response.total,
      totalPages: response.totalPages,
    })));
  }

  // The filter dialog's live preview: how many events THIS tab would hold under the draft
  // selection. countOnly means only `total` is read, so the server skips building and decorating
  // a page of full event records just to report a number.
  private count(mode: MyEventsTabMode, query: EventFilterQuery): Observable<number> {
    const params = { ...this.searchParams(query, 1, 1), countOnly: true };
    const request: Observable<{ total: number }> = mode === 'saved'
      ? this.savedEvents.searchSavedEvents(params)
      : this.registrations(mode, params);
    return request.pipe(map((response) => response.total));
  }

  // Saved events carry no registration status of their own, so the card's status badge needs one
  // batched lookup for the page that was returned — not one request per card.
  private withStatuses(response: SavedEventsResponse): Observable<TabPage> {
    const page = { total: response.total, totalPages: response.totalPages };
    if (response.items.length === 0) return of({ ...page, items: [] });
    return this.eventService.getRegistrationStatuses(response.items.map((item) => item.id)).pipe(
      map((statuses) => ({
        ...page,
        items: response.items.map((item): TabEntry => ({ event: item, status: statuses.get(item.id) ?? null })),
      })),
      catchError(() => of({ ...page, items: response.items.map((item): TabEntry => ({ event: item, status: null })) })),
    );
  }

  private triggerReload(): void { this.reloadTick.update((tick) => tick + 1); }

  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  // Back to page 1: page 3 of 25-row pages is not page 3 of 5-row pages.
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  // A narrower list can be shorter than the page you were on, so every query change restarts at
  // page 1 — the same rule Explore Events follows.
  onQueryChange(): void { this.page.set(1); }

  clearFilters(): void {
    this.filters.clearApplied();
    this.filters.setSearchTerm('');
    this.onQueryChange();
  }

  toggleSaved(eventId: string): void {
    const user = this.auth.user();
    if (!user) return;
    const operation = this.savedEvents.isSaved(eventId)
      ? this.savedEvents.removeSavedEvent(user.email, eventId)
      : this.savedEvents.saveEvent(user.email, eventId);
    operation.subscribe(() => { if (this.mode() === 'saved') this.triggerReload(); });
  }

  registerForEvent(eventId: string): void {
    const user = this.auth.user();
    if (!user || this.registeringEventId()) return;
    const event = this.entries().find((entry) => entry.event.id === eventId)?.event;
    // Same as Explore: a reason for attending / payment proof can only be collected in the
    // details modal, so route there rather than sending an incomplete registration.
    if (event && (event.registrationMode === 'Manual' || (event.cost != null && event.cost > 0))) {
      this.selectedEvent.set(event);
      return;
    }
    this.registeringEventId.set(eventId);
    const eventTitle = event?.eventTitle ?? 'the event';
    this.eventService.registerForEvent(eventId).subscribe({
      next: (result) => {
        this.registeringEventId.set(null);
        this.triggerReload();
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

  onModalRegistered(result: RegistrationResult): void {
    const eventTitle = this.selectedEvent()?.eventTitle ?? 'the event';
    this.selectedEvent.set(null);
    this.triggerReload();
    if (result.status === 'rejected' || result.status === 'duplicate') {
      this.toast.error('Registration not completed', result.message);
    } else {
      this.toast.success(`You're registered for ${eventTitle}`, result.status === 'pending' ? 'Your registration is pending approval.' : undefined);
    }
  }
}
