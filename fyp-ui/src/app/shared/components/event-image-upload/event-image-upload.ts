import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { EventImageUploadApi, MockEventImageUploadService } from '../../../core/events/event-image-upload.service';
import { EventImageAsset } from '../../../core/events/published-event.models';
import { ValidationMessageComponent } from '../validation-message/validation-message';

@Component({
  selector: 'app-event-image-upload',
  imports: [ValidationMessageComponent],
  providers: [{ provide: EventImageUploadApi, useExisting: MockEventImageUploadService }],
  template: `
    <section class="event-image-upload" [class.event-image-upload--invalid]="!!error()" aria-labelledby="event-image-label">
      <header>
        <div>
          <h4 id="event-image-label">Event Image</h4>
          <p>PNG, JPG or WebP · Maximum {{ maxFileSizeMb }} MB</p>
        </div>
        @if (value()) {
          <button type="button" class="event-image-upload__remove" (click)="remove()">
            <span class="material-symbols-rounded" aria-hidden="true">delete</span>
            Remove
          </button>
        }
      </header>

      <input
        #fileInput
        class="visually-hidden"
        id="event-image-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        (change)="selectFile($event)"
      />

      @if (value(); as image) {
        <div class="event-image-upload__preview">
          <img [src]="image.url" alt="Selected event image preview" />
          <div class="event-image-upload__preview-copy">
            <strong>{{ image.fileName }}</strong>
            <span>{{ readableSize(image.sizeBytes) }}</span>
            <button type="button" class="table-control" [disabled]="uploading()" (click)="chooseFile()">
              <span class="material-symbols-rounded" aria-hidden="true">replace_image</span>
              Replace image
            </button>
          </div>
        </div>
      } @else {
        <button type="button" class="event-image-upload__dropzone" [disabled]="uploading()" (click)="chooseFile()">
          <span class="material-symbols-rounded event-image-upload__icon" aria-hidden="true">add_photo_alternate</span>
          <strong>{{ uploading() ? 'Preparing image…' : 'Choose an event image' }}</strong>
          <span>Select a clear landscape image from your device</span>
        </button>
      }

      @if (error()) {
        <app-validation-message controlId="event-image-file" [message]="error()" />
      }
    </section>
  `,
  styleUrl: './event-image-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventImageUploadComponent {
  private readonly uploadApi = inject(EventImageUploadApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  readonly value = input<EventImageAsset | null>(null);
  readonly valueChange = output<EventImageAsset | null>();
  readonly error = signal('');
  readonly uploading = signal(false);
  readonly maxFileSizeMb = 5;
  private readonly allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

  chooseFile(): void { this.fileInput()?.nativeElement.click(); }

  selectFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!this.allowedTypes.has(file.type)) {
      this.error.set('Event Image must be a PNG, JPG, or WebP file.');
      return;
    }
    if (file.size > this.maxFileSizeMb * 1024 * 1024) {
      this.error.set(`Event Image must be ${this.maxFileSizeMb} MB or smaller.`);
      return;
    }
    this.error.set('');
    this.uploading.set(true);
    this.uploadApi.upload({ file }).subscribe({
      next: ({ image }) => this.valueChange.emit(image),
      error: () => {
        this.uploading.set(false);
        this.error.set('Event Image could not be prepared. Please try another file.');
      },
      complete: () => this.uploading.set(false),
    });
  }

  remove(): void {
    this.error.set('');
    this.valueChange.emit(null);
  }

  readableSize(bytes: number): string {
    if (!bytes) return 'Stored event image';
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

