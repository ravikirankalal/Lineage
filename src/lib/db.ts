/**
 * Changes to the family tree. Each exported function runs as one transaction over the live tree
 * (see store.ts) and is sent to the cloud as one batch. `ops` holds the same steps for composing
 * several changes into one batch: `write((t) => { ops.savePerson(t, p); ops.addRelationship(t, r); })`.
 */
import { formatPlace, fullName, newId, norm, phoneEntryKey, emptyPerson } from './person';
import { read, write, type Tx } from './store';
import { isFamilyType, type Gender, type LabeledValue, type Person, type Place, type RelType, type Relationship } from './types';

const SYMMETRIC = (t: RelType) => t !== 'parent';

type NewRelationship = Omit<Relationship, 'id' | 'createdAt' | 'updatedAt'>;

function savePersonTx(t: Tx, p: Person): string {
  const now = Date.now();
  if (p.isMe) {
    // Only one person can be "me".
    for (const x of t.allPeople()) {
      if (x.isMe && x.id !== p.id) {
        const { isMe: _drop, ...rest } = x;
        void _drop;
        t.putPerson({ ...rest, updatedAt: now });
      }
    }
  }
  t.putPerson({ ...p, updatedAt: now });
  return p.id;
}

function deletePersonTx(t: Tx, id: string) {
  for (const r of t.allRels()) if (r.fromId === id || r.toId === id) t.removeRel(r.id);
  t.removePerson(id);
}

/** Find an existing edge equivalent to (from, to, type). */
function findRelationshipTx(t: Tx, fromId: string, toId: string, type: RelType): Relationship | undefined {
  const all = t.allRels();
  const a = all.find((r) => r.fromId === fromId && r.toId === toId && r.type === type);
  if (a || !SYMMETRIC(type)) return a;
  return all.find((r) => r.fromId === toId && r.toId === fromId && r.type === type);
}

/** True if `targetId` is `startId` or one of its descendants (following `parent` edges downward). */
function isSelfOrDescendant(t: Tx, startId: string, targetId: string): boolean {
  const kids = new Map<string, string[]>();
  for (const r of t.allRels()) if (r.type === 'parent') (kids.get(r.fromId) ?? kids.set(r.fromId, []).get(r.fromId)!).push(r.toId);
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === targetId) return true;
    for (const k of kids.get(cur) ?? []) if (!seen.has(k)) { seen.add(k); queue.push(k); }
  }
  return false;
}

function addRelationshipTx(t: Tx, r: NewRelationship, opts: { ifMissing?: boolean } = {}): string {
  if (r.fromId === r.toId) throw new Error('A person cannot be related to themselves.');
  const existing = findRelationshipTx(t, r.fromId, r.toId, r.type);
  if (existing) {
    if (!opts.ifMissing) {
      const patch: Partial<Relationship> = {};
      if (r.subtype !== undefined) patch.subtype = r.subtype;
      if (r.note !== undefined) patch.note = r.note;
      if (Object.keys(patch).length) t.putRel({ ...existing, ...patch, updatedAt: Date.now() });
    }
    return existing.id;
  }
  if (r.type === 'parent' && isSelfOrDescendant(t, r.toId, r.fromId)) {
    throw new Error('That would make someone their own ancestor.');
  }
  const id = newId();
  const now = Date.now();
  // Strip any stray updatedAt/createdAt a caller passed in at runtime.
  const { updatedAt: _u, createdAt: _c, ...rest } = r as Relationship;
  void _u;
  void _c;
  t.putRel({ ...rest, id, createdAt: now, updatedAt: now });
  return id;
}

function mergePeopleTx(t: Tx, keepId: string, dropId: string) {
  const plan = planMerge(t, keepId, dropId);
  const now = Date.now();
  if (plan.person.isMe) {
    for (const x of t.allPeople()) {
      if (x.isMe && x.id !== keepId && x.id !== dropId) {
        const { isMe: _drop, ...rest } = x;
        void _drop;
        t.putPerson({ ...rest, updatedAt: now });
      }
    }
  }
  t.putPerson(plan.person);
  for (const id of plan.dropped) t.removeRel(id);
  for (const m of plan.moved) t.putRel({ ...m, updatedAt: now });
  for (const f of plan.fills) {
    const r = t.rel(f.id);
    if (r) t.putRel({ ...r, ...f.changes, updatedAt: now });
  }
  t.removePerson(dropId);
}

/** The same steps as the exported functions, for composing several into one batch with `write`. */
export const ops = {
  savePerson: savePersonTx,
  deletePerson: deletePersonTx,
  findRelationship: findRelationshipTx,
  addRelationship: addRelationshipTx,
  ensureRelationship: (t: Tx, r: NewRelationship) => addRelationshipTx(t, r, { ifMissing: true }),
  deleteRelationship: (t: Tx, id: string) => t.removeRel(id),
  mergePeople: mergePeopleTx,
};

export const savePerson = (p: Person) => write((t) => savePersonTx(t, p));
export const deletePerson = (id: string) => write((t) => deletePersonTx(t, id));
export const findRelationship = (fromId: string, toId: string, type: RelType) => read((t) => findRelationshipTx(t, fromId, toId, type));
/**
 * Add an edge, or update an equivalent existing one. On an existing edge only the fields the caller
 * actually passed (`subtype`, `note`) are changed; undefined fields keep their stored values.
 * With `{ ifMissing: true }` an existing edge is returned untouched.
 */
