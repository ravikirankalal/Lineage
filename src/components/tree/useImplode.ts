import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { CARD, type TreeLayout } from '../../lib/graph/contract';
import { implodeOffsets } from '../../lib/implode';
import { prefersReducedMotion, type View } from './usePanZoom';

export type ImplodeState = 'open' | 'moving' | 'imploded';

/** Phase timings (ms): lines fade, each column stacks flush, columns slide together. */
const FADE = 250;
const FALL = 650;
const SLIDE = 550;
const EASE = 'cubic-bezier(.6,0,.25,1)';

/**
 * Implode / explode the drawn tree (Everyone, cross layout). Works on the rendered cards with CSS
 * transforms, like the focus-change animation: the layout and the data never change.
 */
export function useImplode(opts: {
  world: RefObject<HTMLDivElement | null>;
  box: RefObject<HTMLDivElement | null>;
  layout: TreeLayout;
  axis: { x: number; y: number } | undefined;
  pz: { get(): View; set(v: View, animate?: boolean): void };
}) {
  const { world, box, layout, axis, pz } = opts;
  const [state, setState] = useState<ImplodeState>('open');
  const timers = useRef<number[]>([]);
  const saved = useRef<View | null>(null);
  const later = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)); };

  const parts = () => {
    const el = world.current;
    return {
      cards: el ? [...el.querySelectorAll<HTMLElement>('[data-key]')] : [],
      lines: el ? [...el.querySelectorAll<HTMLElement | SVGElement>('.tree-edges, .tree-bands')] : [],
    };
  };
  const place = (phase: 0 | 1 | 2, ms: number) => {
    const off = axis ? implodeOffsets(layout.nodes, axis) : new Map();
    for (const card of parts().cards) {
      const o = off.get(card.dataset.key!);
      card.style.transition = ms ? `transform ${ms}ms ${EASE}` : 'none';
      if (!o || phase === 0) { card.style.transform = ''; continue; }
      card.style.transform = `translate(${phase === 2 ? o.dx : 0}px, ${o.dy}px)`;
    }
  };
  const fadeLines = (show: boolean, ms: number) => {
    for (const l of parts().lines) {
      l.style.transition = ms ? `opacity ${ms}ms ease` : 'none';
      l.style.opacity = show ? '' : '0';
    }
  };
  const clean = () => {
    for (const card of parts().cards) { card.style.transition = ''; card.style.transform = ''; }
    for (const l of parts().lines) { l.style.transition = ''; l.style.opacity = ''; }
  };

  const implode = useCallback(() => {
    if (state !== 'open' || !axis) return;
    saved.current = pz.get();
    const quick = prefersReducedMotion();
    setState('moving');
    fadeLines(false, quick ? 0 : FADE);
    later(quick ? 0 : FADE, () => place(1, quick ? 0 : FALL));
    later(quick ? 0 : FADE + FALL, () => {
      place(2, quick ? 0 : SLIDE);
      // Show the whole wall, in the middle of the screen.
      const b = box.current;
      if (b) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        const off = implodeOffsets(layout.nodes, axis);
        for (const n of layout.nodes) {
          const o = off.get(n.key);
          if (!o) continue;
          x0 = Math.min(x0, n.x + o.dx - CARD.w / 2); x1 = Math.max(x1, n.x + o.dx + CARD.w / 2);
          y0 = Math.min(y0, n.y + o.dy); y1 = Math.max(y1, n.y + o.dy + CARD.h);
        }
        const pad = 48;
        const k = Math.min(1, (b.clientWidth - pad) / (x1 - x0), (b.clientHeight - pad - 120) / (y1 - y0));
        pz.set({ k, x: b.clientWidth / 2 - ((x0 + x1) / 2) * k, y: (b.clientHeight + 60) / 2 - ((y0 + y1) / 2) * k }, !quick);
      }
    });
    later(quick ? 0 : FADE + FALL + SLIDE, () => setState('imploded'));
  }, [state, axis, layout, pz]); // eslint-disable-line react-hooks/exhaustive-deps

  const explode = useCallback(() => {
    if (state !== 'imploded') return;
    const quick = prefersReducedMotion();
    setState('moving');
    place(1, quick ? 0 : SLIDE);
    if (saved.current) pz.set(saved.current, !quick);
    later(quick ? 0 : SLIDE, () => place(0, quick ? 0 : FALL));
    later(quick ? 0 : SLIDE + FALL, () => fadeLines(true, quick ? 0 : FADE));
    later(quick ? 0 : SLIDE + FALL + FADE, () => { clean(); setState('open'); });
  }, [state, layout, pz]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new layout (level, layout direction, focus, data) always starts open.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState((s) => { if (s !== 'open') clean(); return 'open'; });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { state, implode, explode };
}
