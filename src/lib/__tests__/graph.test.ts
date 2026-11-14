import { describe, expect, it } from 'vitest';
import { connectionsOf } from '../connections';
import { FamilyGraph, familyPath, kinship } from '../kinship';
import { emptyPerson } from '../person';
import { labelsFor, layoutFamily, pathEdgeKeys, relationPath } from '../tree';
import type { Gender, Person, Relationship, RelType } from '../types';
import { generatedFamily } from './families';

function build() {
  const list: Person[] = [];
  const add = (id: string, gender: Gender, extra: Partial<Person> = {}) => list.push(emptyPerson({ id, firstName: id, gender, ...extra }));
  const rels: Relationship[] = [];
  let n = 0;
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  add('gf', 'male'); add('gm', 'female');
  add('dad', 'male'); add('mom', 'female');
  add('me', 'male', { address: { city: 'Hyderabad' } });
  add('bro', 'male'); add('wife', 'female'); add('son', 'male'); add('uncle', 'male'); add('cousin', 'female');
  add('pal', 'male'); add('bestie', 'female'); add('palsPal', 'male'); add('boss', 'female'); add('nbr', 'male');
  add('townie', 'female', { address: { city: 'hyderabad' } });
  add('stranger', 'male', { address: { city: 'Delhi' } });
  rel('gf', 'dad', 'parent'); rel('gm', 'dad', 'parent'); rel('gf', 'uncle', 'parent'); rel('gm', 'uncle', 'parent');
  rel('uncle', 'cousin', 'parent');
  rel('dad', 'me', 'parent'); rel('mom', 'me', 'parent'); rel('dad', 'bro', 'parent'); rel('mom', 'bro', 'parent');
  rel('dad', 'mom', 'spouse'); rel('me', 'wife', 'spouse'); rel('me', 'son', 'parent'); rel('wife', 'son', 'parent');
  rel('me', 'pal', 'friend'); rel('me', 'bestie', 'close_friend'); rel('me', 'palsPal', 'acquaintance');
  rel('pal', 'palsPal', 'friend'); rel('me', 'boss', 'colleague'); rel('me', 'nbr', 'neighbor');
  rel('bro', 'pal', 'friend'); // a friend of the family
  return { list, rels, G: new FamilyGraph(new Map(list.map((p) => [p.id, p])), rels) };
}

describe('family only', () => {
  const { list, rels, G } = build();
  it('lists only relatives; old non-family links and shared places are ignored', () => {
    const ids = connectionsOf('me', list, rels, G).flatMap((g) => g.items.map((i) => i.person.id));
    expect(connectionsOf('me', list, rels, G).map((g) => g.key)).toEqual(['family', 'extended']);
    for (const x of ['dad', 'mom', 'bro', 'wife', 'son', 'cousin']) expect(ids).toContain(x);
    for (const x of ['pal', 'bestie', 'palsPal', 'boss', 'nbr', 'townie', 'stranger']) expect(ids).not.toContain(x);
  });
  it('never puts friends in the family graph', () => {
    expect(G.familyComponent('me').has('pal')).toBe(false);
    expect(labelsFor(G, 'me').has('pal')).toBe(false);
    expect(labelsFor(G, 'bro').has('pal')).toBe(false);
    expect(relationPath(G, 'me', 'pal')).toEqual([]);
  });
});

