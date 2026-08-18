// TESTING ONLY — DELETE BEFORE PRODUCTION (see backend config.demo_mode)
//
// Fetches the shared-password demo account list for the login page's
// account picker. The backend endpoint 404s unless DEMO_MODE=true is set on
// the server, which this service treats identically to "no demo users" —
// there is no separate frontend flag to keep in sync.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DevUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleLabel: string;
  readonly department: string;
  readonly password: string;
}

@Injectable({ providedIn: 'root' })
export class DevUsersService {
  private readonly http = inject(HttpClient);

  list(): Observable<DevUser[]> {
    return this.http
      .get<DevUser[]>(`${environment.apiBaseUrl}/auth/dev-users`)
      .pipe(catchError(() => of([])));
  }
}
