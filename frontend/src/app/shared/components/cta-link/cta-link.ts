import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

// Shared pill CTA used by the hero ("Explore Events"), the site header ("Request an
// Event"), and the happening-soon story ("Explore Event") — same visual language,
// previously three separately-duplicated `<a>`/`<button>` + CSS class pairs.
export type CtaLinkArrow = '→' | '↗';

@Component({
  selector: 'app-cta-link',
  template: `
    @if (href()) {
      <a
        class="cta-link"
        [class.cta-link--compact]="compact()"
        [attr.href]="href()"
        (click)="activated.emit($event)"
      >
        <span>{{ label() }}</span>
        <span class="cta-link__arrow" aria-hidden="true">{{ arrow() }}</span>
      </a>
    } @else {
      <button
        type="button"
        class="cta-link"
        [class.cta-link--compact]="compact()"
        (click)="activated.emit($event)"
      >
        <span>{{ label() }}</span>
        <span class="cta-link__arrow" aria-hidden="true">{{ arrow() }}</span>
      </button>
    }
  `,
  styleUrl: './cta-link.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CtaLinkComponent {
  readonly label = input.required<string>();
  readonly href = input<string | undefined>(undefined);
  readonly arrow = input<CtaLinkArrow>('→');
  readonly compact = input(false);
  readonly activated = output<MouseEvent>();
}
