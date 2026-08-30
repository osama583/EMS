import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { NotificationPreference, ReminderKey } from '../../../core/events/event-engagement.models';
import { SavedEventsService } from '../../../core/events/saved-events.service';
import { ToastService, apiErrorMessage } from '../../../shared/components/toast/toast.service';

/** Which My Events tab this instance belongs to — decides which toggles it owns. */
export type ReminderScope = 'saved' | 'registered';

interface ToggleDefinition {
  readonly key: ReminderKey;
  readonly label: string;
  readonly description: string;
}

// Each tab owns only its own reminders, so the Saved tab cannot switch off an
// email about an event you are actually attending, and vice versa. Splitting
// them this way is the whole point of the feature: "remind me about what I am
// going to" and "nag me about what I bookmarked" are different appetites.
const TOGGLES: Record<ReminderScope, readonly ToggleDefinition[]> = {
  saved: [
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
  ],
  registered: [
    {
      key: 'registeredStartingReminder',
      label: 'Remind me before an event I am registered for',
      description: 'So a date you have a place at does not pass you by.',
    },
  ],
};

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

  readonly scope = input.required<ReminderScope>();

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly saving = signal<ReminderKey | null>(null);
  readonly preferences = signal<NotificationPreference | null>(null);

  readonly toggles = computed(() => TOGGLES[this.scope()]);

  /** How many of THIS tab's reminders are on — drives the summary line. */
  readonly enabledCount = computed(() => {
    const preferences = this.preferences();
    if (!preferences) return 0;
    return this.toggles().filter((toggle) => preferences[toggle.key]).length;
  });

  toggleOpen(): void {
    const next = !this.open();
    this.open.set(next);
    // Loaded on first open rather than on construction: a reader who never
    // opens the panel costs no request, and every tab mounts this component.
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

    // Sends ONLY this key. The server merges it over the stored row, so this
    // tab can never overwrite a toggle belonging to the other tab.
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
