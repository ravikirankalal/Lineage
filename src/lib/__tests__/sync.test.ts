import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../cloud/contract';
import { activeSpaceId, addRelationship, db, dbNameFor, deletePerson, forgetSpace, mergePeople, openSpaceDb, savePerson } from '../db';
import Dexie from 'dexie';
import { emptyPerson } from '../person';
import { computeScopes, PULL_OVERLAP_MS, syncOnce } from '../sync';
import type { Person, Relationship } from '../types';
import { FakeCloud } from './fakeRemote';

const OWNER = 'uid-owner';
let n = 0;
let cloud: FakeCloud;

/** A device = its own IndexedDB. `run` makes it the active db so helpers write to it. */
function device(label: string, uid = OWNER, role: Role = 'owner') {
  const space = `${label}-${++n}`;
  const use = () => {
    openSpaceDb(space);
    return db;
  };
  return {
    uid,
    role,
    space,
    db: use,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      use();
      return fn();
    },
    sync(meId?: string, extra: { full?: boolean } = {}) {
      const local = use();
      return syncOnce(local, cloud.as(uid, role), { uid, role, meId, spaceKey: 'space-1', ...extra });
    },
    async snapshot() {
      const local = use();
      const people = (await local.people.orderBy('id').toArray()).map((p) => ({ id: p.id, firstName: p.firstName, isMe: p.isMe, updatedAt: p.updatedAt }));
      const rels = (await local.relationships.orderBy('id').toArray()).map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, subtype: r.subtype, updatedAt: r.updatedAt }));
      return { people, rels };
    },
  };
}

const P = (id: string, extra: Partial<Person> = {}) => emptyPerson({ id, firstName: id, ...extra });

beforeEach(() => {
  cloud = new FakeCloud();
});
afterAll(() => {
  openSpaceDb(null);
});

/** Owner family: me + mum (parent) + spouse; a friend with a close_friend edge to me. */
async function seedFamily() {
  await savePerson(P('me', { isMe: true }));
  await savePerson(P('mum', { notes: 'family note' }));
  await savePerson(P('wife'));
  await savePerson(P('pal', { notes: 'private: met at a conference' }));
  const ids = {
    mumMe: await addRelationship({ fromId: 'mum', toId: 'me', type: 'parent', subtype: 'biological' }),
    meWife: await addRelationship({ fromId: 'me', toId: 'wife', type: 'spouse', subtype: 'married' }),
    mePal: await addRelationship({ fromId: 'me', toId: 'pal', type: 'close_friend' }),
  };
  return ids;
}

describe('computeScopes', () => {
  const people = ['me', 'mum', 'kid', 'wife', 'pal', 'colleague', 'palsKid'].map((id) => P(id));
  const rel = (id: string, fromId: string, toId: string, type: Relationship['type']): Relationship => ({ id, fromId, toId, type, createdAt: 1 });
  const rels = [
    rel('e-mum', 'mum', 'me', 'parent'),
    rel('e-kid', 'me', 'kid', 'parent'),
    rel('e-wife', 'me', 'wife', 'spouse'),
    rel('e-pal', 'me', 'pal', 'friend'), // family–friend edge
    rel('e-col', 'wife', 'colleague', 'colleague'),
    rel('e-palkid', 'pal', 'palsKid', 'parent'), // family-type edge between non-family people
    rel('e-mum-pal', 'mum', 'pal', 'neighbor'),
    rel('e-dangling', 'me', 'nobody', 'sibling'),
  ];

  it('family component and family edges are family; friends and their edges are private', () => {
    const s = computeScopes(people, rels, 'me');
    for (const id of ['me', 'mum', 'kid', 'wife', 'e-mum', 'e-kid', 'e-wife']) expect(s.get(id), id).toBe('family');
    for (const id of ['pal', 'colleague', 'palsKid', 'e-pal', 'e-col', 'e-palkid', 'e-mum-pal', 'e-dangling']) expect(s.get(id), id).toBe('private');
  });

  it('without meId everything is private, or family in a shared space', () => {
    expect(new Set(computeScopes(people, rels).values())).toEqual(new Set(['private']));
    expect(new Set(computeScopes(people, rels, 'missing').values())).toEqual(new Set(['private']));
    expect(new Set(computeScopes(people, rels, undefined, { shared: true }).values())).toEqual(new Set(['family']));
  });
});

