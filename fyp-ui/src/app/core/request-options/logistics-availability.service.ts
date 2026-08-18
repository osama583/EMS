import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LogisticsAvailability } from './logistics-availability.models';

@Injectable({ providedIn: 'root' })
export class LogisticsAvailabilityService {
  private readonly http = inject(HttpClient);

  // optionId is the bare numeric logistics_option_id — callers strip the "logistics:" prefix
  // from the RequestOption.id before calling (see event-proposal.ts's availability effect).
  check(optionId: string, date: string, start: string, end: string, quantity?: number): Observable<LogisticsAvailability> {
    let params = new HttpParams().set('date', date).set('start', start).set('end', end);
    if (quantity !== undefined) params = params.set('quantity', String(quantity));
    return this.http.get<LogisticsAvailability>(`${environment.requestOptionsApiUrl}/logistics/${encodeURIComponent(optionId)}/availability`, { params });
  }
}
