import { describe, expect, it } from 'vitest';
import { CARD, type TreeLayout, type TreeLevel, type TreeOrient } from '../graph/contract';
import { FamilyGraph } from '../kinship';
import { emptyPerson } from '../person';
import { layoutFamily } from '../tree';
import type { Gender, Person, Relationship, RelType } from '../types';
import { generatedFamily } from './families';

function family() {
  const people = new Map<string, Person>();
  const rels: Relationship[] = [];
  let n = 0;
  const add = (id: string, gender: Gender, birth?: string) => people.set(id, emptyPerson({ id, firstName: id, gender, birthDate: birth }));
  const rel = (fromId: string, toId: string, type: RelType, subtype?: Relationship['subtype']) =>
    rels.push({ id: String(n++), fromId, toId, type, subtype, createdAt: 0 });
  return { add, rel, graph: () => new FamilyGraph(people, rels) };
}

const lay = (G: FamilyGraph, focusId: string, level: TreeLevel = 'immediate', expanded: string[] = [], ghosts = false, orient: TreeOrient = 'down') =>
  layoutFamily(G, { focusId, level, expanded: new Set(expanded), ghosts, orient });

/** Cards never overlap; edges never pass through the inside of a card. */
function checkGeometry(L: TreeLayout, label: string) {
  const rects = L.nodes.map((n) => ({ n, l: n.x - CARD.w / 2, r: n.x + CARD.w / 2, t: n.y, b: n.y + CARD.h }));
  const byRow = new Map<number, typeof rects>();
  for (const r of rects) {
    const list = byRow.get(r.t) ?? [];
    list.push(r);
    byRow.set(r.t, list);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.l - b.l);
    for (let i = 1; i < list.length; i++) {
      if (list[i].l < list[i - 1].r - 0.01) throw new Error(`${label}: ${list[i - 1].n.key} overlaps ${list[i].n.key}`);
    }
  }
  for (const e of L.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [x1, y1] = e.points[i - 1];
      const [x2, y2] = e.points[i];
      for (const r of rects) {
        // Shrink by 1 so lines that end on a card's border don't count.
        const l = r.l + 1, rr = r.r - 1, t = r.t + 1, b = r.b - 1;
        const hit = x1 === x2
          ? x1 > l && x1 < rr && Math.max(y1, y2) > t && Math.min(y1, y2) < b
          : y1 > t && y1 < b && Math.max(x1, x2) > l && Math.min(x1, x2) < rr;
        if (hit) throw new Error(`${label}: edge ${e.key} passes through ${r.n.key}`);
      }
    }
  }
  expect(new Set(L.nodes.map((n) => n.key)).size).toBe(L.nodes.length);
  // Every person is drawn once in full (repeats are stubs pointing at the full card).
  const full = L.nodes.filter((n) => n.personId && !n.dupOf).map((n) => n.personId);
  expect(new Set(full).size).toBe(full.length);
  const keys = new Set(L.nodes.map((n) => n.key));
  for (const n of L.nodes) if (n.dupOf) expect(keys.has(n.dupOf)).toBe(true);
}

