import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SystemConfig, SystemConfigDraft } from './system-config.models';
import { EVENT_CATEGORY_OPTIONS } from '../events/published-event.models';

const DEFAULT_CONFIG: SystemConfig = {
  paxReviewerThreshold: 50,
  cancellationDaysLimit: 3,
  eventCategories: [...EVENT_CATEGORY_OPTIONS],
};

@Injectable({ providedIn: 'root' })
export class SystemConfigService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = environment.configApiUrl;

  private readonly state = signal<SystemConfig>(DEFAULT_CONFIG);
  readonly config = computed(() => this.state());
  readonly paxReviewerThreshold = computed(() => this.state().paxReviewerThreshold);
  readonly cancellationDaysLimit = computed(() => this.state().cancellationDaysLimit);
  readonly eventCategories = computed(() => this.state().eventCategories);

  constructor() {
    this.refresh();
  }

  updateConfig(draft: SystemConfigDraft): Observable<SystemConfig> {
    return this.http.put<SystemConfig>(this.baseUrl, draft).pipe(tap((saved) => this.state.set(saved)));
  }

  refresh(): void {
    this.http.get<SystemConfig>(this.baseUrl).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (config) => this.state.set(config),
      error: () => this.state.set(DEFAULT_CONFIG),
    });
  }
}
