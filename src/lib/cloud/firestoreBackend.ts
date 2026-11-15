/**
 * The store's backend in the app: one family space in Firestore, read live and written directly.
 *
 * - Owners read the whole space; members must query `scope == 'family'` (rules are not filters).
 * - Every record is written with scope 'family': Lineage is family-only, so everything in a tree is
 *   shared with the family's members.
 * - Deletes: the owner deletes documents; editors may only mark them deleted (the rules decide).
 * - Records marked deleted by older versions are skipped on read.
 */
import type { Person, Relationship } from '../types';
import { normalisePerson, validRelationship } from '../db';
import type { Backend, Collection, Write } from '../store';
import type { CloudRecord, Role } from './contract';
import { getDb } from './firebase';
import { logActivity, summarise } from './activity';

const BATCH_LIMIT = 400;

type Rec = CloudRecord<Person | Relationship>;

function friendly(e: unknown, role: Role): Error {
  const code = (e as { code?: string })?.code;
  if (code === 'permission-denied') {
    return new Error(role === 'viewer' ? 'You can look at this family, but not change it.' : 'You don’t have permission to make that change.');
  }
  if (code === 'unavailable') return new Error('Can’t reach the internet. Check your connection and try again.');
  return e instanceof Error ? e : new Error(String(e));
}

export function firestoreBackend(spaceId: string, uid: string, role: Role): Backend {
  const isOwner = role === 'owner';
  /** Last stored updatedAt per document: a new write must be newer (rules). */
  const seen = new Map<string, number>();
  const key = (c: Collection, id: string) => `${c}/${id}`;

  return {
    canWrite() {
      if (role === 'viewer') return 'You can look at this family, but not change it.';
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You’re offline. Connect to the internet to make changes.';
      return null;
    },

    start(onData, onError) {
      let stopped = false;
      const unsubs: (() => void)[] = [];
      const people = new Map<string, Person>();
      const rels = new Map<string, Relationship>();
      const ready = { people: false, relationships: false };
      const emit = () => { if (!stopped && ready.people && ready.relationships) onData(new Map(people), new Map(rels)); };

      void (async () => {
        const db = await getDb();
        const { collection, query, where, onSnapshot } = await import('firebase/firestore');
        if (stopped) return;
        for (const c of ['people', 'relationships'] as const) {
          const ref = collection(db, 'spaces', spaceId, c);
          const q = isOwner ? query(ref) : query(ref, where('scope', '==', 'family'));
          unsubs.push(onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
            for (const ch of snap.docChanges()) {
              const id = ch.doc.id;
              const rec = ch.doc.data() as Rec;
              if (ch.type === 'removed') {
                seen.delete(key(c, id));
                if (c === 'people') people.delete(id); else rels.delete(id);
                continue;
              }
              if (typeof rec.updatedAt === 'number') seen.set(key(c, id), rec.updatedAt);
              const alive = rec.deleted !== true && rec.data;
              if (c === 'people') {
                const p = alive ? normalisePerson({ ...rec.data, id }) : null;
                if (p) people.set(id, p); else people.delete(id);
              } else {
                const r = alive ? { ...(rec.data as Relationship), id } : null;
                if (r && validRelationship(r)) rels.set(id, r); else rels.delete(id);
              }
            }
            // Only count as loaded once the server has answered: a first snapshot from the (empty) memory
            // cache would make the tree look empty or unlinked, and clean-ups act on what they see.
            if (!snap.metadata.fromCache) ready[c] = true;
            emit();
          }, (e) => onError(friendly(e, role))));
        }
      })().catch((e) => onError(friendly(e, role)));

      return () => {
        stopped = true;
        unsubs.forEach((u) => u());
      };
    },

    async commit(writes: Write[]) {
      const db = await getDb();
      const { doc, writeBatch } = await import('firebase/firestore');
      const summary = role === 'viewer' ? null : summarise(writes, (w) => seen.has(key(w.coll, w.id)));
      for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const w of writes.slice(i, i + BATCH_LIMIT)) {
          const ref = doc(db, 'spaces', spaceId, w.coll, w.id);
          const k = key(w.coll, w.id);
          const updatedAt = Math.max(Date.now(), (seen.get(k) ?? 0) + 1);
          if (w.data) {
            batch.set(ref, { data: { ...w.data, id: w.id }, scope: 'family', updatedAt, updatedBy: uid } satisfies Rec);
          } else if (isOwner) {
            batch.delete(ref);
          } else if (seen.has(k)) {
            batch.set(ref, { data: { id: w.id } as Person, scope: 'family', updatedAt, updatedBy: uid, deleted: true } satisfies Rec);
          }
          seen.set(k, updatedAt);
        }
        try {
          await batch.commit();
        } catch (e) {
          throw friendly(e, role);
        }
      }
      // For the owner's admin page; best-effort so logging can never fail an edit.
      if (summary) void logActivity(spaceId, uid, summary).catch((e) => console.warn('[cloud] activity log failed', e));
    },
  };
}
