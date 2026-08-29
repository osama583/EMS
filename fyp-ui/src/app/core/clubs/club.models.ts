// A candidate for club President — GET /clubs/eligible-presidents. id/displayName/email only:
// every caller (club-management.ts's presidentOptions, president-change-request-modal.ts) only
// ever builds a dropdown option out of these three, so the server never sends a "role" (it was
// always the same hardcoded 'Member' string with no per-caller use).
export interface ClubUserSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface ClubCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly createdAt: string;
}

// The lean shape for a "filter by category" dropdown (Manage Clubs) — just what labels an
// option, never `active`/`createdAt`, which that caller has no use for.
export interface ClubCategoryName {
  readonly id: string;
  readonly name: string;
}

/** The server's paginated envelope — mirrors row-assignment.models.ts's Page<T>. */
export interface ClubCategoryPage {
  readonly items: readonly ClubCategoryRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export type ClubSortKey = 'name' | 'president' | 'members' | 'createdAt';

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

/** Mirrors ClubCategoryPage — the envelope for the server-paginated /clubs/search list. */
export interface ClubPage {
  readonly items: readonly ClubRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
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
  readonly clubImageUrl: string | null;
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

/** Mirrors ClubPage — the envelope for the server-paginated /clubs/join-requests/inbox list. */
export interface ClubJoinRequestPage {
  readonly items: readonly ClubJoinRequestRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ClubMyStatus {
  readonly isClubAdmin: boolean;
  readonly presidentOfClubIds: readonly string[];
}

export type PresidentChangeRequestStatus = 'pending' | 'approved' | 'rejected';
export type PresidentChangeRequestSortKey = 'createdAt' | 'resolvedAt' | 'club' | 'status';

// A club President's request to hand the role to someone else — the only path off being
// President, since DELETE /clubs/{id}/members/{userId} always blocks removing/self-removing one.
export interface PresidentChangeRequestRecord {
  readonly id: string;
  readonly clubId: string;
  readonly clubName: string;
  readonly currentPresident: ClubUserSummary;
  readonly requestedPresident: ClubUserSummary;
  readonly status: PresidentChangeRequestStatus;
  // The Club Admin's reason for rejecting (required, >= 20 characters) — empty until resolved.
  readonly comment: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: ClubUserSummary | null;
}

/** Mirrors ClubPage — the envelope for the server-paginated president-change-request endpoints. */
export interface PresidentChangeRequestPage {
  readonly items: readonly PresidentChangeRequestRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PresidentChangeRequestQuery {
  readonly q?: string;
  readonly sort: PresidentChangeRequestSortKey;
  readonly order: 'asc' | 'desc';
  readonly page: number;
  readonly pageSize: number;
}

// One club as an option in the proposal form's "Club Only" audience picker.
// Deliberately minimal - the picker needs an id to submit and a name to show,
// nothing else about the club.
export interface ClubOption {
  readonly id: string;
  readonly name: string;
}
