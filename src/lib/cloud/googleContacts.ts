/**
 * Google Contacts import: OAuth token + People API fetch (security-engineer).
 * The mapping to Lineage people and the UI live in contacts.ts / ImportPage (import-specialist).
 *
 * Security notes:
 * - Requests ONLY https://www.googleapis.com/auth/contacts.readonly, and only when the user starts
 *   an import (popup from a click).
 * - The OAuth access token is short-lived (about 1 hour) and is kept in memory only: it is returned
 *   to the caller and never written to localStorage, IndexedDB, Firestore or logs. Error messages
 *   never contain it.
 * - The only host contacted is people.googleapis.com (plus Firebase Auth's own popup).
 * - Without Firebase config, or in emulator mode, `googleContactsAvailable()` is false and nothing
 *   here touches the network.
 */
import type { UserCredential } from 'firebase/auth';
import { cloudConfigured, getFirebaseAuth, usingEmulators } from './firebase';

export const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
export const PEOPLE_CONNECTIONS_URL = 'https://people.googleapis.com/v1/people/me/connections';
export const PERSON_FIELDS =
  'names,nicknames,phoneNumbers,emailAddresses,addresses,birthdays,organizations,biographies,photos,genders,urls';
const PAGE_SIZE = 1000;
const MAX_RATE_LIMIT_RETRIES = 4;

// ---- People API v1 types (only the subset we request) ----------------------------------------

export interface GoogleSource {
  type?: 'SOURCE_TYPE_UNSPECIFIED' | 'ACCOUNT' | 'PROFILE' | 'DOMAIN_PROFILE' | 'CONTACT' | 'OTHER_CONTACT' | 'DOMAIN_CONTACT';
  id?: string;
  etag?: string;
}

export interface GoogleFieldMetadata {
  primary?: boolean;
  sourcePrimary?: boolean;
  verified?: boolean;
  source?: GoogleSource;
}

/** People API `Date`: any of year/month/day may be absent (e.g. a birthday without a year). */
export interface GoogleDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface GoogleName {
  metadata?: GoogleFieldMetadata;
  unstructuredName?: string;
  displayName?: string;
  displayNameLastFirst?: string;
  familyName?: string;
  givenName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  phoneticFullName?: string;
  phoneticFamilyName?: string;
  phoneticGivenName?: string;
  phoneticMiddleName?: string;
  phoneticHonorificPrefix?: string;
  phoneticHonorificSuffix?: string;
}

export interface GoogleNickname {
  metadata?: GoogleFieldMetadata;
  value?: string;
  type?: 'DEFAULT' | 'MAIDEN_NAME' | 'INITIALS' | 'GPLUS' | 'OTHER_NAME' | 'ALTERNATE_NAME' | 'SHORT_NAME';
}

export interface GooglePhoneNumber {
  metadata?: GoogleFieldMetadata;
  value?: string;
  /** E.164, when Google could parse it. */
  canonicalForm?: string;
  /** e.g. "home", "work", "mobile", or a custom label. */
  type?: string;
  formattedType?: string;
}

export interface GoogleEmailAddress {
  metadata?: GoogleFieldMetadata;
  value?: string;
  type?: string;
  formattedType?: string;
  displayName?: string;
}

export interface GoogleAddress {
  metadata?: GoogleFieldMetadata;
  formattedValue?: string;
  type?: string;
  formattedType?: string;
  poBox?: string;
  streetAddress?: string;
  extendedAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
}

export interface GoogleBirthday {
  metadata?: GoogleFieldMetadata;
  date?: GoogleDate;
  /** Free-text birthday (deprecated by Google but still returned for some contacts). */
  text?: string;
}

export interface GoogleOrganization {
  metadata?: GoogleFieldMetadata;
  type?: string;
  formattedType?: string;
  startDate?: GoogleDate;
  endDate?: GoogleDate;
  current?: boolean;
  name?: string;
  phoneticName?: string;
  department?: string;
  title?: string;
  jobDescription?: string;
  symbol?: string;
  domain?: string;
  location?: string;
  costCenter?: string;
  fullTimeEquivalentMillipercent?: number;
}

