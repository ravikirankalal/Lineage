import { RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reloadApp, useAppUpdate } from '../lib/appUpdate';
import { useCloud } from '../lib/cloud/CloudProvider';

/** "A new version is ready" bar (see appUpdate.ts). */
export function UpdateBar() {
  const { configured, auth, state } = useCloud();
  // Fully loaded: the sign-in screen is up, or the family tree has opened (or failed to).
  const loaded = !configured || (!auth.loading && (!auth.user || state !== 'loading'));
  const ready = useAppUpdate(loaded);
  if (!ready) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-[calc(8px+var(--sat))] print:hidden">
      <div className="flex items-center gap-3 rounded-full bg-stone-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
        <span>A new version of Lineage is ready</span>
        <button type="button" onClick={reloadApp} className="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700">Reload</button>
      </div>
    </div>
  );
}

const PULL = 80;

/**
 * Pull down from the top of a page to reload (the Android app has no browser reload). Off on the family
 * tree, where dragging moves the tree, and while a sheet is open.
 */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const [pull, setPull] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let dist = 0;
    const down = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && e.touches.length === 1 && !document.querySelector('[role="dialog"]') ? e.touches[0].clientY : null;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      if (window.scrollY > 0) { startY = null; setPull(0); return; }
      dist = Math.max(0, e.touches[0].clientY - startY);
      setPull(Math.min(dist * 0.6, 110));
    };
    const up = () => {
      if (startY !== null && dist * 0.6 >= PULL) reloadApp();
      startY = null;
      dist = 0;
      setPull(0);
    };
    const opts = { passive: true } as const;
    window.addEventListener('touchstart', down, opts);
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', up, opts);
    window.addEventListener('touchcancel', up, opts);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, [enabled]);
  if (!enabled || pull < 8) return null;
  const armed = pull >= PULL;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-safe z-[60] flex justify-center" style={{ transform: `translateY(${pull - 40}px)` }}>
      <div className={`flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium shadow-lg ring-1 ${armed ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-stone-600 ring-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-700'}`}>
        <RotateCw size={18} style={{ transform: `rotate(${pull * 3}deg)` }} />
        {armed ? 'Release to reload' : 'Pull to reload'}
      </div>
    </div>
  );
}