describe('syncOnce', () => {
  it('two devices converge', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await b.run(async () => {
      await savePerson(P('cousin'));
    });

    const ra = await a.sync();
    expect(ra.pushed).toBe(7);
    const rb = await b.sync();
    expect(rb.pulled).toBe(7);
    expect(rb.pushed).toBe(1);
    await a.sync();

    const sa = await a.snapshot();
    expect(sa.people.map((p) => p.id)).toEqual(['cousin', 'me', 'mum', 'pal', 'wife']);
    expect(await b.snapshot()).toEqual(sa);
    // Full data travels to the owner's own devices (private notes included).
    expect((await b.db().people.get('pal'))!.notes).toBe('private: met at a conference');
    // Owner scopes on the server: friend and friend edge private.
    expect(cloud.get('people', 'pal')!.scope).toBe('private');
    expect(cloud.get('people', 'mum')!.scope).toBe('family');
    // Pulled rows never create tombstones.
    expect(await b.db().tombstones.count()).toBe(0);
  });

  it('re-running sync is a no-op', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    const logLen = cloud.log.length;
    const before = { a: await a.snapshot(), b: await b.snapshot() };
    for (const d of [a, b, a, b]) expect(await d.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
    expect(cloud.log.length).toBe(logLen);
    expect(await a.snapshot()).toEqual(before.a);
    expect(await b.snapshot()).toEqual(before.b);
  });

  it('a delete on one device propagates (person and their edges) without echo tombstones', async () => {
    const a = device('a');
    const b = device('b');
    const ids = await a.run(seedFamily);
    await a.sync();
    await b.sync();

    await b.run(() => deletePerson('pal'));
    const rb = await b.sync();
    expect(rb.pushed).toBe(2); // person + edge tombstones
    expect(cloud.get('people', 'pal')).toMatchObject({ deleted: true, data: { id: 'pal' } });
    // Tombstones carry no personal data.
    expect(Object.keys(cloud.get('people', 'pal')!.data)).toEqual(['id']);

    const ra = await a.sync();
    expect(ra.pulled).toBe(2);
    expect(await a.db().people.get('pal')).toBeUndefined();
    expect(await a.db().relationships.get(ids.mePal)).toBeUndefined();
    expect(await a.db().tombstones.count()).toBe(0);
    expect(await a.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
    expect(await b.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it('concurrent edits resolve by last-write-wins, in either sync order', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    const t = Date.now();

    // A edits first, B later; A syncs first.
    await a.run(async () => db.people.update('mum', { firstName: 'Mum-from-A', updatedAt: t + 1000 }));
    await b.run(async () => db.people.update('mum', { firstName: 'Mum-from-B', updatedAt: t + 2000 }));
    await a.sync();
    const rb = await b.sync();
    expect(rb.conflicts).toBe(1); // B ignored A's older version
    await a.sync();
    expect((await a.db().people.get('mum'))!.firstName).toBe('Mum-from-B');
    expect((await b.db().people.get('mum'))!.firstName).toBe('Mum-from-B');

    // Now the later writer syncs first.
    await a.run(async () => db.people.update('wife', { firstName: 'Wife-from-A', updatedAt: t + 4000 }));
    await b.run(async () => db.people.update('wife', { firstName: 'Wife-from-B', updatedAt: t + 3000 }));
    await a.sync();
    await b.sync();
    await a.sync();
    expect((await a.db().people.get('wife'))!.firstName).toBe('Wife-from-A');
    expect((await b.db().people.get('wife'))!.firstName).toBe('Wife-from-A');
    expect(await a.snapshot()).toEqual(await b.snapshot());
  });

  it('an edit made after a remote delete survives (delete vs edit is last-write-wins too)', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    await a.run(() => deletePerson('wife'));
    await b.run(async () => db.people.update('wife', { firstName: 'Edited later', updatedAt: Date.now() + 5000 }));
    await a.sync(); // pushes tombstone
    const rb = await b.sync(); // sees tombstone older than its edit: keeps and re-pushes
    expect(rb.conflicts).toBe(1);
    await a.sync();
    expect((await a.db().people.get('wife'))!.firstName).toBe('Edited later');
    expect(await a.db().tombstones.get('wife')).toBeUndefined();
    expect(cloud.get('people', 'wife')!.deleted).toBeUndefined();
    expect(await a.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it('a merge on device A propagates its deletes and re-pointed edges', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(async () => {
      await seedFamily();
      await savePerson(P('mumDup', { phones: [{ label: 'mobile', value: '+10000000000' }] }));
      await addRelationship({ fromId: 'mumDup', toId: 'me', type: 'parent' }); // duplicate after merge
      await addRelationship({ fromId: 'mumDup', toId: 'pal', type: 'neighbor' }); // moved
    });
    await a.sync();
    await b.sync();
    expect(await b.db().people.get('mumDup')).toBeDefined();

    await a.run(() => mergePeople('mum', 'mumDup'));
    await a.sync();
    await b.sync();
    const sb = await b.snapshot();
    expect(sb).toEqual(await a.snapshot());
    expect(sb.people.map((p) => p.id)).not.toContain('mumDup');
    expect(sb.rels.filter((r) => r.fromId === 'mumDup' || r.toId === 'mumDup')).toEqual([]);
    expect(sb.rels.some((r) => r.fromId === 'mum' && r.toId === 'pal' && r.type === 'neighbor')).toBe(true);
    expect(sb.rels.filter((r) => r.fromId === 'mum' && r.toId === 'me')).toHaveLength(1);
    expect((await b.db().people.get('mum'))!.phones).toEqual([{ label: 'mobile', value: '+10000000000' }]);
    expect(cloud.get('people', 'mumDup')!.deleted).toBe(true);
  });

  it('an editor sees only family and cannot push private records', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();

    await ed.sync();
    const se = await ed.snapshot();
    expect(se.people.map((p) => p.id)).toEqual(['me', 'mum', 'wife']);
    expect(se.rels.map((r) => r.type).sort()).toEqual(['parent', 'spouse']);

    // The editor adds a baby (family) and their own friend (private: friend edge only).
    await ed.run(async () => {
      await savePerson(P('baby'));
      await addRelationship({ fromId: 'me', toId: 'baby', type: 'parent' });
      await savePerson(P('edPal', { notes: "editor's private note" }));
      await addRelationship({ fromId: 'wife', toId: 'edPal', type: 'friend' });
    });
    const r = await ed.sync(); // FakeRemote rejects any private write, so this would throw
    expect(r.pushed).toBe(2);
    const byEditor = cloud.log.filter((l) => l.uid === 'uid-editor');
    expect(byEditor.every((l) => l.rec.scope === 'family')).toBe(true);
    expect(cloud.get('people', 'edPal')).toBeUndefined();

    // Deleting the private friend never reaches the cloud.
    await ed.run(() => deletePerson('edPal'));
    expect((await ed.sync()).pushed).toBe(0);

    // The owner gets the baby; nothing private from the owner was touched.
    await owner.sync();
    expect(await owner.db().people.get('baby')).toBeDefined();
    expect((await owner.db().people.get('pal'))!.notes).toBe('private: met at a conference');
  });

  it('an editor never pushes a delete of a record the remote holds as private', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    // Simulate an id the editor knows only as private (cannot happen via pulls, but be strict).
    await ed.run(async () => {
      await db.meta.update('synced:space-1', { value: { ...((await db.meta.get('synced:space-1'))!.value as object), 'people/pal': { u: 1, s: 'private' } } });
      await db.tombstones.put({ id: 'pal', table: 'people', deletedAt: Date.now() });
    });
    expect((await ed.sync()).pushed).toBe(0);
    expect(cloud.get('people', 'pal')!.deleted).toBeUndefined();
  });

  it('a viewer pulls family records and pushes nothing', async () => {
    const owner = device('owner');
    const viewer = device('viewer', 'uid-viewer', 'viewer');
    await owner.run(seedFamily);
    await owner.sync();
    const r = await viewer.sync();
    expect(r.pulled).toBe(5);
    await viewer.run(async () => {
      await savePerson(P('vNew'));
      await deletePerson('mum');
    });
    expect((await viewer.sync()).pushed).toBe(0);
    expect(cloud.log.some((l) => l.uid === 'uid-viewer')).toBe(false);
    expect(cloud.get('people', 'mum')!.deleted).toBeUndefined();
  });

  it('owner: a friend who becomes family is re-pushed as family so members get them', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    expect(await ed.db().people.get('pal')).toBeUndefined();

    // pal turns out to be a cousin's spouse... simplest: pal marries mum's other child.
    await owner.run(async () => {
      await savePerson(P('bro'));
      await addRelationship({ fromId: 'mum', toId: 'bro', type: 'parent' });
      await addRelationship({ fromId: 'bro', toId: 'pal', type: 'spouse' });
    });
    await owner.sync();
    expect(cloud.get('people', 'pal')!.scope).toBe('family');
    expect(cloud.get('relationships', (await owner.db().relationships.where({ fromId: 'me', toId: 'pal' }).first())!.id)!.scope).toBe('private');
    await ed.sync();
    expect(await ed.db().people.get('pal')).toBeDefined();

    // And back: removing the link makes them private again on the server.
    await owner.run(async () => {
      const e = await db.relationships.where({ fromId: 'bro', toId: 'pal' }).first();
      const { deleteRelationship } = await import('../db');
      await deleteRelationship(e!.id);
    });
    await owner.sync();
    expect(cloud.get('people', 'pal')!.scope).toBe('private');
    expect(await owner.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it('uses max remote updatedAt as the pull watermark and only advances it after success', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(async () => {
      await savePerson(P('skewed'));
      await db.people.update('skewed', { updatedAt: Date.now() + 10 * 60_000 }); // a clock 10 min fast
    });
    await a.sync();
    await b.sync();
    const mark = (await b.db().meta.get('pull:space-1:people'))!.value as number;
    expect(mark).toBe(cloud.get('people', 'skewed')!.updatedAt);

    // A record written by a slower clock, but within the overlap window, is still picked up.
    cloud.write(OWNER, 'people', [{ id: 'slow', rec: { data: P('slow', { updatedAt: mark - PULL_OVERLAP_MS / 2 }), scope: 'private', updatedAt: mark - PULL_OVERLAP_MS / 2, updatedBy: OWNER } }]);
    expect((await b.sync()).pulled).toBe(1);

    // A failed push leaves the push state untouched; the next sync pushes everything.
    await b.run(async () => savePerson(P('pending')));
    const local = b.db();
    const failing = { pull: async () => [], push: async () => { throw new Error('permission-denied'); } };
    await expect(syncOnce(local, failing, { uid: OWNER, role: 'owner', spaceKey: 'space-1' })).rejects.toThrow('permission-denied');
    expect((await b.sync()).pushed).toBe(1);
    expect(cloud.get('people', 'pending')).toBeDefined();
  });

  it('ignores malformed remote rows and keeps a single "me"', async () => {
    const a = device('a');
    await a.run(async () => savePerson(P('oldMe', { isMe: true })));
    await a.sync();
    const later = Date.now() + 1000;
    cloud.write(OWNER, 'people', [
      { id: 'newMe', rec: { data: P('newMe', { isMe: true }), scope: 'private', updatedAt: later, updatedBy: OWNER } },
      { id: 'junk', rec: { data: null as unknown as Person, scope: 'private', updatedAt: later, updatedBy: OWNER } },
    ]);
    cloud.write(OWNER, 'relationships', [
      { id: 'selfLink', rec: { data: { id: 'selfLink', fromId: 'newMe', toId: 'newMe', type: 'spouse', createdAt: 1 }, scope: 'private', updatedAt: later, updatedBy: OWNER } },
    ]);
    await a.sync();
    const mes = (await a.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id);
    expect(mes).toEqual(['newMe']);
    expect(await a.db().people.get('junk')).toBeUndefined();
    expect(await a.db().relationships.get('selfLink')).toBeUndefined();
  });
});

describe('full resync and forgetSpace (members must not keep un-shared data)', () => {
  /** Owner shares me/mum/wife + edges; pal is a friend. Owner then marries bro to pal so pal is family. */
  async function shareThenUnshare() {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    const viewer = device('viewer', 'uid-viewer', 'viewer');
    await owner.run(async () => {
      await seedFamily();
      await savePerson(P('bro'));
      await addRelationship({ fromId: 'mum', toId: 'bro', type: 'parent' });
      await addRelationship({ fromId: 'bro', toId: 'pal', type: 'spouse' });
    });
    await owner.sync();
    await ed.sync();
    await viewer.sync();
    expect(await ed.db().people.get('pal')).toBeDefined();
    expect(await viewer.db().people.get('pal')).toBeDefined();
    const broPal = (await owner.db().relationships.where({ fromId: 'bro', toId: 'pal' }).first())!.id;
    // The owner un-shares pal by unlinking: pal and the edge are no longer family.
    await owner.run(async () => {
      const { deleteRelationship } = await import('../db');
      await deleteRelationship(broPal);
    });
    await owner.sync();
    expect(cloud.get('people', 'pal')!.scope).toBe('private');
    return { owner, ed, viewer, broPal };
  }

  it('an incremental sync cannot see the change; a full resync prunes it for editors and viewers', async () => {
    const { ed, viewer, broPal } = await shareThenUnshare();
    // Editor has its own never-shared friend and an unpushed family record: both must survive.
    await ed.run(async () => {
      await savePerson(P('edPal'));
      await addRelationship({ fromId: 'wife', toId: 'edPal', type: 'friend' });
    });

    await ed.sync(); // pushes nothing private, cannot see pal's change
    expect(await ed.db().people.get('pal')).toBeDefined(); // the problem being fixed

    await ed.run(async () => {
      await savePerson(P('unpushed'));
      await addRelationship({ fromId: 'me', toId: 'unpushed', type: 'parent' }); // family, not yet pushed
    });
    const expectedMark = Math.max(...[...cloud.store.people.values()].filter((x) => x.scope === 'family').map((x) => x.updatedAt));
    const r = await ed.sync(undefined, { full: true });
    expect(r.pruned).toBe(1); // pal; its edge was tombstoned (family) and applied as a delete
    expect(await ed.db().people.get('pal')).toBeUndefined();
    expect(await ed.db().relationships.get(broPal)).toBeUndefined();
    expect(await ed.db().people.get('edPal')).toBeDefined();
    expect(await ed.db().people.get('unpushed')).toBeDefined();
    expect(await ed.db().tombstones.get('pal')).toBeUndefined(); // pruning creates no tombstones
    expect(cloud.get('people', 'unpushed')).toBeDefined(); // pushed after the prune
    expect(cloud.get('people', 'pal')!.deleted).toBeUndefined(); // owner's record untouched
    // Watermarks reset to the remote's max, and a second full resync is a no-op.
    const mark = (await ed.db().meta.get('pull:space-1:people'))!.value;
    expect(mark).toBe(expectedMark); // max remote updatedAt from the full pull (the push came after)
    expect(await ed.sync(undefined, { full: true })).toEqual({ pulled: 0, pushed: 0, conflicts: 0, pruned: 0 });
    expect(await ed.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });

    const rv = await viewer.sync(undefined, { full: true });
    expect(rv.pruned).toBe(1);
    expect(await viewer.db().people.get('pal')).toBeUndefined();
    expect(cloud.log.some((l) => l.uid === 'uid-viewer')).toBe(false);
  });

  it('a record un-shared directly (no edge tombstone) is pruned too, and comes back if re-shared', async () => {
    const owner = device('owner');
    const viewer = device('viewer', 'uid-viewer', 'viewer');
    await owner.run(seedFamily);
    await owner.sync();
    await viewer.sync();
    // Simulate the owner's device re-scoping the wife edge and person to private.
    const edgeId = (await owner.db().relationships.where({ fromId: 'me', toId: 'wife' }).first())!.id;
    for (const [c, id] of [['people', 'wife'], ['relationships', edgeId]] as const) {
      const rec = cloud.get(c, id)!;
      cloud.write(OWNER, c, [{ id, rec: { ...rec, scope: 'private', updatedAt: rec.updatedAt + 1 } }]);
    }
    const r = await viewer.sync(undefined, { full: true });
    expect(r.pruned).toBe(2);
    expect(await viewer.db().people.get('wife')).toBeUndefined();
    expect(await viewer.db().relationships.get(edgeId)).toBeUndefined();

    const rec = cloud.get('people', 'wife')!;
    cloud.write(OWNER, 'people', [{ id: 'wife', rec: { ...rec, scope: 'family', updatedAt: rec.updatedAt + 1 } }]);
    await viewer.sync();
    expect(await viewer.db().people.get('wife')).toBeDefined();
  });

  it('owners never prune: full resync keeps local-only and unknown rows', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    // Rows the remote lost (e.g. deleted out of band) stay on the owner's device.
    cloud.store.people.delete('pal');
    await b.run(async () => savePerson(P('localOnly')));
    const r = await b.sync(undefined, { full: true });
    expect(r.pruned).toBe(0);
    expect(await b.db().people.get('pal')).toBeDefined();
    expect(await b.db().people.get('localOnly')).toBeDefined();
    expect(await b.db().people.count()).toBe(5);
  });

  it('forgetSpace wipes a removed member\'s copy of the space and leaves other databases alone', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    expect(await ed.db().people.count()).toBe(3);

    // The member is removed; the next sync gets permission-denied and the app forgets the space.
    const denied = { pull: async () => { throw new Error('permission-denied'); }, push: async () => {} };
    const local = ed.db();
    await expect(syncOnce(local, denied, { uid: 'uid-editor', role: 'editor', spaceKey: 'space-1' })).rejects.toThrow('permission-denied');
    expect(activeSpaceId()).toBe(ed.space);
    await forgetSpace(ed.space);
    expect(activeSpaceId()).toBeNull(); // switched back to the local database
    expect(await Dexie.exists(dbNameFor(ed.space))).toBe(false);

    // Re-opening that space starts empty, without stale meta.
    openSpaceDb(ed.space);
    expect(await db.people.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);

    // The owner's data is unaffected.
    expect(await owner.db().people.count()).toBe(4);
    expect(cloud.alive('people')).toHaveLength(4);
  });

  it('forgetSpace also clears that space\'s meta keys from the active database', async () => {
    openSpaceDb(null);
    await db.meta.bulkPut([
      { key: 'synced:gone', value: {} },
      { key: 'pull:gone:people', value: 1 },
      { key: 'lastPushedAt:gone', value: 1 },
      { key: 'synced:gone-but-different', value: {} },
    ]);
    await forgetSpace('gone');
    expect((await db.meta.toArray()).map((m) => m.key)).toEqual(['synced:gone-but-different']);
    await db.meta.clear();
    await expect(forgetSpace('')).rejects.toThrow();
  });
});
