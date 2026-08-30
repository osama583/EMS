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
  ['4.4.06', 'Shared Component Library', 'The live /shared route'],
  ['4.4.07', 'Form Control and Validation States', 'Proposal form after a failed submit'],
  ['4.4.08', 'Data Table and Filter Pattern', 'Inbox proposals table workspace'],
  ['4.4.09', 'Status and Workflow Badge Language', 'Created by Me status column'],
  ['4.4.10', 'Page Navigation Storyboard', 'Six-step proposal journey'],
  ['4.4.11', 'Responsive Breakpoint Strategy', 'One page at 1440 / 768 / 390'],
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
  const flagged = rows.filter((r) => r.notes.length);
  if (flagged.length) {
    md += `\n**Check before use:**\n\n`;
    for (const r of flagged) md += `- ${r.id} ${r.title} - ${[...new Set(r.notes)].join('; ')}\n`;
  }
}

md += `\n\n## Known empty states\n\n`;
md += `Verified against the live database: these pages have no rows to show for any\n`;
md += `account, so the figure is the application's empty state. That is a real screen\n`;
md += `rather than a capture failure, but caption it accordingly.\n\n`;
md += `| # | Figure | Why it is empty |\n|---|---|---|\n`;
md += `| 4.5.63 | Event Registrations Hub | No registration in the database is in "pending" status, so nothing awaits approval. |\n`;
md += `| 4.5.64 | Ongoing Events | Same cause - the pending-registration queue is empty. |\n`;

md += `\n\n## Note keys\n\n`;
md += `- \`EMPTY-STATE\` - the page rendered its "nothing here yet" state; correct behaviour, but pick a different account if you want a populated figure.\n`;
md += `- \`PREP-MISSED\` - the scripted interaction (open a modal, switch a tab) found no matching control, so the figure shows the page beneath it.\n`;
md += `- \`LANDED->\` - the app redirected; the figure shows where it actually ended up.\n`;

await writeFile(path.join(OUT, 'FIGURE INDEX.md'), md, 'utf8');
console.log(`wrote FIGURE INDEX.md - ${pages.size} pages across ${byGroup.size} groups`);
