// Exploratory QA flows (qa-tester) against the Firebase emulators: signs in, drives real-user flows
// on fresh families, checks sharing between two accounts, saves screenshots, and fails on any
// page/console error or failed check. Builds its own emulator bundle (see emu.mjs).
// Usage: node scripts/qa-flows.mjs [--out <dir>]   (default /tmp/lineage-qa)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { EXPECTED_CONSOLE, signIn, startStack, stopAll } from './emu.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const outIdx = process.argv.indexOf('--out');
const OUT = resolve(outIdx > 0 ? process.argv[outIdx + 1] : '/tmp/lineage-qa');
const PORT = 4191; // not 4190: that port is on the browsers' blocked list (ERR_UNSAFE_PORT)
let BASE = '';
mkdirSync(OUT, { recursive: true });

const failures = [];
const passed = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); return cond; };

function watch(page, tag) {
  page.on('pageerror', (e) => failures.push(`[${tag}] page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !EXPECTED_CONSOLE.some((re) => re.test(m.text())) && failures.push(`[${tag}] console error: ${m.text().slice(0, 300)}`));
}

async function flow(name, fn) {
  const before = failures.length;
  try { await fn(); } catch (e) {
    const where = (e.message.match(/waiting for (.*)/) ?? [])[1];
    failures.push(`[${name}] crashed: ${e.message.split('\n')[0]}${where ? ` (waiting for ${where})` : ''}`);
  }
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
  await page.getByRole('heading', { name: /^Family\b/ }).first().waitFor();
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
  await signIn(page, BASE, 'arun@example.com', 'Arun Kumar');

  await flow('1 add self, parents via ghost cards, brother (as the parents\' son)', async () => {
    await page.getByRole('button', { name: /Add yourself first/ }).click();
    await page.getByLabel('First name *').fill('Arun');
    await page.getByLabel('Last name / surname').fill('Kumar');
    await page.getByRole('button', { name: 'Male', exact: true }).click();
    check(await page.locator('input[type=checkbox]').first().isChecked(), '[1] "This is me" not pre-ticked from ?me=1');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByRole('heading', { name: /^Family\b/ }).first().waitFor();

    await page.goto(BASE + '#/family');
    await page.getByRole('button', { name: 'Add father' }).click();
    await addViaSheet(page, 'Raj Kumar');
    await page.getByRole('button', { name: 'Add mother' }).click();
    const married = page.getByText('Married to Raj');
    check(await married.isVisible(), '[1] "Married to Raj" option missing when adding mother');
    await addViaSheet(page, 'Lata Kumar');
    await shot(page, '1a-tree-parents');

    // There is no "Brother" option (kept simple on purpose): a brother is the parents' son.
    await openProfile(page, 'Arun Kumar');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    check(!(await page.getByRole('button', { name: 'Brother', exact: true }).count()), '[1] "Brother" option should be gone');
    check(!(await page.getByRole('button', { name: 'Sister', exact: true }).count()), '[1] "Sister" option should be gone');
    await page.keyboard.press('Escape');
    await openProfile(page, 'Raj Kumar');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Son', exact: true }).click();
    check(await page.getByRole('group', { name: 'Other parent' }).getByText('Lata Kumar').isVisible(), '[1] other parent not prefilled with Lata');
    await addViaSheet(page, 'Vijay Kumar');
    await page.goto(BASE + '#/family');
    await page.getByText('Vijay K.').waitFor();
    const tree = await body(page);
    check(/Vijay K\.\s*Brother/.test(tree), '[1] brother card not labelled Brother in tree');
    // Brother card on the same row as me (measured once the cards stop moving: the tree animates changes).
    const settled = async () => {
      let last = '';
      for (let i = 0; i < 20; i++) {
        const now = JSON.stringify([await page.getByText('Arun K.').boundingBox(), await page.getByText('Vijay K.').boundingBox()]);
        if (now === last) return;
        last = now;
        await page.waitForTimeout(100);
      }
    };
    await settled();
    const yMe = (await page.getByText('Arun K.').boundingBox()).y;
    const yBro = (await page.getByText('Vijay K.').boundingBox()).y;
    check(Math.abs(yMe - yBro) < 5, `[1] brother not beside me in tree (y ${yMe} vs ${yBro})`);
    await shot(page, '1b-tree-brother');
    await page.goto(BASE + '#/'); await page.getByRole('button', { name: /Relatives \(/ }).click(); await page.getByPlaceholder('Search relatives').waitFor(); await page.waitForFunction(() => document.querySelectorAll('section h3').length > 0);
    const rel = await body(page);
    check(/Vijay Kumar[\s\S]{0,40}Brother/.test(rel), '[1] Vijay not "Brother" in Relatives');
    await shot(page, '1c-relatives');
    await openProfile(page, 'Vijay Kumar');
    const vp = await body(page);
    check(/Raj Kumar\s*Father/.test(vp) && /Lata Kumar\s*Mother/.test(vp), '[1] brother does not share parents');
    check(/Arun Kumar\s*Brother/.test(vp), '[1] brother profile does not list Arun as Brother');
  });

  await flow('2 wife + son: the wife is the other parent (prefilled)', async () => {
    await openProfile(page, 'Arun Kumar');
    await profileAdd(page, 'Wife', 'Meena Kumar');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Son', exact: true }).click();
    check(await page.getByRole('group', { name: 'Other parent' }).getByText('Meena Kumar').isVisible(), '[2] other parent not prefilled with Meena');
    await addViaSheet(page, 'Rohan Kumar');
    await openProfile(page, 'Rohan Kumar');
    const rp = await body(page);
    check(/Arun Kumar\s*Father/.test(rp) && /Meena Kumar\s*Mother/.test(rp), '[2] son is not wife\'s child');
    check(/Raj Kumar\s*Grandfather/.test(rp), '[2] son missing grandfather');
    await page.goto(BASE + '#/family');
    await page.getByText('Rohan K.').waitFor();
    await shot(page, '2-tree-son');
    // A son picked from contact suggestions: created with the contact's phone, Meena as the other parent.
    await openProfile(page, 'Arun Kumar');
    await page.evaluate(() => window.__lineageTestContacts([{ resourceName: 'people/q1', names: [{ givenName: 'Dev', familyName: 'Kumar' }], phoneNumbers: [{ value: '+91 90000 55555' }] }]));
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Son', exact: true }).click();
    await page.getByPlaceholder('Search people or type a new name').fill('dev');
    await page.getByText('Dev Kumar').click();
    await openProfile(page, 'Dev Kumar');
    const dp = await body(page);
    check(dp.includes('90000 55555') && /Meena Kumar\s*Mother/.test(dp), '[2] contact suggestion not added with phone and mother');
  });

  await flow('family only: no friends, colleagues or circles anywhere', async () => {
    await openProfile(page, 'Arun Kumar');
    const pr = await body(page);
    check(!/Connections|Friends|Colleagues|Same city|How you know them/.test(pr), '[family-only] profile shows non-family sections');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sh = await body(page);
    check(!/Friend|Colleague|Classmate|Neighbour|Acquaintance|Social/.test(sh), '[family-only] add sheet offers non-family links');
    await page.keyboard.press('Escape');
    await page.goto(BASE);
    check(!/Friends & others/.test(await body(page)), '[family-only] people list has a friends filter');
  });

  // Give existing people typed details to test non-overwrite.
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

  await flow('5 no way to delete the whole tree', async () => {
    await page.goto(BASE + '#/settings');
    const st = await body(page);
    check(!/Download backup|Restore from backup|Sync now/.test(st), '[5] Settings still offers backup or sync');
    check(!/Delete all data|Delete everything/.test(st), '[5] Settings still offers Delete all data');
  });

  await ctx.close();
}

async function dark(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  watch(page, 'dark');
  await flow('6 dark mode + very long name', async () => {
    await signIn(page, BASE, 'dark@example.com', 'Dark Mode');
    await page.getByText('Try a sample family').click();
    await page.getByText('Ravi Rao').first().waitFor();
    await shot(page, '6a-dark-people');
    await openProfile(page, 'Ravi Rao');
    const LONG = 'Venkatasubrahmanya Lakshminarasimha Chakravarthy-Ramanujam Iyengar';
    await profileAdd(page, 'Son', LONG);
    await shot(page, '6b-dark-profile');
    await page.getByText('Venkatasubrahmanya').first().click();
    await page.getByRole('heading', { name: /^Family\b/ }).first().waitFor();
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ov <= 0, `[6] long name causes horizontal page scroll (${ov}px)`);
    await shot(page, '6c-dark-longname-profile');
    await page.goto(BASE + '#/family');
    await page.getByPlaceholder('Find in tree').waitFor();
    await shot(page, '6d-dark-tree');
    await page.goto(BASE + '#/');
    const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(ov2 <= 0, `[6] long name overflows People list (${ov2}px)`);
    await shot(page, '6e-dark-people-long');
  });
  await ctx.close();
}

// Merge duplicates and regional family terms, on the sample family.
async function features(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'features');
  await signIn(page, BASE, 'ravi@example.com', 'Ravi Rao');
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
    await page.getByRole('heading', { name: /^Family\b/ }).first().waitFor();
    // No spouse yet: the other parent must be chosen before the daughter can be added.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Daughter', exact: true }).click();
    await page.getByPlaceholder('Search people or type a new name').fill('Latha Rao');
    check(await page.getByRole('button', { name: /Add “Latha Rao”/ }).isDisabled(), '[7] daughter could be added without the other parent');
    await page.getByLabel("Other parent's name").fill('Sita Rao');
    await page.getByText('Add “Sita Rao” as the other parent').click();
    await page.getByText('Add “Latha Rao”').click();
    await page.getByText('Latha Rao').first().waitFor();
    await page.goto(BASE + '#/');
    await page.getByPlaceholder(/Search names/).fill('Prakash');
    await page.locator('a', { hasText: 'Prakash' }).filter({ hasText: 'fertiliser' }).first().click();
    await page.getByRole('heading', { name: /^Family\b/ }).first().waitFor();
    await page.getByRole('button', { name: /Merge with a duplicate/ }).click();
    const dlg = page.getByRole('dialog');
    const sug = dlg.getByRole('button', { name: /Prakash Rao/ });
    check(/Possible duplicates[\s\S]*Same name/i.test(await dlg.innerText()), '[7] duplicate not suggested');
    await sug.first().click();
    await dlg.getByText(/relationships? will move/).waitFor();
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
    await page.getByPlaceholder('Find in tree').waitFor();
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
    await openProfile(page, 'Ravi Rao');
    check(/Kamala Gupta\s*Grandmother · Nani/.test(await body(page)), '[8] connection row lacks term');
    await page.goto(BASE + '#/family');
    await page.getByPlaceholder('Find in tree').waitFor();
    // Tree cards lead with the regional term, English label muted after it ("Pitaji · Father",
    // or on two lines when there is no lifespan). Elsewhere it stays "Father · Pitaji".
    const card = (await page.locator('button[title*="Pitaji"]').first().innerText()).replace(/\s+/g, ' ');
    check(/Pitaji( ·)? Father/.test(card) && !/Father · Pitaji/.test(card), `[8] tree card not term-first: "${card}"`);
    await page.goto(BASE + '#/'); await page.getByRole('button', { name: /Relatives \(/ }).click(); await page.getByPlaceholder('Search relatives').waitFor(); await page.waitForFunction(() => document.querySelectorAll('section h3').length > 0);
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

  await ctx.close();
}

// Sharing: the owner invites a viewer and an editor (who must be in the tree with a phone number).
async function sharing(browser) {
  const ctx = (n) => browser.newContext({ viewport: { width: 1280, height: 860 } });
  const [oc, vc, ec] = await Promise.all([ctx(), ctx(), ctx()]);
  const owner = await oc.newPage();
  const viewer = await vc.newPage();
  const editor = await ec.newPage();
  watch(owner, 'owner');
  watch(viewer, 'viewer');
  watch(editor, 'editor');
  await flow('10 sharing: viewer reads only, editor must have a phone, edits show up live', async () => {
    await signIn(owner, BASE, 'owner@example.com', 'Ravi Rao');
    await owner.getByText('Try a sample family').click();
    await owner.getByText('Ravi Rao').first().waitFor();
    await owner.goto(BASE + '#/sharing');
    const email = owner.getByPlaceholder('name@gmail.com');
    // Viewer: email only.
    await email.fill('viewer@example.com');
    await owner.getByRole('button', { name: /Send invite/ }).click();
    await owner.getByText(/Invited viewer@example.com/).waitFor();
    // Editor: someone without a phone can't be picked to send; Kiran (has a phone) can.
    await owner.getByRole('radio', { name: /^Editor/ }).click();
    await email.fill('editor@example.com');
    await owner.getByLabel('Search your tree by name').fill('Ravi Rao');
    await owner.getByRole('button', { name: /Ravi Rao/ }).first().click();
    check(await owner.getByRole('button', { name: /Send invite/ }).isDisabled(), '[10] editor invite allowed for a person with no phone');
    await owner.getByRole('button', { name: 'Pick someone else' }).click();
    await owner.getByLabel('Search your tree by name').fill('Kiran');
    await owner.getByRole('button', { name: /Kiran Rao/ }).first().click();
    await owner.getByRole('button', { name: /Send invite/ }).click();
    await owner.getByText(/Invited editor@example.com/).waitFor();
    await shot(owner, '10a-owner-invites');

    await signIn(viewer, BASE, 'viewer@example.com', 'Vee Viewer');
    await viewer.getByRole('button', { name: 'Accept' }).click();
    await viewer.getByText(/Viewing/).first().waitFor();
    await viewer.goto(BASE + '#/');
    await viewer.getByText('Ravi Rao').first().waitFor();
    check(!(await viewer.getByLabel('Add person').count()), '[10] viewer offered "Add person"');
    await openProfile(viewer, 'Ravi Rao');
    check(!(await viewer.getByRole('link', { name: 'Edit' }).count()), '[10] viewer offered Edit');
    check(!(await viewer.getByRole('button', { name: 'Add', exact: true }).count()), '[10] viewer offered Add');
    await shot(viewer, '10b-viewer-profile');

    await signIn(editor, BASE, 'editor@example.com', 'Kiran Rao');
    await editor.getByRole('button', { name: 'Accept' }).click();
    await editor.getByText(/Viewing/).first().waitFor();
    await openProfile(editor, 'Ravi Rao');
    await profileAdd(editor, 'Son', 'Shared Kid');
    // The owner's open page picks it up live, without a reload.
    await owner.goto(BASE + '#/');
    const live = await owner.getByText('Shared Kid').first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check(live, '[10] editor\'s new relative did not reach the owner');
    const vlive = await viewer.goto(BASE + '#/').then(() => viewer.getByText('Shared Kid').first().waitFor({ timeout: 15_000 })).then(() => true, () => false);
    check(vlive, '[10] editor\'s new relative did not reach the viewer');
    await shot(owner, '10c-owner-sees-editor-change');

    // Admin page (owner only): the editor's new relative is counted against them.
    await owner.goto(BASE + '#/settings');
    await owner.getByRole('button', { name: /^Admin/ }).click();
    await owner.getByRole('heading', { name: 'Admin' }).waitFor();
    const row = owner.locator('[data-member="other"]').filter({ hasText: 'Kiran Rao' });
    const counted = await row.filter({ hasText: /1\s*New people/ }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check(counted, '[10] admin page does not count the editor\'s new person: ' + (await body(owner)).slice(0, 500).replace(/\n/g, ' | '));
    check(/Kiran Rao\s*added 1 person, added \d+ relationships?/.test(await body(owner)), '[10] admin recent changes missing the editor\'s save');
    await shot(owner, '10d-owner-admin');
    for (const [p, who] of [[editor, 'editor'], [viewer, 'viewer']]) {
      await p.goto(BASE + '#/settings');
      await p.getByRole('heading', { name: 'Settings' }).waitFor();
      check(!(await p.getByRole('button', { name: /^Admin/ }).count()), `[10] ${who} offered the Admin link`);
      await p.goto(BASE + '#/admin');
      await p.getByText('Only the family’s owner can see this page.').waitFor();
    }
  });
  await Promise.all([oc.close(), vc.close(), ec.close()]);
}

// Clean-up of older data: imported contacts that never became family are deleted on the owner's
// first load; linked ones (and people added by hand) stay. Seeded through the emulator's admin REST.
async function cleanup(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  watch(page, 'cleanup');
  await flow('11 old imported contacts never linked to the family are deleted, linked ones kept', async () => {
    const uid = await signIn(page, BASE, 'oldowner@example.com', 'Old Owner');
    const FS = `http://127.0.0.1:8080/v1/projects/demo-lineage/databases/(default)/documents/spaces/${uid}`;
    const val = (v) => typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v }
      : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
    const put = (coll, id, data, scope = 'private') => fetch(`${FS}/${coll}/${id}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: val({ id, ...data }), scope: val(scope), updatedAt: val(1), updatedBy: val(uid) } }),
    }).then((r) => { if (!r.ok) throw new Error('seed failed ' + r.status); });
    const P = (first, source, extra = {}) => ({ firstName: first, gender: 'unknown', phones: [], emails: [], work: [], education: [], facts: [], tags: [], createdAt: 1, updatedAt: 1, ...(source ? { source } : {}), ...extra });
    await put('people', 'me', P('Olda', 'vcard', { isMe: true }), 'family');
    await put('people', 'mum', P('Mumtaz', 'google'), 'family');
    await put('people', 'loose1', P('Loosey', 'picker'));
    await put('people', 'loose2', P('Csvy', 'csv'));
    await put('people', 'pal', P('Pally', 'vcard'));
    await put('people', 'typed', P('Typedia'));
    await put('relationships', 'r1', { fromId: 'mum', toId: 'me', type: 'parent', createdAt: 1 }, 'family');
    await put('relationships', 'r2', { fromId: 'me', toId: 'pal', type: 'friend', createdAt: 1 });
    await page.reload();
    await page.getByText('Mumtaz').first().waitFor();
    const gone = await page.waitForFunction(() => !/Loosey|Csvy|Pally/.test(document.body.innerText), null, { timeout: 15_000 }).then(() => true, () => false);
    check(gone, '[11] loose contacts still listed');
    const told = await page.getByText('Removed 3 old imported contacts').first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check(told, '[11] no notice saying how many old contacts were removed');
    // The screen updates before the server confirms the deletes: give the cloud a moment to catch up.
    const cloudIds = async () => ((await fetch(`${FS}/people`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json())).documents ?? [])
      .map((d) => d.name.split('/').pop()).sort();
    let ids = await cloudIds();
    for (let i = 0; i < 30 && ids.length > 3; i++) { await page.waitForTimeout(500); ids = await cloudIds(); }
    check(JSON.stringify(ids) === JSON.stringify(['me', 'mum', 'typed']), `[11] people left in the cloud: ${ids.join(', ')}`);
    const rels = await fetch(`${FS}/relationships`, { headers: { Authorization: 'Bearer owner' } }).then((r) => r.json());
    const rids = (rels.documents ?? []).map((d) => d.name.split('/').pop()).sort();
    check(JSON.stringify(rids) === JSON.stringify(['r1']), `[11] links left in the cloud: ${rids.join(', ')}`);
    await shot(page, '11-after-cleanup');
  });
  await ctx.close();
}

try {
  BASE = await startStack(PORT);
  const browser = await chromium.launch();
  // QA_ONLY=cleanup,sharing runs just those groups (default: all).
  const only = (process.env.QA_ONLY ?? '').split(',').filter(Boolean);
  const groups = { main, dark, features, sharing, cleanup };
  for (const [k, fn] of Object.entries(groups)) if (!only.length || only.includes(k)) await fn(browser);
  await browser.close();
} catch (e) {
  failures.push('crashed: ' + e.message);
}
stopAll();
console.log('PASSED FLOWS:\n' + passed.map((p) => ' + ' + p).join('\n'));
if (failures.length) {
  console.error('QA FAILED\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log(`QA PASSED — screenshots in ${OUT}/`);
