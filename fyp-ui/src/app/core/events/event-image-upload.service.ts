import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EventImageAsset } from './published-event.models';

export interface EventImageUploadRequest {
  readonly file: File;
}

export interface EventImageUploadResponse {
  readonly image: EventImageAsset;
}

/** API contract used by the proposal form. */
export abstract class EventImageUploadApi {
  abstract upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse>;
}

function readAsDataUrl(file: File): Observable<string> {
  return new Observable((subscriber) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => { subscriber.next(String(reader.result)); subscriber.complete(); });
    reader.addEventListener('error', () => subscriber.error(new Error('The image could not be read.')));
    reader.readAsDataURL(file);
    return () => reader.abort();
  });
}

@Injectable({ providedIn: 'root' })
export class MockEventImageUploadService implements EventImageUploadApi {
  upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse> {
    return readAsDataUrl(request.file).pipe(
      map((dataUrl) => ({
        image: {
          url: dataUrl,
          fileName: request.file.name,
          mimeType: request.file.type,
          sizeBytes: request.file.size,
          status: 'local' as const,
        },
      })),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class ApiEventImageUploadService implements EventImageUploadApi {
  private readonly http = inject(HttpClient);

  upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse> {
    return readAsDataUrl(request.file).pipe(
      switchMap((dataUrl) => this.http.post<{ storageKey: string; url: string }>(environment.imageUploadApiUrl, {
        fileName: request.file.name,
        mimeType: request.file.type,
        sizeBytes: request.file.size,
        dataUrl,
      })),
      map((response) => ({
        image: {
          url: response.url,
          fileName: request.file.name,
          mimeType: request.file.type,
          sizeBytes: request.file.size,
          status: 'uploaded' as const,
          storageKey: response.storageKey,
        },
      })),
    );
  }
}

export const EVENT_IMAGE_UPLOAD_API = new InjectionToken<EventImageUploadApi>('EVENT_IMAGE_UPLOAD_API', {
  providedIn: 'root',
  factory: () => environment.useMockImageUpload ? inject(MockEventImageUploadService) : inject(ApiEventImageUploadService),
});
