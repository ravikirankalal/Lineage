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
    // The main tree has only the parents; the spouse's siblings are drawn in an extra tree below it.
    expect(at(all, 'wifeBro')?.key.startsWith('t')).toBe(true);
    expect(at(all, 'wifeBro')!.y).toBeGreaterThan(Math.max(...all.nodes.filter((n) => !n.key.includes('/')).map((n) => n.y)));
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

  it('cross layout: father left, mother right, brothers up, sisters down, spouses below, no children', () => {
    const f = family();
    f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
    f.add('bro', 'male', '1975'); f.add('bro2', 'male', '1985'); f.add('sis', 'female', '1978'); f.add('sis2', 'female', '1990');
    f.add('wife', 'female', '1981'); f.add('son', 'male', '2010'); f.add('dau', 'female', '2012');
    f.add('broWife', 'female', '1976'); f.add('nephew', 'male', '2001');
    f.add('dgf', 'male', '1920'); f.add('dgm', 'female', '1922'); f.add('mgf', 'male', '1925'); f.add('mgm', 'female', '1927');
    f.add('uncle', 'male', '1948'); f.add('aunt', 'female', '1955'); f.add('mUncle', 'male', '1950'); f.add('mAunt', 'female', '1958');
    f.add('cousin', 'male', '1979'); f.add('cousin2', 'female', '1983'); f.add('mCousin', 'female', '1984'); f.add('grandson', 'male', '2035');
    for (const c of ['me', 'bro', 'bro2', 'sis', 'sis2']) { f.rel('dad', c, 'parent'); f.rel('mom', c, 'parent'); }
    for (const c of ['dad', 'uncle', 'aunt']) { f.rel('dgf', c, 'parent'); f.rel('dgm', c, 'parent'); }
    for (const c of ['mom', 'mUncle', 'mAunt']) { f.rel('mgf', c, 'parent'); f.rel('mgm', c, 'parent'); }
    f.rel('dad', 'mom', 'spouse'); f.rel('dgf', 'dgm', 'spouse'); f.rel('mgf', 'mgm', 'spouse');
    f.rel('me', 'wife', 'spouse'); f.rel('me', 'son', 'parent'); f.rel('wife', 'son', 'parent'); f.rel('me', 'dau', 'parent'); f.rel('wife', 'dau', 'parent');
    f.rel('uncle', 'cousin', 'parent'); f.rel('uncle', 'cousin2', 'parent'); f.rel('mAunt', 'mCousin', 'parent'); f.rel('son', 'grandson', 'parent');
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
    // Each spouse directly below their partner in the same column.
    expect(at('wife').x).toBe(0);
    expect(at('wife').y).toBeGreaterThan(0);
    expect(at('wife').y).toBeLessThan(at('sis').y);
    expect(at('broWife').x).toBe(0);
    expect(at('broWife').y).toBeGreaterThan(at('bro').y);
    expect(at('broWife').y).toBeLessThan(at('bro2').y);
    // No children or grandchildren in this view (the owner removed them).
    for (const id of ['son', 'dau', 'nephew', 'grandson']) expect(L.nodes.some((n) => n.personId === id), id).toBe(false);
    // Father's side left, mother's side right; grandparents one column further out.
    expect(at('dad').x).toBeLessThan(0);
    expect(at('mom').x).toBeGreaterThan(0);
    expect(at('dgf').x).toBeLessThan(at('dad').x);
    expect(at('mgf').x).toBeGreaterThan(at('mom').x);
    expect(at('dgf').y).toBeLessThan(at('dgm').y);
    // Each ancestor's brothers above them and sisters below (extended: the parents' siblings).
    expect(at('uncle').x).toBe(at('dad').x);
    expect(at('uncle').y).toBeLessThan(at('dad').y);
    expect(at('aunt').y).toBeGreaterThan(at('dad').y);
    expect(at('mUncle').y).toBeLessThan(at('mom').y);
    expect(at('mAunt').y).toBeGreaterThan(at('mom').y);
    // A short marriage line joins each couple.
    expect(L.edges.some((e) => e.kind === 'marriage' && [e.from, e.to].sort().join() === 'me,wife')).toBe(true);
    expect(L.edges.some((e) => e.kind === 'marriage' && [e.from, e.to].sort().join() === 'bro,broWife')).toBe(true);
    // Both parents sit level with me; the father's lines reach me and my siblings on the LEFT of our column,
    // the mother's on the RIGHT; neither ends at a spouse.
    expect(at('dad').y).toBe(0);
    expect(at('mom').y).toBe(0);
    for (const [par, sign] of [['dad', -1], ['mom', 1]] as const) {
      for (const e of L.edges.filter((x) => x.from === par && ['me', 'bro', 'bro2', 'sis', 'sis2'].includes(x.to))) {
        const end = e.points[e.points.length - 1];
        expect(Math.sign(end[0]), `${par}→${e.to}`).toBe(sign);
        expect(end[1]).toBe(at(e.to).y + CARD.h / 2);
      }
    }
    // Both lines run straight across at the parent's row, even past the cousins: nothing goes overhead.
    for (const lvl of ['immediate', 'extended', 'everyone'] as const) {
      const M = lay(G, 'me', lvl, [], false, 'cross');
      for (const par of ['dad', 'mom']) {
        const e = M.edges.find((x) => x.from === par && x.to === 'me')!;
        expect(Math.min(...e.points.map((q) => q[1])), `${lvl} ${par}`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(L.edges.some((e) => (e.from === 'dad' || e.from === 'mom') && (e.to === 'wife' || e.to === 'broWife'))).toBe(false);
    // Every parent-child link is drawn.
    for (const [a, b] of [['dad', 'me'], ['mom', 'me'], ['dgf', 'dad'], ['mgm', 'mom']]) {
      expect(L.edges.some((e) => e.from === a && e.to === b), `${a}→${b}`).toBe(true);
    }
    // Cousins share my column, level with their own parent: an uncle's children above my brothers, an
    // aunt's children below my sisters.
    expect(at('cousin').x).toBe(0);
    expect(at('cousin').y).toBe(at('uncle').y);
    expect(at('cousin2').y).toBeGreaterThan(at('cousin').y);
    expect(at('cousin2').y).toBeLessThan(at('bro').y);
    expect(at('mCousin').x).toBe(0);
    expect(at('mCousin').y).toBe(at('mAunt').y);
    expect(at('mCousin').y).toBeGreaterThan(at('sis2').y);
    expect(at('uncle').y).toBeLessThan(at('dad').y);
    expect(at('mAunt').y).toBeGreaterThan(at('mom').y);
    expect(L.edges.some((e) => e.from === 'uncle' && e.to === 'cousin')).toBe(true);
    expect(L.edges.some((e) => e.from === 'mAunt' && e.to === 'mCousin')).toBe(true);
    // No separate cousins column: everyone of my generation is in my column.
    expect(new Set(L.nodes.filter((n) => n.generation === 0).map((n) => n.x))).toEqual(new Set([0]));
    // Immediate: siblings without their families, no uncles.
    const imm = lay(G, 'me', 'immediate', [], false, 'cross');
    expect(imm.nodes.some((n) => n.personId === 'broWife' || n.personId === 'uncle' || n.personId === 'cousin')).toBe(false);
    expect(imm.nodes.some((n) => n.personId === 'wife')).toBe(true); // my own spouse always shows
    expect(imm.nodes.find((n) => n.personId === 'bro')?.expandable?.down).toBe(true);
    expect(lay(G, 'me', 'immediate', ['bro'], false, 'cross').nodes.some((n) => n.personId === 'broWife')).toBe(true);
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

  it('cross layout: every side column has each spouse right below their partner, with a marriage line', () => {
    const f = family();
    f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952'); f.add('stepmom', 'female', '1956');
    f.add('dgf', 'male', '1920'); f.add('dgm', 'female', '1922'); f.add('uncle', 'male', '1948'); f.add('uncleWife', 'female', '1950');
    f.add('cousin', 'male', '1975'); f.add('mAunt', 'female', '1958'); f.add('mAuntHusband', 'male', '1955');
    f.add('mgf', 'male', '1925'); f.add('mgm', 'female', '1927');
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('dad', 'mom', 'spouse', 'divorced'); f.rel('dad', 'stepmom', 'spouse');
    for (const c of ['dad', 'uncle']) { f.rel('dgf', c, 'parent'); f.rel('dgm', c, 'parent'); }
    for (const c of ['mom', 'mAunt']) { f.rel('mgf', c, 'parent'); f.rel('mgm', c, 'parent'); }
    f.rel('dgf', 'dgm', 'spouse'); f.rel('mgf', 'mgm', 'spouse');
    f.rel('uncle', 'uncleWife', 'spouse'); f.rel('uncle', 'cousin', 'parent'); f.rel('uncleWife', 'cousin', 'parent');
    f.rel('mAunt', 'mAuntHusband', 'spouse');
    f.add('halfBro', 'male', '1990'); f.rel('dad', 'halfBro', 'parent'); f.rel('stepmom', 'halfBro', 'parent');
    // A cousin recorded with only the uncle as parent still shares the couple's single line.
    f.add('cousinB', 'female', '1977'); f.rel('uncle', 'cousinB', 'parent');
    const G = f.graph();
    for (const level of ['immediate', 'extended', 'everyone'] as const) checkGeometry(lay(G, 'me', level, [], false, 'cross'), `spouses ${level}`);
    const L = lay(G, 'me', 'extended', [], false, 'cross');
    const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
    const below = (a: string, b: string) => {
      expect(at(b).x, `${b} under ${a}`).toBe(at(a).x);
      expect(at(b).y, `${b} under ${a}`).toBe(at(a).y + 100);
      expect(L.edges.some((e) => (e.kind === 'marriage' || e.kind === 'divorced') && [e.from, e.to].sort().join() === [a, b].sort().join()), `${a}–${b} line`).toBe(true);
    };
    below('uncle', 'uncleWife'); // an uncle's wife
    below('dad', 'stepmom'); // a parent's other partner (step-parent); mom stays on her own side
    below('mAunt', 'mAuntHusband'); // an aunt's husband
    below('dgf', 'dgm'); // grandparents, one above the other
    below('mgf', 'mgm');
    expect(at('mom').x).toBeGreaterThan(0);
    expect(L.nodes.filter((n) => n.personId === 'mom')).toHaveLength(1);
    expect(at('cousin').y).toBe(at('uncle').y); // cousins still level with their parent
    // A couple's children hang from the middle of their marriage line, one shared line for both parents.
    const fromCouple = (a: string, b: string, kid: string) => {
      const pa = L.edges.find((e) => e.from === a && e.to === kid)?.points;
      const pb = L.edges.find((e) => e.from === b && e.to === kid)?.points;
      expect(pa, `${a}→${kid}`).toBeDefined();
      expect(pb, `${b}→${kid}`).toEqual(pa);
      expect(pa![0][0], `${a}+${b}→${kid} starts on their column`).toBe(at(a).x);
      expect(pa![0][1]).toBeGreaterThan(at(a).y + CARD.h);
      expect(pa![0][1]).toBeLessThan(at(b).y);
    };
    fromCouple('uncle', 'uncleWife', 'cousin');
    const pCousin = L.edges.find((e) => e.from === 'uncle' && e.to === 'cousin')!.points;
    const pCousinB = L.edges.find((e) => e.from === 'uncle' && e.to === 'cousinB')!.points;
    expect(pCousinB[0]).toEqual(pCousin[0]); // same start: the middle of the uncle–wife line, not the uncle's card
    expect(pCousinB[1]).toEqual(pCousin[1]);
    expect(L.edges.some((e) => e.from === 'uncleWife' && e.to === 'cousinB')).toBe(false); // no invented parent link
    fromCouple('dad', 'stepmom', 'halfBro'); // a half-brother from the father and step-mother's line
    expect(L.edges.find((e) => e.from === 'dad' && e.to === 'me')!.points[0][0]).toBe(at('dad').x + CARD.w / 2); // me: from dad's card
    // Immediate: a step-parent still shows below the parent; uncles and their spouses don't.
    const imm = lay(G, 'me', 'immediate', [], false, 'cross');
    expect(imm.nodes.some((n) => n.personId === 'stepmom')).toBe(true);
    expect(imm.nodes.some((n) => n.personId === 'uncleWife')).toBe(false);
  });

  it("cross layout: above the parents each side follows the grandfather's line; grandmothers married in", () => {
    const f = family();
    f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
    f.add('dgf', 'male', '1920'); f.add('dgm', 'female', '1922'); f.add('mgf', 'male', '1925'); f.add('mgm', 'female', '1927');
    for (const [a, b] of [['dgfF', 'dgfM'], ['dgmF', 'dgmM'], ['mgfF', 'mgfM'], ['mgmF', 'mgmM']]) { f.add(a, 'male', '1890'); f.add(b, 'female', '1892'); }
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent');
    f.rel('dgf', 'dad', 'parent'); f.rel('dgm', 'dad', 'parent'); f.rel('mgf', 'mom', 'parent'); f.rel('mgm', 'mom', 'parent');
    for (const [kid, a, b] of [['dgf', 'dgfF', 'dgfM'], ['dgm', 'dgmF', 'dgmM'], ['mgf', 'mgfF', 'mgfM'], ['mgm', 'mgmF', 'mgmM']]) { f.rel(a, kid, 'parent'); f.rel(b, kid, 'parent'); }
    const G = f.graph();
    // (Everyone also draws each grandmother's own family in a tree below: checked further down.)
    for (const level of ['immediate', 'extended'] as const) {
      const L = lay(G, 'me', level, [], false, 'cross');
      checkGeometry(L, `patriline ${level}`);
      const ids = new Set(L.nodes.map((n) => n.personId));
      // Mother's own parents are shown (her side), and each grandfather's parents...
      for (const id of ['mgf', 'mgm', 'dgf', 'dgm', 'dgfF', 'dgfM', 'mgfF', 'mgfM']) expect(ids.has(id), `${level} ${id}`).toBe(true);
      // ...but not the parents of a grandmother, who married into the line.
      for (const id of ['dgmF', 'dgmM', 'mgmF', 'mgmM']) expect(ids.has(id), `${level} ${id}`).toBe(false);
      const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
      for (const [gf, gm] of [['dgf', 'dgm'], ['mgf', 'mgm']]) {
        expect(at(gm).x).toBe(at(gf).x);
        expect(at(gm).y).toBe(at(gf).y + 100); // wife right below her husband
        expect(at(gm).role).toBe('ancestor');
        expect(at(gm).expandable?.up).toBeUndefined();
        expect(L.edges.some((e) => e.from === gm && (e.to === 'dad' || e.to === 'mom'))).toBe(true); // still her child's line
        // ONE line from the couple: both parents' edges to the child follow the same path, starting from the
        // middle of their marriage line (between the two cards), not from each card.
        const child = gf === 'dgf' ? 'dad' : 'mom';
        const fromGf = L.edges.find((e) => e.from === gf && e.to === child)!.points;
        const fromGm = L.edges.find((e) => e.from === gm && e.to === child)!.points;
        expect(fromGm).toEqual(fromGf);
        expect(fromGf[0][0]).toBe(at(gf).x);
        expect(fromGf[0][1]).toBeGreaterThan(at(gf).y + CARD.h);
        expect(fromGf[0][1]).toBeLessThan(at(gm).y);
      }
    }
    // Everyone: the main tree is the same (a grandmother's copy right below her husband), and each
    // grandmother's own parents are drawn in her family's tree further down.
    const E = lay(G, 'me', 'everyone', [], false, 'cross');
    checkGeometry(E, 'patriline everyone');
    for (const [gf, gm, gmDad] of [['dgf', 'dgm', 'dgmF'], ['mgf', 'mgm', 'mgmF']]) {
      const gfCard = E.nodes.find((n) => n.personId === gf && !n.dupOf)!;
      const copy = E.nodes.find((n) => n.personId === gm && n.x === gfCard.x && n.y === gfCard.y + 100);
      expect(copy?.dupOf, `${gm} copy under ${gf}`).toBeDefined();
      const main = E.nodes.find((n) => n.personId === gm && !n.dupOf)!;
      expect(main.y).toBeGreaterThan(gfCard.y + 200);
      expect(E.edges.some((e) => e.from === gmDad && e.to === gm)).toBe(true);
    }
  });

  it('cross layout: with one great-grandparent recorded, the line still starts from their marriage line', () => {
    for (const only of ['ggf', 'ggm']) {
      const f = family();
      f.add('me', 'male', '1980'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
      f.add('gf', 'male', '1920'); f.add('gm', 'female', '1922'); f.add('ggf', 'male', '1890'); f.add('ggm', 'female', '1892');
      f.add('greatUncle', 'male', '1915');
      f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('gf', 'dad', 'parent'); f.rel('gm', 'dad', 'parent');
      f.rel(only, 'gf', 'parent'); f.rel(only, 'greatUncle', 'parent'); f.rel('ggf', 'ggm', 'spouse'); // the other is only the spouse
      const L = lay(f.graph(), 'me', 'everyone', [], false, 'cross');
      checkGeometry(L, `one recorded ${only}`);
      const at = (id: string) => L.nodes.find((n) => n.personId === id && !n.dupOf)!;
      const top = Math.min(at('ggf').y, at('ggm').y);
      for (const kid of ['gf', 'greatUncle']) {
        const start = L.edges.find((e) => e.from === only && e.to === kid)!.points[0];
        expect(start[0], `${only}→${kid}`).toBe(at('ggf').x); // from the marriage line, not a card's side
        expect(start[1]).toBeGreaterThan(top + CARD.h);
        expect(start[1]).toBeLessThan(top + 100);
      }
    }
  });

  it('Everyone draws every person in the family, in every layout', () => {
    for (const seed of [1, 3, 7, 11]) {
      const G = generatedFamily(150, seed);
      const want = [...G.familyComponent('p40')].filter((id) => G.person(id));
      for (const orient of ['cross', 'down', 'right'] as const) {
        const L = lay(G, 'p40', 'everyone', [], false, orient);
        const label = `seed ${seed} ${orient}`;
        checkGeometry(L, label);
        expect(new Set(L.nodes.map((n) => n.key)).size, label).toBe(L.nodes.length);
        const keyOf = new Map(L.nodes.map((n) => [n.key, n]));
        for (const id of want) expect(L.nodes.filter((n) => n.personId === id && !n.dupOf), `${label}: ${id}`).toHaveLength(1);
        for (const n of L.nodes) if (n.dupOf) expect(keyOf.get(n.dupOf)?.personId, `${label}: ${n.key}`).toBe(n.personId);
        expect(L.nodes.filter((n) => n.role === 'focus').map((n) => n.personId), label).toEqual(['p40']);
      }
    }
  });

  it('cross layout, Everyone: descendants and the families of people who married in, in trees below', () => {
    const f = family();
    const people: [string, Gender, string][] = [
      ['me', 'male', '1980'], ['wife', 'female', '1982'], ['wifeDad', 'male', '1950'], ['wifeMom', 'female', '1952'], ['wifeBro', 'male', '1985'],
      ['son', 'male', '2008'], ['grandkid', 'female', '2030'], ['sonWife', 'female', '2009'],
      ['sis', 'female', '1984'], ['sisHusband', 'male', '1981'], ['niece', 'female', '2012'],
      ['dad', 'male', '1950'], ['mom', 'female', '1952'], ['dgf', 'male', '1920'], ['dgm', 'female', '1922'],
      ['dgmDad', 'male', '1890'], ['dgmMom', 'female', '1892'], ['dgmSis', 'female', '1925'],
      ['uncle', 'male', '1948'], ['uncleWife', 'female', '1950'], ['cousin', 'male', '1975'], ['cousinKid', 'male', '2005'],
      ['greatUncle', 'male', '1918'], ['ggf', 'male', '1890'], ['dadsCousin', 'male', '1945'],
    ];
    for (const [id, gd, y] of people) f.add(id, gd, y);
    const kids = (a: string, b: string | null, ...cs: string[]) => { for (const c of cs) { f.rel(a, c, 'parent'); if (b) f.rel(b, c, 'parent'); } if (b) f.rel(a, b, 'spouse'); };
    kids('dad', 'mom', 'me', 'sis');
    kids('dgf', 'dgm', 'dad', 'uncle');
    kids('ggf', null, 'dgf', 'greatUncle');
    kids('dgmDad', 'dgmMom', 'dgm', 'dgmSis');
    kids('wifeDad', 'wifeMom', 'wife', 'wifeBro');
    kids('me', 'wife', 'son');
    kids('son', 'sonWife', 'grandkid');
    kids('sisHusband', 'sis', 'niece');
    kids('uncle', 'uncleWife', 'cousin');
    kids('cousin', null, 'cousinKid');
    kids('greatUncle', null, 'dadsCousin');
    const G = f.graph();
    const L = lay(G, 'me', 'everyone', [], false, 'cross');
    checkGeometry(L, 'everyone trees');
    expect(new Set(L.nodes.map((n) => n.key)).size).toBe(L.nodes.length); // keys stay unique
    const ids = new Set(L.nodes.map((n) => n.personId));
    for (const [id] of people) expect(ids.has(id), id).toBe(true); // everyone is drawn
    const mains = (id: string) => L.nodes.filter((n) => n.personId === id && !n.dupOf);
    for (const [id] of people) expect(mains(id), `${id}: one main card`).toHaveLength(1);
    const keyOf = new Map(L.nodes.map((n) => [n.key, n]));
    for (const n of L.nodes) if (n.dupOf) expect(keyOf.get(n.dupOf)?.personId, n.key).toBe(n.personId);
    // The wife's main card is in her own family's tree (with her parents), below the main tree; beside me a copy.
    const myCard = mains('me')[0];
    const wifeMain = mains('wife')[0];
    expect(wifeMain.y).toBeGreaterThan(myCard.y + 200);
    expect(L.edges.some((e) => e.from === 'wifeDad' && e.to === 'wife')).toBe(true);
    expect(L.nodes.some((n) => n.personId === 'wife' && n.dupOf === wifeMain.key)).toBe(true);
    // Someone who married in with no recorded parents keeps a single card (no copy).
    for (const id of ['uncleWife', 'sonWife']) expect(L.nodes.filter((n) => n.personId === id), id).toHaveLength(1);
    // (The sister's husband is also the niece's father, so her descendants' tree has a copy of him.)
    // Titled trees: the main regions plus descendants and married-in families.
    const labels = (L.regions ?? []).map((r) => r.label).filter(Boolean);
    expect(labels).toContain('me’s descendants');
    expect(labels).toContain('wife’s family');
    expect(labels).toContain('dgm’s family');
    expect(L.nodes.filter((n) => n.role === 'focus').map((n) => n.personId)).toEqual(['me']);
    // Other levels stay as they were: no extra trees.
    const ext = lay(G, 'me', 'extended', [], false, 'cross');
    expect(ext.regions).toHaveLength(3);
    expect(ext.nodes.some((n) => n.personId === 'son')).toBe(false);
  });

  it('cross layout: siblings recorded only as brother/sister still get the parents\' line', () => {
    // The grandfather's brother and my sister are linked by a sibling relationship only, not to the parents.
    const f = family();
    f.add('me', 'male', '1980'); f.add('sis', 'female', '1984'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
    f.add('gf', 'male', '1920'); f.add('gm', 'female', '1922'); f.add('ggf', 'male', '1890'); f.add('ggm', 'female', '1892');
    f.add('greatUncle', 'male', '1918');
    f.rel('dad', 'me', 'parent'); f.rel('mom', 'me', 'parent'); f.rel('me', 'sis', 'sibling');
    f.rel('gf', 'dad', 'parent'); f.rel('gm', 'dad', 'parent'); f.rel('ggf', 'gf', 'parent'); f.rel('ggm', 'gf', 'parent');
    f.rel('gf', 'greatUncle', 'sibling');
    const G = f.graph();
    const L = lay(G, 'me', 'everyone', [], false, 'cross');
    checkGeometry(L, 'inferred parents');
    for (const [a, b] of [['ggf', 'greatUncle'], ['ggm', 'greatUncle'], ['ggf', 'gf'], ['dad', 'sis'], ['mom', 'sis']]) {
      expect(L.edges.some((e) => e.from === a && e.to === b), `${a}→${b}`).toBe(true);
    }
  });

  it('keeps the main card in the birth family when someone also appears beside a spouse', () => {
    // My sister married our cousin (my uncle's son): he is drawn under his parents and beside her.
    const f = family();
    f.add('gf', 'male', '1920'); f.add('gm', 'female', '1922'); f.add('dad', 'male', '1950'); f.add('mom', 'female', '1952');
    f.add('uncle', 'male', '1948'); f.add('me', 'male', '1980'); f.add('sis', 'female', '1982'); f.add('cousin', 'male', '1979');
    f.add('cousinMom', 'female', '1950');
    for (const c of ['dad', 'uncle']) { f.rel('gf', c, 'parent'); f.rel('gm', c, 'parent'); }
    for (const c of ['me', 'sis']) { f.rel('dad', c, 'parent'); f.rel('mom', c, 'parent'); }
    f.rel('uncle', 'cousin', 'parent'); f.rel('cousinMom', 'cousin', 'parent'); f.rel('uncle', 'cousinMom', 'spouse');
    f.rel('sis', 'cousin', 'spouse'); f.rel('dad', 'mom', 'spouse'); f.rel('gf', 'gm', 'spouse');
    const G = f.graph();
    for (const orient of ['down', 'right', 'cross'] as const) {
      const L = lay(G, 'me', 'everyone', [], false, orient);
      checkGeometry(L, `birth card ${orient}`);
      const cards = L.nodes.filter((n) => n.personId === 'cousin');
      expect(cards, orient).toHaveLength(2);
      const main = cards.find((n) => !n.dupOf)!;
      const second = cards.find((n) => n.dupOf)!;
      expect(main.role, orient).not.toBe('spouse'); // the birth card, joined to his parents
      expect(second.role, orient).toBe('spouse'); // beside my sister
      expect(second.dupOf).toBe(main.key);
      expect(second.expandable, orient).toBeUndefined(); // can't open his ancestors from here
      expect(L.edges.some((e) => e.from === 'uncle' && e.to === 'cousin'), orient).toBe(true);
    }
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
  }, 120_000);

  it('is fast on 1,000 people', () => {
    const G = generatedFamily(1000, 7);
    const ids = [...G.people.keys()].slice(0, 20);
    const t0 = performance.now();
    for (const id of ids) lay(G, id, 'extended');
    const per = (performance.now() - t0) / ids.length;
    expect(per).toBeLessThan(30);
  });
});
