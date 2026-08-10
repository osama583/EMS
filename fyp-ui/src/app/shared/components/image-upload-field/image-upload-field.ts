import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input, output } from '@angular/core';

@Component({
  selector: 'app-image-upload-field',
  standalone: true,
  template: `
    <div class="image-upload-field" [class.image-upload-field--error]="!!error()" [class.image-upload-field--disabled]="disabled()">
      @if (label()) {
        <div class="image-upload-field__heading">
          <label [for]="controlId()">{{ label() }}</label>
          @if (hint()) { <span>{{ hint() }}</span> }
        </div>
      }

      <div class="image-upload-field__body" [class.image-upload-field__body--has-preview]="!!imagePreview()">
        @if (imagePreview()) {
          <img class="image-upload-field__preview" [src]="imagePreview()" [alt]="imageFileName() || label() || 'Uploaded image preview'" />
        } @else {
          <div class="image-upload-field__placeholder" aria-hidden="true">
            <span class="material-symbols-rounded">add_photo_alternate</span>
          </div>
        }

        <div class="image-upload-field__details">
          <strong class="image-upload-field__filename">{{ imageFileName() || emptyMessage() }}</strong>
          <div class="image-upload-field__actions">
            <label class="image-upload-field__btn image-upload-field__btn--primary" [for]="controlId()">
              <span class="material-symbols-rounded" aria-hidden="true">{{ imagePreview() ? 'edit' : 'upload' }}</span>
              {{ imagePreview() ? 'Replace image' : 'Choose image' }}
            </label>
            @if (imagePreview()) {
              <button type="button" class="image-upload-field__btn image-upload-field__btn--danger" (click)="onRemove($event)">
                <span class="material-symbols-rounded" aria-hidden="true">delete</span>
                Remove
              </button>
            }
          </div>
        </div>

        <input
          #fileInput
          [id]="controlId()"
          type="file"
          [accept]="accept()"
          [disabled]="disabled()"
          (change)="onFileChange($event)"
        />
      </div>

      @if (error()) {
        <p class="image-upload-field__error" role="alert">
          <span class="material-symbols-rounded" aria-hidden="true">warning</span>
          {{ error() }}
        </p>
      }
    </div>
  `,
  styleUrl: './image-upload-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUploadFieldComponent {
  readonly controlId = input('image-upload');
  readonly label = input('Upload Image');
  readonly hint = input('PNG, JPG or WebP · maximum 5 MB');
  readonly emptyMessage = input('Add a picture for this item');
  readonly imagePreview = input<string | null>(null);
  readonly imageFileName = input<string | null>(null);
  readonly error = input('');
  readonly disabled = input(false);
  readonly accept = input('image/png,image/jpeg,image/webp');

  readonly fileSelect = output<File>();
  readonly remove = output<void>();

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  onFileChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (file) {
      this.fileSelect.emit(file);
    }
  }

  onRemove(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.fileInputRef?.nativeElement) {
      this.fileInputRef.nativeElement.value = '';
    }
    this.remove.emit();
  }
}
