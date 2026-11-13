/**
 * Firestore security-rules tests (run on the emulator: `npm run test:rules`).
 * All people and emails here are invented; the repository is public.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type TokenOptions,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

const SPACE = 'alice';
const ROLES = ['owner', 'editor', 'viewer'];

const USERS: Record<string, { uid: string; token: TokenOptions }> = {
  owner: { uid: 'alice', token: { email: 'alice@example.com', email_verified: true } },
  editor: { uid: 'erin', token: { email: 'erin@example.com', email_verified: true } },
  viewer: { uid: 'victor', token: { email: 'victor@example.com', email_verified: true } },
  invitee: { uid: 'ivy', token: { email: 'Ivy@Example.com', email_verified: true } }, // invited as viewer
  invitee2: { uid: 'ed', token: { email: 'ed@example.com', email_verified: true } }, // invited as editor
  unverified: { uid: 'uma', token: { email: 'uma@example.com', email_verified: false } }, // invited as editor
  stranger: { uid: 'sam', token: { email: 'sam@example.com', email_verified: true } },
};

let env: RulesTestEnvironment;

function as(who: keyof typeof USERS | 'anon'): Firestore {
  if (who === 'anon') return env.unauthenticatedContext().firestore() as unknown as Firestore;
  const { uid, token } = USERS[who];
  return env.authenticatedContext(uid, token).firestore() as unknown as Firestore;
}

const person = (id: string, firstName = 'Test') => ({ id, firstName, gender: 'unknown', phones: [], emails: [], work: [], education: [], facts: [], tags: [], createdAt: 1, updatedAt: 1 });
const rel = (id: string) => ({ id, fromId: 'p1', toId: 'p2', type: 'parent', createdAt: 1 });
const rec = (data: object, scope: 'family' | 'private', by: string, extra: object = {}) => ({ data, scope, updatedAt: 100, updatedBy: by, ...extra });

function invite(email: string, role: string, by = 'alice', byEmail = `${by}@example.com`) {
  return { email, role, invitedBy: by, invitedByEmail: byEmail, spaceName: "Alice's family", createdAt: 1 };
}

const FUTURE = () => Date.now() + 10 * 60 * 1000; // beyond the 5-minute skew allowance

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8180').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-lineage',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'spaces', SPACE), {
      name: "Alice's family",
      ownerUid: 'alice',
      members: { alice: 'owner', erin: 'editor', victor: 'viewer' },
      memberInfo: { alice: { email: 'alice@example.com' }, erin: { email: 'erin@example.com' }, victor: { email: 'victor@example.com' } },
      createdAt: 1,
    });
    await setDoc(doc(db, 'spaces', SPACE, 'people', 'fam1'), rec(person('fam1', 'Grandma'), 'family', 'alice'));
    await setDoc(doc(db, 'spaces', SPACE, 'people', 'priv1'), rec(person('priv1', 'Friend'), 'private', 'alice'));
    await setDoc(doc(db, 'spaces', SPACE, 'relationships', 'famrel'), rec(rel('famrel'), 'family', 'alice'));
    await setDoc(doc(db, 'spaces', SPACE, 'relationships', 'privrel'), rec(rel('privrel'), 'private', 'alice'));
    await setDoc(doc(db, 'spaces', SPACE, 'invites', 'ivy@example.com'), invite('ivy@example.com', 'viewer'));
    await setDoc(doc(db, 'spaces', SPACE, 'invites', 'ed@example.com'), invite('ed@example.com', 'editor'));
    await setDoc(doc(db, 'spaces', SPACE, 'invites', 'uma@example.com'), invite('uma@example.com', 'editor'));
    // Another user's space, to check isolation.
    await setDoc(doc(db, 'spaces', 'sam'), { name: 'Sam', ownerUid: 'sam', members: { sam: 'owner' }, createdAt: 1 });
    await setDoc(doc(db, 'spaces', 'sam', 'people', 's1'), rec(person('s1'), 'family', 'sam'));
  });
});

const spaceRef = (db: Firestore, id = SPACE) => doc(db, 'spaces', id);
const recRef = (db: Firestore, c: 'people' | 'relationships', id: string) => doc(db, 'spaces', SPACE, c, id);
const invRef = (db: Firestore, email: string) => doc(db, 'spaces', SPACE, 'invites', email);
const familyQuery = (db: Firestore, c: 'people' | 'relationships') =>
  query(collection(db, 'spaces', SPACE, c), where('scope', '==', 'family'), where('updatedAt', '>', 0));
const allQuery = (db: Firestore, c: 'people' | 'relationships') => query(collection(db, 'spaces', SPACE, c), where('updatedAt', '>', 0));
const mySpacesQuery = (db: Firestore, uid: string) => query(collection(db, 'spaces'), where(`members.${uid}`, 'in', ROLES));

// ---------------------------------------------------------------------------
describe('signed out', () => {
  it('cannot read or write anything', async () => {
    const db = as('anon');
    await assertFails(getDoc(spaceRef(db)));
    await assertFails(getDoc(recRef(db, 'people', 'fam1')));
    await assertFails(getDocs(familyQuery(db, 'people')));
    await assertFails(getDoc(invRef(db, 'ivy@example.com')));
    await assertFails(setDoc(recRef(db, 'people', 'x'), rec(person('x'), 'family', 'anon')));
    await assertFails(setDoc(doc(db, 'spaces', 'anon'), { name: 'x', ownerUid: 'anon', members: { anon: 'owner' }, createdAt: 1 }));
    await assertFails(getDocs(collectionGroup(db, 'invites')));
  });
});

// ---------------------------------------------------------------------------
describe('owner', () => {
  it('reads the space, all records and invites; lists own spaces', async () => {
    const db = as('owner');
    await assertSucceeds(getDoc(spaceRef(db)));
    await assertSucceeds(getDoc(recRef(db, 'people', 'priv1')));
    await assertSucceeds(getDoc(recRef(db, 'relationships', 'privrel')));
    const all = await assertSucceeds(getDocs(allQuery(db, 'people')));
    expect(all.size).toBe(2);
    await assertSucceeds(getDocs(collection(db, 'spaces', SPACE, 'invites')));
    const mine = await assertSucceeds(getDocs(mySpacesQuery(db, 'alice')));
    expect(mine.docs.map((d) => d.id)).toEqual([SPACE]);
  });

  it('creates, updates (including flipping scope), soft- and hard-deletes records', async () => {
    const db = as('owner');
    await assertSucceeds(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'private', 'alice')));
    await assertSucceeds(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'alice', { updatedAt: 200 })));
    await assertSucceeds(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'alice', { deleted: true, updatedAt: 200 })));
    await assertSucceeds(deleteDoc(recRef(db, 'relationships', 'privrel')));
  });

  it('record writes are validated', async () => {
    const db = as('owner');
    // updatedBy must be the caller
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'erin')));
    // updatedAt must be a number
    await assertFails(setDoc(recRef(db, 'people', 'n1'), { ...rec(person('n1'), 'family', 'alice'), updatedAt: '100' }));
    // bad scope
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'public' as 'family', 'alice')));
    // missing data / extra fields / wrong id / non-bool deleted
    await assertFails(setDoc(recRef(db, 'people', 'n1'), { scope: 'family', updatedAt: 1, updatedBy: 'alice' }));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'alice', { evil: true })));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('other'), 'family', 'alice')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'alice', { deleted: 'yes' })));
    // other collections are closed
    await assertFails(setDoc(doc(db, 'spaces', SPACE, 'secrets', 'x'), rec({}, 'family', 'alice')));
  });

  it('updatedAt is bounded by server time and must increase on update (watermark freeze)', async () => {
    const db = as('owner');
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'private', 'alice', { updatedAt: 9e15 })));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'private', 'alice', { updatedAt: FUTURE() })));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'alice', { updatedAt: FUTURE() })));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'private', 'alice'))); // same updatedAt (100)
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'alice', { updatedAt: 50 }))); // older
    await assertSucceeds(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'alice', { updatedAt: Date.now() })));
    await assertSucceeds(setDoc(recRef(db, 'people', 'n2'), rec(person('n2'), 'private', 'alice', { updatedAt: Date.now() + 60_000 }))); // small skew ok
  });

  it('may set data.isMe', async () => {
    const db = as('owner');
    await assertSucceeds(setDoc(recRef(db, 'people', 'me'), rec({ ...person('me'), isMe: true }, 'family', 'alice')));
    await assertSucceeds(setDoc(recRef(db, 'people', 'fam1'), rec({ ...person('fam1'), isMe: true }, 'family', 'alice', { updatedAt: 200 })));
  });

  it('photo must be an inline base64 png/jpeg/webp data URL of bounded size', async () => {
    const db = as('owner');
    const withPhoto = (photo: unknown) => rec({ ...person('n1'), photo }, 'family', 'alice');
    await assertFails(setDoc(recRef(db, 'people', 'n1'), withPhoto('https://tracker.example.com/pixel.png')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), withPhoto('data:image/svg+xml;base64,PHN2Zz4=')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), withPhoto('data:image/png;base64,AAAA"><script>')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), withPhoto(42)));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), withPhoto(`data:image/jpeg;base64,${'A'.repeat(300000)}`)));
    await assertSucceeds(setDoc(recRef(db, 'people', 'n1'), withPhoto('data:image/jpeg;base64,/9j/4AAQSkZJRg==')));
    await assertSucceeds(setDoc(recRef(db, 'people', 'n2'), rec({ ...person('n2'), photo: 'data:image/webp;base64,UklGRg==' }, 'family', 'alice')));
  });

  it('manages invites (validated)', async () => {
    const db = as('owner');
    await assertSucceeds(setDoc(invRef(db, 'new@example.com'), invite('new@example.com', 'editor')));
    await assertSucceeds(deleteDoc(invRef(db, 'new@example.com')));
    await assertFails(setDoc(invRef(db, 'x@example.com'), invite('x@example.com', 'owner'))); // no owner invites
    await assertFails(setDoc(invRef(db, 'x@example.com'), invite('y@example.com', 'viewer'))); // id mismatch
    await assertFails(setDoc(invRef(db, 'X@example.com'), invite('X@example.com', 'viewer'))); // not lower-case
    await assertFails(setDoc(invRef(db, 'x@example.com'), invite('x@example.com', 'viewer', 'erin'))); // invitedBy spoof
    await assertFails(setDoc(invRef(db, 'x@example.com'), invite('x@example.com', 'viewer', 'alice', 'erin@example.com'))); // invitedByEmail spoof
    const { invitedByEmail: _omit, ...legacy } = invite('x@example.com', 'viewer');
    await assertFails(setDoc(invRef(db, 'x@example.com'), legacy)); // invitedByEmail required
  });

  it('changes roles, removes members and renames the space', async () => {
    const db = as('owner');
    await assertSucceeds(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), 'editor'));
    await assertSucceeds(updateDoc(spaceRef(db), new FieldPath('members', 'erin'), deleteField(), new FieldPath('memberInfo', 'erin'), deleteField()));
    await assertSucceeds(updateDoc(spaceRef(db), { name: 'Our family' }));
  });

  it('cannot change ownerUid or createdAt, make a second owner, demote itself or add uids directly', async () => {
    const db = as('owner');
    await assertFails(updateDoc(spaceRef(db), { ownerUid: 'erin' }));
    await assertFails(updateDoc(spaceRef(db), { ownerUid: 'erin', members: { alice: 'editor', erin: 'owner', victor: 'viewer' } }));
    await assertFails(updateDoc(spaceRef(db), { createdAt: 2 }));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'erin'), 'owner'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'alice'), 'editor'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'alice'), deleteField()));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'sam'), 'viewer'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), 'admin'));
  });

  it('deletes own space but cannot touch another space', async () => {
    const db = as('owner');
    await assertFails(getDoc(spaceRef(db, 'sam')));
    await assertFails(getDoc(doc(db, 'spaces', 'sam', 'people', 's1')));
    await assertFails(setDoc(doc(db, 'spaces', 'sam', 'people', 'x'), rec(person('x'), 'family', 'alice')));
    await assertFails(deleteDoc(spaceRef(db, 'sam')));
    await assertSucceeds(deleteDoc(spaceRef(db)));
  });
});

// ---------------------------------------------------------------------------
describe('personal space creation', () => {
  const space = (uid: string, members: Record<string, string>, extra: object = {}) => ({ name: 'Mine', ownerUid: uid, members, createdAt: 1, ...extra });

  it('allows id == uid with members == {uid: owner}, and getting a missing own space', async () => {
    const db = as('stranger');
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore() as unknown as Firestore, 'spaces', 'sam')));
    await assertSucceeds(getDoc(spaceRef(db, 'sam')));
    await assertSucceeds(setDoc(spaceRef(db, 'sam'), space('sam', { sam: 'owner' }, { memberInfo: { sam: { email: 'sam@example.com', name: 'Sam' } } })));
  });

  it('rejects other ids, extra members, wrong owner and bad shapes', async () => {
    const db = as('invitee');
    await assertFails(setDoc(spaceRef(db, 'other'), space('ivy', { ivy: 'owner' })));
    await assertFails(setDoc(spaceRef(db, 'ivy'), space('ivy', { ivy: 'owner', sam: 'editor' })));
    await assertFails(setDoc(spaceRef(db, 'ivy'), space('sam', { sam: 'owner' })));
    await assertFails(setDoc(spaceRef(db, 'ivy'), space('ivy', { ivy: 'owner' }, { createdAt: 'now' })));
    await assertFails(setDoc(spaceRef(db, 'ivy'), space('ivy', { ivy: 'owner' }, { memberInfo: { sam: { email: 'x' } } })));
    await assertFails(setDoc(spaceRef(db, 'ivy'), space('ivy', { ivy: 'owner' }, { extra: 1 })));
  });

  it('cannot overwrite an existing space by "creating" it again', async () => {
    // Space 'alice' exists; Alice's set() is an update and must keep members valid,
    // anybody else's is refused.
    await assertFails(setDoc(spaceRef(as('editor'), SPACE), space('erin', { erin: 'owner' })));
  });
});

// ---------------------------------------------------------------------------
describe('editor', () => {
  it('reads the space doc and family records only', async () => {
    const db = as('editor');
    await assertSucceeds(getDoc(spaceRef(db)));
    await assertSucceeds(getDoc(recRef(db, 'people', 'fam1')));
    await assertSucceeds(getDoc(recRef(db, 'relationships', 'famrel')));
    await assertFails(getDoc(recRef(db, 'people', 'priv1')));
    await assertFails(getDoc(recRef(db, 'relationships', 'privrel')));
    const fam = await assertSucceeds(getDocs(familyQuery(db, 'people')));
    expect(fam.docs.map((d) => d.id)).toEqual(['fam1']);
    await assertFails(getDocs(allQuery(db, 'people'))); // rules are not filters
    const mine = await assertSucceeds(getDocs(mySpacesQuery(db, 'erin')));
    expect(mine.docs.map((d) => d.id)).toEqual([SPACE]);
    await assertFails(getDocs(mySpacesQuery(db, 'alice'))); // someone else's membership
    await assertFails(getDocs(collection(db, 'spaces')));
  });

  it('creates, updates and soft-deletes family records', async () => {
    const db = as('editor');
    await assertSucceeds(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'erin')));
    await assertSucceeds(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1', 'Granny'), 'family', 'erin', { updatedAt: 300 })));
    await assertSucceeds(setDoc(recRef(db, 'relationships', 'famrel'), rec(rel('famrel'), 'family', 'erin', { deleted: true, updatedAt: 200 })));
  });

  it('cannot write a future or non-increasing updatedAt (watermark freeze)', async () => {
    const db = as('editor');
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'erin', { updatedAt: 9e15 })));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'erin', { updatedAt: FUTURE() })));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1', 'Granny'), 'family', 'erin'))); // same (100)
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1', 'Granny'), 'family', 'erin', { updatedAt: 99 })));
    await assertSucceeds(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1', 'Granny'), 'family', 'erin', { updatedAt: Date.now() })));
  });

  it('cannot claim or change data.isMe (hijacking the owner\'s "me")', async () => {
    const db = as('editor');
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec({ ...person('n1'), isMe: true }, 'family', 'erin')));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec({ ...person('fam1'), isMe: true }, 'family', 'erin', { updatedAt: 200 })));
    await assertFails(updateDoc(recRef(db, 'people', 'fam1'), { 'data.isMe': true, updatedAt: 200, updatedBy: 'erin' }));
    await assertSucceeds(setDoc(recRef(db, 'people', 'n2'), rec({ ...person('n2'), isMe: false }, 'family', 'erin')));
    // The owner's "me" stays: editors may edit it but not clear the flag.
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'spaces', SPACE, 'people', 'me'), rec({ ...person('me'), isMe: true }, 'family', 'alice')),
    );
    await assertFails(setDoc(recRef(db, 'people', 'me'), rec({ ...person('me'), isMe: false }, 'family', 'erin', { updatedAt: 200 })));
    await assertFails(setDoc(recRef(db, 'people', 'me'), rec(person('me'), 'family', 'erin', { updatedAt: 200 })));
    await assertSucceeds(setDoc(recRef(db, 'people', 'me'), rec({ ...person('me', 'Alice'), isMe: true }, 'family', 'erin', { updatedAt: 200 })));
  });

  it('cannot write a non-data-URL photo', async () => {
    const db = as('editor');
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec({ ...person('fam1'), photo: 'http://tracker.example.com/x.jpg' }, 'family', 'erin', { updatedAt: 200 })));
  });

  it('cannot create, read-modify or overwrite private records, or flip scope', async () => {
    const db = as('editor');
    await assertFails(setDoc(recRef(db, 'people', 'n2'), rec(person('n2'), 'private', 'erin')));
    await assertFails(setDoc(recRef(db, 'people', 'priv1'), rec(person('priv1'), 'family', 'erin'))); // private -> family
    await assertFails(setDoc(recRef(db, 'people', 'priv1'), rec(person('priv1'), 'private', 'erin')));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'private', 'erin'))); // family -> private
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'alice'))); // updatedBy spoof
  });

  it('cannot hard-delete records', async () => {
    await assertFails(deleteDoc(recRef(as('editor'), 'people', 'fam1')));
  });

  it('cannot read or manage invites', async () => {
    const db = as('editor');
    await assertFails(getDoc(invRef(db, 'ivy@example.com')));
    await assertFails(getDocs(collection(db, 'spaces', SPACE, 'invites')));
    await assertFails(setDoc(invRef(db, 'friend@example.com'), invite('friend@example.com', 'editor', 'erin')));
    await assertFails(deleteDoc(invRef(db, 'ivy@example.com')));
  });

  it('cannot change members (escalation), but can leave', async () => {
    const db = as('editor');
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'erin'), 'owner'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), 'editor'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), deleteField()));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'sam'), 'viewer'));
    await assertFails(updateDoc(spaceRef(db), { name: 'Hijacked' }));
    await assertFails(updateDoc(spaceRef(db), { ownerUid: 'erin' }));
    await assertFails(deleteDoc(spaceRef(db)));
    await assertSucceeds(updateDoc(spaceRef(db), new FieldPath('members', 'erin'), deleteField(), new FieldPath('memberInfo', 'erin'), deleteField()));
    await assertFails(getDoc(spaceRef(db)));
    await assertFails(getDoc(recRef(db, 'people', 'fam1')));
  });
});

// ---------------------------------------------------------------------------
describe('viewer', () => {
  it('reads the space doc and family records only', async () => {
    const db = as('viewer');
    await assertSucceeds(getDoc(spaceRef(db)));
    await assertSucceeds(getDoc(recRef(db, 'people', 'fam1')));
    await assertSucceeds(getDocs(familyQuery(db, 'relationships')));
    await assertFails(getDoc(recRef(db, 'people', 'priv1')));
    await assertFails(getDoc(recRef(db, 'relationships', 'privrel')));
    await assertFails(getDocs(allQuery(db, 'relationships')));
    await assertSucceeds(getDocs(mySpacesQuery(db, 'victor')));
  });

  it('cannot write any record', async () => {
    const db = as('viewer');
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'victor')));
    await assertFails(setDoc(recRef(db, 'people', 'fam1'), rec(person('fam1'), 'family', 'victor', { deleted: true })));
    await assertFails(setDoc(recRef(db, 'people', 'n2'), rec(person('n2'), 'private', 'victor')));
    await assertFails(deleteDoc(recRef(db, 'people', 'fam1')));
  });

  it('cannot make itself editor or owner, touch invites, or edit the space', async () => {
    const db = as('viewer');
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), 'editor'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), 'owner'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'erin'), deleteField()));
    await assertFails(updateDoc(spaceRef(db), { name: 'x' }));
    await assertFails(getDoc(invRef(db, 'ivy@example.com')));
    await assertFails(setDoc(invRef(db, 'victor@example.com'), invite('victor@example.com', 'editor', 'victor')));
  });

  it('cannot leave and rejoin as editor in one write', async () => {
    const db = as('viewer');
    await assertFails(
      updateDoc(spaceRef(db), new FieldPath('members', 'victor'), deleteField(), new FieldPath('members', 'victor2'), 'editor'),
    );
  });

  it('can leave (with or without removing its display info), but not edit others while leaving', async () => {
    const db = as('viewer');
    await assertFails(
      updateDoc(spaceRef(db), new FieldPath('members', 'victor'), deleteField(), new FieldPath('memberInfo', 'erin'), deleteField()),
    );
    await assertFails(
      updateDoc(spaceRef(db), new FieldPath('members', 'victor'), deleteField(), new FieldPath('memberInfo', 'victor'), { email: 'x@example.com' }),
    );
    await assertSucceeds(updateDoc(spaceRef(db), new FieldPath('members', 'victor'), deleteField()));
    await assertFails(getDoc(recRef(db, 'people', 'fam1')));
  });
});

// ---------------------------------------------------------------------------
describe('invitee', () => {
  // A plain join that leaves the invite in place (must always fail: invites are single use).
  const joinKeepingInvite = (db: Firestore, uid: string, role: string, info: object = { email: 'ivy@example.com' }) =>
    updateDoc(spaceRef(db), new FieldPath('members', uid), role, new FieldPath('memberInfo', uid), info);
  // A well-formed join as acceptInvite does it: member entry plus deleting the invite, in one batch.
  // Negative tests use this so they fail for the reason they name, not for keeping the invite.
  const join = (db: Firestore, uid: string, role: string, info: object = { email: 'ivy@example.com' }, inviteId = 'ivy@example.com') => {
    const b = writeBatch(db);
    b.update(spaceRef(db), new FieldPath('members', uid), role, new FieldPath('memberInfo', uid), info);
    b.delete(invRef(db, inviteId));
    return b.commit();
  };

  it('reads own invite (direct and via collectionGroup) but not the space or records', async () => {
    const db = as('invitee');
    await assertSucceeds(getDoc(invRef(db, 'ivy@example.com')));
    const mine = await assertSucceeds(getDocs(query(collectionGroup(db, 'invites'), where('email', '==', 'ivy@example.com'))));
    expect(mine.docs.map((d) => d.ref.parent.parent?.id)).toEqual([SPACE]);
    await assertFails(getDoc(invRef(db, 'ed@example.com')));
    await assertFails(getDocs(query(collectionGroup(db, 'invites'), where('email', '==', 'ed@example.com'))));
    await assertFails(getDocs(collectionGroup(db, 'invites')));
    await assertFails(getDocs(collection(db, 'spaces', SPACE, 'invites')));
    await assertFails(getDoc(spaceRef(db)));
    await assertFails(getDoc(recRef(db, 'people', 'fam1')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'ivy')));
  });

  it('joins with exactly the invited role and deletes the invite atomically', async () => {
    const db = as('invitee');
    const batch = writeBatch(db);
    batch.update(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer', new FieldPath('memberInfo', 'ivy'), { email: 'ivy@example.com', name: 'Ivy' });
    batch.delete(invRef(db, 'ivy@example.com'));
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(spaceRef(db)));
    await assertSucceeds(getDoc(recRef(db, 'people', 'fam1')));
    await assertFails(getDoc(recRef(db, 'people', 'priv1')));
  });

  it('joins as editor when invited as editor (consuming the invite)', async () => {
    const db = as('invitee2');
    const batch = writeBatch(db);
    batch.update(spaceRef(db), new FieldPath('members', 'ed'), 'editor', new FieldPath('memberInfo', 'ed'), { email: 'ed@example.com' });
    batch.delete(invRef(db, 'ed@example.com'));
    await assertSucceeds(batch.commit());
  });

  it('cannot join while keeping the invite (invites are single use)', async () => {
    await assertFails(joinKeepingInvite(as('invitee2'), 'ed', 'editor', { email: 'ed@example.com' }));
    await assertFails(joinKeepingInvite(as('invitee'), 'ivy', 'viewer'));
  });

  it('cannot rejoin after being removed (no invite left to replay)', async () => {
    const db = as('invitee');
    const batch = writeBatch(db);
    batch.update(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer', new FieldPath('memberInfo', 'ivy'), { email: 'ivy@example.com' });
    batch.delete(invRef(db, 'ivy@example.com'));
    await assertSucceeds(batch.commit());
    await assertSucceeds(updateDoc(spaceRef(as('owner')), new FieldPath('members', 'ivy'), deleteField(), new FieldPath('memberInfo', 'ivy'), deleteField()));
    await assertFails(join(db, 'ivy', 'viewer'));
    const again = writeBatch(db);
    again.update(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer');
    again.delete(invRef(db, 'ivy@example.com'));
    await assertFails(again.commit());
    await assertFails(getDoc(spaceRef(db)));
  });

  it('owner removes a member and revokes their invite in one batch (spaces.removeMember)', async () => {
    // A stale invite for an existing member (e.g. re-sent) must go with the membership.
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'spaces', SPACE, 'invites', 'erin@example.com'), invite('erin@example.com', 'editor')),
    );
    const db = as('owner');
    const batch = writeBatch(db);
    batch.update(spaceRef(db), new FieldPath('members', 'erin'), deleteField(), new FieldPath('memberInfo', 'erin'), deleteField());
    batch.delete(invRef(db, 'erin@example.com'));
    await assertSucceeds(batch.commit());
    const erin = as('editor');
    const rejoin = writeBatch(erin);
    rejoin.update(spaceRef(erin), new FieldPath('members', 'erin'), 'editor');
    rejoin.delete(invRef(erin, 'erin@example.com'));
    await assertFails(rejoin.commit());
  });

  it('cannot join with a different role than invited', async () => {
    const db = as('invitee');
    await assertFails(join(db, 'ivy', 'editor'));
    await assertFails(join(db, 'ivy', 'owner'));
  });

  it('cannot add someone else, add extra members, or change other fields while joining', async () => {
    const db = as('invitee');
    await assertFails(join(db, 'sam', 'viewer'));
    await assertFails(
      updateDoc(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer', new FieldPath('members', 'sam'), 'viewer'),
    );
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer', new FieldPath('members', 'victor'), 'editor'));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'ivy'), 'viewer', 'name', 'Mine now'));
    await assertFails(join(db, 'ivy', 'viewer', { email: 'someone@example.com' })); // memberInfo spoof
  });

  it('cannot join without a verified email', async () => {
    const db = as('unverified');
    await assertFails(join(db, 'uma', 'editor', { email: 'uma@example.com' }, 'uma@example.com'));
    await assertFails(getDoc(invRef(db, 'uma@example.com')));
    await assertFails(getDocs(query(collectionGroup(db, 'invites'), where('email', '==', 'uma@example.com'))));
  });

  it('cannot join after the invite is revoked', async () => {
    await assertSucceeds(deleteDoc(invRef(as('owner'), 'ivy@example.com')));
    await assertFails(join(as('invitee'), 'ivy', 'viewer'));
  });

  it('cannot modify its own invite to change the role', async () => {
    const db = as('invitee');
    await assertFails(setDoc(invRef(db, 'ivy@example.com'), invite('ivy@example.com', 'editor', 'ivy')));
    await assertFails(updateDoc(invRef(db, 'ivy@example.com'), { role: 'editor' }));
  });

  it('can decline (delete) own invite but not others', async () => {
    const db = as('invitee');
    await assertFails(deleteDoc(invRef(db, 'ed@example.com')));
    await assertSucceeds(deleteDoc(invRef(db, 'ivy@example.com')));
  });

  it('an existing member cannot use an invite to change role', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'spaces', SPACE, 'invites', 'victor@example.com'), invite('victor@example.com', 'editor')),
    );
    await assertFails(join(as('viewer'), 'victor', 'editor', { email: 'victor@example.com' }, 'victor@example.com'));
  });
});

// ---------------------------------------------------------------------------
describe('stranger (signed in, no role, no invite)', () => {
  it('cannot read or write anything in the space', async () => {
    const db = as('stranger');
    await assertFails(getDoc(spaceRef(db)));
    await assertFails(getDoc(recRef(db, 'people', 'fam1')));
    await assertFails(getDocs(familyQuery(db, 'people')));
    await assertFails(getDoc(invRef(db, 'ivy@example.com')));
    await assertFails(getDocs(collection(db, 'spaces', SPACE, 'invites')));
    await assertFails(setDoc(recRef(db, 'people', 'n1'), rec(person('n1'), 'family', 'sam')));
    await assertFails(setDoc(invRef(db, 'sam@example.com'), invite('sam@example.com', 'editor', 'sam')));
    await assertFails(updateDoc(spaceRef(db), new FieldPath('members', 'sam'), 'viewer'));
    await assertFails(deleteDoc(spaceRef(db)));
    await assertFails(getDocs(collection(db, 'spaces')));
    await assertFails(getDocs(mySpacesQuery(db, 'alice')));
    const mine = await assertSucceeds(getDocs(mySpacesQuery(db, 'sam')));
    expect(mine.docs.map((d) => d.id)).toEqual(['sam']);
  });

  it('cannot join with a forged invite in the same batch', async () => {
    const db = as('stranger');
    const batch = writeBatch(db);
    batch.set(invRef(db, 'sam@example.com'), invite('sam@example.com', 'editor', 'sam'));
    batch.update(spaceRef(db), new FieldPath('members', 'sam'), 'editor');
    await assertFails(batch.commit());
  });
});
