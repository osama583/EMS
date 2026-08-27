export interface SystemConfig {
  readonly paxReviewerThreshold: number;
  readonly cancellationDaysLimit: number;
  // Ceiling on how many categories an applicant may tag a public event with (config table's
  // MAX_EVENT_CATEGORIES). Enforced server-side on submit; the picker mirrors it.
  readonly maxEventCategories: number;

  // --- Dashboard thresholds (migration 018) --------------------------------
  // Every SLA target, capacity assumption, risk window and forecast horizon the
  // role dashboards read. None of them lives in code: an administrator retunes
  // a department's SLA on /app/admin/settings/policies without a deploy, the
  // same way the three values above already work. Per-unit overrides use a
  // "__<unit_code>" suffix on the same code and are set directly in the config
  // table; these are the fallbacks every unit inherits.
  readonly slaDecisionHours: number;
  readonly slaAssignmentHours: number;
  readonly slaFulfilmentLeadDays: number;
  readonly slaOrderAcceptHours: number;
  readonly slaOrderClaimHours: number;
  readonly staffShiftHours: number;
  readonly capacityWarnRatio: number;
  readonly atRiskWindowDays: number;
  readonly stallMultiplier: number;
  readonly forecastHorizonDays: number;
  readonly dashboardTrendWeeks: number;
  readonly anomalySigma: number;
  readonly minBucketSize: number;
  readonly sendBackWarnRate: number;
  readonly venueTeardownMinutes: number;
  readonly startPointMaxTours: number;
}

export type SystemConfigDraft = Partial<SystemConfig>;

/**
 * The dashboard thresholds, grouped for the policies form.
 *
 * Declared as data rather than as sixteen hand-written fields: the form walks
 * this list, so adding a threshold is one entry here plus a config row, not a
 * template edit somebody will forget to make.
 */
export interface DashboardThreshold {
  readonly field: keyof SystemConfig;
  readonly label: string;
  readonly help: string;
  readonly min: number;
  readonly step?: number;
}

export interface ThresholdGroup {
  readonly title: string;
  readonly blurb: string;
  readonly items: readonly DashboardThreshold[];
}

export const DASHBOARD_THRESHOLD_GROUPS: readonly ThresholdGroup[] = [
  {
    title: 'Service level targets',
    blurb:
      'What a department is measured against. Each accepts a per-unit override in the config table using a "__<unit_code>" suffix; these are the defaults every unit inherits.',
    items: [
      {
        field: 'slaDecisionHours',
        label: 'Decision latency target (hours)',
        min: 1,
        help: 'A department task should get its first approve or send-back inside this window.',
      },
      {
        field: 'slaAssignmentHours',
        label: 'Assignment target (hours)',
        min: 1,
        help: 'How long an approved item may wait before somebody is put on it.',
      },
      {
        field: 'slaFulfilmentLeadDays',
        label: 'Minimum preparation runway (days)',
        min: 0,
        help: 'The notice a department needs. Falling below this predicts every other SLA breach.',
      },
      {
        field: 'slaOrderAcceptHours',
        label: 'Cafeteria order acceptance (hours)',
        min: 1,
        help: 'How long a manager may take to accept an order F&B has placed with them.',
      },
      {
        field: 'slaOrderClaimHours',
        label: 'Cafeteria order claim (hours)',
        min: 1,
        help: 'How long an accepted order may sit unclaimed in the outlet shared pool.',
      },
    ],
  },
  {
    title: 'Capacity assumptions',
    blurb:
      'The arithmetic behind every coverage ratio. The schema carries no roster or availability model, so shift length is an assumption the dashboards state on the tile rather than hide.',
    items: [
      {
        field: 'staffShiftHours',
        label: 'Assumed shift length (hours)',
        min: 1,
        help: 'Multiplied by active headcount to give a unit its daily capacity.',
      },
      {
        field: 'capacityWarnRatio',
        label: 'Capacity amber threshold',
        min: 0,
        step: 0.05,
        help: 'A fraction, not a percentage. Above this a forward day turns amber; above 1.0 it is critical.',
      },
      {
        field: 'venueTeardownMinutes',
        label: 'Venue teardown window (minutes)',
        min: 0,
        help: 'Two Logistics bookings at one location closer together than this are flagged as a conflict.',
      },
      {
        field: 'startPointMaxTours',
        label: 'Tours per start point per day',
        min: 1,
        help: 'Meeting instructions assume one group at a time; more than this on one day is congestion.',
      },
    ],
  },
  {
    title: 'Risk and forecast windows',
    blurb: 'How far ahead the dashboards look, and how loudly they react.',
    items: [
      {
        field: 'atRiskWindowDays',
        label: 'At-risk window (days)',
        min: 1,
        help: 'Open work with a requirement date inside this window counts as at risk.',
      },
      {
        field: 'stallMultiplier',
        label: 'Stall multiplier',
        min: 1,
        step: 0.5,
        help: 'Multiplied by a unit’s own median decision time. Relative, so a fast lane and a slow lane do not share a definition of stalled.',
      },
      {
        field: 'forecastHorizonDays',
        label: 'Forecast horizon (days)',
        min: 7,
        help: 'How far forward committed demand and capacity are projected.',
      },
      {
        field: 'dashboardTrendWeeks',
        label: 'Trend window (weeks)',
        min: 4,
        help: 'The default span of every weekly trend line.',
      },
      {
        field: 'anomalySigma',
        label: 'Anomaly sensitivity (sigma)',
        min: 1,
        step: 0.5,
        help: 'A daily figure above the trailing mean plus this many standard deviations raises a spike alert.',
      },
    ],
  },
  {
    title: 'Reporting rules',
    blurb: 'What the dashboards will and will not say out loud.',
    items: [
      {
        field: 'minBucketSize',
        label: 'Minimum bucket size',
        min: 1,
        help: 'Aggregates crossing a scope boundary suppress buckets below this, so a count plus a calendar cannot identify a person.',
      },
      {
        field: 'sendBackWarnRate',
        label: 'Send-back amber rate (%)',
        min: 1,
        help: 'A whole percent. Above this a department send-back rate turns amber.',
      },
    ],
  },
];
