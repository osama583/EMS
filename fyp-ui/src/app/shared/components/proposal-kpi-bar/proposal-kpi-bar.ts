import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { stageLabel } from '../../../core/proposals/proposal-status.models';

@Component({
  selector: 'app-proposal-kpi-bar',
  template: `
    @if (proposal(); as item) {
      <div class="prv-kpi-bar">
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">event</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Event Title</span>
            <strong class="prv-kpi-card__value">{{ item.eventTitle }}</strong>
          </div>
        </div>
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">groups</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Total Pax</span>
            <strong class="prv-kpi-card__value">{{ item.totalPax }} <small>({{ item.externalPax }} external)</small></strong>
          </div>
        </div>
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">visibility</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Visibility</span>
            <strong class="prv-kpi-card__value">{{ item.eventVisibility }}</strong>
          </div>
        </div>
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">location_on</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Format</span>
            <strong class="prv-kpi-card__value">{{ item.eventFormat }}</strong>
          </div>
        </div>
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">flag</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Current Stage</span>
            <strong class="prv-kpi-card__value prv-kpi-card__value--stage">{{ computedStageLabel() }}</strong>
          </div>
        </div>
        <div class="prv-kpi-card">
          <span class="prv-kpi-card__icon material-symbols-rounded" aria-hidden="true">label</span>
          <div class="prv-kpi-card__body">
            <span class="prv-kpi-card__label">Category</span>
            <strong class="prv-kpi-card__value">{{ item.category }}</strong>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './proposal-kpi-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalKpiBarComponent {
  readonly proposal = input.required<ProposalReviewRecord | null>();
  readonly stageLabelOverride = input<string | null>(null, { alias: 'stageLabel' });

  readonly computedStageLabel = computed(() => {
    const override = this.stageLabelOverride();
    if (override) return override;
    const item = this.proposal();
    if (!item) return '';
    return stageLabel(item.workflow.stage);
  });
}
