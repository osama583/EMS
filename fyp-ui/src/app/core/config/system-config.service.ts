import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { SystemConfig, SystemConfigDraft } from './system-config.models';
import { EVENT_CATEGORY_OPTIONS } from '../events/published-event.models';

const STORAGE_KEY = 'apu-ems-system-config';

@Injectable({ providedIn: 'root' })
export class SystemConfigService {
  private readonly document = inject(DOCUMENT);
  
  private readonly defaultConfig: SystemConfig = {
    paxReviewerThreshold: 50,
    cancellationDaysLimit: 3,
    eventCategories: [...EVENT_CATEGORY_OPTIONS],
  };

  private readonly state = signal<SystemConfig>(this.loadConfig());
  
  readonly config = computed(() => this.state());
  readonly paxReviewerThreshold = computed(() => this.state().paxReviewerThreshold);
  readonly cancellationDaysLimit = computed(() => this.state().cancellationDaysLimit);
  readonly eventCategories = computed(() => this.state().eventCategories);

  updateConfig(draft: SystemConfigDraft): void {
    this.state.set(draft);
    this.saveConfig(draft);
  }

  private loadConfig(): SystemConfig {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SystemConfig>;
        return {
          paxReviewerThreshold: parsed.paxReviewerThreshold ?? this.defaultConfig.paxReviewerThreshold,
          cancellationDaysLimit: parsed.cancellationDaysLimit ?? this.defaultConfig.cancellationDaysLimit,
          eventCategories: parsed.eventCategories ?? this.defaultConfig.eventCategories,
        };
      }
    } catch { /* ignore */ }
    return this.defaultConfig;
  }

  private saveConfig(config: SystemConfig): void {
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* ignore */ }
  }
}
