/**
 * "Implode" (Everyone, cross layout): the tree packs into a wall of cards, like bricks or containers.
 * Phase 1: in each column the gaps close and the cards stack flush on top of one another, the card
 * nearest the focus's row staying on that row (cards above settle down onto it, cards below rise up).
 * Phase 2: the columns slide together until they touch, the column nearest the focus staying put.
 * Explode plays it backwards. These are offsets from each card's real position; the layout never changes.
 */
import { CARD, type TreeNode } from './graph/contract';

export interface ImplodeOffset {
  /** Phase 1, stacked flush in its column: move by (0, dy). */
  dy: number;
  /** Phase 2, columns side by side: move by (dx, dy). */
  dx: number;
}

/** Index of the item whose value is nearest `v`. */
function nearest(values: number[], v: number): number {
  let best = 0;
  values.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(values[best] - v)) best = i; });
  return best;
}

export function implodeOffsets(nodes: readonly TreeNode[], axis: { x: number; y: number }): Map<string, ImplodeOffset> {
  const cols = new Map<number, TreeNode[]>();
  for (const n of nodes) {
    const k = Math.round(n.x);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k)!.push(n);
  }
  // Columns left to right; the one nearest the focus keeps its x, the others close up beside it.
  const xs = [...cols.keys()].sort((a, b) => a - b);
  const cx = nearest(xs, axis.x);
  const out = new Map<string, ImplodeOffset>();
  xs.forEach((x, j) => {
    const targetX = xs[cx] + (j - cx) * CARD.w;
    // Top to bottom; the card nearest the row lands on it, the rest stack flush above and below.
    const col = cols.get(x)!.sort((a, b) => a.y - b.y);
    const c = nearest(col.map((n) => n.y), axis.y);
    col.forEach((n, i) => {
      out.set(n.key, { dy: axis.y + (i - c) * CARD.h - n.y, dx: targetX - n.x });
    });
  });
  return out;
}
