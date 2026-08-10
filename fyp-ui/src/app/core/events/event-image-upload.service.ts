import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { EventImageAsset } from './published-event.models';

export interface EventImageUploadRequest {
  readonly file: File;
}

export interface EventImageUploadResponse {
  readonly image: EventImageAsset;
}

/** API contract used by the proposal form. The mock keeps files in the browser for now. */
export abstract class EventImageUploadApi {
  abstract upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse>;
}

@Injectable({ providedIn: 'root' })
export class MockEventImageUploadService implements EventImageUploadApi {
  upload(request: EventImageUploadRequest): Observable<EventImageUploadResponse> {
    return new Observable((subscriber) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        subscriber.next({
          image: {
            url: String(reader.result),
            fileName: request.file.name,
            mimeType: request.file.type,
            sizeBytes: request.file.size,
            status: 'local',
          },
        });
        subscriber.complete();
      });
      reader.addEventListener('error', () => subscriber.error(new Error('The image could not be read.')));
      reader.readAsDataURL(request.file);
      return () => reader.abort();
    });
  }
}

