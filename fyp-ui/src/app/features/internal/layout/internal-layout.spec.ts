import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { testNavPage, testRole, testTokens, testUser } from '../../../core/auth/auth.test-fixtures';
import { InternalLayoutComponent } from './internal-layout';

describe('InternalLayoutComponent', () => {
  const expandedSectionKey = 'apu-internal-expanded-section';
  const pinnedKey = 'apu-internal-sidebar-pinned';
  const activeRouteKey = 'apu-internal-active-route';
  let fixture: ComponentFixture<InternalLayoutComponent>;
  let component: InternalLayoutComponent;

  beforeEach(async () => {
    localStorage.removeItem(expandedSectionKey);
    localStorage.removeItem(pinnedKey);
    localStorage.removeItem(activeRouteKey);

    await TestBed.configureTestingModule({
      imports: [InternalLayoutComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    // Unit + Level model: the layout's fallback (no session at all) is now a minimal Dashboard-
    // only nav (see FALLBACK_NAVIGATION in role-navigation.ts) rather than accidentally
    // inheriting whatever ROLE_NAVIGATION[UserRole.Applicant] happened to contain. These tests
    // exercise the "My Proposals"/Events sidebar shape, so establish a real unit-scoped Student
    // session up front (same nav shape the old Applicant fallback coincidentally provided).
    // The sidebar renders the SERVER-supplied nav tree verbatim (nav-tree.service.js), so the
    // session carries the same tree a Student is really granted: a standalone Dashboard, the
    // Proposals folder, the Forms folder and the Events folder.
    TestBed.inject(AuthService).establishSession(testUser([testRole('student', 'school_of_computing', 'School of Computing')], {
      email: 'student@demo.apu.edu.my', displayName: 'Demo Student', username: 'student',
      nav: [
        testNavPage('dashboard', 'Dashboard'),
        {
          pageCode: 'proposals', label: 'My Proposals', entryType: 'folder', icon: null, routePath: null,
          children: [testNavPage('drafts', 'Drafts'), testNavPage('ongoing', 'Ongoing'), testNavPage('history', 'History')],
        },
        {
          pageCode: 'forms', label: 'Forms', entryType: 'folder', icon: null, routePath: null,
          children: [testNavPage('forms/event-proposal', 'Event Proposal')],
        },
        {
          pageCode: 'events', label: 'Events', entryType: 'folder', icon: null, routePath: null,
          children: [testNavPage('events/explore-events', 'Explore Events')],
        },
      ],
    }), testTokens());

    fixture = TestBed.createComponent(InternalLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.removeItem(expandedSectionKey);
    localStorage.removeItem(pinnedKey);
    localStorage.removeItem(activeRouteKey);
    TestBed.resetTestingModule();
  });

  it('renders only the globe and navigation icons while collapsed', () => {
    const sidebar = fixture.nativeElement.querySelector('.internal-sidebar') as HTMLElement;

    expect(component.expanded()).toBe(false);
    expect(sidebar.querySelector('.internal-brand__globe')).not.toBeNull();
    expect(sidebar.querySelector('.sidebar-pin')).toBeNull();
    expect(sidebar.querySelector('.internal-nav__chevron')).toBeNull();
    expect(sidebar.querySelector('.sidebar-submenu')).toBeNull();
    expect(sidebar.querySelector('[title="Dashboard"]')).not.toBeNull();
  });

  it('expands on hover and stays expanded when pinned', () => {
    const shell = fixture.nativeElement.querySelector('.internal-shell') as HTMLElement;
    const sidebar = fixture.nativeElement.querySelector('.internal-sidebar') as HTMLElement;

    expect(component.expanded()).toBe(false);
    expect(shell.classList.contains('internal-shell--expanded')).toBe(false);

    sidebar.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(component.expanded()).toBe(true);

    const pin = fixture.nativeElement.querySelector('.sidebar-pin') as HTMLButtonElement;
    expect(pin).not.toBeNull();
    pin.click();
    fixture.detectChanges();
    sidebar.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(component.pinned()).toBe(true);
    expect(component.expanded()).toBe(true);
    expect(pin.getAttribute('aria-pressed')).toBe('true');
  });

  it('remembers an expanded section while the sidebar is visually collapsed', () => {
    const sidebar = fixture.nativeElement.querySelector('.internal-sidebar') as HTMLElement;

    sidebar.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    component.toggleGroup('proposals');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sidebar-submenu').textContent).toContain('Drafts');

    sidebar.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(component.expanded()).toBe(false);
    expect(component.openGroup()).toBe('proposals');
    expect(fixture.nativeElement.querySelector('.sidebar-submenu')).toBeNull();
    expect(localStorage.getItem(expandedSectionKey)).toBe('proposals');

    sidebar.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    const restoredSubmenu = fixture.nativeElement.querySelector('.sidebar-submenu') as HTMLElement;
    expect(restoredSubmenu.classList.contains('sidebar-submenu--open')).toBe(true);
    expect(restoredSubmenu.textContent).toContain('History');
    expect(restoredSubmenu.textContent).not.toContain('Revision Required');
  });

  it('restores the last expanded section from local storage', () => {
    component.onSidebarEnter();
    component.toggleGroup('forms');
    fixture.detectChanges();
    fixture.destroy();

    fixture = TestBed.createComponent(InternalLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.openGroup()).toBe('forms');
  });

  it('closes the mobile drawer after navigation without resetting its menu state', () => {
    component.isCompactScreen.set(true);
    component.manuallyExpanded.set(true);
    component.toggleGroup('proposals');

    component.onNavigate();

    expect(component.expanded()).toBe(false);
    expect(component.openGroup()).toBe('proposals');
  });

  it('keeps an active parent highlighted while its child links are hidden', () => {
    component.activeRoute.set('/app/ongoing');
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector(
      '[title="My Proposals"]',
    ) as HTMLButtonElement;
    const group = trigger.closest('.internal-nav__group') as HTMLElement;

    expect(component.expanded()).toBe(false);
    expect(group.classList.contains('internal-nav__group--active')).toBe(true);
    expect(group.querySelector('.sidebar-submenu')).toBeNull();
  });

  it('shows the current route as a breadcrumb in the top bar', () => {
    component.activeRoute.set('/app/ongoing');
    fixture.detectChanges();

    const breadcrumb = fixture.nativeElement.querySelector('.internal-breadcrumb') as HTMLElement;

    expect(breadcrumb.textContent).toContain('EMS');
    expect(breadcrumb.textContent).toContain('My Proposals');
    expect(breadcrumb.textContent).toContain('Ongoing');
    expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toContain('Ongoing');
    expect(fixture.nativeElement.textContent).not.toContain('Student workspace');
  });

  it('renders account navigation at the bottom of the sidebar', () => {
    const footer = fixture.nativeElement.querySelector('.internal-sidebar__footer') as HTMLElement;

    expect(footer.textContent).toContain('Profile');
    expect(footer.textContent).toContain('Logout');
  });

  it('shows the Events folder with Explore Events inside', () => {
    component.onSidebarEnter();
    fixture.detectChanges();
    component.toggleGroup('events');
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('.internal-sidebar') as HTMLElement;

    expect(sidebar.textContent).toContain('Events');
    expect(sidebar.textContent).toContain('Explore Events');
  });

  it('shows My Tasks without Inbox for task-based staff roles', () => {
    const auth = TestBed.inject(AuthService);
    // Cafeteria Staff is unit-linked now (their cafeteria IS a unit), and their sidebar is the
    // server-supplied nav tree — only "My Tasks" is granted to them.
    auth.establishSession(testUser([testRole('cafeteria-staff', 'cafeteria__atrium_cafeteria', 'Atrium Cafeteria')], {
      email: 'cafeteria.staff@apu.edu.my',
      displayName: 'Cafeteria Staff',
      username: 'cafeteria.staff',
      nav: [testNavPage('tasks', 'My Tasks')],
    }), testTokens());

    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('.internal-sidebar') as HTMLElement;

    expect(sidebar.textContent).toContain('My Tasks');
    expect(sidebar.textContent).not.toContain('Inbox');
  });
});
