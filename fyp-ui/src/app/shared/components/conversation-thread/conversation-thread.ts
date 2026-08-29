import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, input, viewChild } from '@angular/core';
import { ConversationMessage } from '../../../core/proposals/proposal-conversation.models';

// Pure, WhatsApp-style rendering of one conversation's messages - no fetching, no state beyond
// its inputs. Reused by ReviewerCommentsDrawerComponent (applicant side, once a conversation is
// selected) and the reviewer/department inline comment cards (authority side, which only ever
// gets their own single thread back from the server) - one bubble-rendering implementation
// instead of duplicating this CSS/logic across every place that shows a comment thread.
@Component({
  selector: 'app-conversation-thread',
  template: `
    <ol #list class="convo-thread" [attr.aria-label]="title()" tabindex="0">
      @for (message of messages(); track message.createdAt + message.text) {
        <li class="convo-thread__row" [class.convo-thread__row--applicant]="message.senderSide === 'applicant'">
          <div class="convo-thread__avatar" aria-hidden="true">{{ firstLetterOf(message.senderName) }}</div>
          <div class="convo-thread__bubble">
            <div class="convo-thread__meta">
              <strong>{{ message.senderName }}</strong>
              <span class="convo-thread__role">{{ message.senderRoleLabel }}</span>
            </div>
            <p class="convo-thread__text">{{ message.text }}</p>
            <time class="convo-thread__time" [dateTime]="message.createdAt">{{ formatTime(message.createdAt) }}</time>
          </div>
        </li>
      }
    </ol>
  `,
  styleUrl: './conversation-thread.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationThreadComponent {
  readonly messages = input.required<readonly ConversationMessage[]>();
  readonly title = input('Conversation');

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // The thread renders inside a fixed-height box now (see reviewer-comments-drawer.scss), so a
    // conversation longer than that box scrolls instead of stretching it - which leaves the
    // newest message below the fold on open. Land on it the way every chat client does, on first
    // render and whenever the message list changes.
    afterRenderEffect(() => {
      this.messages();
      const el = this.list()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // Just the first letter of the sender's name for the avatar circle — not the two-letter
  // initials used elsewhere (list rows, reviewer comment cards), per the chat bubble design.
  protected firstLetterOf(name: string): string {
    return name.trim().charAt(0).toUpperCase();
  }

  protected formatTime(iso: string): string {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
}
