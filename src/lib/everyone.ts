import { CARD, type TreeLayout, type TreeNode, type TreeOptions, type TreeRegion } from './graph/contract';
import { familyPathTree, kinship, pathInTree, type FamilyGraph } from './kinship';
import { layoutCross } from './crossLayout';
import { layoutFamilyV2 } from './familyLayout';
import { REGION_ROOM, SIDE } from './generationBands';

const GAP = 80; // between stacked trees, above the next tree's titles

/**
 * The cross layout, and in Everyone more trees stacked below it so everyone in the family is drawn
 * (the owner's design):
 * - No children or later generations (the owner's choice): nobody below the focus's generation is drawn,
 *   nor anyone reached only through them (a son's wife and her family).
 * - People who married in: anyone drawn whose own parents are recorded but not drawn (a grandmother,
 *   the spouse, a brother's wife, an uncle's wife, …) gets their own cross tree: their parents' sides
 *   and their brothers and sisters. That card is their main card; the one beside their spouse becomes
 *   the "shown elsewhere" copy. Someone with no recorded parents keeps a single card.
 * - Anyone in the family still not drawn after that (step-families, a parent of unknown gender, …): a
 *   top-to-bottom tree around the closest one, titled with how they're related.
 * The new trees are scanned the same way, until every person in the family is drawn.
 */
export function layoutCrossEveryone(graph: FamilyGraph, opts: TreeOptions): TreeLayout {
  return completeEveryone(graph, opts, layoutCross(graph, opts));
}

/**
 * Everyone, in any layout: the layout's own tree, then trees below it until every person in the family
 * is drawn. The cross layout adds married-in families first (above) and leaves out the generations below
 * the focus; the other layouts already draw in-laws and descendants, so they only get the last step.
 */
export function completeEveryone(graph: FamilyGraph, opts: TreeOptions, main: TreeLayout): TreeLayout {
  if (opts.level !== 'everyone' || !main.nodes.length) return main;
  const cross = opts.orient === 'cross';

  type Part = { layout: TreeLayout; root?: string; family: boolean };
  const parts: Part[] = [{ layout: main, family: false }];
  const shown = new Set<string>();
  const withParents = new Set<string>(); // people whose parents are drawn (a line comes into them)
  const note = (L: TreeLayout) => {
    for (const n of L.nodes) if (n.personId) shown.add(n.personId);
    for (const e of L.edges) if (e.kind === 'descent' || e.kind === 'step') withParents.add(e.to);
  };
  note(main);
  const familyDone = new Set<string>();
  const name = (id: string) => {
    const p = graph.person(id);
    return p?.nickname || p?.firstName || 'Their';
  };

  const kinOf = kinFrom(graph, opts.focusId);
  const kinLabel = (id: string) => kinOf(id)?.label;
  // Cross: people left out because a couple's children are collapsed stay out (unless drawn anyway).
  const hidden = new Set<string>(main.hidden ?? []);
  const skip = (id: string) => hidden.has(id) && !shown.has(id);
  const currentOrder = () => everyoneIds(graph, opts.focusId, cross, kinOf, skip);
  /** Add an extra tree. Cross: without anyone below the focus's generation or in a collapsed family. */
  const add = (L: TreeLayout, root: string) => {
    for (const id of L.hidden ?? []) hidden.add(id);
    if (cross) {
      const allowed = new Set(currentOrder());
      const gone = new Set(L.nodes.filter((n) => n.personId && !allowed.has(n.personId)).map((n) => n.personId!));
      if (gone.size) {
        L.nodes = L.nodes.filter((n) => !n.personId || !gone.has(n.personId));
        L.edges = L.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
      }
    }
    parts.push({ layout: L, root, family: true });
    note(L);
  };

  let i = 0;
  for (;;) {
    for (; i < parts.length; i++) scan(i);
    // Anyone in the family still not drawn (a step-parent's family, a parent of unknown gender, someone
    // linked only as a brother or sister, …): a top-to-bottom tree around the closest one, which draws
    // every kind of link. Their tree is scanned like the others. Each round draws at least that person.
    const x = currentOrder().find((id) => !shown.has(id));
    if (!x) break;
    const L = layoutFamilyV2(graph, { focusId: x, level: 'everyone', expanded: opts.expanded, up: 1, down: cross ? 0 : 1, noInLaws: true, orient: opts.orient === 'right' ? 'right' : 'down' });
    for (const n of L.nodes) if (n.role === 'focus') n.role = 'relative';
    const kin = kinLabel(x);
    L.regions = [{ side: 'middle', x0: L.bounds.minX - SIDE, x1: L.bounds.maxX + SIDE, columns: [], label: kin ? `${name(x)} · ${kin}` : `${name(x)}’s family` }];
    add(L, x);
  }
  if (parts.length === 1) return main;
  const out = stack(parts);
  const left = [...hidden].filter((id) => !shown.has(id));
  return left.length ? { ...out, hidden: left } : out;

  function scan(i: number) {
    if (!cross) return;
    const ids = [...new Set(parts[i].layout.nodes.filter((n) => n.personId && !n.dupOf).map((n) => n.personId!))];
    // The families of those who married in.
    for (const id of ids) {
      if (familyDone.has(id) || withParents.has(id) || !graph.bloodParents(id).length) continue;
      familyDone.add(id);
      const L = layoutCross(graph, { focusId: id, level: 'everyone', expanded: opts.expanded, orient: 'cross' });
      for (const n of L.nodes) if (n.role === 'focus') n.role = 'relative';
      const who = name(id);
      L.regions = (L.regions ?? []).map((r) => ({
        ...r,
        label: r.side === 'father' ? `${who}’s father’s side` : r.side === 'mother' ? `${who}’s mother’s side` : `${who}’s family`,
      }));
      add(L, id);
    }
  }
}

