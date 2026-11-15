/**
 * Test backend for the store: an in-memory "space". `commits` records each batch the app sent, and
 * `db` is a tiny Dexie-shaped view (bulkPut, get, toArray, count, update) for seeding and checking.
 */
import { store, type Backend, type Write } from '../store';
import type { Person, Relationship } from '../types';

export interface MemoryBackend extends Backend {
  commits: Write[][];
  offline: string | null;
}

export function memoryBackend(): { backend: MemoryBackend; db: TestDb } {
  const people = new Map<string, Person>();
  const rels = new Map<string, Relationship>();
  let push: (() => void) | null = null;
  const emit = () => push?.();

  const backend: MemoryBackend = {
    commits: [],
    offline: null,
    canWrite() { return backend.offline; },
    start(onData) {
      push = () => onData(new Map(people), new Map(rels));
      push();
      return () => { push = null; };
    },
    async commit(writes) {
      backend.commits.push(writes);
      for (const w of writes) {
        const m = (w.coll === 'people' ? people : rels) as Map<string, Person | Relationship>;
        if (w.data) m.set(w.id, structuredClone(w.data)); else m.delete(w.id);
      }
      emit();
    },
  };

  const table = <T extends { id: string }>(m: Map<string, T>) => ({
    async bulkPut(rows: T[]) { for (const r of rows) m.set(r.id, structuredClone(r)); emit(); },
    async get(id: string) { const r = m.get(id); return r && structuredClone(r); },
    async toArray() { return [...m.values()].map((r) => structuredClone(r)); },
    async count() { return m.size; },
    async update(id: string, patch: Partial<T>) { const r = m.get(id); if (r) { m.set(id, { ...r, ...patch }); emit(); } },
  });
  const db = { people: table(people), relationships: table(rels) };
  return { backend, db };
}

export type TestDb = { people: TableOf<Person>; relationships: TableOf<Relationship> };
type TableOf<T> = {
  bulkPut(rows: T[]): Promise<void>;
  get(id: string): Promise<T | undefined>;
  toArray(): Promise<T[]>;
  count(): Promise<number>;
  update(id: string, patch: Partial<T>): Promise<void>;
};

/** A fresh empty space, connected to the store. */
export function freshSpace() {
  const m = memoryBackend();
  store.connect(m.backend);
  return m;
}
