import { familyPathTree, kinship, pathInTree, type FamilyGraph } from './kinship';
import {
  CARD,
  type TreeEdge as GraphEdge,
  type TreeLayout as GraphLayout,
  type TreeNode as GraphNode,
  type TreeOptions,
} from './graph/contract';

const DEF = { w: 156, h: 64, gap: 18, row: 118 };
export const CARD_W = DEF.w;
export const CARD_H = DEF.h;

export interface TreeNode {
  key: string;
  personId?: string;
  ghost?: 'father' | 'mother';
  /** Centre x and top y. */
  x: number;
  y: number;
  focus?: boolean;
  role: 'focus' | 'ancestor' | 'sibling' | 'spouse' | 'descendant' | 'descendant-spouse' | 'ghost';
}

export interface TreeLayout {
  nodes: TreeNode[];
  paths: string[];
  /** dashed lines (marriages) */
  marriages: string[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function birthKey(g: FamilyGraph, id: string) {
  const b = g.person(id)?.birthDate;
  return b ? parseInt(b, 10) || 9999 : 9999;
}

function sortParents(g: FamilyGraph, ids: string[]) {
  const rank = (id: string) => (g.person(id)?.gender === 'male' ? 0 : g.person(id)?.gender === 'female' ? 1 : 2);
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/**
 * Hourglass family-tree layout centred on `focusId`:
 * ancestors above, siblings left, spouses right, descendants below.
 */
export function layoutTree(
  g: FamilyGraph,
  focusId: string,
  opts: { up?: number; down?: number; ghosts?: boolean; card?: { w: number; h: number; gap: number; row: number } } = {},
): TreeLayout {
  const CARD_W = opts.card?.w ?? DEF.w;
  const CARD_H = opts.card?.h ?? DEF.h;
  const GAP = opts.card?.gap ?? DEF.gap;
  const ROW = opts.card?.row ?? DEF.row;
  const maxUp = opts.up ?? 5;
  const maxDown = opts.down ?? 4;
  const nodes: TreeNode[] = [];
  const paths: string[] = [];
  const marriages: string[] = [];
  const placed = new Set<string>();
  const yOf = (gen: number) => -gen * ROW; // gen>0 = ancestors (up)

  const ancParents = (id: string) => sortParents(g, g.parentsOf(id).filter((e) => e.subtype !== 'step').map((e) => e.id));

  // ---------- ancestor widths
  const aw = new Map<string, number>();
  const ancWidth = (id: string, depth: number, seen: Set<string>): number => {
    const ps = depth < maxUp ? ancParents(id).filter((p) => !seen.has(p)) : [];
    let w = CARD_W;
    if (ps.length) {
      const next = new Set(seen);
      ps.forEach((p) => next.add(p));
      const sum = ps.reduce((s, p) => s + ancWidth(p, depth + 1, next), 0) + GAP * (ps.length - 1);
      w = Math.max(CARD_W, sum);
    }
    aw.set(id + '@' + depth, w);
    return w;
  };

  const placeAncestors = (childXs: number[], childGen: number, parentsList: string[], centerX: number, depth: number) => {
    if (!parentsList.length || depth > maxUp) return;
    const widths = parentsList.map((p) => aw.get(p + '@' + depth) ?? CARD_W);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (parentsList.length - 1);
    let cursor = centerX - total / 2;
    const gen = childGen + 1;
    const xs: number[] = [];
    parentsList.forEach((p, i) => {
      const cx = cursor + widths[i] / 2;
      cursor += widths[i] + GAP;
      xs.push(cx);
      placed.add(p);
      nodes.push({ key: 'a:' + p, personId: p, x: cx, y: yOf(gen), role: 'ancestor' });
      const gp = depth < maxUp ? ancParents(p).filter((x) => !placed.has(x)) : [];
      placeAncestors([cx], gen, gp, cx, depth + 1);
    });
    connect(xs, yOf(gen), childXs, yOf(childGen));
  };

  /** Couple line between parents, drop to a bar, then to each child. */
  const connect = (parentXs: number[], parentY: number, childXs: number[], childY: number) => {
    const midY = parentY + CARD_H / 2;
    const px = parentXs.reduce((a, b) => a + b, 0) / parentXs.length;
    if (parentXs.length > 1) {
      const l = Math.min(...parentXs);
      const r = Math.max(...parentXs);
      marriages.push(`M ${l + CARD_W / 2} ${midY} H ${r - CARD_W / 2}`);
    }
    const barY = childY - (childY - (parentY + CARD_H)) / 2;
    const startY = parentXs.length > 1 ? midY : parentY + CARD_H;
    let d = `M ${px} ${startY} V ${barY}`;
    const lx = Math.min(px, ...childXs);
    const rx = Math.max(px, ...childXs);
    if (rx > lx) d += ` M ${lx} ${barY} H ${rx}`;
    for (const cx of childXs) d += ` M ${cx} ${barY} V ${childY}`;
    paths.push(d);
  };

  // ---------- centre row
  const focusParents = ancParents(focusId);
  const siblings = g
    .siblingsOf(focusId)
    .map((s) => s.id)
    .sort((a, b) => birthKey(g, a) - birthKey(g, b));
  const focusBirth = birthKey(g, focusId);
  const older = siblings.filter((s) => birthKey(g, s) <= focusBirth);
  const younger = siblings.filter((s) => birthKey(g, s) > focusBirth);
  const spouses = g.spousesOf(focusId).map((s) => s.id);

  const step = CARD_W + GAP;
  placed.add(focusId);
  nodes.push({ key: 'f:' + focusId, personId: focusId, x: 0, y: 0, focus: true, role: 'focus' });
  // Spouses sit directly right of focus; younger siblings go left of older ones? Keep birth order left→right
  // with focus in the middle: older siblings on the left, younger ones further left past them is confusing,
  // so younger siblings go to the right after spouses.
  const spouseXs: number[] = [];
  spouses.forEach((s, i) => {
    const x = (i + 1) * step;
    spouseXs.push(x);
    placed.add(s);
    nodes.push({ key: 's:' + s, personId: s, x, y: 0, role: 'spouse' });
    marriages.push(`M ${(i === 0 ? 0 : spouseXs[i - 1]) + CARD_W / 2} ${CARD_H / 2} H ${x - CARD_W / 2}`);
  });
  const siblingXs: number[] = [];
  older.reverse().forEach((s, i) => {
    const x = -(i + 1) * step;
    siblingXs.push(x);
    placed.add(s);
    nodes.push({ key: 'b:' + s, personId: s, x, y: 0, role: 'sibling' });
  });
  const rightStart = (spouses.length + 1) * step + (spouses.length ? GAP * 2 : 0);
  younger.forEach((s, i) => {
    const x = rightStart + i * step;
    siblingXs.push(x);
    placed.add(s);
    nodes.push({ key: 'b:' + s, personId: s, x, y: 0, role: 'sibling' });
  });

  // ---------- ancestors
  const childXs = [0, ...siblingXs];
  const sibCenter = (Math.min(...childXs) + Math.max(...childXs)) / 2;
  if (maxUp > 0) {
    const seen = new Set<string>([focusId, ...focusParents]);
    focusParents.forEach((p) => ancWidth(p, 1, seen));
    let parentsToPlace = focusParents;
    if (opts.ghosts) {
      const hasDad = focusParents.some((p) => g.person(p)?.gender === 'male');
      const hasMom = focusParents.some((p) => g.person(p)?.gender === 'female');
      if (focusParents.length < 2) {
        const ghosts: string[] = [];
        if (!hasDad) ghosts.push('~father');
        if (!hasMom) ghosts.push('~mother');
        parentsToPlace = sortParents(g, [...focusParents, ...ghosts.slice(0, 2 - focusParents.length)]);
        // ghosts: father first
        parentsToPlace.sort((a, b) => (a === '~father' ? -1 : b === '~father' ? 1 : a === '~mother' ? 1 : b === '~mother' ? -1 : 0));
      }
    }
    const widths = parentsToPlace.map((p) => (p.startsWith('~') ? CARD_W : aw.get(p + '@1') ?? CARD_W));
    const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, parentsToPlace.length - 1);
    let cursor = sibCenter - total / 2;
    const pxs: number[] = [];
    parentsToPlace.forEach((p, i) => {
      const cx = cursor + widths[i] / 2;
      cursor += widths[i] + GAP;
      pxs.push(cx);
      if (p.startsWith('~')) {
        nodes.push({ key: 'g:' + p, ghost: p === '~father' ? 'father' : 'mother', x: cx, y: yOf(1), role: 'ghost' });
      } else {
        placed.add(p);
        nodes.push({ key: 'a:' + p, personId: p, x: cx, y: yOf(1), role: 'ancestor' });
        placeAncestors([cx], 1, ancParents(p).filter((x) => !placed.has(x)), cx, 2);
      }
    });
    if (pxs.length) connect(pxs, yOf(1), childXs, 0);
  }

  // ---------- descendants
  const dw = new Map<string, number>();
  const kids = (id: string) =>
    g
      .childrenOf(id)
      .map((c) => c.id)
      .filter((c) => c !== focusId)
      .sort((a, b) => birthKey(g, a) - birthKey(g, b));
  const unitW = (id: string) => {
    const n = g.spousesOf(id).filter((s) => !placed.has(s.id)).length;
    return CARD_W + n * step;
  };
  const descWidth = (id: string, depth: number, seen: Set<string>): number => {
    const cs = depth < maxDown ? kids(id).filter((c) => !seen.has(c)) : [];
    cs.forEach((c) => seen.add(c));
    const sum = cs.reduce((s, c) => s + descWidth(c, depth + 1, seen), 0) + GAP * Math.max(0, cs.length - 1);
    const w = Math.max(unitW(id), sum);
    dw.set(id, w);
    return w;
  };
  const placeChildren = (parentXs: number[], parentGen: number, children: string[], centerX: number, depth: number) => {
    if (!children.length) return;
    const widths = children.map((c) => dw.get(c) ?? CARD_W);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (children.length - 1);
    let cursor = centerX - total / 2;
    const cxs: number[] = [];
    const gen = parentGen - 1;
    children.forEach((c, i) => {
      const w = widths[i];
      const uw = unitW(c);
      const cx = cursor + w / 2 - (uw - CARD_W) / 2;
      cursor += w + GAP;
      cxs.push(cx);
      placed.add(c);
      nodes.push({ key: 'd:' + c, personId: c, x: cx, y: yOf(gen), role: 'descendant' });
      const sps = g.spousesOf(c).map((s) => s.id).filter((s) => !placed.has(s));
      const coupleXs = [cx];
      sps.forEach((s, j) => {
        const sx = cx + (j + 1) * step;
        placed.add(s);
        coupleXs.push(sx);
        nodes.push({ key: 'ds:' + s + ':' + c, personId: s, x: sx, y: yOf(gen), role: 'descendant-spouse' });
        marriages.push(`M ${sx - step + CARD_W / 2} ${yOf(gen) + CARD_H / 2} H ${sx - CARD_W / 2}`);
      });
      const gk = depth < maxDown ? kids(c).filter((x) => !placed.has(x)) : [];
      const mid = coupleXs.length > 1 ? (coupleXs[0] + coupleXs[1]) / 2 : cx;
      placeChildren(coupleXs.slice(0, 2), gen, gk, mid, depth + 1);
    });
    const midTop = parentXs.length > 1 ? (parentXs[0] + parentXs[1]) / 2 : parentXs[0];
    const parentY = yOf(parentGen);
    const childY = yOf(gen);
    const startY = parentXs.length > 1 ? parentY + CARD_H / 2 : parentY + CARD_H;
    const barY = childY - (childY - (parentY + CARD_H)) / 2;
    let d = `M ${midTop} ${startY} V ${barY}`;
    const lx = Math.min(midTop, ...cxs);
    const rx = Math.max(midTop, ...cxs);
    if (rx > lx) d += ` M ${lx} ${barY} H ${rx}`;
    for (const cx of cxs) d += ` M ${cx} ${barY} V ${childY}`;
    paths.push(d);
  };
  if (maxDown > 0) {
    const myKids = kids(focusId).filter((c) => !placed.has(c));
    const seen = new Set<string>(myKids);
    myKids.forEach((c) => descWidth(c, 1, seen));
    const coupleXs = spouseXs.length ? [0, spouseXs[0]] : [0];
    const mid = coupleXs.length > 1 ? (coupleXs[0] + coupleXs[1]) / 2 : 0;
    placeChildren(coupleXs, 0, myKids, mid, 1);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - CARD_W / 2);
    maxX = Math.max(maxX, n.x + CARD_W / 2);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + CARD_H);
  }
  return { nodes, paths, marriages, minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// Graph contract (src/lib/graph/contract.ts)

/** The ids along the shortest family path from a to b (inclusive); [] if not family-connected. */
export function relationPath(graph: FamilyGraph, a: string, b: string): string[] {
  if (a === b) return graph.person(a) ? [a] : [];
  const tree = familyPathTree(graph, a, b);
  const path = pathInTree(graph, tree, a, b);
  return path ? [a, ...path.steps.map((s) => s.id)] : [];
}

/** Labels for everyone family-connected to `egoId`, from ONE path search (never per card). */
export function labelsFor(graph: FamilyGraph, egoId: string): Map<string, { label: string; path: string }> {
  const out = new Map<string, { label: string; path: string }>();
  if (!graph.person(egoId)) return out;
  const aAnc = graph.ancestors(egoId);
  const tree = familyPathTree(graph, egoId);
  for (const id of graph.familyComponent(egoId)) {
    if (id.startsWith('~') || !graph.person(id)) continue;
    const kin = kinship(graph, egoId, id, aAnc, pathInTree(graph, tree, egoId, id) ?? null);
    if (kin) out.set(id, { label: kin.label, path: kin.path });
  }
  return out;
}

const ROLE_MAP: Record<TreeNode['role'], GraphNode['role']> = {
  focus: 'focus',
  ancestor: 'ancestor',
  sibling: 'sibling',
  spouse: 'spouse',
  descendant: 'descendant',
  'descendant-spouse': 'spouse',
  ghost: 'ghost',
};

/** Split an "M x y V y H x …" SVG path into polylines (one per M). */
function parsePolylines(d: string): [number, number][][] {
  const out: [number, number][][] = [];
  const tok = d.trim().split(/\s+/);
  let cur: [number, number][] | undefined;
  let x = 0;
  let y = 0;
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i];
    if (c === 'M') {
      x = Number(tok[++i]);
      y = Number(tok[++i]);
      cur = [[x, y]];
      out.push(cur);
    } else if (c === 'V') {
      y = Number(tok[++i]);
      cur?.push([x, y]);
    } else if (c === 'H') {
      x = Number(tok[++i]);
      cur?.push([x, y]);
    } else if (c === 'L') {
      x = Number(tok[++i]);
      y = Number(tok[++i]);
      cur?.push([x, y]);
    }
  }
  return out.filter((p) => p.length > 1);
}

