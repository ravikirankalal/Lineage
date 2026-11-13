import type { Person, Place } from './types';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function emptyPerson(partial: Partial<Person> = {}): Person {
  const now = Date.now();
  return {
    id: newId(),
    firstName: '',
    gender: 'unknown',
    phones: [],
    emails: [],
    work: [],
    education: [],
    facts: [],
    tags: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function fullName(p: Pick<Person, 'firstName' | 'middleName' | 'lastName'>): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ').trim() || 'Unnamed';
}

/** Name shown in lists: "Full Name" plus nickname in quotes when it differs. */
export function displayName(p: Person): string {
  return fullName(p);
}

export function initials(p: Person): string {
  const parts = [p.firstName, p.lastName].filter(Boolean) as string[];
  const s = parts.map((x) => x.trim()[0] ?? '').join('');
  return (s || p.nickname?.[0] || '?').toUpperCase();
}

export function formatPlace(pl?: Place, short = false): string {
  if (!pl) return '';
  const parts = short
    ? [pl.area, pl.city || pl.district, pl.city ? undefined : pl.state]
    : [pl.line, pl.area, pl.city, pl.district, pl.state, pl.country];
  return parts.map((x) => x?.trim()).filter(Boolean).join(', ');
}

export function norm(s?: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Parse "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
export function parsePartialDate(s?: string): { y?: number; m?: number; d?: number } {
  if (!s) return {};
  const m = s.trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return {};
  return { y: +m[1], m: m[2] ? +m[2] : undefined, d: m[3] ? +m[3] : undefined };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPartialDate(s?: string): string {
  const { y, m, d } = parsePartialDate(s);
  if (!y) return s ?? '';
  if (m && d) return `${d} ${MONTHS[m - 1]} ${y}`;
  if (m) return `${MONTHS[m - 1]} ${y}`;
  return String(y);
}

export function age(p: Person, now = new Date()): number | undefined {
  const b = parsePartialDate(p.birthDate);
  if (!b.y) return undefined;
  const end = p.deceased || p.deathDate ? parsePartialDate(p.deathDate) : { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  if (!end.y) return undefined;
  let a = end.y - b.y;
  if (b.m && end.m && (end.m < b.m || (end.m === b.m && b.d && end.d && end.d < b.d))) a -= 1;
  return a;
}

export function lifespan(p: Person): string {
  const b = parsePartialDate(p.birthDate).y;
  const d = parsePartialDate(p.deathDate).y;
  if (b && d) return `${b}–${d}`;
  if (b && p.deceased) return `${b}–?`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return '';
}

/** Days until next birthday (0 = today), or undefined if month/day unknown. */
export function daysUntilBirthday(p: Person, now = new Date()): number | undefined {
  if (p.deceased) return undefined;
  const { m, d } = parsePartialDate(p.birthDate);
  if (!m || !d) return undefined;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/** Everything searchable about a person, lower-cased. */
export function searchText(p: Person): string {
  return norm(
    [
      fullName(p),
      p.nickname,
      p.otherNames,
      ...p.phones.map((x) => x.value + ' ' + x.value.replace(/\D/g, '')),
      ...p.emails.map((x) => x.value),
      formatPlace(p.origin),
      formatPlace(p.address),
      p.appearance,
      p.howWeMet,
      p.occupation,
      ...p.work.map((w) => `${w.organization} ${w.role ?? ''}`),
      ...p.education.map((e) => `${e.institution} ${e.course ?? ''}`),
      ...p.facts.map((f) => `${f.label} ${f.value}`),
      ...p.tags,
      p.notes,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function matchesQuery(p: Person, q: string): boolean {
  const terms = norm(q).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const text = searchText(p);
  return terms.every((t) => text.includes(t));
}

/** Which helpful details are missing — used for "help me remember" prompts. */
export function missingDetails(p: Person): string[] {
  const miss: string[] = [];
  if (!p.photo && !p.appearance) miss.push('what they look like');
  if (!p.howWeMet && !p.isMe) miss.push('how you know them');
  if (!formatPlace(p.origin)) miss.push('where they are from');
  if (!formatPlace(p.address)) miss.push('where they live');
  if (!p.occupation && !p.work.length) miss.push('what they do');
  if (p.gender === 'unknown') miss.push('gender (for family labels)');
  return miss;
}

export function completeness(p: Person): number {
  const checks = [
    !!p.lastName,
    !!(p.photo || p.appearance),
    !!p.howWeMet || !!p.isMe,
    !!formatPlace(p.origin),
    !!formatPlace(p.address),
    !!(p.occupation || p.work.length),
    p.gender !== 'unknown',
    !!(p.phones.length || p.emails.length),
    !!p.birthDate,
    !!(p.notes || p.facts.length),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
