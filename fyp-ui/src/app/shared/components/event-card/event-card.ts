import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ProposalEventSchedule, PublishedEvent, RegistrationStatus } from '../../../core/events/published-event.models';
import { EVENT_IMAGE_PLACEHOLDER } from '../../event-image-placeholder';

@Component({
  selector: 'app-event-card',
  template: `
    <article class="explore-card">
      <img [src]="event().eventImage?.url || placeholder" [alt]="event().eventTitle" loading="lazy" />
      <span class="explore-card__shade" aria-hidden="true"></span>

      <button
        type="button"
        class="save-event"
        [class.save-event--saved]="displayedSaved()"
        [attr.aria-pressed]="displayedSaved()"
        [attr.aria-label]="(displayedSaved() ? 'Remove ' : 'Save ') + event().eventTitle"
        (click)="toggleFavourite()"
      >
        <span aria-hidden="true">{{ displayedSaved() ? '♥' : '♡' }}</span>
      </button>

      <div class="explore-card__content">
        <h3>{{ event().eventTitle }}</h3>
        <span class="explore-card__category">{{ event().categories.join(' / ') }}</span>
        <dl class="explore-card__details">
          <div><dt>Date</dt><dd><time [attr.datetime]="schedule()?.date">{{ displayDate() }}</time></dd></div>
          <div><dt>Time</dt><dd>{{ displayTime() }}</dd></div>
          <div><dt>Venue</dt><dd>{{ schedule()?.location || 'To be confirmed' }}</dd></div>
        </dl>
        <p class="explore-card__registered">{{ event().confirmedRegistrationCount }} registered</p>
        @if (registrationStatus(); as status) {
          <span class="explore-card__registration-status" [attr.data-status]="status">{{ statusLabel() }}</span>
        }
        <div class="explore-card__buttons">
          <button
            type="button"
            class="explore-card__action"
            [attr.aria-label]="'Explore ' + event().eventTitle"
            (click)="explore.emit(event())"
          >
            <span>Explore Event</span>
          </button>
        </div>
      </div>
    </article>
  `,
  styles: `
    :host { display: contents; }
    /* Self-contained so the toggle can never be lost to global-stylesheet ordering. */
    .save-event {
      position: absolute; z-index: 2; top: .85rem; right: .85rem;
      display: grid; place-items: center; width: 2.35rem; height: 2.35rem; padding: 0;
      border-radius: 50%; cursor: pointer; font-size: 1.25rem; line-height: 1;
      border: 1px solid rgb(255 255 255 / 43%) !important;
      background: rgb(2 18 38 / 42%) !important;
      color: #fff !important;
      transition: background .18s ease, border-color .18s ease, transform .18s ease;
    }
    .save-event:hover { transform: scale(1.08); }
    .save-event.save-event--saved {
      border-color: #2a83ff !important;
      background: #2a83ff !important;
      color: #fff !important;
    }
    .explore-card__registration-status { display: inline-flex; width: fit-content; margin-top: .65rem; padding: .2rem .58rem; border: 1px solid rgb(255 255 255 / 28%); border-radius: var(--radius-pill); background: rgb(255 255 255 / 12%); color: #fff; font-size: .72rem; font-weight: 700; text-transform: capitalize; backdrop-filter: blur(.35rem); }
    .explore-card__registration-status[data-status='confirmed'] { border-color: rgb(83 219 158 / 55%); background: rgb(20 132 89 / 52%); }
    .explore-card__registration-status[data-status='pending'] { border-color: rgb(255 198 74 / 58%); background: rgb(138 92 0 / 52%); }
    .explore-card__registration-status[data-status='rejected'] { border-color: rgb(255 128 144 / 55%); background: rgb(152 37 54 / 55%); }
    .explore-card__buttons { display: grid; gap: .5rem; margin-top: 1rem; }
    .explore-card__buttons .explore-card__action { margin-top: 0; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardComponent {
  readonly placeholder = EVENT_IMAGE_PLACEHOLDER;
  readonly event = input.required<PublishedEvent>();
  readonly saved = input(false);
  readonly registrationStatus = input<RegistrationStatus | null>(null);
  readonly registering = input(false);
  readonly showRegister = input(true);
  readonly favourite = output<string>();
  readonly explore = output<PublishedEvent>();
  readonly register = output<string>();

  // SavedEventsService already flips its signal optimistically on click and rolls it back if the
  // server rejects, so the card just mirrors it. A local override here would win permanently after
  // the first click and swallow that rollback.
  readonly displayedSaved = computed(() => this.saved());

  readonly schedule = computed(() => this.event().schedule[0] as ProposalEventSchedule | undefined);
  readonly displayDate = computed(() => {
    const value = this.schedule()?.date;
    if (!value) return 'To be confirmed';
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat('en-MY', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  });
  readonly displayTime = computed(() => {
    const schedule = this.schedule();
    return schedule ? `${this.formatTime(schedule.start)} - ${this.formatTime(schedule.end)}` : 'To be confirmed';
  });
  readonly statusLabel = computed(() => this.registrationStatus() === 'confirmed' ? 'Registered' : this.registrationStatus());

  toggleFavourite(): void {
    this.favourite.emit(this.event().id);
  }

  private formatTime(value: string): string {
    const [hours = '0', minutes = '00'] = value.split(':');
    const hour = Number(hours);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${minutes} ${suffix}`;
  }
}
