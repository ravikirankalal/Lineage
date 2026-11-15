import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRelationship,
  deletePerson,
  deleteRelationship,
  ensureRelationship,
  ops,
  purgeLooseContacts,
  purgeNonFamilyLinks,
  mergePeople,
  previewMerge,
  savePerson,
} from '../db';
import { emptyPerson } from '../person';
import { store, write } from '../store';
import { freshSpace, type MemoryBackend, type TestDb } from './memoryBackend';

const person = (id: string, extra: Parameters<typeof emptyPerson>[0] = {}) => emptyPerson({ id, firstName: id, ...extra });

// Each test gets a fresh, empty in-memory space; `db` seeds and inspects it.
let db: TestDb;
let backend: MemoryBackend;
beforeEach(() => {
  ({ db, backend } = freshSpace());
});

describe('addRelationship on an existing edge', () => {
  beforeEach(async () => {
    await db.people.bulkPut([person('P'), person('X')]);
  });

  it('keeps subtype and note when the caller does not pass them', async () => {
    const id = await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'adoptive', note: 'adopted 1990' });
    const again = await addRelationship({ fromId: 'P', toId: 'X', type: 'parent' });
    expect(again).toBe(id);
    const r = await db.relationships.get(id);
    expect(r?.subtype).toBe('adoptive');
    expect(r?.note).toBe('adopted 1990');
    expect(await db.relationships.count()).toBe(1);
  });

  it('updates only the fields that are passed', async () => {
    const id = await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'adoptive', note: 'adopted 1990' });
    await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'foster' });
    let r = await db.relationships.get(id);
    expect(r?.subtype).toBe('foster');
    expect(r?.note).toBe('adopted 1990');
    await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', note: 'updated' });
    r = await db.relationships.get(id);
    expect(r?.subtype).toBe('foster');
    expect(r?.note).toBe('updated');
  });

  it('ensureRelationship returns the existing id without touching it', async () => {
    const id = await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'adoptive', note: 'adopted 1990' });
    const again = await ensureRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'biological', note: 'other' });
    expect(again).toBe(id);
    const r = await db.relationships.get(id);
    expect(r?.subtype).toBe('adoptive');
    expect(r?.note).toBe('adopted 1990');
  });

  it('ensureRelationship finds symmetric edges in either direction and creates missing ones', async () => {
    const id = await addRelationship({ fromId: 'P', toId: 'X', type: 'spouse', subtype: 'divorced' });
    expect(await ensureRelationship({ fromId: 'X', toId: 'P', type: 'spouse', subtype: 'married' })).toBe(id);
    expect((await db.relationships.get(id))?.subtype).toBe('divorced');
    const sib = await ensureRelationship({ fromId: 'P', toId: 'X', type: 'sibling' });
    expect(sib).not.toBe(id);
    expect(await db.relationships.count()).toBe(2);
  });
});

describe('parent cycles', () => {
  beforeEach(async () => {
    await db.people.bulkPut(['A', 'B', 'C', 'D'].map((id) => person(id)));
  });

  it('rejects self-links', async () => {
    await expect(addRelationship({ fromId: 'A', toId: 'A', type: 'friend' })).rejects.toThrow(/themselves/);
  });

  it('rejects a two-person cycle', async () => {
    await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' });
    await expect(addRelationship({ fromId: 'B', toId: 'A', type: 'parent' })).rejects.toThrow('That would make someone their own ancestor.');
  });

  it('rejects longer cycles', async () => {
    await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' });
    await addRelationship({ fromId: 'B', toId: 'C', type: 'parent' });
    await addRelationship({ fromId: 'C', toId: 'D', type: 'parent' });
    await expect(addRelationship({ fromId: 'C', toId: 'A', type: 'parent' })).rejects.toThrow('That would make someone their own ancestor.');
    await expect(addRelationship({ fromId: 'D', toId: 'A', type: 'parent' })).rejects.toThrow('That would make someone their own ancestor.');
    await expect(ensureRelationship({ fromId: 'D', toId: 'B', type: 'parent' })).rejects.toThrow('That would make someone their own ancestor.');
    expect(await db.relationships.count()).toBe(3);
  });

  it('allows non-cyclic shapes (shared descendants, non-parent edges back up)', async () => {
    await addRelationship({ fromId: 'A', toId: 'C', type: 'parent' });
    await addRelationship({ fromId: 'B', toId: 'C', type: 'parent' });
    await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' }); // A is grandparent and parent of C: odd but acyclic
    await addRelationship({ fromId: 'C', toId: 'A', type: 'friend' });
    expect(await db.relationships.count()).toBe(4);
  });
});

