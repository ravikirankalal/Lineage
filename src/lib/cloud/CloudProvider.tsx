/**
 * CloudProvider: orchestrates Google sign-in, the personal space, sharing invites and sync.
 * Implements the ui-builder part of contract.ts (CloudContext) plus a few UI conveniences.
 *
 * Local-first: when Firebase is not configured or nobody is signed in, the provider only renders
 * its children with status 'off' and the app works exactly as before.
 */
import Dexie from 'dexie';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LOCAL_DB_NAME, SPACE_DB_PREFIX, activeSpaceId, db, dbNameFor, forgetSpace, openSpaceDb } from '../db';
import { syncOnce } from '../sync';
import { useAuth } from './auth';
import type { AuthState, CloudContext, CloudUser, InviteDoc, Role, Space, SyncStatus } from './contract';
import { firestoreRemote } from './firestoreRemote';
import { acceptInvite as apiAcceptInvite, ensurePersonalSpace, listMySpaces, myPendingInvites, removeMember, revokeInvite } from './spaces';

export type MySpace = Space & { role: Role };
export type PendingInvite = InviteDoc & { spaceId: string };

export interface CloudValue extends CloudContext {
  /** False when Firebase is not configured: render no cloud UI at all. */
  configured: boolean;
  /** The space being viewed is someone else's family. */
  isShared: boolean;
  /** Changes whenever the local database is swapped; DataProvider is keyed on it. */
  dataKey: string;
  invites: PendingInvite[];
  acceptInvite(spaceId: string): Promise<void>;
  declineInvite(spaceId: string): Promise<void>;
  leaveSpace(spaceId: string): Promise<void>;
  refreshSpaces(): Promise<void>;
  /** One-time message, e.g. "You no longer have access to Asha's family." */
  notice: string | null;
  dismissNotice(): void;
  /** Sign out; keepLocal=false removes every copy of the data from this device. */
  signOut(keepLocal: boolean): Promise<void>;
  /** Questions asked before this device's local people ever reach a Google account. */
  backup: {
    /** "Back up your N people?": the local people aren't claimed by any account yet. */
    asking: boolean;
    /** The local people belong to ANOTHER account that used this browser. Never uploaded. */
    foreign: boolean;
    /** The user said "Not now": nothing syncs on this device. */
    paused: boolean;
    count: number;
    /** The Google account already had a tree (another device): the two will be combined. */
    combine: boolean;
    /** This account keeps its own people in a separate local database on this browser. */
    separateLocal: boolean;
    approve(): void;
    decline(): void;
    /** foreign: leave the other account's people alone; this account gets its own local copy. */
    keepSeparate(): Promise<void>;
    /** foreign: delete the other account's people from this device (no tombstones, no upload). */
    removeLocal(): Promise<void>;
  };
}

const OFF: SyncStatus = { state: 'off' };
const LS_ACTIVE = 'lineage:activeSpace';
/** The uid whose personal data lives in the anonymous 'lineage' DB (set on backup consent). */
const LS_LOCAL_OWNER = 'lineage:localOwnerUid';
/** This uid's personal space lives in its own 'lineage-space-<uid>' DB, not in 'lineage'. */
const lsSeparate = (uid: string) => `lineage:separateLocal:${uid}`;
/** Which uid last filled a 'lineage-space-*' DB (a cache must never cross accounts). */
const lsDbOwner = (name: string) => `lineage:dbOwner:${name}`;
/** Last full (pruning) sync of a shared space, ms. */
const lsLastFull = (spaceId: string) => `lineage:lastFullSync:${spaceId}`;
const FULL_SYNC_EVERY = 6 * 60 * 60 * 1000;
const isPermissionError = (e: unknown) => /permission|denied|insufficient/i.test(String((e as Error)?.message ?? e));
const lsDeclined = (uid: string) => 'lineage:declinedInvites:' + uid;

const lsSpaceName = (spaceId: string) => `lineage:spaceName:${spaceId}`;

/**
 * Delete this device's copies of shared families that `uid` no longer belongs to, according to
 * `list` (the server's authoritative membership list; call only with a successful listMySpaces
 * result, never with a fallback). Only copies filled by this same account are touched, and the
 * account's own separate DB is never touched. Returns the names of the families removed.
 */
