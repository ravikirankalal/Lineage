import { describe, expect, it } from 'vitest';
import { birthParents, FamilyGraph } from '../kinship';
import { emptyPerson } from '../person';
import type { Gender, Person, Relationship } from '../types';

function tree(parents: [string, Gender, Relationship['subtype']?][]) {
  const people = new Map<string, Person>([['kid', emptyPerson({ id: 'kid', firstName: 'Kid', gender: 'male' })]]);
  const rels: Relationship[] = parents.map(([id, gender, subtype], i) => {
    people.set(id, emptyPerson({ id, firstName: id, gender }));
    return { id: String(i), fromId: id, toId: 'kid', type: 'parent', subtype, createdAt: 0 };
  });
  return birthParents(new FamilyGraph(people, rels), people, 'kid');
}

describe('father and mother already in the tree (Add buttons off)', () => {
  it('none, one or both', () => {
    expect(tree([])).toEqual({});
    const one = tree([['Dad', 'male', 'biological']]);
    expect(one.father?.id).toBe('Dad');
    expect(one.mother).toBeUndefined();
    const both = tree([['Dad', 'male'], ['Mum', 'female', 'adoptive']]);
    expect([both.father?.id, both.mother?.id]).toEqual(['Dad', 'Mum']);
  });
  it('step and foster parents leave the slot free', () => {
    const r = tree([['Step', 'male', 'step'], ['Foster', 'female', 'foster']]);
    expect(r).toEqual({ father: undefined, mother: undefined });
  });
  it('a parent with no gender takes the free slot', () => {
    const r = tree([['Mum', 'female'], ['Someone', 'unknown']]);
    expect([r.father?.id, r.mother?.id]).toEqual(['Someone', 'Mum']);
  });
});
