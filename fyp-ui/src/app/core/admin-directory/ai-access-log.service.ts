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
  /** Why the assistant did not answer: page_denied | how_to_page_denied | out_of_scope | unsupported. */
  readonly outcome: string;
  /** Free-text detail for the outcomes that have no page list (out_of_scope / unsupported). */
  readonly reason: string | null;
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

  list(page: number, search: string): Observable<AiAccessDenialPage> {
    let params = new HttpParams().set('page', page);
    if (search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<AiAccessDenialPage>(`${environment.apiBaseUrl}/admin/ai-access-log`, { params });
  }

  clear(): Observable<{ removed: number }> {
    return this.http.delete<{ removed: number }>(`${environment.apiBaseUrl}/admin/ai-access-log`);
  }
}
