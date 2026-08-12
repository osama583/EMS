import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type LoadingStateVariant = 'spinner' | 'bars' | 'grid';

// Single reusable loading indicator for anything that fetches data over the API and needs to
// show the user something while it waits — full-page/detail views, popups/modals, and card
// grids. Uses the shared shimmer/spin tokens and keyframes from _design-system.scss so every
// loading state in the app looks and animates identically instead of each page hand-rolling
// its own spinner or shimmer gradient.
@Component({
  selector: 'app-loading-state',
  template: `
    @switch (variant()) {
      @case ('spinner') {
        <div class="shared-loading-state shared-loading-state--spinner" role="status" [attr.aria-label]="label()">
          <span class="material-symbols-rounded shared-loading-state__spin" aria-hidden="true">progress_activity</span>
          @if (label()) { <span class="shared-loading-state__label">{{ label() }}</span> }
        </div>
      }
      @case ('grid') {
        <div class="shared-loading-state shared-loading-state--grid" role="status" [attr.aria-label]="label()">
          @for (item of items; track item) { <span class="shared-loading-state__block"></span> }
        </div>
      }
      @default {
        <div class="shared-loading-state shared-loading-state--bars" role="status" [attr.aria-label]="label()">
          @for (item of items; track item) { <span class="shared-loading-state__bar"></span> }
        </div>
      }
    }
  `,
  styleUrl: './loading-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingStateComponent {
  readonly variant = input<LoadingStateVariant>('bars');
  readonly label = input('Loading…');
  readonly count = input(4);

  get items(): number[] { return Array.from({ length: this.count() }, (_, index) => index); }
}
