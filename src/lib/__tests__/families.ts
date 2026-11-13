import { expect } from 'vitest';
import { FamilyGraph, kinship, relativesOf, type Relative } from '../kinship';
import { emptyPerson } from '../person';
import type { Gender, Relationship, RelType } from '../types';

/** Shared test families and checks (not a test file itself). */

/** Deterministic PRNG (mulberry32) so generated families are the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random, connected family of `size` people over several generations: couples with children,
 * remarriages, divorces, step/foster/adoptive children, explicit (full/half/step/untyped) siblings
 * without parents, unknown genders, partial or missing birth dates, and some friends.
 */
export function generatedFamily(size: number, seed: number) {
  const { people, rels } = generatedFamilyData(size, seed);
  return new FamilyGraph(people, rels);
}

/** People and relationships of `generatedFamily`. */
export function generatedFamilyData(size: number, seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const people = new Map<string, ReturnType<typeof emptyPerson>>();
  const rels: Relationship[] = [];
  const gen = new Map<string, number>();
  let n = 0;
  const add = (g: number) => {
    const id = 'p' + people.size;
    const gender: Gender = r() < 0.08 ? 'unknown' : r() < 0.5 ? 'male' : 'female';
    const year = 1900 + g * 25 + Math.floor(r() * 15);
    const birthDate = r() < 0.15 ? undefined : r() < 0.4 ? `${year}` : `${year}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`;
    people.set(id, emptyPerson({ id, firstName: id, gender, birthDate }));
    gen.set(id, g);
    return id;
  };
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  const spouses = (id: string) => rels.filter((x) => x.type === 'spouse' && (x.fromId === id || x.toId === id))
    .map((x) => (x.fromId === id ? x.toId : x.fromId));

  const a = add(0); const b = add(0); rel(a, b, 'spouse', 'married');
  while (people.size < size) {
    const ids = [...people.keys()];
    const x = pick(ids);
    const roll = r();
    if (roll < 0.45) {
      // Child of x (and usually of x's spouse); occasionally adoptive/step/foster.
      const c = add(gen.get(x)! + 1);
      const sub = pick(['biological', 'biological', 'biological', undefined, 'adoptive', 'step', 'foster'] as const);
      rel(x, c, 'parent', sub);
      const sp = spouses(x);
      if (sp.length && r() < 0.8) rel(pick(sp), c, 'parent', r() < 0.85 ? sub : 'step');
    } else if (roll < 0.7) {
      const s = add(gen.get(x)!);
      rel(x, s, 'spouse', pick(['married', 'married', 'partner', 'divorced', 'widowed', undefined] as const));
    } else if (roll < 0.85) {
      const s = add(gen.get(x)!);
      rel(x, s, 'sibling', pick([undefined, 'full', 'half', 'step', 'adoptive'] as const));
    } else if (roll < 0.95) {
      // A new parent for x (never creates a cycle: the parent is new).
      const p = add(gen.get(x)! - 1);
      rel(p, x, 'parent', pick(['biological', undefined, 'step'] as const));
    } else {
      const f = add(gen.get(x)!);
      rel(x, f, 'friend');
    }
  }
  return { people, rels };
}

/** relativesOf as it was before the shared path tree: one kinship() (own path search) per target. */
export function relativesReference(graph: FamilyGraph, ego: string): Relative[] {
  const out: Relative[] = [];
  for (const id of graph.familyComponent(ego)) {
    if (id === ego) continue;
    const p = graph.person(id);
    if (!p) continue;
    const kin = kinship(graph, ego, id);
    if (kin) out.push({ person: p, kin });
  }
  out.sort((x, y) => x.kin.degree - y.kin.degree || y.kin.generation - x.kin.generation || x.person.firstName.localeCompare(y.person.firstName));
  return out;
}

/** relativesOf must equal per-target kinship() for each ego (default: everyone), order included. */
export function expectRelativesMatchKinship(graph: FamilyGraph, egos: string[] = [...graph.people.keys()]) {
  for (const ego of egos) {
    const fast = relativesOf(graph, ego).map((r) => [ego, r.person.id, r.kin]);
    const slow = relativesReference(graph, ego).map((r) => [ego, r.person.id, r.kin]);
    expect(fast).toEqual(slow);
  }
}
