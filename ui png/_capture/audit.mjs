// Fast, screenshot-free pass over every shot: reports which pages render the
// app's empty-state component so an empty figure is a deliberate choice rather
// than something noticed after the report is assembled.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const APP = 'http://localhost:4200';
const API = 'http://localhost:5000/api/v1';
import { demoPassword } from './demo-password.mjs';
const PASSWORD = demoPassword();

// Drive the audit from the manifest the last capture wrote, so the two can
// never drift apart.
const { readFile } = await import('node:fs/promises');
const SHOTS_FOR_AUDIT = JSON.parse(await readFile(path.resolve('shots.json'), 'utf8'));

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
};

const login = async (email) => {
  let res;
  for (let i = 0; i < 10; i++) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 20000));
  }
  const d = await res.json();
  return {
    tokens: { accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: Date.now() + 1800000, version: 2 },
    user: { version: 2, user: d.user },
  };
};

const browser = await chromium.launch();
const cache = new Map();
const rows = [];

const byUser = new Map();
for (const s of SHOTS_FOR_AUDIT) {
  const k = s.as ?? '__public__';
  if (!byUser.has(k)) byUser.set(k, []);
  byUser.get(k).push(s);
}

for (const [key, shots] of byUser) {
  let session = null;
  if (key !== '__public__') {
    if (!cache.has(key)) cache.set(key, await login(USERS[key]));
    session = cache.get(key);
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript((tok) => {
    try {
      localStorage.setItem('apu.login.demoUsers', 'hidden');
      if (tok) {
        localStorage.setItem('apu-ems-session', JSON.stringify(tok.tokens));
        localStorage.setItem('apu-ems-auth-user', JSON.stringify(tok.user));
      }
    } catch {}
  }, session);
  const page = await ctx.newPage();

  for (const s of shots) {
    let empty = null;
    let tableRows = null;
    let heading = '';
    try {
      await page.goto(APP + s.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      empty = (await page.locator('app-internal-page-state').count()) > 0;
      tableRows = await page.locator('table tbody tr').count();
      heading = (await page.locator('app-internal-page-state h2, app-internal-page-state h3').first().innerText().catch(() => '')) || '';
    } catch (err) {
      heading = 'ERROR ' + String(err).slice(0, 80);
    }
    rows.push({ id: s.id, title: s.title, as: s.as, path: s.path, empty, tableRows, heading: heading.trim() });
    if (empty) console.log(`EMPTY  ${s.id} ${s.title}  (${s.as} ${s.path})  "${heading.trim()}"`);
  }
  await ctx.close();
}

await browser.close();
await writeFile(path.resolve('audit.json'), JSON.stringify(rows, null, 2));
const empties = rows.filter((r) => r.empty);
console.log(`\naudited ${rows.length} pages - ${empties.length} render an empty state`);
