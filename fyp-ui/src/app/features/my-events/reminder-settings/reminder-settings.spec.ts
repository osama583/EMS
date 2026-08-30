import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { ReminderSettingsComponent } from './reminder-settings';

const URL = `${environment.apiBaseUrl}/events/me/reminders`;

const ALL_ON = {
  savedCapacityReminder: true,
  savedStartingReminder: true,
  registeredStartingReminder: true,
};

function create(scope: 'saved' | 'registered'): {
  fixture: ComponentFixture<ReminderSettingsComponent>;
  httpMock: HttpTestingController;
} {
  const fixture = TestBed.createComponent(ReminderSettingsComponent);
  fixture.componentRef.setInput('scope', scope);
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

  it('shows only the toggles its own tab owns', () => {
    const saved = create('saved');
    expect(saved.fixture.componentInstance.toggles().map((t) => t.key)).toEqual([
      'savedCapacityReminder',
      'savedStartingReminder',
    ]);

    const registered = create('registered');
    expect(registered.fixture.componentInstance.toggles().map((t) => t.key)).toEqual([
      'registeredStartingReminder',
    ]);
  });

  it('costs no request until the panel is opened', () => {
    const { fixture, httpMock } = create('saved');
    // Every My Events tab mounts this component, so loading eagerly would put a
    // request on a page the reader may never expand.
    httpMock.expectNone(URL);

    fixture.componentInstance.toggleOpen();
    httpMock.expectOne((r) => r.url === URL && r.method === 'GET').flush(ALL_ON);
  });

  it('sends ONLY the changed toggle, so one tab cannot reset the other', () => {
    const { fixture, httpMock } = create('saved');
    fixture.componentInstance.toggleOpen();
    httpMock.expectOne((r) => r.method === 'GET').flush(ALL_ON);

    fixture.componentInstance.setToggle('savedCapacityReminder', {
      target: { checked: false },
    } as unknown as Event);

    const put = httpMock.expectOne((r) => r.url === URL && r.method === 'PUT');
    // The whole point: a partial body. Sending all three would let the Saved
    // tab overwrite the Registered tab's setting.
    expect(put.request.body).toEqual({ savedCapacityReminder: false });
    put.flush({ ...ALL_ON, savedCapacityReminder: false });

    expect(fixture.componentInstance.isOn('savedCapacityReminder')).toBe(false);
    expect(fixture.componentInstance.isOn('registeredStartingReminder')).toBe(true);
  });

  it('moves the switch immediately and restores it only if the write fails', () => {
    const { fixture, httpMock } = create('registered');
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
    const { fixture, httpMock } = create('saved');
    fixture.componentInstance.toggleOpen();
    httpMock
      .expectOne((r) => r.method === 'GET')
      .flush({ message: 'nope' }, { status: 500, statusText: 'Server Error' });

    // A missing row already means "all on" server-side, so a failed read shows
    // the same thing rather than blocking the panel.
    expect(fixture.componentInstance.isOn('savedCapacityReminder')).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('counts only its own enabled toggles', () => {
    const { fixture, httpMock } = create('saved');
    fixture.componentInstance.toggleOpen();
    httpMock
      .expectOne((r) => r.method === 'GET')
      .flush({ ...ALL_ON, savedCapacityReminder: false });

    // 1 of the Saved tab's 2 - the Registered tab's toggle must not be counted.
    expect(fixture.componentInstance.enabledCount()).toBe(1);
  });
});
