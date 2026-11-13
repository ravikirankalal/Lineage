import Dexie, { type EntityTable } from 'dexie';
import { newId } from './person';
import type { Person, RelType, Relationship } from './types';

export class LineageDB extends Dexie {
  people!: EntityTable<Person, 'id'>;
  relationships!: EntityTable<Relationship, 'id'>;

  constructor(name = 'lineage') {
    super(name);
    this.version(1).stores({
      people: 'id, firstName, lastName, updatedAt, *tags',
      relationships: 'id, fromId, toId, type, [fromId+toId]',
    });
  }
}

export const db = new LineageDB();

const SYMMETRIC = (t: RelType) => t !== 'parent';

export async function savePerson(p: Person): Promise<string> {
  const toSave = { ...p, updatedAt: Date.now() };
  if (toSave.isMe) {
    // Only one person can be "me".
    await db.people.where('id').notEqual(p.id).modify((x) => {
      if (x.isMe) delete x.isMe;
    });
  }
  await db.people.put(toSave);
  return p.id;
}

export async function deletePerson(id: string) {
  await db.transaction('rw', db.people, db.relationships, async () => {
    await db.relationships.where('fromId').equals(id).delete();
    await db.relationships.where('toId').equals(id).delete();
    await db.people.delete(id);
  });
}

/** Find an existing edge equivalent to (from, to, type). */
export async function findRelationship(fromId: string, toId: string, type: RelType) {
  const a = await db.relationships.where('[fromId+toId]').equals([fromId, toId]).filter((r) => r.type === type).first();
  if (a || !SYMMETRIC(type)) return a;
  return db.relationships.where('[fromId+toId]').equals([toId, fromId]).filter((r) => r.type === type).first();
}

export async function addRelationship(r: Omit<Relationship, 'id' | 'createdAt'>): Promise<string> {
  if (r.fromId === r.toId) throw new Error('A person cannot be related to themselves.');
  const existing = await findRelationship(r.fromId, r.toId, r.type);
  if (existing) {
    await db.relationships.update(existing.id, { subtype: r.subtype, note: r.note });
    return existing.id;
  }
  if (r.type === 'parent') {
    const reverse = await findRelationship(r.toId, r.fromId, 'parent');
    if (reverse) throw new Error('That would make someone their own ancestor.');
  }
  const id = newId();
  await db.relationships.add({ ...r, id, createdAt: Date.now() });
  return id;
}

export async function deleteRelationship(id: string) {
  await db.relationships.delete(id);
}

// ---------------------------------------------------------------------------
// Backup

export interface Backup {
  app: 'lineage';
  version: 1;
  exportedAt: string;
  people: Person[];
  relationships: Relationship[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'lineage',
    version: 1,
    exportedAt: new Date().toISOString(),
    people: await db.people.toArray(),
    relationships: await db.relationships.toArray(),
  };
}

export async function importBackup(data: unknown, mode: 'merge' | 'replace') {
  const b = data as Backup;
  if (!b || b.app !== 'lineage' || !Array.isArray(b.people) || !Array.isArray(b.relationships)) {
    throw new Error('This file is not a Lineage backup.');
  }
  await db.transaction('rw', db.people, db.relationships, async () => {
    if (mode === 'replace') {
      await db.people.clear();
      await db.relationships.clear();
    }
    await db.people.bulkPut(b.people);
    await db.relationships.bulkPut(b.relationships);
  });
}

export async function clearAll() {
  await db.transaction('rw', db.people, db.relationships, async () => {
    await db.people.clear();
    await db.relationships.clear();
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
