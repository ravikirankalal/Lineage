/**
 * Sync engine: two-way, last-write-wins (by updatedAt) between a local Dexie database and a
 * RemoteStore (Firestore in the app, an in-memory fake in tests). Pure apart from the two stores.
 *
 * Bookkeeping lives in the local `meta` table, keyed by `spaceKey`:
 *   pull:<spaceKey>:<collection>  number  pull watermark = max accepted remote updatedAt, capped at the
 *                                         local time the pull started
 *   synced:<spaceKey>             map     per record, the version/scope the remote is known to hold
 *   lastPushedAt:<spaceKey>       number  local time of the last successful push (status only)
 *
 * Push uses the `synced` map rather than a single time watermark: a record is pushed when its local
 * updatedAt is newer than the remote's, or (owner) when its computed scope changed. This makes
 * re-running sync a no-op, avoids echoing pulled records back, and cannot miss an edit made in the
 * same millisecond as a watermark.
 */
import { LineageDB, normalisePerson, rowUpdatedAt, validRelationship } from './db';
import { FamilyGraph } from './kinship';
import type { CloudCollection, CloudRecord, RemoteStore, Role, Scope } from './cloud/contract';
import { isFamilyType, type Person, type Relationship } from './types';

/** Re-pull this much before the watermark, to tolerate small clock skew between writers. Re-applying
 * is idempotent (only strictly newer remote versions are applied). */
export const PULL_OVERLAP_MS = 60_000;

/** Pulled records stamped further than this into the future (by the local clock) are rejected: not
 * applied, not remembered, and never used to advance the pull watermark. Mirrors firestore.rules. */
export const MAX_SKEW_MS = 5 * 60_000;

/** Pulled photos must be a small inline image data URL; anything else is dropped. */
const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO_CHARS = 300_000;
const safePhoto = (x: unknown): x is string => typeof x === 'string' && x.length < MAX_PHOTO_CHARS && PHOTO_RE.test(x);

/** The photo as the rules accept it (media type lower-cased, jpg -> jpeg, whitespace removed from
 * the base64), or undefined if it cannot conform. Used on push; the local copy is left alone. */
export function pushablePhoto(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const m = /^data:image\/(png|jpe?g|webp);base64,([\s\S]*)$/i.exec(x.trim());
  if (!m) return undefined;
  const type = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const out = `data:image/${type};base64,${m[2].replace(/\s+/g, '')}`;
  return safePhoto(out) ? out : undefined;
}

/** Remote isMe flag of pushed/pulled person data. */
const dataIsMe = (data: unknown) => !!data && typeof data === 'object' && (data as { isMe?: unknown }).isMe === true;

const COLLECTIONS: CloudCollection[] = ['people', 'relationships'];

export interface SyncOptions {
  uid: string;
  role: Role;
  /** The "me" person that roots the family component. Defaults to the local person with isMe. */
  meId?: string;
  /** Namespaces the watermarks inside the local DB (e.g. the space id). Defaults to `<db name>:<uid>`. */
  spaceKey?: string;
  /**
   * Full resync: pull everything (since = 0) and reset the pull watermarks. For editors/viewers it
   * also prunes local people/relationships the remote no longer returns (un-shared by the owner or
   * deleted out of sight), so private data never lingers on members' devices. Only rows the remote
   * once held (known in the synced map) are pruned; rows that never left this device are kept.
   * Owners never prune: with `full` they just re-pull everything.
   */
  full?: boolean;
  /**
   * The space owner's uid. Pulled records only set or clear `isMe` when written by the current user
   * (their own devices) or by this uid. When omitted: owners trust only themselves; editors/viewers
   * keep the legacy behaviour (trust any writer), because without the owner's "me" a member's own
   * friends would be scoped 'family' and pushed into the shared space.
   */
  ownerUid?: string;
}

export interface SyncResult {
  /** Remote changes applied locally (inserts, updates and deletes). */
  pulled: number;
  /** Records and tombstones sent to the remote. */
  pushed: number;
  /** Remote changes ignored because the local copy (or local deletion) was newer. */
  conflicts: number;
  /** Full resync only: local rows removed because the remote no longer returns them. */
  pruned?: number;
  /** Remote records ignored as invalid (updatedAt too far in the future). Present only when > 0. */
  rejected?: number;
}

