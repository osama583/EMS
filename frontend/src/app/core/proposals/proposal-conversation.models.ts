export type ConversationSenderSide = 'authority' | 'applicant';

export interface ConversationMessage {
  readonly senderSide: ConversationSenderSide;
  readonly senderName: string;
  readonly senderRoleLabel: string;
  readonly text: string;
  readonly createdAt: string;
}

// One private thread between the applicant and a single authority (a specific reviewer-stage person,
// or a department).
export interface ProposalConversation {
  readonly conversationId: string;
  readonly partnerName: string;
  readonly partnerRoleLabel: string;
  readonly messages: readonly ConversationMessage[];
}
