import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { SystemConfigService } from '../../../../../core/config/system-config.service';
import {
  DASHBOARD_THRESHOLD_GROUPS,
  DashboardThreshold,
  SystemConfig,
  SystemConfigDraft,
} from '../../../../../core/config/system-config.models';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { LoadingStateComponent } from '../../../../../shared/components/loading-state/loading-state';

/**
 * Workflow policies plus the dashboard thresholds.
 *
 * The sixteen dashboard values are rendered from `DASHBOARD_THRESHOLD_GROUPS`
 * rather than written out one control at a time, so adding a threshold is a
 * config row and one entry in that list. Writing them by hand here would mean
 * every new threshold needs a template edit that somebody will forget, and the
 * value would then be tunable only by editing the database directly — which is
 * exactly what rule R11 exists to avoid.
 */
@Component({
  selector: 'app-policies-tab',
  imports: [FormFieldComponent, LoadingStateComponent],
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
  readonly policiesSaved = signal(false);
  readonly saving = signal(false);

  readonly thresholdGroups = DASHBOARD_THRESHOLD_GROUPS;
  /** One editable copy per dashboard threshold, keyed by its config field. */
  readonly thresholds = signal<Record<string, number>>({});

  constructor() {
    // configService.paxReviewerThreshold()/etc. are read once above as plain signal snapshots
    // (not computed()), so if the real GET resolves after this component has already
    // constructed with DEFAULT_CONFIG, that later value would otherwise never reach these local
    // editable copies. Re-sync once, the moment loading flips to false.
    effect(() => {
      if (this.configService.loading()) return;
      const config = this.configService.config();
      this.paxThreshold.set(config.paxReviewerThreshold);
      this.cancellationDays.set(config.cancellationDaysLimit);
      this.maxCategories.set(config.maxEventCategories);
      this.thresholds.set(
        Object.fromEntries(
          this.thresholdGroups.flatMap((group) =>
            group.items.map((item) => [item.field, Number(config[item.field] ?? 0)]),
          ),
        ),
      );
    });
  }

  thresholdValue(item: DashboardThreshold): number {
    return this.thresholds()[item.field] ?? 0;
  }

  setThreshold(item: DashboardThreshold, value: string | number): void {
    const parsed = Number(value);
    // Below the floor is not a stricter policy, it is a broken one: a zero-hour
    // SLA marks every task breached and a zero bucket floor disables the
    // suppression rule entirely.
    const clamped = Number.isFinite(parsed) ? Math.max(item.min, parsed) : item.min;
    this.thresholds.update((current) => ({ ...current, [item.field]: clamped }));
    this.policiesSaved.set(false);
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

  savePolicies(): void {
    this.saving.set(true);
    const draft: SystemConfigDraft = {
      paxReviewerThreshold: this.paxThreshold(),
      cancellationDaysLimit: this.cancellationDays(),
      maxEventCategories: this.maxCategories(),
      ...(this.thresholds() as Partial<SystemConfig>),
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