describe('labelsFor and relationPath', () => {
  it('labelsFor equals per-target kinship() for every ego', () => {
    const check = (G: FamilyGraph, ego: string) => {
      const labels = labelsFor(G, ego);
      for (const id of G.familyComponent(ego)) {
        if (id === ego || id.startsWith('~')) continue;
        const k = kinship(G, ego, id);
        expect(labels.get(id), `${ego}→${id}`).toEqual(k ? { label: k.label, path: k.path } : undefined);
      }
    };
    const { G } = build();
    for (const ego of ['me', 'cousin', 'son', 'wife']) check(G, ego);
    const R = generatedFamily(60, 7);
    for (const ego of ['p0', 'p5', 'p17', 'p33', 'p59']) check(R, ego);
  });
  it('relationPath follows familyPath inclusively', () => {
    const { G } = build();
    expect(relationPath(G, 'me', 'me')).toEqual(['me']);
    expect(relationPath(G, 'me', 'dad')).toEqual(['me', 'dad']);
    expect(relationPath(G, 'me', 'cousin')).toEqual(['me', ...familyPath(G, 'me', 'cousin')!.steps.map((s) => s.id)]);
    expect(relationPath(G, 'me', 'cousin')).toHaveLength(4);
    expect(relationPath(G, 'cousin', 'me')).toHaveLength(4);
  });

  it('lights a line for every step of the path, including a step between brothers', () => {
    const { G } = build();
    for (const orient of ['cross', 'down', 'right'] as const) {
      // me → bro is a sibling step: no line of its own, so the parent's lines to both of us light up.
      const L = layoutFamily(G, { focusId: 'me', level: 'everyone', expanded: new Set(['uncle']), orient });
      const ids = relationPath(G, 'me', 'bro');
      expect(ids).toEqual(['me', 'bro']);
      const lit = L.edges.filter((e) => pathEdgeKeys(L.edges, ids).has(e.key));
      expect(lit.some((e) => e.to === 'me'), orient).toBe(true);
      expect(lit.some((e) => e.to === 'bro'), orient).toBe(true);
      expect(new Set(lit.filter((e) => e.to === 'me' || e.to === 'bro').map((e) => e.from)).size).toBe(1);
      // Every step of a longer path has a lit line touching both of its people (or their shared parent).
      const toCousin = relationPath(G, 'me', 'cousin');
      const keys = pathEdgeKeys(L.edges, toCousin);
      for (let i = 1; i < toCousin.length; i++) {
        const [a, b] = [toCousin[i - 1], toCousin[i]];
        const touches = (id: string) => L.edges.some((e) => keys.has(e.key) && (e.from === id || e.to === id));
        expect(touches(a) && touches(b), `${orient} ${a}→${b}`).toBe(true);
      }
    }
  });
});

describe('layoutFamily (temporary adapter)', () => {
  const { G } = build();
  it('returns focus, parents and children with polyline edges', () => {
    const L = layoutFamily(G, { focusId: 'me', level: 'immediate', expanded: new Set() });
    const byPerson = (id: string) => L.nodes.find((x) => x.personId === id);
    expect(byPerson('me')).toMatchObject({ role: 'focus', generation: 0, key: 'focus:me' });
    expect(byPerson('dad')).toMatchObject({ role: 'ancestor', generation: 1 });
    expect(byPerson('mom')?.generation).toBe(1);
    expect(byPerson('gf')?.generation).toBe(2);
    expect(byPerson('son')).toMatchObject({ role: 'descendant', generation: -1 });
    expect(byPerson('wife')?.role).toBe('spouse');
    expect(new Set(L.nodes.map((x) => x.key)).size).toBe(L.nodes.length);
    expect(L.edges.length).toBeGreaterThan(0);
    for (const e of L.edges) expect(e.points.length).toBeGreaterThan(1);
    expect(L.edges.some((e) => e.kind === 'marriage')).toBe(true);
    expect(L.edges.some((e) => e.kind === 'descent')).toBe(true);
    expect(L.bounds.maxX).toBeGreaterThan(L.bounds.minX);
  });
  it('keeps ghost placeholders', () => {
    const L = layoutFamily(G, { focusId: 'son', level: 'immediate', expanded: new Set(), ghosts: true });
    expect(L.nodes.some((x) => x.ghost)).toBe(false); // son has both parents
    const L2 = layoutFamily(G, { focusId: 'wife', level: 'immediate', expanded: new Set(), ghosts: true });
    expect(L2.nodes.filter((x) => x.role === 'ghost').map((x) => x.ghost).sort()).toEqual(['father', 'mother']);
    expect(L2.nodes.find((x) => x.role === 'ghost')?.generation).toBe(1);
  });
});
