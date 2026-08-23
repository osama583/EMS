import { DestroyRef, Injectable, Signal, effect, inject, signal, untracked } from '@angular/core';

const WARNING_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours
const BEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TICK_MS = 60 * 1000; // recheck every minute — animation/sound only need minute-granularity

export interface ReminderTask {
  readonly id: string;
  readonly deadline: string; // ISO date-time
  /** True while this task is still eligible for reminders (e.g. status === 'approved',
   * before "Start Preparing"). Reminders stop the instant this flips false. */
  readonly awaitingStart: boolean;
}

// Deadline-based reminders for Cafeteria Staff tasks only (per spec — not used by the 5
// row-assignment departments). Purely client-side/tab-open: no service worker, no push. Starting
// 3h before an unstarted task's deadline, `urgentIds` includes it (the page binds a continuous
// CSS pulse animation to that) and a synthesized beep plays once per elapsed hour until the task
// is started, at which point both stop immediately.
@Injectable({ providedIn: 'root' })
export class DeadlineReminderService {
  private readonly destroyRef = inject(DestroyRef);
  private audioContext: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Per-task: the epoch ms of the last hourly beep fired for it, so a 60s tick doesn't refire.
  private readonly lastBeepAt = new Map<string, number>();

  readonly urgentIds = signal<ReadonlySet<string>>(new Set());

  /** Call once with the page's live task signal. Recomputes on every signal change and every
   * minute while any task is in its warning window. */
  startWatching(tasks: Signal<readonly ReminderTask[]>): void {
    const recompute = () => {
      const now = Date.now();
      const active = tasks().filter((task) => task.awaitingStart);
      const urgent = new Set<string>();

      for (const task of active) {
        const deadline = new Date(task.deadline).getTime();
        if (Number.isNaN(deadline)) continue;
        const msUntilDeadline = deadline - now;
        if (msUntilDeadline > WARNING_WINDOW_MS || msUntilDeadline < 0) continue;

        urgent.add(task.id);
        const elapsedInWindow = WARNING_WINDOW_MS - msUntilDeadline;
        const hoursElapsed = Math.floor(elapsedInWindow / BEEP_INTERVAL_MS);
        const lastBeep = this.lastBeepAt.get(task.id) ?? -1;
        if (hoursElapsed > lastBeep) {
          this.lastBeepAt.set(task.id, hoursElapsed);
          this.playBeep();
        }
      }

      // Stop tracking any task no longer awaiting start (started, delivered, or removed) so a
      // future re-approach of the deadline (shouldn't happen, but stay correct) starts fresh.
      for (const id of [...this.lastBeepAt.keys()]) {
        if (!active.some((task) => task.id === id)) this.lastBeepAt.delete(id);
      }

      this.urgentIds.set(urgent);
    };

    effect(() => { tasks(); untracked(recompute); });
    this.timer = setInterval(recompute, TICK_MS);
    this.destroyRef.onDestroy(() => { if (this.timer) clearInterval(this.timer); });
  }

  private playBeep(): void {
    try {
      this.audioContext ??= new AudioContext();
      const ctx = this.audioContext;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.4);
    } catch {
      // Autoplay can be blocked before the user has interacted with the page at all — the
      // continuous pulse animation still carries the warning visually in that case.
    }
  }
}
