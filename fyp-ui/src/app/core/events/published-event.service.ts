import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EventRegistration, EventSearchParams, EventSearchResponse, PendingEventRegistration, PendingEventRegistrationPage, PublishedEvent, RegistrationResult } from './published-event.models';
import { EventRegistrationApi, RegisteredEventsResponse, RegistrationHistoryPage, RegistrationHistoryQuery, SavedEventsResponse } from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class PublishedEventService implements EventRegistrationApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/events`;

  // Happening Soon, Explore Events (results + school facet), and the calendar each have their
  // own scoped endpoint below (getHappeningSoon/searchEvents/getEventSchools/getEventsForRange)
  // — nothing loads the full published-events table any more. Kept only for any future caller
  // that genuinely needs every event; shareReplay(1) still applies so concurrent/repeat callers
  // don't each refetch independently.
  private publishedEvents$: Observable<readonly PublishedEvent[]> | null = null;

  getPublishedEvents(): Observable<readonly PublishedEvent[]> {
    if (!this.publishedEvents$) {
      this.publishedEvents$ = this.http.get<readonly PublishedEvent[]>(this.baseUrl).pipe(
        // A failed request must not be cached — the next caller should retry, not replay the error.
        catchError((error) => { this.publishedEvents$ = null; throw error; }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.publishedEvents$;
  }

  // Drops the cached GET /events result so the next getPublishedEvents() call refetches — call
  // after any mutation that changes what that list would return (a new registration excluding
  // an event from a filtered view, etc.).
  invalidatePublishedEvents(): void { this.publishedEvents$ = null; }

  // Explore Events' filtered/paginated view — every filter group, the search box, and
  // page/pageSize are all evaluated server-side (see events.py's search_events()) rather than
  // fetching every published event and filtering client-side.
  searchEvents(params: EventSearchParams): Observable<EventSearchResponse> {
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
    setList('date', params.date);
    if (params.dateFrom) httpParams = httpParams.set('dateFrom', params.dateFrom);
    if (params.dateTo) httpParams = httpParams.set('dateTo', params.dateTo);
    if (params.excludeRegistered) httpParams = httpParams.set('excludeRegistered', '1');
    if (params.countOnly) httpParams = httpParams.set('countOnly', '1');
    httpParams = httpParams.set('page', String(params.page ?? 1));
    httpParams = httpParams.set('pageSize', String(params.pageSize ?? 9));
    return this.http.get<EventSearchResponse>(`${this.baseUrl}/search`, { params: httpParams });
  }

  // Explore Events' school-filter facet — distinct schools/departments across published events,
  // computed server-side (see events.py's list_event_schools()) rather than downloading every
  // published event's full payload just to dedupe one column client-side.
  getEventSchools(): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/schools`);
  }

  // Happening Soon's own bounded feed — published events in the next 10 days, computed and
  // capped server-side (see events.py's happening_soon()) rather than filtering the full
  // getPublishedEvents() list in the component.
  getHappeningSoon(): Observable<readonly PublishedEvent[]> {
    return this.http.get<readonly PublishedEvent[]>(`${this.baseUrl}/happening-soon`);
  }

  // The events calendar's own range-scoped feed — published events with at least one schedule
  // date inside [start, end] (see events.py's calendar_events()). Called once per visible
  // month/week rather than loading every published event up front.
  getEventsForRange(start: string, end: string): Observable<readonly PublishedEvent[]> {
    return this.http.get<readonly PublishedEvent[]>(`${this.baseUrl}/calendar`, { params: { start, end } });
  }

  getEventDetails(id: string): Observable<PublishedEvent | undefined> { return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
  getRegistrationCount(id: string): Observable<number> {
    return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`).pipe(map((event) => event.confirmedRegistrationCount));
  }
  // Every registration awaiting this user's approval, across all of their own events. The actor
  // is resolved server-side from the bearer token, so no email is sent. Searched/filtered/
  // paginated server-side (events.py's pending_approvals()) — the Registrations inbox's search
  // box and event dropdown are real query params, not a client-side filter over the whole set.
  getMyPendingRegistrations(query: {
    q?: string; event?: string; page: number; pageSize: number; order?: 'asc' | 'desc';
  }): Observable<PendingEventRegistrationPage> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.event) params = params.set('event', query.event);
    // Requested is the only sortable column, so the server takes a direction.
    if (query.order) params = params.set('order', query.order);
    return this.http.get<PendingEventRegistrationPage>(`${this.baseUrl}/me/pending-approvals`, { params });
  }
  // Distinct event titles with a pending registration, for the Registrations inbox's event
  // filter dropdown — its own small unpaginated query, independent of which page is shown.
  getPendingApprovalEventOptions(): Observable<readonly string[]> {
    return this.http.get<readonly string[]>(`${this.baseUrl}/me/pending-approvals/events`);
  }
  getPendingRegistrations(id: string): Observable<readonly EventRegistration[]> {
    return this.http
      .get<readonly EventRegistration[]>(`${this.baseUrl}/${encodeURIComponent(id)}/registrations`)
      .pipe(map((rows) => rows.filter((row) => row.status === 'pending')));
  }

  getMyRegistration(eventId: string): Observable<EventRegistration | null> {
    return this.http.get<EventRegistration | null>(`${this.baseUrl}/${encodeURIComponent(eventId)}/registrations/mine`);
  }

  // Batched counterpart to getMyRegistration() — one request for many events instead of one
  // request per event (what a grid/list of cards needs, e.g. Explore Events' page of results).
  // Events with no registration are simply absent from the returned map.
  getRegistrationStatuses(eventIds: readonly string[]): Observable<ReadonlyMap<string, EventRegistration['status']>> {
    if (eventIds.length === 0) return of(new Map());
    return this.http
      .get<Record<string, EventRegistration['status']>>(`${this.baseUrl}/me/registration-statuses`, { params: { eventIds: eventIds.join(',') } })
      .pipe(map((byId) => new Map(Object.entries(byId))));
  }

  // `reason` is required by the server when the event uses manual approval (max 100 characters);
  // `paymentProof` is required when the event has a cost. The actor is the signed-in user, unless
  // `guest` is supplied — an anonymous visitor registering for a public event with no account;
  // the server creates/reuses a minimal record for them by email (see events.py's register()).
  registerForEvent(
    eventId: string,
    paymentProof?: { url: string; fileName: string },
    reason?: string,
    guest?: { name: string; email: string },
  ): Observable<RegistrationResult> {
    return this.http
      .post<RegistrationResult>(`${this.baseUrl}/${encodeURIComponent(eventId)}/registrations`, {
        paymentProofUrl: paymentProof?.url,
        paymentProofFileName: paymentProof?.fileName,
        reason,
        name: guest?.name,
        email: guest?.email,
      })
      .pipe(
        // The server rejects an already-registered or full event with an error status rather
        // than an in-band result; callers only understand RegistrationResult, so translate here.
        catchError((error: HttpErrorResponse) => {
          const message = (error.error as { error?: { message?: string } } | null)?.error?.message
            || 'Registration could not be completed.';
          const status: RegistrationResult['status'] = error.status === 409 ? 'duplicate' : 'rejected';
          return of({ status, message });
        }),
      );
  }

  // eventId identifies which event's queue the registration belongs to; the caller must own
  // that event's proposal, which the server enforces from the bearer token.
  approveRegistration(eventId: string, registrationId: string): Observable<EventRegistration | undefined> {
    return this.decideRegistration(eventId, registrationId, 'approve');
  }
  rejectRegistration(eventId: string, registrationId: string): Observable<EventRegistration | undefined> {
    return this.decideRegistration(eventId, registrationId, 'reject');
  }
  private decideRegistration(eventId: string, registrationId: string, decision: 'approve' | 'reject'): Observable<EventRegistration | undefined> {
    return this.http.post<EventRegistration>(
      `${this.baseUrl}/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/decision`,
      { decision },
    );
  }

  isEventEnded(item: PublishedEvent): boolean {
    const schedule = item.schedule[0];
    if (!schedule) return false;
    const end = new Date(`${schedule.date}T${schedule.end || '23:59'}:00`);
    return end.getTime() < Date.now();
  }

  // page/pageSize are real server query params (events.py's my_registrations()) - the server
  // filters by scope, counts, and slices in SQL, so the browser only ever receives the one page
  // of results it's about to render.
  getActiveRegistrations(page: number, pageSize: number): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/me/registrations`, { params: { scope: 'active', page: String(page), pageSize: String(pageSize) } });
  }

  // Events I registered for that use manual approval and are still awaiting the organiser's
  // decision (my own registration, not the organiser's approval queue - see pending-approvals
  // for that direction).
  getPendingApprovalRegistrations(page: number, pageSize: number): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/me/registrations`, { params: { scope: 'pending', page: String(page), pageSize: String(pageSize) } });
  }

  getRegistrationHistory(page: number, pageSize: number): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/me/registrations`, { params: { scope: 'history', page: String(page), pageSize: String(pageSize) } });
  }

  // Events I proposed (or co-own) that are now published — my own organiser dashboard (Created
  // by Me). Server-side searched/filtered/paginated: search/status/page/pageSize are real query
  // params to events.py's my_organized_events(), which filters, counts, and LIMIT/OFFSETs in
  // SQL rather than the browser holding and filtering the whole organised-events list.
  getMyOrganizedEvents(query: { q?: string; status?: 'upcoming' | 'ended'; page: number; pageSize: number }): Observable<SavedEventsResponse> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    return this.http.get<SavedEventsResponse>(`${this.baseUrl}/me/organized`, { params });
  }

  // Full attendee list for one of my events, every status included (not just pending — see
  // getPendingRegistrations above for that narrower view).
  getAllRegistrations(id: string): Observable<readonly EventRegistration[]> {
    return this.http.get<readonly EventRegistration[]>(`${this.baseUrl}/${encodeURIComponent(id)}/registrations`);
  }

  // Registrations I have already approved/rejected as organiser — the resolved counterpart to
  // getMyPendingRegistrations(). Feeds History's "decided by me" direction.
  getDecidedRegistrations(): Observable<readonly PendingEventRegistration[]> {
    return this.http.get<readonly PendingEventRegistration[]>(`${this.baseUrl}/me/decided-registrations`);
  }

  // History > Events (hub-history-events.ts): server-side searched/filtered/paginated merge of
  // the two sources above (my own resolved registrations + registrations I decided as
  // organiser), already re-bucketed into requester 'me'/'other' and de-duplicated - see
  // events.py's registration_history()/_HISTORY_UNION_SQL for the query this replaces two
  // unpaginated/lightly-paginated client-side-merged calls with.
  getRegistrationHistoryPage(query: RegistrationHistoryQuery): Observable<RegistrationHistoryPage> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.requester) params = params.set('requester', query.requester);
    if (query.decidedBy) params = params.set('decidedBy', query.decidedBy);
    // Date is the only sortable column here, so the server takes a direction.
    if (query.order) params = params.set('order', query.order);
    return this.http.get<RegistrationHistoryPage>(`${this.baseUrl}/me/registration-history`, { params });
  }
}
