// End-to-end QA for Google sign-in, sync and family sharing against the Firebase emulators.
//
// Starts the auth + firestore emulators (project demo-lineage, rules from firestore.rules), builds
// the app with VITE_FIREBASE_EMULATORS=1 into a temp dir (never touches dist/), serves it with
// `vite preview`, drives several browser contexts (= devices / users) with Playwright, checks the
// Firestore emulator through its REST API, and stops everything at the end.
//
// Usage: npm run qa:cloud [-- --reuse] [--out <dir>]
//   --reuse  use emulators already running on 8080/9099 and a preview already on 4196
//            (their data is wiped first). Without it the ports must be free.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const REUSE = process.argv.includes('--reuse');
const OUT = arg('--out') ?? 'qa-cloud-output';
const PORT = 4196;
const BASE = `http://localhost:${PORT}/`;
const PROJECT = 'demo-lineage';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099';
const DIST = join(tmpdir(), 'lineage-emu-dist');
const FRIENDS = ['Sandeep Kumar', 'Venu Goud', 'Priya Nair', 'Farhan Ali', 'Harish Varma'];
mkdirSync(OUT, { recursive: true });

// ---------- process management ----------
const children = [];
function startChild(cmd, args, env = {}) {
  // detached: kill the whole process group (firebase spawns java).
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, detached: true });
  let log = '';
  c.stdout.on('data', (d) => (log += d));
  c.stderr.on('data', (d) => (log += d));
  children.push(c);
  return { proc: c, log: () => log };
}
function stopAll() {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUrl(url, ms, okStatuses = [200]) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (okStatuses.includes(r.status) || r.status < 500) return; } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}
async function portBusy(url) {
  try { await fetch(url); return true; } catch { return false; }
}

async function setup() {
  if (!REUSE) {
    for (const u of ['http://127.0.0.1:8080/', `${AUTH}/`, BASE]) {
      if (await portBusy(u)) throw new Error(`${u} is already in use. Stop it, or pass --reuse.`);
    }
    const emu = startChild(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:start', '--only', 'auth,firestore', '--project', PROJECT]);
    const end = Date.now() + 120_000;
    while (!/All emulators ready/.test(emu.log())) {
      if (emu.proc.exitCode !== null || Date.now() > end) throw new Error('emulators did not start:\n' + emu.log().slice(-2000));
      await sleep(500);
    }
    console.log('emulators ready');
    const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', DIST, '--emptyOutDir'], {
      env: { ...process.env, VITE_FIREBASE_EMULATORS: '1' }, encoding: 'utf8',
    });
    if (b.status !== 0) throw new Error('emulator build failed:\n' + b.stdout + b.stderr);
    console.log('built', DIST);
    const prev = startChild(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort']);
    await waitUrl(BASE, 20_000).catch((e) => { throw new Error(e.message + '\n' + prev.log()); });
  }
  // Fresh emulator data.
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

// ---------- Firestore REST (admin: "Bearer owner" bypasses rules in the emulator) ----------
function decode(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  return v;
}
async function fsList(path, token = 'owner') {
  const out = [];
  let pageToken = '';
  do {
    const r = await fetch(`${FS}/${path}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`list ${path}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    for (const d of j.documents ?? []) out.push({ id: d.name.split('/').pop(), ...decode({ mapValue: { fields: d.fields } }) });
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}
const fullName = (rec) => [rec.data?.firstName, rec.data?.lastName].filter(Boolean).join(' ');
async function cloudPeople(spaceId) {
  return (await fsList(`spaces/${spaceId}/people`)).filter((r) => !r.deleted);
}
async function waitFor(desc, fn, ms = 20_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(500);
  }
  throw new Error(`timed out: ${desc}${last instanceof Error ? ' (' + last.message + ')' : ''}`);
}
const enc = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
/** A write through the emulator REST API as a real user (rules apply). Returns the HTTP status. */
async function userWrite(token, path, obj, method = 'PATCH') {
  const r = await fetch(`${FS}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify({ fields: enc(obj).mapValue.fields }),
  });
  return r.status;
}
async function userGet(token, path) {
  return (await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;
}
async function userQuery(token, parent, collection, where) {
  const body = { structuredQuery: { from: [{ collectionId: collection }], ...(where ? { where } : {}) } };
  const r = await fetch(`${FS}/${parent}:runQuery`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.status;
}

// ---------- checks ----------
const failures = [];
const passed = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); return cond; };
async function flow(name, fn) {
  const before = failures.length;
  console.log('--', name);
  try { await fn(); } catch (e) {
    failures.push(`[${name}] crashed: ${e.message.split('\n')[0]}`);
    const tag = name.split(' ')[0];
    for (const d of devices) await d.page.screenshot({ path: join(OUT, `crash-${tag}-${d.name}.png`), fullPage: true }).catch(() => undefined);
  }
  if (failures.length === before) passed.push(name);
}

// Firebase SDK warnings about using emulators are expected; anything else at error level fails.
const EXPECTED = [/emulator/i];
function watch(page, name) {
  page.on('pageerror', (e) => failures.push(`[${name}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (EXPECTED.some((re) => re.test(t))) return;
    failures.push(`[${name}] console error: ${t.slice(0, 300)}`);
  });
}

// ---------- page helpers ----------
const body = (page) => page.locator('body').innerText();
const shot = (page, s) => page.screenshot({ path: join(OUT, `${s}.png`), fullPage: true });

const devices = [];
async function device(browser, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...opts });
  const page = await ctx.newPage();
  watch(page, name);
  const d = { ctx, page, name };
  devices.push(d);
  return d;
}

