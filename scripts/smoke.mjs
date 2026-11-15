// End-to-end smoke test against the Firebase emulators (Lineage requires sign-in and keeps the
// tree in Firestore): signs in, loads the sample family, drives the main flows in Chromium at phone
// and desktop sizes, saves screenshots, and fails on any page error. Builds its own emulator bundle.
// Usage: npm run smoke [-- --out <dir>]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EXPECTED_CONSOLE, signIn, startStack, stopAll } from './emu.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : 'smoke-output';
const PORT = 4179;
let BASE = '';
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

async function run(name, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => failures.push(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !EXPECTED_CONSOLE.some((re) => re.test(m.text())) && failures.push(`[${name}] console error: ${m.text().slice(0, 300)}`));
  const shot = (s) => page.screenshot({ path: `${OUT}/${name}-${s}.png`, fullPage: true });
  const body = () => page.locator('body').innerText();

  // Signed out: only the sign-in screen.
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  check(!(await page.getByRole('navigation').count()), `[${name}] app shown before sign-in`);
  await shot('0-sign-in');
  await signIn(page, BASE, `${name}@example.com`, `Smoke ${name}`);
  await page.getByText('Try a sample family').click();
  await page.getByText('Ravi Rao').first().waitFor();
  await shot('1-people');

  await page.goto(BASE + '#/family');
  await page.getByPlaceholder('Find in tree').waitFor();
  await shot('2-tree');
  await page.goto(BASE + '#/'); await page.getByRole('button', { name: /Relatives \(/ }).click(); await page.getByPlaceholder('Search relatives').waitFor(); await page.waitForFunction(() => document.querySelectorAll('section h3').length > 0);
  const rel = await body();
  for (const label of ['First cousin', 'Father-in-law', 'Aunt (by marriage)', "Father's brother's son"]) check(rel.includes(label), `[${name}] relatives missing "${label}"`);
  await shot('3-relatives');
  await page.getByRole('button', { name: /Lines/ }).click();
  await page.getByText("Father's line").waitFor();
  await page.getByText('Earliest ancestor').waitFor();
  await shot('4-lines');
  // My Family is the tree only; old ?tab= links land on the People page.
  await page.goto(BASE + '#/family');
  await page.getByPlaceholder('Find in tree').waitFor();
  check(!(await page.getByRole('button', { name: /Relatives \(/ }).count()), `[${name}] My Family still has a Relatives tab`);
  // Map view: no page header, Share, Add relative, save or full-screen buttons; the tree fills the width.
  for (const n of [/^Share/, /Add a relative of/, /Full screen/, /^Save/]) check(!(await page.getByRole('button', { name: n }).count()), `[${name}] My Family still shows ${n}`);
  check(!(await page.getByRole('heading', { name: 'My Family' }).count()), `[${name}] My Family still has a page title`);
  const tb = await page.locator('.tree-viewport').boundingBox();
  const vw = page.viewportSize().width;
  check(tb && vw - tb.width <= 241 && tb.height > page.viewportSize().height * 0.7, `[${name}] tree does not fill the screen (${JSON.stringify(tb)})`);
  await page.goto(BASE + '#/family?tab=relatives');
  await page.getByPlaceholder('Search relatives').waitFor();
  // Show in tree from the Relatives list opens My Family with that person highlighted.
  await page.getByRole('button', { name: /Show .* in the tree/ }).first().click();
  await page.getByRole('button', { name: 'Clear highlight' }).waitFor();

  await page.goto(BASE);
  await page.getByText('Ravi Rao').first().click();
  await page.getByText('Immediate family').first().waitFor();
  const prof = await body();
  for (const g of ['IMMEDIATE FAMILY', 'EXTENDED FAMILY']) check(prof.toUpperCase().includes(g), `[${name}] profile missing group ${g}`);
  for (const g of ['FRIENDS', 'COLLEAGUES', 'SAME CITY', 'STUDIED AT THE SAME PLACE', 'CONNECTIONS']) check(!prof.toUpperCase().includes(g), `[${name}] profile still shows ${g}`);
  await shot('5-profile');

  // Add a relative through the sheet (family choices only).
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = await body();
  for (const w of ['Friend', 'Colleague', 'Classmate', 'Neighbour', 'Acquaintance', 'Social']) check(!sheet.includes(w), `[${name}] add sheet offers "${w}"`);
  await page.getByRole('button', { name: 'Son', exact: true }).click();
  await page.getByPlaceholder('Search people or type a new name').fill('Smoke Tester');
  await page.getByText('Add “Smoke Tester”').click();
  await page.getByText('Smoke Tester').first().waitFor();
  await shot('6-added');

  // Saved in the cloud, not the page: still there after a reload.
  await page.reload();
  await page.getByText('Smoke Tester').first().waitFor();
  check(!(await page.getByRole('link', { name: 'Import' }).count()), `[${name}] Import still in the navigation`);

  await page.goto(BASE + '#/settings');
  const st = await body();
  for (const w of ['Download backup', 'Restore from backup', 'Sync now']) check(!st.includes(w), `[${name}] Settings still offers "${w}"`);
  await shot('9-settings');
  // Sign out: back to the sign-in screen, no family shown.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
  check(!(await body()).includes('Ravi Rao'), `[${name}] family still visible after sign-out`);
  await browser.close();
}

try {
  BASE = await startStack(PORT);
  await run('phone', { width: 390, height: 844 });
  await run('desktop', { width: 1280, height: 860 });
} catch (e) {
  failures.push('crashed: ' + e.message);
}
stopAll();
if (failures.length) {
  console.error('SMOKE FAILED\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log(`SMOKE PASSED — screenshots in ${OUT}/`);
