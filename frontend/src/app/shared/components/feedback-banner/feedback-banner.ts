import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-feedback-banner',
  template: `
    @if (message()) {
      <p class="shared-feedback-banner" [attr.data-tone]="tone()" [attr.role]="tone() === 'error' ? 'alert' : 'status'">
        <span class="material-symbols-rounded" aria-hidden="true">{{ tone() === 'error' ? 'warning' : 'check_circle' }}</span>
        {{ message() }}
      </p>
    }
  `,
  styleUrl: './feedback-banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackBannerComponent {
  readonly message = input('');
  readonly tone = input<'success' | 'error'>('success');
}
