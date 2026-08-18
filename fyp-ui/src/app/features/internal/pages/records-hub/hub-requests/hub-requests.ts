import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../../../core/auth/auth.service';
import { DepartmentRequestKind, requestKindsForRole } from '../../../../../core/departments/department-workflow.config';
import { FmbSelection, ProposalDepartmentRequest, ProposalReviewRecord } from '../../../../../core/proposals/proposal-review.models';
import { ProposalWorkflowService } from '../../../../../core/proposals/proposal-workflow.service';
import { proposalSectionForUser } from '../../../../../core/proposals/proposal-visibility';
import { FormModalComponent } from '../../../../../shared/components/form-modal/form-modal';
import { InternalDataPageComponent } from '../../../../../shared/components/internal-data-page/internal-data-page';
import { InternalCellTone, InternalDataPageConfig, InternalDataRecord } from '../../../../../shared/components/internal-data-page/internal-data-page.models';
import { RecordsHubBucket } from '../records-hub';

// One row = one department request (ProposalDepartmentRequest) on one proposal, for one of the
// viewer's own requestKindsForRole() — e.g. an F&B viewer sees only the 'fmb'/'waterNormal' rows
// of proposals they're related to, a Logistics head only 'logistics' rows, etc. Bucketed via the
// SAME proposalSectionForUser() every other Inbox/Ongoing/History tab uses (see
// proposal-visibility.ts), just called once per (proposal, requestKind) pair instead of once per
// whole proposal, since a viewer's "ownership" of a proposal is really per-request-kind here.
interface RequestRow {
  readonly proposalId: number;
  readonly requestId: number;
  readonly requestKind: DepartmentRequestKind;
  readonly eventTitle: string;
  readonly shortIntroduction: string;
  readonly goals: string;
  readonly applicant: string;
  readonly applicantInitials: string;
  readonly schedule: string;
  readonly request: ProposalDepartmentRequest;
  readonly confirmed: boolean;
  readonly fmbSelections: readonly FmbSelection[];
}

const BUCKET_COPY: Readonly<Record<RecordsHubBucket, { title: string; description: string; empty: string }>> = {
  inbox: { title: 'Requests', description: 'Requests newly awaiting your action.', empty: 'Nothing needs your action' },
  ongoing: { title: 'Requests', description: 'Active event-service requests and assigned work.', empty: 'No ongoing requests found' },
  history: { title: 'Requests', description: 'Completed and historical event-service requests.', empty: 'No request history found' },
};

@Component({
  selector: 'app-hub-requests',
  imports: [InternalDataPageComponent, FormModalComponent],
  templateUrl: './hub-requests.html',
  styleUrl: './hub-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly workflow = inject(ProposalWorkflowService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly bucket = this.route.parent!.snapshot.data['bucket'] as RecordsHubBucket;
  private readonly copy = BUCKET_COPY[this.bucket];

  readonly proposals = signal<readonly ProposalReviewRecord[]>([]);
  readonly loading = signal(true);
  readonly detailsTarget = signal<RequestRow | null>(null);

  readonly rows = computed<readonly RequestRow[]>(() => {
    const user = this.auth.user();
    if (!user) return [];
    const routedKinds = requestKindsForRole(user);
    if (!routedKinds.length) return [];
    const out: RequestRow[] = [];
    for (const proposal of this.proposals()) {
      for (const request of proposal.requests) {
        if (!routedKinds.includes(request.department)) continue;
        if (proposalSectionForUser(user, proposal, request.department) !== this.bucket) continue;
        const confirmed = proposal.workflow.departmentConfirmations.find((c) => c.department === request.department)?.confirmed ?? false;
        out.push({
          proposalId: proposal.id,
          requestId: request.id,
          requestKind: request.department,
          eventTitle: proposal.eventTitle,
          shortIntroduction: proposal.shortIntroduction,
          goals: proposal.goals,
          applicant: proposal.applicant,
          applicantInitials: proposal.applicantInitials,
          schedule: request.schedule || proposal.schedule,
          request,
          confirmed,
          fmbSelections: (proposal.fmbSelections ?? []).filter((s) => s.requestFmbId === request.id),
        });
      }
    }
    return out;
  });

  readonly records = computed<readonly InternalDataRecord[]>(() => this.rows().map((row): InternalDataRecord => ({
    id: `${row.proposalId}:${row.requestKind}:${row.requestId}`,
    cells: {
      event: { primary: row.eventTitle },
      applicant: { primary: row.applicant },
      schedule: { primary: row.schedule },
      status: { primary: this.statusLabel(row), badge: true, tone: this.statusTone(row) },
    },
    mobile: {
      eyebrow: row.eventTitle, status: this.statusLabel(row), title: row.applicant, initials: row.applicantInitials,
      details: [{ icon: 'schedule', text: row.schedule }],
    },
  })));

  readonly config = computed<InternalDataPageConfig>(() => ({
    ariaLabel: this.copy.title, paginationLabel: `${this.copy.title} pagination`, rowsPerPageLabel: 'Rows per page', mobileListLabel: `${this.copy.title} cards`,
    header: { title: this.copy.title, description: this.copy.description, countLabel: `${this.rows().length} request${this.rows().length === 1 ? '' : 's'}` },
    search: { ariaLabel: 'Search requests', placeholder: 'Event or applicant' },
    columns: [
      { key: 'event', label: 'Event' },
      { key: 'applicant', label: 'Applicant' },
      { key: 'schedule', label: 'Schedule' },
      { key: 'status', label: 'Status' },
    ],
    actions: [],
    emptyTitle: this.copy.empty, emptyDescription: 'There are no requests matching this view.', pageSizeOptions: [5, 10, 25],
  }));

  constructor() {
    this.workflow.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (proposals) => { this.proposals.set(proposals); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openDetails(record: InternalDataRecord): void {
    const row = this.rows().find((r) => `${r.proposalId}:${r.requestKind}:${r.requestId}` === record.id);
    if (row) this.detailsTarget.set(row);
  }
  closeDetails(): void { this.detailsTarget.set(null); }

  private statusLabel(row: RequestRow): string {
    if (row.requestKind === 'fmb' || row.requestKind === 'waterNormal') {
      const selections = row.fmbSelections;
      if (!selections.length) return 'Awaiting orders';
      if (selections.every((s) => s.status === 'fulfilled' || s.status === 'cancelled')) return 'Fulfilled';
      if (selections.some((s) => s.status === 'pending')) return 'Orders pending review';
      if (selections.some((s) => s.status === 'resubmitted')) return 'Resubmitted to F&B';
      return 'In progress';
    }
    return row.confirmed ? 'Fulfilled' : 'Awaiting confirmation';
  }

  private statusTone(row: RequestRow): InternalCellTone {
    const label = this.statusLabel(row);
    if (label === 'Fulfilled') return 'success';
    if (label === 'Orders pending review' || label === 'Awaiting confirmation' || label === 'Awaiting orders') return 'warning';
    return 'blue';
  }
}
