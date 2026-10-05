import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { PendingEventRegistration } from '../../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../../core/events/published-event.service';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellClickEvent, InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent, InternalSortChange, InternalSortState } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';

// Inbox tab for events whose registration_approval is 'manual': the applicant (or a co-owner) reviews
// each person who asked to attend — name, email and their ≤100-character reason — and approves or
// rejects.
@Component({
  selector: 'app-hub-registrations',
  imports: [InternalDataPageComponent, FeedbackBannerComponent, ConfirmDialogComponent, FormModalComponent],
  templateUrl: './hub-registrations.html',
  styles: `
    .proof-preview__meta { margin: 0 0 var(--space-3); color: var(--apu-text-muted); font-size: .9rem; }
    .proof-preview__link { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; }
    .proof-preview__image { display: block; width: 100%; max-height: 60vh; object-fit: contain; border: 1px solid var(--apu-border); border-radius: var(--radius-card); background: #f7f9fc; }
    .proof-preview__open { display: inline-flex; align-items: center; gap: .4rem; margin-top: var(--space-2); border: 0; background: none; padding: 0; color: var(--apu-blue-600); font-weight: 700; cursor: pointer; }
    .proof-preview__open:hover { text-decoration: underline; }

    .proof-image-lightbox {
      position: fixed;
      z-index: 1300;
      inset: 0;
      display: grid;
      place-items: center;
      padding: clamp(1rem, 4vw, 3rem);
      background: rgb(2 14 29 / 88%);
      backdrop-filter: blur(8px);
      cursor: zoom-out;
    }
    .proof-image-lightbox figure {
      position: relative;
      display: grid;
      max-width: min(72rem, 94vw);
      max-height: 92vh;
      margin: 0;
      overflow: hidden;
      border: 1px solid rgb(255 255 255 / 20%);
      border-radius: var(--radius-container);
      background: var(--apu-navy-950);
      box-shadow: var(--shadow-overlay);
      cursor: default;
    }
    .proof-image-lightbox img { display: block; max-width: 100%; max-height: min(80vh, 54rem); object-fit: contain; }
    .proof-image-lightbox figcaption { padding: .9rem 1.1rem; color: #fff; font-weight: 700; }
    .proof-image-lightbox button {
      position: absolute;
      top: .75rem;
      right: .75rem;
      display: grid;
      width: 2.75rem;
      height: 2.75rem;
      place-items: center;
      border: 1px solid rgb(255 255 255 / 24%);
      border-radius: 50%;
      background: rgb(3 19 39 / 72%);
      color: #fff;
      cursor: pointer;
    }
    .proof-image-lightbox button:hover,
    .proof-image-lightbox button:focus-visible { background: var(--apu-blue-600); outline: 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubRegistrationsComponent {
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly registrations = signal<readonly PendingEventRegistration[]>([]);
  readonly eventOptions = signal<readonly string[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  private readonly debouncedSearch = signal('');
  readonly eventFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);
  // Oldest first: an approval queue is worked front to back, so the request
  // that has waited longest sits at the top.
  readonly sort = signal<InternalSortState>({ key: 'requested', order: 'asc' });
  // Bumped after an approve/reject so the query pipeline refetches the current page from the
  // server — with server pagination, splicing the approved/rejected row out of the local array
  // would desync `total`/`totalPages` from what the server actually holds.
  private readonly reloadTick = signal(0);

  // Approve and reject are both confirmed first: approving admits someone to the event, and
  // rejecting cannot be undone by the applicant afterwards.
  readonly pendingAction = signal<{ registration: PendingEventRegistration; action: 'approve' | 'reject' } | null>(null);
  readonly processing = signal(false);

  // "Proof to review" used to be a static badge with nowhere to actually see the proof - clicking
  // it now opens the uploaded image so the approver can verify payment before deciding.
  readonly proofPreview = signal<PendingEventRegistration | null>(null);
  // Full-size proof preview stays in-page (a lightbox over the form-modal) instead of navigating
  // to /api/v1/uploads/... in a new tab — mirrors event-details-modal.ts's image lightbox.
  readonly imageLightboxOpen = signal(false);
  private readonly imageLightbox = viewChild<ElementRef<HTMLElement>>('imageLightbox');

  constructor() {
    toObservable(this.search).pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => { this.debouncedSearch.set(value); this.page.set(1); });

    this.events.getPendingApprovalEventOptions().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => this.eventOptions.set(events));

    toObservable(computed(() => ({
      q: this.debouncedSearch(),
      event: this.eventFilter(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
      reload: this.reloadTick(),
    })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          this.loading.set(true);
          return this.events.getMyPendingRegistrations({
            q: query.q || undefined,
            event: query.event === 'All' ? undefined : query.event,
            page: query.page,
            pageSize: query.pageSize,
            order: query.sort.order,
          }).pipe(
            // Caught HERE, inside switchMap: an error reaching subscribe()'s error callback ends
            // the outer subscription permanently, so every later filter/search/page change would
            // silently stop doing anything.
            catchError(() => {
              this.errorMessage.set('Pending registrations could not be loaded.');
              this.loading.set(false);
              return of(null);
            }),
          );
        }),
      )
      .subscribe((result) => {
        if (!result) return;
        this.registrations.set(result.items);
        this.total.set(result.total);
        this.totalPages.set(result.totalPages);
        this.loading.set(false);
        this.errorMessage.set('');
      });
  }

  setSort(change: InternalSortChange): void {
    this.sort.set({ key: change.key, order: change.order });
    this.page.set(1);
  }

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending registrations',
    paginationLabel: 'Registration pages',
    rowsPerPageLabel: 'Registrations per page',
    mobileListLabel: 'Registration cards',
    header: {
      title: 'Events',
      description: 'People asking to attend your events. Approve or reject each request.',
      countLabel: `${this.total()} pending`,
    },
    search: { ariaLabel: 'Search registrations', placeholder: 'Name, email, reason, or event' },
    columns: [
      { key: 'event', label: 'Event', width: '18rem' },
      { key: 'registrant', label: 'Registrant', width: '16rem' },
      { key: 'reason', label: 'Reason for attending', width: '22rem' },
      { key: 'payment', label: 'Payment', width: '10rem' },
      { key: 'requested', label: 'Requested', width: '12rem', sortKey: 'requested' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ],
    actions: [
      { key: 'approve', label: 'Approve registration', icon: 'task_alt' },
      { key: 'reject', label: 'Reject registration', icon: 'do_not_disturb_on' },
    ],
    emptyTitle: 'No registrations need your approval',
    emptyDescription: 'Registrations for your manual-approval events appear here.',
  }));

  readonly filters = computed(() => [{
    key: 'event', ariaLabel: 'Filter by event', value: this.eventFilter(),
    options: [{ value: 'All', label: 'All events' }, ...this.eventOptions().map((value) => ({ value, label: value }))],
  }]);

  readonly records = computed<readonly InternalDataRecord[]>(() => this.registrations().map((row) => ({
    id: row.id,
    cells: {
      event: { primary: row.eventTitle, secondary: row.eventCode },
      registrant: { primary: row.name || row.email, secondary: row.email },
      reason: { primary: row.reason || '—' },
      payment: {
        primary: row.paymentRequired ? this.paymentLabel(row) : 'Free event',
        badge: row.paymentRequired,
        tone: 'warning',
        clickable: this.hasViewableProof(row),
        badgeIcon: this.hasViewableProof(row) ? 'receipt_long' : undefined,
      },
      requested: { primary: this.formatDate(row.registeredAt) },
    },
    mobile: {
      eyebrow: row.eventCode,
      status: 'Pending',
      title: row.name || row.email,
      identity: row.email,
      details: [
        { icon: 'event', text: row.eventTitle },
        { icon: 'chat', text: row.reason || 'No reason given' },
        { icon: 'schedule', text: this.formatDate(row.registeredAt) },
      ],
    },
  })));

  readonly confirmTitle = computed(() => this.pendingAction()?.action === 'reject' ? 'Reject registration' : 'Approve registration');
  readonly confirmMessage = computed(() => {
    const pending = this.pendingAction();
    if (!pending) return '';
    const who = pending.registration.name || pending.registration.email;
    return pending.action === 'approve'
      ? `Approve ${who} for ${pending.registration.eventTitle}? They will be confirmed as an attendee${pending.registration.paymentRequired ? ' and their payment will be marked approved' : ''}.`
      : `Are you sure you want to reject ${who}'s registration for ${pending.registration.eventTitle}? This cannot be undone.`;
  });

  setSearch(value: string): void { this.search.set(value); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'event') this.eventFilter.set(change.value); this.page.set(1); }
  reset(): void { this.search.set(''); this.debouncedSearch.set(''); this.eventFilter.set('All'); this.page.set(1); }
  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const registration = this.registrations().find((row) => row.id === String(event.record.id));
    if (!registration) return;
    if (event.action.key === 'approve' || event.action.key === 'reject') {
      this.pendingAction.set({ registration, action: event.action.key });
    }
  }

  handleCellClick(event: InternalCellClickEvent): void {
    if (event.columnKey !== 'payment') return;
    const registration = this.registrations().find((row) => row.id === String(event.record.id));
    if (registration && this.hasViewableProof(registration)) this.proofPreview.set(registration);
  }

  closeProofPreview(): void { this.proofPreview.set(null); this.imageLightboxOpen.set(false); }

  openImageLightbox(): void {
    this.imageLightboxOpen.set(true);
    queueMicrotask(() => this.imageLightbox()?.nativeElement.focus({ preventScroll: true }));
  }
  closeImageLightbox(): void { this.imageLightboxOpen.set(false); }

  hasViewableProof(row: PendingEventRegistration): boolean {
    return row.paymentStatus === 'pending_review' && !!row.paymentProofUrl;
  }

  cancelAction(): void { if (!this.processing()) this.pendingAction.set(null); }

  confirmAction(): void {
    const pending = this.pendingAction();
    if (!pending) return;
    const { registration, action } = pending;
    const who = registration.name || registration.email;
    this.processing.set(true);
    const request$ = action === 'approve'
      ? this.events.approveRegistration(registration.eventId, registration.id)
      : this.events.rejectRegistration(registration.eventId, registration.id);
    request$.pipe(finalize(() => this.processing.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.reloadTick.update((n) => n + 1);
        this.pendingAction.set(null);
        if (action === 'approve') this.toast.success('Registration approved', `${who} is confirmed for ${registration.eventTitle}.`);
        else this.toast.info('Registration rejected', `${who} was not admitted to ${registration.eventTitle}.`);
      },
      error: (err) => {
        this.pendingAction.set(null);
        this.toast.error(action === 'approve' ? 'Could not approve this registration' : 'Could not reject this registration', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  private paymentLabel(row: PendingEventRegistration): string {
    return row.paymentStatus === 'pending_review' ? 'Proof to review' : 'Paid event';
  }

  private formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
