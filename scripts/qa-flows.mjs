// Exploratory QA flows (qa-tester). Serves dist/ with `vite preview`, drives real-user flows from a
// fresh database, saves screenshots, and fails on any page/console error or failed check.
// Usage: npm run build && node scripts/qa-flows.mjs [--out <dir>]   (default /tmp/lineage-qa)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const outIdx = process.argv.indexOf('--out');
const OUT = resolve(outIdx > 0 ? process.argv[outIdx + 1] : '/tmp/lineage-qa');
const PORT = 4191; // not 4190: that port is on the browsers' blocked list (ERR_UNSAFE_PORT)
const BASE = `http://localhost:${PORT}/`;
mkdirSync(OUT, { recursive: true });

// Run vite directly (not via npx) so kill() reaches the server and no orphan holds the port.
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { stdio: process.env.QA_DEBUG ? 'inherit' : 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const failures = [];
const passed = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); return cond; };

function watch(page, tag) {
  page.on('pageerror', (e) => failures.push(`[${tag}] page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`[${tag}] console error: ${m.text().slice(0, 300)}`));
}

async function flow(name, fn) {
  const before = failures.length;
  try { await fn(); } catch (e) { failures.push(`[${name}] crashed: ${e.message.split('\n')[0]}`); }
  if (failures.length === before) passed.push(name);
}

// ---------- helpers ----------
const body = (page) => page.locator('body').innerText();
const shot = (page, s) => page.screenshot({ path: join(OUT, `${s}.png`), fullPage: true });

async function addViaSheet(page, name) {
  await page.getByPlaceholder('Search people or type a new name').fill(name);
  await page.getByText(`Add “${name}”`).click();
  await page.getByPlaceholder('Search people or type a new name').waitFor({ state: 'detached' });
}
async function openProfile(page, fullName) {
  await page.goto(BASE + '#/');
  await page.getByPlaceholder(/Search names/).fill(fullName);
  await page.getByText(fullName, { exact: true }).first().click();
  await page.getByText('Connections').first().waitFor();
}
async function profileAdd(page, choice, name) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: choice, exact: true }).click();
  await addViaSheet(page, name);
}

// ---------- flows ----------
async function main(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'main');
  await page.goto(BASE);

  await flow('1 add self, parents via ghost cards, brother', async () => {
    await page.getByRole('button', { name: /Add yourself first/ }).click();
    await page.getByLabel('First name *').fill('Arun');
    await page.getByLabel('Last name / surname').fill('Kumar');
    await page.getByRole('button', { name: 'Male', exact: true }).click();
    check(await page.locator('input[type=checkbox]').first().isChecked(), '[1] "This is me" not pre-ticked from ?me=1');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByText('Connections').first().waitFor();

    await page.goto(BASE + '#/family');
    await page.getByRole('button', { name: 'Add father' }).click();
    await addViaSheet(page, 'Raj Kumar');
    await page.getByRole('button', { name: 'Add mother' }).click();
    const married = page.getByText('Married to Raj');
    check(await married.isVisible(), '[1] "Married to Raj" option missing when adding mother');
    await addViaSheet(page, 'Lata Kumar');
    await shot(page, '1a-tree-parents');

    await openProfile(page, 'Arun Kumar');
    await profileAdd(page, 'Brother', 'Vijay Kumar');
    await page.goto(BASE + '#/family');
    await page.getByText('Vijay K.').waitFor();
    const tree = await body(page);
    check(/Vijay K\.\s*Brother/.test(tree), '[1] brother card not labelled Brother in tree');
    // Brother card on the same row as me.
    const yMe = (await page.getByText('Arun K.').boundingBox()).y;
    const yBro = (await page.getByText('Vijay K.').boundingBox()).y;
    check(Math.abs(yMe - yBro) < 5, `[1] brother not beside me in tree (y ${yMe} vs ${yBro})`);
    await shot(page, '1b-tree-brother');
    await page.getByRole('button', { name: /Relatives \(/ }).click();
    const rel = await body(page);
    check(/Vijay Kumar[\s\S]{0,40}Brother/.test(rel), '[1] Vijay not "Brother" in Relatives');
    await shot(page, '1c-relatives');
    await openProfile(page, 'Vijay Kumar');
    const vp = await body(page);
    check(/Raj Kumar\s*Father/.test(vp) && /Lata Kumar\s*Mother/.test(vp), '[1] brother does not share parents');
    check(/Arun Kumar\s*Brother/.test(vp), '[1] brother profile does not list Arun as Brother');
  });

  await flow('2 wife + son with "Also <wife>\'s son"', async () => {
    await openProfile(page, 'Arun Kumar');
    await profileAdd(page, 'Wife', 'Meena Kumar');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Son', exact: true }).click();
    const cb = page.getByText('Also Meena’s son');
    check(await cb.isVisible(), '[2] "Also Meena’s son" checkbox missing');
    check(await page.locator('label', { hasText: 'Also Meena’s son' }).locator('input').isChecked(), '[2] co-parent checkbox not default on');
    await addViaSheet(page, 'Rohan Kumar');
    await openProfile(page, 'Rohan Kumar');
    const rp = await body(page);
    check(/Arun Kumar\s*Father/.test(rp) && /Meena Kumar\s*Mother/.test(rp), '[2] son is not wife\'s child');
    check(/Raj Kumar\s*Grandfather/.test(rp), '[2] son missing grandfather');
    await page.goto(BASE + '#/family');
    await page.getByText('Rohan K.').waitFor();
    await shot(page, '2-tree-son');
  });

  await flow('friend never appears in My Family', async () => {
    await openProfile(page, 'Arun Kumar');
    await profileAdd(page, 'Friend', 'Sunil Friend');
    await page.goto(BASE + '#/family');
    await page.getByRole('button', { name: /Relatives \(/ }).click();
    check(!(await body(page)).includes('Sunil'), '[friend] friend leaked into My Family');
  });

  // Give existing people typed details to test non-overwrite.
  await flow('3 import vcf + csv, duplicates matched, typed fields kept', async () => {
    await openProfile(page, 'Raj Kumar');
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Nickname / pet name').fill('Rajanna');
    await page.getByLabel('Born').fill('1960');
    await page.getByLabel('Occupation').fill('Farmer');
    await page.getByText('Add phone').click();
    await page.getByPlaceholder('Phone', { exact: true }).fill('98480 12345');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByText('Connections').first().waitFor();

    const dir = join(OUT, 'files');
    mkdirSync(dir, { recursive: true });
    const vcf = join(dir, 'contacts.vcf');
    writeFileSync(vcf, [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Rajesh K', 'N:K;Rajesh;;;', 'NICKNAME:Raju', 'TEL;TYPE=CELL:+91 9848012345',
      'BDAY:1961-02-03', 'TITLE:Retired', 'EMAIL:raj@example.com', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Kavya Rao', 'N:Rao;Kavya;;;', 'TEL:+91-90000-11111', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Deepak Shah', 'N:Shah;Deepak;;;', 'EMAIL:deepak@example.com', 'ORG:Acme', 'END:VCARD', '',
    ].join('\r\n'));
    const csv = join(dir, 'google.csv');
    writeFileSync(csv, [
      'Name,Given Name,Family Name,Nickname,Birthday,Notes,Phone 1 - Type,Phone 1 - Value,E-mail 1 - Type,E-mail 1 - Value,Organization 1 - Name',
      'Vijay Kumar,Vijay,Kumar,Viju,1990-05-05,from csv,Mobile,+91 77777 88888,* Home,vijay@example.com,Infosys',
      'Nisha Patel,Nisha,Patel,,,,Mobile,099999 22222,,,',
      '"Gupta, Anil",Anil,Gupta,,,"multi, comma note",Work,+1 (415) 555-0100 ::: +1 415 555 0199,,,',
    ].join('\n'));

    await page.goto(BASE + '#/import');
    await page.locator('input[type=file]').setInputFiles(vcf);
    await page.getByText(/found ·/).waitFor();
    const iv = await body(page);
    check(/3 found · 2 new · 1 already known/.test(iv), `[3] vcf summary wrong: ${iv.match(/\d+ found[^\n]*/)?.[0]}`);
    check(/Matches Raj Kumar/.test(iv), '[3] +91 phone did not match Raj Kumar');
    await shot(page, '3a-import-vcf');
    await page.getByRole('button', { name: /^Import \d/ }).click();
    await page.getByText(/Added 2 new people, filled in details for 1/).waitFor();

    await page.locator('input[type=file]').setInputFiles(csv);
    await page.getByText(/found ·/).waitFor();
    const ic = await body(page);
    check(/3 found · 2 new · 1 already known/.test(ic), `[3] csv summary wrong: ${ic.match(/\d+ found[^\n]*/)?.[0]}`);
    check(/(Matches|Possibly) Vijay Kumar/.test(ic), '[3] CSV row did not match Vijay Kumar by name');
    await shot(page, '3b-import-csv');
    await page.getByRole('button', { name: /^Import \d/ }).click();
    await page.getByText(/Added 2 new/).waitFor();

    // Re-import vcf: everything should match now.
    await page.locator('input[type=file]').setInputFiles(vcf);
    await page.getByText(/found ·/).waitFor();
    check(/3 found · 0 new · 3 already known/.test(await body(page)), '[3] re-import did not match all 3');
    await page.getByRole('button', { name: 'Cancel' }).click();
    check(await page.locator('nav a[aria-current=page]', { hasText: 'Import' }).count() > 0, '[3] Import nav item not active on Import page');

    await openProfile(page, 'Raj Kumar');
    const rp = await body(page);
    check(rp.includes('“Rajanna”') && !rp.includes('Raju'), '[3] nickname overwritten by import');
    check(/Born 1960/.test(rp), '[3] birth year overwritten by import');
    check(rp.includes('Farmer'), '[3] occupation overwritten');
    check(rp.includes('raj@example.com'), '[3] email gap not filled from vcf');
    check((rp.match(/98480|9848012345/g) || []).length === 1, '[3] duplicate phone added (same number, different format)');
    await shot(page, '3c-raj-after-import');
    await openProfile(page, 'Vijay Kumar');
    const vj = await body(page);
    check(vj.includes('vijay@example.com') && vj.includes('Infosys'), '[3] CSV did not fill gaps for Vijay');
    await openProfile(page, 'Anil Gupta');
    const an = await body(page);
    check(an.includes('555-0100') && an.includes('555 0199'), '[3] ::: multi-phone not split');
  });

  await flow('4 edit, unlink, delete', async () => {
    await openProfile(page, 'Vijay Kumar');
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Occupation').fill('Pilot');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByText('Pilot').first().waitFor();

    await openProfile(page, 'Arun Kumar');
    const row = page.locator('.group\\/row', { hasText: 'Meena Kumar' });
    await row.getByRole('button', { name: 'Remove link' }).click();
    await row.getByRole('button', { name: 'Unlink' }).click();
    await page.waitForTimeout(300);
    const ap = await body(page);
    check(!/Meena Kumar\s*Wife/.test(ap), '[4] wife still shown after unlink');
    check(/Rohan Kumar\s*Son/.test(ap), '[4] son lost after unlinking wife');
    await shot(page, '4a-after-unlink');

    await openProfile(page, 'Meena Kumar');
    const url = page.url();
    await page.getByRole('button', { name: /Delete Meena/ }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForURL((u) => u.hash === '#/');
    await page.getByText('Arun Kumar').first().waitFor();
    const gone = await page.waitForFunction(() => !document.body.innerText.includes('Meena'), null, { timeout: 3000 }).then(() => true, () => false);
    if (!check(gone, '[4] deleted person still listed')) await shot(page, '4-FAIL-people-after-delete');
    await page.goto(url);
    check((await body(page)).includes('doesn’t exist'), '[4] deleted profile URL has no friendly message');
    await openProfile(page, 'Rohan Kumar');
    const rp = await body(page);
    check(!rp.includes('Meena') && /Arun Kumar\s*Father/.test(rp), '[4] orphan reference to deleted mother');
    await page.goto(BASE + '#/family');
    await page.getByText('Rohan K.').waitFor();
    await shot(page, '4b-tree-after-delete');
    await page.goBack();
  });

  await flow('5 backup, delete all, restore (replace)', async () => {
    await page.goto(BASE + '#/settings');
    const before = (await body(page)).match(/(\d+) people and (\d+) relationships/);
    const dl = page.waitForEvent('download');
    await page.getByText('Download backup').click();
    const d = await dl;
    const path = join(OUT, 'files', d.suggestedFilename());
    await d.saveAs(path);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    check(json.app === 'lineage' && json.people.length === Number(before[1]), '[5] backup content mismatch');
    await page.getByText('Delete all data').click();
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await page.getByText('All data deleted.').waitFor();
    check(/0 people and 0 relationships/.test(await body(page)), '[5] delete all did not clear');
    await page.locator('input[accept*=json]').setInputFiles(path);
    await page.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByText('Backup restored.').waitFor();
    const after = (await body(page)).match(/(\d+) people and (\d+) relationships/);
    check(after[0] === before[0], `[5] restore mismatch: ${before[0]} vs ${after[0]}`);
    await page.goto(BASE + '#/family');
    const ok = await page.getByText('Rohan K.').waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!check(ok, '[5] tree empty after restore')) await shot(page, '5-FAIL-family-after-restore');
    // Merge restore on top of existing should be idempotent.
    await page.goto(BASE + '#/settings');
    await page.locator('input[accept*=json]').setInputFiles(path);
    await page.getByRole('button', { name: 'Merge with current' }).click();
    await page.getByText('Backup restored.').waitFor();
    check((await body(page)).includes(before[0]), '[5] merge restore duplicated data');
    await shot(page, '5-settings-restored');
  });

  await ctx.close();
}

async function dark(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  watch(page, 'dark');
  await flow('6 dark mode + very long name', async () => {
    await page.goto(BASE);
    await page.getByText('Try a sample family').click();
    await page.getByText('Ravi Rao').first().waitFor();
    await shot(page, '6a-dark-people');
    await openProfile(page, 'Ravi Rao');
    const LONG = 'Venkatasubrahmanya Lakshminarasimha Chakravarthy-Ramanujam Iyengar';
    await profileAdd(page, 'Brother', LONG);
    await shot(page, '6b-dark-profile');
    await page.getByText('Venkatasubrahmanya').first().click();
    await page.getByText('Connections').first().waitFor();
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ov <= 0, `[6] long name causes horizontal page scroll (${ov}px)`);
    await shot(page, '6c-dark-longname-profile');
    await page.goto(BASE + '#/family');
    await page.getByText('Earliest ancestor').waitFor();
    await shot(page, '6d-dark-tree');
    await page.goto(BASE + '#/');
    const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ov2 <= 0, `[6] long name overflows People list (${ov2}px)`);
    await shot(page, '6e-dark-people-long');
  });
  await ctx.close();
}

// Merge duplicates, regional family terms and the GEDCOM round-trip, on the sample family.
async function features(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'features');
  const relCount = async () => (await body(page)).match(/(\d+) people and (\d+) relationships/);
  await page.goto(BASE);
  await page.getByText('Try a sample family').click();
  await page.getByText('Ravi Rao').first().waitFor();

  await flow('7 merge duplicate Prakash, parent merge allowed, cycle refused', async () => {
    await page.goto(BASE + '#/people/new');
    await page.getByLabel('First name *').fill('Prakash');
    await page.getByLabel('Last name / surname').fill('Rao');
    await page.getByLabel('Born').fill('1962');
    await page.getByText('Add phone').click();
    await page.getByPlaceholder('Phone', { exact: true }).fill('98765 43210');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByText('Connections').first().waitFor();
    await profileAdd(page, 'Daughter', 'Latha Rao');
    await page.goto(BASE + '#/');
    await page.getByPlaceholder(/Search names/).fill('Prakash');
    await page.locator('a', { hasText: 'Prakash' }).filter({ hasText: 'fertiliser' }).first().click();
    await page.getByText('Connections').first().waitFor();
    await page.getByRole('button', { name: /Merge with a duplicate/ }).click();
    const dlg = page.getByRole('dialog');
    const sug = dlg.getByRole('button', { name: /Prakash Rao/ });
    check(/Possible duplicates[\s\S]*Same name/i.test(await dlg.innerText()), '[7] duplicate not suggested');
    await sug.first().click();
    await dlg.getByText(/relationship will move/).waitFor();
    const pv = await dlg.innerText();
    check(/Birth date: 1961 kept, 1962 dropped/.test(pv), '[7] preview missing birth-date conflict');
    await shot(page, '7a-merge-preview');
    await dlg.getByRole('button', { name: /Merge into/ }).click();
    await dlg.waitFor({ state: 'detached' });
    const pp = await body(page);
    check(pp.includes('98765 43210'), '[7] phone not carried over');
    check(/Born 1961/.test(pp), '[7] kept birth year lost');
    check(/Latha Rao\s*Daughter/.test(pp) && /Kiran Rao\s*Son/.test(pp) && /Venkata Rao[\s\S]{0,30}Father/.test(pp), '[7] relationships lost after merge');
    await page.goto(BASE + '#/');
    await page.getByPlaceholder(/Search names/).fill('Prakash');
    await page.waitForTimeout(300);
    check(await page.getByText('Prakash Rao', { exact: true }).count() === 1, '[7] duplicate still listed');
    await openProfile(page, 'Ravi Rao');
    check(/Prakash Rao\s*Uncle/.test(await body(page)), '[7] Ravi lost uncle Prakash');
    await page.goto(BASE + '#/family');
    await page.getByText('Earliest ancestor').waitFor();
    await shot(page, '7b-tree-after-merge');

    // Cycle: keeping Aarav (Kiran's son) and dropping great-grandparent Venkata must be refused.
    await openProfile(page, 'Aarav Rao');
    await page.getByRole('button', { name: /Merge with a duplicate/ }).click();
    await dlg.getByLabel('Search people').fill('Venkata');
    await dlg.getByRole('button', { name: /Venkata Rao/ }).first().click();
    await dlg.getByText('Merging would make someone their own ancestor.').waitFor();
    check(await dlg.getByRole('button', { name: /Merge into/ }).isDisabled(), '[7] merge button enabled on cycle');
    await shot(page, '7c-merge-cycle-refused');
    await dlg.getByRole('button', { name: 'Close' }).click();

    // A person with their own parent is allowed (the link between them is dropped).
    await openProfile(page, 'Aarav Rao');
    await page.getByRole('button', { name: /Merge with a duplicate/ }).click();
    await dlg.getByLabel('Search people').fill('Kiran');
    await dlg.getByRole('button', { name: /Kiran Rao/ }).first().click();
    await dlg.getByText(/1 duplicate link removed/).waitFor();
    await dlg.getByRole('button', { name: /Merge into/ }).click();
    await dlg.waitFor({ state: 'detached' });
    const ap = await body(page);
    check(/Prakash Rao\s*Father/.test(ap) && /Also known as\s*Kiran Rao/i.test(ap) && !/Kiran Rao\s*Father/.test(ap), '[7] parent merge result wrong: ' + ap.slice(0, 600).replace(/\n/g, ' | '));
  });

  await flow('8 Hindi/Telugu family terms', async () => {
    await page.goto(BASE + '#/settings');
    await page.getByRole('radio', { name: 'Hindi' }).click();
    const expectHi = { 'Prakash Rao': 'Uncle · Chacha', 'Suresh Gupta': 'Uncle · Mama', 'Kamala Gupta': 'Grandmother · Nani', 'Divya Sharma': 'Sister · Didi' };
    for (const [n, t] of Object.entries(expectHi)) {
      await openProfile(page, n);
      check((await body(page)).includes(t), `[8] ${n} chip not "${t}"`);
    }
    await openProfile(page, 'Sandeep Kumar');
    check(!/ · (Chacha|Mama|Bhai|Dost)/.test(await body(page)), '[8] friend got a family term');
    await openProfile(page, 'Ravi Rao');
    check(/Kamala Gupta\s*Grandmother · Nani/.test(await body(page)), '[8] connection row lacks term');
    await page.goto(BASE + '#/family');
    await page.getByText('Earliest ancestor').waitFor();
    // Tree cards lead with the regional term, English label muted after it ("Pitaji · Father",
    // or on two lines when there is no lifespan). Elsewhere it stays "Father · Pitaji".
    const card = (await page.locator('button[title*="Pitaji"]').first().innerText()).replace(/\s+/g, ' ');
    check(/Pitaji( ·)? Father/.test(card) && !/Father · Pitaji/.test(card), `[8] tree card not term-first: "${card}"`);
    await page.getByRole('button', { name: /Relatives \(/ }).click();
    const rl = await body(page);
    check(/Uncle · Mama · Mother's brother/.test(rl) && /Uncle · Chacha · Father's brother/.test(rl), '[8] Relatives list lacks terms');
    await shot(page, '8a-relatives-hindi');
    await page.goto(BASE + '#/settings');
    await page.getByRole('radio', { name: 'Telugu' }).click();
    await page.reload();
    await page.getByRole('radio', { name: 'Telugu' }).waitFor();
    check(await page.getByRole('radio', { name: 'Telugu' }).getAttribute('aria-checked') === 'true', '[8] Telugu not persisted');
    const expectTe = { 'Prakash Rao': 'Uncle · Babai', 'Suresh Gupta': 'Uncle · Mavayya', 'Kamala Gupta': 'Grandmother · Ammamma' };
    for (const [n, t] of Object.entries(expectTe)) {
      await openProfile(page, n);
      check((await body(page)).includes(t), `[8] ${n} chip not "${t}"`);
    }
    await shot(page, '8b-kamala-telugu');
  });

  await flow('9 GEDCOM export, delete all, re-import; hand-written ABT/PEDI', async () => {
    const dir = join(OUT, 'files');
    mkdirSync(dir, { recursive: true });
    await page.goto(BASE + '#/settings');
    const before = await relCount();
    await page.goto(BASE + '#/import');
    const save = async (text) => {
      const dl = page.waitForEvent('download');
      await page.getByText(text).click();
      const d = await dl;
      const path = join(dir, d.suggestedFilename());
      await d.saveAs(path);
      return path;
    };
    const radio = (n) => page.getByRole('radio', { name: n });
    check(await radio(/Family tree only \(safe to share\)/).getAttribute('aria-checked') === 'true', '[9] export Contents not defaulting to "safe to share"');
    const famPath = await save('Download my family tree (.ged)');
    check(!/-private/.test(famPath), `[9] safe export has -private suffix: ${famPath}`);
    const fam = readFileSync(famPath, 'utf8');
    check(/^1 _LINEAGE_ME Y\s*$/m.test(fam), '[9] export lacks _LINEAGE_ME Y');
    check(/^0 HEAD/.test(fam) && /0 TRLR\s*$/.test(fam), '[9] .ged missing HEAD/TRLR');
    check(!/Sandeep|Farhan|Priya|Venu|Harish/.test(fam), '[9] friend exported in family tree .ged');
    check(!/98480|PHON/.test(fam), '[9] phone in "safe to share" export');
    const allSafe = readFileSync(await save(/Download everyone/), 'utf8');
    check(allSafe.includes('Sandeep'), '[9] "everyone" export missing friends');
    check(!/98480|PHON/.test(allSafe), '[9] phone in "safe to share" everyone export');
    await radio(/Everything \(private backup\)/).click();
    check(await radio(/Everything/).getAttribute('aria-checked') === 'true', '[9] full Contents option not selected');
    const allPath = await save(/Download everyone/);
    check(/-private\.ged$/.test(allPath), `[9] full export lacks -private suffix: ${allPath}`);
    check(/98480/.test(readFileSync(allPath, 'utf8')), '[9] full export missing phone numbers');
    const famIndi = (fam.match(/^0 @[^@]+@ INDI/gm) || []).length;

    await page.goto(BASE + '#/settings');
    await page.getByText('Delete all data').click();
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await page.getByText('All data deleted.').waitFor();
    await page.goto(BASE + '#/import');
    await page.locator('input[type=file]').setInputFiles(famPath);
    await page.getByText('Family tree ready to import').waitFor();
    const pv = await body(page);
    check(pv.includes(`${famIndi} people`), '[9] import preview count mismatch');
    check(pv.includes('Re-importing a file adds everyone again — use Merge on a person’s page to combine duplicates.'), '[9] GEDCOM summary card text missing');
    await page.getByRole('button', { name: /^Import \d/ }).click();
    await page.getByText(/Added \d+ new people/).waitFor();
    await page.goto(BASE + '#/settings');
    const after = await relCount();
    check(Number(after[1]) === famIndi && Number(after[1]) < Number(before[1]), `[9] people after import ${after[0]}`);
    await page.goto(BASE + '#/family');
    // _LINEAGE_ME restores "me": no "Who are you?" picker after wipe + re-import.
    await page.getByText(/Earliest ancestor|Who are you\?/).first().waitFor();
    const fb = await body(page);
    check(!/Who are you\?/.test(fb), '[9] "Who are you?" picker shown — me not restored from _LINEAGE_ME');
    check(/Ravi R\.\s*You/.test(fb), '[9] Ravi not the tree ego after import');
    check(/5\s*Generations/.test(fb), '[9] generations not restored');
    check(/Anjali R\.\s*(Bharya · )?Wife/.test(fb) && /Ammamma(\s*·)?\s*Grandmother/.test(fb), '[9] spouse/kinship labels missing after import: ' + fb.replace(/\n/g, ' | ').slice(0, 300));
    await shot(page, '9a-tree-after-ged');
    await openProfile(page, 'Prakash Rao');
    check(/Uncle · Babai/.test(await body(page)), '[9] Prakash not uncle after import');

    const hand = join(dir, 'hand.ged');
    writeFileSync(hand, ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
      '0 @I1@ INDI', '1 NAME Gopal /Iyer/', '1 SEX M', '1 BIRT', '2 DATE ABT 1940', '1 FAMS @F1@',
      '0 @I2@ INDI', '1 NAME Meenakshi /Iyer/', '1 SEX F', '1 FAMS @F1@',
      '0 @I3@ INDI', '1 NAME Ramesh /Iyer/', '1 SEX M', '1 FAMC @F1@',
      '0 @I4@ INDI', '1 NAME Lakshmi /Iyer/', '1 SEX F', '1 BIRT', '2 DATE ABT JUN 1975', '1 FAMC @F1@', '2 PEDI adopted',
      '0 @I5@ INDI', '1 NAME Venkat /Iyer/', '1 SEX M', '1 BIRT', '2 DATE 1910', '1 DEAT', '2 DATE BEF 2010', '1 FAMC @F2@',
      '0 @F2@ FAM', '1 CHIL @I1@', '1 CHIL @I5@',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I4@', '0 TRLR', ''].join('\n'));
    await page.goto(BASE + '#/import');
    await page.locator('input[type=file]').setInputFiles(hand);
    await page.getByText('Family tree ready to import').waitFor();
    await page.getByRole('button', { name: /^Import \d/ }).click();
    await page.getByText(/Added 5 new people/).waitFor();
    await openProfile(page, 'Lakshmi Iyer');
    const lk = await body(page);
    check(/Gopal Iyer[\s\S]{0,20}Adoptive father/.test(lk) && /Ramesh Iyer\s*Brother/.test(lk), '[9] PEDI adopted not imported');
    check(/about Jun 1975/.test(lk), '[9] ABT date qualifier lost');
    await shot(page, '9b-adopted-child');
    // DEAT BEF 2010: deceased, but no exact death date, so no "Lived N years".
    await openProfile(page, 'Venkat Iyer');
    const vk = await body(page);
    check(!/Lived \d+ years/.test(vk), '[9] BEF death date treated as exact: "Lived N years" shown');
    check(/Passed away/.test(vk), '[9] DEAT BEF 2010 did not mark Venkat deceased');
    await shot(page, '9c-death-before');
  });
  await ctx.close();
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  await main(browser);
  await dark(browser);
  await features(browser);
  await browser.close();
} catch (e) {
  failures.push('crashed: ' + e.message);
}
stop();
console.log('PASSED FLOWS:\n' + passed.map((p) => ' + ' + p).join('\n'));
if (failures.length) {
  console.error('QA FAILED\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log(`QA PASSED — screenshots in ${OUT}/`);
