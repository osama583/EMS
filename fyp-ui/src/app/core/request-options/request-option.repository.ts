import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { BehaviorSubject, Observable, delay, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MOCK_REQUEST_OPTIONS } from './request-option.mock-data';
import { RequestOption, RequestOptionDraft, RequestOptionQuery, RequestOptionRepository } from './request-option.models';
import { RequestOptionDto, mapRequestOptionResponse, mapRequestOptionWrite } from './request-option.mapper';

@Injectable({ providedIn: 'root' })
export class MockRequestOptionRepository implements RequestOptionRepository {
  private readonly options = new BehaviorSubject<readonly RequestOption[]>(MOCK_REQUEST_OPTIONS);

  getOptions(query: RequestOptionQuery): Observable<readonly RequestOption[]> {
    return this.options.pipe(map((options) => this.filter(options, query)));
  }
  getOption(id: string): Observable<RequestOption> {
    const option = this.options.value.find((item) => item.id === id);
    return option ? of(option) : throwError(() => new Error('The option could not be found.'));
  }

  createOption(draft: RequestOptionDraft): Observable<RequestOption> {
    const created = { ...draft, id: `${draft.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } as RequestOption;
    return of(created).pipe(delay(180), tap((option) => this.options.next([...this.options.value, option])));
  }

  updateOption(id: string, draft: RequestOptionDraft): Observable<RequestOption> {
    if (!this.options.value.some((option) => option.id === id)) return throwError(() => new Error('The option could not be found.'));
    const updated = { ...draft, id } as RequestOption;
    return of(updated).pipe(delay(180), tap((option) => this.options.next(this.options.value.map((item) => item.id === id ? option : item))));
  }

  setOptionActive(id: string, active: boolean): Observable<RequestOption> {
    const current = this.options.value.find((option) => option.id === id);
    if (!current) return throwError(() => new Error('The option could not be found.'));
    const updated = { ...current, active } as RequestOption;
    return of(updated).pipe(delay(140), tap((option) => this.options.next(this.options.value.map((item) => item.id === id ? option : item))));
  }

  deleteOption(id: string): Observable<void> {
    if (!this.options.value.some((option) => option.id === id)) return throwError(() => new Error('The option could not be found.'));
    return of(undefined).pipe(delay(140), tap(() => this.options.next(this.options.value.filter((item) => item.id !== id))));
  }

  private filter(options: readonly RequestOption[], query: RequestOptionQuery): readonly RequestOption[] {
    const search = query.search?.trim().toLowerCase() ?? '';
    return options.filter((option) =>
      (!query.kinds?.length || query.kinds.includes(option.kind))
      && (!query.activeOnly || option.active)
      && (!search || `${option.label} ${option.description ?? ''}`.toLowerCase().includes(search)),
    );
  }
}

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
  factory: () => environment.useMockRequestOptions ? inject(MockRequestOptionRepository) : inject(ApiRequestOptionRepository),
});
