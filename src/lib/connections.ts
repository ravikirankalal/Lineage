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
}

const IMMEDIATE = new Set(['spouse', 'parents', 'siblings', 'children']);

/**
 * Everyone related to `id` by family, immediate family first, then extended family.
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
  const immediate: ConnectionItem[] = [];
  const extended: ConnectionItem[] = [];
  for (const r of relatives) {
    const item: ConnectionItem = { person: r.person, label: r.kin.label, detail: r.kin.path !== r.kin.label ? r.kin.path : undefined, side: r.kin.side, relId: directEdge.get(r.person.id) };
    (IMMEDIATE.has(r.kin.category) && r.kin.degree <= 2 ? immediate : extended).push(item);
  }
  if (immediate.length) groups.push({ key: 'family', title: 'Immediate family', items: immediate });
  if (extended.length) groups.push({ key: 'extended', title: 'Extended family', items: extended });

  return groups;
}
