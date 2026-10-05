import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-proposal-section',
  template: `
    <section class="prv-section">
      <div class="prv-section__head">
        <span class="prv-section__icon material-symbols-rounded" aria-hidden="true">{{ icon() }}</span>
        <div>
          <h2 class="prv-section__title">{{ title() }}</h2>
          @if (description()) { <p class="prv-section__desc">{{ description() }}</p> }
        </div>
      </div>
      <ng-content />
    </section>
  `,
  styleUrl: './proposal-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalSectionComponent {
  readonly icon = input.required<string>();
  readonly title = input.required<string>();
  readonly description = input<string>('');
}
