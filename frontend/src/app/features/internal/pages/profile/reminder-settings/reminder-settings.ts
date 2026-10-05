import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { NotificationPreference, ReminderKey } from '../../../../../core/events/event-engagement.models';
import { SavedEventsService } from '../../../../../core/events/saved-events.service';
import { ToastService, apiErrorMessage } from '../../../../../shared/components/toast/toast.service';

interface ToggleDefinition {
  readonly key: ReminderKey;
  readonly label: string;
  readonly description: string;
}

// One list, one place. These three are a single row server-side, and they are
// all configured here on the profile — "remind me before what I am going to"
// and "nag me about what I bookmarked" are different appetites, but both are
// account settings rather than properties of the list you happen to be reading.
const TOGGLES: readonly ToggleDefinition[] = [
  {
    key: 'savedCapacityReminder',
    label: 'Tell me when a saved event is filling up',
    description: 'Emailed once a saved event you have not registered for is nearly full.',
  },
  {
    key: 'savedStartingReminder',
    label: 'Remind me before a saved event I have not registered for',
    description: 'A last nudge while there is still time to register.',
  },
  {
    key: 'registeredStartingReminder',
    label: 'Remind me before an event I am registered for',
    description: 'So a date you have a place at does not pass you by.',
  },
];

@Component({
  selector: 'app-reminder-settings',
  imports: [],
  templateUrl: './reminder-settings.html',
  styleUrl: './reminder-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReminderSettingsComponent {
  private readonly savedEvents = inject(SavedEventsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly saving = signal<ReminderKey | null>(null);
  readonly preferences = signal<NotificationPreference | null>(null);

  readonly toggles = TOGGLES;

  /** How many reminders are on — drives the summary line while collapsed. */
  readonly enabledCount = computed(() => {
    const preferences = this.preferences();
    if (!preferences) return 0;
    return this.toggles.filter((toggle) => preferences[toggle.key]).length;
  });

  toggleOpen(): void {
    const next = !this.open();
    this.open.set(next);
    // Loaded on first open rather than on construction: a reader who came to
    // the profile for their name or their password costs no request for a
    // panel they never expand.
    if (next && this.preferences() === null && !this.loading()) this.load();
  }

  isOn(key: ReminderKey): boolean {
    return this.preferences()?.[key] ?? true;
  }

  private load(): void {
    this.loading.set(true);
    this.savedEvents
      .getNotificationPreferences()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preferences) => {
          this.preferences.set(preferences);
          this.loading.set(false);
        },
        error: () => {
          // Absence of a stored row is a valid "all on" state server-side, so a
          // failure here falls back to the same defaults rather than blocking
          // the panel — the reader can still change a toggle, which is a write.
          this.preferences.set({
            savedCapacityReminder: true,
            savedStartingReminder: true,
            registeredStartingReminder: true,
          });
          this.loading.set(false);
        },
      });
  }

  setToggle(key: ReminderKey, event: Event): void {
    const next = (event.target as HTMLInputElement).checked;
    const previous = this.preferences();
    if (!previous) return;

    // Optimistic: the switch moves immediately and is put back only if the
    // write actually fails, so a slow connection never feels like a dead
    // control.
    this.preferences.set({ ...previous, [key]: next });
    this.saving.set(key);

    // Sends ONLY this key, which the server merges over the stored row - so a
    // switch flipped against a stale read cannot carry the other two back with
    // it.
    this.savedEvents
      .updateNotificationPreferences({ [key]: next })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.preferences.set(saved);
          this.saving.set(null);
        },
        error: (error) => {
          this.preferences.set(previous);
          this.saving.set(null);
          this.toast.error(
            'Could not save your reminder setting',
            apiErrorMessage(error, 'Please try again.'),
          );
        },
      });
  }
}