/**
 * TEMPORARY adapter: the contract's `layoutFamily` on top of the old hourglass `layoutTree`,
 * until the real engine (src/lib/familyLayout.ts) lands.
 * TODO: honour opts.level and opts.expanded (ignored here; always the 'immediate' view).
 * Edge from/to are best-effort (nearest card to each polyline end); descent polylines are
 * split per segment, so a bar segment may name two siblings rather than parent → child.
 */
export function layoutFamily(graph: FamilyGraph, opts: TreeOptions): GraphLayout {
  const card = { w: CARD.w, h: CARD.h, gap: CARD.gapX, row: CARD.rowH };
  const old = layoutTree(graph, opts.focusId, { up: opts.up ?? 4, down: opts.down ?? 3, ghosts: opts.ghosts, card });
  const nodes: GraphNode[] = old.nodes.map((n) => {
    const role = ROLE_MAP[n.role];
    const id = n.personId ?? '~' + (n.ghost ?? 'ghost');
    const node: GraphNode = {
      key: role + ':' + id,
      x: n.x,
      y: n.y,
      generation: Math.round(-n.y / CARD.rowH) || 0,
      role,
    };
    if (n.personId) node.personId = n.personId;
    if (n.ghost) node.ghost = n.ghost;
    return node;
  });
  // Nearest card (centre of the card box) to a point; ghosts map to ''.
  const nearest = (p: [number, number]) => {
    let best = '';
    let bd = Infinity;
    for (const n of nodes) {
      const d = Math.abs(n.x - p[0]) + Math.abs(n.y + CARD.h / 2 - p[1]);
      if (d < bd) {
        bd = d;
        best = n.personId ?? '';
      }
    }
    return best;
  };
  const edges: GraphEdge[] = [];
  const push = (kind: GraphEdge['kind'], d: string) => {
    for (const points of parsePolylines(d)) {
      edges.push({
        key: kind + ':' + edges.length,
        kind,
        points,
        from: nearest(points[0]),
        to: nearest(points[points.length - 1]),
      });
    }
  };
  old.marriages.forEach((d) => push('marriage', d));
  old.paths.forEach((d) => push('descent', d));
  return { nodes, edges, bounds: { minX: old.minX, maxX: old.maxX, minY: old.minY, maxY: old.maxY } };
}
