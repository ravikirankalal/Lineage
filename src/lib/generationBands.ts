import { CARD, type TreeLayout, type TreeOrient } from './graph/contract';

/** A background stripe behind one generation of the tree (layout units). */
export interface GenBand {
  key: string;
  gen: number; // relative to the focus: +1 parents, −1 children
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: string;
  /** Columns (left-to-right and cross layouts) or rows (top-to-bottom). */
  vertical: boolean;
  /** Cross layout: a whole region (father's side, your generation, mother's side) with a title
   * per card column. `gen` is then 1 / 0 / −1 for the colour only. */
  region?: 'father' | 'middle' | 'mother';
  columns?: { x: number; label: string }[];
}

/** "Parents", "Grandparents", "2× great-grandparents", "Your generation", "Children", … */
export function generationLabel(gen: number, focusName?: string | null): string {
  if (gen === 0) return focusName ? `${focusName}’s generation` : 'Your generation';
  const n = Math.abs(gen);
  const [one, two] = gen > 0 ? ['Parents', 'parents'] : ['Children', 'children'];
  if (n === 1) return one;
  if (n === 2) return `Grand${two}`;
  if (n === 3) return `Great-grand${two}`;
  return `${n - 2}× great-grand${two}`;
}

const LABEL_ROOM = 44; // above the tree, for column labels
export const REGION_ROOM = 64; // above the cross layout: region title + column titles
const REGION_LABEL: Record<'father' | 'middle' | 'mother', string> = {
  father: 'Father’s side',
  middle: 'Your generation',
  mother: 'Mother’s side',
};
export const SIDE = 20;

/**
 * Generation stripes for a layout: one per run of adjacent rows (top-to-bottom) or columns (left-to-right,
 * cross) holding the same generation; neighbouring runs meet halfway between their cards. In the cross
 * layout the same generation appears on both sides (e.g. parents left and right), each with its own stripe.
 * Also returns the bounds including the stripes and their labels, for fitting the view.
 */
export function generationBands(layout: TreeLayout, orient: TreeOrient, focusName?: string | null): { bands: GenBand[]; bounds: TreeLayout['bounds'] } {
  const { bounds } = layout;
  if (!layout.nodes.length) return { bands: [], bounds };
  if (orient === 'cross' && layout.regions?.length) {
    // Three regions side by side instead of one stripe per generation.
    const y0 = bounds.minY - REGION_ROOM;
    const y1 = bounds.maxY + SIDE;
    const bands = layout.regions.map((r, i): GenBand => ({
      key: `${r.side}:${i}`, gen: r.side === 'father' ? 1 : r.side === 'middle' ? 0 : -1,
      x0: r.x0, x1: r.x1, y0: r.y0 ?? y0, y1: r.y1 ?? y1,
      label: r.label ?? (r.side === 'middle' ? generationLabel(0, focusName) : REGION_LABEL[r.side]), vertical: true, region: r.side, columns: r.columns,
    }));
    return {
      bands,
      bounds: {
        minX: Math.min(bounds.minX, ...bands.map((b) => b.x0)),
        maxX: Math.max(bounds.maxX, ...bands.map((b) => b.x1)),
        minY: Math.min(...bands.map((b) => b.y0)),
        maxY: Math.max(...bands.map((b) => b.y1)),
      },
    };
  }
  const vertical = orient !== 'down';
  const pos = (n: TreeLayout['nodes'][number]) => Math.round(vertical ? n.x : n.y + CARD.h / 2);
  // Generation per row/column position (the most common one there).
  const at = new Map<number, Map<number, number>>();
  for (const n of layout.nodes) {
    const p = pos(n);
    const m = at.get(p) ?? new Map<number, number>();
    m.set(n.generation, (m.get(n.generation) ?? 0) + 1);
    at.set(p, m);
  }
  const lines = [...at].map(([p, m]) => ({ p, gen: [...m].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => a.p - b.p);
  // Merge neighbours of the same generation into runs.
  const runs: { gen: number; lo: number; hi: number }[] = [];
  for (const l of lines) {
    const last = runs[runs.length - 1];
    if (last && last.gen === l.gen) last.hi = l.p;
    else runs.push({ gen: l.gen, lo: l.p, hi: l.p });
  }
  const half = (vertical ? CARD.w : CARD.h) / 2 + SIDE;
  const across = vertical
    ? { a0: bounds.minY - LABEL_ROOM, a1: bounds.maxY + SIDE }
    : { a0: bounds.minX - SIDE, a1: bounds.maxX + SIDE };
  const bands = runs.map((r, i): GenBand => {
    const start = i === 0 ? r.lo - half : (runs[i - 1].hi + r.lo) / 2;
    const end = i === runs.length - 1 ? r.hi + half : (r.hi + runs[i + 1].lo) / 2;
    const box = vertical
      ? { x0: start, x1: end, y0: across.a0, y1: across.a1 }
      : { x0: across.a0, x1: across.a1, y0: start, y1: end };
    return { key: `${r.gen}:${Math.round(start)}`, gen: r.gen, ...box, label: generationLabel(r.gen, focusName), vertical };
  });
  return {
    bands,
    bounds: {
      minX: Math.min(bounds.minX, ...bands.map((b) => b.x0)),
      maxX: Math.max(bounds.maxX, ...bands.map((b) => b.x1)),
      minY: Math.min(bounds.minY, ...bands.map((b) => b.y0)),
      maxY: Math.max(bounds.maxY, ...bands.map((b) => b.y1)),
    },
  };
}
