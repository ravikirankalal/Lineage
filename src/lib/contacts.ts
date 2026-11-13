import { emptyPerson, fullName, norm } from './person';
import type { LabeledValue, Person, Place } from './types';

// ---------------------------------------------------------------------------
// vCard (.vcf) — exported by Android, iPhone, Google Contacts, Outlook.

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const l of raw) {
    if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length) lines[lines.length - 1] += l.slice(1);
    else if (lines.length && /=$/.test(lines[lines.length - 1]) && /QUOTED-PRINTABLE/i.test(lines[lines.length - 1])) {
      // Quoted-printable soft line break.
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + l;
    } else lines.push(l);
  }
  return lines.filter((l) => l.trim());
}

function decodeQP(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i));
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

function unescapeV(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Split on unescaped separator. */
function splitV(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === sep) {
      out.push(cur);
      cur = '';
    } else cur += s[i];
  }
  out.push(cur);
  return out.map(unescapeV);
}

interface VProp {
  group?: string;
  name: string;
  params: Record<string, string[]>;
  value: string;
}

function parseLine(line: string): VProp | undefined {
  // Find the colon separating name/params from value (not inside quotes).
  let inQ = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ':' && !inQ) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return undefined;
  const head = line.slice(0, idx);
  let value = line.slice(idx + 1);
  const parts = head.split(';');
  let name = parts[0];
  let group: string | undefined;
  if (name.includes('.')) [group, name] = name.split('.', 2) as [string, string];
  const params: Record<string, string[]> = {};
  for (const p of parts.slice(1)) {
    const [k, v] = p.includes('=') ? p.split(/=(.*)/s, 2) : ['TYPE', p];
    const key = k.toUpperCase();
    params[key] = [...(params[key] ?? []), ...v.replace(/"/g, '').split(',').map((x) => x.toLowerCase())];
  }
  if (params.ENCODING?.includes('quoted-printable')) value = decodeQP(value);
  return { group, name: name.toUpperCase(), params, value };
}

const IGNORED_TYPES = new Set(['voice', 'pref', 'internet', 'x400', 'msg']);
function typeLabel(params: Record<string, string[]>, fallback: string): string {
  const t = (params.TYPE ?? []).find((x) => !IGNORED_TYPES.has(x));
  if (!t) return fallback;
  if (t === 'cell') return 'mobile';
  return t.replace(/^x-/, '');
}

function vDate(v: string): string | undefined {
  const s = v.trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^--(\d{2})-?(\d{2})/);
  if (m) return undefined; // year unknown — keep it in facts instead
  return undefined;
}

export function parseVCard(text: string): Person[] {
  const lines = unfold(text);
  const out: Person[] = [];
  let props: VProp[] | null = null;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VCARD') props = [];
    else if (prop.name === 'END' && prop.value.toUpperCase() === 'VCARD') {
      if (props) {
        const p = vcardToPerson(props);
        if (p) out.push(p);
      }
      props = null;
    } else if (props) props.push(prop);
  }
  return out;
}

