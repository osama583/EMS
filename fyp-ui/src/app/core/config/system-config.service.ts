import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SystemConfig, SystemConfigDraft } from './system-config.models';

// Mirrors the values seeded by migration 001/034. Only rendered while the real
// GET is in flight — `loading` guards every reader, so these are never mistaken
// for the saved configuration.
const DEFAULT_CONFIG: SystemConfig = {
  paxReviewerThreshold: 50,
  cancellationDaysLimit: 3,
  maxEventCategories: 2,
  minEventLeadDays: 0,
  approvalWarningDays: 7,
  approvalWarningEmailDays: 2,
  approvalUrgentDays: 2,
  approvalUrgentEmailDays: 1,
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
  readonly minEventLeadDays = computed(() => this.state().minEventLeadDays);
  readonly approvalWarningDays = computed(() => this.state().approvalWarningDays);
  readonly approvalWarningEmailDays = computed(() => this.state().approvalWarningEmailDays);
  readonly approvalUrgentDays = computed(() => this.state().approvalUrgentDays);
  readonly approvalUrgentEmailDays = computed(() => this.state().approvalUrgentEmailDays);
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
