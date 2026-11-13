import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRelationship,
  clearAll,
  db,
  ensureRelationship,
  exportBackup,
  importBackup,
  mergePeople,
  previewMerge,
  savePerson,
} from '../db';
import { emptyPerson } from '../person';

const person = (id: string, extra: Parameters<typeof emptyPerson>[0] = {}) => emptyPerson({ id, firstName: id, ...extra });

beforeEach(async () => {
  await clearAll();
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

describe('importBackup', () => {
  const backup = (people: unknown[], relationships: unknown[] = [], version: unknown = 1) => ({
    app: 'lineage',
    version,
    exportedAt: new Date().toISOString(),
    people,
    relationships,
  });

  it('round-trips an export', async () => {
    await savePerson(person('A', { isMe: true }));
    await savePerson(person('B'));
    await addRelationship({ fromId: 'A', toId: 'B', type: 'parent', subtype: 'adoptive' });
    const data = await exportBackup();
    await clearAll();
    await importBackup(JSON.parse(JSON.stringify(data)), 'replace');
    expect(await db.people.count()).toBe(2);
    expect((await db.relationships.toArray())[0].subtype).toBe('adoptive');
    expect((await db.people.get('A'))?.isMe).toBe(true);
  });

  it('merge keeps the local "me" and strips isMe from incoming people', async () => {
    await savePerson(person('local', { isMe: true }));
    await importBackup(backup([person('remote', { isMe: true }), person('other')]), 'merge');
    const mes = (await db.people.toArray()).filter((p) => p.isMe);
    expect(mes.map((p) => p.id)).toEqual(['local']);
  });

  it('merge keeps isMe when the incoming "me" is the same person', async () => {
    await savePerson(person('local', { isMe: true }));
    await importBackup(backup([person('local', { isMe: true, lastName: 'New' }), person('x', { isMe: true })]), 'merge');
    const mes = (await db.people.toArray()).filter((p) => p.isMe);
    expect(mes.map((p) => p.id)).toEqual(['local']);
    expect((await db.people.get('local'))?.lastName).toBe('New');
  });

  it('merge without a local "me" accepts one incoming "me"', async () => {
    await savePerson(person('local'));
    await importBackup(backup([person('r1', { isMe: true }), person('r2', { isMe: true })]), 'merge');
    const mes = (await db.people.toArray()).filter((p) => p.isMe);
    expect(mes.map((p) => p.id)).toEqual(['r1']);
  });

  it('replace keeps at most one "me"', async () => {
    await savePerson(person('local', { isMe: true }));
    await importBackup(backup([person('r1', { isMe: true }), person('r2', { isMe: true })]), 'replace');
    const all = await db.people.toArray();
    expect(all.map((p) => p.id).sort()).toEqual(['r1', 'r2']);
    expect(all.filter((p) => p.isMe).map((p) => p.id)).toEqual(['r1']);
  });

  it('normalises malformed people and keeps id/createdAt/updatedAt', async () => {
    await importBackup(
      backup([
        { id: 'a', createdAt: 5, updatedAt: 7, lastName: 'Example' },
        { id: 'b', firstName: 42, gender: 'robot', phones: null, tags: 'x' },
        { firstName: 'no id' },
        null,
        'junk',
      ]),
      'replace',
    );
    const a = await db.people.get('a');
    expect(a).toMatchObject({ id: 'a', createdAt: 5, updatedAt: 7, firstName: '', lastName: 'Example', gender: 'unknown' });
    for (const k of ['phones', 'emails', 'work', 'education', 'facts', 'tags'] as const) expect(a?.[k]).toEqual([]);
    const b = await db.people.get('b');
    expect(b?.firstName).toBe('');
    expect(b?.gender).toBe('unknown');
    expect(b?.phones).toEqual([]);
    expect(b?.tags).toEqual([]);
    expect(await db.people.count()).toBe(2);
  });

  it('drops invalid relationships and dangling ends, but keeps links to existing local people in merge', async () => {
    await savePerson(person('local'));
    await importBackup(
      backup(
        [person('a'), person('b')],
        [
          { id: 'ok', fromId: 'a', toId: 'b', type: 'parent', createdAt: 1 },
          { id: 'toLocal', fromId: 'local', toId: 'a', type: 'friend', createdAt: 1 },
          { id: 'self', fromId: 'a', toId: 'a', type: 'friend', createdAt: 1 },
          { id: 'dangling', fromId: 'a', toId: 'ghost', type: 'friend', createdAt: 1 },
          { fromId: 'a', toId: 'b', type: 'spouse' },
          { id: 'noType', fromId: 'a', toId: 'b' },
          { id: 'badType', fromId: 'a', toId: 'b', type: 'enemy' },
          { id: 'noFrom', toId: 'b', type: 'friend' },
          null,
        ],
      ),
      'merge',
    );
    expect((await db.relationships.toArray()).map((r) => r.id).sort()).toEqual(['ok', 'toLocal']);
  });

  it('in replace mode, links to people only in the old local data are dropped', async () => {
    await savePerson(person('local'));
    await importBackup(backup([person('a')], [{ id: 'r', fromId: 'local', toId: 'a', type: 'friend', createdAt: 1 }]), 'replace');
    expect(await db.relationships.count()).toBe(0);
  });

  it('accepts version 1 (and a missing version), rejects future versions', async () => {
    await expect(importBackup(backup([person('a')], [], 1), 'merge')).resolves.toBeUndefined();
    await expect(importBackup(backup([person('b')], [], undefined), 'merge')).resolves.toBeUndefined();
    await expect(importBackup(backup([person('c')], [], 2), 'merge')).rejects.toThrow(/newer version of Lineage/);
    await expect(importBackup(backup([person('d')], [], 'abc'), 'merge')).rejects.toThrow(/not a Lineage backup/);
    expect((await db.people.toCollection().primaryKeys()).sort()).toEqual(['a', 'b']);
  });

  it('rejects non-backups', async () => {
    await expect(importBackup({ app: 'other', people: [], relationships: [] }, 'merge')).rejects.toThrow(/not a Lineage backup/);
    await expect(importBackup(null, 'merge')).rejects.toThrow(/not a Lineage backup/);
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
