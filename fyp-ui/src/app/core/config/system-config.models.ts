export interface SystemConfig {
  readonly paxReviewerThreshold: number;
  readonly cancellationDaysLimit: number;
  // Ceiling on how many categories an applicant may tag a public event with (config table's
  // MAX_EVENT_CATEGORIES). Enforced server-side on submit; the picker mirrors it.
  readonly maxEventCategories: number;
  // Minimum notice between today and the event start date (config table's
  // MIN_EVENT_LEAD_DAYS). The proposal date picker disables anything earlier;
  // submit re-checks it server-side.
  readonly minEventLeadDays: number;
  // Approval escalation (config table's APPROVAL_* codes). The thresholds are days before the
  // event at which an undecided proposal turns amber / red in every approver's inbox; the
  // *EmailDays pair is how often to re-chase the approver, where 0 sends no email but keeps
  // the colour. The urgent threshold must be smaller than the warning one — the server rejects
  // a save that would make a proposal turn red before it ever turned amber.
  readonly approvalWarningDays: number;
  readonly approvalWarningEmailDays: number;
  readonly approvalUrgentDays: number;
  readonly approvalUrgentEmailDays: number;
}

export type SystemConfigDraft = Partial<SystemConfig>;
