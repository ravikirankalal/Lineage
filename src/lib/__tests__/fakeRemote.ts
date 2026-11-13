/**
 * In-memory RemoteStore for tests (sync engine, coordinator, QA). One `FakeCloud` is the shared
 * server; `cloud.as(uid, role)` returns a RemoteStore view that mirrors firestore.rules:
 *   - owner: reads/writes everything;
 *   - editor: reads 'family' records; may create/update only when the new scope is 'family' and the
 *     stored record (if any) is 'family';
 *   - viewer: reads 'family' records; every push is rejected;
 *   - updatedBy is forced to the caller's uid (the rules require it).
 * A rejected push writes nothing (like a failed Firestore batch).
 */
import type { CloudCollection, CloudRecord, RemoteStore, Role } from '../cloud/contract';
import type { Person, Relationship } from '../types';

type Rec = CloudRecord<Person | Relationship>;

export class FakeCloud {
  readonly store: Record<CloudCollection, Map<string, Rec>> = { people: new Map(), relationships: new Map() };
  /** Every accepted push, in order. */
  readonly log: { uid: string; collection: CloudCollection; id: string; rec: Rec }[] = [];
  private listeners = new Set<() => void>();

  as(uid: string, role: Role): FakeRemote {
    return new FakeRemote(this, uid, role);
  }

  get(collection: CloudCollection, id: string): Rec | undefined {
    const r = this.store[collection].get(id);
    return r && structuredClone(r);
  }

  /** Live (non-deleted) records. */
  alive(collection: CloudCollection): { id: string; rec: Rec }[] {
    return [...this.store[collection]].filter(([, r]) => !r.deleted).map(([id, rec]) => ({ id, rec: structuredClone(rec) }));
  }

  /** @internal */
  write(uid: string, collection: CloudCollection, items: { id: string; rec: Rec }[]) {
    for (const { id, rec } of items) {
      const stored = structuredClone({ ...rec, updatedBy: uid });
      this.store[collection].set(id, stored);
      this.log.push({ uid, collection, id, rec: stored });
    }
    for (const l of this.listeners) l();
  }

  /** @internal */
  listen(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class FakeRemote implements RemoteStore {
  constructor(
    readonly cloud: FakeCloud,
    readonly uid: string,
    readonly role: Role,
  ) {}

  async pull(collection: CloudCollection, since: number) {
    const out: { id: string; rec: Rec }[] = [];
    for (const [id, rec] of this.cloud.store[collection]) {
      if (rec.updatedAt <= since) continue;
      if (this.role !== 'owner' && rec.scope !== 'family') continue;
      out.push({ id, rec: structuredClone(rec) });
    }
    return out;
  }

  async push(collection: CloudCollection, items: { id: string; rec: Rec }[]) {
    if (!items.length) return;
    for (const { id, rec } of items) {
      const ok =
        typeof rec.updatedAt === 'number' &&
        (rec.scope === 'family' || rec.scope === 'private') &&
        (!rec.data || !('id' in rec.data) || rec.data.id === id) &&
        (this.role === 'owner' ||
          (this.role === 'editor' &&
            rec.scope === 'family' &&
            (this.cloud.store[collection].get(id)?.scope ?? 'family') === 'family'));
      if (!ok) throw new Error(`permission-denied: ${this.role} cannot write ${collection}/${id} (${rec.scope})`);
    }
    this.cloud.write(this.uid, collection, items);
  }

  subscribe(onChange: () => void) {
    const off = this.cloud.listen(onChange);
    return () => {
      off();
    };
  }
}
