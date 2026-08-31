// Writes "ui png/FIGURE INDEX.md" - the list of every figure with its number,
// title, the role and route it was taken from, and any capture caveat. Use it
// to caption figures in the report and to see at a glance what needs a second
// look before it goes in.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('C:/Users/natsu/Desktop/Osama/ui png');
// shots.json is the full, current shot list; manifest.json only holds whatever
// the most recent run touched, so notes are merged in where they exist.
const shots = JSON.parse(await readFile(path.join(OUT, '_capture', 'shots.json'), 'utf8'));
let notes = [];
try {
  notes = JSON.parse(await readFile(path.join(OUT, '_capture', 'manifest.json'), 'utf8'));
} catch {}
// The 4.4 design artefacts come from build_design_figures.mjs, not the shot
// list, so they are described here to keep the index complete.
const DESIGN_FIGURES = [
  ['4.4.01', 'System Navigation Site Map', 'Rendered from digrams/12-sitemap.html'],
  ['4.4.02', 'Screen Layout Anatomy - Desktop', 'Annotated from measured element bounds'],
  ['4.4.03', 'Screen Layout Anatomy - Mobile', 'Annotated from measured element bounds'],
  ['4.4.04', 'Role-Based Menu Design', 'Student / HOD / CFO / System Admin sidebars'],
  ['4.4.05', 'Design System Tokens', "Read from the running app's computed styles"],
  ['4.4.06', 'Shared Component Library', 'The /shared route, in six screen-sized parts'],
  ['4.4.07', 'Storyboard - Event Proposal Lifecycle', 'Six steps, draft through tracking'],
  ['4.4.08', 'Storyboard - Event Registration Lifecycle', 'Six steps, browse through confirmed'],
  ['4.4.09', 'Storyboard - Club Joining Lifecycle', 'Four steps, discover through roster'],
  ['4.4.10', 'Responsive Breakpoint Strategy', 'One page at 1440 / 768 / 390'],
];

const manifest = shots.map((s) => {
  const runs = notes.filter((n) => n.id === s.id);
  return { ...s, note: runs.map((r) => r.note).join(' ').trim(), profile: 'desktop', status: runs.some((r) => r.status === 'fail') ? 'fail' : 'ok' };
});

const ROLE_LABEL = {
  null: 'Signed out (public visitor)',
  external: 'External user - j.tanaka@example.com',
  student: 'Student - applicant@demo.apu.edu.my',
  hos: 'Head of School - hoshod@demo.apu.edu.my',
  logistics: 'HOD Logistics - logistics.manager@demo.apu.edu.my',
  logstaff: 'Staff - logistics.staff@demo.apu.edu.my',
  fmb: 'HOD Food & Beverage - fmb@demo.apu.edu.my',
  av: 'HOD A/V - av.manager@demo.apu.edu.my',
  transport: 'HOD Transport - transport.manager@demo.apu.edu.my',
  cfo: 'CFO - cfo@demo.apu.edu.my',
  cafadmin: 'Cafeteria Admin - cafeteria.admin@demo.apu.edu.my',
  cafmgr: 'Cafeteria Manager - cafeteria.manager@demo.apu.edu.my',
  cafstaff: 'Cafeteria Staff - cafeteria.staff2@demo.apu.edu.my',
  clubadmin: 'Club Admin - club.admin@demo.apu.edu.my',
  sysadmin: 'System Admin - system.admin@demo.apu.edu.my',
  organiser: 'Student organiser - student.computing2@demo.apu.edu.my',
};

// A tab strip is captured ONCE, with the sibling tabs visible but unopened, and
// the caption carries the rest. That is the whole point of the consolidation:
// the report should not hold seven near-identical images of one shell. Paste
// these into the figure caption so the reader knows the other tabs exist and
// what each one holds.
const COVERS = {
  "4.5.12": "Shows the **Saved** tab. The same page carries **Registered** (confirmed places on events still to come) and **Conducted** (events actually attended - a confirmed place on an event that has since finished). All three render the same card list; the server decides which registrations belong to each.",
  "4.5.13": "The external-user shell, which is a different layout from the internal one in 4.5.12 and has four tabs of its own: **Saved**, **Pending** (manual-approval sign-ups still awaiting the organiser), **Registered**, and **History** (sign-ups that were turned down, plus events already attended).",
  "4.5.35": "Shows the **Proposals** queue. The Inbox is one shell whose tab strip is computed per role, and it holds everything waiting on this person to act: **Proposals** (awaiting their approve / reject / send-back decision), **Requests** (department-service requests routed to the unit they head), **Events** (event registrations awaiting the organiser's decision - 4.5.62), **Tasks** (the shared-pool work queue for department staff, and the claim / prepare / fulfil queue for cafeteria staff - 4.5.42), **Clubs** (join requests awaiting a club President - 4.5.52) and **President Change Requests** (handovers awaiting a Club Admin - 4.5.53). No single role holds all six; the strip in this figure is HOD Logistics's.",
  "4.5.39": "Shows the **Proposals** tab. Ongoing is the same records shell as the Inbox but holds what is in flight rather than what needs a decision now: **Proposals** (submitted and still moving through approval), **Events** (the viewer's own event registrations still awaiting an organiser's decision) and, for a student, **Clubs** (join requests still pending).",
  "4.5.40": "Shows the **Proposals** tab. History is the settled counterpart of Ongoing: **Proposals** (approved, rejected or cancelled), **Events** (registrations confirmed and since finished, or turned down), **Tasks** (completed department work, for staff), **Clubs** (decided join requests, for a student) and **President Change Requests** (decided handovers, for a Club Admin).",
  "4.5.56": "The dashboard is one page whose KPI tiles and charts are computed for the viewer own unit. The identical screen serves HOD Logistics (shown here), HOD Food & Beverage, HOD Audio Visual and HOD Transport - only the unit name and the numbers change. The CFO and Cafeteria Manager variants read genuinely different measures and are kept as separate figures (4.5.60, 4.5.61).",
  "4.5.69": "Shows the **Approval Policies** tab. System Configuration is one page with three: **Approval Policies** (high-pax threshold, cancellation deadline, minimum lead time, maximum event categories), **Event Categories** and **Event Formats** - the last two being the same add / edit / deactivate / delete catalogue table pointed at different lists.",
  "4.5.72": "Shows the **Logistics** catalogue. One component serves every option list a proposal picks from - Transportation, Sound & Light, Photography and Videography, Campus Tour, Funding, Dietary Information and Serving Units - each owned by the department answerable for it. Venue Management (4.5.76) is kept separate because it carries capacity and location fields the others do not.",
};

