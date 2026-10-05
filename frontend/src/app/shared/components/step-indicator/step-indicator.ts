import { ChangeDetectionStrategy, Component, effect, signal, input, output } from '@angular/core';

export interface WizardStep { readonly label: string; readonly icon: string; }
export interface MissingFieldItem {
  readonly label: string;
  readonly target?: string;
  readonly table?: {
    readonly id: string;
    readonly collection: string;
    readonly requestKey?: string;
    readonly rowIndex?: number;
    readonly fieldKey?: string;
  };
}
export interface StepStatus { readonly visited: boolean; readonly checked?: boolean; readonly valid: boolean; readonly missingFields: readonly MissingFieldItem[]; }

@Component({
  selector: 'app-step-indicator',
  template: `
    <nav class="step-indicator" aria-label="Form progress" (mouseleave)="closePopup()">
      @for (step of steps(); track step.label; let index = $index) {
        <div class="step-node" [class.step-node--popup-open]="popupIndex() === index" (mouseenter)="openPopup(index)">
          <button
            type="button"
            class="step"
            [class.step--active]="isActive(index)"
            [class.step--complete]="isComplete(index)"
            [class.step--warning]="isWarning(index)"
            [class.step--error]="isError(index)"
            [attr.aria-current]="isActive(index) ? 'step' : null"
            [attr.aria-expanded]="isIncomplete(index) ? popupIndex() === index : null"
            [attr.aria-controls]="isIncomplete(index) ? 'missing-popup-' + index : null"
            [attr.aria-label]="ariaLabel(index)"
            (click)="activateStep(index)"
            (focus)="openPopup(index)"
          >
            <span class="step__bubble material-symbols-rounded" aria-hidden="true">{{ icon(index) }}</span>
            <strong class="step__label">{{ step.label }}</strong>
          </button>

          @if (guidanceVisible() && isError(index) && !isGuidanceDismissed(index)) {
            <div class="step-guidance" role="status">
              <span class="step-guidance__desktop">Hover to view missing fields</span>
              <span class="step-guidance__mobile">Tap to view missing fields</span>
            </div>
          }

          @if (isIncomplete(index) && status(index).missingFields.length) {
            <section
              class="missing-popup"
              [id]="'missing-popup-' + index"
              [class.missing-popup--error]="isError(index)"
              (mouseenter)="openPopup(index)"
              (mouseleave)="closePopup()"
            >
              <header>
                <span class="missing-popup__accent" aria-hidden="true"></span>
                <strong>Missing Information</strong>
                <span class="missing-popup__count">{{ status(index).missingFields.length }} {{ status(index).missingFields.length === 1 ? 'item' : 'items' }}</span>
              </header>
              <ul>
                @for (field of status(index).missingFields; track field.label + (field.target ?? '')) {
                  <li>
                    <button type="button" (click)="selectMissingField($event, index, field)">
                      <span aria-hidden="true">•</span>{{ field.label }}
                    </button>
                  </li>
                }
              </ul>
            </section>
          }
        </div>

        @if (index < steps().length - 1) {
          <span class="step-connector" [class.step-connector--complete]="isComplete(index)" aria-hidden="true"></span>
        }
      }
    </nav>
  `,
  styleUrl: './step-indicator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepIndicatorComponent {
  readonly currentStep = input(1);
  readonly steps = input.required<readonly WizardStep[]>();
  readonly stepStatuses = input<readonly StepStatus[]>([]);
  readonly submitAttempted = input(false);
  readonly guidanceVisible = input(false);
  readonly guidanceVersion = input(0);
  readonly stepClick = output<number>();
  readonly missingFieldClick = output<{ step: number; field: MissingFieldItem }>();
  readonly popupIndex = signal<number | null>(null);
  readonly dismissedGuidance = signal<ReadonlySet<number>>(new Set());

  private readonly resetGuidance = effect(() => {
    this.guidanceVersion();
    this.dismissedGuidance.set(new Set());
  });

  status(index: number): StepStatus { return this.stepStatuses()[index] ?? { visited: false, checked: false, valid: true, missingFields: [] }; }
  isActive(index: number): boolean { return index + 1 === this.currentStep(); }
  isComplete(index: number): boolean { return !this.isActive(index) && Boolean(this.status(index).checked) && this.status(index).valid; }
  isError(index: number): boolean { return this.submitAttempted() && !this.status(index).valid; }
  isWarning(index: number): boolean {
    const status = this.status(index);
    return !this.isError(index) && Boolean(status.checked || status.visited) && !status.valid;
  }
  isIncomplete(index: number): boolean { return this.isWarning(index) || this.isError(index); }
  icon(index: number): string { return this.isActive(index) ? this.steps()[index].icon : this.isComplete(index) ? 'check' : this.isIncomplete(index) ? 'warning_amber' : this.steps()[index].icon; }
  ariaLabel(index: number): string { const missing = this.status(index).missingFields; return `${this.steps()[index].label}${missing.length ? `. Missing: ${missing.map((field) => field.label).join(', ')}` : ''}`; }
  openPopup(index: number): void { if (this.isIncomplete(index)) { this.dismissGuidance(index); this.popupIndex.set(index); } }
  closePopup(): void { this.popupIndex.set(null); }
  activateStep(index: number): void {
    this.dismissGuidance(index);
    this.stepClick.emit(index + 1);
    if (this.isIncomplete(index)) this.popupIndex.set(this.popupIndex() === index ? null : index);
  }
  dismissGuidance(index: number): void { this.dismissedGuidance.update((current) => new Set(current).add(index)); }
  isGuidanceDismissed(index: number): boolean { return this.dismissedGuidance().has(index); }
  selectMissingField(event: Event, index: number, field: MissingFieldItem): void {
    event.stopPropagation();
    this.missingFieldClick.emit({ step: index + 1, field });
    this.popupIndex.set(null);
  }
}
