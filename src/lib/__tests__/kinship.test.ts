import { describe, expect, it } from 'vitest';
import { FamilyGraph, directLine, kinship, lineageStats, relativesOf } from '../kinship';
import { emptyPerson } from '../person';
import type { Gender, Relationship, RelType } from '../types';
import { expectRelativesMatchKinship } from './families';

function build() {
  const people = new Map<string, ReturnType<typeof emptyPerson>>();
  const add = (id: string, gender: Gender, birth?: string) => people.set(id, emptyPerson({ id, firstName: id, gender, birthDate: birth }));
  const rels: Relationship[] = [];
  let n = 0;
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  // Paternal side
  add('ggf', 'male', '1880');
  add('gf', 'male', '1910'); add('gm', 'female', '1915');
  add('dad', 'male', '1940'); add('mom', 'female', '1945');
  add('uncle', 'male'); add('auntInLaw', 'female'); add('cousin', 'male'); add('cousinKid', 'female');
  add('me', 'male', '1975'); add('wife', 'female'); add('bro', 'male'); add('broWife', 'female');
  add('son', 'male'); add('daughter', 'female'); add('grandson', 'male'); add('nephew', 'male');
  add('fil', 'male'); add('wifeSis', 'female');
  add('mgf', 'male'); add('mUncle', 'male');
  add('halfSis', 'female'); add('stepMom', 'female');
  add('friend', 'male');
  rel('ggf', 'gf', 'parent');
  rel('gf', 'dad', 'parent'); rel('gm', 'dad', 'parent'); rel('gf', 'uncle', 'parent'); rel('gm', 'uncle', 'parent');
  rel('uncle', 'auntInLaw', 'spouse'); rel('uncle', 'cousin', 'parent'); rel('cousin', 'cousinKid', 'parent');
  rel('dad', 'me', 'parent'); rel('mom', 'me', 'parent'); rel('dad', 'bro', 'parent'); rel('mom', 'bro', 'parent');
  rel('dad', 'mom', 'spouse'); rel('me', 'wife', 'spouse'); rel('bro', 'broWife', 'spouse'); rel('bro', 'nephew', 'parent');
  rel('me', 'son', 'parent'); rel('wife', 'son', 'parent'); rel('me', 'daughter', 'parent'); rel('son', 'grandson', 'parent');
  rel('fil', 'wife', 'parent'); rel('fil', 'wifeSis', 'parent');
  rel('mgf', 'mom', 'parent'); rel('mgf', 'mUncle', 'parent');
  rel('dad', 'halfSis', 'parent'); rel('stepMom', 'halfSis', 'parent');
  rel('dad', 'stepMom', 'spouse'); rel('stepMom', 'me', 'parent', 'step');
  rel('me', 'friend', 'friend');
  return new FamilyGraph(people, rels);
}

describe('kinship', () => {
  const G = build();
  it('relativesOf matches per-target kinship for every ego', () => expectRelativesMatchKinship(G));
  const k = (b: string) => kinship(G, 'me', b);
  it('labels blood relatives', () => {
    expect(k('dad')?.label).toBe('Father');
    expect(k('gf')?.label).toBe('Grandfather');
    expect(k('ggf')?.label).toBe('Great-grandfather');
    expect(k('bro')?.label).toBe('Brother');
    expect(k('son')?.label).toBe('Son');
    expect(k('grandson')?.label).toBe('Grandson');
    expect(k('uncle')?.label).toBe('Uncle');
    expect(k('uncle')?.side).toBe('paternal');
    expect(k('mUncle')?.side).toBe('maternal');
    expect(k('nephew')?.label).toBe('Nephew');
    expect(k('cousin')?.label).toBe('First cousin');
    expect(k('cousinKid')?.label).toBe('First cousin once removed');
    expect(k('halfSis')?.label).toBe('Half-sister');
  });
  it('labels in-laws and step relations', () => {
    expect(k('wife')?.label).toBe('Wife');
    expect(k('fil')?.label).toBe('Father-in-law');
    expect(k('wifeSis')?.label).toBe('Sister-in-law');
    expect(k('broWife')?.label).toBe('Sister-in-law');
    expect(k('auntInLaw')?.label).toBe('Aunt (by marriage)');
    expect(k('stepMom')?.label).toBe('Stepmother');
    expect(kinship(G, 'dad', 'wife')?.label).toBe('Daughter-in-law');
  });
  it('describes the path', () => {
    expect(k('cousin')?.path).toBe("Father's brother's son");
    expect(k('fil')?.path).toBe("Wife's father");
  });
  it('excludes friends from the family', () => {
    expect(k('friend')).toBeUndefined();
    expect(relativesOf(G, 'me').some((r) => r.person.id === 'friend')).toBe(false);
  });
  it('works from anyone\'s point of view', () => {
    expect(kinship(G, 'cousin', 'me')?.label).toBe('First cousin');
    expect(kinship(G, 'son', 'dad')?.label).toBe('Grandfather');
    expect(kinship(G, 'nephew', 'me')?.label).toBe('Uncle');
  });
  it('follows direct lines and stats', () => {
    expect(directLine(G, 'me', 'paternal').map((p) => p.id)).toEqual(['dad', 'gf', 'ggf']);
    expect(directLine(G, 'me', 'maternal').map((p) => p.id)).toEqual(['mom']);
    const s = lineageStats(G, 'me');
    expect(s.generationsUp).toBe(3);
    expect(s.generationsDown).toBe(2);
    expect(s.earliest?.id).toBe('ggf');
  });
  it('infers shared parents for explicit siblings', () => {
    const people = ['a', 'b', 'p', 'c'].map((id) => emptyPerson({ id, firstName: id, gender: id === 'b' ? 'female' : 'male' }));
    const rels: Relationship[] = [
      { id: '1', fromId: 'a', toId: 'b', type: 'sibling', createdAt: 0 },
      { id: '2', fromId: 'p', toId: 'a', type: 'parent', createdAt: 0 },
      { id: '3', fromId: 'b', toId: 'c', type: 'parent', createdAt: 0 },
    ];
    const g2 = new FamilyGraph(people, rels);
    expect(kinship(g2, 'a', 'b')?.label).toBe('Sister');
    expect(kinship(g2, 'c', 'p')?.label).toBe('Grandfather');
    expect(kinship(g2, 'a', 'c')?.label).toBe('Nephew');
  });
});