describe('mergePeople', () => {
  const rel = (id: string, fromId: string, toId: string, type: Parameters<typeof addRelationship>[0]['type'], extra = {}) => ({
    id,
    fromId,
    toId,
    type,
    createdAt: 1,
    ...extra,
  });

  it('fills keep\'s empty fields from drop and reports conflicts', async () => {
    await db.people.bulkPut([
      person('K', {
        firstName: 'Testa',
        birthDate: '1988',
        gender: 'unknown',
        notes: 'Met at school',
        origin: { city: 'Springfield' },
        createdAt: 500,
      }),
      person('D', {
        firstName: 'Testa',
        lastName: 'Person',
        nickname: 'R',
        birthDate: '1987',
        gender: 'male',
        deceased: true,
        notes: 'Likes cricket',
        origin: { city: 'Shelbyville' },
        address: { city: 'Ogdenville' },
        occupation: 'Engineer',
        photo: 'data:image/png;base64,xx',
        tags: ['school', 'Family'],
        facts: [{ label: 'Blood group', value: 'O+' }],
        work: [{ organization: 'Acme' }],
        education: [{ institution: 'Example College' }],
        createdAt: 100,
      }),
    ]);
    await db.people.update('K', {
      tags: ['School'],
      facts: [{ label: 'blood group', value: 'o+' }],
      work: [{ organization: 'acme', role: 'Lead' }],
    });
    const preview = await previewMerge('K', 'D');
    expect(preview.conflicts).toEqual(['Birth date: 1988 kept, 1987 dropped', 'Origin: Springfield kept, Shelbyville dropped']);
    expect(await db.people.count()).toBe(2); // preview did not write

    await mergePeople('K', 'D');
    expect(await db.people.get('D')).toBeUndefined();
    const k = (await db.people.get('K'))!;
    expect(k).toMatchObject({
      firstName: 'Testa',
      lastName: 'Person',
      nickname: 'R',
      birthDate: '1988',
      gender: 'male',
      deceased: true,
      origin: { city: 'Springfield' },
      address: { city: 'Ogdenville' },
      occupation: 'Engineer',
      photo: 'data:image/png;base64,xx',
      notes: 'Met at school\n\nLikes cricket',
      createdAt: 100,
    });
    expect(k.tags).toEqual(['School', 'Family']);
    expect(k.facts).toHaveLength(1);
    expect(k.work).toEqual([{ organization: 'acme', role: 'Lead' }]);
    expect(k.education).toEqual([{ institution: 'Example College' }]);
  });

  it('tolerates old rows missing list fields', async () => {
    const legacy = { id: 'L', firstName: 'Old', gender: 'unknown', createdAt: 1, updatedAt: 1 } as unknown as ReturnType<typeof person>;
    await db.people.bulkPut([person('K', { phones: [{ label: 'mobile', value: '5550100000' }] }), legacy]);
    await mergePeople('K', 'L');
    const k = (await db.people.get('K'))!;
    expect(k.phones).toHaveLength(1);
    expect(k.tags).toEqual([]);
    expect(k.createdAt).toBe(1);
  });

  it('unions phones by last 10 digits and emails case-insensitively', async () => {
    await db.people.bulkPut([
      person('K', {
        phones: [{ label: 'mobile', value: '+91 00000 00001' }],
        emails: [{ label: 'home', value: 'Testa@Example.com' }],
      }),
      person('D', {
        phones: [
          { label: 'mobile', value: '000000-00001' },
          { label: 'work', value: '555-0100' },
        ],
        emails: [
          { label: 'home', value: ' testa@example.com ' },
          { label: 'work', value: 'testa@example.org' },
        ],
      }),
    ]);
    await mergePeople('K', 'D');
    const k = (await db.people.get('K'))!;
    expect(k.phones.map((x) => x.value)).toEqual(['+91 00000 00001', '555-0100']);
    expect(k.emails.map((x) => x.value)).toEqual(['Testa@Example.com', 'testa@example.org']);
  });

  it('re-points drop\'s edges to keep', async () => {
    await db.people.bulkPut(['K', 'D', 'P', 'C', 'F'].map((id) => person(id)));
    await db.relationships.bulkPut([
      rel('r1', 'P', 'D', 'parent', { subtype: 'adoptive' }),
      rel('r2', 'D', 'C', 'parent'),
      rel('r3', 'F', 'D', 'friend', { note: 'college' }),
    ]);
    expect(await previewMerge('K', 'D')).toMatchObject({ relationshipsMoved: 3, duplicatesDropped: 0 });
    await mergePeople('K', 'D');
    const rels = (await db.relationships.toArray()).sort((a, b) => a.id.localeCompare(b.id));
    expect(rels.map((r) => [r.id, r.fromId, r.toId, r.type])).toEqual([
      ['r1', 'P', 'K', 'parent'],
      ['r2', 'K', 'C', 'parent'],
      ['r3', 'F', 'K', 'friend'],
    ]);
    expect(rels[0].subtype).toBe('adoptive');
    expect(rels[2].note).toBe('college');
  });

  it('collapses duplicate edges, preferring keep\'s subtype/note but filling an empty note', async () => {
    await db.people.bulkPut(['K', 'D', 'P', 'S', 'F'].map((id) => person(id)));
    await db.relationships.bulkPut([
      rel('k1', 'P', 'K', 'parent', { subtype: 'biological' }),
      rel('d1', 'P', 'D', 'parent', { subtype: 'adoptive', note: 'from drop' }),
      rel('k2', 'K', 'S', 'spouse', { subtype: 'married', note: 'keep note' }),
      rel('d2', 'S', 'D', 'spouse', { subtype: 'divorced', note: 'drop note' }), // symmetric, reversed
      rel('k3', 'F', 'K', 'friend'),
      rel('d3', 'D', 'F', 'friend', { note: 'met in 2001' }),
    ]);
    expect(await previewMerge('K', 'D')).toMatchObject({ relationshipsMoved: 0, duplicatesDropped: 3 });
    await mergePeople('K', 'D');
    const rels = await db.relationships.toArray();
    expect(rels.map((r) => r.id).sort()).toEqual(['k1', 'k2', 'k3']);
    expect(await db.relationships.get('k1')).toMatchObject({ subtype: 'biological', note: 'from drop' });
    expect(await db.relationships.get('k2')).toMatchObject({ subtype: 'married', note: 'keep note' });
    expect((await db.relationships.get('k3'))?.note).toBe('met in 2001');
  });

  it('copies drop\'s subtype onto a duplicate edge when keep\'s has none, and reports differing subtypes', async () => {
    await db.people.bulkPut([
      person('K'),
      person('D', { firstName: 'K' }),
      person('P', { firstName: 'Kiran', lastName: 'Example' }),
      person('S', { firstName: 'Testa', lastName: 'Spouse' }),
      person('B'),
      person('Q', { firstName: 'Other', lastName: 'Parent' }),
    ]);
    await db.relationships.bulkPut([
      rel('k1', 'P', 'K', 'parent'),
      rel('d1', 'P', 'D', 'parent', { subtype: 'adoptive' }),
      rel('k2', 'S', 'K', 'spouse'),
      rel('d2', 'D', 'S', 'spouse', { subtype: 'divorced' }),
      rel('k3', 'K', 'B', 'sibling'),
      rel('d3', 'B', 'D', 'sibling', { subtype: 'half' }),
      rel('k4', 'Q', 'K', 'parent', { subtype: 'adoptive' }),
      rel('d4', 'Q', 'D', 'parent', { subtype: 'biological' }),
    ]);
    const preview = await previewMerge('K', 'D');
    expect(preview).toMatchObject({ relationshipsMoved: 0, duplicatesDropped: 4 });
    expect(preview.conflicts).toEqual(['Link to Other Parent: adoptive parent kept, biological dropped']);
    expect((await db.relationships.get('k1'))?.subtype).toBeUndefined(); // preview did not write
    await mergePeople('K', 'D');
    expect((await db.relationships.toArray()).map((r) => r.id).sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    expect((await db.relationships.get('k1'))?.subtype).toBe('adoptive');
    expect((await db.relationships.get('k2'))?.subtype).toBe('divorced');
    expect((await db.relationships.get('k3'))?.subtype).toBe('half');
    expect((await db.relationships.get('k4'))?.subtype).toBe('adoptive');
  });

  it('removes sibling/spouse links that the merge turns into links with a parent, child or ancestor', async () => {
    // S is K's parent; D is S's sibling. G is S's parent (K's grandparent); D is G's spouse.
    // C is D's child; K is already C's sibling.
    await db.people.bulkPut([
      person('K'),
      person('D', { firstName: 'K' }),
      person('S', { firstName: 'Testa', lastName: 'Person' }),
      person('G', { firstName: 'Grand', lastName: 'Example' }),
      person('C', { firstName: 'Kiran', lastName: 'Example' }),
      person('F'),
    ]);
    await db.relationships.bulkPut([
      rel('p1', 'S', 'K', 'parent'),
      rel('p2', 'G', 'S', 'parent'),
      rel('sib', 'D', 'S', 'sibling'),
      rel('sp', 'G', 'D', 'spouse'),
      rel('pc', 'D', 'C', 'parent'),
      rel('kc', 'K', 'C', 'sibling'),
      rel('fr', 'D', 'F', 'friend'),
    ]);
    const preview = await previewMerge('K', 'D');
    expect(preview).toMatchObject({ relationshipsMoved: 2, duplicatesDropped: 3 });
    expect([...preview.conflicts].sort()).toEqual([
      'Removed sibling link to Kiran Example: they are also a child',
      'Removed sibling link to Testa Person: they are also a parent',
      'Removed spouse link to Grand Example: they are also an ancestor',
    ]);
    await mergePeople('K', 'D');
    const rels = (await db.relationships.toArray()).sort((a, b) => a.id.localeCompare(b.id));
    expect(rels.map((r) => [r.id, r.fromId, r.toId, r.type])).toEqual([
      ['fr', 'K', 'F', 'friend'],
      ['p1', 'S', 'K', 'parent'],
      ['p2', 'G', 'S', 'parent'],
      ['pc', 'K', 'C', 'parent'],
    ]);
  });

  it('leaves contradictions that already existed on keep alone', async () => {
    await db.people.bulkPut([person('K'), person('D', { firstName: 'K' }), person('S'), person('X')]);
    await db.relationships.bulkPut([rel('p', 'S', 'K', 'parent'), rel('s', 'K', 'S', 'sibling'), rel('x', 'D', 'X', 'friend')]);
    expect(await previewMerge('K', 'D')).toMatchObject({ relationshipsMoved: 1, duplicatesDropped: 0, conflicts: [] });
    await mergePeople('K', 'D');
    expect((await db.relationships.toArray()).map((r) => r.id).sort()).toEqual(['p', 's', 'x']);
  });

  it('keeps drop\'s differing names searchable in otherNames', async () => {
    await db.people.bulkPut([
      person('K', { firstName: 'Testa', lastName: 'Person', nickname: 'Tess', otherNames: 'T. Person, Maiden Example' }),
      person('D', { firstName: 'Kiran', lastName: 'Example', nickname: 'Kiki', otherNames: 'maiden example, Alias One' }),
      person('E', { firstName: 'testa', lastName: 'PERSON', nickname: 'tess' }),
      person('N'),
      person('M', { firstName: 'Mono', nickname: 'Mo' }),
    ]);
    const preview = await previewMerge('K', 'D');
    expect(preview.conflicts).toEqual(
      expect.arrayContaining(['First name: Testa kept, Kiran dropped', 'Nickname: Tess kept, Kiki dropped']),
    );
    await mergePeople('K', 'D');
    let k = (await db.people.get('K'))!;
    expect(k).toMatchObject({ firstName: 'Testa', lastName: 'Person', nickname: 'Tess' });
    expect(k.otherNames).toBe('T. Person, Maiden Example, Alias One, Kiran Example, Kiki');

    // Same names differing only in case add nothing.
    await mergePeople('K', 'E');
    k = (await db.people.get('K'))!;
    expect(k.otherNames).toBe('T. Person, Maiden Example, Alias One, Kiran Example, Kiki');

    // Keep with no names takes drop's names without duplicating them into otherNames.
    await db.people.update('N', { firstName: '' });
    await mergePeople('N', 'M');
    const n = (await db.people.get('N'))!;
    expect(n).toMatchObject({ firstName: 'Mono', nickname: 'Mo' });
    expect(n.otherNames).toBeUndefined();
  });

  it('drops edges between the two people (would be self-links)', async () => {
    await db.people.bulkPut(['K', 'D', 'X'].map((id) => person(id)));
    await db.relationships.bulkPut([
      rel('s1', 'K', 'D', 'spouse'),
      rel('s2', 'D', 'K', 'sibling'),
      rel('x', 'D', 'X', 'colleague'),
    ]);
    expect(await previewMerge('K', 'D')).toMatchObject({ relationshipsMoved: 1, duplicatesDropped: 2 });
    await mergePeople('K', 'D');
    const rels = await db.relationships.toArray();
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ id: 'x', fromId: 'K', toId: 'X' });
    expect(rels.some((r) => r.fromId === r.toId)).toBe(false);
  });

  it('rejects a merge that would create a parent cycle, with no partial writes', async () => {
    // K is parent of C; C is parent of D. Merging D into K makes K its own grandparent.
    await db.people.bulkPut([person('K', { nickname: undefined }), person('D', { nickname: 'dd' }), person('C'), person('F')]);
    await db.relationships.bulkPut([rel('a', 'K', 'C', 'parent'), rel('b', 'C', 'D', 'parent'), rel('c', 'D', 'F', 'friend')]);
    const peopleBefore = await db.people.toArray();
    const relsBefore = await db.relationships.toArray();
    await expect(previewMerge('K', 'D')).rejects.toThrow('Merging would make someone their own ancestor.');
    await expect(mergePeople('K', 'D')).rejects.toThrow('Merging would make someone their own ancestor.');
    expect(await db.people.toArray()).toEqual(peopleBefore);
    expect(await db.relationships.toArray()).toEqual(relsBefore);
  });

  it('allows merging a parent with their child; the edge between them is dropped as a self-link', async () => {
    // Parent edge between the two people becomes a self-link and is dropped; no cycle remains.
    await db.people.bulkPut(['K', 'D'].map((id) => person(id)));
    await db.relationships.bulkPut([rel('p', 'K', 'D', 'parent')]);
    await mergePeople('K', 'D');
    expect(await db.relationships.count()).toBe(0);
  });

  it('merging a child with their father drops the father\'s spouse link to the mother, with a warning first', async () => {
    // Keep Kiran (K), drop his father (F). M is K's mother and F's spouse.
    await db.people.bulkPut([
      person('K', { firstName: 'Kiran', lastName: 'Example' }),
      person('F', { firstName: 'Pater', lastName: 'Example' }),
      person('M', { firstName: 'Mater', lastName: 'Example' }),
    ]);
    await db.relationships.bulkPut([rel('fk', 'F', 'K', 'parent'), rel('mk', 'M', 'K', 'parent'), rel('fm', 'F', 'M', 'spouse')]);
    const preview = await previewMerge('K', 'F');
    expect(preview).toMatchObject({ relationshipsMoved: 0, duplicatesDropped: 2 });
    expect(preview.conflicts).toEqual([
      "Warning: Pater Example is Kiran Example's parent — merging treats them as the same person.",
      'First name: Kiran kept, Pater dropped',
      'Removed spouse link to Mater Example: they are also a parent',
    ]);
    await mergePeople('K', 'F');
    expect((await db.relationships.toArray()).map((r) => [r.id, r.fromId, r.toId, r.type])).toEqual([['mk', 'M', 'K', 'parent']]);

    // The reverse: keep a parent, drop his child whose spouse is also the parent's child.
    await db.people.bulkPut([person('C', { firstName: 'Kid', lastName: 'Example' }), person('W', { firstName: 'Wife', lastName: 'Example' })]);
    await db.relationships.bulkPut([rel('kc', 'K', 'C', 'parent'), rel('cw', 'C', 'W', 'spouse'), rel('kw', 'K', 'W', 'parent')]);
    // W is K's child and C's spouse: merging C into K would make K the spouse of his own child.
    const p2 = await previewMerge('K', 'C');
    expect(p2.conflicts).toEqual([
      "Warning: Kid Example is Kiran Example's child — merging treats them as the same person.",
      'First name: Kiran kept, Kid dropped',
      'Removed spouse link to Wife Example: they are also a child',
    ]);
  });

  it('warns first when the two people are spouses or siblings; rejects distant ancestor merges', async () => {
    await db.people.bulkPut([
      person('K', { firstName: 'Kiran' }),
      person('G', { firstName: 'Grand' }),
      person('P', { firstName: 'Mid' }),
      person('S', { firstName: 'Sib' }),
      person('W', { firstName: 'Wed' }),
      person('U', { firstName: 'Kiran' }),
    ]);
    await db.relationships.bulkPut([
      rel('gp', 'G', 'P', 'parent'),
      rel('pk', 'P', 'K', 'parent'),
      rel('ks', 'K', 'S', 'sibling'),
      rel('kw', 'W', 'K', 'spouse'),
    ]);
    const w = (keep: string, drop: string) => previewMerge(keep, drop).then((p) => p.conflicts[0]);
    // A grandparent/grandchild merge would create a parent cycle and is rejected outright.
    await expect(previewMerge('K', 'G')).rejects.toThrow('Merging would make someone their own ancestor.');
    await expect(previewMerge('G', 'K')).rejects.toThrow('Merging would make someone their own ancestor.');
    expect(await w('K', 'S')).toBe("Warning: Sib is Kiran's sibling — merging treats them as the same person.");
    expect(await w('K', 'W')).toBe("Warning: Wed is Kiran's spouse — merging treats them as the same person.");
    expect((await previewMerge('K', 'U')).conflicts).toEqual([]); // unrelated: no warning
  });

  it('rejects merging a person with themselves or a missing person', async () => {
    await db.people.bulkPut([person('K')]);
    await expect(mergePeople('K', 'K')).rejects.toThrow();
    await expect(mergePeople('K', 'nope')).rejects.toThrow();
    await expect(previewMerge('nope', 'K')).rejects.toThrow();
    expect(await db.people.count()).toBe(1);
  });

  it('carries isMe over from drop, and keeps it when keep is me', async () => {
    await db.people.bulkPut([person('K'), person('D', { isMe: true }), person('O')]);
    await mergePeople('K', 'D');
    expect((await db.people.toArray()).filter((p) => p.isMe).map((p) => p.id)).toEqual(['K']);

    await db.people.bulkPut([person('D2')]);
    await mergePeople('K', 'D2');
    expect((await db.people.get('K'))?.isMe).toBe(true);

    await db.people.bulkPut([person('Z')]);
    await mergePeople('Z', 'O');
    expect((await db.people.get('Z'))?.isMe).toBeUndefined();
  });
});