function vcardToPerson(props: VProp[]): Person | undefined {
  const p = emptyPerson({ source: 'vcard' });
  const labels = new Map<string, string>();
  for (const pr of props) if (pr.name === 'X-ABLABEL' && pr.group) labels.set(pr.group, pr.value.replace(/^_\$!<|>!\$_$/g, '').toLowerCase());
  let fn = '';
  for (const pr of props) {
    const v = pr.value;
    switch (pr.name) {
      case 'FN':
        fn = unescapeV(v).trim();
        break;
      case 'N': {
        const [last, first, middle] = splitV(v, ';');
        p.lastName = last?.trim() || undefined;
        p.firstName = first?.trim() || '';
        p.middleName = middle?.trim() || undefined;
        break;
      }
      case 'NICKNAME':
        p.nickname = unescapeV(v).trim() || undefined;
        break;
      case 'TEL': {
        const val = unescapeV(v).replace(/^tel:/i, '').trim();
        if (val) p.phones.push({ label: (pr.group && labels.get(pr.group)) || typeLabel(pr.params, 'phone'), value: val });
        break;
      }
      case 'EMAIL': {
        const val = unescapeV(v).trim();
        if (val) p.emails.push({ label: (pr.group && labels.get(pr.group)) || typeLabel(pr.params, 'email'), value: val });
        break;
      }
      case 'ADR': {
        const [, ext, street, locality, region, postal, country] = splitV(v, ';').map((x) => x.trim());
        const place: Place = {
          line: [ext, street, postal].filter(Boolean).join(', ') || undefined,
          city: locality || undefined,
          state: region || undefined,
          country: country || undefined,
        };
        if (Object.values(place).some(Boolean) && !p.address) p.address = place;
        break;
      }
      case 'ORG': {
        const org = splitV(v, ';').filter(Boolean).join(', ').trim();
        if (org) p.work.push({ organization: org });
        break;
      }
      case 'TITLE':
        if (v.trim()) {
          if (p.work[0]) p.work[0].role = unescapeV(v).trim();
          else p.occupation = unescapeV(v).trim();
        }
        break;
      case 'BDAY': {
        const d = vDate(v);
        if (d) p.birthDate = d;
        else if (v.trim()) p.facts.push({ label: 'Birthday', value: v.trim() });
        break;
      }
      case 'NOTE':
        p.notes = unescapeV(v).trim() || undefined;
        break;
      case 'GENDER': {
        const s = v.trim().toUpperCase()[0];
        p.gender = s === 'M' ? 'male' : s === 'F' ? 'female' : 'unknown';
        break;
      }
      case 'PHOTO': {
        const enc = pr.params.ENCODING?.[0];
        if (v.startsWith('data:')) p.photo = v;
        else if (enc === 'b' || enc === 'base64') {
          const type = (pr.params.TYPE?.[0] ?? 'jpeg').replace('image/', '');
          p.photo = `data:image/${type};base64,${v.replace(/\s/g, '')}`;
        }
        break;
      }
      case 'URL':
        if (v.trim()) p.facts.push({ label: 'Website', value: unescapeV(v).trim() });
        break;
    }
  }
  if (!p.firstName && !p.lastName) {
    const parts = fn.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      p.lastName = parts.pop();
      p.firstName = parts.join(' ');
    } else p.firstName = fn;
  }
  if (!p.firstName && p.lastName) {
    p.firstName = p.lastName;
    p.lastName = undefined;
  }
  if (!p.firstName) {
    // Business contacts often have only an organization: name them after it.
    const fallback = p.work[0]?.organization || p.phones[0]?.value || p.emails[0]?.value;
    if (!fallback) return undefined;
    p.firstName = fallback;
  }
  // Photos from contacts can be large: drop anything over ~200 KB.
  if (p.photo && p.photo.length > 270_000) p.photo = undefined;
  return p;
}

// ---------------------------------------------------------------------------
// CSV — Google Contacts / Outlook exports.

