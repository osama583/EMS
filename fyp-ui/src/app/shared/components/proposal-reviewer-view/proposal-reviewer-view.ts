import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { DepartmentRequestKind } from '../../../core/departments/department-workflow.config';
import { ProposalConversation } from '../../../core/proposals/proposal-conversation.models';
import { ProposalReviewRecord } from '../../../core/proposals/proposal-review.models';
import { DEPARTMENT_LABELS, ProposalStage, ReviewerCommentEntry, initialsFor, reviewerCommentEntry, stageLabel } from '../../../core/proposals/proposal-status.models';
import { ProposalWorkflowService } from '../../../core/proposals/proposal-workflow.service';
import { ConversationThreadComponent } from '../conversation-thread/conversation-thread';
import { EditableRow } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { ProposalKpiBarComponent } from '../proposal-kpi-bar/proposal-kpi-bar';
import { ProposalOverviewComponent } from '../proposal-overview/proposal-overview';
import { ProposalSummaryGridComponent } from '../proposal-overview/proposal-summary-grid';
import { ProposalSummaryField } from '../proposal-overview/proposal-summary-layout';
import { ProposalSectionComponent } from '../proposal-section/proposal-section';
import { ProposalTableColumn, ProposalTableComponent } from '../proposal-table/proposal-table';

import { AuthService } from '../../../core/auth/auth.service';
import { SystemConfigService } from '../../../core/config/system-config.service';
import { ToastService, apiErrorMessage } from '../toast/toast.service';
import { COMMENTS_DOCK_QUERY, viewportMatches } from '../../viewport-query';

interface RequirementTable {
  readonly key: DepartmentRequestKind;
  readonly label: string;
  readonly rows: readonly EditableRow[];
}

interface TimelineStep {
  readonly stage: string;
  readonly label: string;
  readonly note: string;
  readonly active: boolean;
  readonly done: boolean;
}

const REQUIREMENT_LABELS: Readonly<Record<DepartmentRequestKind, string>> = {
  logistics: 'Logistics',
  campusTour: 'Campus Tour',
  waterNormal: 'Mineral Water',
  soundLight: 'Sound & Light',
  photoVideo: 'Photography / Videography',
  transportation: 'Transportation',
  fmb: 'Food & Beverage',
  fundingPurchase: 'Funding / Purchase',
};

const STAGE_ORDER: readonly ProposalStage[] = [
  ProposalStage.HosHodReview,
  ProposalStage.FmbReview,
  ProposalStage.CfoReview,
  ProposalStage.DepartmentReview,
  ProposalStage.Approved,
];

function parseEventDate(rawStr: string): Date | null {
  if (!rawStr) return null;
  const clean = rawStr.split(',')[0].split('·')[0].trim();
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) return parsed;

  const match = clean.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const monthStr = match[2].slice(0, 3).toLowerCase();
    const year = parseInt(match[3], 10);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = months.indexOf(monthStr);
    if (monthIndex !== -1) {
      return new Date(year, monthIndex, day);
    }
  }
  return null;
}

