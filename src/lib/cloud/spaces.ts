/**
 * Spaces, invites and membership (security-engineer). Implements SpacesApi from contract.ts.
 * Every operation here is authorized server-side by firestore.rules; these functions only shape
 * the writes so that the rules accept them.
 */
import type { CloudUser, InviteDoc, MemberRole, Role, Space, SpaceDoc, SpacesApi } from './contract';
import { getDb, getFirebaseAuth } from './firebase';

const ROLES: Role[] = ['owner', 'editor', 'viewer'];

const fs = () => import('firebase/firestore');

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function currentUid(): Promise<string> {
  const auth = await getFirebaseAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in first.');
  return uid;
}

function wrap(e: unknown, action: string): unknown {
  return (e as { code?: string })?.code === 'permission-denied'
    ? new Error(`Permission denied: you are not allowed to ${action}.`)
    : e;
}

/** Gets or creates the user's personal space (id == uid). */
export async function ensurePersonalSpace(user: CloudUser, name: string): Promise<Space> {
  const db = await getDb();
  const { doc, runTransaction } = await fs();
  const ref = doc(db, 'spaces', user.uid);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return { id: snap.id, ...(snap.data() as SpaceDoc) };
      const info: { email: string; name?: string } = { email: normEmail(user.email) };
      if (user.name) info.name = user.name;
      const data: SpaceDoc = {
        name,
        ownerUid: user.uid,
        members: { [user.uid]: 'owner' },
        memberInfo: { [user.uid]: info },
        createdAt: Date.now(),
      };
      tx.set(ref, data);
      return { id: user.uid, ...data };
    });
  } catch (e) {
    throw wrap(e, 'create your personal space');
  }
}

export async function listMySpaces(uid: string): Promise<(Space & { role: Role })[]> {
  const db = await getDb();
  const { collection, query, where, getDocs } = await fs();
  const snap = await getDocs(query(collection(db, 'spaces'), where(`members.${uid}`, 'in', ROLES)));
  return snap.docs.map((d) => {
    const data = d.data() as SpaceDoc;
    return { id: d.id, ...data, role: data.members[uid] };
  });
}

export async function invite(spaceId: string, email: string, role: MemberRole): Promise<void> {
  const addr = normEmail(email);
  if (!/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(addr)) throw new Error('Enter a valid email address.');
  if (role !== 'editor' && role !== 'viewer') throw new Error('Role must be editor or viewer.');
  const uid = await currentUid();
  const db = await getDb();
  const { doc, getDoc, setDoc } = await fs();
  try {
    const space = await getDoc(doc(db, 'spaces', spaceId));
    const data: InviteDoc = {
      email: addr,
      role,
      invitedBy: uid,
      spaceName: (space.data() as SpaceDoc | undefined)?.name ?? '',
      createdAt: Date.now(),
    };
    await setDoc(doc(db, 'spaces', spaceId, 'invites', addr), data);
  } catch (e) {
    throw wrap(e, 'invite people to this space');
  }
}

export async function revokeInvite(spaceId: string, email: string): Promise<void> {
  const db = await getDb();
  const { doc, deleteDoc } = await fs();
  try {
    await deleteDoc(doc(db, 'spaces', spaceId, 'invites', normEmail(email)));
  } catch (e) {
    throw wrap(e, 'revoke this invite');
  }
}

export async function listInvites(spaceId: string): Promise<InviteDoc[]> {
  const db = await getDb();
  const { collection, getDocs } = await fs();
  try {
    const snap = await getDocs(collection(db, 'spaces', spaceId, 'invites'));
    return snap.docs.map((d) => d.data() as InviteDoc);
  } catch (e) {
    throw wrap(e, 'see invites for this space');
  }
}

export async function myPendingInvites(user: CloudUser): Promise<(InviteDoc & { spaceId: string })[]> {
  if (!user.email) return [];
  const db = await getDb();
  const { collectionGroup, query, where, getDocs } = await fs();
  try {
    const snap = await getDocs(query(collectionGroup(db, 'invites'), where('email', '==', normEmail(user.email))));
    return snap.docs
      .filter((d) => d.ref.parent.parent)
      .map((d) => ({ ...(d.data() as InviteDoc), spaceId: d.ref.parent.parent!.id }));
  } catch (e) {
    // Unverified emails can't read invites (rules require email_verified).
    throw wrap(e, 'read invites (is your email verified?)');
  }
}

/** Joins a space: adds only the caller's uid with the invited role, then deletes the invite. */
export async function acceptInvite(user: CloudUser, spaceId: string): Promise<void> {
  const db = await getDb();
  const { doc, getDoc, writeBatch, FieldPath } = await fs();
  const inviteRef = doc(db, 'spaces', spaceId, 'invites', normEmail(user.email));
  try {
    const inv = await getDoc(inviteRef);
    if (!inv.exists()) throw new Error('This invite no longer exists.');
    const { role } = inv.data() as InviteDoc;
    const info: { email: string; name?: string } = { email: normEmail(user.email) };
    if (user.name) info.name = user.name;
    const batch = writeBatch(db);
    batch.update(doc(db, 'spaces', spaceId), new FieldPath('members', user.uid), role, new FieldPath('memberInfo', user.uid), info);
    batch.delete(inviteRef);
    await batch.commit();
  } catch (e) {
    throw wrap(e, 'join this space');
  }
}

export async function setRole(spaceId: string, uid: string, role: MemberRole): Promise<void> {
  if (role !== 'editor' && role !== 'viewer') throw new Error('Role must be editor or viewer.');
  const db = await getDb();
  const { doc, updateDoc, FieldPath } = await fs();
  try {
    await updateDoc(doc(db, 'spaces', spaceId), new FieldPath('members', uid), role);
  } catch (e) {
    throw wrap(e, "change members' roles");
  }
}

/** Owner removes a member, or a member leaves (uid == self). */
export async function removeMember(spaceId: string, uid: string): Promise<void> {
  const db = await getDb();
  const { doc, updateDoc, deleteField, FieldPath } = await fs();
  try {
    await updateDoc(
      doc(db, 'spaces', spaceId),
      new FieldPath('members', uid),
      deleteField(),
      new FieldPath('memberInfo', uid),
      deleteField(),
    );
  } catch (e) {
    throw wrap(e, 'remove this member');
  }
}

/** The same functions as one object, typed against the contract. */
export const spacesApi: SpacesApi = {
  ensurePersonalSpace,
  listMySpaces,
  invite,
  revokeInvite,
  listInvites,
  myPendingInvites,
  acceptInvite,
  setRole,
  removeMember,
};
