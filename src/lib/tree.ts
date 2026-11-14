import { familyPathTree, kinship, pathInTree, type FamilyGraph } from './kinship';
import type { TreeLayout as GraphLayout, TreeOptions } from './graph/contract';
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
  return layoutFamilyV2(graph, opts);
}
