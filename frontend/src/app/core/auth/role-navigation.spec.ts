import { navigationFor, roleCanAccess, roleCanUseSavedEvents } from './role-navigation';
import { TEST_CAFETERIA_MANAGER, TEST_EXTERNAL_USER, TEST_FMB_HEAD, TEST_LOGISTICS_STAFF, testNavPage, testUser, testRole } from './auth.test-fixtures';

// The sidebar is server-computed (nav_page + nav_page_grants, projected onto AuthUser.nav by
// nav-tree.service.js) — the client only renders whatever tree it was handed. These tests cover
// that rendering contract, not any client-side role-to-nav mapping, because there is no longer
// such a mapping to test.
describe('role-navigation', () => {
  it('builds its entries from the server-supplied nav tree', () => {
    const user = testUser([testRole('staff', 'logistics_and_facilities', 'Logistics and Facilities')], {
      nav: [testNavPage('tasks', 'My Tasks'), testNavPage('inbox', 'Inbox')],
    });
    const navigation = navigationFor(user);
    expect(navigation.entries.length).toBe(2);
    expect(navigation.defaultRoute).toBe('/app/tasks');
  });

  it('falls back to the no-access route when the server granted no pages', () => {
    expect(navigationFor(TEST_LOGISTICS_STAFF).defaultRoute).toBe('/app/no-access');
  });

  it('allows a route the server granted and refuses one it did not', () => {
    const manager = testUser([testRole('cafeteria-manager', 'cafeteria__atrium_cafeteria', 'Atrium Cafeteria')], {
      nav: [testNavPage('menu', 'My Menu')],
    });
    expect(roleCanAccess(manager, '/app/menu')).toBe(true);
    expect(roleCanAccess(manager, '/app/roles')).toBe(false);
  });

  // Saved events are an internal-shell feature: guests reach the same events through the public
  // landing page, which has its own saved-events path (see role-access.ts's comment).
  it('lets every unit-scoped identity use saved events, but not a flat guest account', () => {
    expect(roleCanUseSavedEvents(TEST_FMB_HEAD)).toBe(true);
    expect(roleCanUseSavedEvents(TEST_LOGISTICS_STAFF)).toBe(true);
    expect(roleCanUseSavedEvents(TEST_CAFETERIA_MANAGER)).toBe(true);
    expect(roleCanUseSavedEvents(TEST_EXTERNAL_USER)).toBe(false);
  });
});
