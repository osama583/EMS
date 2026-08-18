import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../../../core/auth/auth.service';
import { ClubService } from '../../../../../core/clubs/club.service';
import { ClubJoinRequestRecord } from '../../../../../core/clubs/club.models';
import { FeedbackBannerComponent } from '../../../../../shared/components/feedback-banner/feedback-banner';
import { LoadingStateComponent } from '../../../../../shared/components/loading-state/loading-state';
import { ProposalCommentDialogComponent } from '../../../../../shared/components/proposal-comment-dialog/proposal-comment-dialog';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

export const REJECTION_COMMENT_MIN_LENGTH = 20;

@Component({
  selector: 'app-hub-club-requests',
  imports: [FeedbackBannerComponent, LoadingStateComponent, ProposalCommentDialogComponent],
  templateUrl: './hub-club-requests.html',
  styleUrl: './hub-club-requests.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HubClubRequestsComponent {
  private readonly auth = inject(AuthService);
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currentUserId = this.auth.user()?.id ?? '';

  readonly rejectionCommentMinLength = REJECTION_COMMENT_MIN_LENGTH;

  readonly requests = signal<readonly ClubJoinRequestRecord[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly processingId = signal<string | null>(null);
  readonly rejectTarget = signal<ClubJoinRequestRecord | null>(null);
  readonly rejecting = signal(false);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.clubService.getInbox(this.currentUserId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (requests) => { this.requests.set(requests); this.loading.set(false); },
      error: () => { this.errorMessage.set('Join requests could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  approve(request: ClubJoinRequestRecord): void {
    this.processingId.set(request.id);
    this.clubService.approveJoinRequest(request.id, this.currentUserId).pipe(finalize(() => this.processingId.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.toast.success('Request approved', `${request.requester.displayName} was approved to join ${request.clubName}.`);
      },
      error: () => this.toast.error('Could not approve request', 'Please try again.'),
    });
  }

  openReject(request: ClubJoinRequestRecord): void { this.rejectTarget.set(request); }
  closeReject(): void { if (!this.rejecting()) this.rejectTarget.set(null); }
  confirmReject(comment: string): void {
    const request = this.rejectTarget();
    if (!request) return;
    this.rejecting.set(true);
    this.clubService.rejectJoinRequest(request.id, this.currentUserId, comment).pipe(finalize(() => this.rejecting.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.requests.update((items) => items.filter((item) => item.id !== request.id));
        this.rejectTarget.set(null);
        this.toast.info('Request rejected', `${request.requester.displayName}'s request to join ${request.clubName} was rejected.`);
      },
      error: (err) => this.toast.error('Could not reject request', err?.error?.message ?? 'Please try again.'),
    });
  }
}
