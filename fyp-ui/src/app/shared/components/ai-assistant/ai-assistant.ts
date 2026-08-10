import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { AiOrbAwarenessService } from './ai-orb-awareness.service';

interface ChatMessage { readonly id: number; readonly sender: 'assistant' | 'user'; readonly text: string; }
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

const CARDS_PER_PAGE = 4;
const SUGGESTION_CARD_PAGES: readonly (readonly SuggestionCard[])[] = Array.from(
  { length: Math.ceil(SUGGESTION_CARDS.length / CARDS_PER_PAGE) },
  (_, page) => SUGGESTION_CARDS.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE),
);

let messageAutoId = 1;
const createGreeting = (): ChatMessage => ({ id: messageAutoId++, sender: 'assistant', text: GREETING });

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
  templateUrl: './ai-assistant.html',
  styleUrl: './ai-assistant.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAssistantComponent implements OnDestroy {
  private readonly awareness = inject(AiOrbAwarenessService);
  readonly launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');
  readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  readonly messageArea = viewChild<ElementRef<HTMLElement>>('messageArea');
  readonly orb = viewChild<ElementRef<HTMLElement>>('orb');
  readonly open = signal(false);
  readonly promptVisible = signal(true);
  readonly promptIndex = signal(0);
  readonly promptChanging = signal(false);
  readonly draft = signal('');
  readonly typing = signal(false);
  readonly error = signal('');
  readonly eyeX = signal(0);
  readonly eyeY = signal(0);
  readonly messages = signal<readonly ChatMessage[]>([createGreeting()]);
  readonly hasInteracted = signal(false);
  readonly cardPages = SUGGESTION_CARD_PAGES;

  // Living-orb state
  readonly phase = signal<OrbPhase>('visible');
  readonly waking = signal(false);
  readonly gesture = signal<IdleGesture>('none');
  readonly tiltDeg = signal(0);

  private readonly reducedMotion: boolean;
  private readonly pointerTracking: boolean;
  private readonly promptTimer?: ReturnType<typeof setInterval>;
  private responseTimer?: ReturnType<typeof setTimeout>;
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

    afterNextRender(() => this.scrollMessages());
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
    this.open.set(false);
    this.typing.set(false);
    if (this.responseTimer) clearTimeout(this.responseTimer);
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

  dismissPrompt(event: Event): void { event.stopPropagation(); this.promptVisible.set(false); }

  selectCard(card: SuggestionCard): void { this.hasInteracted.set(true); this.draft.set(card.prompt); this.send(); }

  newChat(): void {
    if (this.responseTimer) clearTimeout(this.responseTimer);
    this.typing.set(false);
    this.error.set('');
    this.draft.set('');
    this.hasInteracted.set(false);
    this.messages.set([createGreeting()]);
    setTimeout(() => this.composer()?.nativeElement.focus(), 0);
  }

  composerKeydown(event: KeyboardEvent): void { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); } }
  send(): void {
    const text = this.draft().trim();
    if (!text || this.typing()) { if (!text) this.error.set('Enter a question before sending.'); return; }
    this.hasInteracted.set(true);
    this.messages.update((items) => [...items, { id: messageAutoId++, sender: 'user', text }]);
    this.draft.set(''); this.error.set(''); this.typing.set(true); this.scrollMessages();
    this.responseTimer = setTimeout(() => {
      this.messages.update((items) => [...items, { id: messageAutoId++, sender: 'assistant', text: this.responseFor(text) }]);
      this.typing.set(false); this.scrollMessages();
      // No-op while the panel is open (already fully visible with idle suspended) — kept
      // for correctness if a background/notification-driven response path is added later.
      if (!this.open()) this.wake({ restart: true, gesture: 'smile' });
    }, this.reducedMotion ? 0 : 850);
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
    if (this.responseTimer) clearTimeout(this.responseTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.restTimer) clearTimeout(this.restTimer);
    if (this.gestureScheduleTimer) clearTimeout(this.gestureScheduleTimer);
    if (this.gestureClearTimer) clearTimeout(this.gestureClearTimer);
    if (this.climbTimer) clearTimeout(this.climbTimer);
    if (this.wakeResetTimer) clearTimeout(this.wakeResetTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private scrollMessages(): void { setTimeout(() => { const area = this.messageArea()?.nativeElement; if (area) area.scrollTop = area.scrollHeight; }, 0); }
  private responseFor(question: string): string {
    const value = question.toLowerCase();
    if (value.includes('create') || value.includes('proposal')) return 'Open Forms → Proposal, complete each step, save a draft if needed, then submit it for approval.';
    if (value.includes('track') || value.includes('status')) return 'You can track active requests from Ingoing or Ongoing Requests, depending on your role. Completed items appear in History.';
    if (value.includes('after') || value.includes('submission')) return 'After submission, the proposal moves through the required approvers and department reviews. Your dashboard and Inbox will show updates.';
    return 'I can help with event discovery, proposal steps, request status, and department services. Please ask a little more about what you need.';
  }

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
