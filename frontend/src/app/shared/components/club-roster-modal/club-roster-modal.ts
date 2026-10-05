import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ClubMemberRecord, ClubRecord } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { FormModalComponent } from '../form-modal/form-modal';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog';
import { ClubLogsPanelComponent } from '../club-logs-panel/club-logs-panel';
import { ToastService, apiErrorMessage } from '../toast/toast.service';

// Club popup opened from My Clubs. Two views behind one modal: the roster (who belongs to this
// club now, read-only for a member) and, for the President, the club's log — who joined, who left,
// who handed over, what the club has proposed and what it has been asked.
//
// The log is a tab rather than a second modal because it answers questions about the same people
// the roster lists: "when did they join" and "who else has been here" are one thought.
@Component({
  selector: 'app-club-roster-modal',
  imports: [FormModalComponent, ConfirmDialogComponent, ClubLogsPanelComponent],
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

  readonly view = signal<'roster' | 'logs'>('roster');
  // Only the President gets the log: it names who was removed and by whom, which is not the
  // roster's business. The server enforces the same rule, so hiding the tab is presentation,
  // not the access check.
  readonly canViewLogs = computed(() => !!this.club()?.viewerIsPresident);

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
    // Reopening on a different club must not leave the reader on a tab that club has no room
    // for — a member's popup has no Logs tab to be parked on.
    effect(() => {
      if (!this.canViewLogs()) this.view.set('roster');
    });
  }

  setView(view: 'roster' | 'logs'): void { this.view.set(view); }

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
