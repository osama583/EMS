import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { SystemConfigService } from '../../../../../core/config/system-config.service';
import { SystemConfigDraft } from '../../../../../core/config/system-config.models';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { SkeletonComponent } from '../../../../../shared/components/skeleton/skeleton';

/** The workflow policies an administrator tunes without a deploy. */
@Component({
  selector: 'app-policies-tab',
  imports: [SkeletonComponent, FormFieldComponent],
  templateUrl: './policies-tab.html',
  styleUrl: './policies-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesTabComponent {
  private readonly configService = inject(SystemConfigService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly configLoading = this.configService.loading;
  readonly paxThreshold = signal(this.configService.paxReviewerThreshold());
  readonly cancellationDays = signal(this.configService.cancellationDaysLimit());
  readonly maxCategories = signal(this.configService.maxEventCategories());
  readonly minLeadDays = signal(this.configService.minEventLeadDays());
  readonly warningDays = signal(this.configService.approvalWarningDays());
  readonly warningEmailDays = signal(this.configService.approvalWarningEmailDays());
  readonly urgentDays = signal(this.configService.approvalUrgentDays());
  readonly urgentEmailDays = signal(this.configService.approvalUrgentEmailDays());
  readonly policiesSaved = signal(false);
  readonly saving = signal(false);

  /**
   * The earliest start date a proposal created today could pick, shown so an
   * administrator sees what the lead time means in practice rather than having
   * to count days forward themselves.
   */
  readonly earliestEventDateLabel = computed(() => {
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    earliest.setDate(earliest.getDate() + this.minLeadDays());
    return earliest.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  });

  constructor() {
    // configService.paxReviewerThreshold()/etc.
    effect(() => {
      if (this.configService.loading()) return;
      const config = this.configService.config();
      this.paxThreshold.set(config.paxReviewerThreshold);
      this.cancellationDays.set(config.cancellationDaysLimit);
      this.maxCategories.set(config.maxEventCategories);
      this.minLeadDays.set(config.minEventLeadDays);
      this.warningDays.set(config.approvalWarningDays);
      this.warningEmailDays.set(config.approvalWarningEmailDays);
      this.urgentDays.set(config.approvalUrgentDays);
      this.urgentEmailDays.set(config.approvalUrgentEmailDays);
    });
  }

  setPaxThreshold(value: string | number): void {
    this.paxThreshold.set(Number(value) || 50);
    this.policiesSaved.set(false);
  }

  setCancellationDays(value: string | number): void {
    this.cancellationDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  setMaxCategories(value: string | number): void {
    this.maxCategories.set(Math.max(1, Number(value) || 1));
    this.policiesSaved.set(false);
  }

  setMinLeadDays(value: string | number): void {
    this.minLeadDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  setWarningDays(value: string | number): void {
    this.warningDays.set(Math.max(1, Number(value) || 1));
    this.policiesSaved.set(false);
  }

  setWarningEmailDays(value: string | number): void {
    this.warningEmailDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  setUrgentDays(value: string | number): void {
    this.urgentDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  setUrgentEmailDays(value: string | number): void {
    this.urgentEmailDays.set(Math.max(0, Number(value) || 0));
    this.policiesSaved.set(false);
  }

  /**
   * Mirrors the server's own rule, so the administrator sees the problem while typing rather
   * than as a rejected save. Red must fall INSIDE the amber window or amber never fires.
   */
  readonly thresholdError = computed(() =>
    this.urgentDays() >= this.warningDays()
      ? 'The urgent threshold must be fewer days than the warning threshold.'
      : '',
  );

  savePolicies(): void {
    this.saving.set(true);
    const draft: SystemConfigDraft = {
      paxReviewerThreshold: this.paxThreshold(),
      cancellationDaysLimit: this.cancellationDays(),
      maxEventCategories: this.maxCategories(),
      minEventLeadDays: this.minLeadDays(),
      approvalWarningDays: this.warningDays(),
      approvalWarningEmailDays: this.warningEmailDays(),
      approvalUrgentDays: this.urgentDays(),
      approvalUrgentEmailDays: this.urgentEmailDays(),
    };
    this.configService
      .updateConfig(draft)
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.policiesSaved.set(true);
          this.toast.success('Policies saved', 'New proposals and dashboards use these values immediately.');
          setTimeout(() => this.policiesSaved.set(false), 2000);
        },
        error: (err) => this.toast.error('Could not save these policies', apiErrorMessage(err, 'Please try again.')),
      });
  }
}
