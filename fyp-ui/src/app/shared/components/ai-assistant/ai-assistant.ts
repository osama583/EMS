import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnDestroy, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AiAssistantClub, AiAssistantProposal, AiAssistantRegistrantsTable, AiAssistantService, AiAssistantSource } from '../../../core/ai-assistant/ai-assistant.service';
import { AiChatMessage, AiConversation, AiConversationStore } from '../../../core/ai-assistant/ai-conversation-store.service';
import { PublishedEvent, RegistrationResult } from '../../../core/events/published-event.models';
import { PublishedEventService } from '../../../core/events/published-event.service';
import { EVENT_IMAGE_PLACEHOLDER } from '../../event-image-placeholder';
import { EventDetailsModalComponent } from '../event-details-modal/event-details-modal';
import { AiOrbAwarenessService } from './ai-orb-awareness.service';

interface SuggestionCard { readonly icon: string; readonly title: string; readonly description: string; readonly prompt: string; }

const PROMPTS = ['Need help?', 'Have a question?', 'Want to create a request?', 'Questions about the process?'] as const;
const GREETING = 'Hi! I can help you understand events, proposals, and the APU request process.';

const SUGGESTION_CARDS: readonly SuggestionCard[] = [
  { icon: 'help', title: 'Questions About the Process', description: 'Explain the complete event approval process.', prompt: 'Can you explain the complete event approval process?' },
  { icon: 'badge', title: 'Who Can Apply?', description: 'Find out whether you are eligible to submit an event.', prompt: 'Who is eligible to submit an event proposal?' },
  { icon: 'schedule', title: 'Approval Timeline', description: 'Learn how long the approval process typically takes.', prompt: 'How long does the approval process typically take?' },
  { icon: 'event_available', title: 'Submission Deadline', description: 'Find out how long before the event you should submit your proposal.', prompt: 'How long before my event should I submit the proposal?' },
  { icon: 'chat', title: 'Submit Through Chat', description: 'Let the AI guide you through creating and submitting an event proposal.', prompt: 'Can you guide me through creating and submitting an event proposal?' },
  { icon: 'description', title: 'Required Documents', description: 'Discover what information and documents are required before submission.', prompt: 'What information and documents do I need before submission?' },
  { icon: 'fact_check', title: 'Proposal Status', description: 'Check the status of an existing proposal and understand the current workflow stage.', prompt: 'How do I check the status of my existing proposal?' },
  { icon: 'groups', title: 'Department Responsibilities', description: 'Learn which departments are involved and what each department is responsible for.', prompt: 'Which departments are involved and what is each one responsible for?' },
];

// Phone-width screens open the full-page assistant with its standing sidebar already collapsed to
// the icon rail, so the conversation — not the history list — is what the user lands on. Guarded
// for non-browser rendering, matching the `typeof document` checks used elsewhere in this file.
function startsSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 48rem)').matches ?? false;
}

const CARDS_PER_PAGE = 4;
const SUGGESTION_CARD_PAGES: readonly (readonly SuggestionCard[])[] = Array.from(
  { length: Math.ceil(SUGGESTION_CARDS.length / CARDS_PER_PAGE) },
  (_, page) => SUGGESTION_CARDS.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE),
);

function newMessageId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }

// A message's text is plain, un-marked-up prose from the model — never HTML — so it was rendered
// as one flat <p> with newlines collapsed by the browser. The system prompt already tells the
// model to put each list item on its own "-"-prefixed line (see gemini.py's FORMATTING section),
// but that convention only shows up correctly if the template actually respects line breaks and
// groups consecutive "-" lines into a real list, rather than displaying real newlines as spaces
// and burying a count/listing in one run-on sentence. Parsed once per message here rather than
// with a CSS white-space rule, since consecutive "-" lines need to become an actual <ul> (with a
// visible bullet/row per item), not just a paragraph that happens to wrap.
export type AiMessageSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

function segmentMessageText(text: string): readonly AiMessageSegment[] {
  const lines = text.split('\n');
  const segments: AiMessageSegment[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    segments.push({ kind: 'text', text: paragraphLines.join(' ').trim() });
    paragraphLines = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    segments.push({ kind: 'list', items: listItems });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const listMatch = /^-\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
    } else if (line) {
      flushList();
      paragraphLines.push(line);
    }
    // A blank line ends whichever run is open, without starting a new empty paragraph.
    else { flushParagraph(); flushList(); }
  }
  flushParagraph();
  flushList();
  return segments;
}

