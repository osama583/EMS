import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository } from './request-option.models';
import { RequestOptionDto, mapRequestOptionResponse, mapRequestOptionWrite } from './request-option.mapper';

@Injectable({ providedIn: 'root' })
export class ApiRequestOptionRepository implements RequestOptionRepository {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.requestOptionsApiUrl;

  getOptions(query: RequestOptionQuery): Observable<readonly RequestOption[]> {
    let params = new HttpParams();
    if (query.kinds?.length) params = params.set('kinds', query.kinds.join(','));
    if (query.activeOnly) params = params.set('active', 'true');
    if (query.search) params = params.set('search', query.search);
    return this.http.get<readonly RequestOptionDto[]>(this.baseUrl, { params }).pipe(map((options) => options.map(mapRequestOptionResponse)));
  }
  getOption(id: string): Observable<RequestOption> { return this.http.get<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}`).pipe(map(mapRequestOptionResponse)); }
  createOption(draft: RequestOptionDraft): Observable<RequestOption> { return this.http.post<RequestOptionDto>(this.baseUrl, mapRequestOptionWrite(draft)).pipe(map(mapRequestOptionResponse)); }
  updateOption(id: string, draft: RequestOptionDraft): Observable<RequestOption> { return this.http.put<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}`, mapRequestOptionWrite(draft)).pipe(map(mapRequestOptionResponse)); }
  setOptionActive(id: string, active: boolean): Observable<RequestOption> { return this.http.patch<RequestOptionDto>(`${this.baseUrl}/${encodeURIComponent(id)}/status`, { active }).pipe(map(mapRequestOptionResponse)); }
  deleteOption(id: string): Observable<void> { return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
}

export const REQUEST_OPTION_REPOSITORY = new InjectionToken<RequestOptionRepository>('REQUEST_OPTION_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(ApiRequestOptionRepository),
});
