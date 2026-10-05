import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { EventRegistration, PublishedEvent, RegistrationResult } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { PAYMENT_PROOF_UPLOAD_API, PaymentProofUploadApi } from '../../../core/events/payment-proof-upload.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';
import { ValidationMessageComponent } from '../validation-message/validation-message';
import { EVENT_IMAGE_PLACEHOLDER } from '../../event-image-placeholder';

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
      [disabled]="!emailValid() || (!isLoggedIn() && !name().trim())"
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
            <img [src]="item.eventImage?.url || placeholder" [alt]="item.eventTitle" />
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
            <article class="event-details__summary-card">
              <span>Visibility</span>
              <strong>{{ item.eventVisibility }}</strong>
            </article>
          </div>

          <section class="event-details__introduction" aria-labelledby="event-introduction-title">
            <h3 id="event-introduction-title">Event Introduction</h3>
            <p>{{ item.shortIntroduction }}</p>
          </section>

          <!-- Field set matched to the master-calendar dialog (event-calendar.html), which
               was the richer of the two: organiser, school/department, visibility, cost,
               clubs and a multi-session note were all missing here. -->
          <dl>
            <div><dt>Date</dt><dd>{{ item.schedule[0]?.date }}</dd></div>
            <div><dt>Time</dt><dd>{{ item.schedule[0]?.start }} - {{ item.schedule[0]?.end }}</dd></div>
            <div><dt>Venue</dt><dd>{{ item.schedule[0]?.location || 'To be confirmed' }}</dd></div>
            @if (item.organiser) {
              <div><dt>Organiser</dt><dd>{{ item.organiser }}</dd></div>
            }
            @if (item.schoolDepartment) {
              <div><dt>School / department</dt><dd>{{ item.schoolDepartment }}</dd></div>
            }
            @if (item.eventFormat) {
              <div><dt>Format</dt><dd>{{ item.eventFormat }}</dd></div>
            }
            <div><dt>Expected attendance</dt><dd>{{ item.totalExpectedPax }}</dd></div>
            <div><dt>Cost</dt><dd>{{ costLabel(item) }}</dd></div>
            <div><dt>Registration</dt><dd>{{ registrationLabel(item) }}</dd></div>
            @if (item.clubs.length > 0) {
              <div><dt>{{ item.clubs.length === 1 ? 'Club' : 'Clubs' }}</dt><dd>{{ item.clubs.join(', ') }}</dd></div>
            }
            @if (item.schedule.length > 1) {
              <div><dt>Sessions</dt><dd>{{ item.schedule.length }} across this event</dd></div>
            }
          </dl>

          @if (alreadyRegistered(); as status) {
            <p class="event-details__message" role="status">
              You are already registered for this event.
              <strong>{{ status === 'confirmed' ? 'Registered' : 'Pending Approval' }}</strong>
            </p>
          } @else {
            @if (isPaidEvent(item)) {
              <section class="event-details__payment" aria-labelledby="event-payment-title">
                <header class="event-details__payment-head">
                  <span class="material-symbols-rounded" aria-hidden="true">payments</span>
                  <div>
                    <h3 id="event-payment-title">Payment Required</h3>
                    <p class="event-details__payment-subtitle">This event has a cost — your registration is confirmed only after the organizer reviews your proof of payment.</p>
                  </div>
                </header>
                <dl>
                  <div class="event-details__payment-cost"><dt>Cost</dt><dd>RM {{ item.cost!.toFixed(2) }}</dd></div>
                  @if (item.bankAccountName) { <div><dt>Account Name</dt><dd>{{ item.bankAccountName }}</dd></div> }
                  @if (item.bankAccountNumber) { <div><dt>Account Number</dt><dd>{{ item.bankAccountNumber }}</dd></div> }
                </dl>

                <input
                  #paymentProofInput
                  class="visually-hidden"
                  id="event-payment-proof-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  (change)="selectPaymentProof($event)"
                />

                <div class="event-details__payment-proof-field">
                  <span class="event-details__payment-proof-label">
                    Payment proof
                    <span class="event-details__payment-required" aria-hidden="true">*</span>
                    <span class="visually-hidden">required</span>
                  </span>
                  @if (paymentProof(); as proof) {
                    <div class="event-details__payment-proof event-details__payment-proof--attached">
                      <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
                      <strong>{{ proof.fileName }}</strong>
                      <button type="button" class="table-control" [disabled]="uploadingProof()" (click)="choosePaymentProof()">Replace</button>
                    </div>
                  } @else {
                    <button type="button" class="event-details__payment-upload" [class.event-details__payment-upload--invalid]="!!paymentProofError()" [disabled]="uploadingProof()" (click)="choosePaymentProof()">
                      <span class="material-symbols-rounded" aria-hidden="true">upload_file</span>
                      <span>
                        <strong>{{ uploadingProof() ? 'Preparing file…' : 'Upload payment proof' }}</strong>
                        <small>PNG, JPG, WebP or PDF · up to {{ maxProofFileSizeMb }} MB</small>
                      </span>
                    </button>
                  }
                  @if (paymentProofError()) {
                    <app-validation-message controlId="event-payment-proof-file" [message]="paymentProofError()" />
                  }
                </div>
              </section>
            }

            @if (!isLoggedIn()) {
              <app-form-field
                controlId="event-registration-name"
                label="Full Name"
                type="text"
                placeholder="Your name"
                [required]="true"
                [value]="name()"
                [error]="nameError()"
                (valueChange)="setName($event)"
              />
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

            @if (needsReason()) {
              <app-form-field
                controlId="event-registration-reason"
                label="Reason for attending"
                type="textarea"
                placeholder="Tell the organizer why you would like to attend"
                hint="The organizer approves each registration for this event."
                [required]="true"
                [maxLength]="reasonMaxLength"
                [value]="reason()"
                [error]="reasonError()"
                (valueChange)="setReason($event)"
              />
            }

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
          <img [src]="item.eventImage?.url || placeholder" [alt]="item.eventTitle" />
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
  /** Same wording as the master-calendar dialog, so an event reads identically in both places. */
  costLabel(item: PublishedEvent): string {
    return item.isFree || !item.cost ? 'Free' : `RM ${item.cost.toFixed(2)}`;
  }

  registrationLabel(item: PublishedEvent): string {
    const mode = item.registrationMode === 'Automatic' ? 'Open to all' : 'Approval required';
    if (item.maxPax === null) return mode;
    return `${mode} · ${item.confirmedRegistrationCount}/${item.maxPax} places filled`;
  }

  readonly placeholder = EVENT_IMAGE_PLACEHOLDER;
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
  // Only asked of an anonymous visitor — a signed-in caller registers under their own account
  // identity, same as before; see register()'s guest branch.
  readonly name = signal('');
  readonly nameError = signal('');
  readonly isLoggedIn = () => !!this.auth.user();
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
  // Events with registrationMode 'Manual' collect a short reason the organizer reads
  // in their Inbox before approving (system specification §6).
  readonly reasonMaxLength = 100;
  readonly reason = signal('');
  readonly reasonError = signal('');
  readonly needsReason = computed(() => this.event()?.registrationMode === 'Manual');
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
        this.name.set(this.auth.user()?.displayName ?? '');
        this.nameError.set('');
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
    this.myRegistrationStatus.set(null);
    if (!item || !this.auth.user()) return;
    this.service.getMyRegistration(item.id).subscribe({
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

  setName(value: string): void {
    this.name.set(value);
    if (this.name().trim()) this.nameError.set('');
  }

  setReason(value: string): void {
    this.reason.set(value.slice(0, this.reasonMaxLength));
    if (this.reason().trim()) this.reasonError.set('');
  }

  register(): void {
    const item = this.event();
    if (!item) return;

    if (!this.emailValid()) {
      this.emailError.set('Email must be a valid email address.');
      return;
    }

    if (!this.isLoggedIn() && !this.name().trim()) {
      this.nameError.set('Enter your name to register.');
      return;
    }

    if (this.needsReason() && !this.reason().trim()) {
      this.reasonError.set('Tell the organizer why you would like to attend.');
      return;
    }

    if (this.isPaidEvent(item) && !this.paymentProof()) {
      this.paymentProofError.set('Upload your payment proof before registering.');
      return;
    }

    this.registering.set(true);
    const guest = this.isLoggedIn() ? undefined : { name: this.name().trim(), email: this.email().trim() };
    this.service.registerForEvent(item.id, this.paymentProof() ?? undefined, this.reason().trim() || undefined, guest).subscribe({
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
