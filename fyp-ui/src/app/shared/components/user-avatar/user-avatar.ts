import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-user-avatar',
  template: `
    @if (imageUrl()) {
      <img class="shared-user-avatar" [src]="imageUrl()" [alt]="name()" />
    } @else {
      <span class="shared-user-avatar shared-user-avatar--placeholder material-symbols-rounded" [attr.aria-label]="name() + ' profile photo'">account_circle</span>
    }
  `,
  styles: `
    :host { display: block; width: var(--user-avatar-size, 12rem); max-width: 100%; }
    .shared-user-avatar { display: block; width: 100%; aspect-ratio: .79; border: 1px solid var(--apu-border); border-radius: var(--radius-card); object-fit: cover; object-position: center; }
    .shared-user-avatar--placeholder { display: grid; place-items: center; background: linear-gradient(145deg, rgb(42 131 255 / 12%), var(--apu-surface-muted)); color: var(--apu-blue-600); font-family: 'Material Symbols Rounded'; font-size: clamp(4rem, 10vw, 7rem); font-feature-settings: 'liga'; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserAvatarComponent {
  readonly name = input('User');
  readonly imageUrl = input<string | null | undefined>(null);
}
