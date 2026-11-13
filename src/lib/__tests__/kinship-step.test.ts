import { describe, expect, it } from 'vitest';
import { FamilyGraph, familyPath, kinship, lineageStats, relativesOf } from '../kinship';
import { layoutTree } from '../tree';
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

/** me(dad, mom) plus one explicit sibling edge of the given subtype to `sib`. */
function withExplicitSibling(subtype: 'step' | 'half', gender: Gender = 'female') {
  const f = family();
  f.add('me', 'male'); f.add('dad', 'male'); f.add('mom', 'female'); f.add('sib', gender);
  f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('dad', 'mom', 'spouse');
  f.rel('me', 'sib', 'sibling', subtype);
  return f.graph();
}

describe('explicit step and half siblings', () => {
  it('labels an explicit step-sibling as a stepsister without inheriting my parents', () => {
    const G = withExplicitSibling('step');
    expect(kinship(G, 'me', 'sib')?.label).toBe('Stepsister');
    expect(kinship(G, 'me', 'sib')?.blood).toBe(false);
    expect(kinship(G, 'me', 'sib')?.category).toBe('siblings');
    expect(kinship(G, 'sib', 'me')?.label).toBe('Stepbrother');
    expect(kinship(G, 'dad', 'sib')?.label).not.toBe('Daughter');
    expect(kinship(G, 'sib', 'mom')?.label).not.toBe('Mother');
    expect(G.bloodParents('sib')).toEqual([]);
    expect(kinship(G, 'dad', 'sib')?.path).toBe("Son's stepsister");
  });

  it('uses neutral words for unknown gender', () => {
    const G = withExplicitSibling('step', 'unknown');
    expect(kinship(G, 'me', 'sib')?.label).toBe('Stepsibling');
    const H = withExplicitSibling('half', 'unknown');
    expect(kinship(H, 'me', 'sib')?.label).toBe('Half-sibling');
  });

  it('labels an explicit half-sibling without making them a child of both my parents', () => {
    const G = withExplicitSibling('half');
    expect(kinship(G, 'me', 'sib')?.label).toBe('Half-sister');
    expect(kinship(G, 'sib', 'me')?.label).toBe('Half-brother');
    expect(kinship(G, 'mom', 'sib')?.label).not.toBe('Daughter');
    expect(kinship(G, 'dad', 'sib')?.label).not.toBe('Daughter');
  });

  it('honours an explicit half edge even when the shared parent is recorded', () => {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('mom', 'female'); f.add('sib', 'female');
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('dad', 'sib', 'parent');
    f.rel('me', 'sib', 'sibling', 'half');
    const G = f.graph();
    expect(kinship(G, 'me', 'sib')?.label).toBe('Half-sister');
    expect(kinship(G, 'dad', 'sib')?.label).toBe('Daughter');
  });

  it('keeps step and half siblings in the family, the sibling row and the tree', () => {
    for (const st of ['step', 'half'] as const) {
      const G = withExplicitSibling(st);
      expect(G.familyComponent('me').has('sib')).toBe(true);
      expect(G.siblingsOf('me').map((s) => s.id)).toEqual(['sib']);
      expect(G.siblingsOf('sib').map((s) => s.id)).toEqual(['me']);
      expect(relativesOf(G, 'dad').some((r) => r.person.id === 'sib')).toBe(true);
      const t = layoutTree(G, 'me');
      expect(t.nodes.some((nd) => nd.personId === 'sib' && nd.role === 'sibling')).toBe(true);
    }
  });

  it('still treats full / untyped / adoptive explicit siblings as sharing parents', () => {
    for (const st of ['full', 'adoptive', undefined] as const) {
      const f = family();
      f.add('me', 'male'); f.add('dad', 'male'); f.add('sib', 'female');
      f.rel('dad', 'me', 'parent');
      f.rel('me', 'sib', 'sibling', st);
      const G = f.graph();
      expect(kinship(G, 'me', 'sib')?.label).toBe('Sister');
      expect(kinship(G, 'dad', 'sib')?.label).toBe('Daughter');
    }
  });
});

