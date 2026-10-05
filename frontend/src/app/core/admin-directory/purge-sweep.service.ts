import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PurgeSweepEntityResult {
  readonly eligible: number;
  readonly purged: number;
  readonly blocked: number;
  readonly failed: number;
}

export interface PurgeSweepResult {
  readonly totalPurged: number;
  readonly totalBlocked: number;
  readonly byEntity: Readonly<Record<string, PurgeSweepEntityResult>>;
  readonly entities: readonly string[];
}

// There is no server this app runs on yet to hang a scheduled job off of (see
// backend/scripts/purge_deleted.py's docstring), so the 7-day retention sweep — permanently removing
// everything that has sat in a "Deleted" bin longer than the recovery window — is triggered here on
// demand by a System Admin instead of running automatically.
@Injectable({ providedIn: 'root' })
export class PurgeSweepService {
  private readonly http = inject(HttpClient);

  run(): Observable<PurgeSweepResult> {
    return this.http.post<PurgeSweepResult>(`${environment.apiBaseUrl}/admin/purge-deleted`, {});
  }
}
