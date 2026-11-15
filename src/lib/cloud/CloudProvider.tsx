/**
 * CloudProvider: Google sign-in, the family spaces you belong to, sharing invites, and which family's
 * tree the store is streaming. Sign-in is required: without it there is no data (see App's gate).
 * There is no copy on the device and nothing to sync: the store reads and writes Firestore directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { purgeLooseContacts } from '../db';
import { store } from '../store';
import { useAuth } from './auth';
import type { AuthState, CloudUser, InviteDoc, Role, Space } from './contract';
import { firestoreBackend } from './firestoreBackend';
import { acceptInvite as apiAcceptInvite, ensurePersonalSpace, listMySpaces, myPendingInvites, removeMember, revokeInvite } from './spaces';

export type MySpace = Space & { role: Role };
export type PendingInvite = InviteDoc & { spaceId: string };

export interface CloudValue {
  auth: AuthState;
  /** False when Firebase is not configured (a broken build): the app can't run. */
  configured: boolean;
  /** 'loading' until the family's tree has arrived; 'error' when it can't be read. */
  state: 'loading' | 'ready' | 'error';
  error?: string;
  online: boolean;
  spaces: MySpace[];
  activeSpace: MySpace | null;
  switchSpace(spaceId: string): void;
  /** Role in the family being viewed. The UI hides edits for 'viewer'; the rules are the real gate. */
  role: Role;
  /** The family being viewed is someone else's. */
  isShared: boolean;
  invites: PendingInvite[];
  acceptInvite(spaceId: string): Promise<void>;
  declineInvite(spaceId: string): Promise<void>;
  leaveSpace(spaceId: string): Promise<void>;
  refreshSpaces(): Promise<void>;
  /** One-time message, e.g. "You no longer have access to Asha's family." */
  notice: string | null;
  dismissNotice(): void;
  signOut(): Promise<void>;
}

const LS_ACTIVE = 'lineage:activeSpace';
const lsDeclined = (uid: string) => 'lineage:declinedInvites:' + uid;

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

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
    },
    () => navigator.onLine,
  );
}

