/**
 * Google sign-in (security-engineer). See contract.ts: `useAuth(): AuthState`.
 *
 * Without Firebase config this returns `{ configured: false, loading: false, user: null }` and
 * never loads the Firebase SDK or touches the network.
 */
import { useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import type { AuthState, CloudUser } from './contract';
import { cloudConfigured, getFirebaseAuth, usingEmulators } from './firebase';
import { GOOGLE_WEB_CLIENT_ID, isNativeApp } from '../native';

interface Snapshot {
  loading: boolean;
  user: CloudUser | null;
}

const listeners = new Set<() => void>();
let snapshot: Snapshot = { loading: cloudConfigured(), user: null };
let started = false;

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

export function toCloudUser(u: User): CloudUser {
  const out: CloudUser = { uid: u.uid, email: (u.email ?? '').toLowerCase() };
  if (u.displayName) out.name = u.displayName;
  if (u.photoURL) out.photoURL = u.photoURL;
  return out;
}

/** Starts listening to Firebase Auth once (only when configured). */
function start() {
  if (started || !cloudConfigured()) return;
  started = true;
  void (async () => {
    try {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged, getRedirectResult } = await import('firebase/auth');
      // Completes a signInWithRedirect started on a previous page load (errors are non-fatal).
      getRedirectResult(auth).catch((e) => console.warn('Sign-in redirect failed', e));
      onAuthStateChanged(auth, (u) => emit({ loading: false, user: u ? toCloudUser(u) : null }));
    } catch (e) {
      console.warn('Firebase Auth unavailable', e);
      emit({ loading: false, user: null });
    }
  })();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  start();
  return () => listeners.delete(cb);
}

/** Phones/tablets: popups are unreliable there, so redirect when the page is served from the
 * Firebase auth domain (redirect sign-in breaks on other hosts because of third-party storage
 * partitioning, so there we keep the popup). */
function preferRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 768;
  if (!touch || !small) return false;
  if (usingEmulators()) return true;
  const host = window.location.hostname;
  const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '');
  const project = String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '');
  void project;
  // Redirect only works when the page itself is on the auth domain; elsewhere (web.app, github.io)
  // mobile browsers partition storage and the user comes back signed out. Use the popup there.
  return host === authDomain;
}

function onAuthDomain(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '');
}

export async function signIn(): Promise<void> {
  if (!cloudConfigured()) throw new Error('Cloud sign-in is not configured.');
  if (isNativeApp()) return nativeSignIn();
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (preferRedirect()) return signInWithRedirect(auth, provider);
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      if (onAuthDomain() || usingEmulators()) return signInWithRedirect(auth, provider);
      throw new Error('Your browser blocked the Google sign-in window. Allow pop-ups for this site, then tap Sign in again.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

export async function signOut(): Promise<void> {
  if (!cloudConfigured()) return;
  const auth = await getFirebaseAuth();
  const { signOut: fbSignOut } = await import('firebase/auth');
  await fbSignOut(auth);
  // In the app, also forget the Google account choice so the next sign-in asks again.
  if (isNativeApp()) await import('@capgo/capacitor-social-login').then(({ SocialLogin }) => SocialLogin.logout({ provider: 'google' })).catch(() => undefined);
}

/**
 * Android app: Google refuses its sign-in page inside embedded browsers, so sign in through Android's
 * own account picker (Credential Manager) and hand the Google ID token to Firebase.
 */
let nativeReady: Promise<void> | null = null;
async function nativeSignIn(): Promise<void> {
  if (!GOOGLE_WEB_CLIENT_ID) throw new Error('Google sign-in isn’t set up for the app yet (FIREBASE_SETUP.md › Android app).');
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  nativeReady ??= SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID, skipAuthOnlyAuthorizationAfterSignIn: true } });
  await nativeReady;
  let idToken: string | null | undefined;
  try {
    const res = await SocialLogin.login({ provider: 'google', options: {} });
    idToken = 'idToken' in res.result ? res.result.idToken : undefined;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/cancel/i.test(msg)) return;
    throw new Error(`Google sign-in didn’t work: ${msg}`);
  }
  if (!idToken) throw new Error('Google didn’t return a sign-in token. Try again.');
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

const getSnapshot = () => snapshot;

export function useAuth(): AuthState {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { configured: cloudConfigured(), loading: s.loading, user: s.user, signIn, signOut };
}

/**
 * Emulator builds only (smoke and QA scripts): sign in without the Google popup. The auth emulator
 * accepts an unsigned Google ID token. Production builds never take this branch (no emulators).
 */
if (usingEmulators() && typeof window !== 'undefined') {
  (window as unknown as { __lineageTestSignIn?: (email: string, name?: string) => Promise<string> }).__lineageTestSignIn = async (email, name) => {
    const auth = await getFirebaseAuth();
    const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
    const token = JSON.stringify({ sub: 'test-' + email, email, email_verified: true, name: name ?? email.split('@')[0] });
    return (await signInWithCredential(auth, GoogleAuthProvider.credential(token))).user.uid;
  };
}
