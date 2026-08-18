import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { PendingEventRegistration } from '../../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../../core/events/published-event.service';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalDataPageConfig, InternalDataRecord, InternalFilterChange, InternalRowActionEvent } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';

// Inbox tab for events whose registration_approval is 'manual': the applicant (or a co-owner)
// reviews each person who asked to attend — name, email and their ≤100-character reason — and
// approves or rejects. This is a plain single-approver flow, not a workflow stage: there is no
// request_task behind it (see ems_database_schema.sql's comment above event_registration), which
// is why it is its own tab rather than a row in the Proposals list.
@Component({
  selector: 'app-hub-registrations',
  imports: [InternalDataPageComponent, FeedbackBannerComponent, ConfirmDialogComponent],
  templateUrl: './hub-registrations.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubRegistrationsComponent {
  private readonly auth = inject(AuthService);
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly actorEmail = this.auth.user()?.email ?? '';

  readonly registrations = signal<readonly PendingEventRegistration[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly eventFilter = signal('All');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  // Approve and reject are both confirmed first: approving admits someone to the event, and
  // rejecting cannot be undone by the applicant afterwards.
  readonly pendingAction = signal<{ registration: PendingEventRegistration; action: 'approve' | 'reject' } | null>(null);
  readonly processing = signal(false);

  constructor() { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.events.getMyPendingRegistrations(this.actorEmail).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (rows) => { this.registrations.set(rows); this.loading.set(false); },
      error: () => { this.errorMessage.set('Pending registrations could not be loaded.'); this.loading.set(false); },
    });
  }

  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    const event = this.eventFilter();
    return this.registrations().filter((row) =>
      (event === 'All' || row.eventTitle === event)
      && (!query || `${row.name} ${row.email} ${row.reason} ${row.eventTitle} ${row.eventCode}`.toLowerCase().includes(query)));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));
  readonly visible = computed(() => this.filtered().slice((this.currentPage() - 1) * this.pageSize(), this.currentPage() * this.pageSize()));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: 'Pending registrations',
    paginationLabel: 'Registration pages',
    rowsPerPageLabel: 'Registrations per page',
    mobileListLabel: 'Registration cards',
    header: {
      title: 'Registrations',
      description: 'People asking to attend your events. Approve or reject each request.',
      countLabel: `${this.filtered().length} pending`,
    },
    search: { ariaLabel: 'Search registrations', placeholder: 'Name, email, reason, or event' },
    columns: [
      { key: 'event', label: 'Event', width: '18rem' },
      { key: 'registrant', label: 'Registrant', width: '16rem' },
      { key: 'reason', label: 'Reason for attending', width: '22rem' },
      { key: 'payment', label: 'Payment', width: '10rem' },
      { key: 'requested', label: 'Requested', width: '12rem' },
      { key: 'actions', label: 'Actions', actions: true, width: '9rem' },
    ],
    actions: [
      { key: 'approve', label: 'Approve registration', icon: 'task_alt' },
      { key: 'reject', label: 'Reject registration', icon: 'do_not_disturb_on' },
    ],
    emptyTitle: 'No registrations need your approval',
    emptyDescription: 'Registrations for your manual-approval events appear here.',
    pageSizeOptions: [5, 10, 25],
  }));

  readonly filters = computed(() => {
    const events = [...new Set(this.registrations().map((row) => row.eventTitle))];
    return [{
      key: 'event', ariaLabel: 'Filter by event', value: this.eventFilter(),
      options: [{ value: 'All', label: 'All events' }, ...events.map((value) => ({ value, label: value }))],
    }];
  });

  readonly records = computed<readonly InternalDataRecord[]>(() => this.visible().map((row) => ({
    id: row.id,
    cells: {
      event: { primary: row.eventTitle, secondary: row.eventCode },
      registrant: { primary: row.name || row.email, secondary: row.email },
      reason: { primary: row.reason || '—' },
      payment: { primary: row.paymentRequired ? this.paymentLabel(row) : 'Free event', badge: row.paymentRequired, tone: 'warning' },
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

  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setFilter(change: InternalFilterChange): void { if (change.key === 'event') this.eventFilter.set(change.value); this.page.set(1); }
  reset(): void { this.search.set(''); this.eventFilter.set('All'); this.page.set(1); }
  setPage(value: number): void { this.page.set(value); }
  setPageSize(value: number): void { this.pageSize.set(value); this.page.set(1); }

  handleAction(event: InternalRowActionEvent): void {
    const registration = this.registrations().find((row) => row.id === String(event.record.id));
    if (!registration) return;
    if (event.action.key === 'approve' || event.action.key === 'reject') {
      this.pendingAction.set({ registration, action: event.action.key });
    }
  }

  cancelAction(): void { if (!this.processing()) this.pendingAction.set(null); }

  confirmAction(): void {
    const pending = this.pendingAction();
    if (!pending) return;
    const { registration, action } = pending;
    const who = registration.name || registration.email;
    this.processing.set(true);
    const request$ = action === 'approve'
      ? this.events.approveRegistration(registration.id, this.actorEmail)
      : this.events.rejectRegistration(registration.id, this.actorEmail);
    request$.pipe(finalize(() => this.processing.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.registrations.update((rows) => rows.filter((row) => row.id !== registration.id));
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