/** What the remote is known to hold for a record. */
interface SyncedEntry {
  u: number; // updatedAt
  s: Scope;
  d?: true; // tombstone
  /** People only: whether the remote's data.isMe is true. Undefined in entries written before this
   * field existed (then the local row's isMe, itself pulled from the remote, is used instead). */
  m?: boolean;
}
type SyncedMap = Record<string, SyncedEntry>;

/** Read the synced map, dropping entries poisoned by a far-future updatedAt (from before the
 * MAX_SKEW check existed): they would otherwise block every later push of that record. */
async function readSynced(local: LineageDB, key: string, now = Date.now()): Promise<SyncedMap> {
  const raw = (await local.meta.get(key))?.value;
  const out: SyncedMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, e] of Object.entries(raw as SyncedMap)) {
    if (e && typeof e.u === 'number' && Number.isFinite(e.u) && e.u <= now + MAX_SKEW_MS) out[k] = e;
  }
  return out;
}

/** A usable pull watermark, or undefined (pull everything) if missing, malformed or in the future. */
function validMark(v: unknown, now: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + MAX_SKEW_MS ? v : undefined;
}

const entryKey = (c: CloudCollection, id: string) => `${c}/${id}`;
const keys = (spaceKey: string) => ({
  pull: (c: CloudCollection) => `pull:${spaceKey}:${c}`,
  synced: `synced:${spaceKey}`,
  pushedAt: `lastPushedAt:${spaceKey}`,
});

/**
 * Scope of every person and relationship id.
 * - With `meId` (present in `people`): people in `familyComponent(meId)` are 'family'; a relationship
 *   is 'family' when it is a family type (parent/spouse/sibling) and both ends are family.
 *   Everything else (friends, colleagues, family–friend edges) is 'private'.
 * - Without `meId`: everything is 'private', unless `opts.shared` (a shared space, where everything
 *   present came from the family view), in which case everything is 'family'.
 */
export function computeScopes(
  people: Person[],
  rels: Relationship[],
  meId?: string,
  opts: { shared?: boolean } = {},
): Map<string, Scope> {
  const out = new Map<string, Scope>();
  const byId = new Map(people.map((p) => [p.id, p]));
  if (!meId || !byId.has(meId)) {
    const s: Scope = opts.shared ? 'family' : 'private';
    for (const p of people) out.set(p.id, s);
    for (const r of rels) out.set(r.id, s);
    return out;
  }
  const fam = new FamilyGraph(byId, rels).familyComponent(meId);
  for (const p of people) out.set(p.id, fam.has(p.id) ? 'family' : 'private');
  for (const r of rels) {
    out.set(r.id, isFamilyType(r.type) && r.fromId !== r.toId && fam.has(r.fromId) && fam.has(r.toId) ? 'family' : 'private');
  }
  return out;
}

/** Firestore rejects `undefined` values; IndexedDB rows can contain them. */
function clean<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

type Item = { id: string; rec: CloudRecord<Person | Relationship> };

/** One full pull-then-push round. Throws if the remote throws; watermarks only advance on success. */
export async function syncOnce(local: LineageDB, remote: RemoteStore, opts: SyncOptions): Promise<SyncResult> {
  const K = keys(opts.spaceKey ?? `${local.name}:${opts.uid}`);
  const full = opts.full === true;
  const prune = full && opts.role !== 'owner';
  const result: SyncResult = full ? { pulled: 0, pushed: 0, conflicts: 0, pruned: 0 } : { pulled: 0, pushed: 0, conflicts: 0 };

  // ---- Pull ---------------------------------------------------------------------------------------
  const pullStartedAt = Date.now();
  const pulled = new Map<CloudCollection, Item[]>();
  for (const c of COLLECTIONS) {
    const mark = validMark((await local.meta.get(K.pull(c)))?.value, pullStartedAt);
    const since = !full && mark !== undefined ? Math.max(0, mark - PULL_OVERLAP_MS) : 0;
    pulled.set(c, await remote.pull(c, since));
  }
  // Ids the remote holds with a future updatedAt. They are re-pulled (and rejected) on every sync, so
  // this set is complete; pushing them would be refused by the rules and fail the whole batch.
  const blocked = new Set<string>();
  await applyRemote(local, pulled, K, result, { full, prune, pullStartedAt, blocked, opts });

  // ---- Push ---------------------------------------------------------------------------------------
  if (opts.role === 'viewer') return result;
  const batches = await planPush(local, opts, K, blocked);
  for (const c of COLLECTIONS) {
    const items = batches.get(c)!;
    if (!items.length) continue;
    await remote.push(c, items);
    result.pushed += items.length;
    await local.transaction('rw', local.meta, async () => {
      const synced = await readSynced(local, K.synced);
      for (const { id, rec } of items) {
        const k = entryKey(c, id);
        const prev = synced[k];
        if (!prev || prev.u <= rec.updatedAt) {
          const e: SyncedEntry = rec.deleted ? { u: rec.updatedAt, s: rec.scope, d: true } : { u: rec.updatedAt, s: rec.scope };
          if (c === 'people') e.m = dataIsMe(rec.data);
          synced[k] = e;
        }
      }
      await local.meta.put({ key: K.synced, value: synced });
    });
  }
  if (result.pushed) await local.meta.put({ key: K.pushedAt, value: Date.now() });
  return result;
}

