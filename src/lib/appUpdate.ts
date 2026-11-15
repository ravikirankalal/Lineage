/**
 * Keeping Lineage current. The site's index.html is never cached (firebase.json), but an open tab, and
 * especially the Android app (which stays alive in the background), keep running the code they loaded.
 * So: when you come back to Lineage, and every few minutes while it is open, ask the server which build
 * is live. Coming back to a newer build reloads straight away (unless you're in the middle of editing);
 * while you're using it, a "Reload" bar appears instead.
 */
import { useEffect, useState } from 'react';

const CHECK_EVERY_MS = 5 * 60_000;

/** The build id in a page: the hashed main script, e.g. "index-BAZkONw0". */
export function buildIdOf(html: string): string | null {
  return html.match(/assets\/(index-[\w-]+)\.js/)?.[1] ?? null;
}

/** The build this page is running. */
export function runningBuild(): string | null {
  if (typeof document === 'undefined') return null;
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return s ? buildIdOf(s.getAttribute('src') ?? '') : null;
}

/** The build the server has now (null when offline or unknown). */
export async function liveBuild(): Promise<string | null> {
  try {
    const res = await fetch(`./?build-check=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? buildIdOf(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Editing something right now: an edit/new page, or a sheet or dialog open. Never reload then. */
export function busyEditing(): boolean {
  if (typeof document === 'undefined') return false;
  return /\/(edit|new)(\?|$)/.test(location.hash) || !!document.querySelector('[role="dialog"]');
}

export function reloadApp(): void {
  location.reload();
}

/** True when a newer build is live and the page should offer "Reload". */
export function useAppUpdate(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = runningBuild();
    if (!mine) return; // dev server: nothing to compare
    let stopped = false;
    const check = async (comingBack: boolean) => {
      const live = await liveBuild();
      if (stopped || !live || live === mine) return;
      if (comingBack && !busyEditing()) reloadApp();
      else setReady(true);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(false); }, CHECK_EVERY_MS);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(timer);
    };
  }, []);
  return ready;
}
