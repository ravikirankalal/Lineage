/**
 * Google Contacts as suggestions when adding a relative (security-engineer).
 *
 * - Asks for read-only access (`contacts.readonly`) only when the user taps "Show my Google contacts",
 *   by re-authenticating the SAME signed-in user in a popup (never signs anyone in or switches account).
 * - Downloads the contacts once per page load straight from people.googleapis.com and keeps them in
 *   memory only: nothing is written to the device, Firestore or logs, and the access token is dropped
 *   as soon as the download ends. Only a contact the user picks becomes a person in the tree.
 * - Without real Firebase config, or with the emulators, it is unavailable and touches no network.
 */
import { useSyncExternalStore } from 'react';
import { fromGooglePerson, type ContactSuggestion, type GooglePersonLite } from '../contactSuggest';
import { cloudConfigured, getFirebaseAuth, usingEmulators } from './firebase';

const SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
const URL_CONNECTIONS = 'https://people.googleapis.com/v1/people/me/connections';
const FIELDS = 'names,nicknames,phoneNumbers,emailAddresses,genders';

export interface GoogleContactsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  contacts: ContactSuggestion[];
  error?: string;
}

let state: GoogleContactsState = { status: 'idle', contacts: [] };
const subs = new Set<() => void>();
function set(next: GoogleContactsState) {
  state = next;
  subs.forEach((f) => f());
}

export function googleContactsAvailable(): boolean {
  return cloudConfigured() && !usingEmulators();
}

export function useGoogleContacts(): GoogleContactsState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
}

function friendly(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  if (/popup-closed|cancelled-popup|user-cancelled/.test(code)) return 'The Google window was closed. Tap again to show your contacts.';
  if (/popup-blocked/.test(code)) return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  if (/user-mismatch/.test(code)) return 'Pick the same Google account you use for Lineage.';
  if (/network/.test(code)) return 'Couldn’t reach Google. Check your connection.';
  return e instanceof Error && e.message ? e.message : 'Couldn’t read your Google contacts.';
}

/** From a tap: get read-only access and download the contacts into memory. */
export async function loadGoogleContacts(): Promise<void> {
  if (!googleContactsAvailable() || state.status === 'loading') return;
  set({ ...state, status: 'loading', error: undefined });
  try {
    const auth = await getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in first.');
    const { GoogleAuthProvider, reauthenticateWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    provider.addScope(SCOPE);
    provider.setCustomParameters({ login_hint: user.email ?? '' });
    const result = await reauthenticateWithPopup(user, provider);
    if (result.user.uid !== user.uid) throw new Error('Pick the same Google account you use for Lineage.');
    let token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('Lineage wasn’t given access to your contacts. Tap again and allow “See your contacts”.');

    const out: ContactSuggestion[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: '1000', personFields: FIELDS, sortOrder: 'FIRST_NAME_ASCENDING' });
      if (page) params.set('pageToken', page);
      const res = await fetch(`${URL_CONNECTIONS}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) throw new Error('Google Contacts isn’t switched on for Lineage yet (People API, see FIREBASE_SETUP.md).');
      if (res.status === 401) throw new Error('Google access expired. Tap again.');
      if (!res.ok) throw new Error(`Google Contacts returned an error (${res.status}). Try again later.`);
      const body = (await res.json()) as { connections?: GooglePersonLite[]; nextPageToken?: string };
      for (const g of body.connections ?? []) {
        const c = fromGooglePerson(g);
        if (c) out.push(c);
      }
      page = body.nextPageToken || undefined;
    } while (page);
    token = undefined;
    set({ status: 'ready', contacts: out });
  } catch (e) {
    console.warn('[contacts] Google Contacts failed', (e as { code?: string })?.code ?? '');
    set({ status: 'error', contacts: state.contacts, error: friendly(e) });
  }
}

// Emulator builds only (browser checks): load fictitious contacts without Google.
if (typeof window !== 'undefined' && usingEmulators()) {
  (window as unknown as { __lineageTestContacts?: (l: GooglePersonLite[]) => void }).__lineageTestContacts = (l) =>
    set({ status: 'ready', contacts: l.map(fromGooglePerson).filter((c): c is ContactSuggestion => !!c) });
}

// ---- Phone contact picker (Chrome on Android) ----------------------------------------------------

type ContactsManager = {
  getProperties(): Promise<string[]>;
  select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]>;
};

export function phonePickerAvailable(): boolean {
  return typeof window !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;
}

/** Opens the phone's contact list (from a tap); resolves with the chosen contact, or undefined. */
export async function pickPhoneContact(): Promise<{ name?: string[]; tel?: string[]; email?: string[] } | undefined> {
  const mgr = (navigator as unknown as { contacts: ContactsManager }).contacts;
  const supported = await mgr.getProperties();
  const [c] = await mgr.select(['name', 'tel', 'email'].filter((x) => supported.includes(x)), { multiple: false });
  return c;
}
