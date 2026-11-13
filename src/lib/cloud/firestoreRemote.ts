/**
 * Firestore implementation of the sync engine's RemoteStore (security-engineer). See contract.ts.
 *
 * Rules are not filters: non-owners MUST query with `scope == 'family'`, or the whole query is
 * rejected. The owner reads everything in their space.
 */
import type { Person, Relationship } from '../types';
import type { CloudCollection, CloudRecord, RemoteStore, Role } from './contract';
import { getDb } from './firebase';

const BATCH_LIMIT = 400;
const DEBOUNCE_MS = 600;
const COLLECTIONS: CloudCollection[] = ['people', 'relationships'];

type Rec = CloudRecord<Person | Relationship>;

export function permissionError(action: string, role: Role): Error {
  return new Error(
    `Permission denied: you can't ${action} in this space (your role: ${role}). ` +
      (role === 'viewer' ? 'Viewers can only read.' : role === 'editor' ? 'Editors can change family records only.' : ''),
  );
}

function mapError(e: unknown, action: string, role: Role): unknown {
  return (e as { code?: string })?.code === 'permission-denied' ? permissionError(action, role) : e;
}

export function firestoreRemote(spaceId: string, uid: string, role: Role): RemoteStore {
  const isOwner = role === 'owner';

  return {
    async pull(collection, since) {
      const db = await getDb();
      const { collection: col, query, where, getDocs } = await import('firebase/firestore');
      const ref = col(db, 'spaces', spaceId, collection);
      const q = isOwner
        ? query(ref, where('updatedAt', '>', since))
        : query(ref, where('scope', '==', 'family'), where('updatedAt', '>', since));
      try {
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, rec: d.data() as Rec }));
      } catch (e) {
        throw mapError(e, `read ${collection}`, role);
      }
    },

    async push(collection, items) {
      if (!items.length) return;
      if (role === 'viewer') throw permissionError(`change ${collection}`, role);
      if (!isOwner && items.some((it) => it.rec.scope !== 'family')) throw permissionError('write private records', role);
      const db = await getDb();
      const { doc, writeBatch } = await import('firebase/firestore');
      for (let i = 0; i < items.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const { id, rec } of items.slice(i, i + BATCH_LIMIT)) {
          // updatedBy is always the signed-in user; the rules reject anything else.
          batch.set(doc(db, 'spaces', spaceId, collection, id), { ...rec, updatedBy: uid });
        }
        try {
          await batch.commit();
        } catch (e) {
          throw mapError(e, `change ${collection}`, role);
        }
      }
    },

    subscribe(onChange) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;
      const unsubs: (() => void)[] = [];
      const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(() => !stopped && onChange(), DEBOUNCE_MS);
      };
      void (async () => {
        const db = await getDb();
        const { collection: col, query, where, orderBy, limit, onSnapshot } = await import('firebase/firestore');
        if (stopped) return;
        for (const c of COLLECTIONS) {
          const ref = col(db, 'spaces', spaceId, c);
          // A change signal only: the newest record. Any newer write elsewhere changes it; the sync
          // engine then pulls by updatedAt. This keeps the listener to one document read.
          const q = isOwner
            ? query(ref, orderBy('updatedAt', 'desc'), limit(1))
            : query(ref, where('scope', '==', 'family'), orderBy('updatedAt', 'desc'), limit(1));
          let first = true;
          unsubs.push(
            onSnapshot(
              q,
              (snap) => {
                if (first) {
                  first = false;
                  return;
                }
                if (snap.metadata.hasPendingWrites) return; // our own local write echo
                if (snap.docChanges().length) fire();
              },
              (e) => console.warn(`Live updates for ${c} stopped`, mapError(e, `read ${c}`, role)),
            ),
          );
        }
      })().catch((e) => console.warn('Live updates unavailable', e));
      return () => {
        stopped = true;
        clearTimeout(timer);
        unsubs.forEach((u) => u());
      };
    },
  };
}
