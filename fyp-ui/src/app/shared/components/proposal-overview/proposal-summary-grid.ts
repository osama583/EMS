import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProposalFieldComponent } from '../proposal-field/proposal-field';
import { ProposalSummaryField, packProposalFields } from './proposal-summary-layout';

/**
 * Renders a list of summary fields as gap-free rows: blanks are dropped, and each surviving row
 * gets exactly as many columns as it has fields (see proposal-summary-layout.ts).
 *
 * Presentational and field-agnostic on purpose - the Applicant section and the Event Overview
 * section both have optional fields that used to render as empty labelled cards, and they need
 * the same treatment without sharing a field list.
 */
@Component({
  selector: 'app-proposal-summary-grid',
  imports: [ProposalFieldComponent],
  template: `
    <div class="prv-summary">
      @for (row of rows(); track $index) {
        <!-- The column count IS the row length, which is what makes a gap impossible. -->
        <div class="prv-summary-row" [style.--prv-summary-cols]="row.length">
          @for (cell of row; track cell.label) {
            <app-proposal-field [label]="cell.label" [value]="cell.value" />
          }
        </div>
      }
    </div>
  `,
  styleUrl: './proposal-summary-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalSummaryGridComponent {
  readonly fields = input.required<readonly ProposalSummaryField[]>();

  readonly rows = computed(() => packProposalFields(this.fields()));
}
