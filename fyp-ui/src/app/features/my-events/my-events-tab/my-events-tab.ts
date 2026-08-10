import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { PublishedEvent, RegistrationStatus } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { EventCardComponent } from '../../../shared/components/event-card/event-card';
import { EventDetailsModalComponent } from '../../../shared/components/event-details-modal/event-details-modal';
import { InternalPageStateComponent } from '../../../shared/components/internal-data-page/internal-data-page-parts';

export type MyEventsTabMode = 'saved' | 'registered' | 'history';

interface TabEntry {
  readonly event: PublishedEvent;
  readonly status: RegistrationStatus | null;
}

@Component({
  selector: 'app-my-events-tab',
  imports: [EventCardComponent, EventDetailsModalComponent, InternalPageStateComponent],
  templateUrl: './my-events-tab.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyEventsTabComponent {
  private readonly auth = inject(AuthService);
  private readonly savedEvents = inject(SavedEventsService);
  private readonly eventService = inject(PublishedEventService);

  readonly mode = input.required<MyEventsTabMode>();

  readonly loading = signal(true);
  readonly error = signal('');
  readonly entries = signal<readonly TabEntry[]>([]);
  readonly selectedEvent = signal<PublishedEvent | null>(null);
  readonly registeringEventId = signal<string | null>(null);

  readonly emptyIcon = computed(() => this.mode() === 'saved' ? 'favorite' : this.mode() === 'registered' ? 'event_available' : 'history');
  readonly emptyTitle = computed(() => this.mode() === 'saved' ? 'No saved events yet' : this.mode() === 'registered' ? 'No active registrations' : 'No past events yet');
  readonly emptyDescription = computed(() => this.mode() === 'saved'
    ? 'Use the heart on any event card to keep it here.'
    : this.mode() === 'registered'
      ? 'Register for an event to see it appear here.'
      : 'Events you attended will appear here once they end.');

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
          return forkJoin(
            response.items.map((item) =>
              this.eventService.getMyRegistration(item.id, user.email).pipe(
                map((registration): TabEntry => ({ event: item, status: registration?.status ?? null })),
              ),
            ),
          ).pipe(map((entries) => entries.filter((entry) => entry.status !== 'confirmed')));
        }))
      : this.mode() === 'registered'
        ? this.eventService.getActiveRegistrations(user.email).pipe(map((response): readonly TabEntry[] =>
            response.items
              .filter((item) => item.status === 'confirmed')
              .map((item) => ({ event: item.event, status: item.status }))))
        : this.eventService.getRegistrationHistory(user.email).pipe(map((response): readonly TabEntry[] =>
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

  isSaved(eventId: string): boolean { return this.savedEvents.isSaved(eventId); }

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
    this.registeringEventId.set(eventId);
    this.eventService.registerForEvent(eventId, user.email).subscribe({
      next: () => { this.registeringEventId.set(null); this.load(); },
      error: () => this.registeringEventId.set(null),
    });
  }
}
