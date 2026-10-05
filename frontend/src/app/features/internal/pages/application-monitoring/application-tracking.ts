import { ProposalHistoryEntry } from '../../../../core/proposals/proposal-review.models';
import { DEPARTMENT_LABELS } from '../../../../core/proposals/proposal-status.models';

/** One dot on the tracking timeline: something that actually happened, and who made it happen. */
export interface TrackingStep {
  readonly title: string;
  readonly description: string;
  readonly actor: string;
  readonly role: string;
  readonly at: string;
  readonly comment: string;
  // Which cafeteria took this step, where that is what distinguishes it — a proposal can be fanned
  // out across several outlets, each with its own manager and staff. Empty for every other step.
  readonly cafeteria: string;
  readonly tone: 'done' | 'rejected' | 'attention';
}

/** A department's own branch of the timeline, once the proposal fans out at department review. */
export interface TrackingBranch {
  readonly department: string;
  readonly label: string;
  readonly steps: readonly TrackingStep[];
}

export interface Tracking {
  // The whole-proposal spine: submission and the single-actor reviewer chain.
  readonly main: readonly TrackingStep[];
  // DEPARTMENT REVIEW only — one track per department, worked in parallel. A department's story here
  // ends when it APPROVED; what its staff then do is fulfilment, and belongs to the next phase.
  readonly branches: readonly TrackingBranch[];
  // IMPLEMENTATION — the work itself, once every department has approved: staff preparing and
  // finishing their items, and the cafeteria preparing and delivering its order.
  readonly implementation: readonly TrackingBranch[];
  // The closing step, kept out of `main` so it always renders last — after the branches it depends
  // on, rather than in the middle of the spine where its timestamp would otherwise put it.
  readonly ending: TrackingStep | null;
  // Stages the application has NOT reached yet, drawn greyed-out after the last real step (the
  // hollow "Processing"/"Delivered" dots in the reference design). Empty once it is finished.
  readonly upcoming: readonly string[];
}

// How each workflow_history.action reads as a timeline step. The verb alone is ambiguous — an
// 'approve' on the reviewer chain moves the whole proposal on, while an 'approve' carrying a
// requirement_name is one department clearing its own task — so the label is resolved with the row's
// stage/department in titleFor() rather than looked up here.
const ROLE_LABELS: Readonly<Record<string, string>> = {
  student: 'Student',
  applicant: 'Applicant',
  'head-of-school': 'Head of School',
  'head-of-department': 'Head of Department',
  cfo: 'CFO',
  'cafeteria-manager': 'Cafeteria Manager',
  'cafeteria-staff': 'Cafeteria Staff',
  staff: 'Staff',
  lecturer: 'Lecturer',
  'system-admin': 'System Admin',
  system: 'System',
};

// Which reviewer a whole-proposal row belongs to, read off the stage it acted ON (previous_status).
// actor_role cannot answer this: a Service department's head and F&B's head share one role code.
const STAGE_LABELS: Readonly<Record<string, string>> = {
  hos_hod_review: 'HOS/HOD review',
  fmb_review: 'F&B review',
  cfo_review: 'CFO review',
  department_review: 'Department review',
  resubmission_required: 'Revision required',
};

function roleLabel(role: string | null): string {
  if (!role) return '';
  return ROLE_LABELS[role] ?? role.replace(/-/g, ' ');
}

function departmentLabel(requirement: string): string {
  return DEPARTMENT_LABELS[requirement] ?? requirement;
}

// 'Order placed with cafeteria__level_3_food_court.' — the only place create-selection records which
// outlet it ordered from, and it does so as a raw unit code inside prose.
const ORDER_UNIT = /cafeteria__([a-z0-9_]+)/i;

