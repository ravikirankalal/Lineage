import { describe, expect, it } from 'vitest';
import { FamilyGraph, kinship, relativesOf } from '../kinship';
import { emptyPerson } from '../person';
import type { Gender, Relationship, RelType } from '../types';

function family() {
  const people = new Map<string, ReturnType<typeof emptyPerson>>();
  const rels: Relationship[] = [];
  let n = 0;
  const add = (id: string, gender: Gender, birth?: string) =>
    people.set(id, emptyPerson({ id, firstName: id, gender, birthDate: birth }));
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  const graph = () => new FamilyGraph(people, rels);
  return { add, rel, graph };
}

describe('"Relative" fallback uses the path text', () => {
  function g(subtype: 'step' | 'half', gender: Gender = 'female') {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('mom', 'female'); f.add('sib', gender);
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('dad', 'mom', 'spouse');
    f.rel('me', 'sib', 'sibling', subtype);
    return f.graph();
  }
  it('labels a parent\'s view of the child\'s explicit half / step sibling', () => {
    expect(kinship(g('half'), 'dad', 'sib')?.label).toBe("Son's half-sister");
    expect(kinship(g('half'), 'mom', 'sib')?.label).toBe("Son's half-sister");
    expect(kinship(g('step', 'male'), 'dad', 'sib')?.label).toBe("Son's stepbrother");
    expect(kinship(g('step', 'unknown'), 'mom', 'sib')?.label).toBe("Son's stepsibling");
    expect(kinship(g('half'), 'dad', 'sib')?.category).toBe('other');
    expect(kinship(g('half'), 'dad', 'sib')?.blood).toBe(false);
  });
  it('labels the reverse direction from the path too', () => {
    expect(kinship(g('half'), 'sib', 'dad')?.label).toBe("Half-brother's father");
    expect(kinship(g('step'), 'sib', 'mom')?.label).toBe("Stepbrother's mother");
  });
  it('never returns the bare word "Relative"', () => {
    const G = g('step');
    for (const ego of ['me', 'dad', 'mom', 'sib']) {
      for (const r of relativesOf(G, ego)) expect(r.kin.label).not.toBe('Relative');
    }
  });
});

describe('half-sibling edges extend to full siblings', () => {
  function g(bc: 'full' | undefined | 'step' | 'half') {
    const f = family();
    f.add('a', 'male'); f.add('b', 'female'); f.add('c', 'female'); f.add('d', 'male');
    f.rel('a', 'b', 'sibling', 'half');
    f.rel('b', 'c', 'sibling', bc);
    return f.graph();
  }
  it('A–half–B and B–full–C makes A and C half-siblings, both ways', () => {
    for (const st of ['full', undefined] as const) {
      const G = g(st);
      expect(kinship(G, 'a', 'c')?.label).toBe('Half-sister');
      expect(kinship(G, 'c', 'a')?.label).toBe('Half-brother');
      expect(kinship(G, 'a', 'c')?.blood).toBe(true);
      expect(G.siblingsOf('a').find((s) => s.id === 'c')).toEqual({ id: 'c', half: true });
      expect(G.siblingsOf('c').find((s) => s.id === 'a')).toEqual({ id: 'a', half: true });
    }
  });
  it('works when B and C are full siblings through recorded parents', () => {
    const f = family();
    f.add('a', 'male'); f.add('b', 'female'); f.add('c', 'male'); f.add('p', 'male'); f.add('q', 'female');
    f.rel('p', 'b', 'parent'); f.rel('q', 'b', 'parent'); f.rel('p', 'c', 'parent'); f.rel('q', 'c', 'parent');
    f.rel('a', 'b', 'sibling', 'half');
    const G = f.graph();
    expect(kinship(G, 'a', 'c')?.label).toBe('Half-brother');
    expect(kinship(G, 'c', 'a')?.label).toBe('Half-brother');
  });
  it('does not chain step edges or two half edges', () => {
    expect(g('step').siblingsOf('a').map((s) => s.id)).toEqual(['b']);
    expect(g('half').siblingsOf('a').map((s) => s.id)).toEqual(['b']);
    const f = family();
    f.add('a', 'male'); f.add('b', 'female'); f.add('c', 'female');
    f.rel('a', 'b', 'sibling', 'step'); f.rel('b', 'c', 'sibling', 'full');
    expect(f.graph().siblingsOf('a').map((s) => s.id)).toEqual(['b']);
    expect(kinship(f.graph(), 'a', 'c')?.label).toBe("Stepsister's sister");
  });
  it('a recorded full sibling of A is not demoted to half', () => {
    const f = family();
    f.add('a', 'male'); f.add('b', 'female'); f.add('c', 'female'); f.add('p', 'male');
    f.rel('p', 'a', 'parent'); f.rel('p', 'c', 'parent');
    f.rel('a', 'b', 'sibling', 'half'); f.rel('b', 'c', 'sibling', 'full');
    expect(kinship(f.graph(), 'a', 'c')?.label).toBe('Sister');
  });
});

describe('foster siblings', () => {
  function g() {
    const f = family();
    f.add('mom', 'female'); f.add('kid', 'male'); f.add('girl', 'female'); f.add('x', 'unknown'); f.add('bio', 'male');
    f.rel('mom', 'kid', 'parent', 'foster');
    f.rel('mom', 'girl', 'parent', 'foster');
    f.rel('mom', 'x', 'parent', 'foster');
    f.rel('mom', 'bio', 'parent');
    return f.graph();
  }
  it('labels two foster children of the same foster parent', () => {
    const G = g();
    expect(kinship(G, 'kid', 'girl')?.label).toBe('Foster sister');
    expect(kinship(G, 'girl', 'kid')?.label).toBe('Foster brother');
    expect(kinship(G, 'kid', 'x')?.label).toBe('Foster sibling');
    expect(kinship(G, 'kid', 'girl')?.category).toBe('siblings');
    expect(kinship(G, 'kid', 'girl')?.blood).toBe(false);
  });
  it('labels the foster parent\'s own child as a foster sibling', () => {
    const G = g();
    expect(kinship(G, 'kid', 'bio')?.label).toBe('Foster brother');
    expect(kinship(G, 'bio', 'girl')?.label).toBe('Foster sister');
  });
});