/** dad married mom (me, sis) and later stepmom (halfBro); mom remarried (halfSis). */
function remarried() {
  const f = family();
  f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952'); f.add('stepmom', 'female', '1955'); f.add('mom2', 'male', '1949');
  f.add('me', 'male', '1980'); f.add('sis', 'female', '1978'); f.add('halfBro', 'male', '1990'); f.add('halfSis', 'female', '1992');
  f.add('gf', 'male', '1920'); f.add('gm', 'female', '1922'); f.add('uncle', 'male', '1948'); f.add('aunty', 'female', '1950'); f.add('cousin', 'female', '1975');
  f.add('wife', 'female', '1981'); f.add('wifeDad', 'male', '1955'); f.add('wifeMom', 'female', '1957'); f.add('wifeBro', 'male', '1984'); f.add('son', 'male', '2010'); f.add('sisHusband', 'male', '1976'); f.add('shDad', 'male', '1950'); f.add('shMom', 'female', '1952'); f.add('smDad', 'male', '1930'); f.add('niece', 'female', '2005');
  f.rel('dad', 'mom', 'spouse', 'divorced'); f.rel('dad', 'stepmom', 'spouse'); f.rel('mom', 'mom2', 'spouse');
  for (const c of ['me', 'sis']) { f.rel('dad', c, 'parent'); f.rel('mom', c, 'parent'); }
  f.rel('dad', 'halfBro', 'parent'); f.rel('stepmom', 'halfBro', 'parent');
  f.rel('mom', 'halfSis', 'parent'); f.rel('mom2', 'halfSis', 'parent');
  for (const c of ['dad', 'uncle']) { f.rel('gf', c, 'parent'); f.rel('gm', c, 'parent'); }
  f.rel('uncle', 'aunty', 'spouse'); f.rel('uncle', 'cousin', 'parent'); f.rel('aunty', 'cousin', 'parent');
  f.rel('wifeDad', 'wifeMom', 'spouse'); for (const c of ['wife', 'wifeBro']) { f.rel('wifeDad', c, 'parent'); f.rel('wifeMom', c, 'parent'); }
  f.rel('me', 'wife', 'spouse'); f.rel('me', 'son', 'parent'); f.rel('wife', 'son', 'parent');
  f.rel('shDad', 'shMom', 'spouse'); f.rel('shDad', 'sisHusband', 'parent'); f.rel('shMom', 'sisHusband', 'parent');
  f.rel('smDad', 'stepmom', 'parent');
  f.rel('sis', 'sisHusband', 'spouse'); f.rel('sis', 'niece', 'parent'); f.rel('sisHusband', 'niece', 'parent');
  return f.graph();
}