export function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function parseContactsCSV(text: string): Person[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const ci = {
    first: col('first name', 'given name'),
    middle: col('middle name', 'additional name'),
    last: col('last name', 'family name', 'surname'),
    name: col('name', 'display name', 'full name'),
    nick: col('nickname'),
    bday: col('birthday'),
    notes: col('notes', 'note'),
    org: col('organization name', 'organization 1 - name', 'company'),
    title: col('organization title', 'organization 1 - title', 'job title'),
    gender: col('gender'),
  };
  const out: Person[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const p = emptyPerson({ source: 'csv' });
    p.firstName = get(ci.first);
    p.middleName = get(ci.middle) || undefined;
    p.lastName = get(ci.last) || undefined;
    if (!p.firstName && !p.lastName && get(ci.name)) {
      const parts = get(ci.name).split(/\s+/);
      p.lastName = parts.length > 1 ? parts.pop() : undefined;
      p.firstName = parts.join(' ');
    }
    p.nickname = get(ci.nick) || undefined;
    const bd = get(ci.bday);
    if (bd) {
      const d = vDate(bd);
      if (d) p.birthDate = d;
      else p.facts.push({ label: 'Birthday', value: bd });
    }
    p.notes = get(ci.notes) || undefined;
    if (get(ci.org)) p.work.push({ organization: get(ci.org), role: get(ci.title) || undefined });
    else if (get(ci.title)) p.occupation = get(ci.title);
    const gd = get(ci.gender).toLowerCase();
    if (gd.startsWith('m')) p.gender = 'male';
    else if (gd.startsWith('f')) p.gender = 'female';

    // Phones & emails: Google style "Phone 1 - Value" (may hold " ::: " separated values) or Outlook columns.
    header.forEach((h, i) => {
      const v = (r[i] ?? '').trim();
      if (!v) return;
      const gm = h.match(/^(phone|e-mail|email) (\d+) - value$/);
      if (gm) {
        const typeIdx = header.indexOf(`${gm[1]} ${gm[2]} - type`);
        const label = (typeIdx >= 0 ? r[typeIdx] : '')?.replace(/^\*\s*/, '').toLowerCase() || (gm[1] === 'phone' ? 'phone' : 'email');
        for (const val of v.split(':::').map((x) => x.trim()).filter(Boolean)) {
          (gm[1] === 'phone' ? p.phones : p.emails).push({ label, value: val });
        }
        return;
      }
      const om = h.match(/^(mobile|home|business|other|primary|car|company main)? ?phone( 2)?$/);
      if (om && h !== 'phone') p.phones.push({ label: (om[1] ?? 'phone').replace('business', 'work'), value: v });
      else if (/^e-?mail( \d)? address$/.test(h)) p.emails.push({ label: 'email', value: v });
    });

    // Address (Google: "Address 1 - City"; Outlook: "Home City").
    const addr = (k: string) => {
      const i = header.findIndex((h) => h === `address 1 - ${k}` || h === `home ${k}`);
      return i >= 0 ? (r[i] ?? '').trim() : '';
    };
    const place: Place = {
      line: addr('street') || undefined,
      city: addr('city') || undefined,
      state: addr('region') || addr('state') || undefined,
      country: addr('country') || addr('country/region') || undefined,
    };
    if (Object.values(place).some(Boolean)) p.address = place;

    if (!p.firstName && p.lastName) {
      p.firstName = p.lastName;
      p.lastName = undefined;
    }
    if (!p.firstName) p.firstName = p.phones[0]?.value || p.emails[0]?.value || '';
    if (p.firstName) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contact Picker API (Android Chrome).

interface PickerContact {
  name?: string[];
  tel?: string[];
  email?: string[];
  address?: { city?: string; region?: string; country?: string; addressLine?: string[] }[];
}

export function contactPickerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;
}

export async function pickContacts(): Promise<Person[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  const supported: string[] = await nav.contacts.getProperties();
  const props = ['name', 'tel', 'email', 'address'].filter((x) => supported.includes(x));
  const picked: PickerContact[] = await nav.contacts.select(props, { multiple: true });
  return picked.map((c) => {
    const name = (c.name?.[0] ?? '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const p = emptyPerson({ source: 'picker' });
    p.lastName = parts.length > 1 ? parts.pop() : undefined;
    p.firstName = parts.join(' ') || c.tel?.[0] || c.email?.[0] || 'Unnamed';
    p.phones = (c.tel ?? []).map((v) => ({ label: 'mobile', value: v }));
    p.emails = (c.email ?? []).map((v) => ({ label: 'email', value: v }));
    const a = c.address?.[0];
    if (a) p.address = { city: a.city, state: a.region, country: a.country, line: a.addressLine?.join(', ') };
    return p;
  });
}

// ---------------------------------------------------------------------------
// Google People API (people.connections.list) — fetched by src/lib/cloud/googleContacts.ts.
// Only the fields read here are typed; values may be null or missing in real responses.

type Maybe<T> = T | null | undefined;
interface GField {
  metadata?: Maybe<{ primary?: Maybe<boolean> }>;
}
interface GTyped extends GField {
  value?: Maybe<string>;
  type?: Maybe<string>;
  formattedType?: Maybe<string>;
}
export interface PeopleApiPerson {
  resourceName?: Maybe<string>;
  names?: Maybe<(GField & { displayName?: Maybe<string>; givenName?: Maybe<string>; middleName?: Maybe<string>; familyName?: Maybe<string>; unstructuredName?: Maybe<string> })[]>;
  nicknames?: Maybe<(GField & { value?: Maybe<string> })[]>;
  phoneNumbers?: Maybe<(GTyped & { canonicalForm?: Maybe<string> })[]>;
  emailAddresses?: Maybe<GTyped[]>;
  addresses?: Maybe<(GTyped & {
    formattedValue?: Maybe<string>; streetAddress?: Maybe<string>; extendedAddress?: Maybe<string>; poBox?: Maybe<string>;
    city?: Maybe<string>; region?: Maybe<string>; postalCode?: Maybe<string>; country?: Maybe<string>; countryCode?: Maybe<string>;
  })[]>;
  birthdays?: Maybe<(GField & { date?: Maybe<{ year?: Maybe<number>; month?: Maybe<number>; day?: Maybe<number> }>; text?: Maybe<string> })[]>;
  organizations?: Maybe<(GField & { name?: Maybe<string>; title?: Maybe<string> })[]>;
  biographies?: Maybe<(GField & { value?: Maybe<string>; contentType?: Maybe<string> })[]>;
  photos?: Maybe<(GField & { url?: Maybe<string>; default?: Maybe<boolean> })[]>;
  genders?: Maybe<(GField & { value?: Maybe<string> })[]>;
  urls?: Maybe<GTyped[]>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const gs = (s: Maybe<string>) => (s ?? '').trim();
/** Primary entry first, then the rest in API order. */
function primaryFirst<T extends GField>(list: Maybe<T[]>): T[] {
  const l = list ?? [];
  return [...l.filter((x) => x.metadata?.primary), ...l.filter((x) => !x.metadata?.primary)];
}
const gLabel = (x: GTyped, fallback: string) => gs(x.formattedType).toLowerCase() || gs(x.type).toLowerCase() || fallback;

/** Map Google People API persons to Lineage people. Duplicates within the list are merged. */
export function peopleApiToPersons(list: PeopleApiPerson[]): Person[] {
  const out: Person[] = [];
  for (const g of list) {
    const p = gPersonToPerson(g);
    if (p) out.push(p);
  }
  return planImport(out, []).map((c) => c.person);
}

function gPersonToPerson(g: PeopleApiPerson): Person | undefined {
  const p = emptyPerson({ source: 'google' });

  const n = primaryFirst(g.names)[0];
  if (n) {
    p.firstName = gs(n.givenName);
    p.middleName = gs(n.middleName) || undefined;
    p.lastName = gs(n.familyName) || undefined;
    if (!p.firstName && !p.lastName) {
      const parts = (gs(n.displayName) || gs(n.unstructuredName)).split(/\s+/).filter(Boolean);
      p.lastName = parts.length > 1 ? parts.pop() : undefined;
      p.firstName = parts.join(' ');
    }
  }
  p.nickname = primaryFirst(g.nicknames).map((x) => gs(x.value)).find(Boolean);

  for (const x of primaryFirst(g.phoneNumbers)) {
    // Keep the number as the user typed it (extensions like "x 204" or "#5" live only there);
    // canonicalForm (E.164) is a fallback. Matching uses the last 10 digits either way.
    const value = gs(x.value) || gs(x.canonicalForm);
    if (value) p.phones.push({ label: gLabel(x, 'phone'), value });
  }
  for (const x of primaryFirst(g.emailAddresses)) {
    const value = gs(x.value);
    if (value) p.emails.push({ label: gLabel(x, 'email'), value });
  }

  // One address fits Person.address: home if there is one, else the first. Others are kept as facts.
  const addrs = (g.addresses ?? []).filter((a) => gs(a.formattedValue) || gs(a.streetAddress) || gs(a.city) || gs(a.region) || gs(a.country) || gs(a.countryCode));
  const home = addrs.find((a) => gs(a.type).toLowerCase() === 'home') ?? addrs[0];
  if (home) {
    const structured = gs(home.streetAddress) || gs(home.extendedAddress) || gs(home.city) || gs(home.region) || gs(home.country) || gs(home.countryCode);
    const place: Place = structured
      ? {
          line: [gs(home.streetAddress), gs(home.extendedAddress), gs(home.poBox), gs(home.postalCode)].filter(Boolean).join(', ') || undefined,
          city: gs(home.city) || undefined,
          state: gs(home.region) || undefined,
          country: gs(home.country) || gs(home.countryCode) || undefined,
        }
      : { line: gs(home.formattedValue).split(/\n+/).map((x) => x.trim()).filter(Boolean).join(', ') };
    p.address = Object.fromEntries(Object.entries(place).filter(([, v]) => v)) as Place;
  }
  for (const a of addrs) {
    if (a === home) continue;
    const text = gs(a.formattedValue).split(/\n+/).map((x) => x.trim()).filter(Boolean).join(', ') ||
      [gs(a.streetAddress), gs(a.extendedAddress), gs(a.city), gs(a.region), gs(a.postalCode), gs(a.country) || gs(a.countryCode)].filter(Boolean).join(', ');
    const kind = gs(a.formattedType) || gs(a.type);
    p.facts.push({ label: kind ? `Address (${kind.toLowerCase()})` : 'Other address', value: text });
  }

  // Birthday: the first full date wins; otherwise keep what we have as a fact.
  let bdayFact = '';
  for (const b of primaryFirst(g.birthdays)) {
    const d = b.date;
    if (d?.year) {
      const pad = (x: number) => String(x).padStart(2, '0');
      p.birthDate = d.month ? (d.day ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : `${d.year}-${pad(d.month)}`) : String(d.year);
      break;
    }
    const text = gs(b.text);
    const fromText = text ? vDate(text) : undefined;
    if (fromText) {
      p.birthDate = fromText;
      break;
    }
    if (!bdayFact) {
      if (d?.month) bdayFact = [d.day, MONTHS[d.month - 1]].filter(Boolean).join(' ');
      else if (text) bdayFact = text;
    }
  }
  if (!p.birthDate && bdayFact) p.facts.push({ label: 'Birthday', value: bdayFact });

  for (const o of g.organizations ?? []) {
    const org = gs(o.name);
    const role = gs(o.title);
    if (org) p.work.push({ organization: org, ...(role ? { role } : {}) });
    else if (role && !p.occupation) p.occupation = role;
  }
  const bio = (x: { value?: Maybe<string>; contentType?: Maybe<string> }) =>
    x.contentType === 'TEXT_HTML'
      ? gs(gs(x.value).replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))
      : gs(x.value);
  const notes = (g.biographies ?? []).map(bio).filter(Boolean).join('\n\n');
  p.notes = notes || undefined;
  for (const u of g.urls ?? []) {
    const value = gs(u.value);
    if (value) p.facts.push({ label: 'Website', value });
  }
  const gender = gs(primaryFirst(g.genders)[0]?.value).toLowerCase();
  if (gender === 'male' || gender === 'female') p.gender = gender;
  else if (gender && gender !== 'unspecified') p.gender = 'other';

  // Photos: Google serves https URLs (and a generated letter avatar marked `default`). We keep only
  // inline data:image URLs — the cloud rules require data:image, and hot-linking would leak the
  // viewer's IP to Google on every render.
  // TODO: fetch the https photo once at import time, downscale it and embed it as a data: URL.
  const photo = (g.photos ?? []).find((x) => !x.default && /^data:image\//i.test(gs(x.url)));
  if (photo && gs(photo.url).length <= 270_000) p.photo = gs(photo.url);

  if (!p.firstName && p.lastName) {
    p.firstName = p.lastName;
    p.lastName = undefined;
  }
  if (!p.firstName) {
    // Business contacts often have only an organization: name them after it.
    const fallback = p.work[0]?.organization || p.phones[0]?.value || p.emails[0]?.value;
    if (!fallback) return undefined;
    p.firstName = fallback;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Duplicate detection & merge

/** A trailing extension: "ext. 204", "extension 204", "x204", "#5", ";ext=204" or a dial pause ",204". */
const PHONE_EXT = /\s*(?:;\s*ext=|e?xt(?:ension)?\.?|x|#|[,;])\s*(\d+)\s*$/i;

/** Matching key for a phone number: its last 10 digits, ignoring any extension. */
export function phoneKey(v: string): string {
  const d = v.replace(PHONE_EXT, '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Key for merging phone lists: the same line with a different extension is a different entry. */
export const phoneEntryKey = (v: string): string => {
  const ext = PHONE_EXT.exec(v)?.[1];
  return ext ? `${phoneKey(v)}x${ext}` : phoneKey(v);
};

export type MatchStrength = 'strong' | 'possible';
export interface DuplicateMatch {
  person: Person;
  /** strong = shared phone or email; possible = same full name and one side has no phone/email to compare. */
  strength: MatchStrength;
}

const phoneKeys = (p: Person) => p.phones.map((x) => phoneKey(x.value)).filter((x) => x.length >= 6);
const emailKeys = (p: Person) => p.emails.map((x) => norm(x.value)).filter(Boolean);
const hasContactInfo = (p: Person) => phoneKeys(p).length > 0 || emailKeys(p).length > 0;

/**
 * Find an existing person that `candidate` duplicates.
 * Order: phone (last 10 digits) → email → exact normalised full name. A name-only match counts
 * only when one side has no phone or email; two people with the same name and different numbers
 * are treated as different people.
 */
export function findDuplicate(candidate: Person, existing: Person[]): DuplicateMatch | undefined {
  const phones = new Set(phoneKeys(candidate));
  const emails = new Set(emailKeys(candidate));
  const strong =
    existing.find((e) => phoneKeys(e).some((k) => phones.has(k))) ??
    existing.find((e) => emailKeys(e).some((k) => emails.has(k)));
  if (strong) return { person: strong, strength: 'strong' };
  const name = norm(fullName(candidate));
  if (!name) return undefined;
  const candHasInfo = hasContactInfo(candidate);
  const possible = existing.find((e) => norm(fullName(e)) === name && (!candHasInfo || !hasContactInfo(e)));
  return possible ? { person: possible, strength: 'possible' } : undefined;
}

/** A Place with no non-empty values counts as missing. */
function placeOrUndefined(p: Place | undefined): Place | undefined {
  return p && Object.values(p).some((v) => typeof v === 'string' && v.trim() !== '') ? p : undefined;
}

/** Fill gaps in `base` with data from `incoming`. Never overwrites what the user typed. */
export function mergeInto(base: Person, incoming: Person): Person {
  const mergeLV = (a: LabeledValue[], b: LabeledValue[], key: (s: string) => string) => {
    const seen = new Set(a.map((x) => key(x.value)));
    return [...a, ...b.filter((x) => !seen.has(key(x.value)))];
  };
  return {
    ...base,
    middleName: base.middleName || incoming.middleName,
    lastName: base.lastName || incoming.lastName,
    nickname: base.nickname || incoming.nickname,
    gender: base.gender !== 'unknown' ? base.gender : incoming.gender,
    birthDate: base.birthDate || incoming.birthDate,
    phones: mergeLV(base.phones, incoming.phones, phoneEntryKey),
    emails: mergeLV(base.emails, incoming.emails, norm),
    address: placeOrUndefined(base.address) ?? placeOrUndefined(incoming.address) ?? base.address,
    origin: placeOrUndefined(base.origin) ?? placeOrUndefined(incoming.origin) ?? base.origin,
    occupation: base.occupation || incoming.occupation,
    work: base.work.length ? base.work : incoming.work,
    notes: base.notes || incoming.notes,
    photo: base.photo || incoming.photo,
    facts: [...base.facts, ...incoming.facts.filter((f) => !base.facts.some((b) => b.label === f.label))],
  };
}

export interface ImportCandidate {
  person: Person;
  match?: DuplicateMatch;
}

/**
 * Pair each incoming contact with an existing person, and collapse duplicates within the import
 * itself (e.g. a .vcf and a .csv of the same phone book) into one candidate via `mergeInto`.
 */
export function planImport(incoming: Person[], existing: Person[]): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  // Indexes replace the O(n²) scans of `findDuplicate`; results are identical.
  const existingIdx = new DuplicateIndex();
  existing.forEach((e, i) => existingIdx.set(i, e));
  /** Unmatched candidates only, keyed by their position in `out`. */
  const unmatchedIdx = new DuplicateIndex();
  /** existing person id → lowest `out` position matched to it. */
  const byMatchId = new Map<string, number>();
  const setMatch = (i: number, match: DuplicateMatch) => {
    out[i].match = match;
    unmatchedIdx.delete(i);
    const prior = byMatchId.get(match.person.id);
    if (prior === undefined || i < prior) byMatchId.set(match.person.id, i);
  };

  for (const p of incoming) {
    const keys = dupKeys(p);
    const exHit = existingIdx.find(keys);
    const ex = exHit && { person: existing[exHit.index], strength: exHit.strength };
    const prev = unmatchedIdx.find(keys);
    if (prev && ex?.strength !== 'strong' && (prev.strength === 'strong' || !ex)) {
      const target = out[prev.index];
      target.person = mergeInto(target.person, p);
      // The merged contact may now share a phone/email with someone already saved.
      const again = existingIdx.find(dupKeys(target.person));
      if (again?.strength === 'strong') setMatch(prev.index, { person: existing[again.index], strength: 'strong' });
      else unmatchedIdx.set(prev.index, target.person); // merging may add phones, emails or name parts
      continue;
    }
    if (ex) {
      const sameIdx = byMatchId.get(ex.person.id);
      if (sameIdx !== undefined) {
        const same = out[sameIdx];
        same.person = mergeInto(same.person, p);
        if (ex.strength === 'strong') same.match = ex;
        continue;
      }
    }
    const i = out.push({ person: p, match: ex }) - 1;
    if (ex) setMatch(i, ex);
    else unmatchedIdx.set(i, p);
  }
  return out;
}

interface DupKeys {
  phones: string[];
  emails: string[];
  name: string;
  hasInfo: boolean;
}

function dupKeys(p: Person): DupKeys {
  const phones = phoneKeys(p);
  const emails = emailKeys(p);
  return { phones, emails, name: norm(fullName(p)), hasInfo: phones.length > 0 || emails.length > 0 };
}

/**
 * Lookup tables answering `findDuplicate` for a numbered list of people in O(keys) instead of
 * O(n). Ties resolve to the lowest number, matching `findDuplicate`'s first-in-array rule.
 */
class DuplicateIndex {
  private byPhone = new Map<string, Set<number>>();
  private byEmail = new Map<string, Set<number>>();
  private byName = new Map<string, Set<number>>();
  private keys = new Map<number, DupKeys>();

  set(i: number, p: Person): void {
    this.delete(i);
    const k = dupKeys(p);
    this.keys.set(i, k);
    for (const x of k.phones) add(this.byPhone, x, i);
    for (const x of k.emails) add(this.byEmail, x, i);
    if (k.name) add(this.byName, k.name, i);
  }

  delete(i: number): void {
    const k = this.keys.get(i);
    if (!k) return;
    this.keys.delete(i);
    for (const x of k.phones) remove(this.byPhone, x, i);
    for (const x of k.emails) remove(this.byEmail, x, i);
    if (k.name) remove(this.byName, k.name, i);
  }

  find(c: DupKeys): { index: number; strength: MatchStrength } | undefined {
    const phone = lowest(this.byPhone, c.phones);
    if (phone !== undefined) return { index: phone, strength: 'strong' };
    const email = lowest(this.byEmail, c.emails);
    if (email !== undefined) return { index: email, strength: 'strong' };
    if (!c.name) return undefined;
    const name = lowest(this.byName, [c.name], (i) => !c.hasInfo || !this.keys.get(i)!.hasInfo);
    return name !== undefined ? { index: name, strength: 'possible' } : undefined;
  }
}

function add(map: Map<string, Set<number>>, key: string, i: number) {
  const s = map.get(key);
  if (s) s.add(i);
  else map.set(key, new Set([i]));
}

function remove(map: Map<string, Set<number>>, key: string, i: number) {
  const s = map.get(key);
  if (!s) return;
  s.delete(i);
  if (!s.size) map.delete(key);
}

function lowest(map: Map<string, Set<number>>, keys: string[], ok?: (i: number) => boolean): number | undefined {
  let best: number | undefined;
  for (const k of keys) {
    const s = map.get(k);
    if (!s) continue;
    for (const i of s) if ((best === undefined || i < best) && (!ok || ok(i))) best = i;
  }
  return best;
}

export function parseContactsFile(name: string, text: string): Person[] {
  if (/\.vcf$|\.vcard$/i.test(name) || /BEGIN:VCARD/i.test(text.slice(0, 2000))) return parseVCard(text);
  return parseContactsCSV(text);
}
