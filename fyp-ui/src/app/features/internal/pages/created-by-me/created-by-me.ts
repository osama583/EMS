import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { EventRegistration, PublishedEvent } from '../../../../core/events/published-event.models';
import { PublishedEventService } from '../../../../core/events/published-event.service';
import { FormModalComponent } from '../../../../shared/components/form-modal/form-modal';
import { InternalPageStateComponent } from '../../../../shared/components/internal-data-page/internal-data-page-parts';
import { EVENT_IMAGE_PLACEHOLDER } from '../../../../shared/event-image-placeholder';

// A registered attendee, or one still awaiting the organiser's decision (manual-approval events).
// 'cancelled' registrations exist in the data but are deliberately left out of the info panel —
// they never counted toward capacity and add nothing an organiser needs to act on or report on.
const VISIBLE_STATUSES: readonly EventRegistration['status'][] = ['confirmed', 'pending', 'rejected'];

@Component({
  selector: 'app-created-by-me',
  imports: [FormModalComponent, InternalPageStateComponent],
  templateUrl: './created-by-me.html',
  styleUrl: './created-by-me.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreatedByMeComponent {
  readonly placeholder = EVENT_IMAGE_PLACEHOLDER;
  private readonly events = inject(PublishedEventService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly items = signal<readonly PublishedEvent[]>([]);

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
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.events.getMyOrganizedEvents().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => { this.items.set(response.items); this.loading.set(false); },
      error: () => { this.error.set('Your events could not be loaded.'); this.loading.set(false); },
    });
  }

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
}
