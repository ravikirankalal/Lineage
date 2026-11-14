import { CARD, type TreeEdge, type TreeLayout, type TreeNode, type TreeOptions } from './graph/contract';
import type { FamilyGraph } from './kinship';
import type { SpouseSubtype } from './types';

/**
 * Family-unit tree layout (Phase 11). An hourglass around the focus:
 *
 * - The parents' row is one unit: [father's other partners] father — mother [mother's other partners],
 *   with a separate child bar per couple, so half-siblings hang from the right marriage.
 * - Every other person is a "block": the person, their partners beside them ([p, s1] or
 *   [s1, p, s2, s3 …]) and one child group per partner, laid out recursively.
 * - Ancestors go up as a pedigree. Collateral relatives (an ancestor's siblings with their families)
 *   are only drawn on the outer edge of the pedigree (father's father's line on the left, mother's
 *   mother's line on the right): anywhere else they would have to sit between a couple.
 * - Subtrees are packed with per-row contours (Reingold–Tilford style), and pedigree rows and
 *   collateral blocks are slid outwards until they're free, so cards never overlap and edges only
 *   run through the gaps between rows and between a couple's two cards.
 * - A person who'd be drawn twice (cousin marriages, pedigree collapse) gets a small stub (`dupOf`).
 *
 * Levels: immediate (parents and their partners, siblings, spouses, ancestors, descendants),
 * extended (+ siblings' families, aunts/uncles with spouses and cousins), everyone (all generations,
 * every block open, collaterals at every outer ancestor). `expanded` opens one more level for a card.
 */

type Role = TreeNode['role'];
type Cont = Map<number, [number, number]>; // key 2·gen = card row, 2·gen − 1 = the gap below that row
interface Shape {
  nodes: TreeNode[]; // nodes[0] is the shape's root card
  edges: TreeEdge[];
  cont: Cont;
}
interface Slot {
  id: string; // person id, or '~father' / '~mother' for ghosts
  ghost?: 'father' | 'mother';
  role: Role;
  half?: boolean;
  step?: boolean;
}
interface GroupSpec {
  couple?: [number, number]; // slot indices
  slot?: number;
  parents: string[];
  kids: string[];
  stepKids?: boolean; // the partner's children, not the block owner's
}

/**
 * Layout geometry. The engine always lays generations out as rows; for `orient: 'right'` it runs with
 * the card's width and height swapped and the result is transposed (generations become columns).
 * `w` is the card's size along a row, `h` across it. Set once per layoutFamilyV2 call (synchronous).
 */
interface Geo { w: number; h: number; gapX: number; rowH: number }
const DOWN: Geo = { w: CARD.w, h: CARD.h, gapX: CARD.gapX, rowH: CARD.rowH };
const RIGHT: Geo = { w: CARD.h, h: CARD.w, gapX: 14, rowH: CARD.w + 36 };
let geo: Geo = DOWN;
let STEP = 0;
let HALF = 0;
let ROW_GAP = 0;
function setGeo(g: Geo) {
  geo = g;
  STEP = g.w + g.gapX;
  HALF = g.w / 2;
  ROW_GAP = g.rowH - g.h;
}
setGeo(DOWN);
const BAR_GAP = 12;
const MANY = 99;

const rowTop = (gen: number) => -gen * geo.rowH;
const kRow = (gen: number) => 2 * gen;
const kGap = (gen: number) => 2 * gen - 1;
const gapOf = (k: number) => (k % 2 === 0 ? geo.gapX : BAR_GAP);

function extend(c: Cont, k: number, l: number, r: number) {
  const v = c.get(k);
  if (v) {
    v[0] = Math.min(v[0], l);
    v[1] = Math.max(v[1], r);
  } else c.set(k, [l, r]);
}
function shift(s: Shape, dx: number) {
  if (!dx) return;
  for (const n of s.nodes) n.x += dx;
  for (const e of s.edges) for (const p of e.points) p[0] += dx;
  for (const v of s.cont.values()) {
    v[0] += dx;
    v[1] += dx;
  }
}
function absorb(into: Shape, s: Shape) {
  for (const n of s.nodes) into.nodes.push(n);
  for (const e of s.edges) into.edges.push(e);
  for (const [k, [l, r]] of s.cont) extend(into.cont, k, l, r);
}
/** Smallest offset that puts `s` to the right of `acc` on every shared row. */
function packRight(acc: Cont, s: Cont): number | undefined {
  let off: number | undefined;
  for (const [k, [l]] of s) {
    const a = acc.get(k);
    if (!a) continue;
    const need = a[1] + gapOf(k) - l;
    off = off === undefined ? need : Math.max(off, need);
  }
  return off;
}

