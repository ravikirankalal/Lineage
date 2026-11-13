import Dexie, { type EntityTable } from 'dexie';
import { emptyPerson, formatPlace, newId, norm } from './person';
import type { Gender, LabeledValue, Person, Place, RelType, Relationship } from './types';

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
// Merge two people

export interface MergePreview {
  relationshipsMoved: number;
  duplicatesDropped: number;
  conflicts: string[];
}

interface MergePlan {
  person: Person;
  /** Edges of drop, re-pointed to keep, to be written back. */
  moved: Relationship[];
  /** Edge ids to delete (self-links and duplicates). */
  dropped: string[];
  /** Existing edges (keep's, or already-moved ones) that get an empty note filled. */
  noteFills: { id: string; note: string }[];
  preview: MergePreview;
}

const blank = (s?: string) => !s || !s.trim();
const placeEmpty = (pl?: Place) => !pl || !formatPlace(pl);
const phoneKey = (v: string) => {
  const d = (v ?? '').replace(/\D/g, '');
  return d ? d.slice(-10) : norm(v);
};

function unionBy<T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    if (x === null || x === undefined) continue;
    const k = key(x);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(x);
  }
  return out;
}

function mergeFields(keep: Person, drop: Person): { person: Person; conflicts: string[] } {
  const p: Person = { ...keep };
  const conflicts: string[] = [];

  const text: [keyof Person, string][] = [
    ['firstName', 'First name'],
    ['middleName', 'Middle name'],
    ['lastName', 'Last name'],
    ['nickname', 'Nickname'],
    ['otherNames', 'Other names'],
    ['birthDate', 'Birth date'],
    ['deathDate', 'Death date'],
    ['appearance', 'Appearance'],
    ['howWeMet', 'How we met'],
    ['metOn', 'Met on'],
    ['occupation', 'Occupation'],
  ];
  for (const [k, label] of text) {
    const kv = keep[k] as string | undefined;
    const dv = drop[k] as string | undefined;
    if (blank(dv)) continue;
    if (blank(kv)) (p as unknown as Record<string, unknown>)[k] = dv;
    else if (norm(kv) !== norm(dv)) conflicts.push(`${label}: ${kv!.trim()} kept, ${dv!.trim()} dropped`);
  }

  const kg = keep.gender ?? 'unknown';
  const dg = drop.gender ?? 'unknown';
  if (kg === 'unknown' && dg !== 'unknown') p.gender = dg;
  else if (kg !== 'unknown' && dg !== 'unknown' && kg !== dg) conflicts.push(`Gender: ${kg} kept, ${dg} dropped`);
  if (!p.gender) p.gender = 'unknown';

  if (!keep.deceased && drop.deceased) p.deceased = true;

  for (const [k, label] of [['origin', 'Origin'], ['address', 'Address']] as const) {
    const kp = keep[k];
    const dp = drop[k];
    if (placeEmpty(dp)) continue;
    if (placeEmpty(kp)) p[k] = { ...dp };
    else if (norm(formatPlace(kp)) !== norm(formatPlace(dp))) {
      conflicts.push(`${label}: ${formatPlace(kp)} kept, ${formatPlace(dp)} dropped`);
    }
  }

  if (!blank(drop.photo)) {
    if (blank(keep.photo)) p.photo = drop.photo;
    else if (keep.photo !== drop.photo) conflicts.push("Photo: both have a photo; the kept person's photo is used");
  }

  if (!blank(drop.notes)) {
    if (blank(keep.notes)) p.notes = drop.notes;
    else if (keep.notes!.trim() !== drop.notes!.trim()) p.notes = `${keep.notes!.trim()}\n\n${drop.notes!.trim()}`;
  }

  p.phones = unionBy<LabeledValue>(keep.phones, drop.phones, (x) => phoneKey(x.value));
  p.emails = unionBy<LabeledValue>(keep.emails, drop.emails, (x) => norm(x.value));
  p.tags = unionBy<string>(keep.tags, drop.tags, (x) => norm(x));
  p.facts = unionBy(keep.facts, drop.facts, (x) => `${norm(x.label)}\u0000${norm(x.value)}`);
  p.work = unionBy(keep.work, drop.work, (x) => norm(x.organization));
  p.education = unionBy(keep.education, drop.education, (x) => norm(x.institution));

  const kc = typeof keep.createdAt === 'number' ? keep.createdAt : Infinity;
  const dc = typeof drop.createdAt === 'number' ? drop.createdAt : Infinity;
  const created = Math.min(kc, dc);
  p.createdAt = Number.isFinite(created) ? created : Date.now();
  p.updatedAt = Date.now();
  if (keep.isMe || drop.isMe) p.isMe = true;
  else delete p.isMe;
  return { person: p, conflicts };
}

