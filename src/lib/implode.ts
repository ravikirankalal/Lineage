/**
 * "Implode" (Everyone, cross layout): every card falls onto the focus's row, piling up per column
 * (stacked boxes), then the columns slide together. Explode plays it backwards. These are the offsets
 * from each card's real position; the layout itself never changes.
 */
import type { TreeNode } from './graph/contract';

/** Pixels each card in a pile sits above the one in front of it. */
export const STACK_STEP = 6;
/** How far the columns slide together: 0.3 keeps 30% of each column's distance from the focus. */
export const SHRINK = 0.3;

export interface ImplodeOffset {
  /** Phase 1, onto the row: move by (0, dy). */
  dy: number;
  /** Phase 2, columns together: move by (dx, dy). */
  dx: number;
  /** Stacking order: the card nearest the row is on top. */
  z: number;
}

export function implodeOffsets(nodes: readonly TreeNode[], axis: { x: number; y: number }): Map<string, ImplodeOffset> {
  const cols = new Map<number, TreeNode[]>();
  for (const n of nodes) {
    const k = Math.round(n.x);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k)!.push(n);
  }
  const out = new Map<string, ImplodeOffset>();
  for (const col of cols.values()) {
    // Nearest to the row first: it lands in front, the rest pile up behind it.
    col.sort((a, b) => Math.abs(a.y - axis.y) - Math.abs(b.y - axis.y) || a.y - b.y);
    col.forEach((n, i) => {
      const dy = axis.y - n.y - i * STACK_STEP;
      const dx = axis.x + (n.x - axis.x) * SHRINK - n.x;
      out.set(n.key, { dy, dx, z: col.length - i });
    });
  }
  return out;
}
