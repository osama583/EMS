import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ClubRecord, ClubUserSummary } from '../../../core/clubs/club.models';
import { ClubService } from '../../../core/clubs/club.service';
import { SelectOption } from '../form-controls/form-controls.models';
import { FormModalComponent } from '../form-modal/form-modal';
import { SearchableDropdownComponent } from '../searchable-dropdown/searchable-dropdown';
import { ToastService, apiErrorMessage } from '../toast/toast.service';

// President self-service popup: a sitting President can't leave or be removed from their own club
// (DELETE /clubs/{id}/members/{userId} always blocks it), so this is the only way off the role — name
// an eligible (student) replacement and send it to a Club Admin for approval.
@Component({
  selector: 'app-president-change-request-modal',
  imports: [FormModalComponent, SearchableDropdownComponent],
  templateUrl: './president-change-request-modal.html',
  styleUrl: './president-change-request-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresidentChangeRequestModalComponent {
  private readonly clubService = inject(ClubService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly club = input<ClubRecord | null>(null);
  readonly close = output<void>();
  readonly submitted = output<void>();

  readonly candidates = signal<readonly ClubUserSummary[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly selectedId = signal('');
  readonly errorMessage = signal('');

  readonly candidateOptions = computed<readonly SelectOption[]>(() =>
    this.candidates().map((user) => ({ value: user.id, label: user.displayName, description: `Student · ${user.email}` })),
  );
  readonly isValid = computed(() => this.selectedId().length > 0);

  constructor() {
    effect(() => {
      if (this.open() && this.club()) {
        this.selectedId.set('');
        this.errorMessage.set('');
        this.loadCandidates();
      }
    });
  }

  private loadCandidates(): void {
    this.loading.set(true);
    this.clubService.getEligiblePresidents().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (users) => { this.candidates.set(users.filter((user) => user.id !== this.club()?.president?.id)); this.loading.set(false); },
      error: () => { this.errorMessage.set('Eligible students could not be loaded.'); this.loading.set(false); },
    });
  }

  setSelectedId(value: string | readonly string[]): void { this.selectedId.set(Array.isArray(value) ? (value[0] ?? '') : value); }

  submit(): void {
    const club = this.club();
    if (!club || !this.isValid() || this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    this.clubService.requestPresidentChange(club.id, this.selectedId())
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Request submitted', `Your request to hand ${club.name} to a new President is awaiting a Club Admin's decision.`);
          this.submitted.emit();
        },
        error: (err) => this.errorMessage.set(apiErrorMessage(err, 'The request could not be submitted. Please try again.')),
      });
  }
}
