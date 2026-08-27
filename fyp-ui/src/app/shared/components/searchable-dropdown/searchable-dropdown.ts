import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { SelectOption } from '../form-controls/form-controls.models';
import { ValidationMessageComponent } from '../validation-message/validation-message';

@Component({
  selector: 'app-searchable-dropdown',
  imports: [ValidationMessageComponent],
  template: `
    <div class="searchable-dropdown" [attr.id]="controlId() || null" [class.is-open]="open()" [class.is-invalid]="displayError()" [class.is-disabled]="disabled() || loading()" (focusout)="markBlurred($event)">
      @if (label()) { <span class="form-label">{{ label() }} @if (required()) { <b>*</b> }</span> }
      <button type="button" class="dropdown-trigger" [disabled]="disabled() || readOnly() || loading()" [attr.aria-expanded]="open()" [attr.aria-invalid]="displayError() ? 'true' : null" [attr.aria-describedby]="displayError() ? controlId() + '-error' : null" (click)="toggle()">
        <span class="display-container">
          @if (loading()) { <span class="placeholder">Loading…</span> }
          @else if (selectedOptions().length) {
            @if (isMulti()) { <span class="chips-container">@for (option of selectedOptions(); track option.value) { <span class="chip">{{ option.label }}<span role="button" tabindex="0" [attr.aria-label]="'Remove ' + option.label" (click)="remove(option.value, $event)">×</span></span> }</span> }
            @else { <span class="value-text">{{ selectedOptions()[0].label }}</span> }
          } @else { <span class="placeholder">{{ placeholder() }}</span> }
        </span>
        <span class="material-symbols-rounded" aria-hidden="true">{{ loading() ? 'progress_activity' : 'expand_more' }}</span>
      </button>
      @if (open()) {
        <section
          class="dropdown-panel" role="listbox" [attr.aria-multiselectable]="isMulti()"
          [class.dropdown-panel--floating]="panelPosition() !== null"
          [style.top.px]="panelPosition()?.top ?? null" [style.left.px]="panelPosition()?.left ?? null" [style.width.px]="panelPosition()?.width ?? null"
        >
          @if (searchable()) { <label class="search-container"><span class="material-symbols-rounded">search</span><input type="search" aria-label="Search options" placeholder="Search options" [value]="query()" (input)="setQuery($event)" /></label> }
          <div class="options-list">
            @for (option of filteredOptions(); track option.value) {
              <button type="button" role="option" [class.selected]="isSelected(option.value)" [attr.aria-selected]="isSelected(option.value)" (click)="select(option.value)"><span><strong>{{ option.label }}</strong>@if (option.description) { <small>{{ option.description }}</small> }</span>@if (isSelected(option.value)) { <span class="material-symbols-rounded">check</span> }</button>
            } @empty { <span class="no-results">{{ loading() ? 'Loading options…' : 'No options found' }}</span> }
          </div>
          @if (clearable() && selectedOptions().length) { <button type="button" class="clear-selection" (click)="clear()">Clear selection</button> }
        </section>
      }
      @if (hint() && !displayError()) { <small class="control-hint">{{ hint() }}</small> }
      <app-validation-message [controlId]="controlId()" [message]="displayError()" />
    </div>
  `,
  styleUrl: './searchable-dropdown.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchableDropdownComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly label = input(''); readonly required = input(false); readonly placeholder = input('Select an option'); readonly controlId = input('');
  readonly isMulti = input(false); readonly searchable = input(true); readonly maxSelections = input<number | null>(null);
  readonly loading = input(false); readonly disabled = input(false); readonly readOnly = input(false); readonly clearable = input(true); readonly errorLabel = input('');
  readonly hint = input(''); readonly error = input(''); readonly options = input.required<readonly SelectOption[]>();
  readonly value = input<string | readonly string[]>(''); readonly valueChange = output<string | readonly string[]>(); readonly searchChange = output<string>();
  readonly open = signal(false); readonly query = signal('');
  readonly touched = signal(false);
  private readonly submitted = signal(false);
  private readonly resetForSession = signal(false);
  // Floating-panel coordinates (viewport-relative), recomputed whenever the panel opens or the
  // page scrolls/resizes underneath it. Rendering the panel with position:fixed at these
  // coordinates — instead of position:absolute relative to this component — lets it escape any
  // ancestor's overflow:hidden/auto clipping (e.g. a scrollable modal body), which otherwise cuts
  // the options list off behind the modal footer. null until measured (first open, before the
  // panel exists in the DOM to measure against).
  readonly panelPosition = signal<{ top: number; left: number; width: number } | null>(null);
  readonly filteredOptions = computed(() => { const query = this.query().trim().toLowerCase(); return query ? this.options().filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(query)) : this.options(); });
  readonly selectedOptions = computed(() => { const values = Array.isArray(this.value()) ? this.value() as readonly string[] : [this.value() as string]; return this.options().filter((option) => values.includes(option.value)); });
  readonly displayError = computed(() => {
    if (this.error() && !this.resetForSession()) return this.error();
    const shouldValidate = this.touched() || this.submitted();
    if (!shouldValidate) return '';
    return this.error() || (this.required() && !this.selectedOptions().length ? `${this.errorLabel() || this.label() || 'This field'} is required.` : '');
  });
  @HostListener('document:pointerdown', ['$event']) closeOutside(event: Event): void { if (!this.host.nativeElement.contains(event.target as Node)) this.close(); }
  @HostListener('keydown', ['$event']) keyboard(event: KeyboardEvent): void { if (event.key === 'Escape') this.close(); if ((event.key === 'Enter' || event.key === ' ') && !this.open() && event.target === this.host.nativeElement) this.toggle(); }
  @HostListener('window:resize') onWindowResize(): void { if (this.open()) this.measurePanelPosition(); }

  constructor() {
    // Scroll events don't bubble, so a plain (bubbling) listener never sees a modal body or any
    // other ancestor scrolling underneath the trigger — capture-phase is required to catch those
    // and keep the floating panel's position in sync instead of drifting away from the trigger.
    // rAF-throttled: a scrollable modal body can fire dozens of scroll events per second, and
    // measuring+re-rendering the floating panel on every single one (rather than once per frame)
    // is what made the panel visibly judder/"shake" while scrolling underneath it.
    let scrollFrame: number | null = null;
    const onScroll = (event: Event) => {
      if (!this.open()) return;
      const panel = this.host.nativeElement.querySelector('.dropdown-panel');
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        this.measurePanelPosition();
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    });
  }

  toggle(): void {
    if (this.disabled() || this.readOnly() || this.loading()) return;
    this.open.update((value) => !value);
    if (this.open()) this.measurePanelPosition();
  }
  close(): void { this.open.set(false); this.query.set(''); this.panelPosition.set(null); }
  // Opens below the trigger by default, but flips above it when there isn't enough room left in
  // the viewport — otherwise a trigger near the bottom of a scrollable modal (e.g. "Page" in the
  // Add Permission dialog) renders its panel partly off-screen / overlapping the modal footer.
  private measurePanelPosition(): void {
    const trigger = this.host.nativeElement.querySelector('.dropdown-trigger');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panel = this.host.nativeElement.querySelector('.dropdown-panel') as HTMLElement | null;
    const estimatedHeight = panel?.offsetHeight || 280;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < estimatedHeight + gap && rect.top > spaceBelow;
    const top = openAbove
      ? Math.max(gap, rect.top - estimatedHeight - gap)
      : rect.bottom + gap;
    this.panelPosition.set({ top, left: rect.left, width: rect.width });
  }
  setQuery(event: Event): void { const value = (event.target as HTMLInputElement).value; this.query.set(value); this.searchChange.emit(value); }
  isSelected(value: string): boolean { return this.selectedOptions().some((option) => option.value === value); }
  select(value: string): void { if (this.isMulti()) { const current = Array.isArray(this.value()) ? [...this.value() as readonly string[]] : []; const next = current.includes(value) ? current.filter((item) => item !== value) : this.maxSelections() !== null && current.length >= this.maxSelections()! ? current : [...current, value]; this.valueChange.emit(next); } else { this.valueChange.emit(value); this.close(); } }
  remove(value: string, event: Event): void { event.stopPropagation(); const current = Array.isArray(this.value()) ? this.value() as readonly string[] : []; this.valueChange.emit(current.filter((item) => item !== value)); }
  clear(): void { this.valueChange.emit(this.isMulti() ? [] : ''); this.close(); }
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
    this.close();
  }
  markSubmitted(): void { this.submitted.set(true); this.resetForSession.set(false); }
}
