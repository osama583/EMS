import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { ProposalSectionComponent } from '../proposal-section/proposal-section';
import { ProposalSummaryGridComponent } from './proposal-summary-grid';
import { ProposalSummaryField } from './proposal-summary-layout';

/**
 * The Event Overview section, shared by proposal-reviewer-view and proposal-department-view.
 *
 * It existed as the same ~14 lines of markup copy-pasted into both components, hardcoded spans
 * and all, which meant every fix had to be made twice and the two were free to drift. It is one
 * component now, and the fields are DATA rather than template literals so the blank ones can be
 * dropped and the rows repacked - see proposal-summary-layout.ts for why that is a packer rather
 * than a CSS rule.
 *
 * :host is `display: contents` so <app-proposal-section> stays a direct grid child of .prv-main
 * and the page's vertical rhythm is unchanged by the extra wrapper.
 */
@Component({
  selector: 'app-proposal-overview',
  imports: [ProposalSectionComponent, ProposalSummaryGridComponent],
  template: `
    <app-proposal-section
      icon="description"
      title="Event Overview"
      description="General information, registration and publicity."
    >
      <app-proposal-summary-grid [fields]="fields()" />
      @if (proposal().eventImage; as image) {
        <img class="prv-event-image" [src]="image.url" [alt]="proposal().eventTitle + ' event image'" />
      }
    </app-proposal-section>
  `,
  styleUrl: './proposal-overview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalOverviewComponent {
  readonly proposal = input.required<ProposalReviewRecord>();

  /**
   * Declaration order is the reading order, and it is preserved through packing - the page must
   * not rearrange itself between one proposal and the next, or a reviewer never learns where to
   * look. Only which fields SURVIVE changes.
   */
  readonly fields = computed<readonly ProposalSummaryField[]>(() => {
    const item = this.proposal();
    return [
      { label: 'Event Title', value: item.eventTitle },
      { label: 'Visibility', value: item.eventVisibility },
      { label: 'Format', value: item.eventFormat },
      { label: 'Registration', value: item.registrationMode },
      { label: 'Total Pax', value: item.totalPax },
      { label: 'External Pax', value: item.externalPax },
      { label: 'Categories', value: (item.eventCategories ?? []).join(', ') },
      { label: 'Publicity', value: item.publicity, variant: 'prose' },
      { label: 'Short Introduction', value: item.shortIntroduction, variant: 'prose' },
      { label: 'Goals & Objectives', value: item.goals, variant: 'prose' },
      { label: 'Expected Benefits', value: item.benefits, variant: 'prose' },
    ];
  });
}
