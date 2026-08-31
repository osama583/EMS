// Screenshot harness for FYP Chapter 4 (sections 4.4 / 4.5).
// Captures every page at desktop and phone size against the LIVE app.
//
// Every (role, route) pair below was verified against the live database with
// preflight.mjs, so a role is only ever pointed at a page it can actually open.
// Usage: node capture.mjs [--group A] [--only 4.5.01,4.5.02] [--list]
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const APP = 'http://localhost:4200';
const API = 'http://localhost:5000/api/v1';
import { demoPassword } from './demo-password.mjs';
const PASSWORD = demoPassword();
const OUT = path.resolve('C:/Users/natsu/Desktop/Osama/ui png');

const USERS = {
  external: 'j.tanaka@example.com',
  student: 'applicant@demo.apu.edu.my',
  hos: 'hoshod@demo.apu.edu.my',
  logistics: 'logistics.manager@demo.apu.edu.my',
  logstaff: 'logistics.staff@demo.apu.edu.my',
  fmb: 'fmb@demo.apu.edu.my',
  av: 'av.manager@demo.apu.edu.my',
  transport: 'transport.manager@demo.apu.edu.my',
  cfo: 'cfo@demo.apu.edu.my',
  cafadmin: 'cafeteria.admin@demo.apu.edu.my',
  cafmgr: 'cafeteria.manager@demo.apu.edu.my',
  cafstaff: 'cafeteria.staff2@demo.apu.edu.my',
  clubadmin: 'club.admin@demo.apu.edu.my',
  sysadmin: 'system.admin@demo.apu.edu.my',
  // Organises events that have registrations awaiting a decision - the
  // Registrations queue is empty for every reviewer role, because reviewers
  // decide proposals, not sign-ups.
  organiser: 'student.computing2@demo.apu.edu.my',
};

// ---------- helpers used by shot `prep` functions ----------
const click = async (page, selectors, { timeout = 5000 } = {}) => {
  for (const sel of [].concat(selectors)) {
    const el = page.locator(sel).first();
    try {
      await el.waitFor({ state: 'visible', timeout });
      await el.click({ timeout: 4000 });
      return true;
    } catch {
      /* try the next selector */
    }
  }
  return false;
};

