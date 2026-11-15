/**
 * Remembers each tree tab's view (owner, 2026-11-15): the zoom and position for every page, level,
 * layout and focus, and the last tree settings (focus, level, layout, opened branches) of each page.
 * Going to a profile and coming back, or switching levels back and forth, returns to the same spot.
 * Kept in memory and in sessionStorage, so it also survives the app reloading itself for an update.
 * Nothing here is family data: only ids and numbers, and only on this device for this visit.
 */
import type { View } from './usePanZoom';

const STORE = 'lineage.treeViews';
const MAX_VIEWS = 60;

interface Saved { views: [string, View][]; searches: [string, string][] }

let views: Map<string, View> | null = null;
let searches: Map<string, string> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load() {
  if (views && searches) return;
  views = new Map();
  searches = new Map();
  try {
    const raw = sessionStorage.getItem(STORE);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    for (const [k, v] of saved?.views ?? []) if (valid(v)) views.set(k, v);
    for (const [k, s] of saved?.searches ?? []) if (typeof s === 'string') searches.set(k, s);
  } catch { /* storage blocked or bad data: start empty */ }
}

const valid = (v: unknown): v is View =>
  !!v && typeof v === 'object' && ['x', 'y', 'k'].every((f) => Number.isFinite((v as Record<string, unknown>)[f]));

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ views: [...views!], searches: [...searches!] } satisfies Saved));
    } catch { /* storage full or blocked: memory still works */ }
  }, 300);
}

export function rememberView(key: string, v: View) {
  load();
  views!.delete(key); // newest last, so the oldest go first
  views!.set(key, { x: v.x, y: v.y, k: v.k });
  while (views!.size > MAX_VIEWS) views!.delete(views!.keys().next().value!);
  persist();
}

export function recallView(key: string): View | undefined {
  load();
  return views!.get(key);
}

/** The tree's settings in the URL (`?focus=…&level=…`) for a page, to restore when it's opened plain. */
export function rememberSearch(scope: string, search: string) {
  load();
  if (searches!.get(scope) === search) return;
  searches!.set(scope, search);
  persist();
}

export function recallSearch(scope: string): string | undefined {
  load();
  return searches!.get(scope);
}

// History entries (router location keys) the tree has already been shown for. Coming back to one
// (Back from a profile) keeps the remembered view instead of re-running "Show in tree".
const visited = new Set<string>();
export const wasVisited = (locationKey: string) => visited.has(locationKey);
export const markVisited = (locationKey: string) => { visited.add(locationKey); };

/** Tests only. */
export function forgetAll() {
  views = new Map();
  searches = new Map();
  try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
}
