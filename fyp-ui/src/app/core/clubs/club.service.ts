import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeletionMetadata, DeletionPreview } from '../../shared/models/deletion.models';
import { ClubCategoryName, ClubCategoryPage, ClubCategoryRecord, ClubDraft, ClubJoinRequestPage, ClubJoinRequestRecord, ClubMemberRecord, ClubMyStatus, ClubPage, ClubRecord, ClubSortKey, ClubUserSummary, PresidentChangeRequestPage, PresidentChangeRequestQuery } from './club.models';

@Injectable({ providedIn: 'root' })
export class ClubService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}`;

  getClubs(options?: { activeOnly?: boolean; viewerUserId?: string }): Observable<readonly ClubRecord[]> {
    const params: Record<string, string> = {};
    if (options?.activeOnly) params['activeOnly'] = 'true';
    if (options?.viewerUserId) params['viewerUserId'] = options.viewerUserId;
    return this.http.get<readonly ClubRecord[]>(`${this.baseUrl}/clubs`, { params });
  }
  getClub(id: string): Observable<ClubRecord> { return this.http.get<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}`); }
  // Server-side search/filter/sort/pagination for the /app/clubs/manage management page —
  // same treatment as searchCategories() below. getClubs() above stays unpaginated for the
  // club directory and My Clubs, which both render every (active) club at once.
  searchClubs(options: { search?: string; status?: 'all' | 'active' | 'inactive'; categoryId?: string; sort: ClubSortKey; order: 'asc' | 'desc'; page: number; pageSize: number }): Observable<ClubPage> {
    const params: Record<string, string> = {
      page: String(options.page), pageSize: String(options.pageSize),
      sort: options.sort, order: options.order,
    };
    if (options.search) params['q'] = options.search;
    if (options.status && options.status !== 'all') params['status'] = options.status;
    if (options.categoryId && options.categoryId !== 'all') params['categoryId'] = options.categoryId;
    return this.http.get<ClubPage>(`${this.baseUrl}/clubs/search`, { params });
  }
  getEligiblePresidents(): Observable<readonly ClubUserSummary[]> { return this.http.get<readonly ClubUserSummary[]>(`${this.baseUrl}/clubs/eligible-presidents`); }
  createClub(draft: ClubDraft, createdByUserId: string): Observable<ClubRecord> {
    return this.http.post<ClubRecord>(`${this.baseUrl}/clubs`, {
      name: draft.name, description: draft.description, imageUrl: draft.imageUrl,
      presidentUserId: draft.presidentUserId, categoryIds: draft.categoryIds, active: draft.active, createdByUserId,
    });
  }
  updateClub(id: string, draft: ClubDraft): Observable<ClubRecord> {
    return this.http.put<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}`, {
      name: draft.name, description: draft.description, imageUrl: draft.imageUrl,
      presidentUserId: draft.presidentUserId, categoryIds: draft.categoryIds, active: draft.active,
    });
  }
  setClubActive(id: string, active: boolean): Observable<ClubRecord> { return this.http.patch<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}/status`, { active }); }

  // Deleting a club follows the same dependency-gated lifecycle as every other admin entity:
  // check first, soft-delete only when nothing references it, restorable for 7 days. A club with
  // members or pending requests is never deleted — setClubActive(false) is the answer there.
  checkClubDeletion(id: string): Observable<DeletionPreview> {
    return this.http.get<DeletionPreview>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}/deletion-check`);
  }
  deleteClub(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}`);
  }
  restoreClub(id: string): Observable<ClubRecord> {
    return this.http.post<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}/restore`, {});
  }
  getDeletedClubs(): Observable<readonly (ClubRecord & DeletionMetadata)[]> {
    return this.http.get<readonly (ClubRecord & DeletionMetadata)[]>(`${this.baseUrl}/clubs/deleted`);
  }
  // Self-service: the club's own President may change just its categories (1-3), not the name,
  // image, or President — that stays Club Admin-only via updateClub() above.
  setClubCategories(id: string, categoryIds: readonly string[], actingUserId: string): Observable<ClubRecord> {
    return this.http.patch<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}/categories`, { categoryIds, actingUserId });
  }

  getCategories(options?: { activeOnly?: boolean }): Observable<readonly ClubCategoryRecord[]> {
    const params: Record<string, string> = {};
    if (options?.activeOnly) params['activeOnly'] = 'true';
    return this.http.get<readonly ClubCategoryRecord[]>(`${this.baseUrl}/club-categories`, { params });
  }
  // id/name only — for a "filter by category" dropdown (Manage Clubs), which never needs
  // `active`/`createdAt` and so should never pay for them over the wire.
  getCategoryNames(): Observable<readonly ClubCategoryName[]> {
    return this.http.get<readonly ClubCategoryName[]>(`${this.baseUrl}/club-categories`, { params: { namesOnly: 'true' } });
  }
  // Server-side search/pagination for the /app/club-category management page — filtering, the
  // active/inactive split, and the page slice all happen in SQL, not in the browser.
  searchCategories(options: { search?: string; includeInactive?: boolean; page: number; pageSize: number }): Observable<ClubCategoryPage> {
    const params: Record<string, string> = { page: String(options.page), pageSize: String(options.pageSize) };
    if (options.search) params['q'] = options.search;
    if (options.includeInactive) params['includeInactive'] = 'true';
    return this.http.get<ClubCategoryPage>(`${this.baseUrl}/club-categories/search`, { params });
  }
  createCategory(name: string, createdByUserId: string): Observable<ClubCategoryRecord> {
    return this.http.post<ClubCategoryRecord>(`${this.baseUrl}/club-categories`, { name, createdByUserId });
  }
  updateCategory(id: string, name: string): Observable<ClubCategoryRecord> {
    return this.http.put<ClubCategoryRecord>(`${this.baseUrl}/club-categories/${encodeURIComponent(id)}`, { name });
  }
  setCategoryActive(id: string, active: boolean): Observable<ClubCategoryRecord> {
    return this.http.patch<ClubCategoryRecord>(`${this.baseUrl}/club-categories/${encodeURIComponent(id)}/status`, { active });
  }
  checkCategoryDeletion(id: string): Observable<DeletionPreview> {
    return this.http.get<DeletionPreview>(`${this.baseUrl}/club-categories/${encodeURIComponent(id)}/deletion-check`);
  }
  deleteCategory(id: string): Observable<ClubCategoryRecord> {
    return this.http.delete<ClubCategoryRecord>(`${this.baseUrl}/club-categories/${encodeURIComponent(id)}`);
  }
  restoreCategory(id: string): Observable<ClubCategoryRecord> {
    return this.http.post<ClubCategoryRecord>(`${this.baseUrl}/club-categories/${encodeURIComponent(id)}/restore`, {});
  }
  getDeletedCategories(): Observable<readonly (ClubCategoryRecord & DeletionMetadata)[]> {
    return this.http.get<readonly (ClubCategoryRecord & DeletionMetadata)[]>(`${this.baseUrl}/club-categories/deleted`);
  }
  getClubMembers(id: string): Observable<readonly ClubMemberRecord[]> { return this.http.get<readonly ClubMemberRecord[]>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}/members`); }
  removeMember(clubId: string, userId: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(userId)}`); }

  // Club Admin is granted/revoked via the normal Users -> Assignments flow (the 'club-admin' flat
  // role, see AdminDirectoryService.assignRole()/removeAssignment()) — no dedicated club-admin
  // grant/revoke endpoints any more.

  sendJoinRequest(clubId: string, requesterUserId: string, reason: string): Observable<ClubJoinRequestRecord> {
    return this.http.post<ClubJoinRequestRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(clubId)}/join-requests`, { requesterUserId, reason });
  }
  // Pending requests for the clubs the caller presides over. Searched/filtered/paginated
  // server-side (clubs.py's join_requests_inbox()) — the Club Requests inbox's search box and
  // club dropdown are real query params, not a client-side filter over the whole set. Always
  // scoped to the caller by the server (see that endpoint's docstring), so no presidentUserId
  // is sent — one never was read server-side either.
  getInbox(query: { q?: string; club?: string; page: number; pageSize: number }): Observable<ClubJoinRequestPage> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.club) params = params.set('club', query.club);
    return this.http.get<ClubJoinRequestPage>(`${this.baseUrl}/clubs/join-requests/inbox`, { params });
  }
  // Distinct club names with a pending join request, for the inbox's club filter dropdown —
  // its own small unpaginated query, independent of which page is shown.
  getInboxClubOptions(): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/clubs/join-requests/inbox/clubs`);
  }
  getMyRequests(requesterUserId: string): Observable<readonly ClubJoinRequestRecord[]> {
    return this.http.get<readonly ClubJoinRequestRecord[]>(`${this.baseUrl}/clubs/join-requests/mine`, { params: { requesterUserId } });
  }
  // Requests I have already approved/rejected as President — the resolved counterpart to
  // getInbox(). Feeds History's "decided by me" direction.
  getDecided(presidentUserId: string): Observable<readonly ClubJoinRequestRecord[]> {
    return this.http.get<readonly ClubJoinRequestRecord[]>(`${this.baseUrl}/clubs/join-requests/decided`, { params: { presidentUserId } });
  }
  approveJoinRequest(id: string, resolvedByUserId: string): Observable<ClubJoinRequestRecord> {
    return this.http.post<ClubJoinRequestRecord>(`${this.baseUrl}/clubs/join-requests/${encodeURIComponent(id)}/approve`, { resolvedByUserId });
  }
  rejectJoinRequest(id: string, resolvedByUserId: string, comment: string): Observable<ClubJoinRequestRecord> {
    return this.http.post<ClubJoinRequestRecord>(`${this.baseUrl}/clubs/join-requests/${encodeURIComponent(id)}/reject`, { resolvedByUserId, comment });
  }

  getMyStatus(userId: string): Observable<ClubMyStatus> { return this.http.get<ClubMyStatus>(`${this.baseUrl}/clubs/my-status/${encodeURIComponent(userId)}`); }

  // President Change Requests — the only way a sitting President stops presiding (leaving/being
  // removed directly is always blocked server-side). Every list here is server-paginated/
  // filtered/sorted, unlike the older unpaginated join-request endpoints above.
  requestPresidentChange(clubId: string, requestedPresidentUserId: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/clubs/${encodeURIComponent(clubId)}/president-change-requests`, { requestedPresidentUserId });
  }
  private presidentChangeRequests(path: string, query: PresidentChangeRequestQuery, scope?: 'pending' | 'decided'): Observable<PresidentChangeRequestPage> {
    const params: Record<string, string> = {
      page: String(query.page), pageSize: String(query.pageSize),
      sort: query.sort, order: query.order,
    };
    if (query.q) params['q'] = query.q;
    if (scope) params['scope'] = scope;
    return this.http.get<PresidentChangeRequestPage>(`${this.baseUrl}/clubs/president-change-requests/${path}`, { params });
  }
  // Pending requests awaiting a Club Admin's decision.
  getPresidentChangeInbox(query: PresidentChangeRequestQuery): Observable<PresidentChangeRequestPage> {
    return this.presidentChangeRequests('inbox', query);
  }
  // A President's own submitted request still awaiting a Club Admin's decision — never
  // actionable by the President themself, so it belongs in Ongoing, not Inbox.
  getMyPendingPresidentChangeRequest(query: PresidentChangeRequestQuery): Observable<PresidentChangeRequestPage> {
    return this.presidentChangeRequests('mine', query, 'pending');
  }
  // A President's own already-decided requests, for their History tab.
  getMyDecidedPresidentChangeRequests(query: PresidentChangeRequestQuery): Observable<PresidentChangeRequestPage> {
    return this.presidentChangeRequests('mine', query, 'decided');
  }
  // Every decided request, for the History tab (Club Admin/System Admin only).
  getPresidentChangeHistory(query: PresidentChangeRequestQuery): Observable<PresidentChangeRequestPage> {
    return this.presidentChangeRequests('history', query);
  }
  approvePresidentChange(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/clubs/president-change-requests/${encodeURIComponent(id)}/approve`, {});
  }
  rejectPresidentChange(id: string, comment: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/clubs/president-change-requests/${encodeURIComponent(id)}/reject`, { comment });
  }
}
