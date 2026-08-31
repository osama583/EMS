import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, finalize, switchMap } from 'rxjs';
import { ToastService, apiErrorMessage } from '../../../../shared/components/toast/toast.service';
import { EventRegistration, PublishedEvent } from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalFilterControlsComponent, InternalPageStateComponent, InternalPaginationComponent, InternalSearchFieldComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { PAGE_SIZE_OPTIONS, InternalFilterChange } from '../../../../shared/components/internal-data-page/internal-data-page.models';
import { EVENT_IMAGE_PLACEHOLDER } from '../../../../shared/event-image-placeholder';

// A registered attendee, or one still awaiting the organiser's decision (manual-approval events).
// 'cancelled' registrations exist in the data but are deliberately left out of the info panel —
// they never counted toward capacity and add nothing an organiser needs to act on or report on.
const VISIBLE_STATUSES: readonly EventRegistration['status'][] = ['confirmed', 'pending', 'rejected'];

// Default rows per page. The reader can change it - PAGE_SIZE_OPTIONS is the
// same set of choices every other list in the app offers.
const DEFAULT_PAGE_SIZE = 10;

// Created by Me: events this organiser proposed (or co-owns) that are published, server-side
// searched/filtered/paginated — search/status/page/pageSize are real query params to events.py's
// my_organized_events(), which used to have no filtering or pagination at all and returned the
// caller's entire organised-events list in one response.
@Component({
  selector: 'app-created-by-me',
  imports: [FormModalComponent, InternalPageStateComponent, InternalSearchFieldComponent, InternalFilterControlsComponent, InternalPaginationComponent],
  templateUrl: './created-by-me.html',
  styleUrl: './created-by-me.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatedByMeComponent implements OnDestroy {
  readonly pageSizeOptions = PAGE_SIZE_OPTIONS;
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  readonly placeholder = EVENT_IMAGE_PLACEHOLDER;
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

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

  readonly visibleRegistrations = computed(() =>
    this.registrations().filter((row) => VISIBLE_STATUSES.includes(row.status)),
  );
  readonly confirmedCount = computed(() => this.visibleRegistrations().filter((row) => row.status === 'confirmed').length);
  readonly pendingCount = computed(() => this.visibleRegistrations().filter((row) => row.status === 'pending').length);
  readonly rejectedCount = computed(() => this.visibleRegistrations().filter((row) => row.status === 'rejected').length);

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
    this.infoTarget.set(event);
    this.registrations.set([]);
    this.registrationsError.set('');
    this.registrationsLoading.set(true);
    this.events.getAllRegistrations(event.id).pipe(
      finalize(() => this.registrationsLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (rows) => this.registrations.set(rows),
      error: () => this.registrationsError.set('The registrant list could not be loaded.'),
    });
  }

  closeInfo(): void {
    this.infoTarget.set(null);
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

  paymentStatusLabel(status: EventRegistration['paymentStatus']): string {
    if (status === 'approved') return 'Payment approved';
    if (status === 'pending_review') return 'Payment awaiting review';
    if (status === 'rejected') return 'Payment rejected';
    return '';
  }

  // The row whose proof is currently being fetched, so the cell can say so and a
  // double-click cannot start a second download.
  readonly openingProofFor = signal<string | null>(null);
  private readonly objectUrls: string[] = [];

  /**
   * Open a registrant's payment proof in a new tab.
   *
   * This used to be a plain <a href> straight at /api/v1/uploads/{key}. Uploads are
   * content-addressed files on local disk, so any proof whose file is not there —
   * a receipt uploaded before the volume was reset, or a row whose URL was written
   * without a file ever being stored — navigated the reader to the API's raw JSON
   * 404 body. Clicking "Payment approved" and landing on {"error":{"code":
   * "not_found"...}} reads as the whole app breaking, when the true and much
   * smaller fact is that one file is missing.
   *
   * Fetching it first turns that into a sentence. A proof that IS there opens
   * exactly as before; one that is not says so and leaves the reader on the page,
   * with the payment status they came to check still in front of them.
   */
  openPaymentProof(row: EventRegistration): void {
    const url = row.paymentProofUrl;
    if (!url || this.openingProofFor()) return;
    this.openingProofFor.set(row.id);
    this.http.get(url, { responseType: 'blob' }).pipe(
      finalize(() => this.openingProofFor.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (file) => {
        // Revoked on destroy rather than immediately: the new tab is still reading
        // from this URL, and revoking it now would blank the tab we just opened.
        const objectUrl = URL.createObjectURL(file);
        this.objectUrls.push(objectUrl);
        window.open(objectUrl, '_blank', 'noopener');
      },
      error: (err) => this.toast.error(
        'That payment proof is no longer available',
        err?.status === 404
          ? `The file ${row.paymentProofFileName || 'attached to this registration'} is not in storage any more. The payment status on this row is unaffected.`
          : apiErrorMessage(err, 'The file could not be opened. Please try again.'),
      ),
    });
  }

  ngOnDestroy(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
  }
}
