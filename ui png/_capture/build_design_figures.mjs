// Builds the section 4.4 "Interface Design" figures.
//
// These are design artefacts rather than plain product screenshots: annotated
// layout anatomies, a role-by-role menu comparison, the token sheet, a
// navigation storyboard and the responsive breakpoint strip. Annotations are
// drawn from measured element bounding boxes, so they stay correct if the
// layout moves rather than being hand-placed pixel guesses.
import { chromium, devices } from 'playwright';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const APP = 'http://localhost:4200';
const API = 'http://localhost:5000/api/v1';
import { demoPassword } from './demo-password.mjs';
const PASSWORD = demoPassword();
const REPO = 'C:/Users/natsu/Desktop/Osama';
const OUT = path.join(REPO, 'ui png', 'Interface Design');
const IMPL = path.join(REPO, 'ui png', 'Implementation');

const USERS = {
  student: 'applicant@demo.apu.edu.my',
  hos: 'hoshod@demo.apu.edu.my',
  logistics: 'logistics.manager@demo.apu.edu.my',
  cfo: 'cfo@demo.apu.edu.my',
  sysadmin: 'system.admin@demo.apu.edu.my',
};

const login = async (email) => {
  let res;
  for (let attempt = 0; attempt < 10; attempt++) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 429) break;
    console.log(`  rate limited; waiting 20s (${email})`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  const d = await res.json();
  return {
    tokens: { accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (d.expiresIn ?? 1800) * 1000, version: 2 },
    user: { version: 2, user: d.user },
  };
};

const tokenCache = new Map();
const sessionFor = async (key) => {
  if (!tokenCache.has(key)) tokenCache.set(key, await login(USERS[key]));
  return tokenCache.get(key);
};

const browser = await chromium.launch();

const makeContext = async (session, profile = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, pinSidebar = false) => {
  const ctx = await browser.newContext({ ...profile, reducedMotion: 'reduce' });
  await ctx.addInitScript(
    ({ tok, pin }) => {
      try {
        localStorage.setItem('apu.login.demoUsers', 'hidden');
        // Pin the sidebar open so the menu reads as labels, not an icon rail.
        if (pin) localStorage.setItem('apu-internal-sidebar-pinned', 'true');
        if (tok) {
          localStorage.setItem('apu-ems-session', JSON.stringify(tok.tokens));
          localStorage.setItem('apu-ems-auth-user', JSON.stringify(tok.user));
        }
      } catch {}
    },
    { tok: session, pin: pinSidebar },
  );
  return ctx;
};

const settle = async (page) => {
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await page.addStyleTag({ content: '.ai-prompt{display:none !important}' }).catch(() => {});
  await page.waitForTimeout(1200);
};

await mkdir(OUT, { recursive: true });
const done = [];
const shot = async (id, title, file) => {
  done.push(`${id} ${title}`);
  console.log(`${id} ${title} -> ${file}`);
};

// ---------------------------------------------------------------- 4.4.01
{
  const dir = path.join(OUT, '4.4.01 System Navigation Site Map');
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'sitemap.png');
  await copyFile(path.join(REPO, 'digrams', 'png', '12-sitemap.png'), dest);
  await shot('4.4.01', 'System Navigation Site Map', dest);
}

// ------------------------------------------------- 4.4.02 / 4.4.03 anatomy
// Draws a numbered outline over each structural region, measured live.
const annotate = async (page, regions, title) => {
  await page.evaluate(
    ({ regions, title }) => {
      const host = document.createElement('div');
      host.id = '__anno';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Segoe UI,Arial,sans-serif';
      const palette = ['#e5484d', '#0090ff', '#30a46c', '#f76b15', '#8e4ec6', '#0d9488'];
      regions.forEach((r, i) => {
        if (!r.box) return;
        const colour = palette[i % palette.length];
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${r.box.x}px;top:${r.box.y}px;width:${r.box.width}px;height:${r.box.height}px;border:3px solid ${colour};border-radius:6px;background:${colour}12;box-sizing:border-box`;
        const tag = document.createElement('div');
        tag.textContent = String(i + 1);
        tag.style.cssText = `position:absolute;left:${r.box.x - 15}px;top:${r.box.y - 15}px;width:30px;height:30px;border-radius:50%;background:${colour};color:#fff;font-weight:700;font-size:15px;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.35)`;
        host.append(box, tag);
      });
      const legend = document.createElement('div');
      legend.style.cssText =
        'position:absolute;left:16px;bottom:16px;max-width:390px;background:rgba(3,19,39,.94);color:#fff;padding:14px 16px;border-radius:10px;font-size:13px;line-height:1.65;box-shadow:0 8px 28px rgba(0,0,0,.4)';
      legend.innerHTML =
        `<div style="font-weight:700;margin-bottom:7px;font-size:14px">${title}</div>` +
        regions
          .map((r, i) => {
            const colour = palette[i % palette.length];
            return `<div><span style="display:inline-block;width:17px;height:17px;border-radius:50%;background:${colour};color:#fff;text-align:center;line-height:17px;font-size:11px;font-weight:700;margin-right:8px">${i + 1}</span>${r.label}</div>`;
          })
          .join('');
      host.append(legend);
      document.body.append(host);
    },
    { regions, title },
  );
};