@Component({
  selector: 'app-proposal-reviewer-view',
  imports: [ProposalTableComponent, FormModalComponent, ProposalKpiBarComponent, ProposalSectionComponent, ProposalOverviewComponent, ProposalSummaryGridComponent, ConversationThreadComponent],
  templateUrl: './proposal-reviewer-view.html',
  styleUrl: './proposal-reviewer-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProposalReviewerViewComponent {
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly configService = inject(SystemConfigService);
  private readonly toast = inject(ToastService);

  readonly proposal = input<ProposalReviewRecord | null>(null);
  // Unit + Level model: approve/reject/resubmit no longer need a `role` input at all — the
  // acting reviewer is identified server-side by their own email (see proposal-workflow.
  // repository.ts's reviewerEmail param), which this component already has via AuthService.
  readonly readOnly = input(false);
  readonly actionComplete = output<number>();

  readonly approving = signal(false);
  readonly rejecting = signal(false);
  readonly resubmitting = signal(false);
  readonly cancelling = signal(false);
  readonly approveConfirm = signal(false);
  readonly resubmitConfirm = signal(false);
  readonly rejectConfirm = signal(false);
  readonly cancelConfirm = signal(false);
  readonly rejectCommentError = signal(false);
  readonly comment = signal('');
  readonly commentValidationError = signal(false);

  // Per-partner conversation threads, already scoped server-side to what the CURRENT viewer may
  // see — an authority gets back only their own thread (length 1), the applicant/co-owner gets
  // every thread on the proposal (length may be > 1), which is what decides list-vs-single-thread
  // rendering below, with no separate "am I the applicant" input needed.
  readonly conversations = signal<readonly ProposalConversation[]>([]);
  readonly activeConversationId = signal<string | null>(null);

  // Below the dock breakpoint .prv-layout is a single column, so the whole .prv-panel — Workflow
  // Actions AND the conversation — stacks under the full proposal detail. Workflow Actions is
  // fine down there (it is the end of the read), but burying the conversation at the bottom of
  // the page made it read as missing. Docked, it behaves the way the panel does on a wide screen:
  // present on the right, opened when you want it. See shared/viewport-query.ts and
  // styles/_comments-dock.scss.
  protected readonly commentsDocked = viewportMatches(COMMENTS_DOCK_QUERY);
  protected readonly commentsOpen = signal(false);
  protected readonly hasComments = computed(() => this.conversations().length > 0 || this.reviewerComments().length > 0);
  // Inline in its column on a wide screen; only while opened from the tab once docked.
  protected readonly commentsVisible = computed(() => !this.commentsDocked() || this.commentsOpen());

  readonly conversationSummaries = computed(() =>
    this.conversations().map((conversation) => {
      const partnerName = conversation.conversationId.startsWith('task:')
        ? (DEPARTMENT_LABELS[conversation.partnerName] ?? conversation.partnerName)
        : conversation.partnerName;
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      return {
        conversationId: conversation.conversationId,
        partnerName,
        partnerRoleLabel: conversation.partnerRoleLabel,
        initials: initialsFor(partnerName),
        lastMessage: lastMsg?.text ?? '',
        lastMessageAt: lastMsg ? this.formatListTime(lastMsg.createdAt) : '',
      };
    }),
  );

  // Matches reviewer-comments-drawer.ts's own formatListTime — same "time today, date otherwise"
  // stamp for a conversation-list row, kept local since neither side is currently shared.
  protected formatListTime(iso: string): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const isToday = date.toDateString() === new Date().toDateString();
    return isToday
      ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  readonly activeConversation = computed(() => {
    const id = this.activeConversationId() ?? (this.conversations().length === 1 ? this.conversations()[0].conversationId : null);
    return id ? this.conversations().find((c) => c.conversationId === id) ?? null : null;
  });

  readonly activeSummary = computed(() => {
    const active = this.activeConversation();
    return active ? this.conversationSummaries().find((c) => c.conversationId === active.conversationId) ?? null : null;
  });

  constructor() {
    effect(() => {
      const proposal = this.proposal();
      this.activeConversationId.set(null);
      if (!proposal) { this.conversations.set([]); return; }
      this.workflow.getConversations(proposal.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (conversations) => this.conversations.set(conversations),
        error: () => this.conversations.set([]),
      });
    });
  }

  /**
   * `applicant_department_or_school` is nullable in the schema (staff have a department, some
   * accounts have neither), so this section used to render a third empty card whenever it was
   * missing. Handed to the summary grid as data so the blank one is dropped and Full Name / Email
   * close up into a two-column row instead of leaving the gap behind.
   */
  readonly applicantFields = computed<readonly ProposalSummaryField[]>(() => {
    const item = this.proposal();
    return [
      { label: 'Full Name', value: item?.applicant },
      { label: 'Email', value: item?.applicantEmail },
      { label: 'Department / School', value: item?.applicantDepartment },
    ];
  });

  readonly stage = computed<ProposalStage | null>(() => this.proposal()?.workflow.stage ?? null);
  readonly stageLabel = computed(() => this.stage() ? stageLabel(this.stage()!) : '');
  // Which stage a role owns is now a server-side authorization decision (system.md's "the
  // backend owns the workflow" principle). The client-side approximation below exists only to
  // decide whether to render the action panel at all — the server still validates and rejects
  // any action from a role that doesn't actually own the current stage, regardless of what the
  // UI shows. `readOnly` (an explicit input from the parent dispatch component) is the primary
  // signal; this computed is a display convenience, not a security boundary.
  readonly canAct = computed(() => !this.readOnly());

  readonly currentUser = computed(() => this.auth.user());

  readonly isSubmitterOrCoOwner = computed(() => {
    const user = this.currentUser();
    const proposal = this.proposal();
    if (!user || !proposal) return false;

    const userEmail = (user.email || '').trim().toLowerCase();
    const userName = (user.displayName || '').trim().toLowerCase();
    const userHandle = userEmail.split('@')[0] || '';

    const applicantEmail = (proposal.applicantEmail || '').trim().toLowerCase();
    const applicantName = (proposal.applicant || '').trim().toLowerCase();
    const isSubmitter = (
      (userEmail && applicantEmail && userEmail === applicantEmail) ||
      (userName && applicantName && userName === applicantName) ||
      (userHandle && applicantEmail && applicantEmail.startsWith(userHandle))
    );
    if (isSubmitter) return true;

    if (proposal.coOwners && proposal.coOwners.length) {
      const isCoOwner = proposal.coOwners.some((coOwner) => {
        const coEmail = String(coOwner['email'] || '').trim().toLowerCase();
        const coName = String(coOwner['name'] || '').trim().toLowerCase();
        return (
          (userEmail && coEmail && userEmail === coEmail) ||
          (userName && coName && userName === coName) ||
          (userHandle && coEmail && coEmail.startsWith(userHandle))
        );
      });
      if (isCoOwner) return true;
    }

    return false;
  });

  // The server computes this (see server/services/proposal-projection.service.js's
  // canStillBeCancelled) using the same CANCELLATION_DEADLINE_DAYS config it enforces on
  // POST /cancel, so the button state and the actual rule can never drift apart. The local
  // date-parsing fallback below only applies to records that predate the field.
  readonly isWithinCancellationWindow = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return false;
    if (proposal.cancellationOpen !== undefined) return proposal.cancellationOpen;

    const limitDays = this.configService.cancellationDaysLimit();
    let dateStr = proposal.scheduleRows?.[0]?.['date'] as string | undefined;
    if (!dateStr && proposal.schedule) dateStr = proposal.schedule.split('\u00b7')[0]?.trim();
    if (!dateStr) return false;
    const eventDate = parseEventDate(dateStr);
    if (!eventDate || isNaN(eventDate.getTime())) return false;
    const deadline = new Date(eventDate);
    deadline.setDate(deadline.getDate() - limitDays);
    deadline.setHours(23, 59, 59, 999);
    return Date.now() <= deadline.getTime();
  });

  // `readOnly` only suppresses the reviewer actions (approve/reject/resubmit) above — it's set
  // whenever an applicant opens their own proposal from Ongoing (they own no reviewer stage
  // there), which must not also hide their own, unrelated ability to cancel their application.
  // Approved/Rejected/Cancelled are all terminal for cancellation server-side (authorize_cancel
  // in authorization.py) — once fully approved, the applicant can no longer self-cancel.
  readonly canCancel = computed(() => {
    const proposal = this.proposal();
    if (!proposal) return false;
    if (
      proposal.workflow.stage === ProposalStage.Cancelled
      || proposal.workflow.stage === ProposalStage.Rejected
      || proposal.workflow.stage === ProposalStage.Approved
    ) {
      return false;
    }
    return this.isSubmitterOrCoOwner() && this.isWithinCancellationWindow();
  });

  readonly commentRequired = computed(() =>
    this.comment().trim().length === 0
  );

  /** Timeline steps for approval history sidebar */
  readonly timelineSteps = computed<readonly TimelineStep[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const currentStage = proposal.workflow.stage;
    const currentIndex = STAGE_ORDER.indexOf(currentStage as ProposalStage);

    const steps: TimelineStep[] = STAGE_ORDER.map((stage, index) => ({
      stage,
      label: stageLabel(stage),
      note: this.noteForStage(proposal, stage),
      active: stage === currentStage,
      done: index < currentIndex || currentStage === ProposalStage.Approved,
    }));

    // Add terminal states if applicable
    if (currentStage === ProposalStage.Rejected) {
      steps.push({ stage: ProposalStage.Rejected, label: 'Rejected', note: proposal.workflow.rejectedReason ?? '', active: true, done: false });
    }
    if (currentStage === ProposalStage.ResubmissionRequired) {
      steps.push({ stage: ProposalStage.ResubmissionRequired, label: 'Revision Required', note: 'Awaiting applicant resubmission.', active: true, done: false });
    }

    return steps;
  });

  /** Comments left by reviewers visible to all */
  readonly reviewerComments = computed<readonly ReviewerCommentEntry[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    const entry = reviewerCommentEntry(proposal.workflow);
    return entry ? [entry] : [];
  });

  readonly coOwnerColumns: readonly ProposalTableColumn[] = [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' },
  ];
  readonly organizerColumns: readonly ProposalTableColumn[] = [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'notes', label: 'Notes' },
  ];
  readonly importantPeopleColumns: readonly ProposalTableColumn[] = [
    { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'organization', label: 'Organization' }, { key: 'designation', label: 'Designation' },
  ];
  readonly guestColumns: readonly ProposalTableColumn[] = [
    { key: 'guestType', label: 'Guest Type' }, { key: 'count', label: 'Count' }, { key: 'notes', label: 'Notes' },
  ];
  readonly scheduleColumns: readonly ProposalTableColumn[] = [
    { key: 'date', label: 'Date' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'location', label: 'Location' },
  ];
  readonly agendaColumns: readonly ProposalTableColumn[] = [
    { key: 'time', label: 'Time' }, { key: 'activity', label: 'Activity' }, { key: 'location', label: 'Location' }, { key: 'pic', label: 'PIC' }, { key: 'notes', label: 'Notes' },
  ];
  readonly discussionColumns: readonly ProposalTableColumn[] = [{ key: 'topic', label: 'Topic' }];
  readonly requestColumns: readonly ProposalTableColumn[] = [
    { key: 'item', label: 'Requirement / Item', width: '15rem' },
    { key: 'quantity', label: 'Quantity', width: '10rem' },
    { key: 'schedule', label: 'Schedule', width: '15rem' },
    { key: 'location', label: 'Location', width: '12rem' },
    { key: 'notes', label: 'Notes', width: '17rem' },
  ];

  readonly requirementTables = computed<readonly RequirementTable[]>(() => {
    const proposal = this.proposal();
    if (!proposal) return [];
    // Both are detail-only fields (see ProposalReviewRecord); this view always receives a detail
    // record, and an empty list is the honest fallback if it ever does not.
    return (proposal.selectedRequirements ?? []).map((key) => ({
      key,
      label: REQUIREMENT_LABELS[key],
      rows: (proposal.requests ?? []).filter((request) => request.department === key).map((request) => ({ ...request })),
    }));
  });

  onCommentInput(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
    if (this.commentValidationError()) this.commentValidationError.set(false);
  }

  openCancelModal(): void {
    this.cancelConfirm.set(true);
  }

  confirmCancel(): void {
    const proposal = this.proposal();
    const user = this.currentUser();
    if (!proposal || !user) return;
    this.cancelling.set(true);
    this.workflow.cancelProposal(proposal.id).pipe(
      finalize(() => this.cancelling.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.cancelConfirm.set(false);
        this.toast.success('Application cancelled', 'Every task raised for this event has been cancelled too.');
        this.actionComplete.emit(proposal.id);
      },
      error: (err) => {
        this.cancelConfirm.set(false);
        this.toast.error('Could not cancel this application', apiErrorMessage(err, 'Please try again.'));
      },
    });
  }

  openApproveModal(): void {
    this.approveConfirm.set(true);
  }

  confirmApprove(): void {
    this.approveConfirm.set(false);
    this.approve();
  }

  approve(): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.approving.set(true);
    this.workflow.approveAsReviewer(proposal.id).pipe(
      finalize(() => this.approving.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => { this.toast.success('Proposal approved', 'It has moved to the next stage of the workflow.'); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not approve this proposal', apiErrorMessage(err, 'Please try again.')),
    });
  }

  openResubmitModal(): void {
    if (this.comment().trim().length === 0) {
      this.commentValidationError.set(true);
      return;
    }
    this.commentValidationError.set(false);
    this.resubmitConfirm.set(true);
  }

  confirmResubmit(): void {
    this.resubmitConfirm.set(false);
    this.resubmit(this.comment().trim());
  }

  openRejectModal(): void {
    if (this.comment().trim().length === 0) {
      this.rejectCommentError.set(true);
      return;
    }
    this.rejectCommentError.set(false);
    this.rejectConfirm.set(true);
  }

  confirmReject(): void {
    this.confirmRejectAction();
  }

  private confirmRejectAction(): void {
    if (this.comment().trim().length === 0) {
      this.rejectCommentError.set(true);
      return;
    }
    this.reject(this.comment().trim());
  }

  reject(reason: string): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.rejecting.set(true);
    this.workflow.rejectAsReviewer(proposal.id, reason).pipe(
      finalize(() => this.rejecting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => { this.rejectConfirm.set(false); this.toast.warning('Proposal rejected', 'The applicant has been given your reason.'); this.actionComplete.emit(proposal.id); },
      error: (err) => { this.rejectConfirm.set(false); this.toast.error('Could not reject this proposal', apiErrorMessage(err, 'Please try again.')); },
    });
  }

  private resubmit(comment: string): void {
    const proposal = this.proposal();
    if (!proposal) return;
    this.resubmitting.set(true);
    this.workflow.sendBackAsReviewer(proposal.id, comment).pipe(
      finalize(() => this.resubmitting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => { this.toast.info('Sent back to the applicant', 'They will see your comment and can resubmit.'); this.comment.set(''); this.actionComplete.emit(proposal.id); },
      error: (err) => this.toast.error('Could not send this back', apiErrorMessage(err, 'Please try again.')),
    });
  }

  private noteForStage(proposal: ProposalReviewRecord, stage: ProposalStage): string {
    if (stage === ProposalStage.Approved) return proposal.workflow.stage === ProposalStage.Approved ? 'All confirmations received.' : '';
    if (stage === ProposalStage.DepartmentReview) {
      const confirmations = proposal.workflow.departmentConfirmations;
      if (!confirmations.length) return '';
      const done = confirmations.filter(c => c.confirmed).length;
      return `${done} / ${confirmations.length} departments confirmed`;
    }
    return '';
  }
}
