import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { PublishedEvent, RegistrationResult, RegistrationStatus } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { EventCardComponent } from '../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../shared/components/event-details-modal/event-details-modal';
import { InternalPageHeaderComponent, InternalPageStateComponent } from '../../../shared/components/internal-data-page/internal-data-page-parts';
import { InternalPageHeaderConfig } from '../../../shared/components/internal-data-page/internal-data-page.models';
import { ToastService } from '../../../shared/components/toast/toast.service';

export type MyEventsTabMode = 'saved' | 'pending' | 'registered' | 'history';

interface TabEntry {
  readonly event: PublishedEvent;
  readonly status: RegistrationStatus | null;
}

@Component({
  selector: 'app-my-events-tab',
  imports: [EventCardComponent, EventDetailsModalComponent, InternalPageHeaderComponent, InternalPageStateComponent],
  templateUrl: './my-events-tab.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyEventsTabComponent {
  private readonly auth = inject(AuthService);
  // Public: the template reads savedEvents.savedEventIds() directly (a signal owned by this
  // injected service) rather than through a wrapping isSaved(id) method call — zoneless change
  // detection does not reliably re-check a template after a signal write from a service the
  // component only reaches through a method, since the method call itself isn't a tracked
  // dependency the way a direct signal read in the template is.
  readonly savedEvents = inject(SavedEventsService);
  private readonly eventService = inject(PublishedEventService);
  private readonly toast = inject(ToastService);

  readonly mode = input.required<MyEventsTabMode>();
  // MyEventsComponent's own shell already renders an "My Events" <h1> above this tab's outlet
  // (saved/registered), so this only draws its own header when embedded directly in a bucket
  // (Ongoing/History) route that has no page header of its own — see app.routes.ts's
  // ongoing/events entry, the only place this is set true.
  readonly showHeader = input(false);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly entries = signal<readonly TabEntry[]>([]);
  readonly selectedEvent = signal<PublishedEvent | null>(null);
  readonly registeringEventId = signal<string | null>(null);

  readonly headerConfig = computed<InternalPageHeaderConfig>(() => ({
    title: 'Events',
    description: 'Events you have registered for, awaiting the organiser’s decision.',
    countLabel: `${this.entries().length} pending`,
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
    effect(() => { this.mode(); this.load(); });
  }

  private load(): void {
    const user = this.auth.user();
    if (!user) { this.loading.set(false); return; }
    this.loading.set(true);
    this.error.set('');

    const request = this.mode() === 'saved'
      ? this.savedEvents.getSavedEvents(user.email).pipe(switchMap((response) => {
          if (response.items.length === 0) return of<readonly TabEntry[]>([]);
          return this.eventService.getRegistrationStatuses(response.items.map((item) => item.id)).pipe(
            map((statuses) => response.items.map((item): TabEntry => ({ event: item, status: statuses.get(item.id) ?? null }))),
            map((entries) => entries.filter((entry) => entry.status !== 'confirmed')),
          );
        }))
      : this.mode() === 'pending'
        ? this.eventService.getPendingApprovalRegistrations().pipe(map((response): readonly TabEntry[] =>
            response.items.map((item) => ({ event: item.event, status: item.status }))))
      : this.mode() === 'registered'
        ? this.eventService.getActiveRegistrations().pipe(map((response): readonly TabEntry[] =>
            response.items
              .filter((item) => item.status === 'confirmed')
              .map((item) => ({ event: item.event, status: item.status }))))
        : this.eventService.getRegistrationHistory().pipe(map((response): readonly TabEntry[] =>
            response.items.map((item) => ({ event: item.event, status: item.status }))));

    request.subscribe({
      next: (entries) => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('These events could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  toggleSaved(eventId: string): void {
    const user = this.auth.user();
    if (!user) return;
    const operation = this.savedEvents.isSaved(eventId)
      ? this.savedEvents.removeSavedEvent(user.email, eventId)
      : this.savedEvents.saveEvent(user.email, eventId);
    operation.subscribe(() => { if (this.mode() === 'saved') this.load(); });
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
        this.load();
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
    this.load();
    if (result.status === 'rejected' || result.status === 'duplicate') {
      this.toast.error('Registration not completed', result.message);
    } else {
      this.toast.success(`You're registered for ${eventTitle}`, result.status === 'pending' ? 'Your registration is pending approval.' : undefined);
    }
  }
}
