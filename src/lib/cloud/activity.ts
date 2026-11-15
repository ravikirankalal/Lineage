/**
 * Activity log for the owner's admin page: one small entry per saved change, saying who made it and
 * how many people and links it added, changed or removed. Written by owners and editors for their own
 * changes; only the owner can read it; nobody can change or delete an entry (firestore.rules).
 * Logging is best-effort and separate from the change itself, so it can never block an edit.
 * There is no history from before the log existed (records only keep who touched them last).
 */
import type { Write } from '../store';
import { getDb } from './firebase';

export interface ActivityCounts {
  peopleAdded: number;
  peopleEdited: number;
  peopleRemoved: number;
  linksAdded: number;
  linksChanged: number;
  linksRemoved: number;
}

export interface ActivityEntry extends ActivityCounts {
  id: string;
  /** uid of whoever saved the change. */
  by: string;
  /** ms since epoch. */
  at: number;
}

const ZERO: ActivityCounts = { peopleAdded: 0, peopleEdited: 0, peopleRemoved: 0, linksAdded: 0, linksChanged: 0, linksRemoved: 0 };

/** What one save did. `existed` says whether a record was already stored before it. Null if nothing. */
export function summarise(writes: Write[], existed: (w: Write) => boolean): ActivityCounts | null {
  const c = { ...ZERO };
  for (const w of writes) {
    const was = existed(w);
    if (w.coll === 'people') {
      if (!w.data) { if (was) c.peopleRemoved++; } else if (was) c.peopleEdited++; else c.peopleAdded++;
    } else if (!w.data) { if (was) c.linksRemoved++; } else if (was) c.linksChanged++; else c.linksAdded++;
  }
  return Object.values(c).some((n) => n > 0) ? c : null;
}

/** An edit is any save that changed what was already there, or linked people already in the tree. */
export function isEdit(c: ActivityCounts): boolean {
  return c.peopleEdited + c.peopleRemoved + c.linksChanged + c.linksRemoved > 0 || (c.linksAdded > 0 && c.peopleAdded === 0);
}

export interface MemberActivity {
  peopleAdded: number;
  edits: number;
  last?: number;
}

/** Totals per member (uid). */
export function activityByMember(entries: ActivityEntry[]): Map<string, MemberActivity> {
  const out = new Map<string, MemberActivity>();
  for (const e of entries) {
    const m = out.get(e.by) ?? { peopleAdded: 0, edits: 0 };
    m.peopleAdded += e.peopleAdded;
    if (isEdit(e)) m.edits++;
    m.last = Math.max(m.last ?? 0, e.at);
    out.set(e.by, m);
  }
  return out;
}

/** Record one save (best-effort: failures are ignored). */
export async function logActivity(spaceId: string, uid: string, counts: ActivityCounts): Promise<void> {
  const db = await getDb();
  const { addDoc, collection } = await import('firebase/firestore');
  await addDoc(collection(db, 'spaces', spaceId, 'activity'), { by: uid, at: Date.now(), ...counts });
}

/** Owner only: every entry, newest first. */
export async function listActivity(spaceId: string): Promise<ActivityEntry[]> {
  const db = await getDb();
  const { collection, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(db, 'spaces', spaceId, 'activity'));
  return snap.docs.map((d) => ({ ...ZERO, ...(d.data() as Omit<ActivityEntry, 'id'>), id: d.id })).sort((a, b) => b.at - a.at);
}
