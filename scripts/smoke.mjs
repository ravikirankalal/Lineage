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
  // Family Tree is the tree only; old ?tab= links land on the People page.
  await page.goto(BASE + '#/family');
  await page.getByPlaceholder('Find in tree').waitFor();
  check(!(await page.getByRole('button', { name: /Relatives \(/ }).count()), `[${name}] Family Tree still has a Relatives tab`);
  // Map view: no page header, Share, Add relative, save or full-screen buttons; the tree fills the width.
  for (const n of [/^Share/, /Add a relative of/, /Full screen/, /^Save/]) check(!(await page.getByRole('button', { name: n }).count()), `[${name}] Family Tree still shows ${n}`);
  check(!(await page.getByRole('heading', { name: 'Family Tree' }).count()), `[${name}] Family Tree still has a page title`);
  const tb = await page.locator('.tree-viewport').boundingBox();
  const vw = page.viewportSize().width;
  check(tb && vw - tb.width <= 241 && tb.height > page.viewportSize().height * 0.7, `[${name}] tree does not fill the screen (${JSON.stringify(tb)})`);
  // Everyone: the whole family, nothing folded (no show/hide buttons on cards).
  await page.getByRole('radio', { name: 'Everyone' }).click();
  await page.waitForTimeout(600);
  check(!(await page.locator('.tree-viewport button[aria-label^="Show "][aria-label$="children"], .tree-viewport button[aria-label^="Show "][aria-label$="relatives"]').count()), `[${name}] Everyone still has folded cards`);
  await shot('2c-everyone');
  // Implode piles every card into a flush wall with no lines; Explode restores it (Extended and Everyone, cross).
  const implodeCheck = async (lvl) => {
    const impBtn = page.getByRole('button', { name: 'Implode' });
    // Phones open in the cross layout; desktop starts top-down, which has no Implode.
    if (vw < 768) check(await impBtn.count() > 0, `[${name}] ${lvl} has no Implode button`);
    if (await impBtn.count()) {
      await impBtn.click();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Explode'); return b && !b.disabled; }, null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => {
        const r = [...document.querySelectorAll('.tree-world [data-key]')].map((e) => e.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
          const ox = Math.min(r[i].right, r[j].right) - Math.max(r[i].left, r[j].left);
          const oy = Math.min(r[i].bottom, r[j].bottom) - Math.max(r[i].top, r[j].top);
          if (ox > 2 && oy > 2) overlaps++;
        }
        // Flush: every card touches another one (within 2px) on some side.
        const touching = r.filter((a) => r.some((b) => b !== a && (
          (Math.abs(a.bottom - b.top) < 2 || Math.abs(a.top - b.bottom) < 2) && Math.abs(a.left - b.left) < 2 ||
          (Math.abs(a.right - b.left) < 2 || Math.abs(a.left - b.right) < 2) && Math.abs(a.top - b.top) < 2))).length;
        return { n: r.length, overlaps, touching, lines: getComputedStyle(document.querySelector('.tree-edges')).opacity };
      });
      check(st.lines === '0', `[${name}] ${lvl}: lines still showing after Implode`);
      check(st.overlaps === 0, `[${name}] ${lvl}: cards overlap in the imploded wall (${st.overlaps})`);
      check(st.touching === st.n, `[${name}] ${lvl}: imploded cards are not stacked flush (${st.touching}/${st.n} touching)`);
      await shot(lvl === 'Everyone' ? '2d-imploded' : '2e-imploded-extended');
      await page.getByRole('button', { name: 'Explode' }).click();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Implode'); return b && !b.disabled; }, null, { timeout: 5000 });
      const back = await page.evaluate(() => ({
        moved: [...document.querySelectorAll('.tree-world [data-key]')].filter((e) => e.style.transform).length,
        lines: getComputedStyle(document.querySelector('.tree-edges')).opacity,
      }));
      check(back.moved === 0 && back.lines === '1', `[${name}] ${lvl}: Explode did not restore the tree (${JSON.stringify(back)})`);
    }
  };
  // Fully zoomed out, the background bands still fill the whole tree area (they reach far past the tree).
  for (let i = 0; i < 12; i++) { await page.getByRole('button', { name: 'Zoom out' }).click(); await page.waitForTimeout(120); } // each click animates
  await page.waitForTimeout(500);
  const cover = await page.evaluate(() => {
    const v = document.querySelector('.tree-viewport').getBoundingClientRect();
    const fills = [...document.querySelectorAll('.tree-bands > div')].map((e) => e.getBoundingClientRect());
    return fills.some((r) => r.left <= v.left) && fills.some((r) => r.right >= v.right)
      && fills.some((r) => r.top <= v.top) && fills.some((r) => r.bottom >= v.bottom);
  });
  check(cover, `[${name}] zoomed out, the background bands stop short of the screen edges`);
  // Cards show less when small: fully zoomed out, just the name, large (level 1); fully zoomed in, the
  // detailed design (level 4) with years and age.
  check(await page.locator('.tree-world').getAttribute('data-detail') === '1', `[${name}] zoomed out, cards are not the name design`);
  check((await page.locator('.tree-card-focus').innerText()).trim() === 'Ravi', `[${name}] the zoomed-out focus card doesn't show just the first name`);
  for (let i = 0; i < 14; i++) { await page.getByRole('button', { name: 'Zoom in' }).click(); await page.waitForTimeout(120); } // each click animates
  await page.waitForTimeout(500);
  const zin = await page.evaluate(() => [document.querySelector('.tree-world').dataset.detail, document.querySelector('.tree-world').style.transform]);
  check(zin[0] === '4', `[${name}] zoomed in, cards are not the detailed design (${zin.join(' ')})`);
  check(/Ravi Rao[\s\S]*b\. 1988 · \d+/.test(await page.locator('.tree-card-focus').innerText()), `[${name}] the detailed focus card lacks full name or age`);
  await page.getByRole('button', { name: 'Fit the whole tree' }).click();
  await page.waitForTimeout(400);
  await implodeCheck('Everyone');
  await page.getByRole('radio', { name: 'Extended' }).click();
  await page.waitForTimeout(600);
  await implodeCheck('Extended');
  if (page.viewportSize().width < 768) {
    // Opening intro (phones, cross layout): the first Family Tree view starts imploded and explodes into
    // the tree.
    // The app skips it under automation; this one reload pretends not to be automated.
    await page.addInitScript(() => { if (sessionStorage.getItem('smoke-intro')) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
    await page.evaluate(() => sessionStorage.setItem('smoke-intro', '1'));
    const p2 = page; // already on the Family Tree
    await p2.reload();
    await p2.waitForSelector('.tree-world [data-key]');
    const start = await p2.evaluate(() => ({
      moved: [...document.querySelectorAll('.tree-world [data-key]')].filter((e) => e.style.transform).length,
      lines: document.querySelector('.tree-edges')?.style.opacity,
    }));
    check(start.moved > 0 && start.lines === '0', `[${name}] Family Tree did not open imploded (${JSON.stringify(start)})`);
    check(await p2.getByRole('radio', { name: 'Extended', checked: true }).count() === 1, `[${name}] Family Tree did not open at Extended`);
    const ok = await p2.waitForFunction(() => [...document.querySelectorAll('.tree-world [data-key]')].every((e) => !e.style.transform)
      && document.querySelector('.tree-edges').style.opacity === '', null, { timeout: 6000 }).then(() => true, () => false);
    check(ok, `[${name}] the opening intro did not explode into the tree`);
    await page.evaluate(() => sessionStorage.removeItem('smoke-intro')); // later reloads are automated again
  }
  await page.getByRole('radio', { name: 'Immediate' }).click();
  if (vw < 768) {
    // Phone: the bottom tabs slide away when idle; a tap on the tree only brings them back.
    const tabs = page.locator('nav.fixed');
    await page.waitForFunction(() => document.querySelector('nav.fixed')?.hasAttribute('data-hidden'), null, { timeout: 8000 });
    check(tb.height >= page.viewportSize().height - 1, `[${name}] tree does not reach the bottom (${tb.height})`);
    await page.locator('.tree-viewport button[title], .tree-viewport button').filter({ hasText: 'Ravi' }).first().click();
    await page.waitForTimeout(300);
    check(!(await tabs.getAttribute('data-hidden')), `[${name}] tap did not bring the tabs back`);
    check(!(await page.getByRole('dialog').count()), `[${name}] the tap that showed the tabs also opened a card`);
    await shot('2b-tabs-back');
  }
  await page.goto(BASE + '#/family?tab=relatives');
  await page.getByPlaceholder('Search relatives').waitFor();
  // Show in tree from the Relatives list opens Family Tree with that person highlighted.
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
  check(await page.getByRole('group', { name: 'Other parent' }).getByText('Anjali Rao').isVisible(), `[${name}] other parent not prefilled with the wife`);
  await shot('5b-add-son');
  // Contacts come up as suggestions (fictitious contacts loaded through the emulator-only hook).
  await page.evaluate(() => window.__lineageTestContacts([
    { resourceName: 'people/t1', names: [{ givenName: 'Contact', familyName: 'Cousin' }], phoneNumbers: [{ value: '+91 90000 77777' }] },
    { resourceName: 'people/t2', names: [{ givenName: 'Anjali', familyName: 'Rao' }] },
  ]));
  await page.getByPlaceholder('Search people or type a new name').fill('contact');
  await page.getByText('From your contacts').waitFor();
  check(await page.getByText('Contact Cousin').isVisible(), `[${name}] contact not suggested`);
  await page.getByPlaceholder('Search people or type a new name').fill('anjali');
  check(!(await page.getByText('From your contacts').count()), `[${name}] a contact already in the tree was suggested`);
  await page.getByPlaceholder('Search people or type a new name').fill('contact');
  await shot('5c-contact-suggestions');
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
  check(st.includes('Reload Lineage'), `[${name}] Settings has no "Reload Lineage"`);
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
