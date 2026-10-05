import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, debounceTime, finalize, switchMap } from 'rxjs';
import { EventRegistration, PublishedEvent } from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalFilterControlsComponent, InternalPageStateComponent, InternalPaginationComponent, InternalSearchFieldComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { PAGE_SIZE_OPTIONS, InternalFilterChange } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton';
import { EVENT_IMAGE_PLACEHOLDER } from '../../../../shared/event-image-placeholder';

// Rows per page in the attendee panel. Smaller than the events grid behind it: the
// panel is a dialog, not a page, and a longer list would scroll the modal rather than
// the table.
const REGISTRATION_PAGE_SIZE = 8;

// Default rows per page. The reader can change it - PAGE_SIZE_OPTIONS is the
// same set of choices every other list in the app offers.
const DEFAULT_PAGE_SIZE = 10;

// Created by Me: events this organiser proposed (or co-owns) that are published, server-side
// searched/filtered/paginated — search/status/page/pageSize are real query params to events.py's
// my_organized_events(), which used to have no filtering or pagination at all and returned the
// caller's entire organised-events list in one response.
@Component({
  selector: 'app-created-by-me',
  imports: [FormModalComponent, InternalPageStateComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalPaginationComponent, SkeletonComponent],
  templateUrl: './created-by-me.html',
  styleUrl: './created-by-me.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatedByMeComponent {
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  readonly placeholder = EVENT_IMAGE_PLACEHOLDER;
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<readonly PublishedEvent[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);

  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly statusFilter = signal('all');
  readonly page = signal(1);

  readonly filters = computed(() => [
    {
      key: 'status', ariaLabel: 'Filter by status', value: this.statusFilter(),
      options: [
        { value: 'all', label: 'All statuses' },
        { value: 'upcoming', label: 'Upcoming' },
        { value: 'ended', label: 'Ended' },
      ],
    },
  ]);

  readonly infoTarget = signal<PublishedEvent | null>(null);
  readonly registrations = signal<readonly EventRegistration[]>([]);
  readonly registrationsLoading = signal(false);
  readonly registrationsError = signal('');

  /**
   * The attendee panel's own server query. Search, order and page all go to
   * events.py's list_registrations() rather than being applied to a downloaded
   * array — an event with 200 attendees no longer ships 200 rows to draw ten.
   */
  readonly registrationSearch = signal('');
  private readonly debouncedRegistrationSearch = signal('');
  // Newest decision first: an organiser opening this panel is checking what has
  // happened recently, not reading the list from the beginning.
  readonly registrationOrder = signal<'asc' | 'desc'>('desc');
  readonly registrationPage = signal(1);
  readonly registrationPageSize = signal(REGISTRATION_PAGE_SIZE);
  readonly registrationTotal = signal(0);
  readonly registrationTotalPages = signal(1);

  // Straight from the server and never counted from the page on screen: these tiles
  // describe the event, so they hold still while the reader searches and pages.
  readonly confirmedCount = signal(0);
  readonly pendingCount = signal(0);
  readonly rejectedCount = signal(0);

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    toObservable(computed(() => ({ q: this.debouncedSearch(), status: this.statusFilter(), page: this.page() })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          this.error.set('');
          return this.events.getMyOrganizedEvents({
            q: query.q || undefined,
            status: query.status === 'upcoming' || query.status === 'ended' ? query.status : undefined,
            page: query.page,
            pageSize: this.pageSize(),
          }).pipe(finalize(() => this.loading.set(false)));
        }),
      )
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.total.set(response.total);
          this.totalPages.set(response.totalPages);
        },
        error: () => this.error.set('Your events could not be loaded.'),
      });

    toObservable(this.registrationSearch).pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedRegistrationSearch.set(value); this.registrationPage.set(1); });

    // Reacts to the open event AND to the panel's query, so opening a panel, typing in
    // its search box, flipping the sort and turning the page are all one code path.
    toObservable(computed(() => ({
      eventId: this.infoTarget()?.id ?? null,
      q: this.debouncedRegistrationSearch(),
      order: this.registrationOrder(),
      page: this.registrationPage(),
      pageSize: this.registrationPageSize(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          if (!query.eventId) return EMPTY;
          this.registrationsLoading.set(true);
          this.registrationsError.set('');
          return this.events.getAllRegistrations(query.eventId, {
            q: query.q || undefined,
            order: query.order,
            page: query.page,
            pageSize: query.pageSize,
          }).pipe(finalize(() => this.registrationsLoading.set(false)));
        }),
      )
      .subscribe({
        next: (response) => {
          this.registrations.set(response.items);
          this.registrationTotal.set(response.total);
          this.registrationTotalPages.set(response.totalPages);
          this.confirmedCount.set(response.counts.confirmed);
          this.pendingCount.set(response.counts.pending);
          this.rejectedCount.set(response.counts.rejected);
        },
        error: () => this.registrationsError.set('The registrant list could not be loaded.'),
      });
  }

  setSearch(value: string): void { this.search.set(value); }
  setFilter(change: InternalFilterChange): void {
    if (change.key === 'status') this.statusFilter.set(change.value);
    this.page.set(1);
  }
  setPage(page: number): void { this.page.set(Math.max(1, Math.min(page, this.totalPages()))); }
  // Back to page 1: page 3 of 25-row pages is not page 3 of 5-row pages.
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

  openInfo(event: PublishedEvent): void {
    // A fresh panel starts at the top of an unsearched list, whichever event was
    // open before. The query signals below drive the fetch.
    this.registrations.set([]);
    this.registrationsError.set('');
    this.registrationSearch.set('');
    this.debouncedRegistrationSearch.set('');
    this.registrationOrder.set('desc');
    this.registrationPage.set(1);
    this.infoTarget.set(event);
  }

  closeInfo(): void {
    this.infoTarget.set(null);
  }

  setRegistrationSearch(value: string): void { this.registrationSearch.set(value); }

  /** The decision date is the only sortable column, so the header toggles direction. */
  toggleRegistrationOrder(): void {
    this.registrationOrder.update((order) => (order === 'desc' ? 'asc' : 'desc'));
    this.registrationPage.set(1);
  }

  setRegistrationPage(page: number): void {
    this.registrationPage.set(Math.max(1, Math.min(page, this.registrationTotalPages())));
  }

  setRegistrationPageSize(size: number): void {
    this.registrationPageSize.set(size);
    this.registrationPage.set(1);
  }

  /** The decision date, falling back to the moment they registered — see decidedAt. */
  decisionDateLabel(row: EventRegistration): string {
    const stamp = row.decidedAt || row.registeredAt;
    if (!stamp) return '—';
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-MY', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  spotsLeftLabel(event: PublishedEvent): string {
    if (event.maxPax == null) return `${event.confirmedRegistrationCount} registered`;
    const left = Math.max(0, event.maxPax - event.confirmedRegistrationCount);
    return `${event.confirmedRegistrationCount} / ${event.maxPax} registered · ${left} spot${left === 1 ? '' : 's'} left`;
  }

  firstScheduleLabel(event: PublishedEvent): string {
    const first = event.schedule[0];
    if (!first) return 'Date to be confirmed';
    const date = new Date(`${first.date}T12:00:00`);
    const formatted = new Intl.DateTimeFormat('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    return `${formatted} · ${first.start} - ${first.end}`;
  }

  registrationStatusLabel(status: EventRegistration['status']): string {
    if (status === 'confirmed') return 'Registered';
    if (status === 'pending') return 'Awaiting your decision';
    return 'Rejected';
  }

  /**
   * The receipt being looked at, shown inside the app.
   *
   * This used to fetch the file as a blob and hand the object URL to window.open()
   * from the response callback. By the time that callback runs the browser no longer
   * counts the click as the cause, so the popup blocker stops it and the button
   * appears to do nothing — and the label it carried was the payment STATUS, which
   * gave no hint that it opened anything at all.
   *
   * The URL the API returns is already signed and time-boxed (events.py's
   * _sign_proofs), so it needs no Authorization header and no fetch: it goes
   * straight into an <img>, the same way Records > Registrations has always shown
   * these receipts.
   */
  readonly proofTarget = signal<EventRegistration | null>(null);
  readonly proofUnavailable = signal(false);

  readonly zoomOpen = signal(false);

  openProof(row: EventRegistration): void {
    this.proofUnavailable.set(false);
    this.zoomOpen.set(false);
    this.proofTarget.set(row);
  }

  closeProof(): void {
    this.zoomOpen.set(false);
    this.proofTarget.set(null);
  }

  openZoom(): void { this.zoomOpen.set(true); }
  closeZoom(): void { this.zoomOpen.set(false); }

  /** The <img> could not load it — the row cites a file storage no longer holds. */
  onProofError(): void {
    this.proofUnavailable.set(true);
  }

  // An <img> cannot render a PDF, and a bank receipt very often is one — the upload
  // endpoint accepts them for exactly that reason (uploads.py's DOCUMENT_TYPES).
  isPdfProof(row: EventRegistration): boolean {
    const name = row.paymentProofFileName || row.paymentProofUrl || '';
    return name.split('?')[0].toLowerCase().endsWith('.pdf');
  }
}
