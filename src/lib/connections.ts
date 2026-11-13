import { FamilyGraph, relativesOf } from './kinship';
import { norm } from './person';
import { SOCIAL_LABELS, isFamilyType, type Person, type Relationship, type SocialType } from './types';

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

const SOCIAL_ORDER: SocialType[] = ['close_friend', 'friend', 'colleague', 'classmate', 'acquaintance', 'neighbor', 'other'];
const SOCIAL_TITLES: Record<SocialType, string> = {
  close_friend: 'Close friends',
  friend: 'Friends',
  colleague: 'Colleagues',
  classmate: 'Classmates',
  acquaintance: 'Acquaintances',
  neighbor: 'Neighbours',
  other: 'Other connections',
};

const IMMEDIATE = new Set(['spouse', 'parents', 'siblings', 'children']);

/**
 * Everyone connected to `id`, closest circle first:
 * immediate family → extended family → friends … → implicit (same area, city,
 * home town, college, workplace).
 */
export function connectionsOf(id: string, people: Person[], rels: Relationship[], graph?: FamilyGraph): ConnectionGroup[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const me = byId.get(id);
  if (!me) return [];
  const G = graph ?? new FamilyGraph(byId, rels);
  const shown = new Set<string>([id]);
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
    shown.add(r.person.id);
  }
  // Family edges that the engine couldn't place (shouldn't happen, but keep them visible).
  if (immediate.length) groups.push({ key: 'family', title: 'Immediate family', items: immediate });
  if (extended.length) groups.push({ key: 'extended', title: 'Extended family', items: extended });

  // Social circles from explicit relationships.
  const social = new Map<SocialType, ConnectionItem[]>();
  for (const r of rels) {
    if (isFamilyType(r.type)) continue;
    const other = r.fromId === id ? r.toId : r.toId === id ? r.fromId : undefined;
    if (!other) continue;
    const p = byId.get(other);
    if (!p) continue;
    const t = r.type as SocialType;
    if (!social.has(t)) social.set(t, []);
    social.get(t)!.push({ person: p, label: SOCIAL_LABELS[t], detail: r.note, relId: r.id });
    shown.add(p.id);
  }
  for (const t of SOCIAL_ORDER) {
    const items = social.get(t);
    if (items?.length) groups.push({ key: t, title: SOCIAL_TITLES[t], items: items.sort(byName) });
  }

  // Implicit circles from shared attributes.
  const others = people.filter((p) => !shown.has(p.id));
  const addImplicit = (key: string, title: string, hint: string, match: (p: Person) => string | undefined) => {
    const items: ConnectionItem[] = [];
    for (const p of others) {
      if (shown.has(p.id)) continue;
      const m = match(p);
      if (m) items.push({ person: p, label: m });
    }
    if (items.length) {
      items.forEach((i) => shown.add(i.person.id));
      groups.push({ key, title, hint, items: items.sort(byName) });
    }
  };

  const myArea = norm(me.address?.area);
  const myCity = norm(me.address?.city);
  const myOriginTown = norm(me.origin?.city || me.origin?.area);
  const myOriginDistrict = norm(me.origin?.district);
  const mySchools = new Map(me.education.map((e) => [norm(e.institution), e.institution]));
  const myWork = new Map(me.work.map((w) => [norm(w.organization), w.organization]));

  if (myArea && myCity) {
    addImplicit('area', 'Same neighbourhood', `Live in ${me.address!.area}`, (p) =>
      norm(p.address?.area) === myArea && norm(p.address?.city) === myCity ? me.address!.area : undefined);
  }
  if (myCity) {
    addImplicit('city', 'Same city', `Live in ${me.address!.city}`, (p) => (norm(p.address?.city) === myCity ? p.address?.area || me.address!.city : undefined));
  }
  if (myOriginTown || myOriginDistrict) {
    addImplicit('origin', 'Same home town', 'Come from the same place', (p) => {
      const t = norm(p.origin?.city || p.origin?.area);
      if (myOriginTown && t === myOriginTown) return 'From ' + (p.origin?.city || p.origin?.area);
      if (myOriginDistrict && norm(p.origin?.district) === myOriginDistrict) return 'From ' + p.origin?.district + ' district';
      return undefined;
    });
  }
  if (mySchools.size) {
    addImplicit('school', 'Studied at the same place', 'Shared schools & colleges', (p) => {
      const e = p.education.find((x) => mySchools.has(norm(x.institution)));
      return e ? e.institution + (e.from || e.to ? ` (${[e.from, e.to].filter(Boolean).join('–')})` : '') : undefined;
    });
  }
  if (myWork.size) {
    addImplicit('work', 'Worked at the same place', 'Shared workplaces', (p) => {
      const w = p.work.find((x) => myWork.has(norm(x.organization)));
      return w ? w.organization : undefined;
    });
  }
  return groups;
}

function byName(a: ConnectionItem, b: ConnectionItem) {
  return a.person.firstName.localeCompare(b.person.firstName);
}