async function signIn(page, email, displayName) {
  await page.goto(BASE + '#/settings');
  const btn = page.getByRole('button', { name: 'Sign in with Google' });
  await btn.waitFor();
  const [pop] = await Promise.all([page.waitForEvent('popup'), btn.click()]);
  // The emulator's widget loads its scripts from a CDN; wait for them before clicking.
  await pop.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
  await pop.locator('#add-account-button').waitFor();
  await sleep(800); // the account list fills in asynchronously
  const existing = pop.locator('li.mdc-list-item', { hasText: email });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await pop.locator('#add-account-button').click();
    await pop.locator('#email-input').fill(email);
    await pop.locator('#display-name-input').fill(displayName);
    for (let i = 0; i < 15 && !pop.isClosed(); i++) {
      await pop.locator('#sign-in').click().catch(() => undefined);
      await Promise.race([pop.waitForEvent('close').catch(() => undefined), sleep(2000)]);
    }
  }
  if (!pop.isClosed()) await pop.close();
  await page.getByText(email).first().waitFor({ timeout: 15_000 });
}

/** The signed-in user from the Firebase Auth IndexedDB persistence: { uid, token, emailVerified }. */
async function authOf(page) {
  return page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('firebaseLocalStorageDb');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const g = r.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
      g.onsuccess = () => {
        const u = g.result.map((x) => x.value).find((v) => v && v.uid);
        res(u ? { uid: u.uid, token: u.stsTokenManager.accessToken, emailVerified: u.emailVerified } : null);
      };
    };
  }));
}
const jwtClaims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

async function focusSync(page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function waitText(page, text, { present = true, url, ms = 20_000 } = {}) {
  return waitFor(`${present ? '' : 'no '}"${text}" on ${url ?? 'page'}`, async () => {
    if (url && !page.url().endsWith(url)) await page.goto(BASE + url);
    await focusSync(page);
    await sleep(700);
    const has = (await body(page)).includes(text);
    return has === present;
  }, ms);
}
async function openProfile(page, name) {
  await page.goto(BASE + '#/');
  await page.getByPlaceholder(/Search names/).fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await page.getByText('Connections').first().waitFor();
}
async function dbNames(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
}
async function peopleCount(page) {
  return page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('lineage');
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('people')) { d.close(); return res(0); }
      const c = d.transaction('people').objectStore('people').count();
      c.onsuccess = () => { d.close(); res(c.result); };
    };
    r.onerror = () => res(-1);
  }));
}

