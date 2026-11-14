import { describe, expect, it } from 'vitest';
import { generationBands, generationLabel } from '../generationBands';
import { FamilyGraph } from '../kinship';
import { emptyPerson } from '../person';
import { layoutFamily } from '../tree';
import type { Gender, Person, Relationship, RelType } from '../types';

function graph() {
  const people = new Map<string, Person>();
  const rels: Relationship[] = [];
  let n = 0;
  const add = (id: string, gender: Gender, birth: string) => people.set(id, emptyPerson({ id, firstName: id, gender, birthDate: birth }));
  const rel = (fromId: string, toId: string, type: RelType) => rels.push({ id: String(n++), fromId, toId, type, createdAt: 0 });
  add('gf', 'male', '1920'); add('dad', 'male', '1950'); add('mom', 'female', '1952'); add('me', 'male', '1980');
  add('sis', 'female', '1982'); add('wife', 'female', '1981'); add('son', 'male', '2010'); add('gson', 'male', '2035');
  rel('gf', 'dad', 'parent'); rel('dad', 'me', 'parent'); rel('mom', 'me', 'parent'); rel('dad', 'sis', 'parent'); rel('mom', 'sis', 'parent');
  rel('me', 'wife', 'spouse'); rel('me', 'son', 'parent'); rel('wife', 'son', 'parent'); rel('son', 'gson', 'parent');
  return new FamilyGraph(people, rels);
}

describe('generation bands', () => {
  it('labels generations relative to the focus', () => {
    expect(generationLabel(0)).toBe('Your generation');
    expect(generationLabel(0, 'Asha')).toBe('Asha’s generation');
    expect([1, 2, 3, 4].map((g) => generationLabel(g))).toEqual(['Parents', 'Grandparents', 'Great-grandparents', '2× great-grandparents']);
    expect([-1, -2, -3, -5].map((g) => generationLabel(g))).toEqual(['Children', 'Grandchildren', 'Great-grandchildren', '3× great-grandchildren']);
  });

  for (const orient of ['down', 'right'] as const) {
    it(`covers every card with its own generation's band (${orient})`, () => {
      const L = layoutFamily(graph(), { focusId: 'me', level: 'everyone', expanded: new Set(), orient });
      const { bands, bounds } = generationBands(L, orient);
      for (const n of L.nodes) {
        const cx = n.x;
        const cy = n.y + 38;
        const hit = bands.filter((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
        expect(hit.map((b) => b.gen), n.key).toEqual([n.generation]);
      }
      // Bands never overlap one another.
      for (const a of bands) for (const b of bands) {
        if (a === b) continue;
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
        expect(overlap, `${a.key} / ${b.key}`).toBe(false);
      }
      expect(bounds.minY).toBeLessThanOrEqual(L.bounds.minY);
      if (orient === 'down') expect(bands.map((b) => b.gen)).toEqual([2, 1, 0, -1, -2]);
    });
  }

  it('splits the cross layout into three regions: father\'s side, siblings & descendants, mother\'s side', () => {
    const L = layoutFamily(graph(), { focusId: 'me', level: 'everyone', expanded: new Set(), orient: 'cross' });
    const { bands, bounds } = generationBands(L, 'cross');
    expect(bands.map((b) => b.region)).toEqual(['father', 'middle', 'mother']);
    expect(bands.map((b) => b.label)).toEqual(['Father’s side', 'Siblings & descendants', 'Mother’s side']);
    const regionOf = (id: string) => {
      const n = L.nodes.find((x) => x.personId === id)!;
      const hit = bands.filter((b) => n.x >= b.x0 && n.x <= b.x1);
      expect(hit, id).toHaveLength(1);
      return hit[0].region;
    };
    for (const id of ['dad', 'gf']) expect(regionOf(id)).toBe('father');
    for (const id of ['me', 'sis', 'wife', 'son', 'gson']) expect(regionOf(id)).toBe('middle');
    expect(regionOf('mom')).toBe('mother');
    // Regions touch without overlapping, and each card column has a title.
    expect(bands[0].x1).toBe(bands[1].x0);
    expect(bands[1].x1).toBe(bands[2].x0);
    expect(bands[1].columns!.map((c) => c.label)).toEqual(['Siblings · spouses', 'Children', 'Grandchildren']);
    expect(bands[0].columns!.map((c) => c.label)).toEqual(['Grandparents', 'Parents']);
    expect(bands[2].columns!.map((c) => c.label)).toEqual(['Parents']);
    expect(bounds.minY).toBeLessThan(L.bounds.minY);
  });
});