// Collapse the desktop and mobile rows for a page into one entry.
const pages = new Map();
for (const row of manifest) {
  if (!pages.has(row.id)) pages.set(row.id, { ...row, notes: [] });
  const entry = pages.get(row.id);
  const note = row.note.trim();
  if (note) entry.notes.push(`${row.profile}: ${note}`);
  if (row.status === 'fail') entry.failed = true;
}

const byGroup = new Map();
for (const p of [...pages.values()].sort((a, b) => a.id.localeCompare(b.id))) {
  if (p.group === '_Interface Design') continue; // already listed in the design table
  const g = p.group;
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(p);
}

let md = `# Figure index - Chapter 4\n\n`;
md += `Every implementation figure exists twice: \`desktop.png\` (1440x900 at 2x) and \`mobile.png\` (iPhone 14, 390x844 at 3x).\n\n`;
md += `Figures are viewport captures, never full-page. A full-page screenshot paints\n`;
md += `position:fixed chrome - the assistant orb, the sticky top bar - once at the\n`;
md += `initial scroll offset, which lands it halfway down a tall image and produces a\n`;
md += `strip too tall to place in a document. Viewport shots keep every figure at 100%\n`;
md += `and put the chrome where it belongs.\n\n`;
md += `| Figures | Location |\n|---|---|\n`;
md += `| 4.4 Interface Design | \`ui png/Interface Design/\` |\n`;
md += `| 4.5 Implementation | \`ui png/Implementation/\` |\n`;
md += `| 4.6 Sample codes | \`ui png/Sample Codes/\` |\n\n`;

let designMd = `
## Interface Design artefacts (section 4.4)

| # | Figure title | How it was produced |
|---|---|---|
`;
for (const [id, title, how] of DESIGN_FIGURES) designMd += `| ${id} | ${title} | ${how} |
`;
md += designMd;

for (const [group, rows] of byGroup) {
  md += `\n## ${group}\n\n`;
  md += `| # | Figure title | Captured as | Route |\n|---|---|---|---|\n`;
  for (const r of rows) {
    md += `| ${r.id} | ${r.title} | ${ROLE_LABEL[String(r.as)] ?? r.as} | \`${r.path}\` |\n`;
  }
  const covered = rows.filter((r) => COVERS[r.id]);
  if (covered.length) {
    md += `\n**Covers more than one tab - say so in the caption:**\n\n`;
    for (const r of covered) md += `- **${r.id} ${r.title}** - ${COVERS[r.id]}\n`;
  }
  const flagged = rows.filter((r) => r.notes.length);
  if (flagged.length) {
    md += `\n**Check before use:**\n\n`;
    for (const r of flagged) md += `- ${r.id} ${r.title} - ${[...new Set(r.notes)].join('; ')}\n`;
  }
}

md += `\n\n## Consolidation\n\n`;
md += `Tab strips are captured once. Where a page differs from a sibling only by\n`;
md += `which tab is open, whose data it renders, or which catalogue it points at,\n`;
md += `one figure carries it and the caption names the rest - see the "Covers more\n`;
md += `than one tab" notes above. That retired 17 near-duplicate figures without\n`;
md += `dropping a single screen from the coverage.\n\n`;
md += `The registration queue (4.5.62) is captured as a student who organises events\n`;
md += `with sign-ups awaiting a decision. It was previously taken as a Head of School,\n`;
md += `who organises none - which is why it used to record an empty state.\n`;
md += `\n\n## Note keys\n\n`;
md += `- \`EMPTY-STATE\` - the page rendered its "nothing here yet" state; correct behaviour, but pick a different account if you want a populated figure.\n`;
md += `- \`PREP-MISSED\` - the scripted interaction (open a modal, switch a tab) found no matching control, so the figure shows the page beneath it.\n`;
md += `- \`LANDED->\` - the app redirected; the figure shows where it actually ended up.\n`;

await writeFile(path.join(OUT, 'FIGURE INDEX.md'), md, 'utf8');
console.log(`wrote FIGURE INDEX.md - ${pages.size} pages across ${byGroup.size} groups`);
