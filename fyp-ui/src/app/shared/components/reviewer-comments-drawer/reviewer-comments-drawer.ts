import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, model, signal } from '@angular/core';
import { ProposalConversation } from '../../../core/proposals/proposal-conversation.models';
import { DEPARTMENT_LABELS, ReviewerCommentEntry, initialsFor } from '../../../core/proposals/proposal-status.models';
import { ConversationThreadComponent } from '../conversation-thread/conversation-thread';

// Two rendering shells over the same conversations/comments state:
//   'drawer' - the ribbon-tab + pushed-layout sliding panel, extracted from event-proposal.ts
//              (the whole-proposal resubmit form). Both this page and department-resubmit.ts wrap
//              the component INSIDE a flex row alongside their own main content column — see
//              :host { display: contents } so the ribbon/drawer participate as direct flex
//              siblings of the caller's main column, matching .proposal-page's original layout.
//   'panel'  - an always-visible sticky column, matching proposal-reviewer-view.ts's right-side
//              Workflow Actions/Conversations panel design. No ribbon, no open/close, no sliding —
//              department-resubmit.ts uses this so its comments are as visible as the reviewer's
//              own read of the same thread, not hidden behind a toggle the applicant has to know
//              to click.
// Both variants share the same list -> thread -> Back flow (WhatsApp-style) and the same flat
// `comments` snapshot fallback for a proposal with no conversation rows yet.
@Component({
  selector: 'app-reviewer-comments-drawer',
  imports: [ConversationThreadComponent, NgTemplateOutlet],
  template: `
    @if (variant() === 'drawer') {
      @if (hasContent() && !open()) {
        <button type="button" class="comments-ribbon" [attr.aria-expanded]="open()" aria-controls="reviewer-comments-drawer" (click)="toggle()">
          Reviewer comment{{ comments().length === 1 ? '' : 's' }}
        </button>
      }
      @if (hasContent()) {
        <aside id="reviewer-comments-drawer" class="comments-drawer" [class.comments-drawer--open]="open()" aria-label="Reviewer comments" (click)="toggle()">
          <div class="comments-drawer__inner" (click)="$event.stopPropagation()">
            <ng-container [ngTemplateOutlet]="body" />
          </div>
        </aside>
      }
    } @else if (hasContent()) {
      <aside class="comments-panel" aria-label="Reviewer comments">
        <ng-container [ngTemplateOutlet]="body" />
      </aside>
    }

    <ng-template #body>
      @if (conversations().length) {
        @if (activeConversation(); as active) {
          <header class="comments-drawer__header">
            <button type="button" class="comments-drawer__back" (click)="activeConversationId.set(null)" aria-label="Back to conversations">
              <span class="material-symbols-rounded" aria-hidden="true">arrow_back</span>
            </button>
            <div>
              <h3>{{ activeSummary()!.partnerName }}</h3>
              <p class="comments-drawer__subtitle">{{ activeSummary()!.partnerRoleLabel }}</p>
            </div>
            @if (variant() === 'drawer') {
              <button type="button" class="comments-drawer__close" (click)="toggle()" aria-label="Collapse reviewer comments panel">
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            }
          </header>
          <app-conversation-thread [messages]="active.messages" [title]="activeSummary()!.partnerName" />
        } @else {
          <header class="comments-drawer__header">
            <span class="material-symbols-rounded" aria-hidden="true">forum</span>
            <div>
              <h3>Conversations</h3>
              <p class="comments-drawer__subtitle">{{ subtitle() }}</p>
            </div>
            @if (variant() === 'drawer') {
              <button type="button" class="comments-drawer__close" (click)="toggle()" aria-label="Collapse reviewer comments panel">
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            }
          </header>
          <ul class="comments-drawer__list">
            @for (conversation of conversationSummaries(); track conversation.conversationId) {
              <li>
                <button type="button" class="comments-drawer__conversation" (click)="activeConversationId.set(conversation.conversationId)">
                  <div class="comments-drawer__avatar" aria-hidden="true">{{ conversation.initials }}</div>
                  <div class="comments-drawer__entry-body">
                    <div class="comments-drawer__entry-row">
                      <strong>{{ conversation.partnerName }}</strong>
                      <time class="comments-drawer__entry-time">{{ conversation.lastMessageAt }}</time>
                    </div>
                    <p class="comments-drawer__entry-text">{{ conversation.lastMessage }}</p>
                  </div>
                </button>
              </li>
            }
          </ul>
        }
      } @else {
        <header class="comments-drawer__header">
          <span class="material-symbols-rounded" aria-hidden="true">forum</span>
          <div>
            <h3>Reviewer Comments</h3>
            <p class="comments-drawer__subtitle">{{ subtitle() }}</p>
          </div>
          @if (variant() === 'drawer') {
            <button type="button" class="comments-drawer__close" (click)="toggle()" aria-label="Collapse reviewer comments panel">
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          }
        </header>
        <ul class="comments-drawer__list">
          @for (comment of comments(); track comment.reviewer + comment.text) {
            <li class="comments-drawer__entry">
              <div class="comments-drawer__avatar" aria-hidden="true">{{ comment.initials }}</div>
              <div class="comments-drawer__entry-body">
                <div class="comments-drawer__entry-meta">
                  <strong>{{ comment.reviewer }}</strong>
                  <span class="comments-drawer__entry-stage">{{ comment.stage }}</span>
                </div>
                <p class="comments-drawer__entry-text">{{ comment.text }}</p>
              </div>
            </li>
          }
        </ul>
      }
    </ng-template>
  `,
  styleUrl: './reviewer-comments-drawer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewerCommentsDrawerComponent {
  readonly comments = input.required<readonly ReviewerCommentEntry[]>();
  readonly conversations = input<readonly ProposalConversation[]>([]);
  readonly subtitle = input('Everything that needs your attention before you resubmit.');
  // 'drawer' (default): the sliding ribbon/panel used by event-proposal.ts. 'panel': the
  // always-visible sticky column used by department-resubmit.ts — see the class doc comment.
  readonly variant = input<'drawer' | 'panel'>('drawer');
  // Set by the caller when the applicant landed here specifically to answer a resubmission
  // request (as opposed to browsing an already-decided proposal from their history) — jumps the
  // drawer straight into that conversation instead of opening on the Conversations list, since
  // that is the one thread the applicant actually needs to read and reply to right now.
  readonly initialConversationId = input<string | null>(null);
  // Two-way bindable ([( open )]) so a caller that needs to react to open/closed (e.g. shrinking
  // its own main content column while the drawer is open, see event-proposal.scss's
  // .proposal-page--drawer-open) can — defaults to open the moment there are comments to show.
  // Unused in 'panel' mode: the panel is always visible, nothing to open/close.
  readonly open = model(true);

  readonly activeConversationId = signal<string | null>(null);
  private appliedInitialConversationId = false;

  constructor() {
    // Runs once conversations() actually has data (initialConversationId is computed from it by
    // the caller, so both land together) — applies only the first time so the applicant's own
    // Back navigation within the drawer is never overridden by a later change detection pass.
    effect(() => {
      const id = this.initialConversationId();
      if (!id || this.appliedInitialConversationId) return;
      if (!this.conversations().some((c) => c.conversationId === id)) return;
      this.appliedInitialConversationId = true;
      this.activeConversationId.set(id);
    });
  }

  readonly hasContent = computed(() => this.conversations().length > 0 || this.comments().length > 0);

  readonly activeConversation = computed(() => {
    const id = this.activeConversationId();
    return id ? this.conversations().find((c) => c.conversationId === id) ?? null : null;
  });

  readonly activeSummary = computed(() => {
    const id = this.activeConversationId();
    return id ? this.conversationSummaries().find((c) => c.conversationId === id) ?? null : null;
  });

  readonly conversationSummaries = computed(() =>
    this.conversations().map((conversation) => {
      const partnerName = conversation.conversationId.startsWith('task:')
        ? (DEPARTMENT_LABELS[conversation.partnerName] ?? conversation.partnerName)
        : conversation.partnerName;
      const lastMsg = conversation.messages[conversation.messages.length - 1];
      return {
        conversationId: conversation.conversationId,
        partnerName,
        partnerRoleLabel: conversation.partnerRoleLabel,
        initials: initialsFor(partnerName),
        lastMessage: lastMsg?.text ?? '',
        lastMessageAt: lastMsg ? this.formatListTime(lastMsg.createdAt) : '',
      };
    }),
  );

  toggle(): void { this.open.update((value) => !value); }

  // Short relative-ish stamp for a list row (e.g. "2:34 PM", or the date once it's not today) —
  // matches a standard chat-app inbox list, not the fuller "3 Aug, 2:34 PM" used inside a thread.
  protected formatListTime(iso: string): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const isToday = date.toDateString() === new Date().toDateString();
    return isToday
      ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
}