/**
 * Apply pulled records in one transaction. Writes rows directly: never creates tombstones.
 * `full`: the pull was complete (since = 0), so the watermark is reset to what it returned.
 * `prune` (non-owners with `full` only): also delete local rows the remote no longer returns.
 */
async function applyRemote(
  local: LineageDB,
  pulled: Map<CloudCollection, Item[]>,
  K: ReturnType<typeof keys>,
  result: SyncResult,
  mode: { full: boolean; prune: boolean; pullStartedAt: number; blocked: Set<string>; opts: SyncOptions },
) {
  const { opts } = mode;
  // Who may set or clear `isMe` on this device (see SyncOptions.ownerUid).
  const trustsMe = (by: unknown) =>
    by === opts.uid || (opts.ownerUid !== undefined ? by === opts.ownerUid : opts.role !== 'owner');
  await local.transaction('rw', [local.people, local.relationships, local.tombstones, local.meta], async () => {
    const synced = await readSynced(local, K.synced, mode.pullStartedAt);
    // Entries dropped by readSynced must be persisted as dropped.
    let syncedChanged = JSON.stringify(synced) !== JSON.stringify((await local.meta.get(K.synced))?.value ?? {});
    const remember = (k: string, e: SyncedEntry) => {
      const prev = synced[k];
      if (!prev || prev.u < e.u || (prev.u === e.u && (prev.s !== e.s || !!prev.d !== !!e.d || prev.m !== e.m))) {
        synced[k] = e;
        syncedChanged = true;
      }
    };

    for (const c of COLLECTIONS) {
      const table = c === 'people' ? local.people : local.relationships;
      let maxU: number | undefined;
      const returned = new Set<string>();
      for (const { id, rec } of pulled.get(c) ?? []) {
        if (id) returned.add(id);
        if (!id || !rec || typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) continue;
        const k = entryKey(c, id);
        if (rec.updatedAt > mode.pullStartedAt + MAX_SKEW_MS) {
          // Far-future stamp: applying it would win every later conflict and freeze the watermark.
          result.rejected = (result.rejected ?? 0) + 1;
          mode.blocked.add(k);
          continue;
        }
        maxU = maxU === undefined ? rec.updatedAt : Math.max(maxU, rec.updatedAt);
        const scope: Scope = rec.scope === 'family' ? 'family' : 'private';
        const row = (await table.get(id)) as Person | Relationship | undefined;
        const localU = row ? rowUpdatedAt(row) : undefined;
        const tomb = await local.tombstones.get(id);
        const localTomb = tomb && tomb.table === c ? tomb : undefined;

        if (rec.deleted) {
          remember(k, c === 'people' ? { u: rec.updatedAt, s: scope, d: true, m: dataIsMe(rec.data) } : { u: rec.updatedAt, s: scope, d: true });
          if (!row) continue;
          if (localU! > rec.updatedAt) {
            result.conflicts++; // edited here after it was deleted elsewhere: keep, push later
            continue;
          }
          await table.delete(id);
          result.pulled++;
          continue;
        }

        remember(k, c === 'people' ? { u: rec.updatedAt, s: scope, m: dataIsMe(rec.data) } : { u: rec.updatedAt, s: scope });
        if (localTomb && localTomb.deletedAt >= rec.updatedAt && !row) {
          result.conflicts++; // deleted here after the remote edit: our tombstone wins
          continue;
        }
        if (row && localU! >= rec.updatedAt) {
          if (localU! > rec.updatedAt) result.conflicts++;
          continue;
        }

        if (!rec.data || typeof rec.data !== 'object') continue; // malformed: ignore
        if (c === 'people') {
          const p = normalisePerson({ ...(rec.data as object), id });
          if (!p) continue;
          p.id = id;
          p.updatedAt = rec.updatedAt;
          if (p.photo !== undefined && !safePhoto(p.photo)) delete p.photo;
          if (!trustsMe(rec.updatedBy)) {
            // Another writer can neither plant nor clear "me" on a row we hold: keep this device's
            // state, and if theirs differs, stamp our copy just past it so the correction is pushed.
            // (The rules stop editors changing isMe, so a difference is legacy or hostile data.)
            // A row new to this device may only fill a vacancy: an owner device without a "me" would
            // scope everything private and un-share the family on its next push.
            if (row) {
              const keep = (row as Person).isMe === true;
              if (keep !== (p.isMe === true)) p.updatedAt = rec.updatedAt + 1;
              if (keep) p.isMe = true;
              else delete p.isMe;
            } else if (p.isMe && (await local.people.filter((x) => x.isMe === true).count()) > 0) {
              delete p.isMe;
            }
          } else if (p.isMe) {
            // Only one "me": the more recently changed claim wins.
            const others = await local.people.filter((x) => x.isMe === true && x.id !== id).toArray();
            if (others.some((o) => rowUpdatedAt(o) > rec.updatedAt)) delete p.isMe;
            else {
              // Not re-stamped: the other device's write of that person carries the same change.
              await local.people.where('id').anyOf(others.map((o) => o.id)).modify((x) => {
                delete x.isMe;
              });
            }
          }
          await local.people.put(p);
        } else {
          const r = { ...(rec.data as Relationship), id };
          if (!validRelationship(r)) continue;
          r.createdAt = typeof r.createdAt === 'number' ? r.createdAt : rec.updatedAt;
          r.updatedAt = rec.updatedAt;
          await local.relationships.put(r);
        }
        if (localTomb) await local.tombstones.delete(id);
        result.pulled++;
      }
      if (mode.prune) {
        // Rows the remote once held for us but no longer returns: un-shared or gone. Rows with no
        // synced entry never left this device (e.g. not yet pushed, or private to this member): keep.
        const gone: string[] = [];
        for (const id of (await table.toCollection().primaryKeys()) as string[]) {
          if (!returned.has(id) && synced[entryKey(c, id)]) gone.push(id);
        }
        await table.bulkDelete(gone);
        result.pruned = (result.pruned ?? 0) + gone.length;
        // Forget every entry the remote no longer returns, so a re-share is applied as new.
        const prefix = `${c}/`;
        for (const k of Object.keys(synced)) {
          if (k.startsWith(prefix) && !returned.has(k.slice(prefix.length))) {
            delete synced[k];
            syncedChanged = true;
          }
        }
      }
      // The watermark never passes the local time the pull started: a record stamped a little in the
      // future (within MAX_SKEW_MS) must not make us skip honest writes made after it.
      if (mode.full) {
        if (maxU === undefined) await local.meta.delete(K.pull(c));
        else await local.meta.put({ key: K.pull(c), value: Math.min(maxU, mode.pullStartedAt) });
      } else {
        const prev = validMark((await local.meta.get(K.pull(c)))?.value, mode.pullStartedAt);
        const next = maxU === undefined ? prev : Math.min(Math.max(prev ?? 0, maxU), mode.pullStartedAt);
        if (next === undefined) await local.meta.delete(K.pull(c));
        else await local.meta.put({ key: K.pull(c), value: next });
      }
    }
    if (syncedChanged) await local.meta.put({ key: K.synced, value: synced });
  });
}

