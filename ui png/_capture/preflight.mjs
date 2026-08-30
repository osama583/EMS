// Prints which routes each demo account can actually reach in the LIVE database,
// so the shot list targets pages the role really has rather than producing a
// folder full of redirect screenshots.
const API = 'http://localhost:5000/api/v1';
import { demoPassword } from './demo-password.mjs';
const PASSWORD = demoPassword();

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (email) => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status === 429) {
      await sleep(20000);
      continue;
    }
    if (!res.ok) throw new Error(`${email}: ${res.status}`);
    return res.json();
  }
  throw new Error(`${email}: rate limited out`);
};

const flatten = (nodes, out = []) => {
  for (const n of nodes ?? []) {
    if (n.routePath) out.push(n.routePath);
    flatten(n.children, out);
  }
  return out;
};

const report = {};
for (const [key, email] of Object.entries(USERS)) {
  try {
    const d = await login(email);
    const routes = [...new Set(flatten(d.user?.nav))].sort();
    report[key] = routes;
    console.log(`\n== ${key}  (${email})  roles=${(d.user?.roles ?? []).map((r) => r.roleCode).join(',')}`);
    console.log(routes.length ? '   ' + routes.join('\n   ') : '   (no nav pages)');
  } catch (err) {
    console.log(`\n== ${key} FAILED: ${err.message}`);
  }
}