export interface GoogleBiography {
  metadata?: GoogleFieldMetadata;
  value?: string;
  contentType?: 'CONTENT_TYPE_UNSPECIFIED' | 'TEXT_PLAIN' | 'TEXT_HTML';
}

export interface GooglePhoto {
  metadata?: GoogleFieldMetadata;
  url?: string;
  /** True when this is Google's generated placeholder, not a real photo. */
  default?: boolean;
}

export interface GoogleGender {
  metadata?: GoogleFieldMetadata;
  /** "male", "female", "unspecified" or free text. */
  value?: string;
  formattedValue?: string;
  addressMeAs?: string;
}

export interface GoogleUrl {
  metadata?: GoogleFieldMetadata;
  value?: string;
  type?: string;
  formattedType?: string;
}

/** Raw People API person (only the fields we request). */
export interface GooglePerson {
  resourceName: string;
  etag?: string;
  names?: GoogleName[];
  nicknames?: GoogleNickname[];
  phoneNumbers?: GooglePhoneNumber[];
  emailAddresses?: GoogleEmailAddress[];
  addresses?: GoogleAddress[];
  birthdays?: GoogleBirthday[];
  organizations?: GoogleOrganization[];
  biographies?: GoogleBiography[];
  photos?: GooglePhoto[];
  genders?: GoogleGender[];
  urls?: GoogleUrl[];
}

interface ListConnectionsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
  totalPeople?: number;
  totalItems?: number;
}

// ---- Errors -----------------------------------------------------------------------------------

export type GoogleContactsErrorCode =
  | 'unavailable'
  | 'popup-closed'
  | 'popup-blocked'
  | 'account-mismatch'
  | 'scope-not-granted'
  | 'api-disabled'
  | 'unauthorized'
  | 'rate-limited'
  | 'network'
  | 'unknown';

/** Error with a friendly, user-facing `message` and a stable `code` for the UI. */
export class GoogleContactsError extends Error {
  constructor(
    readonly code: GoogleContactsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleContactsError';
  }
}

const MSG = {
  unavailable: 'Google Contacts import needs cloud sign-in to be set up for this site.',
  popupClosed: 'The Google window was closed before access was granted. Try again when ready.',
  popupBlocked: 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  accountMismatch:
    'You picked a different Google account from the one signed in to Lineage. Choose the same account, or sign out of Lineage first.',
  scopeNotGranted:
    'Lineage was not given access to your contacts. Try again and tick the "See and download your contacts" box.',
  apiDisabled:
    'Google Contacts import is not switched on yet. Turn on the People API for this project (see FIREBASE_SETUP.md › Google Contacts).',
  unauthorized: 'Google did not accept the access permission (it may have expired). Try the import again.',
  rateLimited: 'Google is limiting requests right now. Wait a minute and try again.',
  network: 'Could not reach Google. Check your connection and try again.',
} as const;

// ---- Availability + token ---------------------------------------------------------------------

/** True when real Firebase config is present (the emulator has no Google OAuth or People API). */
export function googleContactsAvailable(): boolean {
  return cloudConfigured() && !usingEmulators();
}

function authErrorToFriendly(e: unknown): Error {
  if (e instanceof GoogleContactsError) return e;
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return new GoogleContactsError('popup-closed', MSG.popupClosed);
    case 'auth/popup-blocked':
    case 'auth/operation-not-supported-in-this-environment':
      return new GoogleContactsError('popup-blocked', MSG.popupBlocked);
    case 'auth/user-mismatch':
      return new GoogleContactsError('account-mismatch', MSG.accountMismatch);
    case 'auth/network-request-failed':
      return new GoogleContactsError('network', MSG.network);
    default:
      return new GoogleContactsError('unknown', `Could not connect to Google Contacts${code ? ` (${code})` : ''}.`);
  }
}

