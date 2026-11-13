import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks: Firebase config/auth and the firebase/auth SDK -------------------------------------

const fb = vi.hoisted(() => ({
  configured: true,
  emulators: false,
  currentUser: null as null | { uid: string },
}));

vi.mock('../cloud/firebase', () => ({
  cloudConfigured: () => fb.configured,
  usingEmulators: () => fb.emulators,
  getFirebaseAuth: async () => ({ currentUser: fb.currentUser }),
}));

const authMock = vi.hoisted(() => {
  const providers: { scopes: string[]; params: Record<string, string> }[] = [];
  class GoogleAuthProvider {
    scopes: string[] = [];
    params: Record<string, string> = {};
    constructor() {
      providers.push(this);
    }
    addScope(s: string) {
      this.scopes.push(s);
      return this;
    }
    setCustomParameters(p: Record<string, string>) {
      this.params = p;
      return this;
    }
    static credentialFromResult = vi.fn((r: { token?: string }) => (r.token ? { accessToken: r.token } : null));
  }
  return {
    providers,
    GoogleAuthProvider,
    signInWithPopup: vi.fn(),
    reauthenticateWithPopup: vi.fn(),
  };
});

vi.mock('firebase/auth', () => authMock);

import {
  CONTACTS_SCOPE,
  fetchGoogleContacts,
  getContactsAccessToken,
  googleContactsAvailable,
  GoogleContactsError,
  PERSON_FIELDS,
  type GooglePerson,
} from '../cloud/googleContacts';

// ---- Helpers ---------------------------------------------------------------------------------

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const person = (i: number): GooglePerson => ({ resourceName: `people/c${i}`, names: [{ displayName: `Test Person ${i}` }] });

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fb.configured = true;
  fb.emulators = false;
  fb.currentUser = null;
  authMock.providers.length = 0;
  authMock.signInWithPopup.mockReset();
  authMock.reauthenticateWithPopup.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function expectCode(p: Promise<unknown>, code: string, msg?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GoogleContactsError);
  expect((err as GoogleContactsError).code).toBe(code);
  if (msg) expect((err as Error).message).toMatch(msg);
}

// ---- Availability ----------------------------------------------------------------------------

describe('googleContactsAvailable', () => {
  it('needs real config and no emulators', () => {
    expect(googleContactsAvailable()).toBe(true);
    fb.emulators = true;
    expect(googleContactsAvailable()).toBe(false);
    fb.emulators = false;
    fb.configured = false;
    expect(googleContactsAvailable()).toBe(false);
  });
});

// ---- Token -----------------------------------------------------------------------------------

describe('getContactsAccessToken', () => {
  it('signed out: refuses with not-signed-in and never opens a popup or signs in', async () => {
    await expectCode(getContactsAccessToken(), 'not-signed-in', /Sign in with Google first \(Settings → Back up and share\)/);
    expect(authMock.signInWithPopup).not.toHaveBeenCalled();
    expect(authMock.reauthenticateWithPopup).not.toHaveBeenCalled();
    expect(authMock.providers).toHaveLength(0);
  });

  it('signed in: re-authenticates the same user, requesting only contacts.readonly', async () => {
    fb.currentUser = { uid: 'u1' };
    authMock.reauthenticateWithPopup.mockResolvedValue({ user: { uid: 'u1' }, token: 'tok-2' });
    await expect(getContactsAccessToken()).resolves.toBe('tok-2');
    expect(authMock.reauthenticateWithPopup).toHaveBeenCalledWith(fb.currentUser, expect.anything());
    expect(authMock.signInWithPopup).not.toHaveBeenCalled();
    const p = authMock.providers[0];
    expect(p.scopes).toEqual([CONTACTS_SCOPE]);
    expect(p.params).toEqual({ prompt: 'select_account' });
  });

  it('a different Google account is refused', async () => {
    fb.currentUser = { uid: 'u1' };
    authMock.reauthenticateWithPopup.mockRejectedValue({ code: 'auth/user-mismatch' });
    await expectCode(getContactsAccessToken(), 'account-mismatch', /same account/);
    authMock.reauthenticateWithPopup.mockResolvedValue({ user: { uid: 'u2' }, token: 'tok' });
    await expectCode(getContactsAccessToken(), 'account-mismatch');
  });

  it('maps popup closed / blocked', async () => {
    fb.currentUser = { uid: 'u1' };
    authMock.reauthenticateWithPopup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    await expectCode(getContactsAccessToken(), 'popup-closed');
    authMock.reauthenticateWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' });
    await expectCode(getContactsAccessToken(), 'popup-blocked', /pop-ups/);
  });

  it('no access token means the scope was not granted', async () => {
    fb.currentUser = { uid: 'u1' };
    authMock.reauthenticateWithPopup.mockResolvedValue({ user: { uid: 'u1' } });
    await expectCode(getContactsAccessToken(), 'scope-not-granted');
  });

  it('is refused (without loading auth) when not available', async () => {
    fb.emulators = true;
    await expectCode(getContactsAccessToken(), 'unavailable');
    expect(authMock.signInWithPopup).not.toHaveBeenCalled();
    expect(authMock.reauthenticateWithPopup).not.toHaveBeenCalled();
  });
});

