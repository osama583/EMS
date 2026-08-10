export interface SystemConfig {
  readonly paxReviewerThreshold: number;
  readonly cancellationDaysLimit: number;
  readonly eventCategories: readonly string[];
}

export type SystemConfigDraft = SystemConfig;
