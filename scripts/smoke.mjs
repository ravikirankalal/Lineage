// End-to-end smoke test: builds nothing, serves dist/ with `vite preview`, drives the main flows
// in Chromium at phone and desktop sizes, saves screenshots, and fails on any page error.
// Usage: npm run build && npm run smoke [-- --out <dir>]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : 'smoke-output';
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });

// Spawn vite directly (not via npx) so kill() stops the actual server process.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  await new Promise((r) => setTimeout(r, 300));
  if (server.exitCode !== null) throw new Error(`port ${PORT} busy — stop the old preview server`);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

async function run(name, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => failures.push(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`[${name}] console error: ${m.text().slice(0, 300)}`));
  const shot = (s) => page.screenshot({ path: `${OUT}/${name}-${s}.png`, fullPage: true });
  const body = () => page.locator('body').innerText();

  await page.goto(BASE);
  await page.getByText('Try a sample family').click();
  await page.getByText('Ravi Rao').first().waitFor();
  await shot('1-people');

  await page.goto(BASE + '#/family');
  await page.getByText('Earliest ancestor').waitFor();
  await shot('2-tree');
  await page.getByRole('button', { name: /Relatives \(/ }).click();
  const rel = await body();
  for (const label of ['First cousin', 'Father-in-law', 'Aunt (by marriage)', "Father's brother's son"]) check(rel.includes(label), `[${name}] relatives missing "${label}"`);
  check(!rel.includes('Sandeep Kumar'), `[${name}] friend leaked into My Family`);
  await shot('3-relatives');
  await page.getByRole('button', { name: /Lines/ }).click();
  await shot('4-lines');

  await page.goto(BASE);
  await page.getByText('Ravi Rao').first().click();
  await page.getByText('Connections').first().waitFor();
  const prof = await body();
  for (const g of ['IMMEDIATE FAMILY', 'CLOSE FRIENDS', 'STUDIED AT THE SAME PLACE']) check(prof.toUpperCase().includes(g), `[${name}] profile missing group ${g}`);
  await shot('5-profile');

  // Add a social connection through the sheet.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Classmate' }).click();
  await page.getByPlaceholder('Search people or type a new name').fill('Smoke Tester');
  await page.getByText('Add “Smoke Tester”').click();
  await page.getByText('Smoke Tester').first().waitFor();
  await shot('6-added');

  await page.goto(BASE + '#/import');
  await shot('8-import');
  await page.goto(BASE + '#/settings');
  await shot('9-settings');
  await browser.close();
}

try {
  await waitForServer();
  await run('phone', { width: 390, height: 844 });
  await run('desktop', { width: 1280, height: 860 });
} catch (e) {
  failures.push('crashed: ' + e.message);
}
stop();
if (failures.length) {
  console.error('SMOKE FAILED\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log(`SMOKE PASSED — screenshots in ${OUT}/`);
