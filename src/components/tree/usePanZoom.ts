import { useCallback, useEffect, useMemo, useRef } from 'react';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
const TAP_SLOP = 8; // px a finger may wander and still count as a tap
const DOUBLE_TAP_MS = 300;

export interface View { x: number; y: number; k: number }

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export interface PanZoom {
  /** Current view (screen = world * k + {x, y}). Read-only snapshot. */
  get: () => View;
  /** Jump or animate to a view. */
  set: (v: View, animate?: boolean) => void;
  /** Zoom by a factor around a screen point (container coordinates); defaults to the centre. */
  zoomBy: (factor: number, at?: { x: number; y: number }, animate?: boolean) => void;
  /** Container size in px. */
  size: () => { w: number; h: number };
}

/**
 * Pointer-Events pan & zoom for one container. The transform is written straight to `world.style`
 * so panning never re-renders React or re-lays out the tree.
 * - one finger / mouse drag: pan (with a little inertia)
 * - two fingers: pinch-zoom around the pinch midpoint (and pan with it)
 * - wheel: mouse wheel and trackpad pinch zoom around the cursor; two-finger trackpad scroll pans
 * - double-tap (touch) or double-click on the background: zoom in
 * A drag never turns into a click on a card: the click is swallowed after real movement.
 */
export function usePanZoom(
  container: React.RefObject<HTMLDivElement | null>,
  world: React.RefObject<HTMLDivElement | null>,
  onChange?: (v: View) => void,
): PanZoom {
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const anim = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const apply = useCallback(() => {
    const el = world.current;
    const { x, y, k } = view.current;
    if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
    changeRef.current?.(view.current);
  }, [world]);

  const stop = useCallback(() => {
    if (anim.current != null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);

  const set = useCallback((v: View, animate = false) => {
    stop();
    const to = { ...v, k: clampZoom(v.k) };
    if (!animate || prefersReducedMotion()) {
      view.current = to;
      apply();
      return;
    }
    const from = { ...view.current };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const ms = Math.min(650, 260 + dist / 6);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      apply();
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, [apply, stop]);

  const size = useCallback(() => {
    const el = container.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, [container]);

  const zoomBy = useCallback((factor: number, at?: { x: number; y: number }, animate = false) => {
    const { w, h } = size();
    const p = at ?? { x: w / 2, y: h / 2 };
    const v = view.current;
    const k = clampZoom(v.k * factor);
    const wx = (p.x - v.x) / v.k;
    const wy = (p.y - v.y) / v.k;
    set({ k, x: p.x - wx * k, y: p.y - wy * k }, animate);
  }, [set, size]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pan: { sx: number; sy: number; vx: number; vy: number; moved: boolean; id: number } | null = null;
    let pinch: { d0: number; k0: number; wx: number; wy: number } | null = null;
    let swallowClick = false;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const samples: { t: number; x: number; y: number }[] = [];
    let lastType = 'mouse';

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const startPan = (id: number, p: { x: number; y: number }, moved: boolean) => {
      pan = { sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved, id };
      samples.length = 0;
    };
    const startPinch = () => {
      const [a, b] = [...pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = view.current;
      pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k0: v.k, wx: (mid.x - v.x) / v.k, wy: (mid.y - v.y) / v.k };
      pan = null;
      swallowClick = true;
    };
    const onCard = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, [data-no-pan]');

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest('[data-no-pan]')) return;
      stop();
      swallowClick = false;
      lastType = e.pointerType;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) startPan(e.pointerId, p, false);
      else if (pts.size === 2) {
        for (const id of pts.keys()) {
          try { el.setPointerCapture(id); } catch { /* pointer already gone */ }
        }
        startPinch();
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = clampZoom(pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0);
        view.current = { k, x: mid.x - pinch.wx * k, y: mid.y - pinch.wy * k };
        apply();
        return;
      }
      if (!pan || pan.id !== e.pointerId) return;
      const dx = p.x - pan.sx;
      const dy = p.y - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) > TAP_SLOP) {
        pan.moved = true;
        swallowClick = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      if (!pan.moved) return;
      view.current = { ...view.current, x: pan.vx + dx, y: pan.vy + dy };
      samples.push({ t: e.timeStamp, x: p.x, y: p.y });
      if (samples.length > 6) samples.shift();
      apply();
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      if (pinch) {
        if (pts.size === 1) {
          // One finger lifted: carry on panning with the other one.
          pinch = null;
          const [[id, q]] = [...pts.entries()];
          startPan(id, q, true);
        } else if (pts.size === 0) pinch = null;
        return;
      }
      if (!pan || pan.id !== e.pointerId) return;
      const wasMoved = pan.moved;
      pan = null;
      if (wasMoved) {
        flick(e.type === 'pointercancel');
        return;
      }
      // A tap on the background: double-tap zooms in.
      if (e.pointerType !== 'mouse' && !onCard(e.target)) {
        const now = e.timeStamp;
        if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
          lastTap = null;
          zoomBy(1.6, p, true);
        } else lastTap = { t: now, x: p.x, y: p.y };
      }
    };
    const flick = (cancelled: boolean) => {
      if (cancelled || samples.length < 2 || prefersReducedMotion()) return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = b.t - a.t;
      if (dt <= 0 || performance.now() - b.t > 100) return; // the finger stopped before lifting
      let vx = (b.x - a.x) / dt;
      let vy = (b.y - a.y) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed < 0.3) return;
      const MAX_V = 2.5; // px/ms: a hard flick glides about one screen, never off into the void
      if (speed > MAX_V) {
        vx *= MAX_V / speed;
        vy *= MAX_V / speed;
      }
      let last = performance.now();
      const step = (now: number) => {
        const dt2 = now - last;
        last = now;
        view.current = { ...view.current, x: view.current.x + vx * dt2, y: view.current.y + vy * dt2 };
        apply();
        const decay = Math.pow(0.995, dt2);
        vx *= decay;
        vy *= decay;
        anim.current = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const dbl = (e: MouseEvent) => {
      if (onCard(e.target)) return;
      if (lastType !== 'mouse') return; // touch double-taps are handled in up()
      zoomBy(1.6, local(e), true);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      stop();
      const p = local(e);
      const lineScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * lineScale;
      const dy = e.deltaY * lineScale;
      // Mouse wheels send whole-number, vertical-only steps; trackpads send small fractional deltas
      // in both directions (pinch arrives as ctrl+wheel).
      const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40);
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const factor = Math.exp(-dy * (e.ctrlKey && !mouseWheel ? 0.01 : 0.0018));
        zoomBy(factor, p);
      } else {
        view.current = { ...view.current, x: view.current.x - dx, y: view.current.y - dy };
        apply();
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('dblclick', dbl);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('dblclick', dbl);
      el.removeEventListener('wheel', wheel);
      stop();
    };
  }, [container, apply, stop, zoomBy]);

  return useMemo(() => ({ get: () => view.current, set, zoomBy, size }), [set, zoomBy, size]);
}