async function forgetLostSpaces(uid: string, list: { id: string }[]): Promise<string[]> {
  const keep = new Set(list.map((s) => s.id));
  let names: string[] = [];
  try {
    names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '');
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(SPACE_DB_PREFIX)) continue;
    const id = name.slice(SPACE_DB_PREFIX.length);
    if (!id || id === uid || keep.has(id)) continue;
    if (lsGet(lsDbOwner(name)) !== uid) continue;
    await forgetSpace(id).catch(() => undefined);
    lsSet(lsDbOwner(name), null);
    lsSet(lsLastFull(id), null);
    if (lsGet(LS_ACTIVE) === id) lsSet(LS_ACTIVE, null);
    removed.push(lsGet(lsSpaceName(id)) ?? 'a family shared with you');
    lsSet(lsSpaceName(id), null);
  }
  return removed;
}

function lsGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
}

export function firstNameOf(user: CloudUser): string {
  const n = user.name?.trim().split(/\s+/)[0];
  if (n) return n;
  const local = user.email.split('@')[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : 'My';
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission|denied|insufficient/i.test(msg)) return 'You no longer have access to this family.';
  if (/network|offline|unavailable|failed to fetch/i.test(msg)) return 'Can’t reach the internet. Changes are saved on this device.';
  return 'Sync didn’t work: ' + msg;
}

/** Before using a space DB as `uid`, drop it if another account's copy is in it. */
async function claimSpaceDb(spaceId: string, uid: string) {
  const key = lsDbOwner(dbNameFor(spaceId));
  const owner = lsGet(key);
  if (owner && owner !== uid) await forgetSpace(spaceId).catch(() => undefined);
  lsSet(key, uid);
}

async function dropSpaceDb(spaceId: string) {
  await forgetSpace(spaceId).catch(() => undefined);
  lsSet(lsDbOwner(dbNameFor(spaceId)), null);
}

/** People in the anonymous local DB, wherever we currently are. */
async function countLocalPeople(): Promise<number> {
  if (activeSpaceId() === null) return db.people.count().catch(() => 0);
  if (!(await Dexie.exists(LOCAL_DB_NAME))) return 0;
  const local = new Dexie(LOCAL_DB_NAME);
  try {
    await local.open();
    return local.tables.some((t) => t.name === 'people') ? await local.table('people').count() : 0;
  } catch {
    return 0;
  } finally {
    local.close();
  }
}

/** Delete the anonymous local DB outright: no clearAll, so no tombstones reach any cloud. */
async function deleteLocalDb() {
  if (activeSpaceId() === null) await db.delete({ disableAutoOpen: false }).catch(() => undefined);
  else await Dexie.delete(LOCAL_DB_NAME).catch(() => undefined);
  lsSet(LS_LOCAL_OWNER, null);
}

/**
 * Is the live local DB (the one `db` points at right now) really `uid`'s copy of `spaceId`?
 * Read from localStorage at call time, so a change made by another tab is seen immediately.
 */
function localDbBelongsTo(uid: string, spaceId: string): boolean {
  const active = activeSpaceId();
  if (active === null) {
    // The anonymous 'lineage' DB: only the account that claimed it may push it, and only to its own space.
    return spaceId === uid && lsGet(LS_LOCAL_OWNER) === uid && !lsGet(lsSeparate(uid));
  }
  if (active === uid) {
    // This account's separate personal DB.
    return spaceId === uid && !!lsGet(lsSeparate(uid)) && lsGet(lsDbOwner(dbNameFor(uid))) === uid;
  }
  // A shared family's cache, filled by this account.
  return spaceId === active && lsGet(lsDbOwner(dbNameFor(active))) === uid;
}

type ConsentState = 'unknown' | 'asking' | 'foreign' | 'granted' | 'declined';
/** Consent is always bound to the account that gave it; it never carries over to another uid. */
interface Consent { uid: string | null; state: ConsentState }

