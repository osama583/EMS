import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeletionMetadata, DeletionPreview } from '../../shared/models/deletion.models';
import { ClubCategoryRecord, ClubDraft, ClubJoinRequestRecord, ClubMemberRecord, ClubMyStatus, ClubRecord, ClubUserSummary } from './club.models';

@Injectable({ providedIn: 'root' })
export class ClubService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.clubsApiUrl;

  getClubs(options?: { activeOnly?: boolean; viewerUserId?: string }): Observable<readonly ClubRecord[]> {
    const params: Record<string, string> = {};
    if (options?.activeOnly) params['activeOnly'] = 'true';
    if (options?.viewerUserId) params['viewerUserId'] = options.viewerUserId;
    return this.http.get<readonly ClubRecord[]>(`${this.baseUrl}/clubs`, { params });
  }
  getClub(id: string): Observable<ClubRecord> { return this.http.get<ClubRecord>(`${this.baseUrl}/clubs/${encodeURIComponent(id)}`); }
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
  getInbox(presidentUserId: string): Observable<readonly ClubJoinRequestRecord[]> {
    return this.http.get<readonly ClubJoinRequestRecord[]>(`${this.baseUrl}/clubs/join-requests/inbox`, { params: { presidentUserId } });
  }
  getMyRequests(requesterUserId: string): Observable<readonly ClubJoinRequestRecord[]> {
    return this.http.get<readonly ClubJoinRequestRecord[]>(`${this.baseUrl}/clubs/join-requests/mine`, { params: { requesterUserId } });
  }
  approveJoinRequest(id: string, resolvedByUserId: string): Observable<ClubJoinRequestRecord> {
    return this.http.post<ClubJoinRequestRecord>(`${this.baseUrl}/clubs/join-requests/${encodeURIComponent(id)}/approve`, { resolvedByUserId });
  }
  rejectJoinRequest(id: string, resolvedByUserId: string, comment: string): Observable<ClubJoinRequestRecord> {
    return this.http.post<ClubJoinRequestRecord>(`${this.baseUrl}/clubs/join-requests/${encodeURIComponent(id)}/reject`, { resolvedByUserId, comment });
  }

  getMyStatus(userId: string): Observable<ClubMyStatus> { return this.http.get<ClubMyStatus>(`${this.baseUrl}/clubs/my-status/${encodeURIComponent(userId)}`); }
}