/** The global occupancy: intervals per row (holes allowed), used to slide pieces outwards. */
class Occupancy {
  private rows = new Map<number, [number, number][]>();
  add(c: Cont) {
    for (const [k, [l, r]] of c) {
      const list = this.rows.get(k);
      if (list) list.push([l, r]);
      else this.rows.set(k, [[l, r]]);
    }
  }
  /** Offset nearest to `start` in direction `dir` where `c` overlaps nothing. */
  free(c: Cont, start: number, dir: 1 | -1): number {
    let off = start;
    for (let guard = 0; guard < 100000; guard++) {
      let moved = false;
      for (const [k, [l, r]] of c) {
        const list = this.rows.get(k);
        if (!list) continue;
        const g = gapOf(k);
        for (const [al, ar] of list) {
          if (l + off < ar + g && r + off > al - g) {
            off = dir > 0 ? ar + g - l : al - g - r;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return off;
  }
}

function birthYear(g: FamilyGraph, id: string) {
  const b = g.person(id)?.birthDate;
  return b ? parseInt(b, 10) || 9999 : 9999;
}
function byBirth(g: FamilyGraph) {
  return (a: string, b: string) =>
    birthYear(g, a) - birthYear(g, b) || (g.person(a)?.firstName ?? '').localeCompare(g.person(b)?.firstName ?? '') || (a < b ? -1 : a > b ? 1 : 0);
}
const genderRank = (g: FamilyGraph, id: string) => (g.person(id)?.gender === 'male' ? 0 : g.person(id)?.gender === 'female' ? 1 : 2);
const isBlood = (sub: string | undefined) => sub !== 'step' && sub !== 'foster';

class Builder {
  readonly nodes: TreeNode[] = [];
  readonly placed = new Map<string, string>(); // person id → primary node key
  readonly byId = new Map<string, TreeNode>();
  private dupN = 0;
  private edgeN = 0;
  readonly up: number;
  readonly minGen: number;
  readonly sibling = new Map<string, { half: boolean; step?: boolean }>();

  /**
   * People whose main card belongs in their birth family: when they also turn up in a partner slot
   * (beside a spouse), that card is a secondary stub, even if it is laid out first.
   */
  private readonly reserved: ReadonlySet<string>;
  private readonly pendingStubs: TreeNode[] = [];

  constructor(readonly g: FamilyGraph, readonly opts: TreeOptions, reserved: ReadonlySet<string> = new Set()) {
    this.reserved = reserved;
    const all = opts.level === 'everyone';
    this.up = opts.up ?? (all ? MANY : 4);
    this.minGen = -(opts.down ?? (all ? MANY : 3));
    if (!opts.noSiblings) for (const s of g.siblingsOf(opts.focusId)) this.sibling.set(s.id, { half: s.half, step: s.step });
  }

  get level() {
    return this.opts.level;
  }
  isExpanded(id: string) {
    return this.opts.expanded.has(id);
  }
  /** Drawn (or to be drawn) as a main card somewhere else, so a partner slot shows only a stub. */
  elsewhere(id: string) {
    return this.placed.has(id) || this.reserved.has(id);
  }
  /** Point stubs made for reserved people at their main card, once it exists. */
  resolveStubs() {
    for (const n of this.pendingStubs) {
      const key = this.placed.get(n.personId!);
      if (key) n.dupOf = key;
      else {
        // The birth card never came (shouldn't happen): make this the main card after all.
        delete n.dupOf;
        n.key = `${n.role}:${n.personId}`;
        this.placed.set(n.personId!, n.key);
        this.byId.set(n.personId!, n);
      }
    }
  }

  edge(kind: TreeEdge['kind'], points: [number, number][], from: string, to: string): TreeEdge {
    return { key: `${kind}:${from}:${to}:${this.edgeN++}`, kind, points, from, to };
  }

  /** Create the node for a slot: the primary card, or a stub if the person is already drawn. */
  node(slot: Slot, x: number, gen: number): TreeNode {
    let n: TreeNode;
    if (slot.ghost) {
      n = { key: 'ghost:' + slot.ghost, ghost: slot.ghost, x, y: rowTop(gen), generation: gen, role: 'ghost' };
    } else if (this.placed.has(slot.id)) {
      n = { key: `dup:${slot.id}:${this.dupN++}`, personId: slot.id, dupOf: this.placed.get(slot.id), x, y: rowTop(gen), generation: gen, role: slot.role };
    } else if (slot.role === 'spouse' && this.reserved.has(slot.id)) {
      n = { key: `dup:${slot.id}:${this.dupN++}`, personId: slot.id, dupOf: '?', x, y: rowTop(gen), generation: gen, role: slot.role };
      this.pendingStubs.push(n);
    } else {
      n = { key: `${slot.role}:${slot.id}`, personId: slot.id, x, y: rowTop(gen), generation: gen, role: slot.role };
      this.placed.set(slot.id, n.key);
      this.byId.set(slot.id, n);
      if (this.isExpanded(slot.id)) n.expanded = true;
    }
    if (slot.half) n.half = true;
    if (slot.step) n.step = true;
    this.nodes.push(n);
    return n;
  }

  spouseSub(a: string, b: string): SpouseSubtype | undefined {
    return this.g.spousesOf(a).find((e) => e.id === b)?.subtype;
  }

  /** Spouses plus co-parents of the person's children, ordered by their first child, then name. */
  partners(p: string, exclude: string[] = []): string[] {
    const set = new Set(this.g.spousesOf(p).map((e) => e.id));
    for (const c of this.g.childrenOf(p)) for (const e of this.g.parentsOf(c.id)) if (e.id !== p) set.add(e.id);
    for (const x of exclude) set.delete(x);
    const firstKid = (s: string) =>
      Math.min(9999, ...this.g.childrenOf(p).filter((c) => this.g.parentsOf(c.id).some((e) => e.id === s)).map((c) => birthYear(this.g, c.id)));
    const order = byBirth(this.g);
    return [...set].sort((a, b) => firstKid(a) - firstKid(b) || order(a, b));
  }

  /** Blood parents for the pedigree, father first (at most two). */
  pedigreeParents(id: string): string[] {
    const ps = this.g.bloodParents(id);
    const sub = (p: string) => (this.g.parentsOf(id).find((e) => e.id === p)?.subtype === 'adoptive' ? 1 : 0);
    return ps.sort((a, b) => sub(a) - sub(b) || genderRank(this.g, a) - genderRank(this.g, b) || (a < b ? -1 : 1)).slice(0, 2);
  }

  /**
   * Lay out a row of slots (the origin slot at x = 0) with couple lines and one child group per
   * couple / single parent, each group centred under its anchor and packed so groups never overlap.
   */
  assemble(gen: number, slots: Slot[], origin: number, couples: [number, number][], groups: GroupSpec[],
    kidShape: (id: string, gen: number, grp: GroupSpec) => Shape): Shape {
    const top = rowTop(gen);
    const xs = slots.map((_, i) => (i - origin) * STEP);
    const shape: Shape = { nodes: [], edges: [], cont: new Map() };
    const rowNodes = slots.map((s, i) => this.node(s, xs[i], gen));
    shape.nodes.push(rowNodes[origin], ...rowNodes.filter((_, i) => i !== origin));
    extend(shape.cont, kRow(gen), Math.min(...xs) - HALF, Math.max(...xs) + HALF);

    for (const [a, b] of couples) {
      const [l, r] = a < b ? [a, b] : [b, a];
      const sub = this.spouseSub(slots[a].id, slots[b].id);
      const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
      if (r - l === 1) {
        shape.edges.push(this.edge(kind, [[xs[l] + HALF, top + geo.h / 2], [xs[r] - HALF, top + geo.h / 2]], slots[a].id, slots[b].id));
      } else {
        // Not adjacent: route over the cards in between, through the gap above the row.
        const y = top - 10;
        const x0 = xs[a] + (b > a ? 1 : -1) * (geo.w / 4);
        shape.edges.push(this.edge(kind, [[x0, top], [x0, y], [xs[b], y], [xs[b], top]], slots[a].id, slots[b].id));
        extend(shape.cont, kRow(gen) + 1, Math.min(x0, xs[b]), Math.max(x0, xs[b]));
      }
    }

    // Child groups, left to right by anchor.
    const placedGroups = groups
      .filter((grp) => grp.kids.length)
      .map((grp) => {
        let ax: number;
        let sy: number;
        if (grp.couple) {
          const [a, b] = grp.couple;
          if (Math.abs(a - b) === 1) {
            ax = (xs[a] + xs[b]) / 2;
            sy = top + geo.h / 2;
          } else {
            ax = xs[b];
            sy = top + geo.h;
          }
        } else {
          ax = xs[grp.slot!];
          sy = top + geo.h;
        }
        return { grp, ax, sy };
      })
      .sort((a, b) => a.ax - b.ax);

    const kidsCont: Cont = new Map();
    const n = placedGroups.length;
    placedGroups.forEach(({ grp, ax, sy }, gi) => {
      const gs: Shape = { nodes: [], edges: [], cont: new Map() };
      const kidXs: number[] = [];
      const roots: TreeNode[] = [];
      for (const kid of grp.kids) {
        const ks = kidShape(kid, gen - 1, grp);
        const off = gs.nodes.length ? packRight(gs.cont, ks.cont) ?? 0 : 0;
        shift(ks, off);
        roots.push(ks.nodes[0]);
        absorb(gs, ks);
      }
      for (const r of roots) kidXs.push(r.x);
      const centre = (kidXs[0] + kidXs[kidXs.length - 1]) / 2;
      let off = ax - centre;
      if (kidsCont.size) off = Math.max(off, packRight(kidsCont, gs.cont) ?? off);
      shift(gs, off);
      for (const [k, [l, r]] of gs.cont) extend(kidsCont, k, l, r);
      absorb(shape, gs);

      const barY = top + geo.h + ROW_GAP / 2 + (n > 1 ? (gi - (n - 1) / 2) * 7 : 0);
      const childTop = rowTop(gen - 1);
      const real = grp.parents.filter((p) => !p.startsWith('~'));
      for (const r of roots) {
        const cx = r.x;
        const pts: [number, number][] = Math.abs(cx - ax) < 0.5 ? [[ax, sy], [cx, childTop]] : [[ax, sy], [ax, barY], [cx, barY], [cx, childTop]];
        const kid = r.personId ?? '';
        const links = real.map((p) => ({ p, sub: this.g.parentsOf(kid).find((e) => e.id === p)?.subtype, is: this.g.parentsOf(kid).some((e) => e.id === p) })).filter((l) => l.is);
        const blood = links.filter((l) => isBlood(l.sub));
        if (blood.length) for (const l of blood) shape.edges.push(this.edge('descent', pts.map((q) => [q[0], q[1]]), l.p, kid));
        else if (links.length) shape.edges.push(this.edge('step', pts, links[0].p, kid));
        else shape.edges.push(this.edge(grp.stepKids ? 'step' : 'descent', pts, real[0] ?? '', kid));
      }
      extend(shape.cont, kGap(gen), Math.min(ax, ...kidXs), Math.max(ax, ...kidXs));
    });
    return shape;
  }

  /** A person with their partners and, budget permitting, their children's blocks. */
  block(p: string, gen: number, budget: number, role: Role, kidRole: Role, flags: { half?: boolean; step?: boolean } = {}): Shape {
    if (this.placed.has(p)) {
      const shape: Shape = { nodes: [], edges: [], cont: new Map() };
      shape.nodes.push(this.node({ id: p, role, ...flags }, 0, gen));
      extend(shape.cont, kRow(gen), -HALF, HALF);
      return shape;
    }
    const exp = this.isExpanded(p);
    const b = exp ? Math.max(budget, 1) : Math.min(budget, gen - this.minGen);
    const self: Slot = { id: p, role, ...flags };
    if (b < 1) {
      const shape = this.assemble(gen, [self], 0, [], [], () => ({ nodes: [], edges: [], cont: new Map() }));
      if (this.g.spousesOf(p).length || this.g.childrenOf(p).length) shape.nodes[0].expandable = { down: true };
      return shape;
    }
    const partners = this.partners(p);
    const slots: Slot[] =
      partners.length <= 1 ? [self, ...partners.map((s) => ({ id: s, role: 'spouse' as Role }))] : [{ id: partners[0], role: 'spouse' }, self, ...partners.slice(1).map((s) => ({ id: s, role: 'spouse' as Role }))];
    const origin = slots.indexOf(self);
    const idx = (id: string) => slots.findIndex((s) => s.id === id);
    const couples: [number, number][] = partners.map((s) => [origin, idx(s)]);
    const kids = this.g.childrenOf(p).map((c) => c.id).sort(byBirth(this.g));
    const groups = new Map<string, GroupSpec>();
    const solo: GroupSpec = { slot: origin, parents: [p], kids: [] };
    for (const c of kids) {
      const ps = new Set(this.g.parentsOf(c).map((e) => e.id));
      const s = partners.find((x) => ps.has(x));
      if (!s) {
        solo.kids.push(c);
        continue;
      }
      if (!groups.has(s)) groups.set(s, { couple: [origin, idx(s)], parents: [p, s], kids: [] });
      groups.get(s)!.kids.push(c);
    }
    const specs = [...groups.values(), solo];
    // A partner's children with someone else (the owner's step-children), when the partner is drawn here.
    const mine = new Set(kids);
    for (const s of partners) {
      if (this.elsewhere(s)) continue;
      const theirs = this.g.childrenOf(s).map((c) => c.id).filter((c) => !mine.has(c)).sort(byBirth(this.g));
      if (theirs.length) specs.push({ slot: idx(s), parents: [s], kids: theirs, stepKids: true });
    }
    // Partners already drawn elsewhere become stubs in assemble(); don't open their step-children then.
    const stubPartners = new Set(partners.filter((s) => this.elsewhere(s)));
    return this.assemble(gen, slots, origin, couples, specs.filter((s) => !(s.stepKids && stubPartners.has(s.parents[0]))), (id, kg, grp) =>
      this.block(id, kg, b - 1, kidRole, kidRole, grp.stepKids || !isBlood(this.g.parentsOf(id).find((e) => e.id === p)?.subtype) && !grp.couple ? { step: true } : {}));
  }

  siblingBudget() {
    return this.level === 'immediate' ? 0 : this.level === 'extended' ? 1 : MANY;
  }

  focusOrSibling(id: string, gen: number, step?: boolean): Shape {
    const f = this.opts.focusId;
    if (id === f) return this.block(f, gen, gen - this.minGen, 'focus', 'descendant');
    const s = this.sibling.get(id);
    return this.block(id, gen, this.siblingBudget(), 'sibling', 'relative', { half: s?.half || undefined, step: step || s?.step || undefined });
  }

  /** The focus with siblings, under the parents' unit (parents, their other partners, ghosts). */
  core(): { shape: Shape; principals: string[] } {
    const g = this.g;
    const f = this.opts.focusId;
    const parents = this.up > 0 ? this.pedigreeParents(f) : [];
    const ps: Slot[] = parents.map((id) => ({ id, role: 'ancestor' }));
    if (this.opts.ghosts && this.up > 0 && ps.length < 2) {
      const hasDad = parents.some((p) => g.person(p)?.gender === 'male');
      const hasMom = parents.some((p) => g.person(p)?.gender === 'female');
      const ghosts: Slot[] = [];
      if (!hasDad) ghosts.push({ id: '~father', ghost: 'father', role: 'ghost' });
      if (!hasMom) ghosts.push({ id: '~mother', ghost: 'mother', role: 'ghost' });
      for (const gh of ghosts.slice(0, 2 - ps.length)) {
        if (gh.ghost === 'father') ps.unshift(gh);
        else ps.push(gh);
      }
    }
    const sibs = [...this.sibling.keys()];
    if (!ps.length) {
      const order = [f, ...sibs].sort(byBirth(g));
      const shape: Shape = { nodes: [], edges: [], cont: new Map() };
      let focusShape: Shape | undefined;
      // Build the focus first so it's the primary card if anyone repeats.
      const built = new Map<string, Shape>([[f, (focusShape = this.focusOrSibling(f, 0))]]);
      for (const id of order) if (!built.has(id)) built.set(id, this.focusOrSibling(id, 0));
      for (const id of order) {
        const s = built.get(id)!;
        if (shape.nodes.length) shift(s, packRight(shape.cont, s.cont) ?? 0);
        absorb(shape, s);
      }
      shape.nodes.unshift(...shape.nodes.splice(shape.nodes.indexOf(focusShape.nodes[0]), 1));
      return { shape, principals: [] };
    }

    const [a, b] = ps;
    const real = ps.filter((s) => !s.ghost).map((s) => s.id);
    const aOthers = a.ghost ? [] : this.partners(a.id, real);
    const bOthers = !b || b.ghost ? [] : this.partners(b.id, [...real, ...aOthers]);
    const slots: Slot[] = [...[...aOthers].reverse().map((id) => ({ id, role: 'spouse' as Role })), a, ...(b ? [b] : []), ...bOthers.map((id) => ({ id, role: 'spouse' as Role }))];
    const ia = aOthers.length;
    const ib = b ? ia + 1 : -1;
    const idx = (id: string) => slots.findIndex((s) => s.id === id);
    const couples: [number, number][] = [];
    if (b) couples.push([ia, ib]);
    for (const s of aOthers) couples.push([ia, idx(s)]);
    for (const s of bOthers) couples.push([ib, idx(s)]);

    const main: GroupSpec = b ? { couple: [ia, ib], parents: [a.id, b.id], kids: [] } : { slot: ia, parents: [a.id], kids: [] };
    const groups = new Map<string, GroupSpec>();
    const soloA: GroupSpec = { slot: ia, parents: [a.id], kids: [] };
    const soloB: GroupSpec | undefined = b ? { slot: ib, parents: [b.id], kids: [] } : undefined;
    const kids = new Set<string>([f, ...sibs]);
    for (const p of real) for (const c of g.childrenOf(p)) kids.add(c.id);
    const stepOf = new Map<string, string>();
    for (const s of [...aOthers, ...bOthers]) for (const c of g.childrenOf(s)) if (!kids.has(c.id) && !stepOf.has(c.id)) stepOf.set(c.id, s);
    for (const c of [...kids].sort(byBirth(g))) {
      const cps = new Set(g.parentsOf(c).map((e) => e.id));
      const inA = !a.ghost && cps.has(a.id);
      const inB = !!b && !b.ghost && cps.has(b.id);
      if ((inA && inB) || (!inA && !inB)) {
        main.kids.push(c);
        continue;
      }
      const owner = inA ? a : b!;
      const others = inA ? aOthers : bOthers;
      const s = others.find((x) => cps.has(x));
      if (s) {
        if (!groups.has(s)) groups.set(s, { couple: [inA ? ia : ib, idx(s)], parents: [owner.id, s], kids: [] });
        groups.get(s)!.kids.push(c);
      } else if ((inA ? b : a)?.ghost || !b) main.kids.push(c);
      else (inA ? soloA : soloB!).kids.push(c);
    }
    const specs: GroupSpec[] = [main, ...groups.values(), soloA, ...(soloB ? [soloB] : [])];
    const stepGroups = new Map<string, GroupSpec>();
    for (const [c, s] of stepOf) {
      if (!stepGroups.has(s)) stepGroups.set(s, { slot: idx(s), parents: [s], kids: [], stepKids: true });
      stepGroups.get(s)!.kids.push(c);
    }
    specs.push(...stepGroups.values());

    // The focus must be the primary card: build it before its siblings (assemble builds groups by anchor).
    const prebuilt = new Map<string, Shape>();
    const shape = this.assemble(1, slots, ia, couples, specs, (id, kg, grp) => {
      if (!prebuilt.size) prebuilt.set(f, this.focusOrSibling(f, kg));
      return prebuilt.get(id) ?? this.focusOrSibling(id, kg, grp.stepKids);
    });
    return { shape, principals: real };
  }

  /**
   * Collaterals (outer edge only) and parents of an already placed person, then recurse upwards.
   * `inlaw`: the pedigree of someone who married in (role 'relative', its own bar heights; outside Everyone
   * only the parents, and only when that card is expanded). `depth` counts generations above them.
   */
  ancestry(occ: Occupancy, all: Shape, x: string, gen: number, side: 'L' | 'R', outer: boolean, inlaw = false, depth = 0) {
    const g = this.g;
    const xn = this.byId.get(x);
    if (!xn) return;
    const dir = side === 'L' ? -1 : 1;
    const row = [xn];

    // Siblings of x with their families, outside x.
    const sibs = g.siblingsOf(x).map((s) => s.id).filter((s) => !this.placed.has(s)).sort(byBirth(g));
    const wantSide = outer && (this.level === 'everyone' || (this.level === 'extended' && gen === 1) || this.isExpanded(x));
    if (sibs.length) {
      if (wantSide) {
        const budget = this.level === 'everyone' ? MANY : 1;
        const half = new Map(g.siblingsOf(x).map((s) => [s.id, s]));
        const ordered = side === 'L' ? [...sibs].reverse() : sibs; // nearest first
        for (const s of ordered) {
          const info = half.get(s);
          const shape = this.block(s, gen, budget, 'relative', 'relative', { half: info?.half || undefined, step: info?.step || undefined });
          const edgeX = side === 'L' ? Math.min(...row.map((n) => n.x)) : Math.max(...row.map((n) => n.x));
          const off = occ.free(shape.cont, edgeX + dir * STEP, dir);
          shift(shape, off);
          occ.add(shape.cont);
          absorb(all, shape);
          row.push(shape.nodes[0]);
        }
      } else if (outer) xn.expandable = { ...xn.expandable, side: true };
    }

    // Parents above, centred over x and its siblings.
    const parents = this.pedigreeParents(x);
    if (!parents.length) return;
    if ((gen + 1 > this.up || (inlaw && depth > 0 && this.level !== 'everyone')) && !this.isExpanded(x)) {
      xn.expandable = { ...xn.expandable, up: true };
      return;
    }
    const lo = Math.min(...row.map((n) => n.x));
    const hi = Math.max(...row.map((n) => n.x));
    const w = (parents.length - 1) * STEP;
    const rowCont: Cont = new Map([[kRow(gen + 1), [-HALF, w + HALF]]]);
    const off = occ.free(rowCont, (lo + hi) / 2 - w / 2, dir);
    const top = rowTop(gen + 1);
    const pn = parents.map((p, i) => this.node({ id: p, role: inlaw ? 'relative' : 'ancestor' }, off + i * STEP, gen + 1));
    const piece: Shape = { nodes: [], edges: [], cont: new Map() };
    extend(piece.cont, kRow(gen + 1), off - HALF, off + w + HALF);
    let ax = off;
    let sy = top + geo.h;
    if (pn.length === 2) {
      const sub = this.spouseSub(parents[0], parents[1]);
      const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
      piece.edges.push(this.edge(kind, [[off + HALF, top + geo.h / 2], [off + STEP - HALF, top + geo.h / 2]], parents[0], parents[1]));
      ax = off + STEP / 2;
      sy = top + geo.h / 2;
    }
    // In-law bars run just under their parents' row so they don't merge with the family's own bars.
    let barY = top + geo.h + ROW_GAP / 2 + dir * 4;
    if (inlaw) {
      const k = this.inlawBars.get(gen) ?? 0;
      this.inlawBars.set(gen, k + 1);
      barY = top + geo.h + 8 + (k % 3) * 6;
    }
    const childTop = rowTop(gen);
    for (const kn of row) {
      const kid = kn.personId!;
      const pts: [number, number][] = Math.abs(kn.x - ax) < 0.5 ? [[ax, sy], [kn.x, childTop]] : [[ax, sy], [ax, barY], [kn.x, barY], [kn.x, childTop]];
      const links = parents.filter((p) => g.parentsOf(kid).some((e) => e.id === p));
      const blood = links.filter((p) => isBlood(g.parentsOf(kid).find((e) => e.id === p)?.subtype));
      if (blood.length) for (const p of blood) piece.edges.push(this.edge('descent', pts.map((q) => [q[0], q[1]]), p, kid));
      else piece.edges.push(this.edge(links.length ? 'step' : 'descent', pts, links[0] ?? parents[0], kid));
    }
    extend(piece.cont, kGap(gen + 1), Math.min(ax, lo), Math.max(ax, hi));
    piece.nodes.push(...pn);
    occ.add(piece.cont);
    absorb(all, piece);

    // Recurse: the father's line keeps going left, the mother's right; only the outer line gets collaterals.
    const sides: ('L' | 'R')[] = pn.length === 2 ? ['L', 'R'] : [side];
    pn.forEach((n, i) => {
      if (n.dupOf) return;
      this.ancestry(occ, all, parents[i], gen + 1, sides[i], outer && sides[i] === side, inlaw, depth + 1);
    });
  }

  /** In-law bars per gap, so two in-law families sharing a gap get different heights. */
  private inlawBars = new Map<number, number>();

  /**
   * Parents of everyone who married in (drawn as a partner): the focus's spouses first, then the closest.
   * In Everyone they're drawn with their ancestors; elsewhere the card gets "+" (expand shows the parents).
   */
  inLaws(occ: Occupancy, all: Shape) {
    const f = this.opts.focusId;
    const fn = this.byId.get(f);
    if (!fn) return;
    const mine = new Set(this.g.spousesOf(f).map((e) => e.id));
    const rank = (n: TreeNode) => (mine.has(n.personId!) ? 0 : 1);
    const cands = this.nodes
      .filter((n) => n.role === 'spouse' && !n.dupOf && n.personId)
      .sort((a, b) => rank(a) - rank(b) || Math.abs(a.generation) - Math.abs(b.generation) || Math.abs(a.x - fn.x) - Math.abs(b.x - fn.x));
    for (const sn of cands) {
      const id = sn.personId!;
      if (!this.pedigreeParents(id).some((p) => !this.placed.has(p))) continue;
      if (this.level === 'everyone' || this.isExpanded(id)) this.ancestry(occ, all, id, sn.generation, this.sideOf(sn, fn), false, true);
      else sn.expandable = { ...sn.expandable, up: true };
    }
  }

  /** Which way an in-law's family goes: away from the person they married (else away from the focus). */
  private sideOf(sn: TreeNode, fn: TreeNode): 'L' | 'R' {
    const id = sn.personId!;
    const partners = [...this.g.spousesOf(id).map((e) => e.id), ...this.g.childrenOf(id).flatMap((c) => this.g.parentsOf(c.id).map((e) => e.id))];
    for (const p of partners) {
      const pn = this.byId.get(p);
      if (pn && p !== id && pn.generation === sn.generation) return sn.x < pn.x ? 'L' : 'R';
    }
    return sn.x < fn.x ? 'L' : 'R';
  }
}

/**
 * Contract: `layoutFamily` (src/lib/graph/contract.ts). `orient: 'right'` puts generations in columns
 * (ancestors left, descendants right, siblings stacked), which suits tall phone screens.
 */
export function layoutFamilyV2(graph: FamilyGraph, opts: TreeOptions): TreeLayout {
  if (!graph.person(opts.focusId)) return { nodes: [], edges: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  const right = opts.orient === 'right';
  setGeo(right ? RIGHT : DOWN);
  try {
    const { nodes, edges } = rowLayout(graph, opts);
    if (right) {
      // Row space (along, across-top) → screen: x = card centre, y = card top.
      for (const n of nodes) {
        const along = n.x;
        n.x = n.y + CARD.w / 2;
        n.y = along - CARD.h / 2;
      }
      for (const e of edges) for (const p of e.points) [p[0], p[1]] = [p[1], p[0]];
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - CARD.w / 2);
      maxX = Math.max(maxX, n.x + CARD.w / 2);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + CARD.h);
    }
    for (const e of edges) for (const [x, y] of e.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { nodes, edges, bounds: { minX, maxX, minY, maxY } };
  } finally {
    setGeo(DOWN);
  }
}

/**
 * The layout in row space. If someone's main card landed in a partner slot while they also appear in
 * their birth family, lay out again with that partner slot reserved as a stub (the birth card is main).
 */
function rowLayout(graph: FamilyGraph, opts: TreeOptions): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const first = rowPass(graph, opts, new Set());
  const reserved = new Set<string>();
  const cards = new Map<string, TreeNode[]>();
  for (const n of first.nodes) if (n.personId) cards.set(n.personId, [...(cards.get(n.personId) ?? []), n]);
  for (const [id, ns] of cards) {
    const main = ns.find((n) => !n.dupOf);
    if (main?.role === 'spouse' && ns.some((n) => n.dupOf && n.role !== 'spouse')) reserved.add(id);
  }
  return reserved.size ? rowPass(graph, opts, reserved) : first;
}

function rowPass(graph: FamilyGraph, opts: TreeOptions, reserved: ReadonlySet<string>): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const b = new Builder(graph, opts, reserved);
  const { shape: core, principals } = b.core();
  const occ = new Occupancy();
  occ.add(core.cont);
  const all: Shape = { nodes: [], edges: [], cont: new Map() };
  absorb(all, core);
  if (principals.length === 2) {
    b.ancestry(occ, all, principals[0], 1, 'L', true);
    b.ancestry(occ, all, principals[1], 1, 'R', true);
  } else if (principals.length === 1) {
    b.ancestry(occ, all, principals[0], 1, graph.person(principals[0])?.gender === 'female' ? 'R' : 'L', true);
  }

  b.resolveStubs();
  if (!opts.noInLaws) b.inLaws(occ, all);

  // An expanded card keeps its control so it can be collapsed again.
  for (const n of b.nodes) if (n.expanded && !n.dupOf && !n.expandable) n.expandable = { down: true };

  // Focus at along-position 0.
  shift(all, -(b.byId.get(opts.focusId)?.x ?? 0));
  return { nodes: b.nodes, edges: all.edges };
}