// ---- Fetch -----------------------------------------------------------------------------------

describe('fetchGoogleContacts', () => {
  it('follows nextPageToken, sends the bearer token, reports progress', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { connections: [person(1), person(2)], nextPageToken: 'p2', totalPeople: 3 }))
      .mockResolvedValueOnce(json(200, { connections: [person(3)], totalPeople: 3 }));
    const progress: number[] = [];
    const out = await fetchGoogleContacts('tok', (n) => progress.push(n));
    expect(out.map((p) => p.resourceName)).toEqual(['people/c1', 'people/c2', 'people/c3']);
    expect(progress).toEqual([2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [u1, init1] = fetchMock.mock.calls[0];
    const url1 = new URL(String(u1));
    expect(url1.origin + url1.pathname).toBe('https://people.googleapis.com/v1/people/me/connections');
    expect(url1.searchParams.get('pageSize')).toBe('1000');
    expect(url1.searchParams.get('personFields')).toBe(PERSON_FIELDS);
    expect(url1.searchParams.get('pageToken')).toBeNull();
    expect((init1?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('pageToken')).toBe('p2');
  });

  it('handles an empty address book', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await expect(fetchGoogleContacts('tok')).resolves.toEqual([]);
  });

  it('401 mid-fetch: stops with unauthorized and never refreshes the token or opens a popup', async () => {
    fb.currentUser = { uid: 'u1' };
    fetchMock
      .mockResolvedValueOnce(json(200, { connections: [person(1)], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }));
    await expectCode(
      fetchGoogleContacts('stale'),
      'unauthorized',
      /Google access expired while reading your contacts\. Tap Import from Google Contacts again\./,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authMock.signInWithPopup).not.toHaveBeenCalled();
    expect(authMock.reauthenticateWithPopup).not.toHaveBeenCalled();
    expect(authMock.providers).toHaveLength(0);
  });

  it('403 SERVICE_DISABLED: tells the owner to turn on the People API', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'People API has not been used in project 123 before or it is disabled.',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
        },
      }),
    );
    await expectCode(fetchGoogleContacts('tok'), 'api-disabled', /Turn on the People API.*FIREBASE_SETUP\.md › Google Contacts/);
  });

  it('403 by message only is also recognised as API disabled', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { message: 'People API has not been used in project 1' } }));
    await expectCode(fetchGoogleContacts('tok'), 'api-disabled');
  });

  it('403 insufficient scopes: the contacts box was unticked', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      }),
    );
    await expectCode(fetchGoogleContacts('tok'), 'scope-not-granted', /contacts/);
  });

  it('429: backs off (honouring Retry-After) and retries', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(json(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { connections: [person(1)] }));
    const p = fetchGoogleContacts('tok');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429 that never clears: rate-limited error after a bounded number of retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json(429, {}));
    const p = fetchGoogleContacts('tok');
    const settled = expectCode(p, 'rate-limited');
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('network failure and unknown errors are friendly and never contain the token', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expectCode(fetchGoogleContacts('secret-token'), 'network');
    fetchMock.mockResolvedValueOnce(json(400, { error: { status: 'INVALID_ARGUMENT' } }));
    const err = await fetchGoogleContacts('secret-token').catch((e: Error) => e);
    expect((err as GoogleContactsError).code).toBe('unknown');
    expect((err as Error).message).not.toContain('secret-token');
  });
});
