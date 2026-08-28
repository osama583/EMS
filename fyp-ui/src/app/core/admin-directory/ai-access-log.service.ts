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
   * Why the interaction did not go through. Two groups, with different fixes:
   *   page_denied | how_to_page_denied   the backend refused BEFORE generating an answer, because
   *                                      Page Visibility does not grant the pages involved. Fixed
   *                                      by granting a page.
   *   out_of_scope | unsupported | harmful | unrelated_question
   *                                      a capability gap or a blocked attempt. The last three can
   *                                      come from the AI security reviewer, which judges an answer
   *                                      AFTER it was generated (backend: ai/sql_llm.review_answer).
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
}

export interface AiAccessDenialPage {
  readonly rows: readonly AiAccessDenial[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// Audit trail of chat questions the AI assistant refused because Page Visibility does not grant
// the asker the pages that topic's data lives on (see backend app/ai/topic_access.py). Read-only
// plus a manual clear: there is no automatic retention window for this table, deliberately, so
// emptying it is an explicit admin decision rather than something that ages out silently.
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
