import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MasterCalendarDay, MasterCalendarEventDetail, MasterCalendarSummary } from './master-calendar.models';
import { EventRegistration, EventSearchParams, EventSearchResponse, PendingEventRegistration, PendingEventRegistrationPage, PublishedEvent, RegistrationListPage, RegistrationListQuery, RegistrationResult, VenueBookingsResponse } from './published-event.models';
import { eventSearchHttpParams } from './event-search-params';
import { EventRegistrationApi, RegisteredEventsResponse, RegistrationHistoryPage, RegistrationHistoryQuery, SavedEventsResponse } from './event-engagement.models';

@Injectable({ providedIn: 'root' })
export class PublishedEventService implements EventRegistrationApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/events`;

  // Happening Soon, Explore Events (results + school facet), and the calendar each have their own
  // scoped endpoint below (getHappeningSoon/searchEvents/getEventSchools/getEventsForRange) — nothing
  // loads the full published-events table any more.
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
    return this.http.get<EventSearchResponse>(`${this.baseUrl}/search`, { params: eventSearchHttpParams(params) });
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

  // The MASTER calendar's feed (/app/event-calendar) — a different population and a different rule set
  // from getEventsForRange() above, which serves the public landing calendar.

  // Tier 1 — the visible range's grid rows: date, time, title, category, provisional, plus the per-
  // date private count.
  getMasterCalendarSummary(start: string, end: string, q = ''): Observable<MasterCalendarSummary> {
    let params = new HttpParams().set('start', start).set('end', end);
    if (q) params = params.set('q', q);
    return this.http.get<MasterCalendarSummary>(`${this.baseUrl}/master-calendar`, { params });
  }

  // Tier 2 — one day's list rows, which add the venue and organiser a day row shows and a month
  // chip does not. Called when a day is opened, never across the range.
  getMasterCalendarDay(date: string, q = ''): Observable<MasterCalendarDay> {
    let params = new HttpParams().set('date', date);
    if (q) params = params.set('q', q);
    return this.http.get<MasterCalendarDay>(`${this.baseUrl}/master-calendar/day`, { params });
  }

  // Tier 3 — one event's detail-dialog payload, called when the dialog opens. Deliberately not
  // getEventDetails() above: that serves published events under discovery's rules and would not
  // resolve an event still at department_review, which the master calendar does show.
  getMasterCalendarEvent(id: string): Observable<MasterCalendarEventDetail> {
    return this.http.get<MasterCalendarEventDetail>(`${this.baseUrl}/master-calendar/${encodeURIComponent(id)}`);
  }

  // Per-date counts of everything on the master calendar, for the proposal form's schedule
  // conflict warning. Counts only — no event data — so it can honestly report how busy a date is
  // regardless of what the asking user is allowed to see. Returns 0 for a date with no events.
  getEventDateCounts(dates: readonly string[]): Observable<Readonly<Record<string, number>>> {
    let params = new HttpParams();
    for (const date of dates) params = params.append('dates', date);
    return this.http.get<Record<string, number>>(`${this.baseUrl}/date-counts`, { params });
  }

  // What else is booked into this venue on this date. Advisory: the proposal form warns on an
  // overlap but never blocks one, since a room can legitimately host two things back to back and
  // the organiser may know something the calendar does not.
  getVenueBookings(venueId: string, date: string, excludeRequestId?: string): Observable<VenueBookingsResponse> {
    let params = new HttpParams().set('venueId', venueId).set('date', date);
    if (excludeRequestId) params = params.set('excludeRequestId', excludeRequestId);
    return this.http.get<VenueBookingsResponse>(`${this.baseUrl}/venue-bookings`, { params });
  }

  getEventDetails(id: string): Observable<PublishedEvent | undefined> { return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`); }
  getRegistrationCount(id: string): Observable<number> {
    return this.http.get<PublishedEvent>(`${this.baseUrl}/${encodeURIComponent(id)}`).pipe(map((event) => event.confirmedRegistrationCount));
  }
  // Every registration awaiting this user's approval, across all of their own events.
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
  // `paymentProof` is required when the event has a cost.
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

  // Ended means every schedule row is in the past, not just the first - a multi-day event is
  // still upcoming as long as its last day hasn't happened yet. Mirrors the backend's _NOT_ENDED.
  isEventEnded(item: PublishedEvent): boolean {
    if (item.schedule.length === 0) return false;
    const now = Date.now();
    return item.schedule.every((row) => new Date(`${row.date}T${row.end || '23:59'}:00`).getTime() < now);
  }

  // The search box, every filter group and page/pageSize are real server query params (events.py's
  // my_registrations()) - the server narrows by scope, filters, counts and slices in SQL, so the
  // browser only ever receives the one page of results it is about to render.
  private myRegistrations(scope: 'active' | 'pending' | 'history' | 'conducted', params: EventSearchParams): Observable<RegisteredEventsResponse> {
    return this.http.get<RegisteredEventsResponse>(`${this.baseUrl}/me/registrations`, {
      params: eventSearchHttpParams(params).set('scope', scope),
    });
  }

  getActiveRegistrations(params: EventSearchParams): Observable<RegisteredEventsResponse> {
    return this.myRegistrations('active', params);
  }

  // Events I registered for that use manual approval and are still awaiting the organiser's
  // decision (my own registration, not the organiser's approval queue - see pending-approvals
  // for that direction).
  getPendingApprovalRegistrations(params: EventSearchParams): Observable<RegisteredEventsResponse> {
    return this.myRegistrations('pending', params);
  }

  getRegistrationHistory(params: EventSearchParams): Observable<RegisteredEventsResponse> {
    return this.myRegistrations('history', params);
  }

  // Events I held a confirmed place on that have since finished — the Conducted tab. Narrower
  // than getRegistrationHistory(), which also carries registrations that were turned down: those
  // are settled, but they were never attended.
  getConductedRegistrations(params: EventSearchParams): Observable<RegisteredEventsResponse> {
    return this.myRegistrations('conducted', params);
  }

  // Events I proposed (or co-own) that are now published — my own organiser dashboard (Created by Me).
  getMyOrganizedEvents(query: { q?: string; status?: 'upcoming' | 'ended'; page: number; pageSize: number }): Observable<SavedEventsResponse> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    return this.http.get<SavedEventsResponse>(`${this.baseUrl}/me/organized`, { params });
  }

  // Full attendee list for one of my events, every status included (not just pending — see
  // getPendingRegistrations above for that narrower view).
  // The organiser's attendee list, one page at a time. It used to return every
  // registration for the event and leave the browser to search, sort and slice them —
  // 200 rows fetched to show ten.
  getAllRegistrations(id: string, query: RegistrationListQuery): Observable<RegistrationListPage> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.order) params = params.set('order', query.order);
    return this.http.get<RegistrationListPage>(
      `${this.baseUrl}/${encodeURIComponent(id)}/registrations`, { params },
    );
  }

  // Registrations I have already approved/rejected as organiser — the resolved counterpart to
  // getMyPendingRegistrations(). Feeds History's "decided by me" direction.
  getDecidedRegistrations(): Observable<readonly PendingEventRegistration[]> {
    return this.http.get<readonly PendingEventRegistration[]>(`${this.baseUrl}/me/decided-registrations`);
  }

  // History > Events (hub-history-events.ts): server-side searched/filtered/paginated merge of the two
  // sources above (my own resolved registrations + registrations I decided as organiser), already re-
  // bucketed into requester 'me'/'other' and de-duplicated - see events.py's
  // registration_history()/_HISTORY_UNION_SQL for the query this replaces two unpaginated/lightly-
  // paginated client-side-merged calls with.
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
