import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { canManageRequestOptions, managerOptionKinds } from './request-option.permissions';
import { RequestOption } from './request-option.models';
import { RequestOptionService } from './request-option.service';

const SEED_OPTIONS: readonly RequestOption[] = [
  { id: 'transport-grab-voucher', kind: 'transportation', label: 'Grab voucher', passengerCapacity: 4, availableVehicles: 20, description: 'Capacity is per vehicle.', active: true },
  { id: 'serving-pax', kind: 'servingUnit', label: 'Per pax', description: 'One serving for one person.', active: true },
  { id: 'dietary-vegetarian', kind: 'dietaryInformation', label: 'Vegetarian', active: true },
  { id: 'food-lunch', kind: 'fmb', label: 'Lunch', servingUnitId: 'serving-pax', active: true },
  { id: 'food-other', kind: 'fmb', label: 'Other', active: true },
];

describe('RequestOptionService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('returns applicant options with stable IDs as values', async () => {
    const service = TestBed.inject(RequestOptionService);
    const httpMock = TestBed.inject(HttpTestingController);

    const optionsPromise = firstValueFrom(service.watchActive('transportation'));
    httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl)
      .flush(SEED_OPTIONS.filter((option) => option.kind === 'transportation'));
    const options = await optionsPromise;
    const selectOptions = service.toSelectOptions(options);
    expect(selectOptions.some((option) => option.value === 'transport-grab-voucher' && option.label === 'Grab voucher')).toBe(true);
  });

  it('keeps manager permissions centralized by role and page', () => {
    expect(managerOptionKinds(UserRole.LogisticsManager)).toEqual(['logistics']);
    expect(managerOptionKinds(UserRole.Cfo)).toEqual(['fundingMain', 'fundingSub']);
    expect(managerOptionKinds(UserRole.Fmb)).toEqual(['fmb', 'servingUnit', 'dietaryInformation', 'waterLogo', 'waterNormal']);
    expect(managerOptionKinds(UserRole.StudentServicesManager)).toEqual(['campusTourStart']);
    expect(canManageRequestOptions(UserRole.Fmb, true)).toBe(true);
    expect(canManageRequestOptions(UserRole.Fmb, false)).toBe(true);
    expect(canManageRequestOptions(UserRole.Applicant, false)).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/menu')).toBe(true);
    expect(roleCanAccess(UserRole.Cfo, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/logistics')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/soundLight')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/campusTourStart')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/waterLogo')).toBe(false);
    expect(roleCanAccess(UserRole.AvManager, '/app/dropdown-options/soundLight')).toBe(true);
    expect(roleCanAccess(UserRole.StudentServicesManager, '/app/dropdown-options/campusTourStart')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/waterLogo')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/servingUnit')).toBe(true);
    expect(roleCanAccess(UserRole.Fmb, '/app/dropdown-options/dietaryInformation')).toBe(true);
  });

  it('provides API-compatible serving-unit and dietary-information IDs', async () => {
    const service = TestBed.inject(RequestOptionService);
    const httpMock = TestBed.inject(HttpTestingController);

    const servingUnitsPromise = firstValueFrom(service.watchActive('servingUnit'));
    const dietaryInformationPromise = firstValueFrom(service.watchActive('dietaryInformation'));
    httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl && request.params.get('kinds') === 'servingUnit')
      .flush(SEED_OPTIONS.filter((option) => option.kind === 'servingUnit'));
    httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl && request.params.get('kinds') === 'dietaryInformation')
      .flush(SEED_OPTIONS.filter((option) => option.kind === 'dietaryInformation'));
    const [servingUnits, dietaryInformation] = await Promise.all([servingUnitsPromise, dietaryInformationPromise]);

    expect(servingUnits.some((option) => option.id === 'serving-pax')).toBe(true);
    expect(dietaryInformation.some((option) => option.id === 'dietary-vegetarian')).toBe(true);
  });

  it('removes an option after delete()', async () => {
    const service = TestBed.inject(RequestOptionService);
    const httpMock = TestBed.inject(HttpTestingController);

    const beforePromise = firstValueFrom(service.watchAll(['fmb']));
    httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl).flush(SEED_OPTIONS);
    const before = await beforePromise;
    expect(before.some((option) => option.id === 'food-other')).toBe(true);

    const deletePromise = firstValueFrom(service.delete('food-other'));
    httpMock.expectOne(`${environment.requestOptionsApiUrl}/food-other`).flush(null);
    await deletePromise;

    const afterPromise = firstValueFrom(service.watchAll(['fmb']));
    httpMock.expectOne((request) => request.url === environment.requestOptionsApiUrl)
      .flush(SEED_OPTIONS.filter((option) => option.id !== 'food-other'));
    const after = await afterPromise;
    expect(after.some((option) => option.id === 'food-other')).toBe(false);
  });
});
