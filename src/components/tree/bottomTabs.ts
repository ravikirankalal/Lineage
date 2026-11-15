import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * The phone's bottom tabs on Family Tree (map view): they slide away after a few seconds without
 * touching the screen, so the tree gets the whole screen. Panning and zooming keep them hidden;
 * a tap on the tree brings them back, and that tap does nothing else (it doesn't open a card).
 */
const IDLE_MS = 3000;
/** Same breakpoint as the tab bar (`md:hidden`). */
const PHONE_TABS = '(max-width: 767px)';

let hidden = false;
const subs = new Set<() => void>();
function setHidden(v: boolean) {
  if (v === hidden) return;
  hidden = v;
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function useBottomTabsHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => false);
}

/** Auto-hide the bottom tabs while `active` (the map view is showing); `box` is the tree. */
export function useAutoHideTabs(active: boolean, box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = box.current;
    if (!active || !el) return;
    const mq = window.matchMedia?.(PHONE_TABS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (mq?.matches) setHidden(true); }, IDLE_MS);
    };
    // Any touch restarts the countdown; it never brings the tabs back by itself.
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', restart, opts);
    window.addEventListener('wheel', restart, opts);
    window.addEventListener('keydown', restart, opts);
    // A tap on the tree while the tabs are hidden only shows them. (Clicks after a drag are
    // already swallowed by the pan/zoom handler, which marks them defaultPrevented.)
    const click = (e: MouseEvent) => {
      if (!hidden || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('[data-no-pan]')) return;
      e.preventDefault();
      e.stopPropagation();
      setHidden(false);
      restart();
    };
    el.addEventListener('click', click, true);
    const onMq = () => { if (!mq?.matches) setHidden(false); };
    mq?.addEventListener('change', onMq);
    restart();
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', restart, opts);
      window.removeEventListener('wheel', restart, opts);
      window.removeEventListener('keydown', restart, opts);
      el.removeEventListener('click', click, true);
      mq?.removeEventListener('change', onMq);
      setHidden(false);
    };
  }, [active, box]);
}
