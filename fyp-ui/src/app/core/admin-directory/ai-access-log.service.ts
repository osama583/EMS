import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AiAccessDenial {
  readonly denialId: number;
  readonly userId: number | null;
  readonly userEmail: string | null;
  // Nullable since migration 026: an out_of_scope/unsupported refusal has no topic to record —
  // nothing classified, so there is no page it would have come from either.
  readonly topic: string | null;
  readonly topicLabel: string | null;
  readonly requiredPages: string | null;
  readonly question: string;
  readonly createdAt: string;
  /**
   * Why the interaction did not go through. THREE REFUSAL REASONS, plus one that is not a refusal:
   *   no_access       they asked this system for something they cannot have - their role does not
   *                   reach it, or nobody does. Fixed by granting a page, or not at all.
   *   harmful         an attempt on the assistant itself: injection, "ignore your instructions",
   *                   probing, claiming authority, pushing after a refusal. INTENT is the test -
   *                   wanting a roster you cannot have is no_access, not an attack.
   *   unrelated       nothing to do with this app.
   *   system_failure  NOT a refusal. The assistant meant to answer and broke. A bug list.
   */
  readonly outcome: string;
  /** Free-text detail for the outcomes that have no page list. */
  readonly reason: string | null;
  /**
   * The answer the assistant produced, present only for a reviewer rejection - the refusals made
   * before generation have no answer to record. This is what makes a reviewer row reviewable: an
   * administrator cannot judge "should this have gone out" from the question alone.
   */
  readonly aiResponse: string | null;
  /** The asker's roles as they were WHEN ASKED - snapshotted, since assignments change later. */
  readonly userRoles: string | null;
  /**
   * The turns immediately before this one, or null when it opened the conversation. A refused
   * question is frequently not judgeable alone - "u do not know ?" and "no i wont login" were both
   * filed as permission refusals - and pressing a refused request again is only visible here.
   */
  readonly conversationContext: string | null;
}

export interface AiAccessDenialPage {
  readonly rows: readonly AiAccessDenial[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// Audit trail of chat questions the AI assistant refused because Page Visibility does not grant the
// asker the pages that topic's data lives on (see backend app/ai/topic_access.py).
@Injectable({ providedIn: 'root' })
export class AiAccessLogService {
  private readonly http = inject(HttpClient);

  list(page: number, search: string, outcome = '', order: 'asc' | 'desc' = 'desc', pageSize?: number): Observable<AiAccessDenialPage> {
    let params = new HttpParams().set('page', page).set('order', order);
    if (pageSize) params = params.set('pageSize', pageSize);
    if (search.trim()) {
      params = params.set('search', search.trim());
    }
    // Server-side, like paging and search: the log only grows, so filtering in the browser would
    // mean fetching every row to hide most of them.
    if (outcome && outcome !== 'all') {
      params = params.set('outcome', outcome);
    }
    return this.http.get<AiAccessDenialPage>(`${environment.apiBaseUrl}/admin/ai-access-log`, { params });
  }

  clear(): Observable<{ removed: number }> {
    return this.http.delete<{ removed: number }>(`${environment.apiBaseUrl}/admin/ai-access-log`);
  }
}
