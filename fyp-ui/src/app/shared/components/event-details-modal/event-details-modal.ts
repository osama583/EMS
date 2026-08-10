import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { PublishedEvent } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';

@Component({
  selector: 'app-event-details-modal',
  imports: [FormModalComponent, FormFieldComponent],
  template: `
    <app-form-modal
      [open]="open()"
      [title]="event()?.eventTitle || 'Event details'"
      primaryLabel="Register"
      [loading]="registering()"
      [disabled]="!emailValid()"
      [hidePrimary]="!!alreadyRegistered()"
      (close)="close.emit()"
      (cancel)="close.emit()"
      (submit)="register()"
    >
      @if (event(); as item) {
        <article class="event-details">
          <button
            #imageTrigger
            type="button"
            class="event-details__image"
            [attr.aria-label]="'Open a larger preview of ' + item.eventTitle"
            (click)="openImagePreview()"
          >
            <img [src]="item.eventImage.url" [alt]="item.eventTitle" />
            <span class="event-details__image-overlay" aria-hidden="true">
              <span class="material-symbols-rounded">zoom_out_map</span>
              Expand image
            </span>
          </button>

          <div class="event-details__meta">
            <article class="event-details__summary-card">
              <span>Category</span>
              <strong>{{ item.categories.join(' / ') }}</strong>
            </article>
            <article class="event-details__summary-card event-details__summary-card--registration">
              <span>Registration</span>
              <strong>{{ item.confirmedRegistrationCount }} registered</strong>
            </article>
          </div>

          <section class="event-details__introduction" aria-labelledby="event-introduction-title">
            <h3 id="event-introduction-title">Event Introduction</h3>
            <p>{{ item.shortIntroduction }}</p>
          </section>

          <dl>
            <div><dt>Date</dt><dd>{{ item.schedule[0]?.date }}</dd></div>
            <div><dt>Time</dt><dd>{{ item.schedule[0]?.start }} - {{ item.schedule[0]?.end }}</dd></div>
            <div><dt>Venue</dt><dd>{{ item.schedule[0]?.location }}</dd></div>
            <div><dt>Format</dt><dd>{{ item.eventFormat }}</dd></div>
            <div><dt>Expected attendance</dt><dd>{{ item.totalExpectedPax }}</dd></div>
            <div><dt>Registration</dt><dd>{{ item.registrationMode }}</dd></div>
          </dl>

          @if (alreadyRegistered(); as status) {
            <p class="event-details__message" role="status">
              You are already registered for this event.
              <strong>{{ status === 'confirmed' ? 'Registered' : 'Pending Approval' }}</strong>
            </p>
          } @else {
            <app-form-field
              controlId="event-registration-email"
              label="Email"
              type="email"
              placeholder="name@example.com"
              [required]="true"
              [value]="email()"
              [error]="emailError()"
              (valueChange)="setEmail($event)"
            />

            @if (message()) {
              <p
                class="event-details__message"
                [class.event-details__message--error]="resultTone() === 'error'"
                role="status"
              >
                {{ message() }}
              </p>
            }
          }
        </article>
      }
    </app-form-modal>

    @if (imagePreviewOpen() && event(); as item) {
      <div
        #imagePreview
        class="event-image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="Event image preview"
        tabindex="-1"
        (click)="closeImagePreview()"
        (keydown.escape)="closeImagePreview($event)"
      >
        <figure (click)="$event.stopPropagation()">
          <img [src]="item.eventImage.url" [alt]="item.eventTitle" />
          <figcaption>{{ item.eventTitle }}</figcaption>
          <button type="button" aria-label="Close image preview" (click)="closeImagePreview()">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </figure>
      </div>
    }
  `,
  styleUrl: './event-details-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailsModalComponent {
  private readonly auth = inject(AuthService);
  private readonly service = inject(PublishedEventService);

  readonly open = input(false);
  readonly event = input<PublishedEvent | null>(null);
  readonly close = output<void>();

  readonly email = signal('');
  readonly emailError = signal('');
  readonly message = signal('');
  readonly imagePreviewOpen = signal(false);
  readonly resultTone = signal<'success' | 'error'>('success');
  readonly registering = signal(false);
  readonly emailValid = () => /^\S+@\S+\.\S+$/.test(this.email().trim());
  readonly alreadyRegistered = computed(() => {
    const item = this.event();
    const userEmail = this.auth.user()?.email;
    if (!item || !userEmail) return null;
    const status = this.service.registrationStatus(item.id, userEmail);
    return status === 'confirmed' || status === 'pending' ? status : null;
  });
  private readonly imageTrigger = viewChild<ElementRef<HTMLButtonElement>>('imageTrigger');
  private readonly imagePreview = viewChild<ElementRef<HTMLElement>>('imagePreview');

  constructor() {
    effect(() => {
      if (this.open()) {
        this.email.set(this.auth.user()?.email ?? '');
        this.emailError.set('');
        this.message.set('');
      } else {
        this.imagePreviewOpen.set(false);
      }
    });
  }

  openImagePreview(): void {
    this.imagePreviewOpen.set(true);
    queueMicrotask(() => this.imagePreview()?.nativeElement.focus({ preventScroll: true }));
  }

  closeImagePreview(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.imagePreviewOpen.set(false);
    queueMicrotask(() => this.imageTrigger()?.nativeElement.focus({ preventScroll: true }));
  }

  setEmail(value: string): void {
    this.email.set(value);
    if (this.emailValid()) this.emailError.set('');
  }

  register(): void {
    const item = this.event();
    if (!item) return;

    if (!this.emailValid()) {
      this.emailError.set('Email must be a valid email address.');
      return;
    }

    this.registering.set(true);
    this.service.registerForEvent(item.id, this.email()).subscribe({
      next: (result) => {
        this.registering.set(false);
        this.message.set(result.message);
        this.resultTone.set(result.status === 'rejected' || result.status === 'duplicate' ? 'error' : 'success');
      },
      error: () => {
        this.registering.set(false);
        this.message.set('Registration could not be completed.');
        this.resultTone.set('error');
      },
    });
  }
}
