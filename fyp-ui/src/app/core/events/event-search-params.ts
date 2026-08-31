import { HttpParams } from '@angular/common/http';
import { EventSearchParams } from './published-event.models';

/**
 * One filter selection as the query string every event-list endpoint understands.
 *
 * Explore Events (`/events/search`), Saved (`/events/me/saved/search`) and the registration tabs
 * (`/events/me/registrations`) are all parsed by the same server-side builder
 * (events.py's _list_events_filters), so they take the same params — repeated once per selected
 * value, since each group is a multi-select.
 */
export function eventSearchHttpParams(params: EventSearchParams): HttpParams {
  let httpParams = new HttpParams();
  const setList = (key: string, values: readonly string[] | undefined) => {
    for (const value of values ?? []) httpParams = httpParams.append(key, value);
  };
  if (params.q) httpParams = httpParams.set('q', params.q);
  setList('visibility', params.visibility);
  setList('category', params.category);
  setList('school', params.school);
  setList('format', params.format);
  setList('time', params.time);
  setList('registration', params.registration);
  setList('cost', params.cost);
  setList('club', params.club);
  setList('date', params.date);
  if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
  if (params.excludeRegistered) httpParams = httpParams.set('excludeRegistered', '1');
  if (params.excludeConfirmed) httpParams = httpParams.set('excludeConfirmed', '1');
  if (params.countOnly) httpParams = httpParams.set('countOnly', '1');
  httpParams = httpParams.set('page', String(params.page ?? 1));
  httpParams = httpParams.set('pageSize', String(params.pageSize ?? 9));
  return httpParams;
}