describe('writes go to the cloud as one batch per change', () => {
  const last = () => backend.commits[backend.commits.length - 1];
  const deleted = (w: { id: string; data: unknown }[] | undefined) => (w ?? []).filter((x) => x.data === null);

  it('addRelationship stamps createdAt/updatedAt; updating an edge bumps updatedAt', async () => {
    await db.people.bulkPut([person('P'), person('X')]);
    const t0 = Date.now();
    const id = await addRelationship({ fromId: 'P', toId: 'X', type: 'parent' });
    const r = await db.relationships.get(id);
    expect(r!.updatedAt).toBeGreaterThanOrEqual(t0);
    expect(r!.updatedAt).toBe(r!.createdAt);
    await db.relationships.update(id, { updatedAt: 1 });
    await ensureRelationship({ fromId: 'P', toId: 'X', type: 'parent', subtype: 'step' });
    expect((await db.relationships.get(id))!.updatedAt).toBe(1); // untouched
    await addRelationship({ fromId: 'P', toId: 'X', type: 'parent', note: 'n' });
    expect((await db.relationships.get(id))!.updatedAt).toBeGreaterThanOrEqual(t0);
  });

  it('savePerson re-stamps the person who loses isMe, in the same batch', async () => {
    await db.people.bulkPut([person('A', { isMe: true, updatedAt: 1 }), person('B')]);
    await savePerson(person('B', { isMe: true }));
    const a = await db.people.get('A');
    expect(a!.isMe).toBeUndefined();
    expect(a!.updatedAt).toBeGreaterThan(1);
    expect(last().map((w) => w.id).sort()).toEqual(['A', 'B']);
  });

  it('deletePerson deletes the person and their edges together', async () => {
    await db.people.bulkPut([person('A'), person('B'), person('C')]);
    const ab = await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' });
    const bc = await addRelationship({ fromId: 'B', toId: 'C', type: 'sibling' });
    await deletePerson('A');
    expect(deleted(last()).map((w) => w.id).sort()).toEqual(['A', ab].sort());
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual([bc]);
  });

  it('deleting a missing person or edge sends nothing', async () => {
    await deletePerson('ghost');
    await deleteRelationship('ghost-edge');
    expect(backend.commits).toEqual([]);
  });

  it('mergePeople sends drop, dropped edges and moved edges as one batch', async () => {
    await db.people.bulkPut([person('K'), person('D'), person('Par'), person('Sib')]);
    const kp = await addRelationship({ fromId: 'Par', toId: 'K', type: 'parent' });
    const dp = await addRelationship({ fromId: 'Par', toId: 'D', type: 'parent' }); // duplicate after merge
    const ds = await addRelationship({ fromId: 'D', toId: 'Sib', type: 'sibling' }); // moved to K
    await db.relationships.update(ds, { updatedAt: 1 });
    const before = backend.commits.length;
    await mergePeople('K', 'D');
    expect(backend.commits.length).toBe(before + 1);
    expect(deleted(last()).map((w) => w.id).sort()).toEqual(['D', dp].sort());
    expect(await db.relationships.get(kp)).toBeDefined();
    const moved = await db.relationships.get(ds);
    expect(moved!.fromId).toBe('K');
    expect(moved!.updatedAt).toBeGreaterThan(1);
  });

  it('composed changes (write + ops) are one batch, and reads see earlier steps', async () => {
    await db.people.bulkPut([person('A')]);
    const before = backend.commits.length;
    await write((t) => {
      ops.savePerson(t, person('New'));
      ops.addRelationship(t, { fromId: 'A', toId: 'New', type: 'parent' });
      expect(ops.findRelationship(t, 'A', 'New', 'parent')).toBeDefined();
    });
    expect(backend.commits.length).toBe(before + 1);
    expect(await db.relationships.count()).toBe(1);
  });

  it('a failing step sends nothing (no partial writes)', async () => {
    await db.people.bulkPut([person('A'), person('B')]);
    await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' });
    const before = backend.commits.length;
    await expect(write((t) => {
      ops.savePerson(t, person('C'));
      ops.addRelationship(t, { fromId: 'B', toId: 'A', type: 'parent' }); // cycle: throws
    })).rejects.toThrow(/own ancestor/);
    expect(backend.commits.length).toBe(before);
    expect(await db.people.get('C')).toBeUndefined();
  });

  it('refuses changes when the backend can\'t write (offline or viewer), with its message', async () => {
    backend.offline = 'You’re offline.';
    await expect(savePerson(person('A'))).rejects.toThrow('You’re offline.');
    expect(backend.commits).toEqual([]);
  });

  it('refuses changes when signed out (no backend)', async () => {
    store.connect(null);
    await expect(savePerson(person('A'))).rejects.toThrow(/Sign in/);
  });
});

