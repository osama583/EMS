import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, model, signal } from '@angular/core';
import { ProposalConversation } from '../../../core/proposals/proposal-conversation.models';
import { DEPARTMENT_LABELS, ReviewerCommentEntry, initialsFor } from '../../../core/proposals/proposal-status.models';
import { COMMENTS_DOCK_QUERY, viewportMatches } from '../../viewport-query';
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
    @if (hasContent()) {
      @if (showTab()) {
        <button type="button" class="comments-dock-tab" [attr.aria-expanded]="false" (click)="expand()">
          Reviewer comments
        </button>
      }

      @if (compact()) {
        <!-- Narrow: both variants collapse to the same dock the reviewer/department views use -
             an edge tab, and this card as a right-docked overlay once that tab is clicked. -->
        @if (compactOpen()) {
          <button
            type="button"
            class="comments-dock-scrim"
            aria-label="Close reviewer comments"
            (click)="collapse()"
            (document:keydown.escape)="collapse()"
          ></button>
          <aside class="comments-card comments-dock-surface" aria-label="Reviewer comments">
            <ng-container [ngTemplateOutlet]="body" />
          </aside>
        }
      } @else if (variant() === 'drawer') {
        <aside id="reviewer-comments-drawer" class="comments-drawer" [class.comments-drawer--open]="open()" aria-label="Reviewer comments" (click)="toggle()">
          <div class="comments-drawer__inner" (click)="$event.stopPropagation()">
            <ng-container [ngTemplateOutlet]="body" />
          </div>
        </aside>
      } @else {
        <aside class="comments-card comments-panel" aria-label="Reviewer comments">
          <ng-container [ngTemplateOutlet]="body" />
        </aside>
      }
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
            @if (showClose()) {
              <button type="button" class="comments-drawer__close" (click)="collapse()" aria-label="Close reviewer comments">
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
            @if (showClose()) {
              <button type="button" class="comments-drawer__close" (click)="collapse()" aria-label="Close reviewer comments">
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
          @if (showClose()) {
            <button type="button" class="comments-drawer__close" (click)="collapse()" aria-label="Close reviewer comments">
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
  // Two-way bindable ([( open )]) so a caller that needs to react to open/closed — or to open and
  // close the drawer itself — can; defaults to open the moment there are comments to show. The
  // caller does NOT have to resize its own main column in response: that column is `flex: 1 1 0`
  // and absorbs whatever width the drawer gives up (see event-proposal.scss).
  // Unused in 'panel' mode: the panel is always visible, nothing to open/close.
  readonly open = model(true);

  readonly activeConversationId = signal<string | null>(null);
  private appliedInitialConversationId = false;

  // Below the dock breakpoint neither shell has a column to live in: the drawer has no room left
  // to push the form aside, and the panel would simply stack under the whole page. Both collapse
  // to the shared dock (styles/_comments-dock.scss) - an edge tab plus a right-docked overlay -
  // so every comments surface in the app behaves the same once the window gets narrow.
  protected readonly compact = viewportMatches(COMMENTS_DOCK_QUERY);
  // Starts closed, deliberately: docked, the tab is what you should see first, and only a click
  // brings the conversation up over the page. `open` above stays the WIDE state, untouched by
  // this, so resizing back restores whatever the caller had.
  protected readonly compactOpen = signal(false);

  // Which shell is showing, and what it should offer.
  protected readonly expanded = computed(() =>
    this.compact() ? this.compactOpen() : this.variant() === 'panel' || this.open(),
  );
  protected readonly showTab = computed(() =>
    this.hasContent() && (this.compact() ? !this.compactOpen() : this.variant() === 'drawer' && !this.open()),
  );
  // The always-visible wide panel is the one shell with nothing to close.
  protected readonly showClose = computed(() => this.compact() || this.variant() === 'drawer');

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

  expand(): void { if (this.compact()) this.compactOpen.set(true); else this.open.set(true); }
  collapse(): void { if (this.compact()) this.compactOpen.set(false); else this.open.set(false); }
  toggle(): void { if (this.expanded()) this.collapse(); else this.expand(); }

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
