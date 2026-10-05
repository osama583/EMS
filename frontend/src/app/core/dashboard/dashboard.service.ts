import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardDocument, DashboardWidget } from './dashboard.models';

const CACHE_KEY = 'apu-ems-dashboard-cache';

/**
 * The dashboard's one request per page load.
 *
 * Two behaviours matter more than the fetch itself:
 *
 * **Cached render first.** The last successful document is kept in
 * localStorage and rendered immediately with its generation time shown, then
 * refreshed. A dashboard that shows nothing for two seconds on a campus
 * connection is a dashboard people stop opening.
 *
 * **Refetch holds the previous render.** `refetching` flips instead of clearing
 * the document, so the page dims rather than collapsing to a skeleton. A
 * skeleton flash causes a layout jump on a page someone is mid-read of.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly baseUrl = `${environment.apiBaseUrl}/dashboard`;

  private readonly state = signal<DashboardDocument | null>(null);
  private readonly loadingState = signal(false);
  private readonly refetchingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly staleState = signal(false);

  readonly document = computed(() => this.state());
  readonly loading = computed(() => this.loadingState());
  readonly refetching = computed(() => this.refetchingState());
  readonly error = computed(() => this.errorState());
  /** True while the rendered document came from the local cache rather than
   *  this session's fetch — surfaced in the header so nobody mistakes a cached
   *  figure for a live one. */
  readonly stale = computed(() => this.staleState());
  readonly hasProfile = computed(() => !!this.state()?.profile);

  readonly period = signal('30d');
  readonly profileId = signal<string | null>(null);
  readonly outlet = signal<string | null>(null);

  load(options: { refresh?: boolean } = {}): void {
    const first = this.state() === null;
    if (first) {
      const cached = this.readCache();
      if (cached) {
        this.state.set(cached);
        this.staleState.set(true);
      }
    }
    if (this.state() === null) {
      this.loadingState.set(true);
    } else {
      this.refetchingState.set(true);
    }
    this.errorState.set(null);

    this.http
      .get<DashboardDocument>(this.baseUrl, { params: this.buildParams(options.refresh) })
      .pipe(
        tap((document) => {
          this.state.set(document);
          this.staleState.set(false);
          this.writeCache(document);
        }),
        catchError(() => {
          // Keep whatever is on screen. A failed refresh should cost the reader
          // the freshness of the numbers, not the numbers.
          this.errorState.set(
            this.state() ? 'Could not refresh. Showing the last figures loaded.' : 'Could not load the dashboard.',
          );
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.loadingState.set(false);
        this.refetchingState.set(false);
      });
  }

  setPeriod(key: string): void {
    if (this.period() === key) return;
    this.period.set(key);
    this.load();
  }

  setProfile(id: string): void {
    if (this.profileId() === id) return;
    this.profileId.set(id);
    // A profile switch is a scope change, not a permission change — it re-runs
    // the whole resolution server-side, so it can only reach scopes the actor
    // already holds. The cache is per-profile, so drop the stale render.
    this.state.set(null);
    this.load();
  }

  setOutlet(code: string): void {
    if (this.outlet() === code) return;
    this.outlet.set(code === 'all' ? null : code);
    this.load();
  }

  /** One widget, re-fetched on a panel-local filter change without re-running
   *  the page. */
  refetchWidget(widgetId: string) {
    return this.http
      .get<DashboardWidget>(`${this.baseUrl}/widgets/${widgetId}`, { params: this.buildParams(false) })
      .pipe(catchError(() => of(null)));
  }

  private buildParams(refresh?: boolean): HttpParams {
    let params = new HttpParams().set('period', this.period());
    const profile = this.profileId();
    if (profile) params = params.set('profile', profile);
    const outlet = this.outlet();
    if (outlet) params = params.set('outlet', outlet);
    if (refresh) params = params.set('refresh', '1');
    return params;
  }

  private cacheKey(): string {
    return `${CACHE_KEY}:${this.profileId() ?? 'default'}:${this.period()}:${this.outlet() ?? 'all'}`;
  }

  private readCache(): DashboardDocument | null {
    try {
      const raw = localStorage.getItem(this.cacheKey());
      return raw ? (JSON.parse(raw) as DashboardDocument) : null;
    } catch {
      return null;
    }
  }

  private writeCache(document: DashboardDocument): void {
    try {
      localStorage.setItem(this.cacheKey(), JSON.stringify(document));
    } catch {
      // A full quota is not worth failing a page render over.
    }
  }
}
