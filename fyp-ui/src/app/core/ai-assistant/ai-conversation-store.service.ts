import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AiAssistantClub, AiAssistantNavigation, AiAssistantProposal, AiAssistantRegistrantsTable, AiAssistantSource } from './ai-assistant.service';

export interface AiChatMessage {
  readonly id: string;
  readonly sender: 'assistant' | 'user';
  readonly text: string;
  readonly sources?: readonly AiAssistantSource[];
  readonly registrantsTable?: AiAssistantRegistrantsTable | null;
  readonly clubs?: readonly AiAssistantClub[];
  readonly proposals?: readonly AiAssistantProposal[];
  readonly navigation?: readonly AiAssistantNavigation[];
  readonly createdAt: number; // epoch ms
}

export interface AiConversation {
  readonly id: string;
  readonly messages: readonly AiChatMessage[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

// Keyed by WHO is signed in, not a single fixed key - localStorage has no concept of "the current
// user", so without this, one browser used by two different accounts (or a guest, then someone signing
// in) would read and continue each other's chat history verbatim, including anything that history
// contains about the previous asker's own registrations/proposals/decisions.
const STORAGE_KEY_PREFIX = 'ai-assistant.conversations.v2.';
const GUEST_BUCKET = 'guest';
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours, per spec
const MAX_HISTORY_TURNS = 10; // Q&A pairs sent to the model for follow-up resolution

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Validates every message's shape too, not just the conversation wrapper — a message missing
// `text`/`sender`, or with `sources`/`clubs` as something other than an array, would otherwise reach
// the template unchanged and throw inside the @for/.length/.some() calls there.
function isValidMessage(value: unknown): value is AiChatMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return typeof m['id'] === 'string' && typeof m['text'] === 'string'
    && (m['sender'] === 'user' || m['sender'] === 'assistant')
    && typeof m['createdAt'] === 'number'
    && (m['sources'] === undefined || Array.isArray(m['sources']))
    && (m['clubs'] === undefined || Array.isArray(m['clubs']))
    && (m['proposals'] === undefined || Array.isArray(m['proposals']))
    && (m['navigation'] === undefined || Array.isArray(m['navigation']))
    && (m['registrantsTable'] === undefined || m['registrantsTable'] === null || typeof m['registrantsTable'] === 'object');
}

function isConversationArray(value: unknown): value is AiConversation[] {
  return Array.isArray(value) && value.every((item) =>
    item && typeof item === 'object'
    && typeof (item as Record<string, unknown>)['id'] === 'string'
    && typeof (item as Record<string, unknown>)['updatedAt'] === 'number'
    && Array.isArray((item as Record<string, unknown>)['messages'])
    && ((item as Record<string, unknown>)['messages'] as unknown[]).every(isValidMessage),
  );
}

// Owns the AI assistant's chat history in localStorage: every conversation (not just the currently
// open one) survives a page reload, and any message older than 24h is dropped automatically the next
// time this loads — a plain TTL sweep on read, not a scheduled job, since nothing needs to react to
// the expiry the instant it happens.
@Injectable({ providedIn: 'root' })
export class AiConversationStore {
  private readonly auth = inject(AuthService);

  // Bucket identity swaps the instant AuthService.user() changes (login, logout, or switching
  // accounts without a full page reload) - initialised from whoever is signed in at construction
  // time, then kept in sync by the effect() below rather than only read once.
  private bucketKey = this.storageKeyFor(this.auth.user()?.id);

  private readonly _conversations = signal<readonly AiConversation[]>(this.loadFresh());
  readonly conversations = this._conversations.asReadonly();

  private readonly _activeId = signal<string | null>(this._conversations()[0]?.id ?? null);
  readonly activeId = this._activeId.asReadonly();

  // Bumped every time the storage bucket switches (login/logout/account switch) - a component holding
  // its OWN "which conversation is open" signal (AiAssistantComponent.activeConversationId) has no
  // other way to learn its cached id may now belong to a different user's list; it watches this
  // counter and resets to activeId() whenever it changes.
  private readonly _identityVersion = signal(0);
  readonly identityVersion = this._identityVersion.asReadonly();

