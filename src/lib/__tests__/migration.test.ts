import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { LineageDB, addRelationship, db, deletePerson, openSpaceDb, savePerson } from '../db';
import { emptyPerson } from '../person';

let n = 0;
const freshName = () => `migration-test-${++n}-${Date.now()}`;

/** Exactly the version-1 schema as released. */
async function createV1(name: string, people: object[], rels: object[]) {
  const v1 = new Dexie(name);
  v1.version(1).stores({
    people: 'id, firstName, lastName, updatedAt, *tags',
    relationships: 'id, fromId, toId, type, [fromId+toId]',
  });
  await v1.open();
  await v1.table('people').bulkPut(people);
  await v1.table('relationships').bulkPut(rels);
  v1.close();
}

const samplePeople = [
  { ...emptyPerson({ id: 'p-me', firstName: 'Testa', lastName: 'Example', isMe: true }), createdAt: 100, updatedAt: 150 },
  { ...emptyPerson({ id: 'p-mum', firstName: 'Mira', lastName: 'Example', notes: 'private note', photo: 'data:image/png;base64,AAAA' }), createdAt: 110, updatedAt: 120 },
  { ...emptyPerson({ id: 'p-pal', firstName: 'Quill', tags: ['school'] }), createdAt: 130, updatedAt: 130 },
  // A hand-made/legacy row without updatedAt.
  { id: 'p-legacy', firstName: 'Old', gender: 'unknown', phones: [], emails: [], work: [], education: [], facts: [], tags: [], createdAt: 90 },
];
const sampleRels = [
  { id: 'r-parent', fromId: 'p-mum', toId: 'p-me', type: 'parent', subtype: 'biological', note: 'n', createdAt: 200 },
  { id: 'r-friend', fromId: 'p-me', toId: 'p-pal', type: 'close_friend', createdAt: 210 },
  // A row with no createdAt at all.
  { id: 'r-weird', fromId: 'p-pal', toId: 'p-legacy', type: 'friend' },
];

describe('Dexie v1 -> v2 migration', () => {
  it('backfills relationship updatedAt from createdAt and loses nothing', async () => {
    const name = freshName();
    await createV1(name, samplePeople, sampleRels);

    const before = Date.now();
    const v2 = new LineageDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);

    // People: every row and field kept; only a missing updatedAt is backfilled (from createdAt).
    const people = await v2.people.orderBy('id').toArray();
    expect(people.map((p) => p.id)).toEqual(['p-legacy', 'p-me', 'p-mum', 'p-pal']);
    for (const orig of samplePeople) {
      const got = people.find((p) => p.id === orig.id)!;
      expect(got).toMatchObject(orig);
    }
    expect(people.find((p) => p.id === 'p-legacy')!.updatedAt).toBe(90);
    expect(people.find((p) => p.id === 'p-me')!.updatedAt).toBe(150); // existing value untouched

    // Relationships: all kept with every field; updatedAt = createdAt.
    const rels = await v2.relationships.orderBy('id').toArray();
    expect(rels.map((r) => r.id)).toEqual(['r-friend', 'r-parent', 'r-weird']);
    for (const orig of sampleRels) expect(rels.find((r) => r.id === orig.id)).toMatchObject(orig);
    expect(rels.find((r) => r.id === 'r-parent')!.updatedAt).toBe(200);
    expect(rels.find((r) => r.id === 'r-friend')!.updatedAt).toBe(210);
    expect(rels.find((r) => r.id === 'r-weird')!.updatedAt).toBeGreaterThanOrEqual(before);

    // Indexes still work, and the new index answers queries.
    expect(await v2.relationships.where('[fromId+toId]').equals(['p-mum', 'p-me']).count()).toBe(1);
    expect(await v2.people.where('tags').equals('school').count()).toBe(1);
    expect((await v2.relationships.where('updatedAt').below(205).toArray()).map((r) => r.id)).toEqual(['r-parent']);

    // New tables exist and start empty.
    expect(await v2.tombstones.count()).toBe(0);
    expect(await v2.meta.count()).toBe(0);
    v2.close();

    // Re-opening at v2 is stable (upgrade does not run twice / change anything).
    const again = new LineageDB(name);
    expect(await again.relationships.get('r-parent')).toMatchObject({ updatedAt: 200 });
    again.close();
  });

  it('an empty v1 database upgrades cleanly', async () => {
    const name = freshName();
    await createV1(name, [], []);
    const v2 = new LineageDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.people.count()).toBe(0);
    v2.close();
  });

  it('the default local database upgrades in place and helpers work on it', async () => {
    await createV1('lineage', samplePeople, sampleRels);
    openSpaceDb(null);
    expect(await db.people.count()).toBe(4);
    expect((await db.relationships.get('r-friend'))!.updatedAt).toBe(210);
    await savePerson(emptyPerson({ id: 'p-new', firstName: 'Nova' }));
    await addRelationship({ fromId: 'p-mum', toId: 'p-new', type: 'parent' });
    await deletePerson('p-pal');
    expect(await db.tombstones.get('p-pal')).toMatchObject({ table: 'people' });
    expect(await db.tombstones.get('r-friend')).toMatchObject({ table: 'relationships' });
    expect(await db.people.count()).toBe(4);
  });
});