// ---------- flows ----------
async function main(browser) {
  const st = {}; // shared state between flows

  const d1 = await device(browser, 'owner-d1');
  const d2 = await device(browser, 'owner-d2');

  await flow('1 owner signs in and backs up', async () => {
    const { page } = d1;
    await page.goto(BASE);
    await page.getByText('Try a sample family').click();
    await page.getByText('Ravi Rao').first().waitFor();
    await signIn(page, 'owner@example.com', 'Ravi Rao');
    const sheet = page.getByText(/Back up your 26 people to your Google account\?/);
    await sheet.waitFor({ timeout: 15_000 });
    await shot(page, '1-backup-question');
    await page.getByRole('button', { name: 'Back up', exact: true }).click();
    const a = await authOf(page);
    st.owner = a;
    check(a?.emailVerified === true && jwtClaims(a.token).email_verified === true, '[1] emulator Google account is not email_verified');
    const recs = await waitFor('26 people in Firestore', async () => { const r = await cloudPeople(a.uid); return r.length === 26 && r; });
    for (const r of recs) {
      const n = fullName(r);
      const want = FRIENDS.includes(n) ? 'private' : 'family';
      check(r.scope === want, `[1] ${n} has scope ${r.scope}, expected ${want}`);
      check(r.updatedBy === a.uid, `[1] ${n} updatedBy ${r.updatedBy}`);
    }
    const rels = (await fsList(`spaces/${a.uid}/relationships`)).filter((r) => !r.deleted);
    const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
    for (const r of rels) {
      const ends = [byId[r.data.fromId], byId[r.data.toId]];
      const fam = ['parent', 'spouse', 'sibling'].includes(r.data.type) && ends.every((e) => e?.scope === 'family');
      check(r.scope === (fam ? 'family' : 'private'), `[1] relationship ${r.data.type} ${ends.map(fullName).join('→')} scope ${r.scope}`);
    }
    const space = await fsList('spaces').then((l) => l.find((s) => s.id === a.uid));
    check(space?.name === "Ravi's family", `[1] space name is ${space?.name}`);
    await page.goto(BASE + '#/settings');
    await waitText(page, 'Synced just now');
    await shot(page, '1-settings-synced');
  });

  await flow('2 second device syncs (down, edit, delete)', async () => {
    const { page } = d2;
    await page.goto(BASE);
    await signIn(page, 'owner@example.com', 'Ravi Rao');
    check(!(await page.getByText(/Back up your/).isVisible()), '[2] empty second device was asked to back up');
    await waitText(page, 'Kiran Rao', { url: '#/' });
    const b = await body(page);
    for (const n of ['Ravi Rao', 'Anjali Rao', ...FRIENDS]) check(b.includes(n), `[2] ${n} missing on device 2`);
    await shot(page, '2-device2-people');
    // edit on device 2
    await openProfile(page, 'Kiran Rao');
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByLabel('Occupation').fill('Astronaut');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.getByText('Astronaut').first().waitFor();
    await waitFor('edit reaches Firestore', async () => (await cloudPeople(st.owner.uid)).find((r) => r.data.firstName === 'Kiran')?.data.occupation === 'Astronaut');
    // shows on device 1
    await openProfile(d1.page, 'Kiran Rao');
    await waitText(d1.page, 'Astronaut');
    // delete on device 2
    const harishId = (await cloudPeople(st.owner.uid)).find((r) => fullName(r) === 'Harish Varma').id;
    await openProfile(page, 'Harish Varma');
    await page.getByRole('button', { name: /Delete Harish/ }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await waitFor('tombstone in Firestore', async () => { const h = (await fsList(`spaces/${st.owner.uid}/people`)).find((r) => r.id === harishId); return !h || h.deleted === true; });
    await waitText(d1.page, 'Harish Varma', { present: false, url: '#/' });
    await shot(d1.page, '2-device1-after-delete');
  });

  // Viewer
  const v = await device(browser, 'viewer');
  await flow('3 viewer invite, read-only, family only, rules deny writes', async () => {
    const { page } = d1;
    await page.goto(BASE + '#/sharing');
    await page.getByLabel('Their Google email').fill('Viewer@Example.com');
    await page.getByRole('radio', { name: /Viewer|Can see/ }).click();
    await page.getByRole('button', { name: 'Send invite' }).click();
    await page.getByText(/Invited viewer@example.com/).waitFor();
    await shot(page, '3-owner-invited');

    await v.page.goto(BASE);
    await signIn(v.page, 'viewer@example.com', 'Vimala Viewer');
    const va = await authOf(v.page);
    st.viewer = va;
    check(jwtClaims(va.token).email_verified === true, '[3] viewer token not email_verified');
    await v.page.getByText("You’re invited to Ravi's family").waitFor({ timeout: 15_000 });
    await shot(v.page, '3-viewer-invite-banner');
    check((await body(v.page)).includes('From owner@example.com'), '[3] invite card does not show "From owner@example.com"');
    await v.page.getByRole('button', { name: 'Accept' }).click();
    await waitText(v.page, 'Kiran Rao', { url: '#/' });
    await v.page.waitForTimeout(1500);
    const b = await body(v.page);
    check(b.includes("Ravi's family"), '[3] viewer does not see "Ravi\'s family"');
    for (const n of FRIENDS) check(!b.includes(n), `[3] friend ${n} visible to viewer`);
    const local = await v.page.evaluate(async (id) => new Promise((res) => {
      const r = indexedDB.open('lineage-space-' + id);
      r.onsuccess = () => { const g = r.result.transaction('people').objectStore('people').getAll(); g.onsuccess = () => res(g.result.map((p) => p.firstName + ' ' + (p.lastName ?? ''))); };
      r.onerror = () => res([]);
    }), st.owner.uid);
    check(local.length === 21, `[3] viewer's local copy has ${local.length} people, expected 21 family`);
    for (const n of FRIENDS) check(!local.some((x) => x.trim() === n), `[3] friend ${n} stored on viewer device`);
    await shot(v.page, '3-viewer-people');
    check(await v.page.getByRole('link', { name: 'Add person' }).count() === 0, '[3] viewer sees Add person FAB');
    await openProfile(v.page, 'Kiran Rao');
    await shot(v.page, '3-viewer-profile');
    check(await v.page.getByRole('link', { name: 'Edit' }).count() === 0, '[3] viewer sees Edit');
    check(await v.page.getByRole('button', { name: 'Add', exact: true }).count() === 0, '[3] viewer sees Add');
    check(await v.page.getByRole('button', { name: /Delete/ }).count() === 0, '[3] viewer sees Delete');
    check(await v.page.getByRole('button', { name: /Merge/ }).count() === 0, '[3] viewer sees Merge');
    check(await v.page.getByRole('button', { name: 'Remove link' }).count() === 0, '[3] viewer sees Remove link');
    await v.page.goto(BASE + '#/family');
    await v.page.getByText('Kiran').first().waitFor().catch(() => undefined);
    await v.page.waitForTimeout(800);
    await shot(v.page, '3-viewer-family');
    check(await v.page.getByRole('button', { name: 'Add relative' }).count() === 0, '[3] viewer sees Add relative');
    check(await v.page.getByRole('button', { name: /^Add (father|mother|parent)/ }).count() === 0, '[3] viewer sees ghost Add cards');
    await v.page.goto(BASE + '#/import');
    await v.page.waitForTimeout(500);
    await shot(v.page, '3-viewer-import');
    check(await v.page.locator('input[type=file]').count() === 0, '[3] viewer can pick an import file');
    await v.page.goto(BASE + '#/people/new');
    await v.page.waitForTimeout(500);
    check(await v.page.getByLabel('First name *').count() === 0, '[3] viewer can open the new-person form');
    await v.page.goto(BASE + '#/settings');
    await v.page.waitForTimeout(500);
    check(!(await body(v.page)).includes('Delete all data'), '[3] viewer sees Delete all data');

    // Direct writes with the viewer's own token: the rules must deny.
    const o = st.owner.uid;
    const tok = (await authOf(v.page)).token;
    const people = await fsList(`spaces/${o}/people`);
    const fam = people.find((r) => r.data.firstName === 'Kiran');
    const friend = people.find((r) => r.data.firstName === 'Sandeep');
    const now = Date.now();
    const rec = (id, scope) => ({ data: { id, firstName: 'Hacked' }, scope, updatedAt: now, updatedBy: va.uid });
    check(await userWrite(tok, `spaces/${o}/people/${fam.id}`, rec(fam.id, 'family')) === 403, '[3] viewer could update a family record');
    check(await userWrite(tok, `spaces/${o}/people/viewer-new?currentDocument.exists=false`, rec('viewer-new', 'family')) === 403, '[3] viewer could create a record');
    check(await userWrite(tok, `spaces/${o}/people/${fam.id}`, null, 'DELETE') === 403, '[3] viewer could delete a record');
    check(await userGet(tok, `spaces/${o}/people/${friend.id}`) === 403, '[3] viewer could read a private (friend) record');
    check(await userGet(tok, `spaces/${o}/people/${fam.id}`) === 200, '[3] viewer cannot read a family record');
    check(await userQuery(tok, `spaces/${o}`, 'people') === 403, '[3] viewer could list all people without the scope filter');
    check(await userWrite(tok, `spaces/${o}?updateMask.fieldPaths=members`, { members: { [o]: 'owner', [va.uid]: 'editor' } }) === 403, '[3] viewer could promote themselves');
    check(await userWrite(tok, `spaces/${o}/invites/evil@example.com`, { email: 'evil@example.com', role: 'editor', invitedBy: va.uid, spaceName: 'x', createdAt: now }) === 403, '[3] viewer could invite');
    check((await fsList(`spaces/${o}/people`)).every((r) => r.data.firstName !== 'Hacked'), '[3] a viewer write landed');
  });

  // Editor
  const e = await device(browser, 'editor');
  await flow('4 editor adds a relative, cannot see friends', async () => {
    const { page } = d1;
    await page.goto(BASE + '#/sharing');
    await page.getByLabel('Their Google email').fill('editor@example.com');
    await page.getByRole('radio', { name: /Editor|add & edit/i }).click();
    await page.getByRole('button', { name: 'Send invite' }).click();
    await page.getByText(/Invited editor@example.com/).waitFor();

    await e.page.goto(BASE);
    await signIn(e.page, 'editor@example.com', 'Esha Editor');
    st.editor = await authOf(e.page);
    await e.page.getByText("You’re invited to Ravi's family").waitFor({ timeout: 15_000 });
    await e.page.getByRole('button', { name: 'Accept' }).click();
    await waitText(e.page, 'Kiran Rao', { url: '#/' });
    const b = await body(e.page);
    for (const n of FRIENDS) check(!b.includes(n), `[4] friend ${n} visible to editor`);
    await openProfile(e.page, 'Kiran Rao');
    await e.page.getByRole('button', { name: 'Add', exact: true }).click();
    await shot(e.page, '4-editor-add-sheet');
    const sheetText = await body(e.page);
    check(!/Close friend|Colleague|Neighbour/.test(sheetText), '[4] editor is offered friend/colleague links in a shared family');
    await e.page.getByRole('button', { name: 'Daughter', exact: true }).click();
    await e.page.getByPlaceholder('Search people or type a new name').fill('Isha Rao');
    await e.page.getByText('Add “Isha Rao”').click();
    await e.page.getByPlaceholder('Search people or type a new name').waitFor({ state: 'detached' });
    await waitFor('Isha in Firestore', async () => (await cloudPeople(st.owner.uid)).find((r) => fullName(r) === 'Isha Rao'));
    const isha = (await cloudPeople(st.owner.uid)).find((r) => fullName(r) === 'Isha Rao');
    check(isha.scope === 'family' && isha.updatedBy === st.editor.uid, `[4] Isha scope ${isha.scope} updatedBy ${isha.updatedBy}`);
    await openProfile(d1.page, 'Kiran Rao').catch(() => undefined);
    await waitText(d1.page, 'Isha', { url: undefined });
    await shot(d1.page, '4-owner-sees-isha');
    // editor rules: cannot read or create private records
    const tok = st.editor.token;
    const o = st.owner.uid;
    const friend = (await fsList(`spaces/${o}/people`)).find((r) => r.data.firstName === 'Sandeep');
    check(await userGet(tok, `spaces/${o}/people/${friend.id}`) === 403, '[4] editor could read a friend');
    check(await userWrite(tok, `spaces/${o}/people/ed-private`, { data: { id: 'ed-private', firstName: 'X' }, scope: 'private', updatedAt: Date.now(), updatedBy: st.editor.uid }) === 403, '[4] editor could create a private record');
    check(await userWrite(tok, `spaces/${o}/people/${friend.id}`, { data: { id: friend.id, firstName: 'X' }, scope: 'family', updatedAt: Date.now(), updatedBy: st.editor.uid }) === 403, '[4] editor could overwrite a private record as family');
    check(await userWrite(tok, `spaces/${o}/people/ed-forged`, { data: { id: 'ed-forged', firstName: 'X' }, scope: 'family', updatedAt: Date.now(), updatedBy: st.owner.uid }) === 403, '[4] editor could forge updatedBy');
  });

  await flow('5 un-share: unlinked relative disappears for members', async () => {
    const { page } = d1;
    await openProfile(page, 'Anjali Rao');
    const row = page.locator('.group\\/row', { hasText: 'Mohan Reddy' });
    await row.getByRole('button', { name: 'Remove link' }).click();
    await row.getByRole('button', { name: 'Unlink' }).click();
    await waitFor('Mohan becomes private', async () => (await fsList(`spaces/${st.owner.uid}/people`)).find((r) => r.data.firstName === 'Mohan')?.scope === 'private', 30_000);
    // member's full resync happens when the shared family is opened (reload)
    await v.page.goto(BASE + '#/');
    await v.page.reload();
    await waitText(v.page, 'Mohan Reddy', { present: false, url: '#/' });
    await shot(v.page, '5-viewer-after-unshare');
  });

  await flow('6 remove member: viewer loses access and local copy', async () => {
    const { page } = d1;
    await page.goto(BASE + '#/sharing');
    await page.getByRole('button', { name: /Remove Vimala Viewer|Remove viewer@example.com/ }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await waitFor('viewer removed from members', async () => !(await fsList('spaces')).find((s) => s.id === st.owner.uid).members[st.viewer.uid]);
    await v.page.goto(BASE + '#/');
    await waitText(v.page, 'You no longer have access', { ms: 20_000 }).catch(() => failures.push('[6] viewer never saw "You no longer have access…"'));
    await shot(v.page, '6-viewer-removed');
    const names = await dbNames(v.page);
    check(!names.includes('lineage-space-' + st.owner.uid), `[6] the family's local copy is still on the viewer device (${names.join(', ')})`);
    check(!(await body(v.page)).includes('Kiran Rao'), '[6] viewer still sees family people');
    // A removed member cannot rejoin by re-accepting (invites are single use).
    const o = st.owner.uid;
    const tok = (await authOf(v.page)).token;
    const space = (await fsList('spaces')).find((s) => s.id === o);
    const members = { ...space.members, [st.viewer.uid]: 'viewer' };
    check(await userWrite(tok, `spaces/${o}?updateMask.fieldPaths=members`, { members }) === 403, '[6] removed viewer could rejoin by writing members');
    await v.page.reload();
    await sleep(2500);
    check(!(await body(v.page)).includes('You’re invited to'), '[6] removed viewer is offered the old invite again');
    // Even if the owner had left a stale invite, re-sending then removing must not let them back in.
    check(!(await fsList('spaces')).find((s) => s.id === o).members[st.viewer.uid], '[6] removed viewer is a member again');
  });

  // Account switch on one browser
  const sw = await device(browser, 'switch');
  await flow('7 account switch keeps A out of B', async () => {
    const { page } = sw;
    await page.goto(BASE);
    await page.getByText('Try a sample family').click();
    await page.getByText('Ravi Rao').first().waitFor();
    await signIn(page, 'alice@example.com', 'Alice A');
    await page.getByRole('button', { name: 'Back up', exact: true }).click();
    const alice = await authOf(page);
    await waitFor('alice backed up', async () => (await cloudPeople(alice.uid)).length === 26);
    await page.goto(BASE + '#/settings');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Keep on this device' }).click();
    await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
    await signIn(page, 'bob@example.com', 'Bob B');
    await page.getByText(/This device has 26 people from another account/).waitFor({ timeout: 15_000 });
    await shot(page, '7-foreign-sheet');
    const bob = await authOf(page);
    await sleep(4000);
    check((await fsList(`spaces/${bob.uid}/people`)).length === 0, '[7] alice\'s people uploaded to bob before choosing');
    await page.getByRole('button', { name: 'Keep them only on this device' }).click();
    await sleep(5000);
    check((await fsList(`spaces/${bob.uid}/people`)).length === 0, '[7] alice\'s people uploaded to bob after "keep separate"');
    await page.goto(BASE + '#/');
    await page.waitForTimeout(800);
    check(!(await body(page)).includes('Ravi Rao'), '[7] bob sees alice\'s people');
    await shot(page, '7-bob-people');
    check((await cloudPeople(alice.uid)).length === 26, '[7] alice\'s cloud copy changed');
  });

  await flow('8 sign out + remove from device, then restore', async () => {
    const { page } = d2;
    await page.goto(BASE + '#/settings');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await shot(page, '8-signout-sheet');
    await page.getByRole('button', { name: 'Remove from this device' }).click();
    await page.getByRole('button', { name: 'Sign in with Google' }).waitFor();
    await page.goto(BASE + '#/');
    await page.getByText('Try a sample family').waitFor({ timeout: 10_000 }).catch(() => failures.push('[8] local data not gone after "Remove from this device"'));
    const cnt = await peopleCount(page);
    check(cnt === 0, `[8] local DB still has ${cnt} people`);
    await shot(page, '8-after-remove');
    const cloud = await cloudPeople(st.owner.uid);
    check(cloud.length >= 25, `[8] cloud lost data (${cloud.length})`);
    await signIn(page, 'owner@example.com', 'Ravi Rao');
    await waitText(page, 'Kiran Rao', { url: '#/' });
    check((await body(page)).includes('Isha Rao'), '[8] restored data misses the editor\'s Isha Rao');
    await shot(page, '8-restored');
  });

  for (const d of [d1, d2, v, e, sw]) await d.ctx.close();
}

let browser;
try {
  await setup();
  browser = await chromium.launch();
  // Warm up: the first Google sign-in on a freshly started auth emulator often never completes
  // (its widget pulls scripts from a CDN). Sign a throwaway account in until it works.
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext();
    const w = await ctx.newPage();
    const ok = await signIn(w, 'warmup@example.com', 'Warm Up').then(() => true, () => false);
    await ctx.close();
    if (ok) break;
    if (i === 3) throw new Error('emulator Google sign-in never completed');
  }
  await main(browser);
} catch (e) {
  failures.push('setup/run crashed: ' + e.message);
} finally {
  await browser?.close();
  stopAll();
}
console.log(`\nPassed (${passed.length}):\n  ` + passed.join('\n  '));
if (failures.length) {
  console.log(`\nFailures (${failures.length}):\n  ` + failures.join('\n  '));
  process.exitCode = 1;
} else console.log('\nAll cloud flows passed. Screenshots in ' + OUT);
