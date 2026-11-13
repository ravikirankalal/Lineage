/**
 * CLOUD CONTRACT: the shared agreement between the agents building auth, sync and sharing.
 * Change it only with the coordinator's agreement. Implementations live in the files named below.
 *
 * Product rules
 * - Local-first stays: without sign-in (or without Firebase config) the app works exactly as before.
 * - Google sign-in (Firebase Auth) unlocks:
 *   1. Sync: the signed-in user's own data syncs to their personal space across devices.
 *   2. Sharing: the owner invites relatives by email as `editor` or `viewer`.
 *      Members see ONLY the family part of the tree (people in the owner's family component plus
 *      family edges between them). Friends, colleagues and private notes about non-family people
 *      never leave the owner's account.
 * - Authorization is enforced SERVER-SIDE by Firestore security rules (firestore.rules). The UI only
 *   mirrors it (e.g. hides edit buttons for viewers); never rely on the UI for security.
 *
 * Firestore layout
 *   spaces/{spaceId}                       SpaceDoc     personal space id == owner's uid
 *   spaces/{spaceId}/people/{personId}     CloudRecord<Person>
 *   spaces/{spaceId}/relationships/{relId} CloudRecord<Relationship>
 *   spaces/{spaceId}/invites/{emailLower}  InviteDoc
 *
 * Roles (enforced in firestore.rules)
 *   owner : read/write everything in the space, manage members and invites, delete the space.
 *   editor: read space doc; read/create/update/soft-delete records with scope == 'family' only;
 *           cannot create or read 'private' records; cannot change members except leaving.
 *   viewer: read space doc and scope == 'family' records only.
 *   invitee (signed in, verified email == invite id): read own invite; join by adding ONLY their own
 *           uid to members with exactly the invited role; then delete the invite.
 *   everyone else: nothing.
 *   Every write must set updatedBy == request.auth.uid, and updatedAt must be a number.
 */
import type { Person, Relationship } from '../types';

export type Role = 'owner' | 'editor' | 'viewer';
export type MemberRole = Exclude<Role, 'owner'>;
export type Scope = 'family' | 'private';

export interface CloudUser {
  uid: string;
  email: string;
  name?: string;
  photoURL?: string;
}

export interface SpaceDoc {
  name: string; // e.g. "Ravi's family"
  ownerUid: string;
  members: Record<string, Role>; // uid -> role (owner included)
  memberInfo?: Record<string, { email: string; name?: string }>; // display only
  createdAt: number;
}
export interface Space extends SpaceDoc {
  id: string;
}

export interface InviteDoc {
  email: string; // lower-cased, == doc id
  role: MemberRole;
  invitedBy: string; // uid
  invitedByEmail?: string; // inviter's verified auth email (rules require it on new writes)
  spaceName: string;
  createdAt: number;
}

/** A synced record. `data` is the local Person/Relationship. */
export interface CloudRecord<T> {
  data: T;
  scope: Scope;
  updatedAt: number; // ms, last-write-wins
  updatedBy: string; // uid
  deleted?: boolean; // tombstone (soft delete)
}

export type CloudCollection = 'people' | 'relationships';

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// security-engineer: src/lib/cloud/firebase.ts, auth.ts, firestoreRemote.ts, spaces.ts

/** firebase.ts. Config comes from VITE_FIREBASE_* env vars; with VITE_FIREBASE_EMULATORS=1, connect to
 * local emulators (auth 9099, firestore 8080, project "demo-lineage"). */
export interface FirebaseModule {
  cloudConfigured(): boolean;
}

/** auth.ts: React hook. */
export interface AuthState {
  configured: boolean; // false when no Firebase config: hide all cloud UI
  loading: boolean;
  user: CloudUser | null;
  signIn(): Promise<void>; // Google popup, falling back to redirect on mobile or popup block
  signOut(): Promise<void>;
}
// export function useAuth(): AuthState

/** firestoreRemote.ts: Firestore implementation of the sync engine's RemoteStore. */
// export function firestoreRemote(spaceId: string, uid: string, role: Role): RemoteStore

/** spaces.ts: space and membership operations (all authorized by the rules). */
export interface SpacesApi {
  ensurePersonalSpace(user: CloudUser, name: string): Promise<Space>; // id == uid
  listMySpaces(uid: string): Promise<(Space & { role: Role })[]>;
  invite(spaceId: string, email: string, role: MemberRole): Promise<void>;
  revokeInvite(spaceId: string, email: string): Promise<void>;
  listInvites(spaceId: string): Promise<InviteDoc[]>; // owner only
  myPendingInvites(user: CloudUser): Promise<(InviteDoc & { spaceId: string })[]>; // collectionGroup query by email
  acceptInvite(user: CloudUser, spaceId: string): Promise<void>;
  setRole(spaceId: string, uid: string, role: MemberRole): Promise<void>; // owner only
  removeMember(spaceId: string, uid: string): Promise<void>; // owner, or self (leave)
}

// ---------------------------------------------------------------------------
// data-steward: src/lib/sync.ts (pure, testable with a fake RemoteStore), plus db.ts changes

export interface RemoteStore {
  /** Records changed with updatedAt > since (tombstones included). */
  pull(collection: CloudCollection, since: number): Promise<{ id: string; rec: CloudRecord<Person | Relationship> }[]>;
  /** Upsert records (rules decide whether allowed; reject with an Error on permission-denied). */
  push(collection: CloudCollection, items: { id: string; rec: CloudRecord<Person | Relationship> }[]): Promise<void>;
  /** Optional live updates; returns an unsubscribe function. */
  subscribe?(onChange: () => void): () => void;
}

/**
 * sync.ts:
 *   syncOnce(local: LineageDB, remote: RemoteStore, opts: { uid: string; role: Role; meId?: string }): Promise<{ pulled: number; pushed: number }>
 *     Two-way last-write-wins by updatedAt; local deletes become tombstones; remote tombstones delete locally.
 *     Owner computes scope: 'family' for people in familyComponent(meId) and family-type edges whose both
 *     ends are family; everything else 'private'. Editors only push 'family' records; viewers never push.
 *   computeScopes(people, rels, meId?): Map<string, Scope>
 *
 * db.ts (Dexie version 2 migration):
 *   - relationships gain updatedAt (backfill = createdAt); every write sets it.
 *   - new table `tombstones` (id, table, deletedAt); deletePerson/deleteRelationship/clearAll/merge record them.
 *   - a `meta` key-value table for lastPulledAt per space.
 *   - switchable database: export function openSpaceDb(spaceId: string | null): void
 *     (null = the local/personal 'lineage' DB; shared spaces use 'lineage-space-<id>'),
 *     and `export let db` is a live binding re-pointed by openSpaceDb. Also export
 *     `activeSpaceId(): string | null`.
 */

// ---------------------------------------------------------------------------
// ui-builder: src/lib/cloud/CloudProvider.tsx (orchestration and context) plus UI

export interface CloudContext {
  auth: AuthState;
  status: SyncStatus;
  spaces: (Space & { role: Role })[];
  activeSpace: (Space & { role: Role }) | null; // null = local, not signed in
  switchSpace(spaceId: string): Promise<void>;
  syncNow(): Promise<void>;
  /** Role in the active space ('owner' when local or personal). UI hides edits for 'viewer'. */
  role: Role;
}
// export function useCloud(): CloudContext