describe('layoutFamily', () => {
  it('gives each marriage its own child bar', () => {
    const L = lay(remarried(), 'me');
    checkGeometry(L, 'remarried');
    const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
    for (const id of ['dad', 'mom', 'stepmom', 'mom2', 'halfBro', 'halfSis']) expect(at(id), id).toBeDefined();
    expect(at('halfBro').half).toBe(true);
    expect(at('halfSis').half).toBe(true);
    expect(at('sis').half).toBeUndefined();
    // halfBro's line starts between dad and stepmom, mine between dad and mom.
    const start = (from: string, to: string) => L.edges.find((e) => e.kind === 'descent' && e.from === from && e.to === to)!.points[0][0];
    expect(start('dad', 'me')).toBeCloseTo((at('dad').x + at('mom').x) / 2);
    expect(start('dad', 'halfBro')).toBeCloseTo((at('dad').x + at('stepmom').x) / 2);
    expect(start('mom', 'halfSis')).toBeCloseTo((at('mom').x + at('mom2').x) / 2);
    expect(L.edges.some((e) => e.kind === 'divorced' && [e.from, e.to].sort().join() === 'dad,mom')).toBe(true);
    // Order: stepmom dad mom mom2.
    expect(at('stepmom').x < at('dad').x && at('dad').x < at('mom').x && at('mom').x < at('mom2').x).toBe(true);
  });

  it('keeps sibling order independent of the focus', () => {
    const G = remarried();
    const order = (focus: string) => lay(G, focus).nodes.filter((n) => n.generation === (focus === 'me' || focus === 'sis' ? 0 : 0) && ['me', 'sis'].includes(n.personId ?? '')).sort((a, b) => a.x - b.x).map((n) => n.personId);
    expect(order('me')).toEqual(['sis', 'me']);
    expect(order('sis')).toEqual(['sis', 'me']);
  });

  it('shows more family at each level', () => {
    const G = remarried();
    const ids = (level: TreeLevel) => new Set(lay(G, 'me', level).nodes.map((n) => n.personId));
    const imm = ids('immediate');
    const ext = ids('extended');
    const all = ids('everyone');
    for (const id of ['me', 'wife', 'son', 'sis', 'dad', 'mom', 'gf', 'gm']) expect(imm.has(id), id).toBe(true);
    for (const id of ['uncle', 'cousin', 'sisHusband', 'niece']) expect(imm.has(id), id).toBe(false);
    for (const id of ['uncle', 'aunty', 'cousin', 'sisHusband', 'niece']) expect(ext.has(id), id).toBe(true);
    for (const id of ext) expect(all.has(id)).toBe(true);
    for (const level of ['immediate', 'extended', 'everyone'] as const) checkGeometry(lay(G, 'me', level), level);
  });

  it("shows the spouse's parents in Everyone, and on request elsewhere", () => {
    const G = remarried();
    const all = lay(G, 'me', 'everyone');
    checkGeometry(all, 'in-laws');
    const at = (L: TreeLayout, id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf);
    for (const id of ['wifeDad', 'wifeMom']) expect(at(all, id)).toMatchObject({ generation: 1, role: 'relative' });
    expect(all.edges.some((e) => e.kind === 'descent' && e.from === 'wifeDad' && e.to === 'wife')).toBe(true);
    expect(at(all, 'wifeBro')).toBeUndefined(); // only the parents, not the spouse's siblings
    const imm = lay(G, 'me');
    expect(at(imm, 'wifeDad')).toBeUndefined();
    expect(at(imm, 'wife')?.expandable?.up).toBe(true);
    const opened = lay(G, 'me', 'immediate', ['wife']);
    checkGeometry(opened, 'in-laws expanded');
    expect(at(opened, 'wifeMom')?.generation).toBe(1);
    // From the wife's side, her parents are her own ancestors and I am the in-law.
    expect(at(lay(G, 'wife', 'everyone'), 'wifeDad')?.role).toBe('ancestor');
  });

  it("shows every in-law's parents in Everyone, and on request elsewhere", () => {
    const G = remarried();
    const at = (L: TreeLayout, id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf);
    const all = lay(G, 'me', 'everyone');
    checkGeometry(all, 'all in-laws');
    for (const id of ['shDad', 'shMom']) expect(at(all, id)).toMatchObject({ generation: 1, role: 'relative' });
    expect(at(all, 'smDad')).toMatchObject({ generation: 2, role: 'relative' }); // the stepmother's father
    expect(all.edges.some((e) => e.from === 'shMom' && e.to === 'sisHusband')).toBe(true);
    const ext = lay(G, 'me', 'extended');
    expect(at(ext, 'shDad')).toBeUndefined();
    expect(at(ext, 'sisHusband')?.expandable?.up).toBe(true);
    expect(at(ext, 'stepmom')?.expandable?.up).toBe(true);
    const opened = lay(G, 'me', 'extended', ['sisHusband']);
    checkGeometry(opened, 'sister-in-law family expanded');
    expect(at(opened, 'shMom')?.generation).toBe(1);
    expect(at(opened, 'sisHusband')?.expanded).toBe(true);
  });

  it('lays generations out left to right when asked', () => {
    const G = remarried();
    const L = lay(G, 'me', 'everyone', [], false, 'right');
    checkGeometry(L, 'right');
    const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
    expect(at('dad').x).toBeLessThan(at('me').x); // ancestors on the left
    expect(at('son').x).toBeGreaterThan(at('me').x); // descendants on the right
    expect(at('sis').x).toBe(at('me').x); // siblings share a column
    expect(at('sis').y).toBeLessThan(at('me').y); // older first, stacked downwards
    // Same people and edges as the top-down layout, with the same keys.
    const D = lay(G, 'me', 'everyone');
    expect(L.nodes.map((n) => n.key).sort()).toEqual(D.nodes.map((n) => n.key).sort());
    expect(L.edges.length).toBe(D.edges.length);
    // Taller than wide for a family that is wide top-down.
    const w = (x: TreeLayout) => x.bounds.maxX - x.bounds.minX;
    const h = (x: TreeLayout) => x.bounds.maxY - x.bounds.minY;
    expect(h(L) / w(L)).toBeGreaterThan(h(D) / w(D));
  });

  it('cross layout: father left, mother right, brothers up, sisters down, children between', () => {
    const f = family();
    f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
    f.add('bro', 'male', '1975'); f.add('bro2', 'male', '1985'); f.add('sis', 'female', '1978'); f.add('sis2', 'female', '1990');
    f.add('wife', 'female', '1981'); f.add('son', 'male', '2010'); f.add('dau', 'female', '2012');
    f.add('broWife', 'female', '1976'); f.add('nephew', 'male', '2001');
    f.add('dgf', 'male', '1920'); f.add('dgm', 'female', '1922'); f.add('mgf', 'male', '1925'); f.add('mgm', 'female', '1927');
    f.add('uncle', 'male', '1948'); f.add('aunt', 'female', '1955'); f.add('mUncle', 'male', '1950'); f.add('mAunt', 'female', '1958');
    for (const c of ['me', 'bro', 'bro2', 'sis', 'sis2']) { f.rel('dad', c, 'parent'); f.rel('mom', c, 'parent'); }
    for (const c of ['dad', 'uncle', 'aunt']) { f.rel('dgf', c, 'parent'); f.rel('dgm', c, 'parent'); }
    for (const c of ['mom', 'mUncle', 'mAunt']) { f.rel('mgf', c, 'parent'); f.rel('mgm', c, 'parent'); }
    f.rel('dad', 'mom', 'spouse'); f.rel('dgf', 'dgm', 'spouse'); f.rel('mgf', 'mgm', 'spouse');
    f.rel('me', 'wife', 'spouse'); f.rel('me', 'son', 'parent'); f.rel('wife', 'son', 'parent'); f.rel('me', 'dau', 'parent'); f.rel('wife', 'dau', 'parent');
    f.rel('bro', 'broWife', 'spouse'); f.rel('bro', 'nephew', 'parent'); f.rel('broWife', 'nephew', 'parent');
    const G = f.graph();
    for (const level of ['immediate', 'extended', 'everyone'] as const) checkGeometry(lay(G, 'me', level, [], true, 'cross'), `cross ${level}`);
    const L = lay(G, 'me', 'extended', [], false, 'cross');
    const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
    const me = at('me');
    expect([me.x, me.y]).toEqual([0, 0]);
    // Brothers above (oldest first), sisters below (oldest first), all in my column.
    for (const id of ['bro', 'bro2', 'sis', 'sis2']) expect(at(id).x, id).toBe(0);
    expect(at('bro').y).toBeLessThan(at('bro2').y);
    expect(at('bro2').y).toBeLessThan(0);
    expect(at('sis').y).toBeGreaterThan(0);
    expect(at('sis').y).toBeLessThan(at('sis2').y);
    // Children between me and my wife, each level with the family.
    expect(at('son').x).toBeGreaterThan(0);
    expect(at('wife').x).toBeGreaterThan(at('son').x);
    expect(at('wife').y).toBe(0);
    expect(at('son').y).toBe(0);
    expect(at('dau').y).toBeGreaterThan(0);
    expect(at('dau').y).toBeLessThan(at('sis').y);
    expect(at('nephew').x).toBe(at('son').x);
    expect(at('broWife').x).toBe(at('wife').x);
    expect(at('broWife').y).toBe(at('bro').y);
    // Father's side left, mother's side right; grandparents one column further out.
    expect(at('dad').x).toBeLessThan(0);
    expect(at('mom').x).toBeGreaterThan(at('wife').x);
    expect(at('dgf').x).toBeLessThan(at('dad').x);
    expect(at('mgf').x).toBeGreaterThan(at('mom').x);
    expect(at('dgf').y).toBeLessThan(at('dgm').y);
    // Each ancestor's brothers above them and sisters below (extended: the parents' siblings).
    expect(at('uncle').x).toBe(at('dad').x);
    expect(at('uncle').y).toBeLessThan(at('dad').y);
    expect(at('aunt').y).toBeGreaterThan(at('dad').y);
    expect(at('mUncle').y).toBeLessThan(at('mom').y);
    expect(at('mAunt').y).toBeGreaterThan(at('mom').y);
    // A couple with children has no separate husband–wife line (the children's lines join them).
    expect(L.edges.some((e) => [e.from, e.to].sort().join() === 'me,wife')).toBe(false);
    expect(L.edges.some((e) => [e.from, e.to].sort().join() === 'bro,broWife')).toBe(false);
    // Every parent-child link is drawn.
    for (const [a, b] of [['dad', 'me'], ['mom', 'me'], ['me', 'son'], ['wife', 'son'], ['dgf', 'dad'], ['mgm', 'mom']]) {
      expect(L.edges.some((e) => e.from === a && e.to === b), `${a}→${b}`).toBe(true);
    }
    // Immediate: siblings without their families, no uncles.
    const imm = lay(G, 'me', 'immediate', [], false, 'cross');
    expect(imm.nodes.some((n) => n.personId === 'broWife' || n.personId === 'uncle')).toBe(false);
    expect(imm.nodes.find((n) => n.personId === 'bro')?.expandable?.down).toBe(true);
    expect(lay(G, 'me', 'immediate', ['bro'], false, 'cross').nodes.some((n) => n.personId === 'nephew')).toBe(true);
  });

  it('expands a card on request', () => {
    const G = remarried();
    const L = lay(G, 'me');
    expect(L.nodes.find((n) => n.personId === 'sis')?.expandable?.down).toBe(true);
    const L2 = lay(G, 'me', 'immediate', ['sis']);
    expect(L2.nodes.find((n) => n.personId === 'sis')).toMatchObject({ expanded: true, expandable: { down: true } });
    expect(L2.nodes.some((n) => n.personId === 'niece')).toBe(true);
    checkGeometry(L2, 'expanded');
    // gf is outer-left: his siblings can be opened; grandparents' parents are past the edge.
    expect(L.nodes.find((n) => n.personId === 'dad')?.expandable?.side).toBe(true);
  });

  it('draws ghosts for missing parents', () => {
    const G = remarried();
    const L = lay(G, 'aunty', 'immediate', [], true);
    expect(L.nodes.filter((n) => n.role === 'ghost').map((n) => n.ghost).sort()).toEqual(['father', 'mother']);
    checkGeometry(L, 'ghosts');
  });

  it('marks cousin marriages with a stub instead of drawing a person twice', () => {
    const f = family();
    f.add('gf', 'male'); f.add('gm', 'female'); f.add('a', 'male'); f.add('b', 'female');
    f.add('aw', 'female'); f.add('bh', 'male'); f.add('x', 'male'); f.add('y', 'female'); f.add('kid', 'male');
    f.rel('gf', 'a', 'parent'); f.rel('gm', 'a', 'parent'); f.rel('gf', 'b', 'parent'); f.rel('gm', 'b', 'parent');
    f.rel('a', 'aw', 'spouse'); f.rel('b', 'bh', 'spouse');
    f.rel('a', 'x', 'parent'); f.rel('aw', 'x', 'parent'); f.rel('b', 'y', 'parent'); f.rel('bh', 'y', 'parent');
    f.rel('x', 'y', 'spouse'); f.rel('x', 'kid', 'parent'); f.rel('y', 'kid', 'parent');
    const G = f.graph();
    for (const level of ['immediate', 'extended', 'everyone'] as const) for (const focus of ['kid', 'x', 'y', 'a']) {
      const L = lay(G, focus, level);
      checkGeometry(L, `${focus}/${level}`);
      expect(L.nodes.find((n) => n.role === 'focus')?.personId).toBe(focus);
    }
    expect(lay(G, 'kid').nodes.some((n) => n.dupOf)).toBe(true); // gf/gm reached through both parents
  });

  it('never overlaps on generated families, for every focus and level', () => {
    for (const seed of [1, 2, 3]) {
      const G = generatedFamily(140, seed);
      for (const id of G.people.keys()) {
        for (const level of ['immediate', 'extended', 'everyone'] as const) {
          for (const orient of ['down', 'right', 'cross'] as const) {
            const L = lay(G, id, level, [], true, orient);
            checkGeometry(L, `seed ${seed} ${id} ${level} ${orient}`);
            const focus = L.nodes.find((n) => n.personId === id && !n.dupOf);
            expect(focus?.role).toBe('focus');
            if (orient === 'down') expect(focus?.x).toBe(0);
            else if (orient === 'right') expect(focus!.y + CARD.h / 2).toBe(0);
            else expect([focus!.x, focus!.y]).toEqual([0, 0]);
          }
        }
      }
    }
  });

  it('is fast on 1,000 people', () => {
    const G = generatedFamily(1000, 7);
    const ids = [...G.people.keys()].slice(0, 20);
    const t0 = performance.now();
    for (const id of ids) lay(G, id, 'extended');
    const per = (performance.now() - t0) / ids.length;
    expect(per).toBeLessThan(30);
  });
});