const edgeKey = (r: Pick<Relationship, 'fromId' | 'toId' | 'type'>) =>
  SYMMETRIC(r.type) ? `${r.type}|${[r.fromId, r.toId].sort().join('|')}` : `${r.type}|${r.fromId}|${r.toId}`;

/** Reads everything it needs; must run inside a transaction covering people and relationships. */
async function planMerge(keepId: string, dropId: string): Promise<MergePlan> {
  if (!keepId || !dropId || keepId === dropId) throw new Error('Choose two different people to merge.');
  const [keep, drop] = await Promise.all([db.people.get(keepId), db.people.get(dropId)]);
  if (!keep || !drop) throw new Error('One of these people no longer exists.');

  const { person, conflicts } = mergeFields(keep, drop);

  const all = await db.relationships.toArray();
  const touchesDrop = (r: Relationship) => r.fromId === dropId || r.toId === dropId;
  const byKey = new Map<string, Relationship>();
  for (const r of all) if (!touchesDrop(r)) byKey.set(edgeKey(r), r);

  const moved: Relationship[] = [];
  const dropped: string[] = [];
  const noteFill = new Map<string, string>();
  for (const r of all) {
    if (!touchesDrop(r)) continue;
    const next: Relationship = {
      ...r,
      fromId: r.fromId === dropId ? keepId : r.fromId,
      toId: r.toId === dropId ? keepId : r.toId,
    };
    if (next.fromId === next.toId) {
      dropped.push(r.id);
      continue;
    }
    const k = edgeKey(next);
    const existing = byKey.get(k);
    if (existing) {
      dropped.push(r.id);
      if (blank(existing.note) && !blank(r.note)) {
        existing.note = r.note; // keeps moved/our copy in sync for later duplicates
        noteFill.set(existing.id, r.note!);
      }
      continue;
    }
    byKey.set(k, next);
    moved.push(next);
  }

  // A new parent cycle can only pass through keep, so check whether keep becomes its own ancestor.
  const children = new Map<string, string[]>();
  for (const r of byKey.values()) {
    if (r.type !== 'parent') continue;
    const list = children.get(r.fromId);
    if (list) list.push(r.toId);
    else children.set(r.fromId, [r.toId]);
  }
  const seen = new Set<string>();
  const stack = [...(children.get(keepId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === keepId) throw new Error('Merging would make someone their own ancestor.');
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(children.get(cur) ?? []));
  }

  // Note fills on edges that are themselves being moved are carried in the moved row.
  const movedIds = new Set(moved.map((m) => m.id));
  const noteFills = [...noteFill].filter(([id]) => !movedIds.has(id)).map(([id, note]) => ({ id, note }));

  return {
    person,
    moved,
    dropped,
    noteFills,
    preview: { relationshipsMoved: moved.length, duplicatesDropped: dropped.length, conflicts },
  };
}

/**
 * What `mergePeople(keepId, dropId)` would do, without writing. `duplicatesDropped` counts both
 * duplicate edges and edges between the two people (which would become self-links).
 * Throws the same errors as `mergePeople` (same person, missing person, parent cycle).
 */
export async function previewMerge(keepId: string, dropId: string): Promise<MergePreview> {
  return db.transaction('r', db.people, db.relationships, async () => (await planMerge(keepId, dropId)).preview);
}

/**
 * Merge `dropId` into `keepId`: keep's non-empty fields win, empty ones are filled from drop, lists
 * are unioned, drop's edges are re-pointed to keep (self-links and duplicates removed), then drop
 * is deleted. All checks run before any write; everything happens in one transaction.
 */
export async function mergePeople(keepId: string, dropId: string): Promise<void> {
  await db.transaction('rw', db.people, db.relationships, async () => {
    const plan = await planMerge(keepId, dropId);
    if (plan.person.isMe) {
      await db.people.filter((x) => x.isMe === true && x.id !== keepId && x.id !== dropId).modify((x) => {
        delete x.isMe;
      });
    }
    await db.people.put(plan.person);
    if (plan.dropped.length) await db.relationships.bulkDelete(plan.dropped);
    if (plan.moved.length) await db.relationships.bulkPut(plan.moved);
    for (const f of plan.noteFills) await db.relationships.update(f.id, { note: f.note });
    await db.people.delete(dropId);
  });
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
