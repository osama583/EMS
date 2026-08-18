export interface SystemConfig {
  readonly paxReviewerThreshold: number;
  readonly cancellationDaysLimit: number;
  // Ceiling on how many categories an applicant may tag a public event with (config table's
  // MAX_EVENT_CATEGORIES). Enforced server-side on submit; the picker mirrors it.
  readonly maxEventCategories: number;
}

export type SystemConfigDraft = SystemConfig;
