import { FamilyGraph, relativesOf } from './kinship';
import { isFamilyType, type Person, type Relationship } from './types';

export interface ConnectionItem {
  person: Person;
  label: string;
  detail?: string;
  side?: 'paternal' | 'maternal';
  relId?: string; // stored relationship that can be removed directly
}

export interface ConnectionGroup {
  key: string;
  title: string;
  hint?: string;
  items: ConnectionItem[];
  /** Parents, spouse, children, brothers and sisters: shown first on a profile, before the details. */
  core?: boolean;
}

// Close family, in the order a profile shows it; everyone else is extended family.
const CLOSE: { key: 'parents' | 'spouse' | 'children' | 'siblings'; title: (n: number) => string; core: boolean }[] = [
  { key: 'parents', title: () => 'Parents', core: true },
  { key: 'spouse', title: (n) => (n === 1 ? 'Spouse' : 'Spouses'), core: true },
  { key: 'children', title: () => 'Children', core: true },
  { key: 'siblings', title: () => 'Brothers and sisters', core: true },
];

/**
 * Everyone related to `id` by family: parents, spouse, children, brothers and sisters, then extended family.
 * Lineage is for family only: stored non-family links from older versions are ignored.
 */
export function connectionsOf(id: string, people: Person[], rels: Relationship[], graph?: FamilyGraph): ConnectionGroup[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const me = byId.get(id);
  if (!me) return [];
  const G = graph ?? new FamilyGraph(byId, rels);
  const groups: ConnectionGroup[] = [];

  // Family — derived via the kinship engine. Direct family edges are removable.
  const directEdge = new Map<string, string>();
  for (const r of rels) {
    if (!isFamilyType(r.type)) continue;
    if (r.fromId === id) directEdge.set(r.toId, r.id);
    else if (r.toId === id) directEdge.set(r.fromId, r.id);
  }
  const relatives = relativesOf(G, id);
  const close = new Map<string, ConnectionItem[]>();
  const extended: ConnectionItem[] = [];
  for (const r of relatives) {
    const item: ConnectionItem = { person: r.person, label: r.kin.label, detail: r.kin.path !== r.kin.label ? r.kin.path : undefined, side: r.kin.side, relId: directEdge.get(r.person.id) };
    const c = r.kin.degree <= 2 ? CLOSE.find((x) => x.key === r.kin.category) : undefined;
    if (c) close.set(c.key, [...(close.get(c.key) ?? []), item]);
    else extended.push(item);
  }
  for (const c of CLOSE) {
    const items = close.get(c.key);
    if (items?.length) groups.push({ key: c.key, title: c.title(items.length), items, core: c.core });
  }
  if (extended.length) groups.push({ key: 'extended', title: 'Extended family', items: extended });

  return groups;
}