/**
 * Decide what to push, from a consistent snapshot. For the owner, a record whose scope changed
 * without a local edit gets a fresh updatedAt (written locally in the same transaction) so other
 * devices and members pick the change up.
 */
async function planPush(local: LineageDB, opts: SyncOptions, K: ReturnType<typeof keys>, blocked: Set<string>) {
  const owner = opts.role === 'owner';
  return local.transaction('rw', [local.people, local.relationships, local.tombstones, local.meta], async () => {
    const people = await local.people.toArray();
    const rels = await local.relationships.toArray();
    const tombs = await local.tombstones.toArray();
    // Everything pushed is stamped no later than this (the rules refuse updatedAt > server now + 5 min,
    // and a stamp in the future would win conflicts it should not).
    const now = Date.now();
    const synced = await readSynced(local, K.synced, now);
    const meId = opts.meId ?? people.find((p) => p.isMe === true)?.id;
    const scopes = computeScopes(people, rels, meId, { shared: !owner });

    const out = new Map<CloudCollection, Item[]>(COLLECTIONS.map((c) => [c, []]));
    const live = { people: new Set(people.map((p) => p.id)), relationships: new Set(rels.map((r) => r.id)) };

    const consider = async (c: CloudCollection, row: Person | Relationship) => {
      const s = scopes.get(row.id) ?? 'private';
      if (blocked.has(entryKey(c, row.id))) return; // the rules would refuse it and fail the batch
      const e = synced[entryKey(c, row.id)];
      let u = rowUpdatedAt(row);
      let restamp = false;
      if (!owner) {
        // Editors: family records only, and never touch a record the remote holds as private.
        if (s !== 'family' || (e && e.s !== 'family')) return;
        if (e && u <= e.u) return;
      } else if (e && u <= e.u) {
        if (e.s === s && !e.d) return; // remote already has this version
        if (u < e.u && !e.d) return; // remote is newer (should have been applied by the pull)
        // Same version but the scope changed (or a stale remote tombstone): re-stamp.
        restamp = true;
      }
      if (!Number.isFinite(u) || u > now) restamp = true; // local stamp in the future: bring it back to now
      if (restamp) {
        // Strictly newer than the remote's version (the rules require it), and not in the future.
        u = Math.max(now, e ? e.u + 1 : 0);
        if (u > now) return; // the remote's version is itself slightly ahead: try again next sync
        const table = c === 'people' ? local.people : local.relationships;
        await table.update(row.id, { updatedAt: u });
      }
      const data = clean({ ...row, updatedAt: u }) as Person & Relationship;
      if (c === 'people') {
        const photo = pushablePhoto(data.photo);
        if (photo === undefined) delete data.photo; // the rules refuse it; the local copy keeps it
        else data.photo = photo;
        if (!owner) {
          // Only the owner may change data.isMe: send the remote's current value back unchanged.
          const remoteMe = e ? (e.m ?? (row as Person).isMe === true) : false;
          if (remoteMe) data.isMe = true;
          else delete data.isMe;
        }
      }
      out.get(c)!.push({ id: row.id, rec: { data, scope: s, updatedAt: u, updatedBy: opts.uid } });
    };
    for (const p of people) await consider('people', p);
    for (const r of rels) await consider('relationships', r);

    for (const t of tombs) {
      const c = t.table;
      if (c !== 'people' && c !== 'relationships') continue;
      if (live[c].has(t.id)) continue; // re-created since; the live row wins
      if (blocked.has(entryKey(c, t.id))) continue;
      const e = synced[entryKey(c, t.id)];
      // Only ids the remote holds and still has alive, unless our delete is newer than its version.
      if (!e || e.d || e.u > t.deletedAt) continue;
      if (!owner && e.s !== 'family') continue;
      // A tombstone's data is just { id }, so it would clear isMe, which only the owner may do: an
      // editor's local delete of the owner's "me" stays local. Entries from before `m` existed are
      // treated the same way (refusing would fail the whole batch).
      if (!owner && c === 'people' && e.m !== false) continue;
      // Strictly newer than the remote's version (a delete in the same millisecond gets +1), and
      // never in the future.
      const u = Math.max(Math.min(t.deletedAt, now), e.u + 1);
      if (u > now) continue;
      if (u !== t.deletedAt) await local.tombstones.update(t.id, { deletedAt: u });
      out.get(c)!.push({
        id: t.id,
        rec: { data: { id: t.id } as Person | Relationship, scope: e.s, updatedAt: u, updatedBy: opts.uid, deleted: true },
      });
    }
    return out;
  });
}
