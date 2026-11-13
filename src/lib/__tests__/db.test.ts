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
        { id: 'a', createdAt: 5, updatedAt: 7, lastName: 'Kumar' },
        { id: 'b', firstName: 42, gender: 'robot', phones: null, tags: 'x' },
        { firstName: 'no id' },
        null,
        'junk',
      ]),
      'replace',
    );
    const a = await db.people.get('a');
    expect(a).toMatchObject({ id: 'a', createdAt: 5, updatedAt: 7, firstName: '', lastName: 'Kumar', gender: 'unknown' });
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
        firstName: 'Ravi',
        birthDate: '1988',
        gender: 'unknown',
        notes: 'Met at school',
        origin: { city: 'Mysuru' },
        createdAt: 500,
      }),
      person('D', {
        firstName: 'Ravi',
        lastName: 'Rao',
        nickname: 'R',
        birthDate: '1987',
        gender: 'male',
        deceased: true,
        notes: 'Likes cricket',
        origin: { city: 'Udupi' },
        address: { city: 'Bengaluru' },
        occupation: 'Engineer',
        photo: 'data:image/png;base64,xx',
        tags: ['school', 'Family'],
        facts: [{ label: 'Blood group', value: 'O+' }],
        work: [{ organization: 'Acme' }],
        education: [{ institution: 'NIE' }],
        createdAt: 100,
      }),
    ]);
    await db.people.update('K', {
      tags: ['School'],
      facts: [{ label: 'blood group', value: 'o+' }],
      work: [{ organization: 'acme', role: 'Lead' }],
    });
    const preview = await previewMerge('K', 'D');
    expect(preview.conflicts).toEqual(['Birth date: 1988 kept, 1987 dropped', 'Origin: Mysuru kept, Udupi dropped']);
    expect(await db.people.count()).toBe(2); // preview did not write

    await mergePeople('K', 'D');
    expect(await db.people.get('D')).toBeUndefined();
    const k = (await db.people.get('K'))!;
    expect(k).toMatchObject({
      firstName: 'Ravi',
      lastName: 'Rao',
      nickname: 'R',
      birthDate: '1988',
      gender: 'male',
      deceased: true,
      origin: { city: 'Mysuru' },
      address: { city: 'Bengaluru' },
      occupation: 'Engineer',
      photo: 'data:image/png;base64,xx',
      notes: 'Met at school\n\nLikes cricket',
      createdAt: 100,
    });
    expect(k.tags).toEqual(['School', 'Family']);
    expect(k.facts).toHaveLength(1);
    expect(k.work).toEqual([{ organization: 'acme', role: 'Lead' }]);
    expect(k.education).toEqual([{ institution: 'NIE' }]);
  });

  it('tolerates old rows missing list fields', async () => {
    const legacy = { id: 'L', firstName: 'Old', gender: 'unknown', createdAt: 1, updatedAt: 1 } as unknown as ReturnType<typeof person>;
    await db.people.bulkPut([person('K', { phones: [{ label: 'mobile', value: '9876543210' }] }), legacy]);
    await mergePeople('K', 'L');
    const k = (await db.people.get('K'))!;
    expect(k.phones).toHaveLength(1);
    expect(k.tags).toEqual([]);
    expect(k.createdAt).toBe(1);
  });

  it('unions phones by last 10 digits and emails case-insensitively', async () => {
    await db.people.bulkPut([
      person('K', {
        phones: [{ label: 'mobile', value: '+91 98765 43210' }],
        emails: [{ label: 'home', value: 'Ravi@Example.com' }],
      }),
      person('D', {
        phones: [
          { label: 'mobile', value: '098765-43210' },
          { label: 'work', value: '080 2222 3333' },
        ],
        emails: [
          { label: 'home', value: ' ravi@example.com ' },
          { label: 'work', value: 'ravi@work.in' },
        ],
      }),
    ]);
    await mergePeople('K', 'D');
    const k = (await db.people.get('K'))!;
    expect(k.phones.map((x) => x.value)).toEqual(['+91 98765 43210', '080 2222 3333']);
    expect(k.emails.map((x) => x.value)).toEqual(['Ravi@Example.com', 'ravi@work.in']);
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
