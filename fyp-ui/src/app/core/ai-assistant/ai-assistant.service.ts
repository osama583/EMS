import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AiAssistantSource {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly similarity: number;
  // Only present when the matched event is still live/visible at answer time
  // (see backend's retrieval.card_info) — a card-worthy source omits these
  // when the event has since been cancelled/unpublished.
  readonly eventImageUrl?: string;
  readonly firstDate?: string;
  readonly location?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly category?: string;
}

export interface AiAssistantClub {
  readonly clubId: string;
  readonly clubName: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly categories?: string | null;
}

// A "take me there" card that accompanies a how-to or a page answer. Only ever present when Page
// Visibility actually grants the asker that page (the backend builds it from the same grant check
// that released the instructions), so it can never link somewhere the user would be bounced out of.
export interface AiAssistantNavigation {
  readonly pageCode: string;
  readonly label: string;
  readonly routePath: string;
  readonly icon?: string | null;
}

// THE ANSWER CARRIES EVENTS AND CLUBS ONLY. It used to carry a registrants table and proposal
// cards too; the assistant no longer answers about either — who registered for an event and what
// state a proposal is in are outside what it covers for anybody now — so the backend cannot emit
// them and the rendering for them is gone rather than left waiting for data that never arrives.
//
// `registrantsTable` survives as a permanently-null key because the server still sends it; it is
// read by nothing.
export interface AiAssistantAnswer {
  readonly answer: string;
  readonly sources: readonly AiAssistantSource[];
  readonly registrantsTable?: null;
  readonly clubs?: readonly AiAssistantClub[];
  readonly navigation?: readonly AiAssistantNavigation[];
}

// One opening suggestion card. The set is chosen server-side from the caller's live page grants
// (backend/app/ai/suggestions.py), so the panel offers each reader questions they can actually
// have answered rather than one fixed proposal-shaped list shown to everybody.
export interface AiAssistantSuggestion {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
}

// One prior turn, sent back to the server so it can resolve follow-up questions ("what about the
// location?") — see backend/app/api/ai.py's history handling.
export interface AiAssistantHistoryTurn {
  readonly question: string;
  readonly answer: string;
}

// Talks to POST /ai/ask (see backend/app/api/ai.py) — a RAG endpoint scoped to published events.
@Injectable({ providedIn: 'root' })
export class AiAssistantService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/ai`;

  ask(question: string, history: readonly AiAssistantHistoryTurn[] = []): Observable<AiAssistantAnswer> {
    return this.http.post<AiAssistantAnswer>(`${this.baseUrl}/ask`, { question, history });
  }

  // The opening cards for whoever is signed in — a separate request from ask() because the panel
  // needs them before any question exists, and the list depends only on the caller's page grants.
  // Open to guests, who get the guest-visible subset.
  suggestions(): Observable<readonly AiAssistantSuggestion[]> {
    return this.http
      .get<{ suggestions: readonly AiAssistantSuggestion[] }>(`${this.baseUrl}/suggestions`)
      .pipe(map((response) => response.suggestions ?? []));
  }
}
