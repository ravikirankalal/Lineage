/**
 * In-memory RemoteStore for tests (sync engine, coordinator, QA). One `FakeCloud` is the shared
 * server; `cloud.as(uid, role)` returns a RemoteStore view that mirrors firestore.rules:
 *   - owner: reads/writes everything;
 *   - editor: reads 'family' records; may create/update only when the new scope is 'family' and the
 *     stored record (if any) is 'family';
 *   - viewer: reads 'family' records; every push is rejected;
 *   - updatedBy is forced to the caller's uid (the rules require it);
 *   - updatedAt must be a finite number no more than MAX_SKEW_MS ahead of the server clock, and
 *     strictly greater than the stored record's updatedAt (no rewinds, no same-version overwrites).
 *   - data.photo, if present, must be a png/jpeg/webp base64 data URL under MAX_PHOTO_CHARS;
 *   - non-owners may not set data.isMe on create, nor change it on update.
 * `cloud.write` bypasses these checks: use it to plant legacy or malicious data.
 * A rejected push writes nothing (like a failed Firestore batch).
 */
import type { CloudCollection, CloudRecord, RemoteStore, Role } from '../cloud/contract';
import type { Person, Relationship } from '../types';
import { MAX_PHOTO_CHARS, MAX_SKEW_MS } from '../sync';

const PHOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const photoOk = (d: object | null) =>
  !d || !('photo' in d) || (typeof d.photo === 'string' && d.photo.length < MAX_PHOTO_CHARS && PHOTO_RE.test(d.photo));
const isMeOf = (d: unknown) => !!d && typeof d === 'object' && (d as { isMe?: unknown }).isMe === true;

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
    const now = Date.now();
    for (const { id, rec } of items) {
      const stored = this.cloud.store[collection].get(id);
      const ok =
        typeof rec.updatedAt === 'number' &&
        Number.isFinite(rec.updatedAt) &&
        rec.updatedAt <= now + MAX_SKEW_MS &&
        (!stored || rec.updatedAt > stored.updatedAt) &&
        (rec.scope === 'family' || rec.scope === 'private') &&
        (!rec.data || !('id' in rec.data) || rec.data.id === id) &&
        photoOk(rec.data) &&
        (this.role === 'owner' ||
          (this.role === 'editor' &&
            rec.scope === 'family' &&
            (stored?.scope ?? 'family') === 'family' &&
            isMeOf(rec.data) === isMeOf(stored?.data)));
      if (!ok) throw new Error(`permission-denied: ${this.role} cannot write ${collection}/${id} (${rec.scope}, updatedAt ${rec.updatedAt})`);
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
