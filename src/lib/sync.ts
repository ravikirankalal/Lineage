/**
 * Sync engine: two-way, last-write-wins (by updatedAt) between a local Dexie database and a
 * RemoteStore (Firestore in the app, an in-memory fake in tests). Pure apart from the two stores.
 *
 * Bookkeeping lives in the local `meta` table, keyed by `spaceKey`:
 *   pull:<spaceKey>:<collection>  number  pull watermark = max remote updatedAt seen (not the local clock)
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
}

/** What the remote is known to hold for a record. */
interface SyncedEntry {
  u: number; // updatedAt
  s: Scope;
  d?: true; // tombstone
}
type SyncedMap = Record<string, SyncedEntry>;

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
  const pulled = new Map<CloudCollection, Item[]>();
  for (const c of COLLECTIONS) {
    const mark = (await local.meta.get(K.pull(c)))?.value;
    const since = !full && typeof mark === 'number' ? Math.max(0, mark - PULL_OVERLAP_MS) : 0;
    pulled.set(c, await remote.pull(c, since));
  }
  await applyRemote(local, pulled, K, result, { full, prune });

  // ---- Push ---------------------------------------------------------------------------------------
  if (opts.role === 'viewer') return result;
  const batches = await planPush(local, opts, K);
  for (const c of COLLECTIONS) {
    const items = batches.get(c)!;
    if (!items.length) continue;
    await remote.push(c, items);
    result.pushed += items.length;
    await local.transaction('rw', local.meta, async () => {
      const synced = ((await local.meta.get(K.synced))?.value ?? {}) as SyncedMap;
      for (const { id, rec } of items) {
        const k = entryKey(c, id);
        const prev = synced[k];
        if (!prev || prev.u <= rec.updatedAt) {
          synced[k] = rec.deleted ? { u: rec.updatedAt, s: rec.scope, d: true } : { u: rec.updatedAt, s: rec.scope };
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
  mode: { full: boolean; prune: boolean },
) {
  await local.transaction('rw', [local.people, local.relationships, local.tombstones, local.meta], async () => {
    const synced = ((await local.meta.get(K.synced))?.value ?? {}) as SyncedMap;
    let syncedChanged = false;
    const remember = (k: string, e: SyncedEntry) => {
      const prev = synced[k];
      if (!prev || prev.u < e.u || (prev.u === e.u && (prev.s !== e.s || !!prev.d !== !!e.d))) {
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
        maxU = maxU === undefined ? rec.updatedAt : Math.max(maxU, rec.updatedAt);
        const scope: Scope = rec.scope === 'family' ? 'family' : 'private';
        const k = entryKey(c, id);
        const row = (await table.get(id)) as Person | Relationship | undefined;
        const localU = row ? rowUpdatedAt(row) : undefined;
        const tomb = await local.tombstones.get(id);
        const localTomb = tomb && tomb.table === c ? tomb : undefined;

        if (rec.deleted) {
          remember(k, { u: rec.updatedAt, s: scope, d: true });
          if (!row) continue;
          if (localU! > rec.updatedAt) {
            result.conflicts++; // edited here after it was deleted elsewhere: keep, push later
            continue;
          }
          await table.delete(id);
          result.pulled++;
          continue;
        }

        remember(k, { u: rec.updatedAt, s: scope });
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
          if (p.isMe) {
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
      if (mode.full) {
        if (maxU === undefined) await local.meta.delete(K.pull(c));
        else await local.meta.put({ key: K.pull(c), value: maxU });
      } else if (maxU !== undefined) {
        const prev = (await local.meta.get(K.pull(c)))?.value;
        await local.meta.put({ key: K.pull(c), value: typeof prev === 'number' ? Math.max(prev, maxU) : maxU });
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
async function planPush(local: LineageDB, opts: SyncOptions, K: ReturnType<typeof keys>) {
  const owner = opts.role === 'owner';
  return local.transaction('rw', [local.people, local.relationships, local.tombstones, local.meta], async () => {
    const people = await local.people.toArray();
    const rels = await local.relationships.toArray();
    const tombs = await local.tombstones.toArray();
    const synced = ((await local.meta.get(K.synced))?.value ?? {}) as SyncedMap;
    const meId = opts.meId ?? people.find((p) => p.isMe === true)?.id;
    const scopes = computeScopes(people, rels, meId, { shared: !owner });
    let clock = Date.now();

    const out = new Map<CloudCollection, Item[]>(COLLECTIONS.map((c) => [c, []]));
    const live = { people: new Set(people.map((p) => p.id)), relationships: new Set(rels.map((r) => r.id)) };

    const consider = async (c: CloudCollection, row: Person | Relationship) => {
      const s = scopes.get(row.id) ?? 'private';
      const e = synced[entryKey(c, row.id)];
      let u = rowUpdatedAt(row);
      if (!owner) {
        // Editors: family records only, and never touch a record the remote holds as private.
        if (s !== 'family' || (e && e.s !== 'family')) return;
        if (e && u <= e.u) return;
      } else if (e && u <= e.u) {
        if (e.s === s && !e.d) return; // remote already has this version
        if (u < e.u && !e.d) return; // remote is newer (should have been applied by the pull)
        // Same version but the scope changed (or a stale remote tombstone): re-stamp.
        clock = Math.max(clock + 1, e.u + 1);
        u = clock;
        const table = c === 'people' ? local.people : local.relationships;
        await table.update(row.id, { updatedAt: u });
      }
      out.get(c)!.push({ id: row.id, rec: { data: clean({ ...row, updatedAt: u }), scope: s, updatedAt: u, updatedBy: opts.uid } });
    };
    for (const p of people) await consider('people', p);
    for (const r of rels) await consider('relationships', r);

    for (const t of tombs) {
      const c = t.table;
      if (c !== 'people' && c !== 'relationships') continue;
      if (live[c].has(t.id)) continue; // re-created since; the live row wins
      const e = synced[entryKey(c, t.id)];
      // Only ids the remote holds and still has alive, unless our delete is newer than its version.
      if (!e || e.d || e.u > t.deletedAt) continue;
      if (!owner && e.s !== 'family') continue;
      out.get(c)!.push({
        id: t.id,
        rec: { data: { id: t.id } as Person | Relationship, scope: e.s, updatedAt: t.deletedAt, updatedBy: opts.uid, deleted: true },
      });
    }
    return out;
  });
}
