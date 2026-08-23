import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthUserRole } from '../auth/auth.models';

/** The safe, read-only colleague projection used outside system administration. */
export interface InternalDirectoryUser {
  readonly displayName: string;
  readonly email: string;
  readonly department: string;
  readonly roleLabel: string;
  readonly roles: readonly AuthUserRole[];
}

// Not shareReplay'd: scoped by a live admin permission (Page Visibility grants), and an admin
// editing that permission must be reflected the next time this picker opens — not stuck behind a
// cached response from before the edit. Callers get a fresh HTTP request per subscription, same
// as any other list endpoint in this app.
@Injectable({ providedIn: 'root' })
export class InternalUserDirectoryService {
  private readonly http = inject(HttpClient);

  // Co-owner/Organizer candidates for the proposal form: scoped server-side to
  // whoever the admin's Page Visibility settings currently grant access to the
  // proposal form itself (GET /proposals/collaborator-candidates) — both roles can
  // act in the applicant's place, so neither should ever offer someone who couldn't
  // have the form open themselves. See
  // docs/superpowers/specs/2026-08-20-proposal-api-bug-patterns.md.
  readonly proposalCollaboratorCandidates$: Observable<readonly InternalDirectoryUser[]> = this.http
    .get<readonly InternalDirectoryUser[]>(`${environment.apiBaseUrl}/proposals/collaborator-candidates`);
}