const Ctx = createContext<CloudValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { user } = auth;
  const uid = user?.uid;
  const online = useOnline();

  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [personal, setPersonal] = useState<MySpace | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => lsGet(LS_ACTIVE));
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const snap = useSyncExternalStore(store.subscribe, store.get);

  // Account change: forget everything about the previous account, during render.
  const [seenUid, setSeenUid] = useState(uid);
  if (seenUid !== uid) {
    setSeenUid(uid);
    setSpaces([]);
    setPersonal(null);
    setInvites([]);
    setNotice(null);
    setBootError(null);
  }

  const refreshSpaces = useCallback(async () => {
    if (!user) return;
    try {
      const list = await listMySpaces(user.uid);
      setSpaces(list);
      const declined = new Set(JSON.parse(lsGet(lsDeclined(user.uid)) ?? '[]') as string[]);
      const inv = await myPendingInvites(user);
      setInvites(inv.filter((i) => !declined.has(i.spaceId) && !list.some((s) => s.id === i.spaceId)));
    } catch (e) {
      console.warn('[cloud] could not load spaces', e);
    }
  }, [user]);

  // Sign-in: make sure the personal family exists, then load the list of families.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const space = await ensurePersonalSpace(user, `${firstNameOf(user)}'s family`);
        if (cancelled) return;
        setPersonal({ ...space, role: 'owner' });
        await refreshSpaces();
      } catch (e) {
        if (!cancelled) setBootError(navigator.onLine ? 'Couldn’t open your family tree. Try again in a moment.' : 'You’re offline. Lineage needs the internet.');
        console.warn('[cloud] sign-in setup failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refreshSpaces]);

  const activeSpace: MySpace | null = useMemo(() => {
    if (!user) return null;
    if (activeId && activeId !== user.uid) {
      const shared = spaces.find((s) => s.id === activeId);
      if (shared) return shared;
    }
    return spaces.find((s) => s.id === user.uid) ?? personal;
  }, [user, activeId, spaces, personal]);
  const role: Role = activeSpace?.role ?? 'viewer';
  const isShared = !!user && !!activeSpace && activeSpace.id !== user.uid;

  // If we were removed from the family we were viewing, go back to our own.
  useEffect(() => {
    if (user && activeId && activeId !== user.uid && spaces.length && !spaces.some((s) => s.id === activeId)) {
      lsSet(LS_ACTIVE, null);
      setActiveId(null);
    }
  }, [user, activeId, spaces]);

  // Stream the active family's tree.
  const spaceId = activeSpace?.id;
  useEffect(() => {
    if (!uid || !spaceId) { store.connect(null); return; }
    store.connect(firestoreBackend(spaceId, uid, role));
    return () => store.connect(null);
  }, [uid, spaceId, role]);

  // Reading the family failed (e.g. removed from it): re-check membership, which falls back above.
  const storeError = snap.loaded ? null : store.error;
  useEffect(() => {
    if (!storeError || !isShared) return;
    setNotice(`You no longer have access to ${activeSpace?.name ?? 'that family'}.`);
    void refreshSpaces();
  }, [storeError, isShared, activeSpace?.name, refreshSpaces]);

  // Contacts import is gone: delete, once, the owner's imported contacts that never became family.
  const purged = useRef<string | null>(null);
  useEffect(() => {
    if (!snap.loaded || isShared || role !== 'owner' || !uid || purged.current === uid) return;
    purged.current = uid;
    void purgeLooseContacts().catch((e) => { purged.current = null; console.warn('[cloud] contact clean-up failed', e); });
  }, [snap.loaded, isShared, role, uid]);

  const switchSpace = useCallback((id: string) => {
    const next = !user || id === user.uid ? null : id;
    lsSet(LS_ACTIVE, next);
    setActiveId(next);
  }, [user]);

  const acceptInvite = useCallback(async (id: string) => {
    if (!user) return;
    await apiAcceptInvite(user, id);
    setInvites((l) => l.filter((i) => i.spaceId !== id));
    const list = await listMySpaces(user.uid);
    setSpaces(list);
    if (list.some((s) => s.id === id)) switchSpace(id);
  }, [user, switchSpace]);

  const declineInvite = useCallback(async (id: string) => {
    if (!user) return;
    setInvites((l) => l.filter((i) => i.spaceId !== id));
    // The rules may not let invitees delete their invite; remember the choice on this device anyway.
    const declined = new Set(JSON.parse(lsGet(lsDeclined(user.uid)) ?? '[]') as string[]);
    declined.add(id);
    lsSet(lsDeclined(user.uid), JSON.stringify([...declined]));
    await revokeInvite(id, user.email.toLowerCase()).catch(() => undefined);
  }, [user]);

  const leaveSpace = useCallback(async (id: string) => {
    if (!user || id === user.uid) return;
    await removeMember(id, user.uid);
    if (activeSpace?.id === id) switchSpace(user.uid);
    await refreshSpaces();
  }, [user, activeSpace?.id, switchSpace, refreshSpaces]);

  const signOut = useCallback(async () => {
    lsSet(LS_ACTIVE, null);
    setActiveId(null);
    store.connect(null);
    await auth.signOut();
  }, [auth]);

  const errorText = bootError ?? (storeError ? (storeError as Error).message ?? 'Couldn’t read this family tree.' : null);
  const state: CloudValue['state'] = errorText ? 'error' : snap.loaded ? 'ready' : 'loading';

  const value = useMemo<CloudValue>(() => ({
    auth: auth as AuthState,
    configured: auth.configured,
    state,
    error: errorText ?? undefined,
    online,
    spaces,
    activeSpace,
    switchSpace,
    role,
    isShared,
    invites,
    acceptInvite,
    declineInvite,
    leaveSpace,
    refreshSpaces,
    notice,
    dismissNotice: () => setNotice(null),
    signOut,
  }), [auth, state, errorText, online, spaces, activeSpace, switchSpace, role, isShared, invites, acceptInvite, declineInvite, leaveSpace, refreshSpaces, notice, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloud(): CloudValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCloud outside CloudProvider');
  return v;
}

/** What the current user may do in the family being viewed. The server rules are the real gate. */
export function usePermissions() {
  const { role, isShared, online } = useCloud();
  return {
    /** Create, edit, delete, merge. False for viewers, and while offline (nothing can be saved). */
    canEdit: role !== 'viewer' && online,
    /** Manage sharing, load the sample, set "This is me": only in your own family. */
    isOwner: role === 'owner' && !isShared,
    /** Viewing someone else's family. */
    isShared,
    role,
  };
}

/** The one switch for hiding create/edit/delete/merge affordances. */
export function useCanEdit(): boolean {
  return usePermissions().canEdit;
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
export const ROLE_HINT: Record<Role, string> = {
  owner: 'Can do everything',
  editor: 'Can add & edit family',
  viewer: 'Can see',
};
