/**
 * CLOUD CONTRACT: the shared agreement for sign-in, the family spaces and sharing.
 *
 * Product rules
 * - Sign-in (Google, Firebase Auth) is required. The family tree lives only in Firestore: the app
 *   reads it live and writes changes straight back (store.ts, firestoreBackend.ts). There is no
 *   copy on the device, no sync step and no offline editing.
 * - Sharing: the owner invites relatives by email as `editor` (must be a person in the tree with a
 *   phone number) or `viewer`. Every record is written with scope 'family', so members see the
 *   whole tree; older 'private' records stay readable by the owner only.
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
 *   editor: read space doc; read/create/update/soft-delete records with scope == 'family' only.
 *   viewer: read space doc and scope == 'family' records only.
 *   invitee (signed in, verified email == invite id): read own invite; join by adding ONLY their own
 *           uid to members with exactly the invited role; then delete the invite.
 *   everyone else: nothing.
 *   Every write must set updatedBy == request.auth.uid, and updatedAt must be newer than before.
 */

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
  memberInfo?: Record<string, { email: string; name?: string; personId?: string }>; // display, plus who they are in the tree
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
  /** Who they are in the tree. Required for editors: a person with a phone number (rules). */
  personId?: string;
}

/** A stored record. `data` is the Person/Relationship. */
export interface CloudRecord<T> {
  data: T;
  scope: Scope;
  updatedAt: number; // ms, last-write-wins
  updatedBy: string; // uid
  deleted?: boolean; // soft delete (editors; older versions' tombstones)
}

// ---------------------------------------------------------------------------
// security-engineer: src/lib/cloud/firebase.ts, auth.ts, firestoreBackend.ts, spaces.ts

/** firebase.ts. Config comes from VITE_FIREBASE_* env vars; with VITE_FIREBASE_EMULATORS=1, connect to
 * local emulators (auth 9099, firestore 8080, project "demo-lineage"). */
export interface FirebaseModule {
  cloudConfigured(): boolean;
}

/** auth.ts: React hook. */
export interface AuthState {
  configured: boolean; // false when the build has no Firebase config (the app can't run)
  loading: boolean;
  user: CloudUser | null;
  signIn(): Promise<void>; // Google popup, falling back to redirect on mobile or popup block
  signOut(): Promise<void>;
}
// export function useAuth(): AuthState

/** firestoreBackend.ts: the store's backend, streaming one space and writing it in batches. */
// export function firestoreBackend(spaceId: string, uid: string, role: Role): Backend

/** spaces.ts: space and membership operations (all authorized by the rules). */
export interface SpacesApi {
  ensurePersonalSpace(user: CloudUser, name: string): Promise<Space>; // id == uid
  listMySpaces(uid: string): Promise<(Space & { role: Role })[]>;
  invite(spaceId: string, email: string, role: MemberRole, personId?: string): Promise<void>; // editors need personId
  revokeInvite(spaceId: string, email: string): Promise<void>;
  listInvites(spaceId: string): Promise<InviteDoc[]>; // owner only
  myPendingInvites(user: CloudUser): Promise<(InviteDoc & { spaceId: string })[]>; // collectionGroup query by email
  acceptInvite(user: CloudUser, spaceId: string): Promise<void>;
  setRole(spaceId: string, uid: string, role: MemberRole, personId?: string): Promise<void>; // owner only
  removeMember(spaceId: string, uid: string): Promise<void>; // owner, or self (leave)
}