/** Ask Google for contacts.readonly (popup) and return a short-lived OAuth access token. Never persisted. */
export async function getContactsAccessToken(): Promise<string> {
  if (!googleContactsAvailable()) throw new GoogleContactsError('unavailable', MSG.unavailable);
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, reauthenticateWithPopup, signInWithPopup } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  provider.addScope(CONTACTS_SCOPE);
  provider.setCustomParameters({ prompt: 'select_account' });

  const current = auth.currentUser;
  let result: UserCredential;
  try {
    // Signed in: re-authenticate the SAME user (Firebase rejects another account with
    // auth/user-mismatch and leaves the session unchanged). Signed out: this also signs in.
    result = current ? await reauthenticateWithPopup(current, provider) : await signInWithPopup(auth, provider);
  } catch (e) {
    throw authErrorToFriendly(e);
  }
  // Belt and braces: never continue with a different account than the signed-in one.
  if (current && result.user.uid !== current.uid) {
    throw new GoogleContactsError('account-mismatch', MSG.accountMismatch);
  }
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  // No token usually means the user unticked the contacts checkbox on the consent screen.
  if (!token) throw new GoogleContactsError('scope-not-granted', MSG.scopeNotGranted);
  return token;
}

// ---- People API fetch -------------------------------------------------------------------------

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { '@type'?: string; reason?: string }[];
  };
}

async function readError(res: Response): Promise<{ reasons: string[]; message: string; status: string }> {
  let body: GoogleApiErrorBody = {};
  try {
    body = (await res.json()) as GoogleApiErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const err = body.error ?? {};
  const reasons = (err.details ?? []).map((d) => d.reason ?? '').filter(Boolean);
  return { reasons, message: err.message ?? '', status: err.status ?? '' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelayMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('Retry-After'));
  if (Number.isFinite(header) && header > 0) return Math.min(header, 60) * 1000;
  return Math.min(1000 * 2 ** attempt, 16000) + Math.floor(Math.random() * 250);
}

/** Fetch one page, retrying 429/5xx with backoff. Throws `{ unauthorized: true }` on 401. */
async function fetchPage(token: string, pageToken: string | undefined): Promise<ListConnectionsResponse> {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), personFields: PERSON_FIELDS });
  if (pageToken) params.set('pageToken', pageToken);
  const url = `${PEOPLE_CONNECTIONS_URL}?${params.toString()}`;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    } catch {
      throw new GoogleContactsError('network', MSG.network);
    }
    if (res.ok) return (await res.json()) as ListConnectionsResponse;

    if (res.status === 401) throw new GoogleContactsError('unauthorized', MSG.unauthorized);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(retryDelayMs(res, attempt));
        continue;
      }
      if (res.status === 429) throw new GoogleContactsError('rate-limited', MSG.rateLimited);
    }
    const { reasons, message, status } = await readError(res);
    if (res.status === 403) {
      if (reasons.includes('SERVICE_DISABLED') || /People API has not been used|is disabled/i.test(message)) {
        throw new GoogleContactsError('api-disabled', MSG.apiDisabled);
      }
      if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || /insufficient authentication scopes/i.test(message)) {
        throw new GoogleContactsError('scope-not-granted', MSG.scopeNotGranted);
      }
    }
    throw new GoogleContactsError(
      'unknown',
      `Google Contacts returned an error (${res.status}${status ? ` ${status}` : ''}). Try again later.`,
    );
  }
}

/** Fetch ALL connections (follows nextPageToken; pageSize 1000). onProgress(count) after each page.
 * On a 401 (expired token) it asks once for a fresh token and resumes from the same page. */
export async function fetchGoogleContacts(token: string, onProgress?: (n: number) => void): Promise<GooglePerson[]> {
  const out: GooglePerson[] = [];
  let current = token;
  let refreshed = false;
  let pageToken: string | undefined;
  for (;;) {
    let page: ListConnectionsResponse;
    try {
      page = await fetchPage(current, pageToken);
    } catch (e) {
      if (e instanceof GoogleContactsError && e.code === 'unauthorized' && !refreshed) {
        refreshed = true;
        current = await getContactsAccessToken();
        continue; // retry the same page with the fresh token
      }
      throw e;
    }
    for (const p of page.connections ?? []) if (p && p.resourceName) out.push(p);
    onProgress?.(out.length);
    pageToken = page.nextPageToken || undefined;
    if (!pageToken) return out;
  }
}
