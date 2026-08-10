import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnChanges, OnDestroy, SimpleChanges, contentChildren, inject, input, output } from '@angular/core';
import { FormFieldComponent } from '../form-controls/form-field';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';

let pageLockCount = 0;
let lockedScrollY = 0;
let bodyStyles = '';
let documentStyles = '';

@Component({
  selector: 'app-form-modal',
  template: `
    @if (open()) {
      <div class="shared-form-modal__backdrop" (click)="backdropClick()" (wheel)="preventBackdropScroll($event)" (touchmove)="preventBackdropScroll($event)">
        <section class="shared-form-modal" [class.shared-form-modal--fixed]="fixedSize()" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId()" (click)="$event.stopPropagation()">
          <header class="shared-form-modal__header">
            <h2 [id]="titleId()">{{ title() }}</h2>
            <button type="button" class="shared-form-modal__close" aria-label="Close dialog" (click)="close.emit()"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
          </header>
          <div class="shared-form-modal__body"><ng-content /></div>
          <footer class="shared-form-modal__footer">
            @if (showSecondary()) {
              <button type="button" class="table-control" [disabled]="loading()" (click)="cancel.emit()">{{ secondaryLabel() }}</button>
            }
            @if (!hidePrimary()) {
              <button type="button" class="table-control" [class.table-control--primary]="!danger()" [class.table-control--danger]="danger()" [class.shared-form-modal__primary--disabled]="disabled()" [disabled]="loading()" [attr.aria-disabled]="disabled() ? 'true' : null" (click)="submitAttempt()">
                @if (loading()) { <span class="material-symbols-rounded shared-form-modal__spin" aria-hidden="true">progress_activity</span> }
                {{ loading() ? loadingLabel() : primaryLabel() }}
              </button>
            }
          </footer>
        </section>
      </div>
    }
  `,
  styleUrl: './form-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormModalComponent implements OnChanges, OnDestroy {
  private readonly document = inject(DOCUMENT);
  private isPageLocked = false;
  private readonly formFields = contentChildren(FormFieldComponent, { descendants: true });
  private readonly searchableDropdowns = contentChildren(SearchableDropdownComponent, { descendants: true });
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly titleId = input('shared-form-modal-title');
  readonly primaryLabel = input('Save');
  readonly secondaryLabel = input('Cancel');
  readonly showSecondary = input(true);
  readonly hidePrimary = input(false);
  readonly fixedSize = input(false);
  readonly danger = input(false);
  readonly loadingLabel = input('Saving…');
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly close = output<void>();
  readonly cancel = output<void>();
  readonly submit = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.open() && !this.loading()) this.close.emit(); }
  backdropClick(): void { if (!this.loading()) this.close.emit(); }
  ngOnChanges(changes: SimpleChanges): void {
    if ('open' in changes) {
      if (this.open()) {
        this.lockPage();
        queueMicrotask(() => this.resetValidationState());
      } else {
        this.unlockPage();
      }
    }
  }
  ngOnDestroy(): void { this.unlockPage(); }
  preventBackdropScroll(event: Event): void {
    if (event.target === event.currentTarget) event.preventDefault();
  }

  submitAttempt(): void {
    this.formFields().forEach((field) => field.markSubmitted());
    this.searchableDropdowns().forEach((dropdown) => dropdown.markSubmitted());
    if (!this.disabled()) this.submit.emit();
  }

  private resetValidationState(): void {
    this.formFields().forEach((field) => field.resetInteractionState());
    this.searchableDropdowns().forEach((dropdown) => dropdown.resetInteractionState());
  }

  private lockPage(): void {
    if (this.isPageLocked) return;
    const view = this.document.defaultView;
    if (!view) return;
    if (pageLockCount === 0) {
      lockedScrollY = view.scrollY;
      bodyStyles = this.document.body.getAttribute('style') ?? '';
      documentStyles = this.document.documentElement.getAttribute('style') ?? '';
      const scrollbarWidth = Math.max(0, view.innerWidth - this.document.documentElement.clientWidth);
      this.document.body.style.position = 'fixed';
      this.document.body.style.top = `-${lockedScrollY}px`;
      this.document.body.style.width = '100%';
      this.document.body.style.overflow = 'hidden';
      this.document.body.style.paddingRight = scrollbarWidth ? `${scrollbarWidth}px` : '';
      this.document.documentElement.style.overflow = 'hidden';
    }
    pageLockCount += 1;
    this.isPageLocked = true;
  }
  private unlockPage(): void {
    if (!this.isPageLocked) return;
    pageLockCount = Math.max(0, pageLockCount - 1);
    this.isPageLocked = false;
    if (pageLockCount !== 0) return;
    const view = this.document.defaultView;
    this.document.body.setAttribute('style', bodyStyles);
    this.document.documentElement.setAttribute('style', documentStyles);
    view?.scrollTo({ top: lockedScrollY, left: 0, behavior: 'instant' });
  }
}
