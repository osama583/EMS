import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { EventRegistration, PublishedEvent, RegistrationResult } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi } from '../../../core/events/payment-proof-upload.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';
import { ValidationMessageComponent } from '../validation-message/validation-message';

@Component({
  selector: 'app-event-details-modal',
  imports: [FormModalComponent, FormFieldComponent, ValidationMessageComponent],
  providers: [{ provide: PaymentProofUploadApi, useFactory: () => inject(PAYMENT_PROOF_UPLOAD_API) }],
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
            @if (isPaidEvent(item)) {
              <section class="event-details__payment" aria-labelledby="event-payment-title">
                <h3 id="event-payment-title">Payment Required</h3>
                <dl>
                  <div><dt>Cost</dt><dd>RM {{ item.cost!.toFixed(2) }}</dd></div>
                  @if (item.bankAccountName) { <div><dt>Account Name</dt><dd>{{ item.bankAccountName }}</dd></div> }
                  @if (item.bankAccountNumber) { <div><dt>Account Number</dt><dd>{{ item.bankAccountNumber }}</dd></div> }
                </dl>
                <p>Transfer the amount above, then upload your payment proof. The organizer will review it before confirming your registration.</p>

                <input
                  #paymentProofInput
                  class="visually-hidden"
                  id="event-payment-proof-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  (change)="selectPaymentProof($event)"
                />

                @if (paymentProof(); as proof) {
                  <div class="event-details__payment-proof">
                    <span class="material-symbols-rounded" aria-hidden="true">description</span>
                    <strong>{{ proof.fileName }}</strong>
                    <button type="button" class="table-control" [disabled]="uploadingProof()" (click)="choosePaymentProof()">Replace</button>
                  </div>
                } @else {
                  <button type="button" class="table-control" [disabled]="uploadingProof()" (click)="choosePaymentProof()">
                    <span class="material-symbols-rounded" aria-hidden="true">upload_file</span>
                    {{ uploadingProof() ? 'Preparing file…' : 'Upload payment proof' }}
                  </button>
                }

                @if (paymentProofError()) {
                  <app-validation-message controlId="event-payment-proof-file" [message]="paymentProofError()" />
                }
              </section>
            }

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
  private readonly paymentProofUploadApi = inject(PaymentProofUploadApi);

  readonly open = input(false);
  readonly event = input<PublishedEvent | null>(null);
  readonly close = output<void>();
  // Fires after a successful (non-network-error) registration attempt — the caller decides what
  // to do with a rejected/duplicate result (RegistrationResult.status), typically closing the
  // modal and/or showing a toast on success, an error toast on rejection.
  readonly registered = output<RegistrationResult>();

  readonly email = signal('');
  readonly emailError = signal('');
  readonly message = signal('');
  readonly imagePreviewOpen = signal(false);
  readonly resultTone = signal<'success' | 'error'>('success');
  readonly registering = signal(false);
  readonly emailValid = () => /^\S+@\S+\.\S+$/.test(this.email().trim());
  private readonly myRegistrationStatus = signal<EventRegistration['status'] | null>(null);
  readonly alreadyRegistered = computed(() => {
    const status = this.myRegistrationStatus();
    return status === 'confirmed' || status === 'pending' ? status : null;
  });
  private readonly imageTrigger = viewChild<ElementRef<HTMLButtonElement>>('imageTrigger');
  private readonly imagePreview = viewChild<ElementRef<HTMLElement>>('imagePreview');
  private readonly paymentProofInput = viewChild<ElementRef<HTMLInputElement>>('paymentProofInput');

  readonly paymentProof = signal<{ url: string; fileName: string } | null>(null);
  readonly uploadingProof = signal(false);
  readonly paymentProofError = signal('');
  readonly maxProofFileSizeMb = 5;
  private readonly allowedProofTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

  isPaidEvent(item: PublishedEvent): boolean {
    return item.cost != null && item.cost > 0;
  }

  constructor() {
    effect(() => {
      if (this.open()) {
        this.email.set(this.auth.user()?.email ?? '');
        this.emailError.set('');
        this.message.set('');
        this.paymentProof.set(null);
        this.paymentProofError.set('');
        this.loadMyRegistration();
      } else {
        this.imagePreviewOpen.set(false);
      }
    });
  }

  choosePaymentProof(): void { this.paymentProofInput()?.nativeElement.click(); }

  selectPaymentProof(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.allowedProofTypes.has(file.type)) {
      this.paymentProofError.set('Payment proof must be a PNG, JPG, WebP, or PDF file.');
      return;
    }
    if (file.size > this.maxProofFileSizeMb * 1024 * 1024) {
      this.paymentProofError.set(`Payment proof must be ${this.maxProofFileSizeMb} MB or smaller.`);
      return;
    }
    this.paymentProofError.set('');
    this.uploadingProof.set(true);
    this.paymentProofUploadApi.upload({ file }).subscribe({
      next: (proof) => { this.paymentProof.set(proof); this.uploadingProof.set(false); },
      error: () => {
        this.uploadingProof.set(false);
        this.paymentProofError.set('Payment proof could not be prepared. Please try another file.');
      },
    });
  }

  private loadMyRegistration(): void {
    const item = this.event();
    const userEmail = this.auth.user()?.email;
    this.myRegistrationStatus.set(null);
    if (!item || !userEmail) return;
    this.service.getMyRegistration(item.id, userEmail).subscribe({
      next: (registration) => this.myRegistrationStatus.set(registration?.status ?? null),
      error: () => this.myRegistrationStatus.set(null),
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

    if (this.isPaidEvent(item) && !this.paymentProof()) {
      this.paymentProofError.set('Upload your payment proof before registering.');
      return;
    }

    this.registering.set(true);
    this.service.registerForEvent(item.id, this.email(), this.paymentProof() ?? undefined).subscribe({
      next: (result) => {
        this.registering.set(false);
        this.message.set(result.message);
        this.resultTone.set(result.status === 'rejected' || result.status === 'duplicate' ? 'error' : 'success');
        this.loadMyRegistration();
        this.registered.emit(result);
      },
      error: () => {
        this.registering.set(false);
        this.message.set('Registration could not be completed.');
        this.resultTone.set('error');
      },
    });
  }
}
