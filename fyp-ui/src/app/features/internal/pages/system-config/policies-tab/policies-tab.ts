import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { SystemConfigService } from '../../../../../core/config/system-config.service';
import { FormFieldComponent } from '../../../../../shared/components/form-controls/form-field';
import { LoadingStateComponent } from '../../../../../shared/components/loading-state/loading-state';

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
  readonly configLoading = this.configService.loading;
  readonly paxThreshold = signal(this.configService.paxReviewerThreshold());
  readonly cancellationDays = signal(this.configService.cancellationDaysLimit());
  readonly policiesSaved = signal(false);
  readonly saving = signal(false);

  constructor() {
    // configService.paxReviewerThreshold()/etc. are read once above as plain signal snapshots
    // (not computed()), so if the real GET resolves after this component has already
    // constructed with DEFAULT_CONFIG, that later value would otherwise never reach these local
    // editable copies. Re-sync once, the moment loading flips to false.
    effect(() => {
      if (this.configService.loading()) return;
      this.paxThreshold.set(this.configService.paxReviewerThreshold());
      this.cancellationDays.set(this.configService.cancellationDaysLimit());
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

  savePolicies(): void {
    this.saving.set(true);
    this.configService.updateConfig({
      paxReviewerThreshold: this.paxThreshold(),
      cancellationDaysLimit: this.cancellationDays(),
    }).pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.policiesSaved.set(true);
        setTimeout(() => this.policiesSaved.set(false), 2000);
      },
    });
  }
}
