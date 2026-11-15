// Shared setup for the browser checks (smoke, QA). Lineage requires sign-in and keeps the tree in
// Firestore, so the checks run against the Firebase emulators:
//   - starts the auth + firestore emulators (project demo-lineage, rules from firestore.rules),
//   - builds the app with VITE_FIREBASE_EMULATORS=1 into a temp dir (dist/ is never touched),
//   - serves that build with `vite preview`,
//   - signs a page in through the emulator-only hook (no Google popup).
// With REUSE_EMULATORS=1, emulators already running on 8080/9099 are used (their data is wiped).
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PROJECT = 'demo-lineage';
const FS = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function child(cmd, args, env = {}) {
  // detached: kill the whole process group (firebase spawns java).
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, detached: true });
  let log = '';
  c.stdout.on('data', (d) => (log += d));
  c.stderr.on('data', (d) => (log += d));
  children.push(c);
  return { proc: c, log: () => log };
}
export function stopAll() {
  for (const c of children.splice(0)) {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

async function up(url) {
  try { await fetch(url); return true; } catch { return false; }
}

/** Start emulators (unless reused), build and serve the emulator build on `port`. Returns BASE. */
export async function startStack(port) {
  const base = `http://localhost:${port}/`;
  if (await up(base)) throw new Error(`${base} is already in use. Stop the old preview server.`);
  const reuse = process.env.REUSE_EMULATORS === '1';
  if (!reuse) {
    for (const u of [`${FS}/`, `${AUTH}/`]) if (await up(u)) throw new Error(`${u} is already in use (emulators running?). Stop them, or set REUSE_EMULATORS=1.`);
    const emu = child(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:start', '--only', 'auth,firestore', '--project', PROJECT]);
    const end = Date.now() + 120_000;
    while (!/All emulators ready/.test(emu.log())) {
      if (emu.proc.exitCode !== null || Date.now() > end) throw new Error('emulators did not start:\n' + emu.log().slice(-2000));
      await sleep(400);
    }
  }
  await resetEmulators();
  const dist = join(tmpdir(), `lineage-emu-dist-${port}`);
  const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', dist, '--emptyOutDir'], {
    env: { ...process.env, VITE_FIREBASE_EMULATORS: '1' }, encoding: 'utf8',
  });
  if (b.status !== 0) throw new Error('emulator build failed:\n' + b.stdout + b.stderr);
  const prev = child(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dist, '--port', String(port), '--strictPort']);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return base; } catch { /* not up yet */ }
    if (prev.proc.exitCode !== null) break;
    await sleep(200);
  }
  throw new Error('preview server did not start:\n' + prev.log());
}

/** Delete all emulator data and accounts. */
export async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Messages the Firebase SDK logs in emulator mode; not app errors. */
export const EXPECTED_CONSOLE = [/emulator/i, /Firestore.*(offline|backend|Could not reach)/i, /WebChannelConnection/i];

/** Open the app on `page` and sign in as `email`; resolves with the uid once the app (not the sign-in screen) shows. */
export async function signIn(page, base, email, name) {
  await page.goto(base);
  await page.waitForFunction(() => typeof window.__lineageTestSignIn === 'function');
  const uid = await page.evaluate(([e, n]) => window.__lineageTestSignIn(e, n), [email, name]);
  await page.getByRole('navigation').first().waitFor({ timeout: 30_000 });
  return uid;
}
