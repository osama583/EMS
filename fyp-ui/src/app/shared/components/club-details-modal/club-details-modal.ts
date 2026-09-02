import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ClubRecord } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { FormFieldComponent } from '../form-controls/form-field';
import { FormModalComponent } from '../form-modal/form-modal';
import { ToastService } from '../toast/toast.service';

/**
 * A club's details, with the join action when — and only when — the viewer can actually take it.
 *
 * The AI assistant's club cards used to navigate to Discover Clubs with `?club=<id>`, which threw
 * the reader out of the conversation to a full page just to read three lines and press one button,
 * and did nothing at all for a club they were already in (Discover lists only JOINABLE clubs, so a
 * member's own club silently landed them on an unfiltered list). Events already had this popup;
 * clubs did not.
 *
 * WHO SEES THE BUTTON is the whole point. The viewer flags come from the same
 * `GET /clubs?viewerUserId=` the Clubs page reads, so a member, a president, or someone with a
 * request already pending gets the information and no action — offering "request to join" to
 * somebody who is already in the club is what the flags exist to prevent.
 */
@Component({
  selector: 'app-club-details-modal',
  imports: [FormModalComponent, FormFieldComponent],
  template: `
    <app-form-modal
      [open]="open()"
      [title]="club()?.name || 'Club'"
      primaryLabel="Send request"
      [loading]="sending()"
      [disabled]="!reason().trim()"
      [hidePrimary]="!canJoin()"
      (close)="dismiss()"
      (cancel)="dismiss()"
      (submit)="requestToJoin()"
    >
      @if (club(); as item) {
        <article class="club-details">
          @if (item.imageUrl) {
            <img class="club-details__image" [src]="item.imageUrl" [alt]="item.name" />
          }

          <div class="club-details__meta">
            <article class="club-details__summary-card">
              <span>Categories</span>
              <strong>{{ categoryNames(item) || '—' }}</strong>
            </article>
            <article class="club-details__summary-card">
              <span>Members</span>
              <strong>{{ item.memberCount }}</strong>
            </article>
          </div>

          <section class="club-details__about">
            <h3>About</h3>
            <p>{{ item.description || 'No description provided.' }}</p>
          </section>

          @if (standing(); as note) {
            <p class="club-details__standing">{{ note }}</p>
          }

          @if (canJoin()) {
            <app-form-field
              controlId="club-join-reason"
              label="Why do you want to join?"
              type="textarea"
              [placeholder]="'Tell the President of ' + item.name + ' why you would like to join.'"
              [required]="true"
              [value]="reason()"
              (valueChange)="reason.set($event)"
            />
          }
        </article>
      }
    </app-form-modal>
  `,
  styleUrl: './club-details-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClubDetailsModalComponent {
  private readonly clubService = inject(ClubService);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly club = input<ClubRecord | null>(null);
  readonly viewerUserId = input<string | null>(null);
  readonly close = output<void>();
  /** Emitted after a request is accepted, so the opener can refresh its copy of the club. */
  readonly joined = output<string>();

  readonly reason = signal('');
  readonly sending = signal(false);

  /** Why the join action is absent, in the viewer's own terms. Null when they can still join. */
  readonly standing = computed(() => {
    const item = this.club();
    if (!item) return null;
    if (item.viewerIsPresident) return 'You are the President of this club.';
    if (item.viewerIsMember) return 'You are already a member of this club.';
    if (item.viewerHasPendingRequest) return 'Your request to join is waiting for the President to decide.';
    if (!item.active) return 'This club is not currently running, so it is not open to join.';
    return null;
  });

  readonly canJoin = computed(() => !!this.club() && !this.standing() && !!this.viewerUserId());

  categoryNames(club: ClubRecord): string { return club.categories.map((c) => c.name).join(' / '); }

  dismiss(): void {
    if (this.sending()) return;
    this.reason.set('');
    this.close.emit();
  }

  requestToJoin(): void {
    const item = this.club();
    const userId = this.viewerUserId();
    if (!item || !userId || !this.reason().trim()) return;
    this.sending.set(true);
    this.clubService.sendJoinRequest(item.id, userId, this.reason().trim()).subscribe({
      next: () => {
        this.sending.set(false);
        this.toast.success('Request sent', `Your request to join ${item.name} was sent to the President.`);
        this.joined.emit(item.id);
        this.reason.set('');
        this.close.emit();
      },
      error: (err) => {
        this.sending.set(false);
        this.toast.error('Request could not be sent', err?.error?.message ?? 'Please try again.');
      },
    });
  }
}
