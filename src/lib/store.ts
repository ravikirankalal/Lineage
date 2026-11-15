/**
 * The family tree as it is right now, live from the cloud. There is no copy on the device: a backend
 * (Firestore in the app, an in-memory one in tests) streams the space's records in, and every change
 * is one batch of writes sent straight back.
 *
 *   store.connect(backend)  start streaming a space (CloudProvider does this after sign-in)
 *   store.get()             the current snapshot: { loaded, people, rels }
 *   write((t) => …)         read and change through a transaction, then commit it as one batch
 */
import type { Person, Relationship } from './types';

export type Collection = 'people' | 'relationships';

/** One document write: a record to store, or null to delete it. */
export interface Write {
  coll: Collection;
  id: string;
  data: Person | Relationship | null;
}

export interface Snapshot {
  loaded: boolean;
  people: ReadonlyMap<string, Person>;
  rels: ReadonlyMap<string, Relationship>;
}

export interface Backend {
  /** Stream the space: call `onData` with full maps whenever anything changes. Returns a stop function. */
  start(onData: (people: Map<string, Person>, rels: Map<string, Relationship>) => void, onError: (e: unknown) => void): () => void;
  /** Apply the writes atomically (or fail as a whole). */
  commit(writes: Write[]): Promise<void>;
  /** False when changes can't be sent right now (offline, or read-only). The message says why. */
  canWrite(): string | null;
}

const EMPTY: Snapshot = { loaded: false, people: new Map(), rels: new Map() };

class Store {
  private snap: Snapshot = EMPTY;
  private backend: Backend | null = null;
  private stop: (() => void) | null = null;
  private listeners = new Set<() => void>();
  error: unknown = null;

  get = (): Snapshot => this.snap;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };

  private emit(next: Snapshot) {
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  connect(backend: Backend | null) {
    this.stop?.();
    this.stop = null;
    this.backend = backend;
    this.error = null;
    this.emit(EMPTY);
    if (!backend) return;
    this.stop = backend.start(
      (people, rels) => { if (this.backend === backend) this.emit({ loaded: true, people, rels }); },
      (e) => { if (this.backend === backend) { this.error = e; this.emit({ ...this.snap }); } },
    );
  }

  async commit(writes: Write[]) {
    const b = this.backend;
    if (!b) throw new Error('Sign in to make changes.');
    const why = b.canWrite();
    if (why) throw new Error(why);
    if (writes.length) await b.commit(writes);
  }
}

export const store = new Store();

/**
 * A read-your-writes view of the snapshot plus the changes made so far. Reads see pending writes;
 * nothing reaches the backend until `write()` commits them all together.
 */
export class Tx {
  private people = new Map<string, Person | null>();
  private rels = new Map<string, Relationship | null>();

  constructor(private base: Snapshot) {}

  person(id: string): Person | undefined {
    const p = this.people.get(id);
    return p === null ? undefined : p ?? this.base.people.get(id);
  }
  allPeople(): Person[] {
    const out = new Map(this.base.people);
    for (const [id, p] of this.people) if (p) out.set(id, p); else out.delete(id);
    return [...out.values()];
  }
  rel(id: string): Relationship | undefined {
    const r = this.rels.get(id);
    return r === null ? undefined : r ?? this.base.rels.get(id);
  }
  allRels(): Relationship[] {
    const out = new Map(this.base.rels);
    for (const [id, r] of this.rels) if (r) out.set(id, r); else out.delete(id);
    return [...out.values()];
  }

  putPerson(p: Person) { this.people.set(p.id, p); }
  removePerson(id: string) { if (this.person(id)) this.people.set(id, null); }
  putRel(r: Relationship) { this.rels.set(r.id, r); }
  removeRel(id: string) { if (this.rel(id)) this.rels.set(id, null); }

  writes(): Write[] {
    return [
      ...[...this.people].map(([id, data]) => ({ coll: 'people' as const, id, data })),
      ...[...this.rels].map(([id, data]) => ({ coll: 'relationships' as const, id, data })),
    ];
  }
}

/** Run `fn` against the current tree, then send its changes as one batch. Returns `fn`'s result. */
export async function write<T>(fn: (t: Tx) => T): Promise<T> {
  const t = new Tx(store.get());
  const out = fn(t);
  await store.commit(t.writes());
  return out;
}

/** Read-only: run `fn` against the current tree without writing. */
export function read<T>(fn: (t: Tx) => T): T {
  return fn(new Tx(store.get()));
}