export const addRelationship = (r: NewRelationship, opts: { ifMissing?: boolean } = {}) => write((t) => addRelationshipTx(t, r, opts));
/** Make sure an equivalent edge exists; never changes an existing one. Returns its id. */
export const ensureRelationship = (r: NewRelationship) => write((t) => addRelationshipTx(t, r, { ifMissing: true }));
export const deleteRelationship = (id: string) => write((t) => t.removeRel(id));

/**
 * Lineage is family-only: delete every non-family link (friend, colleague, … from older versions) for
 * good. Returns how many went.
 */
export function purgeNonFamilyLinks(): Promise<number> {
  return write((t) => {
    const ids = t.allRels().filter((r) => !isFamilyType(r.type)).map((r) => r.id);
    for (const id of ids) t.removeRel(id);
    return ids.length;
  });
}

/** Imported-contact sources from older versions (contacts import is gone). */
const CONTACT_SOURCES = new Set<Person['source']>(['vcard', 'csv', 'picker', 'google']);

/**
 * Delete, for good, imported contacts that never became family: from a contacts source, not "me",
 * and with no parent/spouse/sibling link. Their remaining links go with them. Returns how many.
 */
export function purgeLooseContacts(): Promise<number> {
  return write((t) => {
    const linked = new Set<string>();
    for (const r of t.allRels()) if (isFamilyType(r.type)) { linked.add(r.fromId); linked.add(r.toId); }
    const loose = t.allPeople().filter((p) => !p.isMe && CONTACT_SOURCES.has(p.source) && !linked.has(p.id));
    for (const p of loose) deletePersonTx(t, p.id);
    return loose.length;
  });
}

/** Delete all people and relationships in this family. */
export function clearAll(): Promise<void> {
  return write((t) => {
    for (const r of t.allRels()) t.removeRel(r.id);
    for (const p of t.allPeople()) t.removePerson(p.id);
  });
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
// Last 10 digits ignoring an extension, but a different extension is a
// different entry so merging never drops it. Numbers with no digits fall back to the text.
const phoneKey = (v: string) => phoneEntryKey(v ?? '') || norm(v);

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

function planMerge(t: Tx, keepId: string, dropId: string): MergePlan {
  if (!keepId || !dropId || keepId === dropId) throw new Error('Choose two different people to merge.');
  const keep = t.person(keepId);
  const drop = t.person(dropId);
  if (!keep || !drop) throw new Error('One of these people no longer exists.');

  const { person, conflicts } = mergeFields(keep, drop);

  const all = t.allRels().map((r) => ({ ...r }));
  const touchesDrop = (r: Relationship) => r.fromId === dropId || r.toId === dropId;
  const byKey = new Map<string, Relationship>();
  for (const r of all) if (!touchesDrop(r)) byKey.set(edgeKey(r), r);

  const nameCache = new Map<string, string>();
  const nameOf = (id: string) => {
    if (!nameCache.has(id)) {
      const x = t.person(id);
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
        conflicts.push(`Link to ${nameOf(other)}: ${existing.subtype} ${role} kept, ${r.subtype} dropped`);
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
    conflicts.push(`Removed ${r.type} link to ${nameOf(other)}: they are also ${what}`);
  }
  const keptMoved = moved.filter((m) => !contradicted.has(m.id));

  // Warn first if the two people are already related to each other (before the merge). A more
  // distant ancestor/descendant pair never gets here: it would create a parent cycle (thrown above).
  const between = all.filter(
    (r) => (r.fromId === keepId && r.toId === dropId) || (r.fromId === dropId && r.toId === keepId),
  );
  const roles: string[] = [];
  if (between.some((r) => r.type === 'parent' && r.fromId === dropId)) roles.push('parent');
  else if (between.some((r) => r.type === 'parent' && r.fromId === keepId)) roles.push('child');
  for (const t of ['spouse', 'sibling'] as const) if (between.some((r) => r.type === t)) roles.push(t);
  if (roles.length) {
    conflicts.unshift(
      `Warning: ${fullName(drop)} is ${fullName(keep)}'s ${roles.join(' and ')} — merging treats them as the same person.`,
    );
  }

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
  return read((t) => planMerge(t, keepId, dropId).preview);
}

/**
 * Merge `dropId` into `keepId`: keep's non-empty fields win, empty ones are filled from drop, lists
 * are unioned, drop's differing names go to otherNames, drop's edges are re-pointed to keep
 * (self-links, duplicates and contradicting sibling/spouse links removed; a duplicate's missing
 * subtype/note is filled from drop's copy), then drop is deleted. All checks run before any write;
 * everything is sent as one batch.
 */
export const mergePeople = (keepId: string, dropId: string) => write((t) => mergePeopleTx(t, keepId, dropId));

// ---------------------------------------------------------------------------
// Reading stored records

const GENDERS: Gender[] = ['male', 'female', 'other', 'unknown'];
// Includes the non-family types of older versions, so old records still read (and get purged).
const REL_TYPES: RelType[] = [
  'parent', 'spouse', 'sibling',
  'close_friend', 'friend', 'colleague', 'classmate', 'neighbor', 'acquaintance', 'other',
];
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Coerce an untrusted stored record into a valid Person, or null if it has no id. */
export function normalisePerson(row: unknown): Person | null {
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

export function validRelationship(row: unknown): row is Relationship {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isStr(r.id) && isStr(r.fromId) && isStr(r.toId) && REL_TYPES.includes(r.type as RelType) && r.fromId !== r.toId;
}

