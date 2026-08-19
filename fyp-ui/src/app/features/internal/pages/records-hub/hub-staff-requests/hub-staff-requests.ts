import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { CafeteriaStaffRequestService } from '../../../../../core/cafeterias/cafeteria-staff-request.service';
import { CafeteriaStaffRequest, CafeteriaStaffRequestAction } from '../../../../../core/cafeterias/cafeteria-staff-request.models';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { LoadingStateComponent } from '../../../../../shared/components/loading-state/loading-state';
import { ConfirmDialogComponent } from '../../../../../shared/components/confirm-dialog/confirm-dialog';
import { ProposalCommentDialogComponent } from '../../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

export const REJECTION_COMMENT_MIN_LENGTH = 20;

const ACTION_LABELS: Readonly<Record<CafeteriaStaffRequestAction, string>> = {
  add: 'Add staff member',
  edit: 'Change assignment',
  remove: 'Remove staff member',
};

// Cafeteria Admin's queue of roster changes Managers have asked for. A Manager cannot write
// user_unit_roles themselves, so every add/edit/remove waits here for a decision — which makes it
// Inbox work, not a page the Admin has to remember to visit. Approving applies the roster change
// in the same transaction as the decision (see backend app/api/cafeterias.py).
@Component({
  selector: 'app-hub-staff-requests',
  imports: [FeedbackBannerComponent, LoadingStateComponent, ProposalCommentDialogComponent, ConfirmDialogComponent],
  templateUrl: './hub-staff-requests.html',
  styleUrl: './hub-staff-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubStaffRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly service = inject(CafeteriaStaffRequestService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly rejectionCommentMinLength = REJECTION_COMMENT_MIN_LENGTH;

  readonly requests = signal<readonly CafeteriaStaffRequest[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly processingId = signal<string | null>(null);
  readonly approveTarget = signal<CafeteriaStaffRequest | null>(null);
  readonly rejectTarget = signal<CafeteriaStaffRequest | null>(null);
  readonly rejecting = signal(false);

  constructor() {
    this.service.inbox$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (requests) => { this.requests.set(requests); this.loading.set(false); },
      error: () => { this.errorMessage.set('Staff requests could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  actionLabel(action: CafeteriaStaffRequestAction): string { return ACTION_LABELS[action] ?? action; }

  // Who the request is about — a named account, or the address an 'add' would create one for.
  subjectOf(request: CafeteriaStaffRequest): string {
    return request.displayName || request.email || 'Unnamed staff member';
  }

  openApprove(request: CafeteriaStaffRequest): void { this.approveTarget.set(request); }
  closeApprove(): void { if (!this.processingId()) this.approveTarget.set(null); }
  confirmApprove(): void {
    const request = this.approveTarget();
    if (request) this.approve(request);
  }

  approve(request: CafeteriaStaffRequest): void {
    this.processingId.set(request.id);
    this.service.approve(request.id, this.currentUserId).pipe(
      finalize(() => this.processingId.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.approveTarget.set(null);
        this.toast.success('Request approved', `${this.subjectOf(request)} — ${request.cafeteriaName}.`);
      },
      error: (err) => {
        this.approveTarget.set(null);
        this.toast.error('Could not approve request', err?.error?.message ?? 'Please try again.');
      },
    });
  }

  openReject(request: CafeteriaStaffRequest): void { this.rejectTarget.set(request); }
  closeReject(): void { if (!this.rejecting()) this.rejectTarget.set(null); }
  confirmReject(comment: string): void {
    const request = this.rejectTarget();
    if (!request) return;
    this.rejecting.set(true);
    this.service.reject(request.id, this.currentUserId, comment).pipe(
      finalize(() => this.rejecting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.rejectTarget.set(null);
        this.toast.info('Request rejected', `${this.subjectOf(request)} — ${request.cafeteriaName}.`);
      },
      error: (err) => this.toast.error('Could not reject request', err?.error?.message ?? 'Please try again.'),
    });
  }
}
