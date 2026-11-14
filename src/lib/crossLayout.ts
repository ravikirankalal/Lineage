import { CARD, type TreeEdge, type TreeLayout, type TreeNode, type TreeOptions, type TreeRegion } from './graph/contract';
import { generationLabel } from './generationBands';
import type { FamilyGraph } from './kinship';

/**
 * "Cross" family layout (the owner's design for tall phone screens), centred on the focus:
 *
 *   [father's side] ← [cousins, siblings & spouses] → [mother's side]
 *
 * - Middle: the focus and their siblings in one column, brothers ABOVE the focus and sisters (and
 *   siblings of unknown gender) BELOW, each group oldest first. Each sibling's spouse sits directly below
 *   them in the same column, joined by a short marriage line. Cousins share this column too (the owner's
 *   choice): children of the parents' brothers above, children of the parents' sisters below, each level
 *   with their own parent. Children are not shown in this view (the owner's choice); the other layouts are.
 * - Left: the father, with his brothers above him and sisters below; his parents one column further
 *   left (father's father above father's mother), and so on outwards. Right: the same for the mother,
 *   mirrored. So every step outwards is one generation older.
 * - Lines only run through the gaps between columns and rows, so no line crosses a card.
 *
 * Levels: immediate (siblings without their spouses, ancestors' siblings hidden), extended (+ siblings'
 * spouses, parents' brothers and sisters with their children), everyone (+ every ancestor's brothers and
 * sisters, all generations up). `expanded` shows one sibling's spouse or one ancestor's siblings/parents.
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
  /** An ancestor with their brothers (above) and sisters (below), when the level shows them. */
  ancestorGroup(p: string, gen: number) {
    const sideOk = this.opts.level === 'everyone' || (this.opts.level === 'extended' && gen === 1) || this.exp(p);
    return { sideOk, ...this.siblingColumn(p, sideOk) };
  }

  /**
   * `relY` (parents only): where each of the parent's brothers and sisters sits, relative to the parent,
   * so each is level with their children (the cousins) in the middle column.
   */
  pedigree(p: string, gen: number, relY?: Map<string, number>): Block {
    const b: Block = { nodes: [], edges: [], cont: new Map() };
    const hasSibs = this.g.siblingsOf(p).some((s) => !this.placed.has(s.id));
    const { ids, info, sideOk } = this.ancestorGroup(p, gen);
    const at = ids.indexOf(p);
    const group: TreeNode[] = [];
    ids.forEach((id, i) => {
      const s = info.get(id);
      const y = relY?.get(id) ?? (i - at) * RP;
      const n = this.node(id, id === p ? 'ancestor' : 'relative', gen, 0, y, id === p ? {} : { half: s?.half || undefined, step: s?.step || undefined });
      group.push(n);
      b.nodes.push(n);
    });
    const pn = group[at];
    if (!sideOk && hasSibs && !pn.dupOf) pn.expandable = { ...pn.expandable, side: true };
    extend(b.cont, 0, Math.min(...group.map((n) => n.y)), Math.max(...group.map((n) => n.y)) + CARD.h);
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
    const groupMid = (Math.min(...group.map((n) => n.y)) + Math.max(...group.map((n) => n.y))) / 2;
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

    // ---- the middle column: cousins, siblings and spouses (no children in this view) -----------
    // From the top: children of the father's brothers, children of the mother's brothers, then the focus's
    // brothers, the focus, sisters (each spouse below their partner), then children of the father's
    // sisters and of the mother's sisters. Each parent's brothers sit above them and sisters below, level
    // with their own children here, so every line runs straight across.
    const { ids: column, info } = this.siblingColumn(f, true);
    interface Band { id: string; partners: string[]; open: boolean }
    const bands: Band[] = column.map((id) => {
      const open = id === f || level !== 'immediate' || this.exp(id);
      return { id, partners: open ? this.partners(id) : [], open };
    });
    const xS = 0;
    const xLast = xS; // the middle is one column
    const ps = this.up >= 1 ? this.parents(f) : [];
    const dad = ps.find((p) => g.person(p)?.gender === 'male') ?? (ps.length === 2 ? ps[0] : undefined);
    const mom = ps.find((p) => p !== dad);
    const groups = new Map<string, ReturnType<Cross['ancestorGroup']>>();
    for (const p of [dad, mom]) if (p) groups.set(p, this.ancestorGroup(p, 1));

    let row = 0;
    const uncleRow = new Map<string, number>();
    const cousinRows: { parent: string; uncle: string; kids: string[]; row: number }[] = [];
    const addUncles = (parent: string | undefined, part: 'above' | 'below') => {
      const grp = parent ? groups.get(parent) : undefined;
      if (!parent || !grp) return;
      const at = grp.ids.indexOf(parent);
      for (const u of part === 'above' ? grp.ids.slice(0, at) : grp.ids.slice(at + 1)) {
        const kids = grp.sideOk ? g.childrenOf(u).map((c) => c.id).sort(byBirth(g)) : [];
        uncleRow.set(u, row);
        cousinRows.push({ parent, uncle: u, kids, row });
        row += Math.max(1, kids.length);
      }
    };
    addUncles(dad, 'above');
    addUncles(mom, 'above');
    // Each sibling, then their spouses directly below them.
    const rowsOf = bands.map((bd) => {
      const start = row;
      row += 1 + bd.partners.length;
      return { start };
    });
    addUncles(dad, 'below');
    addUncles(mom, 'below');
    const focusRow = rowsOf[column.indexOf(f)].start;
    const yRow = (r: number) => (r - focusRow) * RP;

    // The focus first so it is the primary card if anyone repeats.
    const order = [column.indexOf(f), ...column.map((_, i) => i).filter((i) => column[i] !== f)];
    const sibNodes = new Map<string, TreeNode>();
    // Spouse cards are made last: someone who also appears in their own birth family (a cousin who married
    // a sibling) gets their main card there, with their parents; the card beside the spouse is a secondary
    // "shown elsewhere" card that can't open their ancestors.
    const spouseCards: { id: string; y: number }[] = [];
    const fNode = this.node(f, 'focus', 0, xS, yRow(focusRow));
    sibNodes.set(f, fNode);
    for (const i of order) {
      const bd = bands[i];
      const { start } = rowsOf[i];
      const ys = yRow(start);
      const sNode = bd.id === f ? fNode : this.node(bd.id, 'sibling', 0, xS, ys, { half: info.get(bd.id)?.half || undefined, step: info.get(bd.id)?.step || undefined });
      sibNodes.set(bd.id, sNode);
      if (!bd.open) {
        if (!sNode.dupOf && g.spousesOf(bd.id).length) sNode.expandable = { down: true };
        continue;
      }
      if (sNode.dupOf) continue;
      const xLoop = xS - W2 - 10; // marriage line to a later partner, round the left of the column
      const yS = ys + H2;
      bd.partners.forEach((p, j) => {
        const py = yRow(start + 1 + j);
        spouseCards.push({ id: p, y: py });
        const sub = g.spousesOf(bd.id).find((e) => e.id === p)?.subtype;
        const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
        if (j === 0) this.edges.push(this.edge(kind, [[xS, ys + CARD.h], [xS, py]], bd.id, p));
        else this.edges.push(this.edge(kind, [[xS - W2, yS], [xLoop, yS], [xLoop, py + H2], [xS - W2, py + H2]], bd.id, p));
      });
    }

    // ---- parents: father's side to the left, mother's side to the right --------------------
    // Both parents sit level with the focus, each parent's brothers and sisters level with their
    // children in the middle column. Every line from that side reaches the middle through a bracket on
    // its own side of the column (father's left, mother's right), straight across.
    const parentTop = fNode.y;
    if (this.up >= 1) {
      const side = (parent: string, dir: -1 | 1) => {
        const relY = new Map<string, number>([[parent, 0]]);
        for (const [u, r] of uncleRow) relY.set(u, yRow(r) - parentTop);
        const blk = this.pedigree(parent, 1, relY);
        const xPar = (dir < 0 ? xS : xLast) + dir * PC;
        for (const n of blk.nodes) {
          n.x = xPar + dir * n.x;
          n.y += parentTop;
        }
        for (const e of blk.edges) for (const pt of e.points) {
          pt[0] = xPar + dir * pt[0];
          pt[1] += parentTop;
        }
        this.edges.push(...blk.edges);
        const xb = xS + dir * (W2 + GX * 0.5); // this side's bracket beside the middle column
        const edgeX = xS + dir * W2; // the middle cards' edge on this side
        const xFrom = xPar - dir * W2; // the parent column's inner edge
        // The parent to the focus and siblings.
        const yPar = parentTop + H2;
        for (const id of column) {
          if (!this.isParent(parent, id)) continue;
          const yc = sibNodes.get(id)!.y + H2;
          this.edges.push(this.edge(this.descentKind(parent, id), [[xFrom, yPar], [xb, yPar], [xb, yc], [edgeX, yc]], parent, id));
        }
        // Each brother or sister of the parent to their children, the cousins.
        for (const cr of cousinRows) {
          if (cr.parent !== parent) continue;
          const yu = yRow(cr.row) + H2;
          cr.kids.forEach((c, j) => {
            const cn = this.node(c, 'relative', 0, xS, yRow(cr.row + j));
            const yc = cn.y + H2;
            this.edges.push(this.edge(this.descentKind(cr.uncle, c), [[xFrom, yu], [xb, yu], [xb, yc], [edgeX, yc]], cr.uncle, c));
          });
        }
      };
      if (dad) side(dad, -1);
      else if (this.opts.ghosts) this.ghost('father', xS - PC, parentTop);
      if (mom) side(mom, 1);
      else if (this.opts.ghosts) this.ghost('mother', xLast + PC, parentTop);
    }
    for (const sc of spouseCards) this.node(sc.id, 'spouse', 0, xS, sc.y);

    // An expanded card keeps its control so it can be collapsed again.
    for (const n of this.nodes) if (n.expanded && !n.dupOf && !n.expandable) n.expandable = { down: true };

    // ---- regions for the background: father's side | your generation | mother's side ----
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
    const middleCols: { x: number; label: string }[] = []; // one column: the region's title says it
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