const measure = async (page, spec) => {
  const out = [];
  for (const [selector, label] of spec) {
    const box = await page.locator(selector).first().boundingBox().catch(() => null);
    out.push({ label, box });
    if (!box) console.log(`   (no match for ${selector})`);
  }
  return out;
};

{
  const ctx = await makeContext(await sessionFor('logistics'), undefined, true);
  const page = await ctx.newPage();
  await page.goto(`${APP}/app/dashboard`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const regions = await measure(page, [
    ['aside.internal-sidebar', 'Sidebar - role-filtered page menu'],
    ['header.internal-topbar', 'Top bar - breadcrumb trail'],
    ['main.internal-workspace', 'Workspace - the active page'],
    ['button.ai-orb-button', 'AI assistant launcher (persistent)'],
  ]);
  await annotate(page, regions, 'Desktop screen layout anatomy - 1440 x 900');
  const dir = path.join(OUT, '4.4.02 Screen Layout Anatomy - Desktop');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'desktop.png');
  await page.screenshot({ path: file });
  await shot('4.4.02', 'Screen Layout Anatomy - Desktop', file);
  await ctx.close();
}

{
  const ctx = await makeContext(await sessionFor('logistics'), { ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  await page.goto(`${APP}/app/dashboard`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const regions = await measure(page, [
    ['header.mobile-topbar', 'Compact top bar with drawer menu trigger'],
    ['main.internal-workspace', 'Single-column stacked content'],
    ['button.ai-orb-button', 'AI assistant launcher'],
  ]);
  await annotate(page, regions, 'Mobile screen layout anatomy - 390 x 844');
  const dir = path.join(OUT, '4.4.03 Screen Layout Anatomy - Mobile');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'mobile.png');
  await page.screenshot({ path: file });
  await shot('4.4.03', 'Screen Layout Anatomy - Mobile', file);
  await ctx.close();
}

// ---------------------------------------------------------------- 4.4.04
// One sidebar per role, side by side: the menu is built from server-side
// grants, so the differences are the access-control model made visible.
{
  const roles = [
    ['student', 'Student', '/app/how-it-works'],
    ['logistics', 'Head of Department', '/app/dashboard'],
    ['cfo', 'CFO', '/app/dashboard'],
    ['sysadmin', 'System Admin', '/app/users'],
  ];
  const clips = [];
  for (const [key, label, route] of roles) {
    const ctx = await makeContext(await sessionFor(key), { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 }, true);
    const page = await ctx.newPage();
    await page.goto(APP + route, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const file = path.join(OUT, '_sidebar_' + key + '.png');
    await page.locator('aside.internal-sidebar').first().screenshot({ path: file }).catch(() => null);
    clips.push({ label, file });
    await ctx.close();
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:26px;background:#eef1f6;font-family:Segoe UI,Arial,sans-serif}
    h1{margin:0 0 4px;font-size:21px;color:#12233d}
    p.sub{margin:0 0 20px;font-size:13.5px;color:#4a5a72}
    .row{display:flex;gap:18px;align-items:flex-start}
    .col{background:#fff;border:1px solid #d3dae6;border-radius:10px;overflow:hidden}
    .cap{padding:10px 12px;background:#1f2a3c;color:#fff;font-size:13.5px;font-weight:600;text-align:center}
    img{display:block;height:620px;width:auto}
  </style><body>
    <h1>Role-based menu design</h1>
    <p class="sub">The sidebar is rendered from the page grants the server issues for the signed-in role. No menu is hard-coded in the client.</p>
    <div class="row">${clips
      .map((c) => `<div class="col"><div class="cap">${c.label}</div><img src="${pathToFileURL(c.file).href}"></div>`)
      .join('')}</div>
  </body>`;
  const htmlFile = path.join(OUT, '_menus.html');
  await writeFile(htmlFile, html, 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
  const dir = path.join(OUT, '4.4.04 Role-Based Menu Design');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'menus.png');
  await page.locator('body').screenshot({ path: file });
  await shot('4.4.04', 'Role-Based Menu Design', file);
  await ctx.close();
}

// ---------------------------------------------------------------- 4.4.05
// Token sheet read straight out of the running app's computed styles.
{
  const ctx = await makeContext(null);
  const page = await ctx.newPage();
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const names = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules ?? []) {
        if (rule.style) {
          for (const prop of rule.style) if (prop.startsWith('--')) names.push(prop);
        }
      }
    }
    const seen = new Map();
    for (const n of [...new Set(names)].sort()) {
      const v = style.getPropertyValue(n).trim();
      if (v) seen.set(n, v);
    }
    return [...seen.entries()];
  });
  const isColour = (v) => /^#|^rgb|^hsl/.test(v);
  const colours = tokens.filter(([, v]) => isColour(v));
  const spacing = tokens.filter(([n]) => /^--(space|radius)/.test(n));
  const type = tokens.filter(([n]) => /^--(type|weight|page-title|apu-font)/.test(n));
  const cell = ([n, v]) => `<tr><td class="n">${n}</td><td class="v">${v}</td></tr>`;
  const swatch = ([n, v]) =>
    `<div class="sw"><span style="background:${v}"></span><b>${n}</b><i>${v}</i></div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:28px;background:#eef1f6;font-family:Segoe UI,Arial,sans-serif;width:1240px}
    h1{margin:0 0 4px;font-size:21px;color:#12233d}
    p.sub{margin:0 0 20px;font-size:13.5px;color:#4a5a72}
    .card{background:#fff;border:1px solid #d3dae6;border-radius:10px;padding:18px 20px;margin-bottom:16px}
    h2{margin:0 0 12px;font-size:15px;color:#1f2a3c;text-transform:uppercase;letter-spacing:.06em}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .sw{display:flex;align-items:center;gap:9px;font-size:12px}
    .sw span{width:34px;height:34px;border-radius:7px;border:1px solid #c9d3e2;flex:none}
    .sw b{font-family:Consolas,monospace;font-weight:600;color:#22314a}
    .sw i{color:#6b7a90;font-style:normal;font-family:Consolas,monospace}
    table{border-collapse:collapse;width:100%;font-size:12.5px}
    td{padding:5px 8px;border-bottom:1px solid #eef1f6}
    td.n{font-family:Consolas,monospace;color:#22314a;width:44%}
    td.v{font-family:Consolas,monospace;color:#6b7a90}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  </style><body>
    <h1>Design system tokens</h1>
    <p class="sub">Read from the running application's computed styles - the same custom properties every component consumes.</p>
    <div class="card"><h2>Colour</h2><div class="grid">${colours.map(swatch).join('')}</div></div>
    <div class="two">
      <div class="card"><h2>Typography</h2><table>${type.map(cell).join('')}</table></div>
      <div class="card"><h2>Spacing and radius</h2><table>${spacing.map(cell).join('')}</table></div>
    </div>
  </body>`;
  const htmlFile = path.join(OUT, '_tokens.html');
  await writeFile(htmlFile, html, 'utf8');
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
  const dir = path.join(OUT, '4.4.05 Design System Tokens');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'tokens.png');
  await page.locator('body').screenshot({ path: file });
  await shot('4.4.05', `Design System Tokens (${tokens.length} tokens)`, file);
  await ctx.close();
}

// ------------------------------------------------- 4.4.07 / 4.4.08 / 4.4.09
{
  const jobs = [
    { id: '4.4.07', title: 'Form Control and Validation States', as: 'student', route: '/app/forms/event-proposal',
      prep: async (p) => {
        for (const label of ['Final Review', 'Submit']) {
          await p.locator(`button:has-text("${label}")`).first().click({ timeout: 5000 }).catch(() => {});
          await p.waitForTimeout(900);
        }
      },
      clip: ['app-form-field', '.form-grid', 'form'] },
    { id: '4.4.08', title: 'Data Table and Filter Pattern', as: 'hos', route: '/app/inbox/proposals',
      clip: ['.internal-table-workspace', 'app-internal-table-workspace', 'table'] },
    { id: '4.4.09', title: 'Status and Workflow Badge Language', as: 'student', route: '/app/created-by-me',
      clip: ['.internal-table-workspace', 'table', 'main'] },
  ];
  for (const job of jobs) {
    const ctx = await makeContext(await sessionFor(job.as));
    const page = await ctx.newPage();
    await page.goto(APP + job.route, { waitUntil: 'domcontentloaded' });
    await settle(page);
    if (job.prep) await job.prep(page);
    await settle(page);
    const dir = path.join(OUT, `${job.id} ${job.title}`);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'figure.png');
    let ok = false;
    for (const sel of job.clip) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0)) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        if (await el.screenshot({ path: file, timeout: 15000 }).then(() => true).catch(() => false)) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) await page.screenshot({ path: file });
    await shot(job.id, job.title, file);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 4.4.10
// Storyboard strip assembled from the already-captured proposal journey.
{
  const steps = [
    ['D - Proposal Creation/4.5.21 Proposal Form - Step 1 Applicant Info', '1. Applicant info'],
    ['D - Proposal Creation/4.5.23 Proposal Form - Step 3 Required for Event', '2. Choose requirements'],
    ['D - Proposal Creation/4.5.26 Proposal Form - Step 6 Final Review', '3. Review and submit'],
    ['E - Proposal Tracking and Review/4.5.30 Proposal Review - Reviewer View', '4. Reviewer decision'],
    ['F - Department Task Handling/4.5.36 Inbox - Department Tasks', '5. Department tasks'],
    ['E - Proposal Tracking and Review/4.5.29 Created by Me - Status Tracking', '6. Applicant tracks status'],
  ];
  const cards = [];
  for (const [rel, caption] of steps) {
    const file = path.join(IMPL, rel, 'desktop.png');
    try {
      await readFile(file);
      cards.push({ file, caption });
    } catch {
      console.log(`   storyboard: missing ${rel}`);
    }
  }
  if (cards.length) {
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:26px;background:#eef1f6;font-family:Segoe UI,Arial,sans-serif;width:1560px}
      h1{margin:0 0 4px;font-size:21px;color:#12233d}
      p.sub{margin:0 0 18px;font-size:13.5px;color:#4a5a72}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      .card{background:#fff;border:1px solid #d3dae6;border-radius:10px;overflow:hidden}
      .cap{padding:9px 12px;background:#1f2a3c;color:#fff;font-size:13px;font-weight:600}
      .win{height:300px;overflow:hidden}
      img{width:100%;display:block}
    </style><body>
      <h1>Page navigation storyboard - the event proposal journey</h1>
      <p class="sub">Draft, submit, approve, fan out to departments, then track - the path a proposal takes through the system.</p>
      <div class="grid">${cards
        .map((c) => `<div class="card"><div class="cap">${c.caption}</div><div class="win"><img src="${pathToFileURL(c.file).href}"></div></div>`)
        .join('')}</div>
    </body>`;
    const htmlFile = path.join(OUT, '_storyboard.html');
    await writeFile(htmlFile, html, 'utf8');
    const ctx = await browser.newContext({ viewport: { width: 1620, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
    const dir = path.join(OUT, '4.4.10 Page Navigation Storyboard');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'storyboard.png');
    await page.locator('body').screenshot({ path: file });
    await shot('4.4.10', 'Page Navigation Storyboard', file);
    await ctx.close();
  }
}

// ---------------------------------------------------------------- 4.4.11
// The same page at three widths, proving the layout genuinely reflows.
{
  const widths = [
    [1440, 900, 'Desktop 1440px'],
    [768, 1000, 'Tablet 768px'],
    [390, 844, 'Phone 390px'],
  ];
  const files = [];
  for (const [w, h, label] of widths) {
    const ctx = await makeContext(await sessionFor('logistics'), {
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: w < 800,
      hasTouch: w < 800,
    });
    const page = await ctx.newPage();
    await page.goto(`${APP}/app/dashboard`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const file = path.join(OUT, `_bp_${w}.png`);
    await page.screenshot({ path: file });
    files.push({ file, label });
    await ctx.close();
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:26px;background:#eef1f6;font-family:Segoe UI,Arial,sans-serif;width:1500px}
    h1{margin:0 0 4px;font-size:21px;color:#12233d}
    p.sub{margin:0 0 18px;font-size:13.5px;color:#4a5a72}
    .row{display:flex;gap:18px;align-items:flex-start;justify-content:center}
    .card{background:#fff;border:1px solid #d3dae6;border-radius:10px;overflow:hidden}
    .cap{padding:9px 12px;background:#1f2a3c;color:#fff;font-size:13px;font-weight:600;text-align:center}
    img{display:block;height:560px;width:auto}
  </style><body>
    <h1>Responsive breakpoint strategy</h1>
    <p class="sub">One page at three widths. Below 768px the sidebar collapses into a drawer and the content stacks to a single column.</p>
    <div class="row">${files
      .map((f) => `<div class="card"><div class="cap">${f.label}</div><img src="${pathToFileURL(f.file).href}"></div>`)
      .join('')}</div>
  </body>`;
  const htmlFile = path.join(OUT, '_breakpoints.html');
  await writeFile(htmlFile, html, 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 760 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle' });
  const dir = path.join(OUT, '4.4.11 Responsive Breakpoint Strategy');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'breakpoints.png');
  await page.locator('body').screenshot({ path: file });
  await shot('4.4.11', 'Responsive Breakpoint Strategy', file);
  await ctx.close();
}

await browser.close();
console.log(`\nbuilt ${done.length} design figures`);
