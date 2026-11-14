import { describe, expect, it } from 'vitest';
import type { Kinship, Relative } from '../kinship';
import { emptyPerson } from '../person';
import { subgroupRelatives } from '../relativeGroups';

const rel = (id: string, kin: Partial<Kinship>): Relative => ({
  person: emptyPerson({ id, firstName: id }),
  kin: { label: 'Uncle', path: '', category: 'uncles', generation: 2, degree: 3, blood: true, ...kin },
});

describe('subgroupRelatives', () => {
  it('keeps small or non-subgrouped categories whole', () => {
    expect(subgroupRelatives('uncles', [rel('a', {}), rel('b', {})])).toHaveLength(1);
    const many = Array.from({ length: 8 }, (_, i) => rel('s' + i, { category: 'siblings', label: 'Brother' }));
    expect(subgroupRelatives('siblings', many)).toEqual([{ key: 'all', title: '', items: many }]);
  });

  it('splits uncles by generation, then side, with by-marriage after blood', () => {
    const list = [
      rel('u1', { side: 'maternal' }),
      rel('u2', { side: 'paternal' }),
      rel('u3', { side: 'paternal', label: 'Aunt (by marriage)', blood: false }),
      rel('g1', { side: 'paternal', generation: 3, label: 'Great-uncle' }),
      rel('u4', { side: 'paternal' }),
      rel('g2', { side: 'maternal', generation: 3, label: 'Great-aunt' }),
    ];
    const groups = subgroupRelatives('uncles', list);
    expect(groups.map((g) => g.title)).toEqual([
      "Uncles & aunts · Father's side",
      "Uncles & aunts · Father's side · by marriage",
      "Uncles & aunts · Mother's side",
      "Great-uncles & aunts · Father's side",
      "Great-uncles & aunts · Mother's side",
    ]);
    expect(groups[0].items.map((r) => r.person.id)).toEqual(['u2', 'u4']);
    expect(groups.flatMap((g) => g.items)).toHaveLength(list.length);
  });

  it('splits cousins by kind (closest first), then side', () => {
    const c = (id: string, label: string, degree: number, side?: 'paternal' | 'maternal') =>
      rel(id, { category: 'cousins', label, degree, side, generation: 0 });
    const list = [
      c('a', 'Second cousin', 7, 'paternal'),
      c('b', 'First cousin', 5, 'maternal'),
      c('c', 'First cousin', 5, 'paternal'),
      c('d', 'First cousin once removed', 6, 'paternal'),
      c('e', 'First cousin', 5, 'paternal'),
      c('f', 'Second cousin', 7, 'paternal'),
    ];
    expect(subgroupRelatives('cousins', list).map((g) => g.title)).toEqual([
      "First cousins · Father's side",
      "First cousins · Mother's side",
      "First cousins once removed · Father's side",
      "Second cousins · Father's side",
    ]);
  });
});
