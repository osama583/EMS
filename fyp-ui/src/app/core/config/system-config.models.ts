export interface SystemConfig {
  readonly paxReviewerThreshold: number;
  readonly cancellationDaysLimit: number;
}

export type SystemConfigDraft = SystemConfig;
