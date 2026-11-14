import { CARD, type TreeLayout, type TreeNode, type TreeOptions, type TreeRegion } from './graph/contract';
import type { FamilyGraph } from './kinship';
import { layoutCross } from './crossLayout';
import { layoutFamilyV2 } from './familyLayout';
import { REGION_ROOM, SIDE } from './generationBands';

const GAP = 80; // between stacked trees, above the next tree's titles

/**
 * The cross layout, and in Everyone more trees stacked below it so everyone in the family is drawn
 * (the owner's design):
 * - Descendants: anyone drawn whose children aren't drawn gets a top-to-bottom tree of their
 *   descendants (their own card in it is a "shown elsewhere" copy).
 * - People who married in: anyone drawn whose own parents are recorded but not drawn (a grandmother,
 *   the spouse, a brother's wife, an uncle's wife, …) gets their own cross tree: their parents' sides
 *   and their brothers and sisters. That card is their main card; the one beside their spouse becomes
 *   the "shown elsewhere" copy. Someone with no recorded parents keeps a single card.
 * The new trees are scanned the same way, so the whole family is reached.
 */
export function layoutCrossEveryone(graph: FamilyGraph, opts: TreeOptions): TreeLayout {
  const main = layoutCross(graph, opts);
  if (opts.level !== 'everyone' || !main.nodes.length) return main;

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
  const descDone = new Set<string>();
  const name = (id: string) => {
    const p = graph.person(id);
    return p?.nickname || p?.firstName || 'Their';
  };

  for (let i = 0; i < parts.length; i++) {
    const ids = [...new Set(parts[i].layout.nodes.filter((n) => n.personId && !n.dupOf).map((n) => n.personId!))];
    // Descendants first (closest to the tree just drawn), then the families of those who married in.
    for (const id of ids) {
      if (descDone.has(id) || !graph.childrenOf(id).some((c) => !shown.has(c.id))) continue;
      descDone.add(id);
      const L = layoutFamilyV2(graph, { focusId: id, level: 'everyone', expanded: opts.expanded, up: 0, noSiblings: true, noInLaws: true, orient: 'down' });
      for (const n of L.nodes) if (n.role === 'focus') n.role = 'relative';
      L.regions = [{ side: 'middle', x0: L.bounds.minX - SIDE, x1: L.bounds.maxX + SIDE, columns: [], label: `${name(id)}’s descendants` }];
      parts.push({ layout: L, root: id, family: false });
      note(L);
    }
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
      parts.push({ layout: L, root: id, family: true });
      note(L);
    }
  }
  if (parts.length === 1) return main;
  return stack(parts);
}

/** Stack the trees top to bottom (each extra tree centred under the card it grows from), one set of keys. */
function stack(parts: { layout: TreeLayout; root?: string; family: boolean }[]): TreeLayout {
  const nodes: TreeNode[] = [];
  const edges: TreeLayout['edges'] = [];
  const regions: TreeRegion[] = [];
  let bottom = -Infinity;
  const anchorX = new Map<string, number>(); // first card of each person, for lining up the next tree
  const familyRoot = new Map<string, TreeNode>();

  parts.forEach((part, i) => {
    const L = part.layout;
    const pre = i === 0 ? '' : `t${i}/`;
    const top = L.bounds.minY - (L.regions?.length ? REGION_ROOM : 0);
    const dy = i === 0 ? 0 : bottom + GAP - top;
    const rootNode = part.root ? L.nodes.find((n) => n.personId === part.root && !n.dupOf) : undefined;
    const dx = i === 0 || !rootNode ? 0 : (anchorX.get(part.root!) ?? 0) - rootNode.x;
    for (const n of L.nodes) {
      const m: TreeNode = { ...n, key: pre + n.key, x: n.x + dx, y: n.y + dy };
      if (n.dupOf) m.dupOf = pre + n.dupOf;
      if (m.personId && !anchorX.has(m.personId)) anchorX.set(m.personId, m.x);
      if (part.family && n === rootNode) familyRoot.set(n.personId!, m);
      nodes.push(m);
    }
    for (const e of L.edges) edges.push({ ...e, key: pre + e.key, points: e.points.map(([x, y]) => [x + dx, y + dy]) });
    const y0 = L.bounds.minY + dy - REGION_ROOM;
    const y1 = L.bounds.maxY + dy + SIDE;
    for (const r of L.regions ?? []) {
      regions.push({ ...r, x0: r.x0 + dx, x1: r.x1 + dx, columns: r.columns.map((c) => ({ ...c, x: c.x + dx })), y0, y1 });
    }
    bottom = Math.max(bottom, y1);
  });

  // One main card per person: someone who married in has it in their own family's tree; everyone else
  // keeps the first main card drawn. Every other card of theirs is a "shown elsewhere" copy.
  const primary = new Map<string, TreeNode>(familyRoot);
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
  return { nodes, edges, bounds: { minX, maxX, minY, maxY }, regions };
}
