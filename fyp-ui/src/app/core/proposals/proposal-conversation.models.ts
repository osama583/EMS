export type ConversationSenderSide = 'authority' | 'applicant';

export interface ConversationMessage {
  readonly senderSide: ConversationSenderSide;
  readonly senderName: string;
  readonly senderRoleLabel: string;
  readonly text: string;
  readonly createdAt: string;
}

// One private thread between the applicant and a single authority (a specific
// reviewer-stage person, or a department). partnerName/partnerRoleLabel come
// straight from the server (see backend/app/services/workflow/history.py's
// conversations_for) except for department threads, where partnerName is the
// raw requirement key (e.g. 'logistics') - map it through DEPARTMENT_LABELS
// (proposal-status.models.ts) before display, same as everywhere else in this
// app that shows a requirement key to a human.
export interface ProposalConversation {
  readonly conversationId: string;
  readonly partnerName: string;
  readonly partnerRoleLabel: string;
  readonly messages: readonly ConversationMessage[];
}
