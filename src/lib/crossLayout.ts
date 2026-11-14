import { CARD, type TreeEdge, type TreeLayout, type TreeNode, type TreeOptions, type TreeRegion } from './graph/contract';
import { generationLabel } from './generationBands';
import type { FamilyGraph } from './kinship';

/**
 * "Cross" family layout (the owner's design for tall phone screens), centred on the focus:
 *
 *   [father's side] ← [siblings] [children] [spouses] → [mother's side]
 *
 * - Middle: the focus and their siblings in one column, brothers ABOVE the focus and sisters (and
 *   siblings of unknown gender) BELOW, each group oldest first. Each sibling's spouses sit in a spouse
 *   column on the right, and their children in a column BETWEEN the two, each child level with its
 *   family. Children are joined to both parents by brackets in the gaps.
 * - Left: the father, with his brothers above him and sisters below; his parents one column further
 *   left (father's father above father's mother), and so on outwards. Right: the same for the mother,
 *   mirrored. So every step outwards is one generation older.
 * - Lines only run through the gaps between columns and rows, so no line crosses a card.
 *
 * Levels: immediate (siblings without their families, ancestors' siblings hidden), extended (+ siblings'
 * spouses and children, parents' brothers and sisters), everyone (+ every ancestor's brothers and
 * sisters, all generations up). `expanded` opens one sibling's family or one ancestor's siblings/parents.
 */

const PC = CARD.w + 44; // column pitch
const RP = CARD.h + 24; // row pitch
const GX = PC - CARD.w; // gap between columns (lines run here)
const GY = RP - CARD.h; // gap between rows
const W2 = CARD.w / 2;
const H2 = CARD.h / 2;
const MANY = 99;

type Cont = Map<number, [number, number]>; // key 2c = column c (cards), 2c + 1 = the gap after it; [top, bottom]
interface Block {
  nodes: TreeNode[];
  edges: TreeEdge[];
  cont: Cont;
}

const isBlood = (sub: string | undefined) => sub !== 'step' && sub !== 'foster';
function birthYear(g: FamilyGraph, id: string) {
  const b = g.person(id)?.birthDate;
  return b ? parseInt(b, 10) || 9999 : 9999;
}
function byBirth(g: FamilyGraph) {
  return (a: string, b: string) =>
    birthYear(g, a) - birthYear(g, b) || (g.person(a)?.firstName ?? '').localeCompare(g.person(b)?.firstName ?? '') || (a < b ? -1 : a > b ? 1 : 0);
}
function extend(c: Cont, k: number, top: number, bottom: number) {
  const v = c.get(k);
  if (v) {
    v[0] = Math.min(v[0], top);
    v[1] = Math.max(v[1], bottom);
  } else c.set(k, [top, bottom]);
}
function moveBlock(b: Block, dcol: number, dy: number) {
  for (const n of b.nodes) {
    n.x += dcol * PC;
    n.y += dy;
  }
  for (const e of b.edges) for (const p of e.points) {
    p[0] += dcol * PC;
    p[1] += dy;
  }
  const next: Cont = new Map();
  for (const [k, [t, bt]] of b.cont) next.set(k + 2 * dcol, [t + dy, bt + dy]);
  b.cont = next;
}
function absorb(into: Block, b: Block) {
  into.nodes.push(...b.nodes);
  into.edges.push(...b.edges);
  for (const [k, [t, bt]] of b.cont) extend(into.cont, k, t, bt);
}

class Cross {
  readonly nodes: TreeNode[] = [];
  readonly edges: TreeEdge[] = [];
  readonly regions: TreeRegion[] = [];
  private placed = new Map<string, string>();
  private byId = new Map<string, TreeNode>();
  private dupN = 0;
  private edgeN = 0;
  private up: number;

  constructor(private g: FamilyGraph, private opts: TreeOptions) {
    this.up = opts.up ?? (opts.level === 'everyone' ? MANY : 4);
  }

  private exp(id: string) {
    return this.opts.expanded.has(id);
  }

