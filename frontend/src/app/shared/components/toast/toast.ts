import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { ToastTone } from './toast.models';

const TONE_ICON: Readonly<Record<ToastTone, string>> = {
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
  info: 'info',
};

@Component({
  selector: 'app-toast-host',
  template: `
    <div class="app-toast-host" aria-live="polite" aria-atomic="false">
      @for (toast of toasts(); track toast.id) {
        <div class="app-toast" [attr.data-tone]="toast.tone" role="status">
          <span class="app-toast__icon" aria-hidden="true">
            <span class="material-symbols-rounded">{{ icon(toast.tone) }}</span>
          </span>
          <div class="app-toast__body">
            <strong class="app-toast__title">{{ toast.title }}</strong>
            @if (toast.message) { <p class="app-toast__message">{{ toast.message }}</p> }
            @if (toast.action) {
              <button type="button" class="app-toast__action" (click)="runAction(toast)">{{ toast.action.label }}</button>
            }
          </div>
          <button type="button" class="app-toast__close" aria-label="Dismiss notification" (click)="toastService.dismiss(toast.id)">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  protected readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.toasts;

  icon(tone: ToastTone | undefined): string { return TONE_ICON[tone ?? 'success']; }

  runAction(toast: { id: number; action?: { onClick: () => void } }): void {
    toast.action?.onClick();
    this.toastService.dismiss(toast.id);
  }
}
