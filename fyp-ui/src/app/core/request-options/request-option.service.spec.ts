import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser } from '../auth/auth.models';
import { testNavPage, testRole, testUser } from '../auth/auth.test-fixtures';
import { roleCanAccess } from '../auth/role-navigation';
import { canManageRequestOptions, managerOptionKinds } from './request-option.permissions';
import { RequestOption } from './request-option.models';
import { RequestOptionService } from './request-option.service';

// Identity fixtures on the current RBAC model: a Service department's manager is whoever holds
// head-of-department on that unit. Which option catalogs they may curate follows from the unit
// alone (department-workflow.config.ts), never from a role name.
const DROPDOWN_PAGES_BY_UNIT: Readonly<Record<string, readonly string[]>> = {
  logistics_and_facilities: ['dropdown-options/logistics'],
  a_v_services: ['dropdown-options/soundLight'],
  student_services: ['dropdown-options/campusTourStart', 'dropdown-options/campusTourType'],
  food_beverage_services: ['dropdown-options/dietaryInformation', 'dropdown-options/servingUnit', 'dropdown-options/waterNormal', 'cafeteria-menus'],
};

// A Service department's manager is whoever holds head-of-department on that unit. Which option
// catalogs they may curate follows from the unit alone (department-workflow.config.ts); which
// pages they can open follows from the server-supplied nav tree (nav-tree.service.js), which
// grants one Dropdown Options page per kind rather than a single catch-all page.
function unitManager(unitCode: string, department: string): AuthUser {
  return testUser([testRole('head-of-department', unitCode, department)], {
    email: `${unitCode}.manager@demo.apu.edu.my`,
    displayName: `${department} Manager`,
    username: `${unitCode}.manager`,
    nav: (DROPDOWN_PAGES_BY_UNIT[unitCode] ?? []).map((pageCode) => testNavPage(pageCode)),
  });
}
const logisticsManager = unitManager('logistics_and_facilities', 'Logistics and Facilities');
const avManager = unitManager('a_v_services', 'A/V Services');
const studentServicesManager = unitManager('student_services', 'Student Services');
const fmbManager = unitManager('food_beverage_services', 'Food & Beverage Services');
const studentUser: AuthUser = testUser([testRole('student', 'school_of_computing', 'School of Computing')], {
  email: 'student@demo.apu.edu.my', displayName: 'Student', username: 'student',
});
const cafeteriaManagerUser: AuthUser = testUser([testRole('cafeteria-manager', 'cafeteria__atrium_cafeteria', 'Atrium Cafeteria')], {
  email: 'cafeteria.manager@demo.apu.edu.my', displayName: 'Cafeteria Manager', username: 'cafeteria.manager',
  cafeteriaCode: 'cafeteria__atrium_cafeteria',
  nav: [testNavPage('menu', 'My Menu')],
});
const cfoUser: AuthUser = testUser([testRole('cfo')], {
  email: 'cfo@demo.apu.edu.my', displayName: 'CFO', username: 'cfo', department: 'Finance Office',
  nav: [testNavPage('dropdown-options/fundingMain'), testNavPage('dropdown-options/fundingSub')],
});

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
    // F&B owns the whole food-catalog set (menu, dietary information, serving units, mineral
    // water). A Cafeteria Manager owns only their own cafeteria's menu. waterLogo no longer
    // exists as its own kind — Mineral Water is one merged catalog.
    expect(managerOptionKinds(fmbManager)).toEqual(['fmb', 'dietaryInformation', 'servingUnit', 'waterNormal']);
    expect(managerOptionKinds(cafeteriaManagerUser)).toEqual(['fmb']);
    expect(managerOptionKinds(studentServicesManager)).toEqual(['campusTourStart', 'campusTourType']);
    expect(canManageRequestOptions(cafeteriaManagerUser, true)).toBe(true);
    expect(canManageRequestOptions(cafeteriaManagerUser, false)).toBe(false);
    expect(canManageRequestOptions(fmbManager, true)).toBe(true);
    expect(canManageRequestOptions(fmbManager, false)).toBe(true);
    expect(canManageRequestOptions(studentUser, false)).toBe(false);
    // Page access is decided purely by the server-supplied nav tree: each department is granted
    // the Dropdown Options page for the kinds it owns, and nothing else.
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/logistics')).toBe(true);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/soundLight')).toBe(false);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/campusTourStart')).toBe(false);
    expect(roleCanAccess(logisticsManager, '/app/dropdown-options/waterNormal')).toBe(false);
    expect(roleCanAccess(avManager, '/app/dropdown-options/soundLight')).toBe(true);
    expect(roleCanAccess(studentServicesManager, '/app/dropdown-options/campusTourStart')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options/waterNormal')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/dropdown-options/servingUnit')).toBe(true);
    expect(roleCanAccess(cfoUser, '/app/dropdown-options/fundingMain')).toBe(true);
    // My Menu is the Cafeteria Manager's own cafeteria; F&B gets the read-only cross-cafeteria
    // overview instead.
    expect(roleCanAccess(cafeteriaManagerUser, '/app/menu')).toBe(true);
    expect(roleCanAccess(fmbManager, '/app/menu')).toBe(false);
    expect(roleCanAccess(fmbManager, '/app/cafeteria-menus')).toBe(true);
    expect(roleCanAccess(cafeteriaManagerUser, '/app/cafeteria-menus')).toBe(false);
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
