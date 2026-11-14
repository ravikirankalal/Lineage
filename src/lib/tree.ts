import { familyPathTree, kinship, pathInTree, type FamilyGraph } from './kinship';
import type { TreeLayout as GraphLayout, TreeEdge, TreeOptions } from './graph/contract';
import { completeEveryone, layoutCrossEveryone } from './everyone';
import { layoutFamilyV2 } from './familyLayout';

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

/** The family tree layout (contract: src/lib/graph/contract.ts; engine: src/lib/familyLayout.ts). */
export function layoutFamily(graph: FamilyGraph, opts: TreeOptions): GraphLayout {
  return opts.orient === 'cross' ? layoutCrossEveryone(graph, opts) : completeEveryone(graph, opts, layoutFamilyV2(graph, opts));
}

/**
 * The lines to highlight for a "how are we related" path (ids in order, from relationPath): for each step,
 * the lines joining those two people. A step between a brother and sister has no line of its own in the
 * tree, so it lights one shared parent's lines to both of them.
 */
export function pathEdgeKeys(edges: readonly TreeEdge[], ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  const into = new Map<string, TreeEdge[]>(); // child id -> lines from their parents
  for (const e of edges) if (e.kind === 'descent' || e.kind === 'step') into.set(e.to, [...(into.get(e.to) ?? []), e]);
  for (let i = 1; i < ids.length; i++) {
    const [a, b] = [ids[i - 1], ids[i]];
    const direct = edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    if (direct.length) {
      for (const e of direct) out.add(e.key);
      continue;
    }
    const toA = into.get(a) ?? [];
    const toB = into.get(b) ?? [];
    for (const ea of toA) {
      const eb = toB.filter((e) => e.from === ea.from);
      if (!eb.length) continue;
      out.add(ea.key);
      for (const e of eb) out.add(e.key);
      break; // one shared parent is enough
    }
  }
  return out;
}