describe('step-siblings via a step-parent', () => {
  function g() {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('mom', 'female');
    f.add('stepMom', 'female'); f.add('exHusband', 'male'); f.add('ss', 'female'); f.add('sb', 'male');
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent');
    f.rel('dad', 'stepMom', 'spouse');
    f.rel('stepMom', 'ss', 'parent'); f.rel('exHusband', 'ss', 'parent');
    // sb: stepMom's son; no step edge to me, linked only through dad's marriage
    f.rel('stepMom', 'sb', 'parent');
    f.rel('stepMom', 'me', 'parent', 'step');
    return f.graph();
  }
  it('labels my step-mother\'s child from another relationship as a step-sibling', () => {
    const G = g();
    expect(kinship(G, 'me', 'ss')?.label).toBe('Stepsister');
    expect(kinship(G, 'ss', 'me')?.label).toBe('Stepbrother');
    expect(kinship(G, 'me', 'sb')?.label).toBe('Stepbrother');
    expect(kinship(G, 'me', 'ss')?.category).toBe('siblings');
    expect(kinship(G, 'me', 'ss')?.blood).toBe(false);
  });
  it('works through the parent\'s marriage alone (no step-parent edge)', () => {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('stepMom', 'female'); f.add('ss', 'female');
    f.rel('dad', 'me', 'parent'); f.rel('dad', 'stepMom', 'spouse'); f.rel('stepMom', 'ss', 'parent');
    const G = f.graph();
    expect(kinship(G, 'me', 'ss')?.label).toBe('Stepsister');
    expect(kinship(G, 'ss', 'me')?.label).toBe('Stepbrother');
  });
  it('does not call a half-sibling a step-sibling', () => {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('mom', 'female'); f.add('stepMom', 'female'); f.add('hs', 'female');
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent');
    f.rel('dad', 'stepMom', 'spouse'); f.rel('dad', 'hs', 'parent'); f.rel('stepMom', 'hs', 'parent');
    expect(kinship(f.graph(), 'me', 'hs')?.label).toBe('Half-sister');
  });
});

describe('foster relations', () => {
  function g() {
    const f = family();
    f.add('mom', 'female'); f.add('kid', 'male'); f.add('gran', 'female'); f.add('girl', 'female'); f.add('x', 'unknown');
    f.rel('gran', 'mom', 'parent');
    f.rel('mom', 'kid', 'parent', 'foster');
    f.rel('mom', 'girl', 'parent', 'foster');
    f.rel('mom', 'x', 'parent', 'foster');
    return f.graph();
  }
  it('labels both directions as foster', () => {
    const G = g();
    expect(kinship(G, 'kid', 'mom')?.label).toBe('Foster mother');
    expect(kinship(G, 'mom', 'kid')?.label).toBe('Foster son');
    expect(kinship(G, 'mom', 'girl')?.label).toBe('Foster daughter');
    expect(kinship(G, 'mom', 'x')?.label).toBe('Foster child');
    expect(kinship(G, 'mom', 'kid')?.blood).toBe(false);
    expect(kinship(G, 'mom', 'kid')?.category).toBe('children');
    expect(kinship(G, 'kid', 'mom')?.category).toBe('parents');
  });
  it('excludes foster parents from ancestry', () => {
    const G = g();
    expect(G.bloodParents('kid')).toEqual([]);
    expect(kinship(G, 'kid', 'gran')?.label).not.toBe('Grandmother');
    expect(lineageStats(G, 'kid').ancestors).toBe(0);
  });
  it('keeps adoptive parents as legal kin', () => {
    const f = family();
    f.add('mom', 'female'); f.add('kid', 'male'); f.add('gran', 'female');
    f.rel('gran', 'mom', 'parent'); f.rel('mom', 'kid', 'parent', 'adoptive');
    const G = f.graph();
    expect(kinship(G, 'kid', 'mom')?.label).toBe('Adoptive mother');
    expect(kinship(G, 'mom', 'kid')?.label).toBe('Adopted son');
    expect(kinship(G, 'kid', 'gran')?.label).toBe('Grandmother');
  });
});

describe('lineageStats earliest ancestor', () => {
  it('has no earliest ancestor when no ancestor has a birth year', () => {
    const f = family();
    f.add('me', 'male'); f.add('dad', 'male'); f.add('gf', 'male');
    f.rel('gf', 'dad', 'parent'); f.rel('dad', 'me', 'parent');
    expect(lineageStats(f.graph(), 'me').earliest).toBeUndefined();
  });
  it('picks the ancestor with the earliest parseable birth year', () => {
    const f = family();
    f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('gf', 'male'); f.add('son', 'male', '1900');
    f.rel('gf', 'dad', 'parent'); f.rel('dad', 'me', 'parent'); f.rel('me', 'son', 'parent');
    expect(lineageStats(f.graph(), 'me').earliest?.id).toBe('dad');
  });
});

describe('path text', () => {
  it('reads step-siblings naturally', () => {
    const G = withExplicitSibling('step');
    expect(familyPath(G, 'me', 'sib')?.text).toBe('Stepsister');
  });
});
