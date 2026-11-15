/**
 * Firebase initialisation (security-engineer). See contract.ts.
 *
 * - Config comes from VITE_FIREBASE_* env vars. The web config is public by design; it is not a
 *   secret. Without it, `cloudConfigured()` is false and nothing here is ever loaded.
 * - With VITE_FIREBASE_EMULATORS=1 the app talks to local emulators (project "demo-lineage",
 *   auth 127.0.0.1:9099, firestore 127.0.0.1:8080) and needs no real config.
 * - The SDK is imported dynamically, after the first screen has rendered.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { isNativeApp } from '../native';
import type { Firestore } from 'firebase/firestore';

const env = import.meta.env;

export const EMULATOR_PROJECT_ID = 'demo-lineage';

export function usingEmulators(): boolean {
  return env.VITE_FIREBASE_EMULATORS === '1';
}

interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

function readConfig(): WebConfig | null {
  if (usingEmulators()) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID || 'demo-app-id',
    };
  }
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const appId = env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  const cfg: WebConfig = { apiKey, authDomain, projectId, appId };
  if (env.VITE_FIREBASE_STORAGE_BUCKET) cfg.storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET;
  if (env.VITE_FIREBASE_MESSAGING_SENDER_ID) cfg.messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  return cfg;
}

/** True when Firebase config (or emulator mode) is present. Makes no network calls. */
export function cloudConfigured(): boolean {
  return readConfig() !== null;
}

let appP: Promise<FirebaseApp> | null = null;
let authP: Promise<Auth> | null = null;
let dbP: Promise<Firestore> | null = null;

function notConfigured(): Error {
  return new Error('Firebase is not configured (missing VITE_FIREBASE_* settings).');
}

export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!appP) {
    const cfg = readConfig();
    if (!cfg) return Promise.reject(notConfigured());
    appP = import('firebase/app').then(({ initializeApp, getApps, getApp }) =>
      getApps().length ? getApp() : initializeApp(cfg),
    );
    appP.catch(() => (appP = null));
  }
  return appP;
}

export function getFirebaseAuth(): Promise<Auth> {
  if (!authP) {
    authP = (async () => {
      const app = await getFirebaseApp();
      const fa = await import('firebase/auth');
      const { connectAuthEmulator } = fa;
      // getAuth() makes sign-in state wait until Google's popup helper (scripts + an iframe) has loaded:
      // seconds on a phone. The Android app signs in natively and never uses it, so there it's left out
      // (sign-in state comes straight from storage). The website keeps it ready, so the sign-in popup
      // opens at once and isn't blocked. Same storage as getAuth().
      let auth: Auth;
      try {
        auth = fa.initializeAuth(app, {
          persistence: [fa.indexedDBLocalPersistence, fa.browserLocalPersistence, fa.browserSessionPersistence],
          popupRedirectResolver: isNativeApp() ? undefined : fa.browserPopupRedirectResolver,
        });
      } catch {
        auth = fa.getAuth(app); // already set up (dev hot reload)
      }
      if (usingEmulators()) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      return auth;
    })();
    authP.catch(() => (authP = null));
  }
  return authP;
}

/** The popup/redirect helper for Google sign-in on the website (loads Google's scripts on first use). */
export async function popupResolver() {
  return (await import('firebase/auth')).browserPopupRedirectResolver;
}

export function getDb(): Promise<Firestore> {
  if (!dbP) {
    dbP = (async () => {
      const app = await getFirebaseApp();
      const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
      // Memory cache only: nothing is kept on the device (Lineage needs the internet).
      // ignoreUndefinedProperties: records carry optional fields that may be undefined.
      const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
      if (usingEmulators()) connectFirestoreEmulator(db, '127.0.0.1', 8080);
      return db;
    })();
    dbP.catch(() => (dbP = null));
  }
  return dbP;
}