  node(id: string, role: TreeNode['role'], gen: number, x: number, y: number, flags: Partial<TreeNode> = {}): TreeNode {
    let n: TreeNode;
    if (this.placed.has(id)) {
      n = { key: `dup:${id}:${this.dupN++}`, personId: id, dupOf: this.placed.get(id), x, y, generation: gen, role };
    } else {
      n = { key: `${role}:${id}`, personId: id, x, y, generation: gen, role, ...flags };
      this.placed.set(id, n.key);
      this.byId.set(id, n);
      if (this.exp(id)) n.expanded = true;
    }
    this.nodes.push(n);
    return n;
  }
  ghost(which: 'father' | 'mother', x: number, y: number): TreeNode {
    const n: TreeNode = { key: 'ghost:' + which, ghost: which, x, y, generation: 1, role: 'ghost' };
    this.nodes.push(n);
    return n;
  }
  edge(kind: TreeEdge['kind'], points: [number, number][], from: string, to: string): TreeEdge {
    return { key: `${kind}:${from}:${to}:${this.edgeN++}`, kind, points, from, to };
  }
  descentKind(parent: string, child: string): TreeEdge['kind'] {
    return isBlood(this.g.parentsOf(child).find((e) => e.id === parent)?.subtype) ? 'descent' : 'step';
  }
  isParent(parent: string, child: string) {
    return this.g.parentsOf(child).some((e) => e.id === parent);
  }