describe('clean-ups of older data', () => {
  it('purgeNonFamilyLinks deletes non-family links for good', async () => {
    await db.people.bulkPut([person('A'), person('B')]);
    const fam = await addRelationship({ fromId: 'A', toId: 'B', type: 'parent' });
    await addRelationship({ fromId: 'A', toId: 'B', type: 'friend' });
    expect(await purgeNonFamilyLinks()).toBe(1);
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual([fam]);
    expect(await purgeNonFamilyLinks()).toBe(0);
  });

  it('purgeLooseContacts deletes imported contacts with no family link, and keeps everyone else', async () => {
    await db.people.bulkPut([
      person('me', { isMe: true, source: 'vcard' }),
      person('mum', { source: 'google' }), // a contact who became family
      person('loose', { source: 'picker' }), // never linked
      person('pal', { source: 'csv' }), // only an old friend link
      person('typed'), // added by hand, not linked yet
    ]);
    await addRelationship({ fromId: 'mum', toId: 'me', type: 'parent' });
    const friend = await addRelationship({ fromId: 'me', toId: 'pal', type: 'friend' });
    expect(await purgeLooseContacts()).toBe(2);
    expect((await db.people.toArray()).map((p) => p.id).sort()).toEqual(['me', 'mum', 'typed']);
    expect(await db.relationships.get(friend)).toBeUndefined();
    expect(await purgeLooseContacts()).toBe(0);
  });
});
