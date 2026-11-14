import { describe, expect, it } from 'vitest';
import { socialGraph } from '../connections';
import { FamilyGraph, familyPath, kinship } from '../kinship';
import { emptyPerson } from '../person';
import { labelsFor, layoutFamily, relationPath } from '../tree';
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

describe('socialGraph', () => {
  const { list, rels, G } = build();
  const sg = socialGraph('me', list, rels, G);
  const node = (id: string) => sg.nodes.find((x) => x.id === id);
  it('puts people in rings and groups', () => {
    expect(sg.centerId).toBe('me');
    expect(node('me')?.ring).toBe(0);
    expect(node('dad')).toMatchObject({ ring: 1, group: 'family', label: 'Father' });
    expect(node('wife')?.ring).toBe(1);
    expect(node('bestie')).toMatchObject({ ring: 1, group: 'close_friend' });
    expect(node('cousin')).toMatchObject({ ring: 2, group: 'extended' });
    expect(node('pal')).toMatchObject({ ring: 2, group: 'friend' });
    expect(node('boss')).toMatchObject({ ring: 2, group: 'colleague' });
    expect(node('palsPal')).toMatchObject({ ring: 3, group: 'acquaintance' });
    expect(node('nbr')).toMatchObject({ ring: 3, group: 'neighbor' });
    expect(node('townie')).toMatchObject({ ring: 4, group: 'city' });
    expect(node('stranger')).toBeUndefined();
    expect(new Set(sg.nodes.map((x) => x.id)).size).toBe(sg.nodes.length);
  });
  it('links the centre to every node and includes edges between connections', () => {
    for (const x of sg.nodes) if (x.id !== 'me') expect(sg.edges.some((e) => e.a === 'me' && e.b === x.id)).toBe(true);
    expect(sg.edges.find((e) => e.a === 'me' && e.b === 'dad')?.kind).toBe('family');
    expect(sg.edges.find((e) => e.a === 'me' && e.b === 'pal')?.kind).toBe('social');
    expect(sg.edges.find((e) => e.a === 'me' && e.b === 'townie')?.kind).toBe('implicit');
    expect(sg.edges.some((e) => e.kind === 'social' && [e.a, e.b].sort().join() === 'pal,palsPal')).toBe(true);
    expect(sg.edges.some((e) => e.kind === 'social' && [e.a, e.b].sort().join() === 'bro,pal')).toBe(true);
    expect(sg.edges.some((e) => e.kind === 'family' && [e.a, e.b].sort().join() === 'dad,mom')).toBe(true);
    expect(sg.nodes.some((x) => x.id.startsWith('~'))).toBe(false);
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
