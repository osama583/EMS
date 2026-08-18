export interface ClubUserSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: string;
}

export interface ClubCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface ClubRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly imageUrl: string | null;
  // A club carries 1 to 3 categories (enforced server-side); never empty for a saved club.
  readonly categories: readonly ClubCategoryRecord[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly president: ClubUserSummary | null;
  readonly createdBy: ClubUserSummary | null;
  readonly memberCount: number;
  readonly pendingRequestCount: number;
  // Only populated when the list is fetched with a viewerUserId (the Clubs browse page) —
  // absent on the Club Admin management list, which has no single "viewer" perspective.
  readonly viewerIsMember?: boolean;
  readonly viewerHasPendingRequest?: boolean;
  readonly viewerIsPresident?: boolean;
}

export interface ClubDraft {
  readonly name: string;
  readonly description: string;
  readonly imageUrl: string | null;
  readonly presidentUserId: string | null;
  readonly categoryIds: readonly string[];
  readonly active: boolean;
}

export interface ClubMemberRecord {
  readonly user: ClubUserSummary;
  readonly dateJoined: string;
}

export type ClubJoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ClubJoinRequestRecord {
  readonly id: string;
  readonly clubId: string;
  readonly clubName: string;
  readonly requester: ClubUserSummary;
  // Why the requester wants to join — required at submission, so the President has something to
  // base approve/reject on.
  readonly reason: string;
  readonly status: ClubJoinRequestStatus;
  // The President's reason for rejecting (required, >= 20 characters) — empty until resolved,
  // and always empty for an approved request.
  readonly comment: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface ClubMyStatus {
  readonly isClubAdmin: boolean;
  readonly presidentOfClubIds: readonly string[];
}
