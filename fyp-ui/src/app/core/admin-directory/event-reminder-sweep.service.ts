import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** How many emails each reminder kind accounted for. */
export interface EventReminderCounts {
  readonly savedCapacity: number;
  readonly savedStarting: number;
  readonly registeredStarting: number;
}

export interface EventReminderSweepResult {
  readonly dryRun: boolean;
  readonly byKind: EventReminderCounts;
  readonly total: number;
  /** Present on a dry run only — the thresholds the counts were computed with. */
  readonly capacityPercent?: number;
  readonly leadDays?: number;
}

// The event reminders (a saved event filling up, a saved event starting while you
// still have not registered, an event you ARE registered for starting) are
// time-driven, so they are designed to be run once a day by cron — see
// backend/scripts/send_event_reminders.py and "Scheduled jobs" in the backend
// README, both of which are kept and are the intended production setup.
//
// This deployment has no always-on Linux host to install that crontab on, which
// is the same reason PurgeSweepService exists. So rather than leave the feature
// unreachable, a System Admin triggers it here on demand. The endpoint calls the
// exact same send_due_reminders() the cron job calls — this is a second TRIGGER,
// never a second implementation — and every send is recorded server-side, so
// pressing the button twice sends nothing the second time.
@Injectable({ providedIn: 'root' })
export class EventReminderSweepService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/admin/send-event-reminders`;

  /** Report who would be emailed, without sending or recording anything. */
  preview(): Observable<EventReminderSweepResult> {
    return this.http.post<EventReminderSweepResult>(`${this.url}?dryRun=1`, {});
  }

  run(): Observable<EventReminderSweepResult> {
    return this.http.post<EventReminderSweepResult>(this.url, {});
  }
}
