import { fullName } from './person';
import type { Person } from './types';

/** An editor must be someone in the tree with a phone number on record (also enforced by the rules). */
export function hasPhone(p: Pick<Person, 'phones'>): boolean {
  return (p.phones ?? []).some((x) => x.value.trim() !== '');
}

/** The first email recorded for a person, lower-cased, to prefill the invite. */
export function firstEmail(p: Pick<Person, 'emails'>): string {
  return (p.emails ?? []).map((x) => x.value.trim().toLowerCase()).find((x) => x.includes('@')) ?? '';
}

/**
 * People who can be picked as an editor, best matches first: those whose name contains the query
 * (any word starts with it ranks first). Without a query, nobody (the list would be the whole tree).
 */
export function matchPeople(people: Person[], query: string, limit = 8): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: Person; s: number; name: string }[] = [];
  for (const p of people) {
    const name = fullName(p);
    const hay = [name, p.nickname ?? '', p.otherNames ?? ''].join(' ').toLowerCase();
    if (!hay.includes(q)) continue;
    const word = hay.split(/\s+/).some((w) => w.startsWith(q));
    scored.push({ p, s: (word ? 0 : 1) + (hasPhone(p) ? 0 : 2), name });
  }
  scored.sort((a, b) => a.s - b.s || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((x) => x.p);
}
