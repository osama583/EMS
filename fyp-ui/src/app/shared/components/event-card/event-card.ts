import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PublishedEvent, RegistrationStatus } from '../../../core/events/published-event.models';

@Component({
  selector: 'app-event-card',
  template: `
    <article class="explore-card">
      <img [src]="event().eventImage.url" [alt]="event().eventTitle" loading="lazy" />
      <span class="explore-card__shade" aria-hidden="true"></span>

      <button
        type="button"
        class="save-event"
        [class.save-event--saved]="saved()"
        [attr.aria-pressed]="saved()"
        [attr.aria-label]="(saved() ? 'Remove ' : 'Save ') + event().eventTitle"
        (click)="favourite.emit(event().id)"
      >
        <span aria-hidden="true">{{ saved() ? '♥' : '♡' }}</span>
      </button>

      <div class="explore-card__content">
        <h3>{{ event().eventTitle }}</h3>
        <span class="explore-card__category">{{ event().categories.join(' / ') }}</span>
        <dl class="explore-card__details">
          <div><dt>Date</dt><dd><time [attr.datetime]="schedule().date">{{ displayDate() }}</time></dd></div>
          <div><dt>Time</dt><dd>{{ displayTime() }}</dd></div>
          <div><dt>Venue</dt><dd>{{ schedule().location || 'To be confirmed' }}</dd></div>
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
  readonly event = input.required<PublishedEvent>();
  readonly saved = input(false);
  readonly registrationStatus = input<RegistrationStatus | null>(null);
  readonly registering = input(false);
  readonly showRegister = input(true);
  readonly favourite = output<string>();
  readonly explore = output<PublishedEvent>();
  readonly register = output<string>();

  readonly schedule = computed(() => this.event().schedule[0]);
  readonly displayDate = computed(() => {
    const value = this.schedule().date;
    if (!value) return 'To be confirmed';
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat('en-MY', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  });
  readonly displayTime = computed(() => {
    const schedule = this.schedule();
    return schedule ? `${this.formatTime(schedule.start)} - ${this.formatTime(schedule.end)}` : 'To be confirmed';
  });
  readonly statusLabel = computed(() => this.registrationStatus() === 'confirmed' ? 'Registered' : this.registrationStatus());

  private formatTime(value: string): string {
    const [hours = '0', minutes = '00'] = value.split(':');
    const hour = Number(hours);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${minutes} ${suffix}`;
  }
}
