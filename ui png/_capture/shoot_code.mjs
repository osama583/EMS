// Screenshots the section 4.6 code cards produced by build_code_figures.py.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const jobs = JSON.parse(await readFile('_code_html/jobs.json', 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });

for (const job of jobs) {
  await page.goto(pathToFileURL(job.html).href, { waitUntil: 'networkidle' });
  await page.locator('.card').screenshot({ path: job.png });
  console.log(`${job.id} ${job.name} -> ok`);
}

await browser.close();
console.log(`\n${jobs.length} code figures rendered`);