// Full-window mode has a real URL (/assistant) so it behaves like an actual page — refresh,
// back/forward, and a bookmarkable link all work — rather than being a pure UI toggle. Kept as a
// single TOP-LEVEL route (not also mirrored under /app) because /app's canActivateChild guard
// (roleGuard) checks the URL against the caller's server-driven nav_page_grants, which has no
// entry for a non-navigable utility route like this one and would bounce it to their default page.
function isAssistantUrl(url: string): boolean {
  return url.split(/[?#]/)[0] === '/assistant';
}

// --- Living-orb behavior tuning ------------------------------------------
const INITIAL_VISIBLE_MS = 15_000; // fully visible for the first 15s on page load
const LOOP_HIDDEN_MS = 50_000; // then hidden (peeking) for 50s...
const LOOP_VISIBLE_MS = 10_000; // ...and fully visible for 10s, repeating indefinitely
const REST_AFTER_CLOSE_MS = 4_000; // idle animations pause this long after the chat closes
const PROXIMITY_WAKE_PX = 140; // cursor distance that counts as "near" the orb
const GLANCE_RADIUS_PX = 420; // how far a hovered button can be and still get a glance

type OrbPhase = 'visible' | 'peeking';
type IdleGesture = 'none' | 'blink' | 'look-around' | 'tilt' | 'smile' | 'wave' | 'wonder' | 'climb';

function randomBetween(min: number, max: number): number { return min + Math.random() * (max - min); }

@Component({
  selector: 'app-ai-assistant',
  imports: [EventDetailsModalComponent],
  templateUrl: './ai-assistant.html',
  styleUrl: './ai-assistant.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssistantComponent implements OnDestroy {
  private readonly awareness = inject(AiOrbAwarenessService);
  private readonly assistant = inject(AiAssistantService);
  private readonly store = inject(AiConversationStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly publishedEventService = inject(PublishedEventService);
  readonly launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');
  readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  readonly messageArea = viewChild<ElementRef<HTMLElement>>('messageArea');
  readonly orb = viewChild<ElementRef<HTMLElement>>('orb');
  readonly open = signal(false);
  readonly expanded = signal(false); // full-window mode toggle
  readonly showHistory = signal(false); // conversation list overlay
  // Full-page mode's standing sidebar, user-toggled. It starts collapsed on phone-width screens:
  // expanded it would overlay the conversation (see _ai-assistant-expanded.scss's 48rem block),
  // so opening the assistant on a phone should land on the messages, not the conversation list.
  readonly sidebarCollapsed = signal(startsSidebarCollapsed());
  readonly promptVisible = signal(true);
  readonly promptIndex = signal(0);
  readonly promptChanging = signal(false);
  readonly draft = signal('');
  readonly typing = signal(false);
  readonly error = signal('');
  readonly eyeX = signal(0);
  readonly eyeY = signal(0);
  readonly cardPages = SUGGESTION_CARD_PAGES;
  // Card click opens the event details modal on top of the chat (chat stays open) instead of
  // navigating away — see openEventFromCard().
  readonly selectedCardEvent = signal<PublishedEvent | null>(null);

  // The active conversation drives everything the template renders — created
  // lazily (see ensureConversationId()) so opening the panel for the first
  // time never writes an empty conversation into localStorage. Not private:
  // the full-page sidebar template highlights the active item in the list.
  readonly activeConversationId = signal<string | null>(this.store.activeId());
  readonly conversations = this.store.conversations;
  private readonly storedMessages = computed<readonly AiChatMessage[]>(() => {
    const id = this.activeConversationId();
    return id ? (this.store.conversations().find((c) => c.id === id)?.messages ?? []) : [];
  });
  // The greeting is shown for an empty conversation but never itself written to
  // the store/localStorage — it is not a real turn, so it must never appear in
  // historyFor()'s Q&A pairing or count toward the 24h-retained message list.
  readonly messages = computed<readonly AiChatMessage[]>(() => {
    const stored = this.storedMessages();
    return stored.length > 0 ? stored : [{ id: 'greeting', sender: 'assistant', text: GREETING, createdAt: Date.now() }];
  });
  readonly hasInteracted = computed(() => this.storedMessages().length > 0);

  // Living-orb state
  readonly phase = signal<OrbPhase>('visible');
  readonly waking = signal(false);
  readonly gesture = signal<IdleGesture>('none');
  readonly tiltDeg = signal(0);

  private readonly reducedMotion: boolean;
  private readonly pointerTracking: boolean;
  private readonly promptTimer?: ReturnType<typeof setInterval>;
  private askSubscription?: Subscription;
  // The user message bubble for whatever ask() call is currently in flight, if any — set right
  // before the HTTP call in send() and cleared on both success and error. Lets the identity-switch
  // effect below recover a request it has to cancel (see that effect's own comment) instead of
  // just silently dropping the user's message. Kept as the whole message object (not just its
  // text) so recovery can carry the SAME bubble into the new conversation - moving it, rather
  // than appending a second copy with a new id/timestamp, is what keeps the cancel-and-resend
  // invisible in the UI: one bubble throughout, never two identical ones stacked.
  private pendingMessage: AiChatMessage | null = null;
  // True only while a recovered question (see above) is itself in flight after being re-sent.
  // Guards against a SECOND identity-version bump landing while that resend is still pending:
  // without this, the effect would read pendingQuestion again (the resend set it back), cancel
  // the resend, and re-send it once more - repeating for every further bump instead of exactly
  // once per original message.
  private recoveringQuestion = false;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private restTimer?: ReturnType<typeof setTimeout>;
  private gestureScheduleTimer?: ReturnType<typeof setTimeout>;
  private gestureClearTimer?: ReturnType<typeof setTimeout>;
  private climbTimer?: ReturnType<typeof setTimeout>;
  private wakeResetTimer?: ReturnType<typeof setTimeout>;
  private idleSuspended = false; // true while chat is open, or briefly after it closes
  private lastGlanceAt = 0;
  private lastProximityWakeAt = 0;
  private lastDwellCheck = 0;
  private dwellOrigin: { x: number; y: number; since: number } | null = null;
  private mouseMoveRafPending = false;

  constructor() {
    const view = typeof window === 'undefined' ? null : window;
    this.reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? true;
    this.pointerTracking = !this.reducedMotion && (view?.matchMedia('(hover: hover) and (pointer: fine)').matches ?? false);

    if (!this.reducedMotion) {
      this.promptTimer = setInterval(() => {
        if (this.open() || !this.promptVisible()) return;
        this.promptChanging.set(true);
        setTimeout(() => { this.promptIndex.update((value) => (value + 1) % PROMPTS.length); this.promptChanging.set(false); }, 180);
      }, 5200);

      this.scheduleFlipToPeeking(INITIAL_VISIBLE_MS);
      this.scheduleNextGesture();

      view?.document.addEventListener('visibilitychange', this.handleVisibilityChange);

      effect(() => {
        const pulse = this.awareness.pulse();
        if (!pulse) return;
        if (this.open()) return;
        this.playGesture('look-around', 900);
        this.wake({ restart: false });
      });
    }

    // Resets to the new user's own (or the guest) conversation the instant AiConversationStore
    // switches storage buckets (login/logout/account switch without a full reload) - without
    // this, activeConversationId would keep pointing at an id from the PREVIOUS user's now-
    // replaced conversation list, and the panel could keep rendering their messages (or, worse,
    // silently start appending the new user's replies into what was the old user's thread id if
    // it happened to collide). Skipped on the very first run (identityVersion starts at 0 and
    // this effect fires once immediately) since activeConversationId is already correctly
    // initialised from the store above.
    //
    // The cancel below is NOT optional: appendMessage() writes into whatever bucket is CURRENT
    // when the response lands, keyed only by conversationId, so letting an in-flight ask() from
    // the OLD bucket run to completion here would land the previous identity's question/answer
    // inside the NEW identity's conversation list - a cross-account leak (most concretely: a
    // guest's question appearing in the account they just logged into). So the in-flight request
    // is always cancelled on a real switch. What it must NOT do is silently drop the message the
    // user was actually waiting on - a login completing right as someone sends their first
    // question was observed cancelling that request with nothing shown for it, and a naive
    // "just resend the text" recovery was observed appending a SECOND, visibly duplicate bubble
    // (the original send()'s bubble was still sitting in the OLD bucket's conversation, the
    // resend's own bubble landed in the NEW one, and both rendered in the same view once the
    // switch settled). Recovered by moving the SAME user bubble (see pendingMessage) into the
    // NEW identity's conversation instead of appending a fresh copy - one bubble throughout, not
    // two - once the switch has actually happened, rather than resending into the bucket that is
    // about to be replaced. The original OLD-bucket conversation is left behind as an orphaned,
    // unanswered stray question in that bucket's own history (never shown in THIS view, and only
    // reachable by signing back into that same identity) - not ideal, but strictly a private,
    // self-expiring (24h retention) leftover, not a user-visible duplicate.
    let firstIdentityRun = true;
    effect(() => {
      this.store.identityVersion();
      if (firstIdentityRun) { firstIdentityRun = false; return; }
      this.askSubscription?.unsubscribe();
      // A bump landing while an already-recovered message is itself in flight must NOT trigger
      // a second recovery - see recoveringQuestion's own comment. Only the ORIGINAL send's
      // pendingMessage is ever eligible.
      const recoveredMessage = this.recoveringQuestion ? null : this.pendingMessage;
      this.pendingMessage = null;
      this.typing.set(false);
      this.error.set('');
      this.showHistory.set(false);
      this.activeConversationId.set(this.store.activeId());
      // Deferred to a macrotask, outside this effect's own synchronous run: calling send()
      // in-line here re-enters signal writes (typing/draft/pendingMessage) while Angular is
      // still flushing THIS effect, which risks the effect being re-scheduled before the
      // recovered request has a chance to complete - observed live as the same question being
      // re-sent in a tight repeating burst instead of once. Zero-delay setTimeout is enough:
      // it only needs to land after the current synchronous effect run (and this component's
      // own signal writes above) has fully settled.
      if (recoveredMessage) {
        this.recoveringQuestion = true;
        setTimeout(() => this.send(recoveredMessage), 0);
      }
    });

    afterNextRender(() => this.scrollMessages());

    // Sync the panel to whatever /assistant or /app/assistant URL says on load and on every
    // navigation (covers a hard refresh on the assistant URL, a direct link, and back/forward).
    this.syncToRoute(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.syncToRoute(event.urlAfterRedirects));
  }

  private syncToRoute(url: string): void {
    const shouldBeFullPage = isAssistantUrl(url);
    if (!shouldBeFullPage && !isAssistantUrl(this.router.url)) this.preExpandUrl = url;
    if (shouldBeFullPage === (this.open() && this.expanded())) return;
    if (shouldBeFullPage) {
      this.openPanel();
      this.expanded.set(true);
      if (typeof document !== 'undefined') document.body.classList.add('ai-chat-expanded');
    } else if (this.expanded()) {
      // Navigated away from /assistant while it was open in full-page mode (e.g. browser back) —
      // collapse back to the floating widget rather than leaving it expanded with a stale route.
      this.expanded.set(false);
      if (typeof document !== 'undefined') document.body.classList.remove('ai-chat-expanded');
    }
  }

  prompt(): string { return PROMPTS[this.promptIndex()]; }
  updateDraft(event: Event): void { this.draft.set((event.target as HTMLTextAreaElement).value); this.error.set(''); }

  openPanel(): void {
    this.open.set(true);
    this.idleSuspended = true;
    this.gesture.set('none');
    this.resetEyes();
    this.phase.set('visible');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  closePanel(): void {
    if (!this.open()) return;
    const wasFullPage = this.expanded();
    this.open.set(false);
    this.expanded.set(false);
    if (typeof document !== 'undefined') document.body.classList.remove('ai-chat-expanded');
    this.showHistory.set(false);
    this.typing.set(false);
    this.askSubscription?.unsubscribe();
    // The event-details popup opened from a suggestion card (see openEventFromCard()) is a sibling
    // of the chat panel, not a child of it — closing the panel alone leaves it rendered and its
    // page-scroll-lock held (see FormModalComponent.lockPage()) with no visible way back to it,
    // since the chat surface that owned the card is now hidden. The page then reads as frozen:
    // no scroll, and clicks land on an invisible locked backdrop. Always close it together with the panel.
    this.selectedCardEvent.set(null);
    // Leaving full-page mode via the close button needs to actually navigate off /assistant —
    // otherwise the URL still says /assistant while the panel has collapsed to the floating widget.
    if (wasFullPage && isAssistantUrl(this.router.url)) void this.router.navigateByUrl(this.pageBeforeAssistant());
    setTimeout(() => this.launcher()?.nativeElement.focus(), 0);
    // Idle behavior only resumes a few seconds after the chat has been closed.
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => {
      this.idleSuspended = false;
      // Chat closes with the orb fully visible (phase is 'visible' from openPanel) —
      // resume the loop's normal visible duration before flipping to peeking again.
      this.scheduleFlipToPeeking(LOOP_VISIBLE_MS);
    }, this.reducedMotion ? 0 : REST_AFTER_CLOSE_MS);
  }

  // Same body-scroll-lock convention explore-events.ts uses for its filter dialog
  // (body.filters-open, see _explore-events.scss) — full-page mode takes over the whole
  // viewport, so the page behind it must stop scrolling while it's open.
  // Full-page mode is route-driven (see syncToRoute()) — navigating there/away is what flips
  // `expanded`, keeping the URL and the panel's mode always in agreement.
  toggleExpanded(): void {
    if (this.expanded()) {
      void this.router.navigateByUrl(this.pageBeforeAssistant());
    } else {
      this.preExpandUrl = this.router.url;
      void this.router.navigateByUrl('/assistant');
    }
  }

  private preExpandUrl = '/';
  private pageBeforeAssistant(): string {
    return isAssistantUrl(this.preExpandUrl) ? '/' : this.preExpandUrl;
  }

  dismissPrompt(event: Event): void { event.stopPropagation(); this.promptVisible.set(false); }

  selectCard(card: SuggestionCard): void { this.draft.set(card.prompt); this.send(); }

  // --- Conversations (localStorage-backed, 24h retention — see AiConversationStore) ----------
  newChat(): void {
    this.askSubscription?.unsubscribe();
    this.typing.set(false);
    this.error.set('');
    this.draft.set('');
    this.showHistory.set(false);
    this.activeConversationId.set(this.store.startNew().id);
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  toggleHistory(): void { this.showHistory.update((value) => !value); }
  toggleSidebar(): void { this.sidebarCollapsed.update((value) => !value); }

  openConversation(id: string): void {
    this.store.open(id);
    this.activeConversationId.set(id);
    this.showHistory.set(false);
    this.scrollMessages();
  }

  deleteConversation(event: Event, id: string): void {
    event.stopPropagation();
    this.store.delete(id);
    if (this.activeConversationId() === id) this.activeConversationId.set(this.store.activeId());
  }

  lastMessagePreview(conversation: AiConversation): string {
    const last = conversation.messages[conversation.messages.length - 1];
    return last ? last.text : 'New conversation';
  }

  relativeTime(epochMs: number): string {
    const diffMs = Date.now() - epochMs;
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return 'Yesterday';
  }

  /** Guarantees an active conversation exists without persisting an empty one
   * — called right before the first message of a session is appended. */
  private ensureConversationId(): string {
    const existing = this.activeConversationId();
    if (existing) return existing;
    const created = this.store.startNew();
    this.activeConversationId.set(created.id);
    return created.id;
  }

  composerKeydown(event: KeyboardEvent): void { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); } }
  // `recovered`, when passed, is an already-visible user bubble from a request the identity-switch
  // effect had to cancel (see that effect's own comment) - carried into the new conversation
  // instead of appending a second copy, so the login-triggered cancel-and-resend never shows two
  // identical bubbles in the UI. A normal user-initiated send always omits it and appends fresh.
  send(recovered?: AiChatMessage): void {
    const text = recovered ? recovered.text : this.draft().trim();
    if (!text || this.typing()) { if (!text) this.error.set('Enter a question before sending.'); return; }
    const conversationId = this.ensureConversationId();
    const message = recovered ?? { id: newMessageId(), sender: 'user' as const, text, createdAt: Date.now() };
    this.store.appendMessage(conversationId, message);
    this.draft.set(''); this.error.set(''); this.typing.set(true); this.pendingMessage = message; this.scrollMessages();

    const history = this.store.historyFor(conversationId);
    this.askSubscription = this.assistant.ask(text, history).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.pendingMessage = null;
        this.recoveringQuestion = false;
        this.store.appendMessage(conversationId, {
          id: newMessageId(), sender: 'assistant', text: response.answer, sources: response.sources,
          registrantsTable: response.registrantsTable, clubs: response.clubs, proposals: response.proposals,
          navigation: response.navigation, createdAt: Date.now(),
        });
        this.typing.set(false); this.scrollMessages();
        // No-op while the panel is open (already fully visible with idle suspended) — kept
        // for correctness if a background/notification-driven response path is added later.
        if (!this.open()) this.wake({ restart: true, gesture: 'smile' });
      },
      error: () => {
        this.pendingMessage = null;
        this.recoveringQuestion = false;
        this.store.appendMessage(conversationId, {
          id: newMessageId(), sender: 'assistant',
          text: "Sorry, I couldn't reach the assistant just now. Please try again in a moment.",
          createdAt: Date.now(),
        });
        this.typing.set(false); this.scrollMessages();
      },
    });
  }

  messageSegments(text: string): readonly AiMessageSegment[] { return segmentMessageText(text); }

  // A source only carries card fields (eventImageUrl/firstDate/location) when the matched event
  // is still live — see backend's retrieval.card_info(). Sources without them render as a plain
  // text mention instead of a card, rather than a broken/empty card.
  isCardSource(source: AiAssistantSource): boolean { return !!source.eventImageUrl; }
  hasCardSources(sources: readonly AiAssistantSource[] | undefined): boolean { return !!sources?.some((source) => this.isCardSource(source)); }

  // No single-club detail route/deep-link exists yet (unlike events' ?event= param on
  // explore-events) — Club Discover is the closest existing page, opened the same way a
  // no-modal-available card click behaves elsewhere in this component.
  // A navigation card from a how-to answer. The server already checked Page Visibility before
  // emitting the card (see topic_access.page_card), and routePath comes from nav_page itself, so
  // this just navigates — re-deriving the route here would risk drifting from the real nav tree.
  openPageFromCard(page: { routePath: string }): void {
    void this.router.navigateByUrl(page.routePath);
    this.closePanel();
  }

  openClubFromCard(_clubId: string): void {
    const underApp = this.router.url.startsWith('/app');
    void this.router.navigate([underApp ? '/app/clubs/discover' : '/login']);
    this.closePanel();
  }
  // Same route/query shape hub-proposals.ts's own row click uses: readOnly is true for any
  // bucket other than 'inbox' (the only bucket where the reviewer/applicant can actually act) —
  // see that file's onRowClick(). A 'drafts' proposal instead opens the proposal form itself,
  // matching records-page.ts's openDraft(), since drafts have no review page to read-only view.
  openProposalFromCard(proposal: AiAssistantProposal): void {
    const underApp = this.router.url.startsWith('/app');
    if (!underApp) { void this.router.navigate(['/login']); this.closePanel(); return; }
    if (proposal.bucket === 'drafts') {
      void this.router.navigate(['/app/forms/event-proposal'], { queryParams: { proposalId: proposal.requestId } });
    } else {
      void this.router.navigate(['/app/proposals/review', proposal.requestId], {
        queryParams: { returnTo: this.router.url, readOnly: proposal.bucket !== 'inbox' },
      });
    }
    this.closePanel();
  }
  // Seed/demo event images are frequently an external placeholder URL (placehold.co) that a
  // browser extension, ad-blocker, or offline network can fail to load — same risk EventCardComponent
  // guards against for a MISSING image (see EVENT_IMAGE_PLACEHOLDER); this additionally covers a
  // present-but-unreachable URL, swapping in the same local inline-SVG placeholder rather than
  // leaving a blank broken-image box in the chat.
  onCardImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.src !== EVENT_IMAGE_PLACEHOLDER) img.src = EVENT_IMAGE_PLACEHOLDER;
  }
  // Backend sends Postgres TIME columns as "HH:MM:SS" — rendered as "1:00 PM" to match how time
  // reads everywhere else in the app (see event-details-modal, event-card).
  formatTime(value: string): string {
    const [hoursStr, minutesStr] = value.split(':');
    const hours = Number(hoursStr);
    const period = hours >= 12 ? 'PM' : 'AM';
    const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${twelveHour}:${minutesStr} ${period}`;
  }
  registrantStatusLabel(status: AiAssistantRegistrantsTable['registrants'][number]['status']): string {
    return status === 'registered' ? 'Confirmed' : status === 'pending_approval' ? 'Pending' : 'Rejected';
  }

  openEventFromCard(eventId: string): void {
    this.publishedEventService.getEventDetails(eventId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (event) => { if (event) this.selectedCardEvent.set(event); },
      error: () => { /* Event no longer available (unpublished/cancelled) - nothing to open. */ },
    });
  }

  closeCardEvent(): void { this.selectedCardEvent.set(null); }

  onCardEventRegistered(_result: RegistrationResult): void {
    this.closeCardEvent();
  }

  onOrbClick(): void {
    if (this.open()) { this.closePanel(); return; }
    // Only play the wake bounce/gesture when the orb actually needs to travel up from the
    // peeking position — if it's already fully visible, opening the chat should not replay
    // the go-down/come-up animation.
    if (this.phase() === 'peeking') this.wake({ restart: true, gesture: 'wave' });
    else if (this.hideTimer) clearTimeout(this.hideTimer);
    this.openPanel();
  }

  @HostListener('document:mousemove', ['$event'])
  trackEyes(event: MouseEvent): void {
    if (this.open()) return;
    if (this.mouseMoveRafPending) return;
    this.mouseMoveRafPending = true;
    requestAnimationFrame(() => { this.mouseMoveRafPending = false; this.processMouseMove(event); });
  }

  private processMouseMove(event: MouseEvent): void {
    const element = this.orb()?.nativeElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy) || 1;

    if (this.pointerTracking) {
      const strength = Math.min(5, distance * 0.025);
      this.eyeX.set((dx / distance) * strength);
      this.eyeY.set((dy / distance) * strength);
    }

    const now = Date.now();
    if (!this.reducedMotion && !this.idleSuspended && distance <= PROXIMITY_WAKE_PX && now - this.lastProximityWakeAt > 4000) {
      this.lastProximityWakeAt = now;
      if (this.phase() === 'peeking') this.wake({ restart: true, gesture: 'smile' });
      else this.playGesture('smile', 900);
    }

    if (!this.reducedMotion) this.trackDwell(event.clientX, event.clientY);
  }

  @HostListener('document:mouseover', ['$event'])
  glanceAtHovered(event: MouseEvent): void {
    if (this.reducedMotion || this.open() || this.idleSuspended) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const interactive = target.closest('button, a, [role="button"], [data-ai-glance]');
    if (!interactive || interactive.closest('.ai-assistant')) return;
    const now = Date.now();
    if (now - this.lastGlanceAt < 2200) return;
    const element = this.orb()?.nativeElement;
    if (!element) return;
    const orbRect = element.getBoundingClientRect();
    const targetRect = interactive.getBoundingClientRect();
    const dx = targetRect.left + targetRect.width / 2 - (orbRect.left + orbRect.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (orbRect.top + orbRect.height / 2);
    if (Math.hypot(dx, dy) > GLANCE_RADIUS_PX) return;
    this.lastGlanceAt = now;
    const distance = Math.hypot(dx, dy) || 1;
    this.eyeX.set((dx / distance) * 5);
    this.eyeY.set((dy / distance) * 5);
    this.playGesture('look-around', 1100);
  }

  @HostListener('window:blur') resetEyes(): void { this.eyeX.set(0); this.eyeY.set(0); }
  @HostListener('document:mouseout', ['$event']) leavePage(event: MouseEvent): void { if (!event.relatedTarget) this.resetEyes(); }
  @HostListener('document:keydown.escape') escape(): void { if (this.open()) this.closePanel(); }

  ngOnDestroy(): void {
    if (this.promptTimer) clearInterval(this.promptTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.restTimer) clearTimeout(this.restTimer);
    if (this.gestureScheduleTimer) clearTimeout(this.gestureScheduleTimer);
    if (this.gestureClearTimer) clearTimeout(this.gestureClearTimer);
    if (this.climbTimer) clearTimeout(this.climbTimer);
    if (this.wakeResetTimer) clearTimeout(this.wakeResetTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.body.classList.remove('ai-chat-expanded');
    }
  }

  private scrollMessages(): void { setTimeout(() => { const area = this.messageArea()?.nativeElement; if (area) area.scrollTop = area.scrollHeight; }, 0); }

  // --- Living-orb behavior --------------------------------------------
  //
  // The orb alternates visible <-> peeking indefinitely:
  //   15s visible (first load) -> 50s peeking -> 10s visible -> 50s peeking -> ...
  // Both scheduling methods take an explicit duration (no defaulted args) so the
  // "how long to wait" and "which phase we're waiting to reach" are never conflated.
  // `wake()` is the interruption path (user noticed it) — it always jumps to visible
  // immediately and, if `restart`, re-arms the loop's normal 10s visible duration
  // rather than resetting back to the one-time 15s initial window.

  private scheduleFlipToPeeking(afterMs: number): void {
    if (this.reducedMotion || this.idleSuspended) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.open() || this.idleSuspended) return;
      this.phase.set('peeking');
      this.scheduleClimbGesture();
      this.scheduleFlipToVisible(LOOP_HIDDEN_MS);
    }, afterMs);
  }

  private scheduleFlipToVisible(afterMs: number): void {
    if (this.reducedMotion || this.idleSuspended) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.open() || this.idleSuspended) return;
      this.phase.set('visible');
      this.scheduleFlipToPeeking(LOOP_VISIBLE_MS);
    }, afterMs);
  }

  private wake(options: { restart: boolean; gesture?: IdleGesture }): void {
    if (this.reducedMotion) { this.phase.set('visible'); return; }
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const wasPeeking = this.phase() === 'peeking';
    this.phase.set('visible');
    if (wasPeeking || options.gesture) {
      this.waking.set(true);
      this.playGesture(options.gesture ?? 'wave', 1200);
      if (this.wakeResetTimer) clearTimeout(this.wakeResetTimer);
      this.wakeResetTimer = setTimeout(() => this.waking.set(false), 700);
    }
    // Now visible — re-arm the flip back to peeking after the loop's normal visible duration.
    if (options.restart && !this.open() && !this.idleSuspended) this.scheduleFlipToPeeking(LOOP_VISIBLE_MS);
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      if (this.gestureScheduleTimer) clearTimeout(this.gestureScheduleTimer);
      if (this.climbTimer) clearTimeout(this.climbTimer);
    } else if (!this.open() && !this.idleSuspended) {
      if (this.phase() === 'peeking') this.scheduleFlipToVisible(LOOP_HIDDEN_MS);
      else this.scheduleFlipToPeeking(LOOP_VISIBLE_MS);
      this.scheduleNextGesture();
      if (this.phase() === 'peeking') this.scheduleClimbGesture();
    }
  };

  private scheduleNextGesture(): void {
    if (this.reducedMotion) return;
    if (this.gestureScheduleTimer) clearTimeout(this.gestureScheduleTimer);
    this.gestureScheduleTimer = setTimeout(() => {
      if (!this.open() && !this.idleSuspended && typeof document !== 'undefined' && !document.hidden) {
        const pool: IdleGesture[] = this.phase() === 'peeking'
          ? ['blink', 'look-around', 'tilt', 'wave']
          : ['blink', 'look-around', 'tilt', 'smile'];
        this.playGesture(pool[Math.floor(Math.random() * pool.length)], randomBetween(900, 1600));
      }
      this.scheduleNextGesture();
    }, randomBetween(2600, 6800));
  }

  private scheduleClimbGesture(): void {
    if (this.reducedMotion) return;
    if (this.climbTimer) clearTimeout(this.climbTimer);
    this.climbTimer = setTimeout(() => {
      if (this.phase() !== 'peeking' || this.open() || this.idleSuspended) return;
      this.playGesture('climb', 1400);
      this.scheduleClimbGesture();
    }, randomBetween(9000, 18000));
  }

  private playGesture(kind: IdleGesture, durationMs: number): void {
    this.gesture.set(kind);
    if (kind === 'tilt') this.tiltDeg.set(randomBetween(-6, 6));
    if (this.gestureClearTimer) clearTimeout(this.gestureClearTimer);
    this.gestureClearTimer = setTimeout(() => {
      if (this.gesture() === kind) this.gesture.set('none');
      if (kind === 'tilt') this.tiltDeg.set(0);
    }, durationMs);
  }

  private trackDwell(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastDwellCheck < 400) return;
    this.lastDwellCheck = now;
    if (!this.dwellOrigin || Math.hypot(x - this.dwellOrigin.x, y - this.dwellOrigin.y) > 24) {
      this.dwellOrigin = { x, y, since: now };
      return;
    }
    if (now - this.dwellOrigin.since > 6000 && this.gesture() === 'none' && !this.open() && !this.idleSuspended) {
      this.playGesture('wonder', 1300);
      this.dwellOrigin = { x, y, since: now }; // avoid re-triggering every tick while still
    }
  }
}