  /** Blood parents, father first (at most two). */
  parents(id: string): string[] {
    const ps = this.g.bloodParents(id);
    const rank = (p: string) => (this.g.person(p)?.gender === 'male' ? 0 : this.g.person(p)?.gender === 'female' ? 1 : 2);
    return ps.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)).slice(0, 2);
  }

  /** p with siblings: brothers above (oldest first), then p, then sisters and others (oldest first). */
  siblingColumn(p: string, withSiblings: boolean): { ids: string[]; info: Map<string, { half: boolean; step?: boolean }> } {
    const info = new Map<string, { half: boolean; step?: boolean }>();
    if (!withSiblings) return { ids: [p], info };
    for (const s of this.g.siblingsOf(p)) info.set(s.id, { half: s.half, step: s.step });
    const order = byBirth(this.g);
    const sibs = [...info.keys()];
    const brothers = sibs.filter((s) => this.g.person(s)?.gender === 'male').sort(order);
    const rest = sibs.filter((s) => this.g.person(s)?.gender !== 'male').sort(order);
    return { ids: [...brothers, p, ...rest], info };
  }

  /** Spouses plus co-parents of the person's children, ordered by first child, then name. */
  partners(p: string): string[] {
    const set = new Set(this.g.spousesOf(p).map((e) => e.id));
    for (const c of this.g.childrenOf(p)) for (const e of this.g.parentsOf(c.id)) if (e.id !== p) set.add(e.id);
    const kids = this.g.childrenOf(p).map((c) => c.id);
    const first = (s: string) => Math.min(9999, ...kids.filter((c) => this.isParent(s, c)).map((c) => birthYear(this.g, c)));
    const order = byBirth(this.g);
    return [...set].sort((a, b) => first(a) - first(b) || order(a, b));
  }

  /**
   * An ancestor's block in outward coordinates: the ancestor's column is column 0 (x = 0), the
   * ancestor's card top at y = 0, parents in column 1 (father above mother), and so on.
   */
  pedigree(p: string, gen: number): Block {
    const b: Block = { nodes: [], edges: [], cont: new Map() };
    const sideOk = this.opts.level === 'everyone' || (this.opts.level === 'extended' && gen === 1) || this.exp(p);
    const hasSibs = this.g.siblingsOf(p).some((s) => !this.placed.has(s.id));
    const { ids, info } = this.siblingColumn(p, sideOk);
    const at = ids.indexOf(p);
    // Cousins: the children of the parents' brothers and sisters, in a column on the inner side
    // (outward column −1, next to the focus's generation), each level with their own parent.
    const cousinsOf = (id: string) =>
      gen === 1 && sideOk && id !== p ? this.g.childrenOf(id).map((c) => c.id).sort(byBirth(this.g)) : [];
    const rowsAt: number[] = [];
    let r = 0;
    for (const id of ids) {
      rowsAt.push(r);
      r += Math.max(1, cousinsOf(id).length);
    }
    const group: TreeNode[] = [];
    ids.forEach((id, i) => {
      const s = info.get(id);
      const n = this.node(id, id === p ? 'ancestor' : 'relative', gen, 0, (rowsAt[i] - rowsAt[at]) * RP, id === p ? {} : { half: s?.half || undefined, step: s?.step || undefined });
      group.push(n);
      b.nodes.push(n);
    });
    ids.forEach((id, i) => {
      const un = group[i];
      if (un.dupOf) return;
      const yu = un.y + H2;
      const xb = -W2 - GX * 0.65;
      cousinsOf(id).forEach((c, j) => {
        const cn = this.node(c, 'relative', 0, -PC, un.y + j * RP);
        b.nodes.push(cn);
        extend(b.cont, -2, cn.y, cn.y + CARD.h);
        const yc = cn.y + H2;
        b.edges.push(this.edge(this.descentKind(id, c), [[-W2, yu], [xb, yu], [xb, yc], [-PC + W2, yc]], id, c));
      });
    });
    const pn = group[at];
    if (!sideOk && hasSibs && !pn.dupOf) pn.expandable = { ...pn.expandable, side: true };
    extend(b.cont, 0, group[0].y, group[group.length - 1].y + CARD.h);
    if (pn.dupOf) return b;

    const ps = this.parents(p);
    if (!ps.length) return b;
    if (gen + 1 > this.up && !this.exp(p)) {
      pn.expandable = { ...pn.expandable, up: true };
      return b;
    }
    // Parents' blocks, father's packed above mother's, then centred on the sibling column.
    const blocks = ps.map((q) => {
      const blk = this.pedigree(q, gen + 1);
      moveBlock(blk, 1, 0);
      return blk;
    });
    const tops = [0, 0];
    if (blocks.length === 2) {
      let off: number | undefined;
      for (const [k, [t]] of blocks[1].cont) {
        const a = blocks[0].cont.get(k);
        if (!a) continue;
        const need = a[1] + (k % 2 === 0 ? GY : 10) - t;
        off = off === undefined ? need : Math.max(off, need);
      }
      tops[1] = Math.max(off ?? RP, RP);
      moveBlock(blocks[1], 0, tops[1]);
    }
    const groupMid = (group[0].y + group[group.length - 1].y) / 2;
    const pairMid = (tops[0] + tops[blocks.length - 1]) / 2;
    const dy = groupMid - pairMid;
    blocks.forEach((blk) => moveBlock(blk, 0, dy));

    // Bracket in the gap between column 0 and column 1.
    const xb = PC / 2;
    let lo = Infinity;
    let hi = -Infinity;
    ps.forEach((q, i) => {
      const yq = tops[i] + dy + H2;
      for (const c of group) {
        const cid = c.personId!;
        if (!this.isParent(q, cid)) continue;
        const yc = c.y + H2;
        b.edges.push(this.edge(this.descentKind(q, cid), [[PC - W2, yq], [xb, yq], [xb, yc], [W2, yc]], q, cid));
        lo = Math.min(lo, yq, yc);
        hi = Math.max(hi, yq, yc);
      }
    });
    if (lo < hi) extend(b.cont, 1, lo, hi);
    blocks.forEach((blk) => absorb(b, blk));
    return b;
  }

  build(): void {
    const g = this.g;
    const f = this.opts.focusId;
    const level = this.opts.level;
    const down = this.opts.down ?? (level === 'everyone' ? MANY : 3);

    // ---- the middle: siblings | children | grandchildren … | spouses ------------------------
    const { ids: column, info } = this.siblingColumn(f, true);
    interface DTree { id: string; kids: DTree[]; rows: number; closed: boolean }
    const seen = new Set<string>([...column]);
    /** A descendant at `depth` (1 = child) with their own descendants down to `max` (+1 if expanded). */
    const tree = (id: string, depth: number, max: number): DTree => {
      const all = seen.has(id) ? [] : g.childrenOf(id).map((c) => c.id).sort(byBirth(g));
      seen.add(id);
      const allow = depth < max || this.exp(id);
      const kids = allow ? all.map((k) => tree(k, depth + 1, depth < max ? max : depth + 1)) : [];
      return { id, kids, rows: Math.max(1, kids.reduce((n, k) => n + k.rows, 0)), closed: !allow && all.length > 0 };
    };
    const depthOf = (t: DTree): number => 1 + Math.max(0, ...t.kids.map(depthOf));
    interface Band { id: string; partners: { id: string; kids: DTree[] }[]; solo: DTree[]; open: boolean }
    const bands: Band[] = column.map((id) => {
      const open = id === f ? down >= 1 : level !== 'immediate' || this.exp(id);
      if (!open) return { id, partners: [], solo: [], open };
      const max = id === f || level === 'everyone' ? down : 1;
      const partners = this.partners(id);
      const kids = g.childrenOf(id).map((c) => c.id).sort(byBirth(g));
      const used = new Set<string>();
      const ps = partners.map((sp) => {
        const k = kids.filter((c) => !used.has(c) && this.isParent(sp, c));
        k.forEach((c) => used.add(c));
        return { id: sp, kids: k.map((c) => tree(c, 1, max)) };
      });
      return { id, partners: ps, solo: kids.filter((c) => !used.has(c)).map((c) => tree(c, 1, max)), open };
    });
    const allTrees = bands.flatMap((bd) => [...bd.partners.flatMap((p) => p.kids), ...bd.solo]);
    const D = Math.max(0, ...allTrees.map(depthOf)); // descendant columns
    const anySpouse = bands.some((bd) => bd.partners.length);
    const xS = 0;
    const xCol = (d: number) => d * PC;
    const xP = (D + 1) * PC;
    const xLast = anySpouse ? xP : xCol(D); // the right-most middle column

    // Rows: each sibling's band, the focus's row at y = 0.
    let row = 0;
    const rowsOf = bands.map((bd) => {
      const sub = bd.partners.map((p) => Math.max(1, p.kids.reduce((n, k) => n + k.rows, 0)));
      const n = Math.max(1, sub.reduce((a, b) => a + b, 0) + bd.solo.reduce((n, k) => n + k.rows, 0));
      const start = row;
      row += n;
      return { start, n };
    });
    const focusRow = rowsOf[column.indexOf(f)].start;
    const yRow = (r: number) => (r - focusRow) * RP;
    const blockTop = yRow(0);

    /** Place a descendant tree with its top at row r in column d; returns its card. */
    const place = (t: DTree, d: number, r: number, role: TreeNode['role']): TreeNode => {
      const n = this.node(t.id, role, -d, xCol(d), yRow(r));
      if (t.closed && !n.dupOf) n.expandable = { down: true };
      let rr = r;
      const xb = xCol(d) + W2 + GX / 2;
      for (const k of t.kids) {
        const kn = place(k, d + 1, rr, role);
        rr += k.rows;
        const yp = n.y + H2;
        const yk = kn.y + H2;
        this.edges.push(this.edge(this.descentKind(t.id, k.id), [[xCol(d) + W2, yp], [xb, yp], [xb, yk], [xCol(d + 1) - W2, yk]], t.id, k.id));
      }
      return n;
    };

    // The focus first so it is the primary card if anyone repeats.
    const order = [column.indexOf(f), ...column.map((_, i) => i).filter((i) => column[i] !== f)];
    const sibNodes = new Map<string, TreeNode>();
    const fNode = this.node(f, 'focus', 0, xS, yRow(focusRow));
    sibNodes.set(f, fNode);
    for (const i of order) {
      const bd = bands[i];
      const { start } = rowsOf[i];
      const ys = yRow(start);
      const sNode = bd.id === f ? fNode : this.node(bd.id, 'sibling', 0, xS, ys, { half: info.get(bd.id)?.half || undefined, step: info.get(bd.id)?.step || undefined });
      sibNodes.set(bd.id, sNode);
      if (!bd.open) {
        if (!sNode.dupOf && (g.spousesOf(bd.id).length || g.childrenOf(bd.id).length)) sNode.expandable = { down: true };
        continue;
      }
      if (sNode.dupOf) continue;
      const kidRole: TreeNode['role'] = bd.id === f ? 'descendant' : 'relative';
      const xs2 = xS + W2 + GX * 0.65; // this sibling's bracket
      const xp = xP - W2 - GX / 2; // the spouse's bracket
      const x1R = xCol(1) + W2 + GX * 0.3; // where a spouse's line reaches a child past the grandchildren
      const yS = ys + H2;
      let r = start;
      const allKids: TreeNode[] = [];
      const addKids = (ts: DTree[]) => ts.map((t) => {
        const n = place(t, 1, r, kidRole);
        r += t.rows;
        allKids.push(n);
        return n;
      });
      bd.partners.forEach((p, j) => {
        const subStart = r;
        const pNode = this.node(p.id, 'spouse', 0, xP, yRow(subStart));
        const kids = addKids(p.kids);
        if (!kids.length) r = subStart + 1;
        const yP = pNode.y + H2;
        const sub = g.spousesOf(bd.id).find((e) => e.id === p.id)?.subtype;
        const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
        // A couple with children is already joined through the children's lines: no extra line.
        if (!kids.length && j === 0) {
          this.edges.push(this.edge(kind, [[xS + W2, yS], [xP - W2, yP]], bd.id, p.id));
        } else if (!kids.length) {
          // A later partner without children: down the sibling's bracket, under the row, up to the partner.
          const yBelow = yRow(r) - GY * 0.35;
          this.edges.push(this.edge(kind, [[xS + W2, yS], [xs2, yS], [xs2, yBelow], [xp, yBelow], [xp, yP], [xP - W2, yP]], bd.id, p.id));
        }
        for (const k of kids) {
          const yk = k.y + H2;
          const pts: [number, number][] = D <= 1
            ? [[xP - W2, yP], [xp, yP], [xp, yk], [xCol(1) + W2, yk]]
            // Grandchildren sit between: go through the gap above the child's rows, then in from the right.
            : [[xP - W2, yP], [xp, yP], [xp, k.y - GY / 2], [x1R, k.y - GY / 2], [x1R, yk], [xCol(1) + W2, yk]];
          this.edges.push(this.edge(this.descentKind(p.id, k.personId!), pts, p.id, k.personId!));
        }
      });
      addKids(bd.solo);
      for (const k of allKids) {
        const yk = k.y + H2;
        this.edges.push(this.edge(this.descentKind(bd.id, k.personId!), [[xS + W2, yS], [xs2, yS], [xs2, yk], [xCol(1) - W2, yk]], bd.id, k.personId!));
      }
    }

    // ---- parents: father's side to the left, mother's side to the right --------------------
    // Each side: [parent's column] [cousins column, if any] next to the middle. The parent's line to the
    // focus's generation runs in the gaps, over the top of the cousins and the middle where needed.
    const ps = this.parents(f);
    const sibYs = column.map((id) => sibNodes.get(id)!.y);
    const midTop = (Math.min(...sibYs) + Math.max(...sibYs)) / 2; // card top of a card centred on the column
    const dad = ps.find((p) => g.person(p)?.gender === 'male') ?? (ps.length === 2 ? ps[0] : undefined);
    const mom = ps.find((p) => p !== dad);
    if (this.up >= 1) {
      const side = (parent: string, dir: -1 | 1) => {
        const blk = this.pedigree(parent, 1);
        const cousins = blk.nodes.filter((n) => n.x < 0);
        const inner = dir < 0 ? xS : xLast; // the middle column this side touches
        const xPar = inner + dir * PC * (cousins.length ? 2 : 1);
        for (const n of blk.nodes) {
          n.x = xPar + dir * n.x;
          n.y += midTop;
        }
        for (const e of blk.edges) for (const pt of e.points) {
          pt[0] = xPar + dir * pt[0];
          pt[1] += midTop;
        }
        this.edges.push(...blk.edges);
        const yPar = midTop + H2;
        const xr = xPar - dir * (W2 + GX * 0.3); // gap on the parent's inner side
        const xs = dir < 0 ? xS - W2 - GX * 0.5 : xS + W2 + GX * 0.3; // gap beside the siblings
        const top = Math.min(blockTop, ...cousins.map((n) => n.y)) - GY / 2;
        const direct = dir < 0 && !cousins.length;
        for (const id of column) {
          if (!this.isParent(parent, id)) continue;
          const yc = sibNodes.get(id)!.y + H2;
          const edgeX = dir < 0 ? xS - W2 : xS + W2;
          const pts: [number, number][] = direct
            ? [[xPar + W2, yPar], [xs, yPar], [xs, yc], [edgeX, yc]]
            : [[xPar - dir * W2, yPar], [xr, yPar], [xr, top], [xs, top], [xs, yc], [edgeX, yc]];
          this.edges.push(this.edge(this.descentKind(parent, id), pts, parent, id));
        }
      };
      if (dad) side(dad, -1);
      else if (this.opts.ghosts) this.ghost('father', xS - PC, midTop);
      if (mom) side(mom, 1);
      else if (this.opts.ghosts) this.ghost('mother', xLast + PC, midTop);
    }

    // An expanded card keeps its control so it can be collapsed again.
    for (const n of this.nodes) if (n.expanded && !n.dupOf && !n.expandable) n.expandable = { down: true };

    // ---- regions for the background: father's side | siblings & descendants | mother's side ----
    const leftEdge = xS - PC / 2;
    const rightEdge = xLast + PC / 2;
    const sideColumns = (keep: (x: number) => boolean) => {
      const gens = new Map<number, Map<number, number>>();
      for (const n of this.nodes) {
        if (!keep(n.x)) continue;
        const m = gens.get(n.x) ?? new Map<number, number>();
        m.set(n.generation, (m.get(n.generation) ?? 0) + 1);
        gens.set(n.x, m);
      }
      return [...gens].sort((a, b) => a[0] - b[0]).map(([x, m]) => {
        const gen = [...m].sort((a, b) => b[1] - a[1])[0][0];
        return { x, label: gen === 0 ? 'Cousins' : generationLabel(gen) };
      });
    };
    const fatherCols = sideColumns((x) => x < leftEdge);
    const motherCols = sideColumns((x) => x > rightEdge);
    const middleCols: { x: number; label: string }[] = [{ x: xS, label: fNode.personId && this.g.person(f)?.isMe ? 'You & siblings' : 'Siblings' }];
    for (let d = 1; d <= D; d++) middleCols.push({ x: xCol(d), label: generationLabel(-d) });
    if (anySpouse) middleCols.push({ x: xP, label: 'Spouses' });
    if (fatherCols.length) this.regions.push({ side: 'father', x0: -Infinity, x1: leftEdge, columns: fatherCols });
    this.regions.push({ side: 'middle', x0: leftEdge, x1: rightEdge, columns: middleCols });
    if (motherCols.length) this.regions.push({ side: 'mother', x0: rightEdge, x1: Infinity, columns: motherCols });
  }
}

/** Contract: `layoutFamily` with `orient: 'cross'`. */
export function layoutCross(graph: FamilyGraph, opts: TreeOptions): TreeLayout {
  if (!graph.person(opts.focusId)) return { nodes: [], edges: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  const c = new Cross(graph, opts);
  c.build();
  // Nodes made inside pedigree blocks are already in c.nodes (node() records every card once).
  const nodes = [...new Set(c.nodes)];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - W2);
    maxX = Math.max(maxX, n.x + W2);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + CARD.h);
  }
  for (const e of c.edges) for (const [x, y] of e.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // Open-ended regions reach the edge of the tree.
  const regions = c.regions.map((r) => ({ ...r, x0: Math.max(r.x0, minX - 20), x1: Math.min(r.x1, maxX + 20) }));
  return { nodes, edges: c.edges, bounds: { minX, maxX, minY, maxY }, regions };
}
