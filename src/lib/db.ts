import Dexie, { type EntityTable } from 'dexie';
import { emptyPerson, formatPlace, fullName, newId, norm } from './person';
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
  /** Existing edges (keep's) that get an empty note or subtype filled from drop's duplicate. */
  fills: { id: string; changes: Pick<Relationship, 'note' | 'subtype'> }[];
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
    // Don't graft drop's middle name onto a differently named person ("Testa Q Person");
    // drop's full name is preserved in otherNames instead.
    if (k === 'middleName' && blank(kv) && norm(keep.firstName) !== norm(drop.firstName)) continue;
    if (blank(kv)) (p as unknown as Record<string, unknown>)[k] = dv;
    else if (norm(kv) !== norm(dv)) conflicts.push(`${label}: ${kv!.trim()} kept, ${dv!.trim()} dropped`);
  }

  // Keep drop's names searchable: union other names, plus drop's full name and nickname if they differ.
  const rawName = (x: Person) => [x.firstName, x.middleName, x.lastName].map((v) => v?.trim()).filter(Boolean).join(' ');
  const splitNames = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const known = new Set([norm(rawName(p)), norm(p.nickname)].filter(Boolean));
  const extra: string[] = [];
  for (const n of splitNames(keep.otherNames)) known.add(norm(n));
  for (const n of [...splitNames(drop.otherNames), rawName(drop), drop.nickname?.trim() ?? '']) {
    if (!n || known.has(norm(n))) continue;
    known.add(norm(n));
    extra.push(n);
  }
  if (extra.length) p.otherNames = [blank(keep.otherNames) ? '' : keep.otherNames!.trim(), ...extra].filter(Boolean).join(', ');

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

  const nameCache = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!nameCache.has(id)) {
      const x = await db.people.get(id);
      nameCache.set(id, x ? fullName(x) : 'someone');
    }
    return nameCache.get(id)!;
  };
  /** What the other person is to keep, for readable conflict messages. */
  const roleOf = (r: Pick<Relationship, 'fromId' | 'type'>) =>
    r.type === 'parent' ? (r.fromId === keepId ? 'child' : 'parent') : r.type;

  const moved: Relationship[] = [];
  const dropped: string[] = [];
  const fill = new Map<string, Pick<Relationship, 'note' | 'subtype'>>();
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
      const changes = fill.get(existing.id) ?? {};
      if (blank(existing.note) && !blank(r.note)) {
        existing.note = r.note; // keeps moved/our copy in sync for later duplicates
        changes.note = r.note;
      }
      if (!existing.subtype && r.subtype) {
        existing.subtype = r.subtype;
        changes.subtype = r.subtype;
      } else if (existing.subtype && r.subtype && existing.subtype !== r.subtype) {
        const other = next.fromId === keepId ? next.toId : next.fromId;
        const role = roleOf(next);
        conflicts.push(`Link to ${await nameOf(other)}: ${existing.subtype} ${role} kept, ${r.subtype} dropped`);
      }
      if (Object.keys(changes).length) fill.set(existing.id, changes);
      continue;
    }
    byKey.set(k, next);
    moved.push(next);
  }

  const childMap = (edges: Iterable<Relationship>) => {
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();
    for (const r of edges) {
      if (r.type !== 'parent') continue;
      (children.get(r.fromId) ?? children.set(r.fromId, []).get(r.fromId)!).push(r.toId);
      (parents.get(r.toId) ?? parents.set(r.toId, []).get(r.toId)!).push(r.fromId);
    }
    return { children, parents };
  };
  const reach = (start: string, next: Map<string, string[]>) => {
    const seen = new Set<string>();
    const stack = [...(next.get(start) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === start) return null; // cycle through start
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(next.get(cur) ?? []));
    }
    return seen;
  };

  // A new parent cycle can only pass through keep, so check whether keep becomes its own ancestor.
  const final = childMap(byKey.values());
  const descendants = reach(keepId, final.children);
  if (!descendants) throw new Error('Merging would make someone their own ancestor.');
  const ancestors = reach(keepId, final.parents) ?? new Set<string>();

  // A sibling/spouse link between keep and their own ancestor or descendant contradicts the parent
  // edges. Remove such links when the merge introduced them (moved edge, or a new lineal relation);
  // contradictions that already existed on keep are left alone.
  const before = childMap(all.filter((r) => !touchesDrop(r)));
  const linealBefore = new Set([...(reach(keepId, before.children) ?? []), ...(reach(keepId, before.parents) ?? [])]);
  const movedIds = new Set(moved.map((m) => m.id));
  const directParents = new Set(final.parents.get(keepId) ?? []);
  const directChildren = new Set(final.children.get(keepId) ?? []);
  const contradicted = new Set<string>();
  for (const r of byKey.values()) {
    if (r.type !== 'sibling' && r.type !== 'spouse') continue;
    if (r.fromId !== keepId && r.toId !== keepId) continue;
    const other = r.fromId === keepId ? r.toId : r.fromId;
    if (!ancestors.has(other) && !descendants.has(other)) continue;
    if (!movedIds.has(r.id) && linealBefore.has(other)) continue;
    contradicted.add(r.id);
    dropped.push(r.id);
    const what = directParents.has(other)
      ? 'a parent'
      : directChildren.has(other)
        ? 'a child'
        : ancestors.has(other)
          ? 'an ancestor'
          : 'a descendant';
    conflicts.push(`Removed ${r.type} link to ${await nameOf(other)}: they are also ${what}`);
  }
  const keptMoved = moved.filter((m) => !contradicted.has(m.id));

  // Fills on edges that are themselves being moved are carried in the moved row.
  const fills = [...fill]
    .filter(([id]) => !movedIds.has(id) && !contradicted.has(id))
    .map(([id, changes]) => ({ id, changes }));

  return {
    person,
    moved: keptMoved,
    dropped,
    fills,
    preview: { relationshipsMoved: keptMoved.length, duplicatesDropped: dropped.length, conflicts },
  };
}

/**
 * What `mergePeople(keepId, dropId)` would do, without writing. `duplicatesDropped` counts
 * duplicate edges, edges between the two people (which would become self-links), and sibling/spouse
 * links the merge would place between keep and one of keep's ancestors or descendants.
 * Throws the same errors as `mergePeople` (same person, missing person, parent cycle).
 */
export async function previewMerge(keepId: string, dropId: string): Promise<MergePreview> {
  return db.transaction('r', db.people, db.relationships, async () => (await planMerge(keepId, dropId)).preview);
}

/**
 * Merge `dropId` into `keepId`: keep's non-empty fields win, empty ones are filled from drop, lists
 * are unioned, drop's differing names go to otherNames, drop's edges are re-pointed to keep
 * (self-links, duplicates and contradicting sibling/spouse links removed; a duplicate's missing
 * subtype/note is filled from drop's copy), then drop
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
    for (const f of plan.fills) await db.relationships.update(f.id, f.changes);
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
