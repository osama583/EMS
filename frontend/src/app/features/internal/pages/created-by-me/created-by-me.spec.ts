import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreatedByMeComponent } from './created-by-me';
import { EventRegistration } from '../../../../core/events/published-event.models';

/**
 * The receipt viewer. The proof URL the API returns is already signed, so it goes
 * straight into an <img> — these cover the branch that decides what to draw.
 */
describe('CreatedByMeComponent payment receipts', () => {
  const ROW: EventRegistration = {
    id: 'reg-1',
    name: 'Alex Rivera',
    email: 'alex@demo.apu.edu.my',
    reason: '',
    status: 'confirmed',
    paymentStatus: 'approved',
    paymentProofUrl: '/api/v1/uploads/abc123.png?expires=1&signature=2',
    paymentProofFileName: 'transfer.png',
  } as EventRegistration;

  function make() {
    TestBed.configureTestingModule({
      imports: [CreatedByMeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return TestBed.createComponent(CreatedByMeComponent).componentInstance;
  }

  it('opens a receipt without a fetch, and clears the failure flag each time', () => {
    const component = make();

    component.openProof(ROW);
    expect(component.proofTarget()).toBe(ROW);
    expect(component.proofUnavailable()).toBe(false);

    // The row cites a file storage no longer holds.
    component.onProofError();
    expect(component.proofUnavailable()).toBe(true);

    // Re-opening must try again rather than inherit the previous row's failure.
    component.closeProof();
    component.openProof(ROW);
    expect(component.proofUnavailable()).toBe(false);
  });

  it('routes a PDF receipt to a link, since an <img> cannot render one', () => {
    const component = make();

    expect(component.isPdfProof(ROW)).toBe(false);
    expect(component.isPdfProof({ ...ROW, paymentProofFileName: 'bank-receipt.PDF' })).toBe(true);
    // No stored filename: the signed URL's own key still names the type, and the
    // query string must not be mistaken for the extension.
    expect(component.isPdfProof({
      ...ROW,
      paymentProofFileName: null,
      paymentProofUrl: '/api/v1/uploads/abc123.pdf?expires=1&signature=2',
    })).toBe(true);
  });
});
