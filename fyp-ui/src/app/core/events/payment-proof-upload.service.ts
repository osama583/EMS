import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PaymentProofUploadRequest {
  readonly file: File;
}

export interface PaymentProofUploadResponse {
  readonly url: string;
  readonly fileName: string;
}

export abstract class PaymentProofUploadApi {
  abstract upload(request: PaymentProofUploadRequest): Observable<PaymentProofUploadResponse>;
}

function readAsDataUrl(file: File): Observable<string> {
  return new Observable((subscriber) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => { subscriber.next(String(reader.result)); subscriber.complete(); });
    reader.addEventListener('error', () => subscriber.error(new Error('The file could not be read.')));
    reader.readAsDataURL(file);
    return () => reader.abort();
  });
}

@Injectable({ providedIn: 'root' })
export class MockPaymentProofUploadService implements PaymentProofUploadApi {
  upload(request: PaymentProofUploadRequest): Observable<PaymentProofUploadResponse> {
    return readAsDataUrl(request.file).pipe(map((url) => ({ url, fileName: request.file.name })));
  }
}

@Injectable({ providedIn: 'root' })
export class ApiPaymentProofUploadService implements PaymentProofUploadApi {
  private readonly http = inject(HttpClient);

  upload(request: PaymentProofUploadRequest): Observable<PaymentProofUploadResponse> {
    return readAsDataUrl(request.file).pipe(
      switchMap((dataUrl) => this.http.post<{ storageKey: string; url: string }>(`${environment.apiBaseUrl}/uploads`, {
        fileName: request.file.name,
        mimeType: request.file.type,
        sizeBytes: request.file.size,
        dataUrl,
      })),
      map((response) => ({ url: response.url, fileName: request.file.name })),
    );
  }
}

export const PAYMENT_PROOF_UPLOAD_API = new InjectionToken<PaymentProofUploadApi>('PAYMENT_PROOF_UPLOAD_API', {
  providedIn: 'root',
  // Always the real API now: uploads must return a URL, because
  // request.event_image is VARCHAR(255) and cannot hold a data URL.
  factory: () => inject(ApiPaymentProofUploadService),
});