const Ctx = createContext<CloudValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { user } = auth;
  const uid = user?.uid;

  const [status, setStatus] = useState<SyncStatus>(OFF);
  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [personal, setPersonal] = useState<MySpace | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => activeSpaceId());
  const [dataKey, setDataKey] = useState(() => 'db:' + (activeSpaceId() ?? 'local') + ':0');
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [consent, setConsent] = useState<Consent>({ uid: null, state: 'unknown' });
  /** Local DB holding this account's own people: null = 'lineage', or the uid (separate DB). */
  const [personalDbId, setPersonalDbId] = useState<string | null>(null);
  const personalDb = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [cloudHadData, setCloudHadData] = useState(false);
  /** The uid whose sign-in bootstrap has finished (state for rendering, ref for async guards). */
  const [initialisedUid, setInitialisedUid] = useState<string | null>(null);
  const initialisedRef = useRef<string | null>(null);
  /** Latest values for guards inside async code (closures may be from an earlier account). */
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const consentRef = useRef(consent);
  consentRef.current = consent;

  // --- Account change: reset synchronously, during render, before any effect can sync ------------
  // (React re-renders immediately with the reset state; no effect ever runs with A's consent and B's uid.)
  const [seenUid, setSeenUid] = useState(uid);
  if (seenUid !== uid) {
    setSeenUid(uid);
    setConsent({ uid: uid ?? null, state: 'unknown' });
    setInitialisedUid(null);
    initialisedRef.current = null;
    consentRef.current = { uid: uid ?? null, state: 'unknown' };
    personalDb.current = null;
    setPersonalDbId(null);
    setStatus(OFF);
    setSpaces([]);
    setPersonal(null);
    setInvites([]);
    setLocalCount(0);
    setCloudHadData(false);
    setNotice(null);
  }
  /** Consent only counts for the account that gave it. */
  const consentState: ConsentState = consent.uid === (uid ?? null) ? consent.state : 'unknown';

  // --- Space list -------------------------------------------------------------------------------

  // --- Switching the local database --------------------------------------------------------------
  const swapDb = useCallback((spaceId: string | null) => {
    openSpaceDb(spaceId);
    setActiveId(spaceId);
    setDataKey((k) => `db:${spaceId ?? 'local'}:${Number(k.split(':').pop()) + 1}`);
  }, []);

  const refreshSpaces = useCallback(async () => {
    if (!user) return;
    try {
      const list = await listMySpaces(user.uid);
      for (const sp of list) if (sp.id !== user.uid) lsSet(lsSpaceName(sp.id), sp.name);
      setSpaces(list);
      // Removed from a family (noticed on focus, reload or startup): wipe its copy from this device.
      const lost = await forgetLostSpaces(user.uid, list);
      if (lost.length) {
        if (activeSpaceId() !== personalDb.current) swapDb(personalDb.current);
        setNotice(`You no longer have access to ${lost.join(', ')}. ${lost.length === 1 ? 'It has' : 'They have'} been removed from this device.`);
      }
      const declined = new Set(JSON.parse(lsGet(lsDeclined(user.uid)) ?? '[]') as string[]);
      const inv = await myPendingInvites(user);
      setInvites(inv.filter((i) => !declined.has(i.spaceId) && !list.some((s) => s.id === i.spaceId)));
    } catch (e) {
      if (!navigator.onLine) setStatus((s) => ({ ...s, state: 'offline' }));
      else console.warn('[cloud] could not load spaces', e);
    }
  }, [user, swapDb]);

  // --- Sign-in bootstrap: personal space and first-backup consent --------------------------------
  useEffect(() => {
    if (!user) return; // everything was reset when the uid changed
    let cancelled = false;
    (async () => {
      setStatus({ state: 'syncing' });
      try {
        // Did the cloud space exist before? (decides how we word the first-backup question)
        const before = await listMySpaces(user.uid).catch(() => [] as MySpace[]);
        const existed = before.some((s) => s.id === user.uid);
        const space = await ensurePersonalSpace(user, `${firstNameOf(user)}'s family`);
        if (cancelled) return;
        setPersonal({ ...space, role: 'owner' });
        setSpaces(existed ? before : [{ ...space, role: 'owner' }, ...before]);
        setCloudHadData(existed);

        // Whose are the people in this browser's local DB? Never upload another account's rows.
        const owner = lsGet(LS_LOCAL_OWNER);
        const count = await countLocalPeople();
        if (cancelled) return;
        setLocalCount(count);
        let mine: string | null = null;
        let next: 'asking' | 'foreign' | 'granted';
        if (lsGet(lsSeparate(user.uid))) {
          mine = user.uid;
          next = 'granted';
        } else if (owner === user.uid) {
          next = 'granted';
        } else if (count === 0) {
          lsSet(LS_LOCAL_OWNER, user.uid);
          next = 'granted';
        } else {
          next = owner ? 'foreign' : 'asking';
        }
        personalDb.current = mine;
        setPersonalDbId(mine);

        if (next === 'granted') {
          // Re-open the shared space we were last viewing, if still a member; else our own people.
          const last = lsGet(LS_ACTIVE);
          const lastSpace = last && last !== user.uid ? before.find((s) => s.id === last) : undefined;
          const target = lastSpace ? lastSpace.id : mine;
          if (target) await claimSpaceDb(target, user.uid);
          if (cancelled) return;
          if (activeSpaceId() !== target) swapDb(target);
        } else {
          if (activeSpaceId() !== null) swapDb(null);
          setStatus({ state: 'idle' });
        }
        // Bootstrap for this uid is complete: only now may sync start (and only if consent is granted).
        initialisedRef.current = user.uid;
        setInitialisedUid(user.uid);
        setConsent({ uid: user.uid, state: next });
        await refreshSpaces();
      } catch (e) {
        if (!cancelled) setStatus({ state: navigator.onLine ? 'error' : 'offline', error: friendlyError(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [user, refreshSpaces, swapDb]);

  // --- Active space and role ---------------------------------------------------------------------
  const activeSpace: MySpace | null = useMemo(() => {
    if (!user) return null;
    if (activeId) return spaces.find((s) => s.id === activeId) ?? null;
    return spaces.find((s) => s.id === user.uid) ?? personal;
  }, [user, activeId, spaces, personal]);
  // Until a shared space's role is known, assume the most restrictive one.
  const role: Role = activeSpace?.role ?? (activeId ? 'viewer' : 'owner');
  const isShared = !!user && !!activeId && activeId !== user.uid;

  // If we were removed from the space we're viewing, fall back to our own people.
  useEffect(() => {
    if (user && activeId && spaces.length && !spaces.some((s) => s.id === activeId)) {
      lsSet(LS_ACTIVE, null);
      swapDb(personalDb.current);
    }
  }, [user, activeId, spaces, swapDb]);

  // --- Sync engine -------------------------------------------------------------------------------
  const remoteSpaceId = user ? (activeId ?? user.uid) : null;
  const canSync = !!uid && consentState === 'granted' && initialisedUid === uid && (!isShared || !!activeSpace);
  const remote = useMemo(
    () => (canSync && uid && remoteSpaceId ? firestoreRemote(remoteSpaceId, uid, role) : null),
    [canSync, uid, remoteSpaceId, role],
  );

  const running = useRef<Promise<void> | null>(null);
  const changedDuringSync = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncing = useRef(false);

  /**
   * M1 guard, re-checked right before every push: the account this sync was built for is still the
   * signed-in one, it gave consent itself, its bootstrap finished, and the live local DB is its own
   * copy of `spaceId`. Any mismatch means "do nothing" (never upload one account's rows to another).
   */
  const syncAllowed = useCallback((forUid: string, spaceId: string) => (
    uidRef.current === forUid &&
    consentRef.current.uid === forUid && consentRef.current.state === 'granted' &&
    initialisedRef.current === forUid &&
    localDbBelongsTo(forUid, spaceId)
  ), []);

  /** One sync round. In a shared space, `forceFull` (or 6 h since the last one) re-pulls everything
   * so records the owner stopped sharing are pruned from this device. */
  const runSync = useCallback(async (forceFull = false) => {
    if (!remote || !uid || !remoteSpaceId) return;
    if (!syncAllowed(uid, remoteSpaceId)) return;
    if (running.current) return running.current;
    if (!navigator.onLine) {
      setStatus((s) => ({ ...s, state: 'offline', error: undefined }));
      return;
    }
    const spaceId = remoteSpaceId;
    const spaceName = activeSpace?.name;
    // Members accept "me" only from themselves or the family's owner (planted isMe defence).
    const ownerUid = isShared ? activeSpace?.ownerUid : uid;
    const p = (async () => {
      syncing.current = true;
      changedDuringSync.current = false;
      setStatus((s) => ({ ...s, state: 'syncing', error: undefined }));
      try {
        const lastFull = Number(lsGet(lsLastFull(spaceId)) ?? 0);
        const full = isShared && (forceFull || Date.now() - lastFull > FULL_SYNC_EVERY);
        const meId = role === 'owner' && !isShared ? (await db.people.filter((x) => !!x.isMe).first())?.id : undefined;
        if (!syncAllowed(uid, spaceId)) { setStatus((s) => ({ ...s, state: 'idle' })); return; }
        await syncOnce(db, remote, { uid, role, meId, ownerUid, spaceKey: spaceId, full });
        if (full) lsSet(lsLastFull(spaceId), String(Date.now()));
        setStatus({ state: 'idle', lastSyncedAt: Date.now() });
      } catch (e) {
        if (isShared && isPermissionError(e)) {
          // One rejected write is not proof of lost access (e.g. an offline edit to a person the owner
          // has since made private). Ask the server whether we're still a member before wiping anything.
          let list: MySpace[] | null = null;
          try { list = await listMySpaces(uid); } catch { list = null; }
          if (uidRef.current !== uid) return;
          const still = list?.find((s) => s.id === spaceId);
          if (list && !still) {
            // Membership really is gone: drop this family's copy and go back to our own people.
            await forgetSpace(spaceId).catch(() => undefined);
            lsSet(lsDbOwner(dbNameFor(spaceId)), null);
            lsSet(lsLastFull(spaceId), null);
            lsSet(LS_ACTIVE, null);
            swapDb(personalDb.current);
            setNotice(`You no longer have access to ${spaceName ?? 'that family'}. It has been removed from this device.`);
            setStatus({ state: 'idle' });
            setSpaces(list);
          } else if (!list) {
            // Couldn't check (offline, flaky network): keep everything and try again later.
            setStatus((s) => ({ ...s, state: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? 'Sync didn’t work. Your changes are saved on this device.' : undefined }));
          } else if (still && still.role !== role) {
            // Our role changed (e.g. editor -> viewer): the new remote re-syncs with the right role.
            setSpaces(list);
            setStatus({ state: 'idle' });
          } else {
            // Still a member with the same role: a full sync prunes what's no longer shared, then retry once.
            setSpaces(list);
            try {
              if (!syncAllowed(uid, spaceId)) return;
              await syncOnce(db, remote, { uid, role, ownerUid, spaceKey: spaceId, full: true });
              lsSet(lsLastFull(spaceId), String(Date.now()));
              if (!syncAllowed(uid, spaceId)) return;
              await syncOnce(db, remote, { uid, role, ownerUid, spaceKey: spaceId });
              setStatus({ state: 'idle', lastSyncedAt: Date.now() });
            } catch (e2) {
              // Never wipe here: the notice below explains it; other errors show as usual.
              if (isPermissionError(e2)) setStatus({ state: 'idle' });
              else setStatus((s) => ({ ...s, state: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? friendlyError(e2) : undefined }));
            }
            setNotice('Some changes couldn’t be saved because that person is no longer shared.');
          }
        } else {
          setStatus((s) => ({ ...s, state: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? friendlyError(e) : undefined }));
          if (isPermissionError(e)) void refreshSpaces();
        }
      } finally {
        syncing.current = false;
        running.current = null;
      }
    })();
    running.current = p;
    await p;
  }, [remote, uid, role, isShared, remoteSpaceId, activeSpace, refreshSpaces, swapDb, syncAllowed]);

  const schedule = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSync(); }, ms);
  }, [runSync]);

  // Sync when the remote becomes available (sign-in, space switch, consent).
  // A shared space is fully synced (pruned) when opened, then about every 6 h while open.
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  useEffect(() => {
    if (!remote) return;
    void runSyncRef.current(true).then(() => {
      if (changedDuringSync.current) schedule(3000);
    });
    const unsub = remote.subscribe?.(() => schedule(800));
    const fullTimer = isShared ? setInterval(() => { void runSyncRef.current(true); }, FULL_SYNC_EVERY) : undefined;
    return () => {
      unsub?.();
      clearTimeout(timer.current);
      clearInterval(fullTimer);
    };
  }, [remote, isShared, schedule]);

  // Local edits: Dexie hooks on the live db (re-attached whenever the db is swapped).
  useEffect(() => {
    if (!remote) return;
    const onChange = () => {
      if (syncing.current) changedDuringSync.current = true;
      else schedule(3000);
    };
    const tables = [db.people, db.relationships];
    for (const t of tables) {
      t.hook('creating', onChange);
      t.hook('updating', onChange);
      t.hook('deleting', onChange);
    }
    return () => {
      for (const t of tables) {
        t.hook('creating').unsubscribe(onChange);
        t.hook('updating').unsubscribe(onChange);
        t.hook('deleting').unsubscribe(onChange);
      }
    };
  }, [remote, dataKey, schedule]);

  // After a sync that overlapped with local edits, run once more.
  useEffect(() => {
    if (status.state === 'idle' && changedDuringSync.current) {
      changedDuringSync.current = false;
      schedule(3000);
    }
  }, [status, schedule]);

  // Window focus / back online.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      schedule(300);
      void refreshSpaces();
    };
    const onOffline = () => setStatus((s) => (s.state === 'off' ? s : { ...s, state: 'offline', error: undefined }));
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user, schedule, refreshSpaces]);

  // --- Actions -----------------------------------------------------------------------------------
  const switchSpace = useCallback(async (spaceId: string) => {
    const target = !user ? null : spaceId === user.uid ? personalDb.current : spaceId;
    lsSet(LS_ACTIVE, target === personalDb.current ? null : target);
    if (target === activeSpaceId()) return;
    if (target && user) await claimSpaceDb(target, user.uid);
    swapDb(target);
    // The sync effect fires when `remote` changes with the new space.
  }, [user, swapDb]);

  const syncNow = useCallback(async () => {
    await refreshSpaces();
    await runSync();
  }, [refreshSpaces, runSync]);

  const acceptInvite = useCallback(async (spaceId: string) => {
    if (!user) return;
    await apiAcceptInvite(user, spaceId);
    setInvites((l) => l.filter((i) => i.spaceId !== spaceId));
    const list = await listMySpaces(user.uid);
    setSpaces(list);
    if (list.some((s) => s.id === spaceId)) await switchSpace(spaceId);
  }, [user, switchSpace]);

  const declineInvite = useCallback(async (spaceId: string) => {
    if (!user) return;
    setInvites((l) => l.filter((i) => i.spaceId !== spaceId));
    // The rules may not let invitees delete their invite; remember the choice on this device anyway.
    const declined = new Set(JSON.parse(lsGet(lsDeclined(user.uid)) ?? '[]') as string[]);
    declined.add(spaceId);
    lsSet(lsDeclined(user.uid), JSON.stringify([...declined]));
    await revokeInvite(spaceId, user.email.toLowerCase()).catch(() => undefined);
  }, [user]);

  const leaveSpace = useCallback(async (spaceId: string) => {
    if (!user || spaceId === user.uid) return;
    await removeMember(spaceId, user.uid);
    if (activeSpaceId() === spaceId) await switchSpace(user.uid);
    await dropSpaceDb(spaceId);
    await refreshSpaces();
  }, [user, switchSpace, refreshSpaces]);

  const signOut = useCallback(async (keepLocal: boolean) => {
    const known = spaces.map((s) => s.id);
    const me = user?.uid;
    const separate = personalDb.current;
    clearTimeout(timer.current);
    lsSet(LS_ACTIVE, null);
    if (activeSpaceId() !== null) swapDb(null);
    await auth.signOut();
    if (!keepLocal) {
      // Delete databases outright (never clearAll: its tombstones would wipe the cloud copy).
      for (const id of known) if (id !== me) await dropSpaceDb(id);
      if (separate) {
        await dropSpaceDb(separate);
        if (me) lsSet(lsSeparate(me), null);
      } else {
        // Only remove the anonymous DB if it is ours (or unclaimed); never another account's.
        const owner = lsGet(LS_LOCAL_OWNER);
        if (!owner || owner === me) await deleteLocalDb();
      }
      swapDb(null);
    }
  }, [auth, spaces, user, swapDb]);

  const backup = useMemo(() => ({
    asking: consentState === 'asking',
    foreign: consentState === 'foreign',
    paused: consentState === 'declined',
    count: localCount,
    combine: cloudHadData,
    separateLocal: personalDbId !== null,
    approve: () => {
      if (!uid) return;
      lsSet(LS_LOCAL_OWNER, uid);
      setConsent({ uid, state: 'granted' });
    },
    decline: () => {
      if (!uid) return;
      setConsent({ uid, state: 'declined' });
      setStatus({ state: 'idle' });
    },
    keepSeparate: async () => {
      if (!uid) return;
      lsSet(lsSeparate(uid), '1');
      await claimSpaceDb(uid, uid);
      personalDb.current = uid;
      setPersonalDbId(uid);
      swapDb(uid);
      setConsent({ uid, state: 'granted' });
    },
    removeLocal: async () => {
      if (!uid) return;
      if (activeSpaceId() !== null) swapDb(null);
      await deleteLocalDb();
      lsSet(LS_LOCAL_OWNER, uid);
      swapDb(null);
      setLocalCount(0);
      setConsent({ uid, state: 'granted' });
    },
  }), [consentState, localCount, cloudHadData, personalDbId, uid, swapDb]);

  const value = useMemo<CloudValue>(() => ({
    auth: auth as AuthState,
    configured: auth.configured,
    status: auth.configured && user ? status : OFF,
    spaces,
    activeSpace,
    switchSpace,
    syncNow,
    role: user ? role : 'owner',
    isShared,
    dataKey,
    invites,
    acceptInvite,
    declineInvite,
    leaveSpace,
    refreshSpaces,
    signOut,
    backup,
    notice,
    dismissNotice: () => setNotice(null),
  }), [auth, user, status, spaces, activeSpace, switchSpace, syncNow, role, isShared, dataKey, invites, acceptInvite, declineInvite, leaveSpace, refreshSpaces, signOut, backup, notice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloud(): CloudValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCloud outside CloudProvider');
  return v;
}

/** What the current user may do in the space being viewed. The server rules are the real gate. */
export function usePermissions() {
  const { role, isShared } = useCloud();
  return {
    /** Create, edit, delete, merge, import. False for viewers. */
    canEdit: role !== 'viewer',
    /** Manage sharing, reset data, load samples, set "This is me": only in your own people. */
    isOwner: role === 'owner' && !isShared,
    /** Viewing someone else's family: friends and private notes never sync here. */
    isShared,
    role,
  };
}

/** The one switch for hiding create/edit/delete/merge/import affordances. */
export function useCanEdit(): boolean {
  return usePermissions().canEdit;
}

/** Plain-words sync status, e.g. "Synced 2 min ago". */
export function syncStatusText(s: SyncStatus, now = Date.now()): string {
  switch (s.state) {
    case 'syncing': return 'Syncing…';
    case 'offline': return 'Offline — changes saved on this device';
    case 'error': return s.error ?? 'Sync didn’t work. Your changes are saved on this device.';
    case 'off': return 'Not syncing';
    default: {
      if (!s.lastSyncedAt) return 'Ready to sync';
      const sec = Math.max(0, Math.round((now - s.lastSyncedAt) / 1000));
      if (sec < 45) return 'Synced just now';
      const min = Math.round(sec / 60);
      if (min < 60) return `Synced ${min} min ago`;
      const h = Math.round(min / 60);
      if (h < 24) return `Synced ${h} h ago`;
      return 'Synced ' + new Date(s.lastSyncedAt).toLocaleDateString();
    }
  }
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
export const ROLE_HINT: Record<Role, string> = {
  owner: 'Can do everything',
  editor: 'Can add & edit family',
  viewer: 'Can see',
};
