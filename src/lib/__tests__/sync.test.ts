import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../cloud/contract';
import { activeSpaceId, addRelationship, db, dbNameFor, deletePerson, forgetSpace, mergePeople, openSpaceDb, savePerson } from '../db';
import Dexie from 'dexie';
import { emptyPerson } from '../person';
import { computeScopes, MAX_SKEW_MS, PULL_OVERLAP_MS, syncOnce } from '../sync';
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
/** Person data of a cloud record. */
const cp = (id: string) => cloud.get('people', id)!.data as Person;

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
    const tick = () => new Promise((r) => setTimeout(r, 2));
    const edit = (id: string, firstName: string) => async () => {
      await tick();
      await savePerson({ ...(await db.people.get(id))!, firstName });
    };

    // A edits first, B later; A syncs first.
    await a.run(edit('mum', 'Mum-from-A'));
    await b.run(edit('mum', 'Mum-from-B'));
    await a.sync();
    const rb = await b.sync();
    expect(rb.conflicts).toBe(1); // B ignored A's older version
    await a.sync();
    expect((await a.db().people.get('mum'))!.firstName).toBe('Mum-from-B');
    expect((await b.db().people.get('mum'))!.firstName).toBe('Mum-from-B');

    // Now the later writer syncs first.
    await b.run(edit('wife', 'Wife-from-B'));
    await a.run(edit('wife', 'Wife-from-A'));
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

  it('uses max remote updatedAt (capped at the local pull time) as the pull watermark and only advances it after success', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(async () => {
      await savePerson(P('old'));
      await db.people.update('old', { updatedAt: Date.now() - 10 * 60_000 });
    });
    await a.sync();
    await b.sync();
    expect((await b.db().meta.get('pull:space-1:people'))!.value).toBe(cloud.get('people', 'old')!.updatedAt);

    // Another client whose clock is 4 min fast (still accepted by the rules).
    const fast = Date.now() + 4 * 60_000;
    cloud.write(OWNER, 'people', [{ id: 'skewed', rec: { data: P('skewed', { updatedAt: fast }), scope: 'private', updatedAt: fast, updatedBy: OWNER } }]);
    const before = Date.now();
    expect((await b.sync()).pulled).toBe(1);
    const mark = (await b.db().meta.get('pull:space-1:people'))!.value as number;
    // Capped at b's clock, so honest writes made after the skewed one are not skipped.
    expect(mark).toBeGreaterThanOrEqual(before);
    expect(mark).toBeLessThanOrEqual(Date.now());
    expect(mark).toBeLessThan(cloud.get('people', 'skewed')!.updatedAt);

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

describe('hostile or broken remote data', () => {
  const FAR = 9e15;

  it('a far-future record is rejected and does not freeze pulls or block the owner\'s pushes', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    await a.sync(); // a now has a pull watermark too
    // Planted with a far-future stamp (legacy data, or written before the rules were fixed).
    const mum = cloud.get('people', 'mum')!;
    cloud.write('uid-editor', 'people', [{ id: 'mum', rec: { ...mum, data: { ...mum.data, firstName: 'Hijacked' } as Person, updatedAt: FAR } }]);
    cloud.write('uid-editor', 'people', [{ id: 'evil', rec: { data: P('evil'), scope: 'family', updatedAt: FAR, updatedBy: 'uid-editor' } }]);

    const markBefore = (await a.db().meta.get('pull:space-1:people'))!.value as number;
    const ra = await a.sync();
    expect(ra.rejected).toBe(2);
    expect(ra.pulled).toBe(0);
    expect((await a.db().people.get('mum'))!.firstName).toBe('mum');
    expect(await a.db().people.get('evil')).toBeUndefined();
    const mark = (await a.db().meta.get('pull:space-1:people'))!.value as number;
    expect(mark).toBe(markBefore);
    expect(mark).toBeLessThanOrEqual(Date.now());
    const synced = (await a.db().meta.get('synced:space-1'))!.value as Record<string, { u: number }>;
    expect(Object.values(synced).every((e) => e.u < FAR)).toBe(true);

    // The owner keeps editing on A; the edits push and reach B.
    await a.run(async () => {
      await savePerson({ ...(await db.people.get('wife'))!, firstName: 'Wife v2' });
      await savePerson(P('newKid'));
      await addRelationship({ fromId: 'me', toId: 'newKid', type: 'parent' });
      // Editing the poisoned record itself cannot be pushed (the rules refuse it), but must not
      // fail the batch for everything else.
      await savePerson({ ...(await db.people.get('mum'))!, notes: 'edited' });
    });
    const ra2 = await a.sync();
    expect(ra2.pushed).toBe(3);
    expect(ra2.rejected).toBe(2);
    expect(cp('wife').firstName).toBe('Wife v2');
    expect(cloud.get('people', 'mum')!.updatedAt).toBe(FAR);

    const rb = await b.sync();
    expect(rb.rejected).toBe(2);
    expect((await b.db().people.get('wife'))!.firstName).toBe('Wife v2');
    expect(await b.db().people.get('newKid')).toBeDefined();
    expect((await b.db().people.get('mum'))!.firstName).toBe('mum');

    // Once the bad record is gone from the server, the owner's pending edit goes through.
    cloud.store.people.set('mum', { ...mum, updatedAt: mum.updatedAt });
    cloud.store.people.delete('evil');
    const ra3 = await a.sync();
    expect(ra3.rejected).toBeUndefined();
    expect(cp('mum').notes).toBe('edited');
  });

  it('heals a device whose watermark and synced map were already poisoned', async () => {
    const a = device('a');
    await a.run(seedFamily);
    await a.sync();
    await a.run(async () => {
      await db.meta.put({ key: 'pull:space-1:people', value: FAR });
      const synced = (await db.meta.get('synced:space-1'))!.value as Record<string, { u: number; s: string }>;
      await db.meta.put({ key: 'synced:space-1', value: { ...synced, 'people/wife': { u: FAR, s: 'family' } } });
    });
    // Another device of the owner writes after the poisoning.
    cloud.write(OWNER, 'people', [{ id: 'late', rec: { data: P('late'), scope: 'private', updatedAt: Date.now(), updatedBy: OWNER } }]);
    await a.run(async () => savePerson({ ...(await db.people.get('wife'))!, firstName: 'Wife v2' }));
    const r = await a.sync();
    expect(await a.db().people.get('late')).toBeDefined();
    expect(r.pushed).toBe(1);
    expect(cp('wife').firstName).toBe('Wife v2');
    expect((await a.db().meta.get('pull:space-1:people'))!.value as number).toBeLessThanOrEqual(Date.now());
    expect(await a.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it('FakeRemote mirrors the rules: future and non-increasing updatedAt are refused', async () => {
    const r = cloud.as(OWNER, 'owner');
    const rec = (u: number) => ({ data: P('x'), scope: 'private' as const, updatedAt: u, updatedBy: OWNER });
    await expect(r.push('people', [{ id: 'x', rec: rec(Date.now() + MAX_SKEW_MS + 60_000) }])).rejects.toThrow('permission-denied');
    const t = Date.now();
    await r.push('people', [{ id: 'x', rec: rec(t) }]);
    await expect(r.push('people', [{ id: 'x', rec: rec(t) }])).rejects.toThrow('permission-denied');
    await expect(r.push('people', [{ id: 'x', rec: rec(t - 1) }])).rejects.toThrow('permission-denied');
    await r.push('people', [{ id: 'x', rec: rec(t + 1) }]);
  });

  it('an editor-planted isMe is ignored on the owner\'s device and scopes still use the real me', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    // The editor marks mum as "me" locally and edits the owner's real me, dropping isMe from it. Its
    // pushes conform to the rules: data.isMe is sent back exactly as the remote holds it.
    await ed.run(async () => {
      await db.people.update('mum', { isMe: true, updatedAt: Date.now() + 1 });
      await db.people.update('me', { isMe: undefined, firstName: 'me (edited)', updatedAt: Date.now() + 1 });
    });
    expect((await ed.sync()).pushed).toBe(2); // FakeRemote refuses any isMe change by an editor
    expect(cp('mum').isMe).toBeUndefined();
    expect(cloud.get('people', 'me')!.data).toMatchObject({ isMe: true, firstName: 'me (edited)' });

    // A legacy record (written before the rules) where an editor planted isMe on mum.
    await new Promise((r) => setTimeout(r, 2));
    const mum = cloud.get('people', 'mum')!;
    cloud.write('uid-editor', 'people', [{ id: 'mum', rec: { ...mum, data: { ...mum.data, isMe: true } as Person, updatedAt: Date.now() } }]);

    const ro = await owner.sync();
    expect(ro.pushed).toBe(1); // the owner's corrected mum goes back to the server
    expect(cp('mum').isMe).toBeUndefined();
    expect(cp('me').isMe).toBe(true);
    const people = await owner.db().people.toArray();
    expect(people.filter((p) => p.isMe).map((p) => p.id)).toEqual(['me']);
    expect((await owner.db().people.get('me'))!.firstName).toBe('me (edited)'); // the edit itself applies
    const rels = await owner.db().relationships.toArray();
    const scopes = computeScopes(people, rels, people.find((p) => p.isMe)?.id);
    expect(scopes.get('pal')).toBe('private');
    expect(scopes.get('mum')).toBe('family');
    // And the owner's next push keeps the friend private on the server.
    await owner.sync();
    expect(cloud.get('people', 'pal')!.scope).toBe('private');

    // The owner's own devices still move "me" between people.
    const b = device('b');
    await b.sync();
    expect((await b.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['me']);
    await new Promise((r) => setTimeout(r, 5)); // a later millisecond than the re-stamp
    await owner.run(async () => savePerson({ ...(await db.people.get('wife'))!, isMe: true }));
    await owner.sync();
    await b.sync();
    expect((await b.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['wife']);
  });

  it('a fresh owner device takes one "me" from foreign rows and never clears the real one remotely', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    // The editor's legitimate edit of the owner's me (isMe preserved by the push rules) ...
    await ed.run(async () => db.people.update('me', { firstName: 'me (edited)', updatedAt: Date.now() + 1 }));
    await ed.sync();
    // ... and a legacy plant on wife, written later.
    const wife = cloud.get('people', 'wife')!;
    cloud.write('uid-editor', 'people', [{ id: 'wife', rec: { ...wife, data: { ...wife.data, isMe: true } as Person, updatedAt: Date.now() + 2 } }]);
    const b = device('b');
    const r = await b.sync();
    expect(r.pushed).toBe(0); // nothing "corrected" from a device that had no opinion
    expect((await b.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['me']);
    expect(cp('me').isMe).toBe(true);
  });

  it('with ownerUid, members accept "me" only from the owner', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    const viewer = device('viewer', 'uid-viewer', 'viewer');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    const vsync = () => syncOnce(viewer.db(), cloud.as('uid-viewer', 'viewer'), { uid: 'uid-viewer', role: 'viewer', spaceKey: 'space-1', ownerUid: OWNER });
    await vsync();
    expect((await viewer.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['me']);
    // Legacy data: another editor planted isMe on wife.
    const wife = cloud.get('people', 'wife')!;
    cloud.write('uid-editor', 'people', [{ id: 'wife', rec: { ...wife, data: { ...wife.data, isMe: true } as Person, updatedAt: wife.updatedAt + 1 } }]);
    expect((await vsync()).pulled).toBe(1);
    expect((await viewer.db().people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['me']);
  });

  it('pushes always conform: strictly increasing, never in the future, valid photo only', async () => {
    const a = device('a');
    const b = device('b');
    await a.run(seedFamily);
    await a.sync();
    await b.sync();
    // Local rows stamped in the future (a fast clock, or rows poisoned before this fix).
    await a.run(async () => {
      await db.people.update('mum', { firstName: 'Mum v2', updatedAt: Date.now() + 60 * 60_000 });
      await db.people.update('wife', {
        photo: 'DATA:IMAGE/JPG;BASE64,iVBO\nRw0K',
        updatedAt: Date.now(),
      });
      await savePerson(P('gif', { photo: 'data:image/gif;base64,R0lGODlh' }));
    });
    const before = cloud.log.length;
    const r = await a.sync(); // FakeRemote would throw on any non-conforming write
    expect(r.pushed).toBe(3);
    const now = Date.now();
    for (const l of cloud.log.slice(before)) expect(l.rec.updatedAt).toBeLessThanOrEqual(now);
    expect(cp('mum').firstName).toBe('Mum v2');
    expect((await a.db().people.get('mum'))!.updatedAt).toBeLessThanOrEqual(now); // re-stamped locally
    expect(cp('wife').photo).toBe('data:image/jpeg;base64,iVBORw0K');
    expect('photo' in cloud.get('people', 'gif')!.data).toBe(false);
    expect((await a.db().people.get('gif'))!.photo).toBe('data:image/gif;base64,R0lGODlh'); // kept locally
    expect(await a.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0 });

    // A delete in the same millisecond as the remote version is pushed with +1.
    const pal = cloud.get('people', 'pal')!;
    await a.run(async () => {
      await deletePerson('pal');
      await db.tombstones.update('pal', { deletedAt: pal.updatedAt });
    });
    await a.sync();
    expect(cloud.get('people', 'pal')).toMatchObject({ deleted: true, updatedAt: pal.updatedAt + 1 });
  });

  it('an editor never pushes a delete of the owner\'s "me" (it would clear isMe)', async () => {
    const owner = device('owner');
    const ed = device('editor', 'uid-editor', 'editor');
    await owner.run(seedFamily);
    await owner.sync();
    await ed.sync();
    await ed.run(async () => {
      await deletePerson('me');
      await deletePerson('wife');
    });
    const r = await ed.sync();
    expect(r.pushed).toBe(1 + 2); // wife + the two edges touching me (mum-me, me-wife)
    expect(cloud.get('people', 'me')!.deleted).toBeUndefined();
    expect(cloud.get('people', 'wife')!.deleted).toBe(true);
  });

  it('drops pulled photos that are not a small png/jpeg/webp data URL', async () => {
    const a = device('a');
    const good = 'data:image/png;base64,iVBORw0KGgo=';
    const bad: Record<string, unknown> = {
      svg: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      remote: 'https://tracker.example/pixel.png',
      js: 'javascript:alert(1)',
      junk: 'data:image/png;base64,abc"onerror=alert(1)',
      huge: 'data:image/jpeg;base64,' + 'A'.repeat(300_000),
      notString: 42,
    };
    const t = Date.now();
    cloud.write(OWNER, 'people', [
      { id: 'good', rec: { data: P('good', { photo: good }), scope: 'private', updatedAt: t, updatedBy: OWNER } },
      ...Object.entries(bad).map(([id, photo]) => ({ id, rec: { data: { ...P(id), photo } as Person, scope: 'private' as const, updatedAt: t, updatedBy: OWNER } })),
    ]);
    expect((await a.sync()).pulled).toBe(7);
    expect((await a.db().people.get('good'))!.photo).toBe(good);
    for (const id of Object.keys(bad)) {
      const p = await a.db().people.get(id);
      expect(p, id).toBeDefined();
      expect(p!.photo, id).toBeUndefined();
    }
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
