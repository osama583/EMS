import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../environments/environment';
import { ReminderSettingsComponent } from './reminder-settings';

const URL = `${environment.apiBaseUrl}/events/me/reminders`;

const ALL_ON = {
  savedCapacityReminder: true,
  savedStartingReminder: true,
  registeredStartingReminder: true,
};

function create(): {
  fixture: ComponentFixture<ReminderSettingsComponent>;
  httpMock: HttpTestingController;
} {
  const fixture = TestBed.createComponent(ReminderSettingsComponent);
  fixture.detectChanges();
  return { fixture, httpMock: TestBed.inject(HttpTestingController) };
}

describe('ReminderSettingsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReminderSettingsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('shows every reminder, because the profile is now the only place to change one', () => {
    const { fixture } = create();
    expect(fixture.componentInstance.toggles.map((t) => t.key)).toEqual([
      'savedCapacityReminder',
      'savedStartingReminder',
      'registeredStartingReminder',
    ]);
  });

  it('costs no request until the panel is opened', () => {
    const { fixture, httpMock } = create();
    // The profile is read for a name or a password far more often than it is
    // read for a reminder, so loading eagerly would put a request on a page
    // most readers never expand this panel on.
    httpMock.expectNone(URL);

    fixture.componentInstance.toggleOpen();
    httpMock.expectOne((r) => r.url === URL && r.method === 'GET').flush(ALL_ON);
  });

  it('sends ONLY the changed toggle, so a stale read cannot reset the others', () => {
    const { fixture, httpMock } = create();
    fixture.componentInstance.toggleOpen();
    httpMock.expectOne((r) => r.method === 'GET').flush(ALL_ON);

    fixture.componentInstance.setToggle('savedCapacityReminder', {
      target: { checked: false },
    } as unknown as Event);

    const put = httpMock.expectOne((r) => r.url === URL && r.method === 'PUT');
    // The whole point: a partial body. Sending all three would write back
    // whatever this panel last read, overwriting a change made elsewhere.
    expect(put.request.body).toEqual({ savedCapacityReminder: false });
    put.flush({ ...ALL_ON, savedCapacityReminder: false });

    expect(fixture.componentInstance.isOn('savedCapacityReminder')).toBe(false);
    expect(fixture.componentInstance.isOn('registeredStartingReminder')).toBe(true);
  });

  it('moves the switch immediately and restores it only if the write fails', () => {
    const { fixture, httpMock } = create();
    fixture.componentInstance.toggleOpen();
    httpMock.expectOne((r) => r.method === 'GET').flush(ALL_ON);

    fixture.componentInstance.setToggle('registeredStartingReminder', {
      target: { checked: false },
    } as unknown as Event);
    // Optimistic: already off before the server has answered.
    expect(fixture.componentInstance.isOn('registeredStartingReminder')).toBe(false);

    httpMock
      .expectOne((r) => r.method === 'PUT')
      .flush({ message: 'nope' }, { status: 500, statusText: 'Server Error' });

    // Put back, because the change did not stick.
    expect(fixture.componentInstance.isOn('registeredStartingReminder')).toBe(true);
  });

  it('falls back to all-on when the preferences cannot be loaded', () => {
    const { fixture, httpMock } = create();
    fixture.componentInstance.toggleOpen();
    httpMock
      .expectOne((r) => r.method === 'GET')
      .flush({ message: 'nope' }, { status: 500, statusText: 'Server Error' });

    // A missing row already means "all on" server-side, so a failed read shows
    // the same thing rather than blocking the panel.
    expect(fixture.componentInstance.isOn('savedCapacityReminder')).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('counts the enabled reminders for the collapsed summary line', () => {
    const { fixture, httpMock } = create();
    fixture.componentInstance.toggleOpen();
    httpMock
      .expectOne((r) => r.method === 'GET')
      .flush({ ...ALL_ON, savedCapacityReminder: false });

    // Reads "2 of 3 on" under the heading.
    expect(fixture.componentInstance.enabledCount()).toBe(2);
  });
});
