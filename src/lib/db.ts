import Dexie, { type EntityTable } from 'dexie';
import { emptyPerson, newId } from './person';
import type { Gender, Person, RelType, Relationship } from './types';

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

type NewRelationship = Omit<Relationship, 'id' | 'createdAt'>;

/** True if `targetId` is `startId` or one of its descendants (following `parent` edges downward). */
async function isSelfOrDescendant(startId: string, targetId: string): Promise<boolean> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === targetId) return true;
    const kids = await db.relationships.where('fromId').equals(cur).filter((r) => r.type === 'parent').toArray();
    for (const k of kids) {
      if (!seen.has(k.toId)) {
        seen.add(k.toId);
        queue.push(k.toId);
      }
    }
  }
  return false;
}

/**
 * Add an edge, or update an equivalent existing one. On an existing edge only the fields the caller
 * actually passed (`subtype`, `note`) are changed; undefined fields keep their stored values.
 * With `{ ifMissing: true }` an existing edge is returned untouched.
 */
export async function addRelationship(r: NewRelationship, opts: { ifMissing?: boolean } = {}): Promise<string> {
  if (r.fromId === r.toId) throw new Error('A person cannot be related to themselves.');
  return db.transaction('rw', db.relationships, async () => {
    const existing = await findRelationship(r.fromId, r.toId, r.type);
    if (existing) {
      if (!opts.ifMissing) {
        const patch: Partial<Relationship> = {};
        if (r.subtype !== undefined) patch.subtype = r.subtype;
        if (r.note !== undefined) patch.note = r.note;
        if (Object.keys(patch).length) await db.relationships.update(existing.id, patch);
      }
      return existing.id;
    }
    if (r.type === 'parent' && (await isSelfOrDescendant(r.toId, r.fromId))) {
      throw new Error('That would make someone their own ancestor.');
    }
    const id = newId();
    await db.relationships.add({ ...r, id, createdAt: Date.now() });
    return id;
  });
}

/** Make sure an equivalent edge exists; never changes an existing one. Returns its id. */
export function ensureRelationship(r: Omit<Relationship, 'id' | 'createdAt'>): Promise<string> {
  return addRelationship(r, { ifMissing: true });
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

const GENDERS: Gender[] = ['male', 'female', 'other', 'unknown'];
const REL_TYPES: RelType[] = [
  'parent', 'spouse', 'sibling',
  'close_friend', 'friend', 'colleague', 'classmate', 'neighbor', 'acquaintance', 'other',
];
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Coerce an untrusted backup row into a valid Person, or null if it has no id. */
function normalisePerson(row: unknown): Person | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!isStr(r.id)) return null;
  const now = Date.now();
  const p = emptyPerson({ ...(r as Partial<Person>) });
  p.id = r.id;
  p.firstName = typeof r.firstName === 'string' ? r.firstName : '';
  p.gender = GENDERS.includes(r.gender as Gender) ? (r.gender as Gender) : 'unknown';
  p.phones = arr(r.phones);
  p.emails = arr(r.emails);
  p.work = arr(r.work);
  p.education = arr(r.education);
  p.facts = arr(r.facts);
  p.tags = arr(r.tags);
  p.createdAt = typeof r.createdAt === 'number' ? r.createdAt : now;
  p.updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : now;
  if (p.isMe !== true) delete p.isMe;
  return p;
}

function validRelationship(row: unknown): row is Relationship {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isStr(r.id) && isStr(r.fromId) && isStr(r.toId) && REL_TYPES.includes(r.type as RelType) && r.fromId !== r.toId;
}

export const BACKUP_VERSION = 1;

export async function importBackup(data: unknown, mode: 'merge' | 'replace') {
  const b = data as Backup;
  if (!b || b.app !== 'lineage' || !Array.isArray(b.people) || !Array.isArray(b.relationships)) {
    throw new Error('This file is not a Lineage backup.');
  }
  // Every backup ever exported has version 1; tolerate a missing version as 1.
  const version: unknown = (b as { version?: unknown }).version ?? 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('This file is not a Lineage backup.');
  }
  if (version > BACKUP_VERSION) {
    throw new Error(`This backup was made by a newer version of Lineage (format ${version}). Please update the app and try again.`);
  }

  const incoming = b.people.map(normalisePerson).filter((p): p is Person => p !== null);

  await db.transaction('rw', db.people, db.relationships, async () => {
    if (mode === 'replace') {
      await db.people.clear();
      await db.relationships.clear();
    }

    // Only one person may be "me". In merge mode a local "me" wins unless the backup overwrites
    // that same person; otherwise the first incoming "me" wins.
    let meId: string | undefined;
    if (mode === 'merge') {
      const localMe = await db.people.filter((p) => p.isMe === true).first();
      if (localMe) {
        const overwritten = incoming.find((p) => p.id === localMe.id);
        // If the backup overwrites local "me" without isMe, fall through to the incoming choice.
        if (!overwritten || overwritten.isMe) meId = localMe.id;
      }
    }
    if (meId === undefined) meId = incoming.find((p) => p.isMe)?.id;
    for (const p of incoming) if (p.isMe && p.id !== meId) delete p.isMe;
    if (mode === 'merge' && meId !== undefined) {
      // Clear any stale local "me" that is not the chosen one (e.g. overwritten by an incoming row).
      await db.people.filter((p) => p.isMe === true && p.id !== meId).modify((x) => {
        delete x.isMe;
      });
    }

    await db.people.bulkPut(incoming);
    const ids = new Set(await db.people.toCollection().primaryKeys());
    const rels = b.relationships.filter(validRelationship).filter((r) => ids.has(r.fromId) && ids.has(r.toId));
    await db.relationships.bulkPut(rels);
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
