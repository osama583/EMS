import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormControlType, SelectOption } from './form-controls.models';
import { ValidationMessageComponent } from '../validation-message/validation-message';
import { CharacterCounterComponent } from '../character-counter/character-counter';

@Component({
  selector: 'app-form-field',
  imports: [ValidationMessageComponent, CharacterCounterComponent],
  template: `
    <label class="shared-form-field" [class.shared-form-field--invalid]="displayError()" [class.shared-form-field--filled]="value() !== ''" (focusout)="markBlurred($event)">
      <span class="shared-form-field__label">
        {{ label() }}
        @if (required() && showRequiredIndicator()) { <span aria-hidden="true">*</span> }
      </span>
      @if (type() === 'textarea') {
        <textarea
          [id]="controlId()"
          [name]="name()"
          [placeholder]="placeholder()"
          [value]="value()"
          [rows]="rows()"
          [attr.maxlength]="characterLimit()"
          [required]="required()"
          [readOnly]="readOnly()"
          [disabled]="disabled()"
          [attr.aria-invalid]="displayError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (input)="emitValue($event)"
        ></textarea>
      } @else if (options().length) {
        <select
          [id]="controlId()"
          [name]="name()"
          [value]="value()"
          [required]="required()"
          [disabled]="disabled() || readOnly()"
          [attr.aria-invalid]="displayError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (change)="emitValue($event)"
        >
          <option value="">{{ placeholder() || 'Select an option' }}</option>
          @for (option of options(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
      } @else {
        <span class="shared-form-field__input-wrap" [class.shared-form-field__input-wrap--password]="type() === 'password'">
          <input
            [id]="controlId()"
            [name]="name()"
            [type]="effectiveInputType()"
            [placeholder]="placeholder()"
            [value]="value()"
            [required]="required()"
            [readOnly]="readOnly()"
            [disabled]="disabled()"
            [min]="min()"
            [step]="step()"
            [attr.maxlength]="characterLimit()"
            [attr.autocomplete]="autocomplete() || null"
            [attr.inputmode]="inputmode() || null"
            [attr.aria-invalid]="displayError() ? 'true' : null"
            [attr.aria-describedby]="describedBy()"
            (input)="emitValue($event)"
          />
          @if (type() === 'password') {
            <button type="button" class="shared-form-field__password-toggle" [attr.aria-label]="passwordVisible() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="passwordVisible()" (click)="$event.preventDefault(); $event.stopPropagation(); passwordVisible.update((visible) => !visible)">
              <span class="material-symbols-rounded" aria-hidden="true">{{ passwordVisible() ? 'visibility_off' : 'visibility' }}</span>
            </button>
          }
        </span>
      }
      @if (hasCharacterLimit()) { <app-character-counter [value]="value()" [maxLength]="maxLength()" /> }
      @if (hint() && !displayError()) { <small [id]="controlId() + '-hint'">{{ hint() }}</small> }
      <app-validation-message [controlId]="controlId()" [message]="displayError()" />
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent {
  readonly controlId = input.required<string>();
  readonly name = input('');
  readonly label = input.required<string>();
  readonly value = input<string | number>('');
  readonly type = input<FormControlType>('text');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly error = input('');
  readonly required = input(false);
  readonly showRequiredIndicator = input(true);
  readonly validateOnBlur = input(true);
  readonly readOnly = input(false);
  readonly disabled = input(false);
  readonly rows = input(4);
  readonly min = input<number | string>('');
  readonly step = input<number | string>('');
  readonly maxLength = input(100);
  readonly autocomplete = input('');
  readonly inputmode = input('');
  readonly options = input<readonly SelectOption[]>([]);
  readonly valueChange = output<string>();
  private readonly touched = signal(false);
  private readonly submitted = signal(false);
  private readonly resetForSession = signal(false);
  readonly passwordVisible = signal(false);
  readonly displayError = computed(() => {
    if (this.error() && !this.resetForSession()) return this.error();
    const shouldValidate = this.submitted() || (this.validateOnBlur() && this.touched());
    if (!shouldValidate) return '';
    if (this.error()) return this.error();
    const value = String(this.value() ?? '').trim();
    if (this.required() && !value) return `${this.label()} is required.`;
    if (this.type() === 'email' && value && !/^\S+@\S+\.\S+$/.test(value)) return `${this.label()} must be a valid email address.`;
    return '';
  });
  hasCharacterLimit(): boolean { return !this.readOnly() && this.options().length === 0 && (this.type() === 'text' || this.type() === 'email' || this.type() === 'textarea'); }
  characterLimit(): number | null { return this.hasCharacterLimit() ? this.maxLength() : null; }
  effectiveInputType(): FormControlType { return this.type() === 'password' && this.passwordVisible() ? 'text' : this.type(); }

  describedBy(): string | null {
    if (this.displayError()) return `${this.controlId()}-error`;
    if (this.hint()) return `${this.controlId()}-hint`;
    return null;
  }

  emitValue(event: Event): void {
    const raw = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    this.valueChange.emit(this.hasCharacterLimit() ? raw.slice(0, this.maxLength()) : raw);
  }
  markBlurred(event: FocusEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
      this.touched.set(true);
      this.resetForSession.set(false);
    }
  }

  resetInteractionState(): void {
    this.touched.set(false);
    this.submitted.set(false);
    this.resetForSession.set(true);
  }

  markSubmitted(): void { this.submitted.set(true); this.resetForSession.set(false); }
}
