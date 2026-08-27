import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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

export interface AiAssistantRegistrant {
  readonly name: string;
  readonly status: 'registered' | 'pending_approval' | 'rejected';
  readonly registeredAt: string;
}

export interface AiAssistantRegistrantsTable {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly registrants: readonly AiAssistantRegistrant[];
}

export interface AiAssistantClub {
  readonly clubId: string;
  readonly clubName: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly categories?: string | null;
}

// requestId/bucket let the frontend link straight to the same page the equivalent records-hub
// row would open (see hub-proposals.ts's row click: /app/proposals/review/{id} with a readOnly
// flag derived from bucket) — bucket is 'inbox' | 'ongoing' | 'history' | 'drafts', computed
// server-side (see backend's proposal_retrieval.bucket_for_status) so "pending"/"ongoing"/"in my
// inbox" all resolve to the one real bucket a proposal is actually in, never a fixed status word.
export interface AiAssistantProposal {
  readonly requestId: string;
  readonly requestCode: string;
  readonly eventTitle: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly bucket: 'inbox' | 'ongoing' | 'history' | 'drafts';
}

// A "take me there" card that accompanies a how-to answer. Only ever present when Page Visibility
// actually grants the asker that page (the backend builds it from the same grant check that
// released the instructions), so it can never link somewhere the user would be bounced out of.
export interface AiAssistantNavigation {
  readonly pageCode: string;
  readonly label: string;
  readonly routePath: string;
  readonly icon?: string | null;
}

export interface AiAssistantAnswer {
  readonly answer: string;
  readonly sources: readonly AiAssistantSource[];
  readonly registrantsTable?: AiAssistantRegistrantsTable | null;
  readonly clubs?: readonly AiAssistantClub[];
  readonly proposals?: readonly AiAssistantProposal[];
  readonly navigation?: readonly AiAssistantNavigation[];
}

// One prior turn, sent back to the server so it can resolve follow-up
// questions ("what about the location?") — see backend/app/api/ai.py's
// history handling. The server never stores this; the caller (ai-assistant.ts,
// via AiConversationStore) is the only place it's persisted, in localStorage.
export interface AiAssistantHistoryTurn {
  readonly question: string;
  readonly answer: string;
}

// Talks to POST /ai/ask (see backend/app/api/ai.py) — a RAG endpoint scoped to
// published events. Public: the auth interceptor attaches a bearer token when
// the caller is signed in, and the endpoint itself works with or without one
// (see authenticate_optional() there) — a signed-out visitor still gets
// Public/Club Only events answered.
@Injectable({ providedIn: 'root' })
export class AiAssistantService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/ai`;

  ask(question: string, history: readonly AiAssistantHistoryTurn[] = []): Observable<AiAssistantAnswer> {
    return this.http.post<AiAssistantAnswer>(`${this.baseUrl}/ask`, { question, history });
  }
}
