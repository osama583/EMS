import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SystemConfig, SystemConfigDraft } from './system-config.models';

// Mirrors the values seeded by migration 018. Only rendered while the real GET
// is in flight — `loading` guards every reader, so these are never mistaken for
// the saved configuration.
const DEFAULT_CONFIG: SystemConfig = {
  paxReviewerThreshold: 50,
  cancellationDaysLimit: 3,
  maxEventCategories: 2,
  slaDecisionHours: 48,
  slaAssignmentHours: 24,
  slaFulfilmentLeadDays: 3,
  slaOrderAcceptHours: 12,
  slaOrderClaimHours: 4,
  staffShiftHours: 8,
  capacityWarnRatio: 0.85,
  atRiskWindowDays: 7,
  stallMultiplier: 2,
  forecastHorizonDays: 60,
  dashboardTrendWeeks: 12,
  anomalySigma: 2,
  minBucketSize: 5,
  sendBackWarnRate: 15,
  venueTeardownMinutes: 60,
  startPointMaxTours: 2,
};

@Injectable({ providedIn: 'root' })
export class SystemConfigService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = `${environment.apiBaseUrl}/catalog/config`;

  private readonly state = signal<SystemConfig>(DEFAULT_CONFIG);
  readonly config = computed(() => this.state());
  readonly paxReviewerThreshold = computed(() => this.state().paxReviewerThreshold);
  readonly cancellationDaysLimit = computed(() => this.state().cancellationDaysLimit);
  readonly maxEventCategories = computed(() => this.state().maxEventCategories);
  // True until the real GET resolves — components reading paxReviewerThreshold/etc. at
  // construction time (a plain signal snapshot, not a live subscription) should show a loading
  // state rather than briefly rendering DEFAULT_CONFIG as if it were the real saved config.
  readonly loading = signal(true);

  constructor() {
    this.refresh();
  }

  updateConfig(draft: SystemConfigDraft): Observable<SystemConfig> {
    return this.http.put<SystemConfig>(this.baseUrl, draft).pipe(tap((saved) => this.state.set(saved)));
  }

  refresh(): void {
    this.http.get<SystemConfig>(this.baseUrl).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (config) => { this.state.set(config); this.loading.set(false); },
      error: () => { this.state.set(DEFAULT_CONFIG); this.loading.set(false); },
    });
  }
}
