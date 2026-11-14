import { memo } from 'react';
import type { TreeEdge } from '../../lib/graph/contract';

/** Stroke styles per edge kind (layout units). Shared with the PNG export. */
export const EDGE_STYLE: Record<TreeEdge['kind'], { dash?: string; width: number; opacity: number; cap: 'round' | 'butt' }> = {
  descent: { width: 1.6, opacity: 1, cap: 'butt' },
  marriage: { width: 2.2, opacity: 1, cap: 'butt' },
  divorced: { dash: '7 5', width: 2, opacity: 1, cap: 'butt' },
  step: { dash: '0.1 6', width: 2.2, opacity: 1, cap: 'round' },
  collapse: { dash: '0.1 5', width: 1.6, opacity: 0.55, cap: 'round' },
};

const KIND_CLS: Record<TreeEdge['kind'], string> = {
  descent: 'text-stone-300 dark:text-stone-600',
  marriage: 'text-brand-400 dark:text-brand-500',
  divorced: 'text-stone-400 dark:text-stone-500',
  step: 'text-amber-500/80 dark:text-amber-400/70',
  collapse: 'text-stone-400 dark:text-stone-500',
};

export const pointsAttr = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(' ');

/** All edges as SVG polylines; edges on the highlighted path are drawn last, thicker, in amber. */
export const TreeEdges = memo(function TreeEdges({ edges, path }: { edges: TreeEdge[]; path?: ReadonlySet<string> }) {
  const on = (e: TreeEdge) => !!path && path.has(e.from) && path.has(e.to);
  return (
    <svg className="tree-edges pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
      <g fill="none" strokeLinejoin="round">
        {edges.map((e) => {
          const s = EDGE_STYLE[e.kind];
          return (
            <polyline key={e.key} points={pointsAttr(e.points)} className={KIND_CLS[e.kind]} stroke="currentColor"
              strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap={s.cap} opacity={path && path.size && !on(e) ? s.opacity * 0.45 : s.opacity} />
          );
        })}
        {path && path.size > 0 && edges.filter(on).map((e) => (
          <polyline key={'hl' + e.key} points={pointsAttr(e.points)} className="text-amber-400" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
        ))}
      </g>
    </svg>
  );
});
