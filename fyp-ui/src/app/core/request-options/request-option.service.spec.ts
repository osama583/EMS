import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '../auth/auth.models';
import { roleCanAccess } from '../auth/role-navigation';
import { canManageRequestOptions, managerOptionKinds } from './request-option.permissions';
import { RequestOptionService } from './request-option.service';

describe('RequestOptionService', () => {
  it('returns applicant options with stable IDs as values', async () => {
    const service = TestBed.inject(RequestOptionService);
    const options = await firstValueFrom(service.watchActive('transportation'));
    const selectOptions = service.toSelectOptions(options);
    expect(selectOptions.some((option) => option.value === 'transport-grab-voucher' && option.label === 'Grab voucher')).toBe(true);
  });

  it('keeps manager permissions centralized by role and page', () => {
    expect(managerOptionKinds(UserRole.LogisticsManager)).toEqual(['logistics']);
    expect(managerOptionKinds(UserRole.Cfo)).toEqual(['fundingMain', 'fundingSub']);
    expect(managerOptionKinds(UserRole.FmbManager)).toEqual(['dietaryInformation', 'waterLogo', 'waterNormal']);
    expect(managerOptionKinds(UserRole.StudentServicesManager)).toEqual(['campusTourStart', 'campusTourArea', 'campusTourMap']);
    expect(managerOptionKinds(UserRole.CafeteriaManager)).toEqual(['fnb', 'servingUnit']);
    expect(canManageRequestOptions(UserRole.CafeteriaManager, true)).toBe(true);
    expect(canManageRequestOptions(UserRole.CafeteriaManager, false)).toBe(false);
    expect(canManageRequestOptions(UserRole.Applicant, false)).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.CafeteriaManager, '/app/menu')).toBe(true);
    expect(roleCanAccess(UserRole.CafeteriaManager, '/app/dropdown-options')).toBe(false);
    expect(roleCanAccess(UserRole.Cfo, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.FmbManager, '/app/dropdown-options')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/logistics')).toBe(true);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/soundLight')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/campusTourStart')).toBe(false);
    expect(roleCanAccess(UserRole.LogisticsManager, '/app/dropdown-options/waterLogo')).toBe(false);
    expect(roleCanAccess(UserRole.AvManager, '/app/dropdown-options/soundLight')).toBe(true);
    expect(roleCanAccess(UserRole.StudentServicesManager, '/app/dropdown-options/campusTourStart')).toBe(true);
    expect(roleCanAccess(UserRole.StudentServicesManager, '/app/dropdown-options/campusTourMap')).toBe(true);
    expect(roleCanAccess(UserRole.FmbManager, '/app/dropdown-options/waterLogo')).toBe(true);
    expect(roleCanAccess(UserRole.CafeteriaManager, '/app/dropdown-options/servingUnit')).toBe(true);
    expect(roleCanAccess(UserRole.CafeteriaManager, '/app/dropdown-options/dietaryInformation')).toBe(false);
  });

  it('provides API-compatible serving-unit and dietary-information IDs', async () => {
    const service = TestBed.inject(RequestOptionService);
    const [servingUnits, dietaryInformation] = await Promise.all([
      firstValueFrom(service.watchActive('servingUnit')),
      firstValueFrom(service.watchActive('dietaryInformation')),
    ]);

    expect(servingUnits.some((option) => option.id === 'serving-pax')).toBe(true);
    expect(dietaryInformation.some((option) => option.id === 'dietary-vegetarian')).toBe(true);
  });

  it('removes an option after delete()', async () => {
    const service = TestBed.inject(RequestOptionService);
    const before = await firstValueFrom(service.watchAll(['fnb']));
    expect(before.some((option) => option.id === 'food-other')).toBe(true);

    await firstValueFrom(service.delete('food-other'));

    const after = await firstValueFrom(service.watchAll(['fnb']));
    expect(after.some((option) => option.id === 'food-other')).toBe(false);
  });
});