  constructor() {
    // Re-point at the new user's own bucket (or the guest bucket, on logout) the moment identity
    // changes - without this, a component that grabbed `conversations()`/`activeId()` before a login
    // would keep rendering the PREVIOUS user's messages until something else forced a re-read.
    effect(() => {
      const currentUserId = this.auth.user()?.id;
      const nextKey = this.storageKeyFor(currentUserId);
      if (nextKey === this.bucketKey) return;
      const previousKey = this.bucketKey;
      const wasSignedIn = previousKey !== STORAGE_KEY_PREFIX + GUEST_BUCKET;
      const isNowLoggedOut = currentUserId === undefined;
      this.bucketKey = nextKey;
      if (wasSignedIn && isNowLoggedOut) {
        try { localStorage.removeItem(previousKey); } catch { /* Storage may be unavailable. */ }
      }
      const fresh = this.loadFresh();
      this._conversations.set(fresh);
      this._activeId.set(fresh[0]?.id ?? null);
      this._identityVersion.update((v) => v + 1);
    });
  }

  private storageKeyFor(userId: string | undefined): string {
    return STORAGE_KEY_PREFIX + (userId ?? GUEST_BUCKET);
  }

  private loadFresh(): AiConversation[] {
    if (typeof localStorage === 'undefined') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(localStorage.getItem(this.bucketKey) ?? '[]');
    } catch {
      parsed = [];
    }
    const conversations = isConversationArray(parsed) ? parsed : [];
    const cutoff = Date.now() - RETENTION_MS;
    // A conversation expires as a whole once its most recent message ages out
    // — a stale half-conversation with only its oldest turns visible would be
    // confusing, so it is all-or-nothing per conversation, not per message.
    const fresh = conversations.filter((c) => c.updatedAt >= cutoff).sort((a, b) => b.updatedAt - a.updatedAt);
    if (fresh.length !== conversations.length) this.persist(fresh);
    return fresh;
  }

  private persist(conversations: readonly AiConversation[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.bucketKey, JSON.stringify(conversations));
    } catch {
      // Storage full or disabled (private browsing) - the chat still works
      // for this session, it just won't survive a reload. Not worth surfacing
      // to the user over a "can't message" error.
    }
  }

  active(): AiConversation | null {
    const id = this._activeId();
    return id ? (this._conversations().find((c) => c.id === id) ?? null) : null;
  }

  /** Creates and activates a new empty conversation. Does not persist it until
   * a message is added — an unused "new chat" should not clutter the list. */
  startNew(): AiConversation {
    const conversation: AiConversation = { id: newId(), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    this._activeId.set(conversation.id);
    return conversation;
  }

  open(id: string): void {
    if (this._conversations().some((c) => c.id === id)) this._activeId.set(id);
  }

  // Idempotent by message id: the cancel-and-resend recovery path in AiAssistantComponent (see its
  // identity-switch effect) can call this again for the SAME bubble - e.g.
  appendMessage(conversationId: string, message: AiChatMessage): void {
    const now = Date.now();
    let list = this._conversations();
    if (list.some((c) => c.messages.some((m) => m.id === message.id))) return;
    const existing = list.find((c) => c.id === conversationId);
    if (existing) {
      list = list.map((c) => c.id === conversationId ? { ...c, messages: [...c.messages, message], updatedAt: now } : c);
    } else {
      list = [{ id: conversationId, messages: [message], createdAt: now, updatedAt: now }, ...list];
    }
    list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    this._conversations.set(list);
    this.persist(list);
  }

  delete(id: string): void {
    const list = this._conversations().filter((c) => c.id !== id);
    this._conversations.set(list);
    this.persist(list);
    if (this._activeId() === id) this._activeId.set(list[0]?.id ?? null);
  }

  /** Last MAX_HISTORY_TURNS user/assistant Q&A pairs from a conversation, in
   * the {question, answer} shape POST /ai/ask expects — built from adjacent
   * user->assistant message pairs, not just "the last 20 messages", so a
   * dangling unanswered question at the end never becomes a malformed turn. */
  historyFor(conversationId: string): { readonly question: string; readonly answer: string }[] {
    const messages = this._conversations().find((c) => c.id === conversationId)?.messages ?? [];
    const turns: { question: string; answer: string }[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].sender === 'user' && messages[i + 1].sender === 'assistant') {
        turns.push({ question: messages[i].text, answer: messages[i + 1].text });
        i++;
      }
    }
    return turns.slice(-MAX_HISTORY_TURNS);
  }
}
