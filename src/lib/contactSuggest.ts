/**
 * Contact suggestions for the "add a relative" sheet: people from the user's Google Contacts or the
 * phone's contact picker, offered while typing a name. Contacts are never stored: only the one the
 * user picks becomes a person in the tree (as a normal, hand-added person).
 */
import { emptyPerson, fullName, norm, phoneKey } from './person';
import type { Gender, Person } from './types';

export interface ContactSuggestion {
  key: string;
  firstName: string;
  lastName?: string;
  nickname?: string;
  phones: string[];
  emails: string[];
  gender: Gender;
  from: 'google' | 'phone';
}

type Maybe<T> = T | null | undefined;
/** The subset of a People API person we read (values may be missing). */
export interface GooglePersonLite {
  resourceName?: Maybe<string>;
  names?: Maybe<{ givenName?: Maybe<string>; middleName?: Maybe<string>; familyName?: Maybe<string>; displayName?: Maybe<string>; unstructuredName?: Maybe<string>; metadata?: Maybe<{ primary?: Maybe<boolean> }> }[]>;
  nicknames?: Maybe<{ value?: Maybe<string> }[]>;
  phoneNumbers?: Maybe<{ value?: Maybe<string>; canonicalForm?: Maybe<string> }[]>;
  emailAddresses?: Maybe<{ value?: Maybe<string> }[]>;
  genders?: Maybe<{ value?: Maybe<string> }[]>;
}

const clean = (s: Maybe<string>) => (s ?? '').replace(/\s+/g, ' ').trim();
const genderOf = (v: Maybe<string>): Gender => (v === 'male' || v === 'female' ? v : 'unknown');

/** First/last name from one display string: the last word is the surname. */
function splitName(display: string): { firstName: string; lastName?: string } {
  const parts = display.split(' ').filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function fromGooglePerson(g: GooglePersonLite): ContactSuggestion | null {
  const n = g.names?.find((x) => x?.metadata?.primary) ?? g.names?.[0];
  let firstName = clean([n?.givenName, n?.middleName].filter(Boolean).join(' '));
  let lastName: string | undefined = clean(n?.familyName) || undefined;
  if (!firstName) ({ firstName, lastName } = splitName(clean(n?.displayName ?? n?.unstructuredName)));
  const phones = [...new Set((g.phoneNumbers ?? []).map((p) => clean(p?.value || p?.canonicalForm)).filter(Boolean))];
  const emails = [...new Set((g.emailAddresses ?? []).map((e) => clean(e?.value)).filter(Boolean))];
  if (!firstName) return null; // number-only entries are no help when adding a relative by name
  return {
    key: 'g:' + (g.resourceName ?? `${firstName} ${lastName ?? ''} ${phones[0] ?? ''}`),
    firstName, lastName,
    nickname: clean(g.nicknames?.[0]?.value) || undefined,
    phones, emails,
    gender: genderOf(g.genders?.[0]?.value),
    from: 'google',
  };
}

/** A contact from the phone's picker (Contact Picker API). */
export function fromPicked(c: { name?: string[]; tel?: string[]; email?: string[] }, i = 0): ContactSuggestion | null {
  const display = clean(c.name?.[0]);
  const phones = [...new Set((c.tel ?? []).map(clean).filter(Boolean))];
  const { firstName, lastName } = splitName(display);
  if (!firstName && !phones.length) return null;
  return { key: `p:${i}:${display}:${phones[0] ?? ''}`, firstName: firstName || phones[0], lastName, phones, emails: (c.email ?? []).map(clean).filter(Boolean), gender: 'unknown', from: 'phone' };
}

/** A contact read from the phone by the Android app. */
export function fromNative(c: { id: string; display?: string; given?: string; family?: string; nickname?: string; phones?: string[]; emails?: string[] }): ContactSuggestion | null {
  let firstName = clean(c.given);
  let lastName: string | undefined = clean(c.family) || undefined;
  if (!firstName) ({ firstName, lastName } = splitName(clean(c.display)));
  if (!firstName) return null;
  return {
    key: 'n:' + c.id, firstName, lastName, nickname: clean(c.nickname) || undefined,
    phones: [...new Set((c.phones ?? []).map(clean).filter(Boolean))],
    emails: [...new Set((c.emails ?? []).map(clean).filter(Boolean))],
    gender: 'unknown', from: 'phone',
  };
}

export const contactName = (c: ContactSuggestion) => [c.firstName, c.lastName].filter(Boolean).join(' ');

/**
 * Contacts matching `q` (every word in the name, nickname or phone digits), leaving out anyone who is
 * already in the tree (same phone number, or exactly the same full name).
 */
export function suggestContacts(list: readonly ContactSuggestion[], q: string, people: readonly Person[], limit = 6): ContactSuggestion[] {
  const terms = norm(q).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const phones = new Set(people.flatMap((p) => p.phones.map((x) => phoneKey(x.value))).filter((k) => k.length >= 6));
  const names = new Set(people.map((p) => norm(fullName(p))));
  const out: ContactSuggestion[] = [];
  for (const c of list) {
    const text = norm([contactName(c), c.nickname, ...c.phones.map((p) => p.replace(/\D/g, ''))].filter(Boolean).join(' '));
    if (!terms.every((t) => text.includes(t))) continue;
    if (c.phones.some((p) => phones.has(phoneKey(p))) || names.has(norm(contactName(c)))) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** The person to create for a picked contact. Hand-added (source 'manual'), so later clean-ups keep them. */
export function contactToPerson(c: ContactSuggestion, gender: Gender = 'unknown'): Person {
  return emptyPerson({
    firstName: c.firstName,
    lastName: c.lastName,
    nickname: c.nickname,
    gender: c.gender !== 'unknown' ? c.gender : gender,
    phones: c.phones.map((value) => ({ label: 'mobile', value })),
    emails: c.emails.map((value) => ({ label: 'email', value })),
  });
}

/**
 * People in the tree who are also in the user's contacts: the same phone number (6+ digits), or exactly
 * the same full name. Person id → the matching contact.
 */
export function matchContacts(people: readonly Person[], contacts: readonly ContactSuggestion[]): Map<string, ContactSuggestion> {
  const out = new Map<string, ContactSuggestion>();
  if (!contacts.length) return out;
  const byPhone = new Map<string, ContactSuggestion>();
  const byName = new Map<string, ContactSuggestion>();
  for (const c of contacts) {
    for (const ph of c.phones) { const k = phoneKey(ph); if (k.length >= 6 && !byPhone.has(k)) byPhone.set(k, c); }
    const n = norm(contactName(c));
    if (n && !byName.has(n)) byName.set(n, c);
  }
  for (const p of people) {
    const hit = p.phones.map((x) => byPhone.get(phoneKey(x.value))).find(Boolean) ?? byName.get(norm(fullName(p)));
    if (hit) out.set(p.id, hit);
  }
  return out;
}