/** The cafeteria a step belongs to: the actor's own outlet, or the one named in an order comment. */
export function cafeteriaFor(entry: ProposalHistoryEntry): string {
  if (entry.actor_unit) return entry.actor_unit;
  const match = ORDER_UNIT.exec(entry.comment ?? '');
  if (!match) return '';
  return match[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleFor(entry: ProposalHistoryEntry): string {
  const stage = STAGE_LABELS[entry.previous_status ?? ''] ?? '';
  switch (entry.action) {
    case 'submit': return 'Proposal submitted';
    case 'applicant-resubmit': return 'Applicant resubmitted';
    case 'approve': return entry.requirement_name ? `${departmentLabel(entry.requirement_name)} approved` : `Approved${stage ? ` · ${stage}` : ''}`;
    case 'reject': return `Rejected${stage ? ` · ${stage}` : ''}`;
    case 'resubmit': return entry.requirement_name ? `${departmentLabel(entry.requirement_name)} requested changes` : `Changes requested${stage ? ` · ${stage}` : ''}`;
    case 'cancel': return 'Cancelled';
    case 'task-created': return entry.requirement_name ? `${departmentLabel(entry.requirement_name)} task opened` : 'Department tasks opened';
    case 'assign-row': return 'Staff assigned';
    case 'create-selection': return 'Cafeteria order placed';
    case 'approve-selection': return 'Cafeteria order accepted';
    case 'resubmit-selection': return 'Cafeteria sent the order back';
    case 'claim-selection': return 'Cafeteria started preparing';
    case 'ready-selection': return 'Cafeteria order ready';
    case 'fulfil-selection': return 'Cafeteria order delivered';
    case 'cancel-selection': return 'Cafeteria order cancelled';
    // Every department finished, so the workflow closed the application itself.
    case 'auto-complete': return 'All departments complete · Approved';
    default: return entry.action.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}

function toneFor(entry: ProposalHistoryEntry): TrackingStep['tone'] {
  if (entry.action === 'reject' || entry.action === 'cancel') return 'rejected';
  // A send-back is not a failure, but it is the step that stalled the application — worth its own
  // colour so an administrator scanning the timeline can see where time was lost.
  if (entry.action === 'resubmit' || entry.action === 'resubmit-selection') return 'attention';
  return 'done';
}

function describe(entry: ProposalHistoryEntry): string {
  if (entry.action === 'task-created') return 'Routed to the department for review.';
  if (entry.action === 'assign-row') return 'A requested item was given to a staff member.';
  if (entry.previous_status && entry.new_status && entry.previous_status !== entry.new_status) {
    const from = STAGE_LABELS[entry.previous_status] ?? entry.previous_status.replace(/_/g, ' ');
    const to = STAGE_LABELS[entry.new_status] ?? entry.new_status.replace(/_/g, ' ');
    return `${from} → ${to}`;
  }
  return '';
}

function toStep(entry: ProposalHistoryEntry): TrackingStep {
  // actor_role is the authority on whether a person did this, NOT actor_name: the workflow writes
  // task-created rows with actor_role 'system' but a non-null actor_user_id (the applicant's), so
  // trusting the name would credit routing the app performed itself to whoever submitted it.
  const system = entry.actor_role === 'system';
  const cafeteria = cafeteriaFor(entry);
  return {
    title: titleFor(entry),
    description: describe(entry),
    actor: system ? 'System' : entry.actor_name ?? 'Unknown',
    role: roleLabel(entry.actor_role),
    at: entry.created_at,
    // The order comment says nothing the cafeteria field does not, in a raw unit code — drop it
    // rather than print 'Order placed with cafeteria__level_3_food_court.' under a step that
    // already names Level 3 Food Court.
    comment: ORDER_UNIT.test(entry.comment ?? '') ? '' : entry.comment ?? '',
    cafeteria,
    tone: toneFor(entry),
  };
}

// Actions that are per-ITEM bookkeeping rather than steps in the application's story.
//
// A department's task fires one row per requested row at every stage: Logistics with three items
// writes three 'assign-row', three 'preparing' and three 'completed' rows, then a 'complete' — eight
// dots for one phase, which buries the decisions this view exists to show. The per-item detail is
// already available at the right altitude in the status popover ("Logistics · Round Table — In
// progress, Ahmad Firdaus"), so this timeline stays at the level of decisions.
//
// 'complete' is dropped for the same reason but with an extra wrinkle: it is a department task
// closing itself once its rows are all done, which reads as a second, contradictory ending after the
// approval — and it is attributed to whichever staff member happened to finish last, not to anyone
// who decided anything. A department's story ends when it APPROVED.
// 'assign' and 'assign-row' are both staffing bookkeeping, recorded per requested row; the people
// assigned are shown at the right altitude in the status popover instead. 'complete' is a task
// closing itself once its rows are done — a second, contradictory ending after the approval,
// attributed to whichever staff member happened to finish last. 'task-created' is routing nobody
// chose.
const HIDDEN_ACTIONS = new Set(['assign', 'assign-row', 'complete', 'task-created']);

// The fulfilment work: what staff and the cafeteria DO once every department has approved. These are
// Implementation, not Department review — a department's own story ends at its approval.
const IMPLEMENTATION_ACTIONS = new Set([
  'preparing', 'completed',
  'claim-selection', 'ready-selection', 'fulfil-selection',
]);

// Rows the workflow wrote about itself rather than a person deciding something. The timeline answers
// "who took action, and when" — a routing step nobody chose is not an answer to that. The one
// exception is the workflow closing the application (auto-complete), which is the ending and would
// otherwise leave the story with no last step.
function isSystemNoise(entry: ProposalHistoryEntry): boolean {
  return entry.actor_role === 'system' && entry.action !== 'auto-complete';
}

// Every action belonging to a cafeteria ORDER. These carry no requirement_name (they hang off
// request_fmb, not a request_task), so without naming them they would all land on the main spine —
// which is how "Claim selection" and "Ready selection" ended up between CFO approval and completion.
const ORDER_ACTIONS = new Set([
  'create-selection', 'approve-selection', 'resubmit-selection',
  'claim-selection', 'ready-selection', 'fulfil-selection', 'cancel-selection',
]);

/**
 * Collapse the same decision written more than once.
 *
 * A department approving a task with several assigned rows records one history row PER ROW (see the
 * duplicate 'approve' pairs milliseconds apart on request 7322), which would draw one dot per row for
 * what was a single click. Same action, same task and same actor is one decision however many rows it
 * covered; the per-item detail lives in the status popover, not here.
 */
function dedupe(steps: readonly ProposalHistoryEntry[]): ProposalHistoryEntry[] {
  const seen = new Set<string>();
  return steps.filter((entry) => {
    // Only the per-task duplication is collapsed. A whole-proposal row has no request_task_id, and
    // two of those are genuinely two decisions — the same reviewer approving at F&B and again at CFO
    // shares every other field, so keying on them would erase a real step.
    // A cafeteria step is identified by its outlet, not a task: two outlets accepting their own
    // orders are two events that would otherwise share every field compared below.
    if (entry.request_task_id === null) return true;
    const key = [
      entry.action, entry.request_task_id, entry.actor_user_id, entry.requirement_name,
      entry.previous_status, entry.new_status,
      // The comment is part of the identity for a DECISION (two send-backs saying different things
      // are two events), but not for fulfilment: 'row 2142' and 'row 2143' are the same person
      // starting two items, and the row ids are stripped from the step anyway — so keeping both
      // draws the same name twice with nothing to tell the dots apart.
      IMPLEMENTATION_ACTIONS.has(entry.action) ? '' : entry.comment,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Turn a proposal's flat history into the tracking view: one spine for the whole proposal, and a
 * separate branch per department once it fans out.
 *
 * The split is `requirement_name`: a row that names one is that department's own step, a row without
 * one moved the whole proposal. That is what makes the parallel phase legible — six departments
 * working at once produce six interleaved rows in a flat log, and reading which of them is behind is
 * impossible until they are pulled apart into their own tracks.
 */
// The stages an application still has ahead of it, by where it is now. F&B and CFO are conditional on
// the proposal (pax threshold, cost), so this is the ROUTE it would take from here rather than a
// promise every stage applies — which is why they are only ever drawn as hollow, unreached dots.
const REMAINING_STAGES: Readonly<Record<string, readonly string[]>> = {
  submitted: ['HOS/HOD review', 'Department review', 'Implementation', 'Approved'],
  'hos-hod-review': ['Department review', 'Implementation', 'Approved'],
  'fmb-review': ['CFO review', 'Department review', 'Implementation', 'Approved'],
  'cfo-review': ['Department review', 'Implementation', 'Approved'],
  'department-review': ['Implementation', 'Approved'],
  implementation: ['Approved'],
  'resubmission-required': ['Back to review', 'Approved'],
};

/**
 * The greyed-out stages still ahead, for a proposal currently at `stage`.
 *
 * `started` names stages already visibly under way, and they are dropped even when the application's
 * own status has not advanced to them. Departments work in PARALLEL: a proposal sits in
 * department_review until the LAST department decides, so the three that already approved can have
 * staff implementing while two others have not started — and listing "Implementation · Not reached
 * yet" directly beneath that work is a straight contradiction of what is on screen.
 */
export function upcomingFor(stage: string, started: readonly string[] = []): readonly string[] {
  const seen = new Set(started);
  return (REMAINING_STAGES[stage] ?? []).filter((name) => !seen.has(name));
}

function toBranches(grouped: Map<string, TrackingStep[]>): TrackingBranch[] {
  return [...grouped.entries()].map(([department, steps]) => ({
    department,
    label: departmentLabel(department),
    steps: [...steps].sort((a, b) => a.at.localeCompare(b.at)),
  }));
}

export function buildTracking(history: readonly ProposalHistoryEntry[], stage = ''): Tracking {
  const ordered = dedupe([...history].sort((a, b) => a.workflow_history_id - b.workflow_history_id));
  const main: TrackingStep[] = [];
  const review = new Map<string, TrackingStep[]>();
  const work = new Map<string, TrackingStep[]>();
  let ending: TrackingStep | null = null;

  for (const entry of ordered) {
    if (HIDDEN_ACTIONS.has(entry.action) || isSystemNoise(entry)) continue;
    if (entry.action === 'auto-complete') { ending = toStep(entry); continue; }
    // A cafeteria order belongs to F&B even though it names no requirement of its own.
    const department = entry.requirement_name ?? (ORDER_ACTIONS.has(entry.action) ? 'fmb' : null);
    if (!department) { main.push(toStep(entry)); continue; }
    // The phase split: deciding is Department review, doing is Implementation.
    const into = IMPLEMENTATION_ACTIONS.has(entry.action) ? work : review;
    into.set(department, [...(into.get(department) ?? []), toStep(entry)]);
  }

  const implementation = toBranches(work);
  return {
    main,
    branches: toBranches(review),
    implementation,
    ending,
    upcoming: upcomingFor(stage, implementation.length ? ['Implementation'] : []),
  };
}
