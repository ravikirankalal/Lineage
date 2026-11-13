import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addRelationship, clearAll, db, ensureRelationship, exportBackup, importBackup, savePerson } from '../db';
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
