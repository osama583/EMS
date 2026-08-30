import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { finalize, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { PublishedEvent, RegistrationResult, RegistrationStatus } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { EventCardComponent } from '../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../shared/components/event-details-modal/event-details-modal';
import { InternalPageHeaderComponent, InternalPageStateComponent, InternalPaginationComponent } from '../../../shared/components/internal-data-page/internal-data-page-parts';
import { PAGE_SIZE_OPTIONS, InternalPageHeaderConfig } from '../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { ReminderScope, ReminderSettingsComponent } from '../reminder-settings/reminder-settings';

export type MyEventsTabMode = 'saved' | 'pending' | 'registered' | 'history';

interface TabEntry {
  readonly event: PublishedEvent;
  readonly status: RegistrationStatus | null;
}

// Default rows per page. The reader can change it - PAGE_SIZE_OPTIONS is the
// same set of choices every other list in the app offers.
const DEFAULT_PAGE_SIZE = 10;

// Every scope this component renders (saved/pending/registered/history) is now a real server query:
// page/pageSize go straight through to events.py's search_saved()/my_registrations(), which filter,
// count, and LIMIT/OFFSET in SQL - the browser only ever holds the one page of events it's about to
// show, not the whole list sliced client-side.
@Component({
  selector: 'app-my-events-tab',
  imports: [EventCardComponent, EventDetailsModalComponent, InternalPageHeaderComponent, InternalPageStateComponent, InternalPaginationComponent, ReminderSettingsComponent],
  templateUrl: './my-events-tab.html',
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

  readonly loading = signal(true);
  readonly error = signal('');
  readonly entries = signal<readonly TabEntry[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly page = signal(1);
  readonly selectedEvent = signal<PublishedEvent | null>(null);
  readonly registeringEventId = signal<string | null>(null);

  // Only the Saved and Registered tabs own reminder settings - pending/history
  // are views of events whose reminders belong to one of those two lists, so
  // showing the panel there would offer the same switch in three places.
  readonly reminderScope = computed<ReminderScope | null>(() => {
    const mode = this.mode();
    return mode === 'saved' || mode === 'registered' ? mode : null;
  });

  private readonly reloadTick = signal(0);

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Events',
    description: 'Events you have registered for, awaiting the organiser’s decision.',
  }));

  readonly emptyIcon = computed(() => {
    switch (this.mode()) {
      case 'saved': return 'favorite';
      case 'pending': return 'hourglass_top';
      case 'registered': return 'event_available';
      default: return 'history';
    }
  });
  readonly emptyTitle = computed(() => {
    switch (this.mode()) {
      case 'saved': return 'No saved events yet';
      case 'pending': return 'No pending registrations';
      case 'registered': return 'No active registrations';
      default: return 'No past events yet';
    }
  });
  readonly emptyDescription = computed(() => {
    switch (this.mode()) {
      case 'saved': return 'Use the heart on any event card to keep it here.';
      case 'pending': return 'Registrations for manual-approval events will appear here while you wait for the organizer to decide.';
      case 'registered': return 'Register for an event to see it appear here.';
      default: return 'Events you attended will appear here once they end.';
    }
  });

  constructor() {
    toObservable(computed(() => ({ mode: this.mode(), page: this.page(), tick: this.reloadTick() })))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((query) => {
          const user = this.auth.user();
          if (!user) return [{ items: [] as readonly TabEntry[], total: 0, totalPages: 1 }];
          this.loading.set(true);
          this.error.set('');
          return this.load(query.mode, user.email, query.page).pipe(finalize(() => this.loading.set(false)));
        }),
      )
      .subscribe({
        next: (result) => {
          this.entries.set(result.items);
          this.total.set(result.total);
          this.totalPages.set(result.totalPages);
        },
        error: () => this.error.set('These events could not be loaded.'),
      });
  }

  private load(mode: MyEventsTabMode, userEmail: string, page: number) {
    if (mode === 'saved') {
      return this.savedEvents.searchSavedEvents(page, this.pageSize()).pipe(
        switchMap((response) => {
          if (response.items.length === 0) {
            return [{ items: [] as readonly TabEntry[], total: response.total, totalPages: response.totalPages }];
          }
          return this.eventService.getRegistrationStatuses(response.items.map((item) => item.id)).pipe(
            switchMap((statuses) => {
              const items = response.items
                .map((item): TabEntry => ({ event: item, status: statuses.get(item.id) ?? null }))
                .filter((entry) => entry.status !== 'confirmed');
              return [{ items, total: response.total, totalPages: response.totalPages }];
            }),
          );
        }),
      );
    }
    const request = mode === 'pending'
      ? this.eventService.getPendingApprovalRegistrations(page, this.pageSize())
      : mode === 'registered'
        ? this.eventService.getActiveRegistrations(page, this.pageSize())
        : this.eventService.getRegistrationHistory(page, this.pageSize());
    return request.pipe(
      switchMap((response) => [{
        items: response.items.map((item): TabEntry => ({ event: item.event, status: item.status })),
        total: response.total,
        totalPages: response.totalPages,
      }]),
    );
  }

  private triggerReload(): void { this.reloadTick.update((tick) => tick + 1); }

  setPage(value: number): void { this.page.set(Math.max(1, Math.min(value, this.totalPages()))); }
  // Back to page 1: page 3 of 25-row pages is not page 3 of 5-row pages.
  setPageSize(size: number): void { this.pageSize.set(size); this.page.set(1); }

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
