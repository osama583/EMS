import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ClubMemberRecord, ClubRecord } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { FormModalComponent } from '../form-modal/form-modal';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { ToastService, apiErrorMessage } from '../toast/toast.service';

// Roster popup opened from My Clubs — lets a member or President see who else belongs to a club (name,
// email, role, date joined), read-only.
@Component({
  selector: 'app-club-roster-modal',
  imports: [FormModalComponent, ConfirmDialogComponent],
  templateUrl: './club-roster-modal.html',
  styleUrl: './club-roster-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubRosterModalComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly club = input<ClubRecord | null>(null);
  readonly close = output<void>();
  // Emitted after a member is removed, so the parent can refresh its own club list (memberCount).
  readonly membershipChanged = output<void>();

  readonly members = signal<readonly ClubMemberRecord[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly removeTarget = signal<ClubMemberRecord | null>(null);
  readonly removing = signal(false);

  constructor() {
    effect(() => {
      const club = this.club();
      if (this.open() && club) this.loadMembers(club.id);
    });
  }

  private loadMembers(clubId: string): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.clubService.getClubMembers(clubId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (members) => { this.members.set(members); this.loading.set(false); },
      error: () => { this.errorMessage.set('Members could not be loaded. Please try again.'); this.loading.set(false); },
    });
  }

  isPresident(member: ClubMemberRecord): boolean { return member.user.id === this.club()?.president?.id; }

  // Only the President can remove members here, and never themselves.
  canRemove(member: ClubMemberRecord): boolean {
    return !!this.club()?.viewerIsPresident && !this.isPresident(member);
  }

  openRemove(member: ClubMemberRecord): void { this.removeTarget.set(member); }
  closeRemove(): void { if (!this.removing()) this.removeTarget.set(null); }
  confirmRemove(): void {
    const club = this.club();
    const target = this.removeTarget();
    if (!club || !target) return;
    this.removing.set(true);
    this.clubService.removeMember(club.id, target.user.id)
      .pipe(finalize(() => this.removing.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.members.update((members) => members.filter((member) => member.user.id !== target.user.id));
          this.removeTarget.set(null);
          this.toast.success('Member removed', `${target.user.displayName} was removed from ${club.name}.`);
          this.membershipChanged.emit();
        },
        error: (err) => {
          this.removeTarget.set(null);
          this.toast.error('Could not remove member', apiErrorMessage(err, 'Please try again.'));
        },
      });
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
