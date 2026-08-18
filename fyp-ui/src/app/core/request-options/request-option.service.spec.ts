import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, UnitKind, UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { canManageRequestOptions, managerOptionKinds } from './request-option.permissions';
import { RequestOption } from './request-option.models';
import { RequestOptionService } from './request-option.service';

// Unit + Level model fixtures — Logistics/A/V/Student Services managers are unit-scoped
// (functionLevel='manager' on their own Service department unit) rather than their own UserRole.
// F&B is unit-scoped too (unit code 'food_beverage_services').
function unitManager(unitId: string, unitKind: UnitKind, department: string): AuthUser {
  return {
    email: `${unitId}.manager@demo.apu.edu.my`, displayName: `${department} Manager`, username: `${unitId}.manager`,
    role: 'manager' as UserRole, accountType: 'internal', roleLabel: `${department} Manager`, department,
    functionLevel: 'manager', unitId, unitKind,
  };
}
const logisticsManager = unitManager('logistics_and_facilities', 'service_department', 'Logistics and Facilities');
const avManager = unitManager('a_v_services', 'service_department', 'A/V Services');
const studentServicesManager = unitManager('student_services', 'service_department', 'Student Services');
const fmbManager = unitManager('food_beverage_services', 'service_department', 'Food & Beverage Services');
const studentUser: AuthUser = {
  email: 'student@demo.apu.edu.my', displayName: 'Student', username: 'student', role: 'student' as UserRole,
  accountType: 'internal', roleLabel: 'Student — School of Computing', department: 'School of Computing',
  functionLevel: 'student', unitId: 'school_of_computing', unitKind: 'school',
};
const cafeteriaManagerUser: AuthUser = {
  email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager', username: 'cafeteria.manager',
  role: UserRole.CafeteriaManager, accountType: 'internal', roleLabel: 'Cafeteria Manager', department: 'Cafeteria Services',
};
const cfoUser: AuthUser = {
  email: 'cfo@demo.apu.edu.my', displayName: 'CFO', username: 'cfo',
  role: UserRole.Cfo, accountType: 'internal', roleLabel: 'CFO', department: 'Finance Office',
};

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
    expect(managerOptionKinds(logisticsManager)).toEqual(['logistics']);
    expect(managerOptionKinds(cfoUser)).toEqual(['fundingMain', 'fundingSub']);
    // F&B reviews F&B/water requests but no longer owns the menu (fmb) or Serving Units
    // catalogs — those moved to CafeteriaManager, scoped to their assigned cafeteria.
    // waterLogo no longer exists as its own kind — Mineral Water is one merged catalog.
    expect(managerOptionKinds(fmbManager)).toEqual(['dietaryInformation', 'waterNormal']);
    expect(managerOptionKinds(cafeteriaManagerUser)).toEqual(['fmb', 'servingUnit']);
    expect(managerOptionKinds(studentServicesManager)).toEqual(['campusTourStart', 'campusTourType']);
    expect(canManageRequestOptions(cafeteriaManagerUser, true)).toBe(true);
    expect(canManageRequestOptions(cafeteriaManagerUser, false)).toBe(false);
    expect(canManageRequestOptions(fmbManager, true)).toBe(false);
    expect(canManageRequestOptions(fmbManager, false)).toBe(true);
    expect(canManageRequestOptions(studentUser, false)).toBe(false);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(cafeteriaManagerUser, '/app/menu')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/menu')).toBe(false);
    expect(roleCanAccess(fmbManager, '/app/cafeteria-menus')).toBe(true);
    expect(roleCanAccess(cafeteriaManagerUser, '/app/cafeteria-menus')).toBe(false);
    expect(roleCanAccess(cfoUser, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/logistics')).toBe(true);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/soundLight')).toBe(false);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/campusTourStart')).toBe(false);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/waterNormal')).toBe(false);
    expect(roleCanAccess(avManager, '/app/dropdown-options/soundLight')).toBe(true);
    expect(roleCanAccess(studentServicesManager, '/app/dropdown-options/campusTourStart')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options/waterNormal')).toBe(true);
    expect(roleCanAccess(cafeteriaManagerUser, '/app/dropdown-options/servingUnit')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options/servingUnit')).toBe(false);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options/dietaryInformation')).toBe(true);
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
