import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnDestroy, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { EVENT_IMAGE_UPLOAD_API, EventImageUploadApi } from '../../../core/events/event-image-upload.service';
import { EventImageAsset } from '../../../core/events/published-event.models';
import { ValidationMessageComponent } from '../validation-message/validation-message';

// Delivery proof must be a photo taken right now of the actual order, not any
// image already sitting in the device's gallery - a plain <input type="file">
// (even with capture="environment") only *suggests* the camera on some mobile
// browsers and falls back to a full file picker everywhere else (all
// desktops). Talking to getUserMedia directly and rendering the live stream
// in-page is the only way to force "camera, not picker" consistently.
@Component({
  selector: 'app-camera-capture',
  imports: [ValidationMessageComponent],
  providers: [{ provide: EventImageUploadApi, useFactory: () => inject(EVENT_IMAGE_UPLOAD_API) }],
  template: `
    <section class="camera-capture" [class.camera-capture--invalid]="!!error()" aria-labelledby="camera-capture-label">
      <header>
        <div>
          <h4 id="camera-capture-label">{{ label() }}</h4>
          <p>Taken with your camera · Maximum {{ maxFileSizeMb }} MB</p>
        </div>
        @if (value()) {
          <button type="button" class="camera-capture__remove" (click)="retake()">
            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
            Remove
          </button>
        }
      </header>

      @if (value(); as image) {
        <div class="camera-capture__preview">
          <img [src]="image.url" alt="Captured photo preview" />
          <div class="camera-capture__preview-copy">
            <strong>{{ image.fileName }}</strong>
            <span>{{ readableSize(image.sizeBytes) }}</span>
            <button type="button" class="table-control" [disabled]="uploading()" (click)="retake()">
              <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span>
              Retake photo
            </button>
          </div>
        </div>
      } @else if (streaming()) {
        <div class="camera-capture__live">
          <video #video autoplay playsinline muted></video>
          <button type="button" class="camera-capture__shutter" [disabled]="uploading()" (click)="capture()" aria-label="Take photo">
            <span class="material-symbols-rounded" aria-hidden="true">{{ uploading() ? 'hourglass_top' : 'photo_camera' }}</span>
          </button>
        </div>
      } @else {
        <button type="button" class="camera-capture__dropzone" [disabled]="starting()" (click)="startCamera()">
          <span class="material-symbols-rounded camera-capture__icon" aria-hidden="true">photo_camera</span>
          <strong>{{ starting() ? 'Opening camera…' : 'Open camera' }}</strong>
          <span>Take a photo directly - uploading from your gallery isn't allowed here</span>
        </button>
      }

      <canvas #canvas class="visually-hidden"></canvas>

      @if (error()) {
        <app-validation-message controlId="camera-capture" [message]="error()" />
      }
    </section>
  `,
  styleUrl: './camera-capture.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraCaptureComponent implements OnDestroy {
  private readonly uploadApi = inject(EventImageUploadApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly canvasEl = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  readonly value = input<EventImageAsset | null>(null);
  readonly label = input('Order Image');
  readonly valueChange = output<EventImageAsset | null>();

  readonly starting = signal(false);
  readonly streaming = signal(false);
  readonly uploading = signal(false);
  readonly error = signal('');
  readonly maxFileSizeMb = 5;

  private stream: MediaStream | null = null;

  constructor() {
    // The <video> element only exists in the DOM once streaming() flips true
    // (it's behind the @if), so the stream can only be attached to it on the
    // next render - an effect re-runs precisely when the viewChild resolves.
    effect(() => {
      const video = this.videoEl();
      if (video && this.stream) video.nativeElement.srcObject = this.stream;
    });
    this.destroyRef.onDestroy(() => this.stopStream());
  }

  ngOnDestroy(): void {
    this.stopStream();
  }

  async startCamera(): Promise<void> {
    this.error.set('');
    this.starting.set(true);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      this.streaming.set(true);
    } catch {
      this.error.set('Could not access the camera. Please allow camera access and try again.');
    } finally {
      this.starting.set(false);
    }
  }

  capture(): void {
    const video = this.videoEl()?.nativeElement;
    const canvas = this.canvasEl()?.nativeElement;
    if (!video || !canvas || this.uploading()) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    this.uploading.set(true);
    canvas.toBlob((blob) => {
      if (!blob) {
        this.uploading.set(false);
        this.error.set('The photo could not be captured. Please try again.');
        return;
      }
      if (blob.size > this.maxFileSizeMb * 1024 * 1024) {
        this.uploading.set(false);
        this.error.set(`${this.label()} must be ${this.maxFileSizeMb} MB or smaller.`);
        return;
      }
      const file = new File([blob], `order-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      this.uploadApi.upload({ file }).subscribe({
        next: ({ image }) => {
          this.uploading.set(false);
          this.stopStream();
          this.valueChange.emit(image);
        },
        error: () => {
          this.uploading.set(false);
          this.error.set(`${this.label()} could not be uploaded. Please try again.`);
        },
      });
    }, 'image/jpeg', 0.92);
  }

  retake(): void {
    this.error.set('');
    this.valueChange.emit(null);
    this.startCamera();
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.streaming.set(false);
  }

  readableSize(bytes: number): string {
    if (!bytes) return 'Stored photo';
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