const fill = async (page, selector, value) => {
  try {
    await page.locator(selector).first().fill(value, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

const settle = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await page
    .waitForFunction(
      () => !document.querySelector('app-skeleton, .skeleton, app-loading-state, .loading-state'),
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  // Suppress the rotating AI nudge bubble: transient chrome that would otherwise
  // sit over the corner of all ~164 figures. The orb itself stays visible.
  await page.addStyleTag({ content: '.ai-prompt { display: none !important; }' }).catch(() => {});
  // Walk the page once so IntersectionObserver content renders, then return to
  // the top - every figure is a viewport shot, so the scroll position matters.
  await page
    .evaluate(async () => {
      const step = Math.max(400, window.innerHeight);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(900);
};

// Scroll a region into view for a viewport shot. Sticky headers stay pinned to
// the top of the viewport, so the chrome still reads correctly.
const scrollTo = async (page, selector) => {
  const el = page.locator(selector).first();
  if (!(await el.count().catch(() => 0))) return false;
  await el.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' })).catch(() => {});
  // Nudge back up so a sticky header does not overlap the top of the region.
  await page.evaluate(() => window.scrollBy(0, -90)).catch(() => {});
  await page.waitForTimeout(500);
  return true;
};

const openFirstRow = (p) => click(p, ['table tbody tr', '.data-table tbody tr', 'app-proposal-table tbody tr']);
// Every internal table renders its per-row controls into a dedicated actions
// cell; the first button there opens the record.
const openRowAction = (p) => click(p, ['td[data-actions] button', '.shared-table-actions button']);
// The task pages default to today, which is usually empty. Open the date picker
// and choose a day the calendar marks as having tasks (those carry a dot).
const pickTaskDate = async (p) => {
  if (!(await click(p, ['.staff-tasks-calendar-toggle__btn', '.staff-tasks-calendar-toggle button']))) return false;
  await p.waitForTimeout(800);
  const marked = 'button.task-calendar__day:has(.task-calendar__dot)';
  // Walk forward a few months if this one has no marked days.
  for (let month = 0; month < 5; month++) {
    if (await p.locator(marked).count()) return click(p, [marked]);
    if (!(await click(p, ['button[aria-label="Next month"]']))) break;
    await p.waitForTimeout(500);
  }
  return false;
};

// Same as pickTaskDate, but dismisses the popover afterwards so the rows
// underneath are clickable (and the calendar does not cover the figure).
const pickTaskDateAndClose = async (p) => {
  const picked = await pickTaskDate(p);
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(500);
  return picked;
};

// A single marked day often holds only one row (and for History, none at all).
// Switch the picker to range mode and select a wide span so the table fills.
const pickTaskRange = async (p) => {
  if (!(await click(p, ['.staff-tasks-calendar-toggle__btn', '.staff-tasks-calendar-toggle button']))) return false;
  await p.waitForTimeout(700);
  await click(p, ['button:has-text("Date range")']);
  await p.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    await click(p, ['button[aria-label="Previous month"]']);
    await p.waitForTimeout(180);
  }
  const days = 'button.task-calendar__day:not(.task-calendar__day--muted)';
  if (!(await click(p, [days]))) return false;
  await p.waitForTimeout(350);
  for (let i = 0; i < 16; i++) {
    await click(p, ['button[aria-label="Next month"]']);
    await p.waitForTimeout(180);
  }
  const all = p.locator(days);
  const n = await all.count();
  if (n) await all.nth(n - 1).click({ timeout: 4000 }).catch(() => {});
  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(900);
  return true;
};

// ---------- the shot list ----------
// as: key into USERS (null = signed out) | path: route | prep: interaction
// scrollTo: bring this region into view first | tall: taller viewport (capped)
const SHOTS = [
  // ===== A. Public and Authentication =====
  { id: '4.5.01', group: 'A - Public and Authentication', title: 'Landing Page - Hero', as: null, path: '/' },
  { id: '4.5.02', group: 'A - Public and Authentication', title: 'Landing Page - Happening Soon Carousel', as: null, path: '/', scrollTo: 'app-happening-soon' },
  { id: '4.5.03', group: 'A - Public and Authentication', title: 'Landing Page - Explore Events', as: null, path: '/', scrollTo: 'app-explore-events' },
  { id: '4.5.04', group: 'A - Public and Authentication', title: 'Landing Page - Campus Life', as: null, path: '/', scrollTo: 'app-campus-life' },
  { id: '4.5.05', group: 'A - Public and Authentication', title: 'Landing Page - Public Event Calendar', as: null, path: '/', scrollTo: 'app-event-calendar' },
  { id: '4.5.06', group: 'A - Public and Authentication', title: 'Event Details Modal', keepOpen: true, as: null, path: '/',
    prep: (p) => click(p, ['button.explore-card__action', 'button:has-text("Explore Event")']) },
  { id: '4.5.07', group: 'A - Public and Authentication', title: 'Login Page', as: null, path: '/login' },
  { id: '4.5.08', group: 'A - Public and Authentication', title: 'Forgot Password Modal', keepOpen: true, as: null, path: '/login',
    prep: (p) => click(p, ['button:has-text("Forgot password")', '.login-form__forgot']) },
  { id: '4.5.09', group: 'A - Public and Authentication', title: 'Guest Registration - Account Details', keepOpen: true, as: null, path: '/login',
    prep: (p) => click(p, ['button:has-text("Register as a guest")']) },
  { id: '4.5.10', group: 'A - Public and Authentication', title: 'Guest Registration - Completed Form', keepOpen: true, as: null, path: '/login',
    prep: async (p) => {
      if (!(await click(p, ['button:has-text("Register as a guest")']))) return false;
      await p.waitForTimeout(700);
      await fill(p, 'input[type="email"]', 'jia.tan@example.com');
      const texts = p.locator('input[type="text"]');
      await texts.nth(0).fill('Jia Wen').catch(() => {});
      await texts.nth(1).fill('Tan').catch(() => {});
      await fill(p, 'input[type="number"]', '22');
      await p.locator('select').first().selectOption({ index: 1 }).catch(() => {});
      await fill(p, 'input[type="password"]', 'Guest-Pass-2026');
      return true;
    } },
  { id: '4.5.11', group: 'A - Public and Authentication', title: 'Reset Password Page', as: null, path: '/reset-password' },

  // ===== B. External and Student User =====
  { id: '4.5.12', group: 'B - External and Student User', title: 'My Events', as: 'student', path: '/app/events/my-events/saved' },
  { id: '4.5.13', group: 'B - External and Student User', title: 'My Events - External User', as: 'external', path: '/my-events/saved' },
  { id: '4.5.16', group: 'B - External and Student User', title: 'User Profile', as: 'student', path: '/app/profile' },

  // ===== C. Internal Shell and Onboarding =====
  // Pinned open so the figure shows the labelled menu rather than the icon rail
  // it collapses to by default (the rail expands on hover, which a screenshot
  // cannot convey).
  { id: '4.5.17', group: 'C - Internal Shell and Onboarding', title: 'Internal Layout and Sidebar Navigation', as: 'logistics', path: '/app/dashboard', pinSidebar: true },
  { id: '4.5.18', group: 'C - Internal Shell and Onboarding', title: 'How It Works - Onboarding Guide', as: 'student', path: '/app/how-it-works' },
  { id: '4.5.19', group: 'C - Internal Shell and Onboarding', title: 'Master Event Calendar', as: 'hos', path: '/app/event-calendar' },
  { id: '4.5.20', group: 'C - Internal Shell and Onboarding', title: 'Internal Explore Events', as: 'student', path: '/app/events/explore-events', tall: 1200 },

  // ===== D. Proposal Creation (6-step form) =====
  { id: '4.5.21', group: 'D - Proposal Creation', title: 'Proposal Form - Step 1 Applicant Info', as: 'student', path: '/app/forms/event-proposal' },
  { id: '4.5.22', group: 'D - Proposal Creation', title: 'Proposal Form - Step 2 General Event Info', as: 'student', path: '/app/forms/event-proposal',
    prep: (p) => click(p, ['button:has-text("General Event Info")']) },
  { id: '4.5.23', group: 'D - Proposal Creation', title: 'Proposal Form - Step 3 Required for Event', as: 'student', path: '/app/forms/event-proposal',
    prep: (p) => click(p, ['button:has-text("Required for Event")']) },
  { id: '4.5.24', group: 'D - Proposal Creation', title: 'Proposal Form - Step 4 Request Details', as: 'student', path: '/app/forms/event-proposal',
    prep: (p) => click(p, ['button:has-text("Request Details")']) },
  { id: '4.5.25', group: 'D - Proposal Creation', title: 'Proposal Form - Step 5 Detailed Event Info', as: 'student', path: '/app/forms/event-proposal',
    prep: (p) => click(p, ['button:has-text("Detailed Event Info")']) },
  { id: '4.5.26', group: 'D - Proposal Creation', title: 'Proposal Form - Step 6 Final Review', as: 'student', path: '/app/forms/event-proposal',
    prep: (p) => click(p, ['button:has-text("Final Review")']) },
  { id: '4.5.27', group: 'D - Proposal Creation', title: 'Proposal Form - Validation Errors', as: 'student', path: '/app/forms/event-proposal',
    prep: async (p) => {
      await click(p, ['button:has-text("Final Review")']);
      await p.waitForTimeout(800);
      return click(p, ['button:has-text("Submit")']);
    } },

  // ===== E. Proposal Tracking and Review =====
  { id: '4.5.28', group: 'E - Proposal Tracking and Review', title: 'Draft Proposals', as: 'student', path: '/app/proposals/drafts' },
  { id: '4.5.29', group: 'E - Proposal Tracking and Review', title: 'Created by Me - Status Tracking', as: 'student', path: '/app/created-by-me' },
  // The proposal id is resolved from the live inbox at startup - the review page
  // is reached by a row action, which is far less stable to script than the route.
  { id: '4.5.30', group: 'E - Proposal Tracking and Review', title: 'Proposal Review - Reviewer View', as: 'hos', path: '/app/proposals/review/:hosProposal' },
  { id: '4.5.31', group: 'E - Proposal Tracking and Review', title: 'Proposal Review - Department View', as: 'logistics', path: '/app/proposals/review/:deptProposal' },
  { id: '4.5.32', group: 'E - Proposal Tracking and Review', title: 'Proposal Review - Summary KPI Bar', as: 'hos', path: '/app/proposals/review/:hosProposal',
    scrollTo: '.prv-kpi-bar' },
  // There is no confirm dialog on the reviewer view - a decision is taken inline
  // in the Workflow Actions panel, and rejecting without a reason validates in
  // place. That validation state is the figure.
  { id: '4.5.33', group: 'E - Proposal Tracking and Review', title: 'Reject Proposal - Reason Required', keepOpen: true, as: 'hos',
    path: '/app/proposals/review/:hosProposal', scrollTo: '.prv-panel-card--actions',
    prep: (p) => click(p, ['button:has-text("Reject proposal")']) },
  { id: '4.5.34', group: 'E - Proposal Tracking and Review', title: 'Workflow Actions Panel', as: 'hos', path: '/app/proposals/review/:hosProposal',
    scrollTo: '.prv-panel-card--actions' },

  // ===== F. Department Task Handling =====
  { id: '4.5.35', group: 'F - Department Task Handling', title: 'Inbox - Action Queues', as: 'logistics', path: '/app/inbox/proposals' },
  // Assignment is not a task-inbox action: the department view of the proposal
  // review page is where a manager names who does the work (approving IS
  // assigning - see proposal-department-view.ts).
  { id: '4.5.38', group: 'F - Department Task Handling', title: 'Staff Task Assignment', as: 'logistics',
    path: '/app/proposals/review/:deptProposal', keepOpen: true,
    prep: (p) => click(p, ['button.prv-btn--approve', 'button:has-text("Approve")']) },
  { id: '4.5.39', group: 'F - Department Task Handling', title: 'Ongoing Records Hub', as: 'hos', path: '/app/ongoing/proposals' },
  { id: '4.5.40', group: 'F - Department Task Handling', title: 'History Records Hub', as: 'hos', path: '/app/history/proposals' },

  // ===== G. Cafeteria Module =====
  { id: '4.5.42', group: 'G - Cafeteria Module', title: 'Cafeteria Staff Tasks', as: 'cafstaff', path: '/app/inbox/cafeteria-tasks', prep: pickTaskRange },
  { id: '4.5.43', group: 'G - Cafeteria Module', title: 'My Menu Management', as: 'cafmgr', path: '/app/menu' },
  { id: '4.5.44', group: 'G - Cafeteria Module', title: 'Manage Cafeterias', as: 'cafadmin', path: '/app/cafeterias/manage' },
  { id: '4.5.45', group: 'G - Cafeteria Module', title: 'Cafeteria Staff Assignments', as: 'cafadmin', path: '/app/cafeterias/staff-assignments' },
  { id: '4.5.46', group: 'G - Cafeteria Module', title: 'Menu Oversight', as: 'cafadmin', path: '/app/cafeterias/menu-oversight' },
  { id: '4.5.47', group: 'G - Cafeteria Module', title: 'My Staff', as: 'cafmgr', path: '/app/cafeterias/my-staff' },
  { id: '4.5.48', group: 'G - Cafeteria Module', title: 'Staff Action History', as: 'cafadmin', path: '/app/cafeterias/staff-requests-history' },

  // ===== H. Clubs Module =====
  { id: '4.5.49', group: 'H - Clubs Module', title: 'Discover Clubs', as: 'student', path: '/app/clubs/discover' },
  { id: '4.5.50', group: 'H - Clubs Module', title: 'My Clubs', as: 'student', path: '/app/clubs/my-clubs' },
  { id: '4.5.51', group: 'H - Clubs Module', title: 'Club Roster Modal', keepOpen: true, as: 'student', path: '/app/clubs/my-clubs',
    prep: (p) => click(p, ['button.club-page__image--clickable', 'button[aria-label^="View members"]']) },
  { id: '4.5.52', group: 'H - Clubs Module', title: 'Club Join Requests', as: 'student', path: '/app/inbox/club-requests' },
  { id: '4.5.53', group: 'H - Clubs Module', title: 'President Change Requests', as: 'clubadmin', path: '/app/inbox/president-change-request' },
  { id: '4.5.54', group: 'H - Clubs Module', title: 'Manage Clubs', as: 'clubadmin', path: '/app/clubs/manage' },
  { id: '4.5.55', group: 'H - Clubs Module', title: 'Club Categories', as: 'clubadmin', path: '/app/club-category' },

  // ===== I. Dashboards (the six roles that actually hold one) =====
  { id: '4.5.56', group: 'I - Dashboards', title: 'Dashboard - HOD Logistics', as: 'logistics', path: '/app/dashboard' },
  { id: '4.5.60', group: 'I - Dashboards', title: 'Dashboard - CFO Finance', as: 'cfo', path: '/app/dashboard' },
  { id: '4.5.61', group: 'I - Dashboards', title: 'Dashboard - Cafeteria Manager', as: 'cafmgr', path: '/app/dashboard' },


  // ===== J. Events and Registrations =====
  { id: '4.5.62', group: 'J - Events and Registrations', title: 'Event Registrations Hub', as: 'organiser', path: '/app/inbox/registrations' },

  // ===== K. System Administration and Option Catalogues =====
  { id: '4.5.65', group: 'K - System Administration', title: 'Users Directory', as: 'sysadmin', path: '/app/users' },
  { id: '4.5.66', group: 'K - System Administration', title: 'Units Directory', as: 'sysadmin', path: '/app/units' },
  { id: '4.5.67', group: 'K - System Administration', title: 'Roles Management', as: 'sysadmin', path: '/app/roles' },
  { id: '4.5.68', group: 'K - System Administration', title: 'Page Visibility', as: 'sysadmin', path: '/app/admin/page-visibility' },
  { id: '4.5.69', group: 'K - System Administration', title: 'System Configuration - Approval Policies', as: 'sysadmin', path: '/app/admin/settings/policies' },
  { id: '4.5.72', group: 'K - System Administration', title: 'Option Catalogue - Logistics Items', as: 'logistics', path: '/app/dropdown-options/logistics' },
  { id: '4.5.76', group: 'K - System Administration', title: 'Option Catalogue - Venue Management', as: 'cfo', path: '/app/dropdown-options/venue' },

  // ===== L. AI Assistant =====
  { id: '4.5.78', group: 'L - AI Assistant', title: 'AI Assistant Dock', keepOpen: true, as: 'logistics', path: '/app/dashboard',
    prep: (p) => click(p, ['button.ai-orb-button', 'app-ai-assistant button']) },
  { id: '4.5.79', group: 'L - AI Assistant', title: 'AI Assistant Full Page', as: 'logistics', path: '/assistant' },
  { id: '4.5.80', group: 'L - AI Assistant', title: 'AI Access Log', as: 'sysadmin', path: '/app/admin/ai-access-log' },

];

// ---------- runner ----------
const args = process.argv.slice(2);
const argVal = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const onlyGroup = argVal('--group');
const onlyId = argVal('--only');

let shots = SHOTS.map((s) => ({ ...s }));
if (onlyGroup) shots = shots.filter((s) => s.group.startsWith(onlyGroup));
if (onlyId) shots = shots.filter((s) => onlyId.split(',').includes(s.id));

if (args.includes('--list')) {
  for (const s of shots) console.log(`${s.id}  ${s.group}  |  ${s.title}`);
  console.log(`\n${shots.length} pages -> ${shots.length * 2} images`);
  process.exit(0);
}

// --dump writes the shot list (minus the prep closures) so other tools - the
// audit, the index - can work from the same source without duplicating it.
if (args.includes('--dump')) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    'shots.json',
    JSON.stringify(shots.map(({ id, title, group, as, path: route }) => ({ id, title, group, as, path: route })), null, 2),
  );
  console.log(`wrote shots.json (${shots.length} pages)`);
  process.exit(0);
}

// The auth endpoint is rate limited to 10/min, so back off and retry rather
// than aborting a long capture run partway through.
const login = async (email) => {
  let res;
  for (let attempt = 0; attempt < 10; attempt++) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 429) break;
    console.log(`  rate limited; waiting 20s before retrying ${email}`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const d = await res.json();
  // A session counts as valid only when BOTH the tokens and the cached user
  // profile are present (see AuthService.authenticated()), so seed both.
  return {
    tokens: {
      accessToken: d.accessToken,
      refreshToken: d.refreshToken,
      expiresAt: Date.now() + (d.expiresIn ?? 1800) * 1000,
      version: 2,
    },
    user: { version: 2, user: d.user },
  };
};

// Resolve the :hosProposal / :deptProposal placeholders against whatever is
// actually sitting in each reviewer's inbox right now.
// Picks the first inbox proposal the review page will actually render. A record
// with a null applicantDepartment fails the reviewer's unit check client-side
// and renders "Proposal unavailable", so skip those rather than shooting them.
const firstInboxProposal = async (session, { requireDepartment = false } = {}) => {
  const auth = { Authorization: `Bearer ${session.tokens.accessToken}` };
  const res = await fetch(`${API}/proposals?bucket=inbox&limit=8`, { headers: auth });
  if (!res.ok) return null;
  const body = await res.json();
  const items = Array.isArray(body) ? body : (body.items ?? []);
  for (const item of items) {
    if (!requireDepartment) return item.id;
    const detail = await fetch(`${API}/proposals/${item.id}`, { headers: auth });
    if (!detail.ok) continue;
    if ((await detail.json()).applicantDepartment) return item.id;
  }
  return items[0]?.id ?? null;
};

const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  mobile: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
};

const safe = (s) => s.replace(/[<>:"/\\|?*]/g, '-').trim();
const manifest = [];

const browser = await chromium.launch();
const tokenCache = new Map();

const sessionFor = async (key) => {
  if (!tokenCache.has(key)) tokenCache.set(key, await login(USERS[key]));
  return tokenCache.get(key);
};

const placeholders = {};
if (shots.some((s) => s.path.includes(':hosProposal'))) {
  placeholders[':hosProposal'] = await firstInboxProposal(await sessionFor('hos'), { requireDepartment: true });
}
if (shots.some((s) => s.path.includes(':deptProposal'))) {
  placeholders[':deptProposal'] = await firstInboxProposal(await sessionFor('logistics'));
}
for (const [token, value] of Object.entries(placeholders)) {
  if (value == null) {
    console.log(`WARNING: could not resolve ${token} - those figures will be skipped`);
    continue;
  }
  console.log(`resolved ${token} -> ${value}`);
  for (const s of shots) s.path = s.path.replace(token, String(value));
}
shots = shots.filter((s) => !/:(hos|dept)Proposal/.test(s.path));

for (const profile of ['desktop', 'mobile']) {
  const byUser = new Map();
  for (const s of shots) {
    const key = s.as ?? '__public__';
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(s);
  }

  for (const [userKey, userShots] of byUser) {
    let session = null;
    if (userKey !== '__public__') session = await sessionFor(userKey);

    const context = await browser.newContext({ ...PROFILES[profile], reducedMotion: 'reduce' });
    await context.addInitScript((tok) => {
      try {
        // Keep the dev-only demo account picker out of every login screenshot.
        localStorage.setItem('apu.login.demoUsers', 'hidden');
        if (tok) {
          localStorage.setItem('apu-ems-session', JSON.stringify(tok.tokens));
          localStorage.setItem('apu-ems-auth-user', JSON.stringify(tok.user));
        }
      } catch {}
    }, session);

    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    for (const shot of userShots) {
      const isDesign = shot.group === '_Interface Design';
      const dir = isDesign
        ? path.join(OUT, 'Interface Design', `${shot.id} ${safe(shot.title)}`)
        : path.join(OUT, 'Implementation', shot.group, `${shot.id} ${safe(shot.title)}`);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${profile}.png`);
      const record = { id: shot.id, title: shot.title, group: shot.group, as: shot.as, path: shot.path, profile, file, status: 'ok', note: '' };
      try {
        const base = PROFILES[profile].viewport ?? { width: 390, height: 844 };
        const cap = profile === 'desktop' ? 1200 : 1100;
        await page.setViewportSize({
          width: base.width,
          height: shot.tall ? Math.min(shot.tall, cap) : base.height,
        });
        await page.goto(APP + shot.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (shot.pinSidebar) {
          // The pin is read from storage at boot, so set it and reload.
          await page.evaluate(() => localStorage.setItem('apu-internal-sidebar-pinned', 'true'));
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        }
        await settle(page);
        if (shot.prep) {
          const done = await shot.prep(page);
          if (done === false) record.note += ' PREP-MISSED';
          await settle(page);
          // A prep that refetches (changing a date filter) can still be showing
          // skeleton rows when settle returns, so wait them out explicitly.
          await page
            .waitForFunction(() => !document.querySelector('app-skeleton, .skeleton'), null, { timeout: 12000 })
            .catch(() => {});
          await page.waitForTimeout(700);
        }
        const landed = new URL(page.url()).pathname;
        if (landed !== shot.path) record.note += ` LANDED->${landed}`;

        if (!shot.keepOpen) {
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(350);
        }
        if (shot.scrollTo && !(await scrollTo(page, shot.scrollTo))) record.note += ' SCROLL-TARGET-MISSING';
        // Always a viewport shot. A fullPage capture paints position:fixed chrome
        // (the assistant orb, the sticky top bar) once at the initial scroll
        // offset, which is what put them halfway down the tall images.
        await page.screenshot({ path: file });

        const txt = (await page.locator('body').innerText().catch(() => '')) || '';
        if (/no (records|results|items|data|events|tasks|proposals)|nothing to show/i.test(txt) && txt.length < 2500) {
          record.note += ' EMPTY-STATE';
        }
        // The context is reused by later shots, so do not leak the pinned state.
        if (shot.pinSidebar) {
          await page.evaluate(() => localStorage.setItem('apu-internal-sidebar-pinned', 'false'));
        }
      } catch (err) {
        record.status = 'fail';
        record.note += ' ' + String(err).slice(0, 160);
      }
      manifest.push(record);
      console.log(`[${profile}] ${shot.id} ${shot.title} -> ${record.status}${record.note ? ' (' + record.note.trim() + ')' : ''}`);
    }
    await context.close();
  }
}

await browser.close();
await writeFile(path.join(OUT, '_capture', 'manifest.json'), JSON.stringify(manifest, null, 2));
const fails = manifest.filter((m) => m.status === 'fail');
const empties = manifest.filter((m) => m.note.includes('EMPTY-STATE'));
const missed = manifest.filter((m) => m.note.includes('PREP-MISSED'));
const landed = manifest.filter((m) => m.note.includes('LANDED->'));
console.log(`\nDONE ok=${manifest.length - fails.length} fail=${fails.length} empty=${empties.length} prep-missed=${missed.length} redirected=${landed.length}`);