/**
 * Stack the trees top to bottom, one set of keys. Every tree shares the main tree's centre line (its own
 * focus card at x = 0, like the main focus), and every band reaches the same left and right edges, so the
 * trees and their bands line up (the owner's request).
 */
function stack(parts: { layout: TreeLayout; root?: string; family: boolean }[]): TreeLayout {
  const nodes: TreeNode[] = [];
  const edges: TreeLayout['edges'] = [];
  const regions: (TreeRegion & { part: number })[] = [];
  let bottom = -Infinity;
  const familyRoot = new Map<string, TreeNode>();
  const birth = new Set<string>(); // keys of cards joined to the person's parents

  parts.forEach((part, i) => {
    const L = part.layout;
    const pre = i === 0 ? '' : `t${i}/`;
    const top = L.bounds.minY - (L.regions?.length ? REGION_ROOM : 0);
    const dy = i === 0 ? 0 : bottom + GAP - top;
    const rootNode = part.root ? L.nodes.find((n) => n.personId === part.root && !n.dupOf) : undefined;
    const dx = i === 0 || !rootNode ? 0 : -rootNode.x;
    for (const n of L.nodes) {
      const m: TreeNode = { ...n, key: pre + n.key, x: n.x + dx, y: n.y + dy };
      if (n.dupOf) m.dupOf = pre + n.dupOf;
      if (part.family && n === rootNode) familyRoot.set(n.personId!, m);
      nodes.push(m);
    }
    for (const e of L.edges) edges.push({ ...e, key: pre + e.key, points: e.points.map(([x, y]) => [x + dx, y + dy]) });
    // Birth cards in this tree: a person's main card here when a line from a parent comes into them.
    const fromParents = new Set(L.edges.filter((e) => e.kind === 'descent' || e.kind === 'step').map((e) => e.to));
    for (const n of L.nodes) if (n.personId && !n.dupOf && fromParents.has(n.personId)) birth.add(pre + n.key);
    const y0 = L.bounds.minY + dy - REGION_ROOM;
    const y1 = L.bounds.maxY + dy + SIDE;
    for (const r of L.regions ?? []) {
      regions.push({ ...r, x0: r.x0 + dx, x1: r.x1 + dx, columns: r.columns.map((c) => ({ ...c, x: c.x + dx })), y0, y1, part: i });
    }
    bottom = Math.max(bottom, y1);
  });

  // One main card per person, the birth card when there is one (the owner's rule): the first card joined to
  // the person's parents (in their own family's tree, or wherever their parents are drawn); otherwise the
  // first main card drawn. Every other card of theirs is a "shown elsewhere" copy.
  const primary = new Map<string, TreeNode>();
  const focus = nodes.find((n) => n.role === 'focus' && !n.dupOf); // the focus always stays main in the main tree
  if (focus?.personId) primary.set(focus.personId, focus);
  for (const n of nodes) if (n.personId && !n.dupOf && birth.has(n.key) && !primary.has(n.personId)) primary.set(n.personId, n);
  for (const [id, n] of familyRoot) if (!primary.has(id)) primary.set(id, n);
  for (const n of nodes) if (n.personId && !n.dupOf && !primary.has(n.personId)) primary.set(n.personId, n);
  for (const n of nodes) {
    if (!n.personId) continue;
    const p = primary.get(n.personId);
    if (!p || p === n) {
      delete n.dupOf;
      continue;
    }
    n.dupOf = p.key;
    delete n.expandable;
    delete n.expanded;
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
  // Every band out to the same edges: the father's side (or a tree's only band) from the far left, the
  // mother's side (or the only band) to the far right.
  const left = Math.min(minX - SIDE, ...regions.map((r) => r.x0).filter(Number.isFinite));
  const right = Math.max(maxX + SIDE, ...regions.map((r) => r.x1).filter(Number.isFinite));
  const out: TreeRegion[] = regions.map(({ part, ...r }) => {
    const mine = regions.filter((q) => q.part === part);
    const hasFather = mine.some((q) => q.side === 'father');
    const hasMother = mine.some((q) => q.side === 'mother');
    if (r.side === 'father' || (r.side === 'middle' && !hasFather)) r.x0 = left;
    if (r.side === 'mother' || (r.side === 'middle' && !hasMother)) r.x1 = right;
    return r;
  });
  return { nodes, edges, bounds: { minX: Math.min(minX, left), maxX: Math.max(maxX, right), minY, maxY }, regions: out };
}

/** Kinship from `ego`'s view, from ONE path search. */
function kinFrom(graph: FamilyGraph, ego: string) {
  let get: ((id: string) => ReturnType<typeof kinship>) | undefined;
  const memo = new Map<string, ReturnType<typeof kinship>>();
  return (id: string) => {
    if (!get) {
      const aAnc = graph.ancestors(ego);
      const tree = familyPathTree(graph, ego);
      get = (x) => kinship(graph, ego, x, aAnc, pathInTree(graph, tree, ego, x) ?? null);
    }
    if (!memo.has(id)) memo.set(id, get(id));
    return memo.get(id);
  };
}

/**
 * Who Everyone draws, closest first (breadth-first from the focus over family links): the whole family,
 * except in the cross layout nobody below the focus's generation, nor anyone reached only through them,
 * and nobody `skip` says (in a collapsed family), nor anyone reached only through them.
 */
export function everyoneIds(graph: FamilyGraph, focus: string, cross: boolean, kinOf = kinFrom(graph, focus), skip: (id: string) => boolean = () => false): string[] {
  const order: string[] = [focus];
  const seen = new Set(order);
  for (let k = 0; k < order.length; k++) {
    for (const m of graph.familyNeighbors(order[k])) {
      if (seen.has(m.id) || !graph.person(m.id)) continue;
      seen.add(m.id);
      if (cross && ((kinOf(m.id)?.generation ?? 0) < 0 || skip(m.id))) continue;
      order.push(m.id);
    }
  }
  return order;
}
