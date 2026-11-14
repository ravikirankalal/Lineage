import { Check, Maximize2, Minus, Plus, Users, UserRound } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { socialGraph } from '../lib/connections';
import { useData } from '../lib/data';
import type { SocialEdge, SocialNode } from '../lib/graph/contract';
import { displayName, initials } from '../lib/person';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';
import { PersonRow } from './PersonRow';
import { Sheet } from './Sheet';

// ---------------------------------------------------------------------------
// Sectors: the contract's `group` keys folded into a few plain-word sectors.

type SectorKey = 'family' | 'friends' | 'work' | 'college' | 'neighbourhood' | 'acquaintances' | 'hometown' | 'city' | 'other';

const SECTORS: { key: SectorKey; title: string }[] = [
  { key: 'family', title: 'Family' },
  { key: 'friends', title: 'Friends' },
  { key: 'work', title: 'Work' },
  { key: 'college', title: 'College' },
  { key: 'neighbourhood', title: 'Neighbourhood' },
  { key: 'acquaintances', title: 'Acquaintances' },
  { key: 'hometown', title: 'Home town' },
  { key: 'city', title: 'Same city' },
  { key: 'other', title: 'Other' },
];
const SECTOR_ORDER = SECTORS.map((s) => s.key);
const SECTOR_TITLE = Object.fromEntries(SECTORS.map((s) => [s.key, s.title])) as Record<SectorKey, string>;

const GROUP_TO_SECTOR: Record<string, SectorKey> = {
  family: 'family', extended: 'family', immediate: 'family', relative: 'family',
  close_friend: 'friends', friend: 'friends', friends: 'friends',
  colleague: 'work', work: 'work', workplace: 'work',
  classmate: 'college', school: 'college', college: 'college', education: 'college',
  neighbor: 'neighbourhood', neighbour: 'neighbourhood', area: 'neighbourhood', neighbourhood: 'neighbourhood',
  acquaintance: 'acquaintances',
  origin: 'hometown', hometown: 'hometown', home_town: 'hometown',
  city: 'city',
};
export function sectorOf(group: string): SectorKey {
  return GROUP_TO_SECTOR[group] ?? 'other';
}

/** Full class strings so Tailwind keeps them. */
const COLORS: Record<SectorKey, { fill: string; text: string; dot: string; wedge: string }> = {
  family: { fill: 'fill-brand-500', text: 'fill-brand-700 dark:fill-brand-300', dot: 'bg-brand-500', wedge: 'fill-brand-500/[.07] dark:fill-brand-400/[.09]' },
  friends: { fill: 'fill-sky-500', text: 'fill-sky-700 dark:fill-sky-300', dot: 'bg-sky-500', wedge: 'fill-sky-500/[.07] dark:fill-sky-400/[.09]' },
  work: { fill: 'fill-amber-500', text: 'fill-amber-700 dark:fill-amber-300', dot: 'bg-amber-500', wedge: 'fill-amber-500/[.08] dark:fill-amber-400/[.09]' },
  college: { fill: 'fill-violet-500', text: 'fill-violet-700 dark:fill-violet-300', dot: 'bg-violet-500', wedge: 'fill-violet-500/[.07] dark:fill-violet-400/[.09]' },
  neighbourhood: { fill: 'fill-rose-500', text: 'fill-rose-700 dark:fill-rose-300', dot: 'bg-rose-500', wedge: 'fill-rose-500/[.06] dark:fill-rose-400/[.09]' },
  acquaintances: { fill: 'fill-stone-500', text: 'fill-stone-600 dark:fill-stone-300', dot: 'bg-stone-400', wedge: 'fill-stone-500/[.07] dark:fill-stone-400/[.09]' },
  hometown: { fill: 'fill-teal-500', text: 'fill-teal-700 dark:fill-teal-300', dot: 'bg-teal-500', wedge: 'fill-teal-500/[.07] dark:fill-teal-400/[.09]' },
  city: { fill: 'fill-indigo-500', text: 'fill-indigo-700 dark:fill-indigo-300', dot: 'bg-indigo-500', wedge: 'fill-indigo-500/[.06] dark:fill-indigo-400/[.09]' },
  other: { fill: 'fill-stone-500', text: 'fill-stone-600 dark:fill-stone-300', dot: 'bg-stone-400', wedge: 'fill-stone-500/[.06] dark:fill-stone-400/[.08]' },
};

const RING_NAMES: Record<number, string> = { 1: 'Closest', 2: 'Friends & work', 3: 'Acquaintances', 4: 'Same place' };
const ringName = (r: number) => RING_NAMES[r] ?? `Circle ${r}`;

/** Same colours as <Avatar>, as SVG fills. Keep the order in sync with Avatar's PALETTE. */
const AVATAR_FILL = [
  ['fill-rose-100 dark:fill-rose-900', 'fill-rose-700 dark:fill-rose-200'],
  ['fill-amber-100 dark:fill-amber-900', 'fill-amber-700 dark:fill-amber-200'],
  ['fill-emerald-100 dark:fill-emerald-900', 'fill-emerald-700 dark:fill-emerald-200'],
  ['fill-sky-100 dark:fill-sky-900', 'fill-sky-700 dark:fill-sky-200'],
  ['fill-violet-100 dark:fill-violet-900', 'fill-violet-700 dark:fill-violet-200'],
  ['fill-teal-100 dark:fill-teal-900', 'fill-teal-700 dark:fill-teal-200'],
  ['fill-orange-100 dark:fill-orange-900', 'fill-orange-700 dark:fill-orange-200'],
  ['fill-indigo-100 dark:fill-indigo-900', 'fill-indigo-700 dark:fill-indigo-200'],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------------------------------------------------------------------------
// Deterministic radial layout (pure geometry, no physics).

const S = 74; // arc distance between neighbouring node centres (fits a 9-letter label)
const FIRST = 120; // smallest radius of the innermost ring
const STEP = 92; // radial gap between neighbouring rings (avatar + label + air)
const STAG = 40; // in a crowded ring, nodes alternate ±STAG around the ring radius
export const CAP = 24; // visible slots per ring (including "+N more")

export interface MapInput { id: string; ring: number; sector: SectorKey; name: string }
export interface Slot {
  key: string;
  ring: number;
  sector: SectorKey;
  personId?: string;
  more?: string[]; // ids hidden behind a "+N more" node
  x: number;
  y: number;
}
export interface RadialLayout {
  slots: Slot[];
  rings: { ring: number; r: number }[];
  sectors: { key: SectorKey; a0: number; a1: number; rIn: number; rOut: number; lx: number; ly: number }[];
  extent: number;
  /** Bounding box of everything drawn (nodes with labels, centre, sector labels). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function layoutRadial(input: MapInput[], cap = CAP): RadialLayout {
  const rings = [...new Set(input.map((n) => n.ring))].sort((a, b) => a - b);
  // 1. Cells (ring × sector), sorted by name, capped per ring.
  type Cell = { personId?: string; more?: string[] }[];
  const cells = new Map<string, Cell>();
  const ck = (r: number, s: SectorKey) => `${r}|${s}`;
  for (const r of rings) {
    const per = SECTOR_ORDER.map((s) => [s, input.filter((n) => n.ring === r && n.sector === s).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))] as const)
      .filter(([, l]) => l.length);
    const total = per.reduce((t, [, l]) => t + l.length, 0);
    let quotas = per.map(([, l]) => l.length);
    if (total > cap) {
      quotas = per.map(([, l]) => Math.max(Math.min(l.length, 2), Math.floor((l.length / total) * cap)));
      const sum = () => quotas.reduce((a, b) => a + b, 0);
      while (sum() > cap) {
        const i = quotas.indexOf(Math.max(...quotas));
        if (quotas[i] <= 2) break;
        quotas[i]--;
      }
      while (sum() < cap) {
        let best = -1;
        per.forEach(([, l], i) => { if (quotas[i] < l.length && (best < 0 || l.length - quotas[i] > per[best][1].length - quotas[best])) best = i; });
        if (best < 0) break;
        quotas[best]++;
      }
    }
    per.forEach(([s, l], i) => {
      const q = quotas[i];
      const cell: Cell = q >= l.length ? l.map((n) => ({ personId: n.id }))
        : [...l.slice(0, q - 1).map((n) => ({ personId: n.id })), { more: l.slice(q - 1).map((n) => n.id) }];
      cells.set(ck(r, s), cell);
    });
  }
  const sectors = SECTOR_ORDER.filter((s) => rings.some((r) => cells.has(ck(r, s))));
  if (!sectors.length) return { slots: [], rings: [], sectors: [], extent: FIRST, bounds: { minX: -60, maxX: 60, minY: -60, maxY: 70 } };

  // 2–3. Angular span per sector and ring radii, refined together a few times: a sector's span comes
  // from the arc length its nodes (and its label) need at the current radii, and each ring then grows
  // until its nodes fit. A crowded ring alternates two radii when that keeps the map smaller.
  const count = (r: number, s: SectorKey) => cells.get(ck(r, s))?.length ?? 0;
  const gap = sectors.length > 1 ? 0.05 : 0;
  const avail = 2 * Math.PI - gap * sectors.length;
  let ringR = rings.map((ring, i) => ({ ring, r: FIRST + STEP * i, stag: false }));
  let span: number[] = [];
  for (let iter = 0; iter < 4; iter++) {
    const need = sectors.map((s) => {
      let n = 0, outerR = FIRST;
      ringR.forEach(({ ring, r, stag }) => {
        const k = count(ring, s);
        if (!k) return;
        n = Math.max(n, (k * S) / ((stag ? 2 : 1) * (stag ? r - STAG : r)));
        outerR = r + (stag ? STAG : 0);
      });
      const label = sectors.length > 1 ? (SECTOR_TITLE[s].length * 8 + 20) / (outerR + 70) : 0;
      return Math.max(n, label, 0.2);
    });
    span = fairShare(need, avail);
    const next: typeof ringR = [];
    rings.forEach((ring, i) => {
      const prev = next[i - 1];
      const base = prev ? prev.r + (prev.stag ? STAG : 0) + STEP : FIRST;
      const fit = (div: number) => Math.max(0, ...sectors.map((s, j) => {
        const k = count(ring, s);
        return k ? (k * S) / (div * span[j]) : 0;
      }));
      const flat = Math.max(base, fit(1));
      // Staggered: each sub-row holds every other node, measured at the inner sub-row's radius.
      const stagR = Math.max(base, fit(2)) + STAG;
      next.push(flat <= base || stagR + STAG >= flat ? { ring, r: flat, stag: false } : { ring, r: stagR, stag: true });
    });
    ringR = next;
  }
  const a0 = new Map<SectorKey, number>();
  let a = -Math.PI / 2 - span[0] / 2; // the first sector (family, when present) is centred at the top
  sectors.forEach((s, i) => { a0.set(s, a); a += span[i] + gap; });
  const spanOf = new Map(sectors.map((s, i) => [s, span[i]]));

  // 4. Place.
  const slots: Slot[] = [];
  const outer = new Map<SectorKey, number>();
  const inner = new Map<SectorKey, number>();
  ringR.forEach(({ ring, r, stag }) => {
    let g = 0; // position around the whole ring, so sub-rows alternate across sector borders too
    for (const s of sectors) {
      const cell = cells.get(ck(ring, s));
      if (!cell) continue;
      const sp = spanOf.get(s)!;
      cell.forEach((c, j) => {
        const ang = a0.get(s)! + (sp * (j + 0.5)) / cell.length;
        const rr = stag ? r + (g++ % 2 ? STAG : -STAG) : r;
        slots.push({ key: c.personId ?? `more:${ring}:${s}`, ring, sector: s, personId: c.personId, more: c.more, x: Math.cos(ang) * rr, y: Math.sin(ang) * rr });
      });
      outer.set(s, Math.max(outer.get(s) ?? 0, r + (stag ? STAG : 0)));
      if (!inner.has(s)) inner.set(s, r - (stag ? STAG : 0));
    }
  });
  const secs = sectors.map((s) => {
    const rOut = (outer.get(s) ?? FIRST) + 58;
    const mid = a0.get(s)! + spanOf.get(s)! / 2;
    return { key: s, a0: a0.get(s)!, a1: a0.get(s)! + spanOf.get(s)!, rIn: Math.max(48, (inner.get(s) ?? FIRST) - 46), rOut, lx: Math.cos(mid) * (rOut + 12), ly: Math.sin(mid) * (rOut + 12) + 4 };
  });
  const extent = Math.max(...secs.map((s) => s.rOut + 30));
  const bounds = { minX: -60, maxX: 60, minY: -60, maxY: 70 };
  const grow = (x0: number, x1: number, y0: number, y1: number) => {
    bounds.minX = Math.min(bounds.minX, x0); bounds.maxX = Math.max(bounds.maxX, x1);
    bounds.minY = Math.min(bounds.minY, y0); bounds.maxY = Math.max(bounds.maxY, y1);
  };
  for (const sl of slots) grow(sl.x - 40, sl.x + 40, sl.y - 28, sl.y + 46);
  for (const sc of secs) {
    const w = SECTOR_TITLE[sc.key].length * 4.5 + 6;
    grow(sc.lx - w, sc.lx + w, sc.ly - 14, sc.ly + 6);
  }
  return { slots, rings: ringR.map(({ ring, r }) => ({ ring, r })), sectors: secs, extent, bounds };
}

/**
 * Split `total` between needs. If everything fits, spare room is shared in proportion. If not, small
 * needs are met in full and the largest ones share what is left (max-min fairness), so only the
 * crowded sector's ring has to grow.
 */
function fairShare(need: number[], total: number): number[] {
  const sum = need.reduce((a, b) => a + b, 0);
  if (sum <= total) return need.map((n) => (n / sum) * total);
  const out = need.slice();
  const order = need.map((_, i) => i).sort((a, b) => need[a] - need[b]);
  let left = total;
  for (let i = 0; i < order.length; i++) {
    const rest = order.slice(i);
    const restNeed = rest.reduce((a, j) => a + need[j], 0);
    if (need[order[i]] * rest.length <= left) {
      left -= need[order[i]];
    } else {
      for (const j of rest) out[j] = (need[j] / restNeed) * left;
      break;
    }
  }
  return out;
}

function wedge(a0: number, a1: number, r0: number, r1: number) {
  const p = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    return `M ${r1} 0 A ${r1} ${r1} 0 1 1 ${-r1} 0 A ${r1} ${r1} 0 1 1 ${r1} 0 Z M ${r0} 0 A ${r0} ${r0} 0 1 0 ${-r0} 0 A ${r0} ${r0} 0 1 0 ${r0} 0 Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

const truncate = (s: string, n = 9) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// ---------------------------------------------------------------------------

type View = { x: number; y: number; k: number };

export function ConnectionsMap({ centerId }: { centerId: string }) {
  const { people, rels, graph, byId } = useData();
  const nav = useNavigate();
  const clipId = 'cm-clip-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const center = byId.get(centerId);

  const sg = useMemo(() => socialGraph(centerId, people, rels, graph), [centerId, people, rels, graph]);
  const nodes = useMemo(() => sg.nodes.filter((n) => n.id !== centerId && n.ring > 0 && byId.has(n.id)), [sg, centerId, byId]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Filters
  const [hiddenRings, setHiddenRings] = useState<Set<number>>(new Set());
  const [hiddenSectors, setHiddenSectors] = useState<Set<SectorKey>>(new Set());
  const ringsPresent = useMemo(() => [...new Set(nodes.map((n) => n.ring))].sort((a, b) => a - b), [nodes]);
  const sectorCounts = useMemo(() => {
    const m = new Map<SectorKey, number>();
    for (const n of nodes) m.set(sectorOf(n.group), (m.get(sectorOf(n.group)) ?? 0) + 1);
    return SECTOR_ORDER.filter((s) => m.has(s)).map((s) => [s, m.get(s)!] as const);
  }, [nodes]);
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    apply(next);
  };

  // Layout
  const visible = useMemo(() => nodes.filter((n) => !hiddenRings.has(n.ring) && !hiddenSectors.has(sectorOf(n.group))), [nodes, hiddenRings, hiddenSectors]);
  const shortName = useMemo(() => {
    const firstCount = new Map<string, number>();
    for (const n of visible) {
      const f = byId.get(n.id)!.firstName.trim();
      firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
    }
    return (p: Person) => {
      const f = p.firstName.trim() || displayName(p);
      return (firstCount.get(f) ?? 0) > 1 && p.lastName ? `${truncate(f, 8)} ${p.lastName[0]}.` : truncate(f);
    };
  }, [visible, byId]);
  const layout = useMemo(() => layoutRadial(visible.map((n) => ({ id: n.id, ring: n.ring, sector: sectorOf(n.group), name: byId.get(n.id)!.firstName }))), [visible, byId]);
  const pos = useMemo(() => new Map(layout.slots.filter((s) => s.personId).map((s) => [s.personId!, s])), [layout]);
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: SocialEdge[] = [];
    for (const e of sg.edges) {
      if (e.a === centerId || e.b === centerId || e.a === e.b || !pos.has(e.a) || !pos.has(e.b)) continue;
      const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }, [sg, centerId, pos]);

  // Selection
  const [selected, setSelected] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState<Slot | null>(null);
  const selNode = selected ? nodeById.get(selected) : undefined;
  const selPerson = selected ? byId.get(selected) : undefined;

  // View (pan / zoom)
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const fit = useCallback((mode: 'all' | 'open', anim: boolean) => {
    if (!size.w) return;
    const b = layout.bounds;
    const pad = 16;
    const all = Math.min((size.w - 2 * pad) / (b.maxX - b.minX), (size.h - 2 * pad) / (b.maxY - b.minY));
    setAnimate(anim);
    // Smallest zoom at which names stay readable: a phone is held close, so it needs more.
    const readable = size.w >= 640 ? 0.6 : 0.72;
    if (mode === 'open' && all < readable) {
      // Too big to read at fit-to-screen: open on the person at a readable size (Fit shows everyone).
      setView({ x: size.w / 2, y: size.h / 2, k: readable });
      return;
    }
    const k = Math.min(mode === 'open' ? 1.1 : 1.6, Math.max(all, 0.12));
    setView({ x: size.w / 2 - ((b.minX + b.maxX) / 2) * k, y: size.h / 2 - ((b.minY + b.maxY) / 2) * k, k });
  }, [size.w, size.h, layout.bounds]);
  // Re-fit when the centre, filters or box size change.
  useEffect(() => { fit('open', false); }, [fit]);

  const zoomBy = (f: number, cx = size.w / 2, cy = size.h / 2, anim = true) => {
    setAnimate(anim);
    setView((v) => {
      const k = Math.min(3, Math.max(0.12, v.k * f));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms; a plain wheel scrolls the page as usual.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top, false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); };
  });

  // Pointer gestures: one finger pans, two fingers pinch; a short still tap selects.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; p0: { x: number; y: number }; d0: number; moved: boolean; target?: string; multi: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snapshot = (moved: boolean, target?: string, multi = false) => {
    const pts = [...pointers.current.values()];
    const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    const d0 = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { start: viewRef.current, p0: mid, d0, moved, target, multi };
  };
  const pendingTap = useRef<string | null>(null);
  const onClick = () => {
    const key = pendingTap.current;
    pendingTap.current = null;
    if (key) activate(key);
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // The first finger (or the mouse) always starts a fresh gesture, so a lost pointerup can't leak.
    if (e.isPrimary) { pointers.current.clear(); gesture.current = null; pendingTap.current = null; }
    try { box.current!.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.current.set(e.pointerId, local(e));
    setAnimate(false);
    const target = (e.target as Element).closest<SVGElement>('[data-node]')?.dataset.node;
    const multi = pointers.current.size > 1;
    snapshot(multi || (gesture.current?.moved ?? false), multi ? undefined : target, multi || !!gesture.current?.multi);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const mid = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    if (!g.moved && Math.hypot(mid.x - g.p0.x, mid.y - g.p0.y) < 8 && pts.length === 1) return;
    g.moved = true;
    let k = g.start.k;
    if (pts.length > 1 && g.d0 > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      k = Math.min(3, Math.max(0.12, (g.start.k * d) / g.d0));
    }
    // Keep the world point that was under the gesture's start midpoint under the current midpoint.
    const wx = (g.p0.x - g.start.x) / g.start.k;
    const wy = (g.p0.y - g.start.y) / g.start.k;
    setView({ k, x: mid.x - wx * k, y: mid.y - wy * k });
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      gesture.current = null;
      // Open on the click that follows, not here: otherwise that click lands on the new sheet's backdrop.
      pendingTap.current = g && !g.moved && !g.multi && g.target && e.type === 'pointerup' ? g.target : null;
    } else if (g) {
      snapshot(true, undefined, true); // continue panning with the remaining finger
    }
  };

  const activate = (key: string) => {
    if (key === centerId) { fit('all', true); return; }
    const slot = layout.slots.find((s) => s.key === key);
    if (slot?.more) setMoreOpen(slot);
    else if (slot?.personId) setSelected(slot.personId);
  };
  const onKey = (key: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(key); }
  };

  if (!center) return null;
  if (!nodes.length) {
    return (
      <div className="card mt-3 flex flex-col items-center px-6 py-10 text-center">
        <Users className="mb-2 text-stone-400" />
        <div className="font-medium">No one to show on the map yet</div>
        <div className="text-sm text-stone-500 dark:text-stone-400">Add family, friends or colleagues to {center.firstName} and they appear here.</div>
      </div>
    );
  }

  const centreName = truncate(center.firstName || displayName(center), 14);
  const hiLite = selected;
  // Keep a finger-sized (≥ 44 px) hit area when zoomed out, without swallowing the neighbours.
  const hitR = Math.max(26, Math.min(22 / view.k, S / 2));

  return (
    <div className="mt-3">
      {/* Filters */}
      {ringsPresent.length > 1 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Show circles">
          {ringsPresent.map((r) => {
            const on = !hiddenRings.has(r);
            return (
              <button key={r} type="button" aria-pressed={on} onClick={() => toggle(hiddenRings, r, setHiddenRings)}
                className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 transition ${on
                  ? 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-900/50 dark:text-brand-100 dark:ring-brand-800'
                  : 'bg-transparent text-stone-400 line-through ring-stone-200 dark:text-stone-500 dark:ring-stone-800'}`}>
                {on ? <Check size={15} /> : null}{ringName(r)}
              </button>
            );
          })}
        </div>
      )}
      {sectorCounts.length > 1 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Show groups">
          {sectorCounts.map(([s, n]) => {
            const on = !hiddenSectors.has(s);
            return (
              <button key={s} type="button" aria-pressed={on} onClick={() => toggle(hiddenSectors, s, setHiddenSectors)}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium ring-1 transition ${on
                  ? 'bg-white text-stone-800 ring-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-600'
                  : 'bg-transparent text-stone-400 line-through ring-stone-200 dark:text-stone-500 dark:ring-stone-800'}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${COLORS[s].dot} ${on ? '' : 'opacity-40'}`} />
                {SECTOR_TITLE[s]} <span className="text-stone-400">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Map */}
      <div ref={box}
        className="relative -mx-4 h-[66svh] max-h-[640px] min-h-[420px] touch-none select-none overflow-hidden bg-white ring-1 ring-stone-200/70 dark:bg-stone-900 dark:ring-stone-800 sm:mx-0 sm:rounded-2xl sm:shadow-card"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} onClick={onClick}>
        <svg width={size.w} height={size.h} className="block cursor-grab active:cursor-grabbing" role="group"
          aria-label={`Connections map for ${displayName(center)}. ${visible.length} people.`}>
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox"><circle cx={0.5} cy={0.5} r={0.5} /></clipPath>
          </defs>
          <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}
            className={animate ? 'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out' : ''}>
            {/* Sector wedges and ring guides */}
            {layout.sectors.map((s) => (
              <path key={s.key} d={wedge(s.a0, s.a1, s.rIn, s.rOut)} className={COLORS[s.key].wedge} />
            ))}
            {layout.rings.map((r) => (
              <circle key={r.ring} r={r.r} fill="none" strokeDasharray="2 6" className="stroke-stone-300 dark:stroke-stone-700" strokeWidth={1} />
            ))}

            {/* Spokes: centre → node (faint) */}
            {layout.slots.map((s) => (
              <line key={'s' + s.key} x1={0} y1={0} x2={s.x} y2={s.y} strokeWidth={hiLite === s.personId ? 2 : 1}
                strokeDasharray={s.ring >= 4 ? '3 4' : undefined}
                className={hiLite === s.personId ? 'stroke-brand-500' : 'stroke-stone-300/60 dark:stroke-stone-700/70'} />
            ))}
            {/* Friend-of-friend links between connections (stronger, so clusters show) */}
            {edges.map((e) => {
              const p = pos.get(e.a)!, q = pos.get(e.b)!;
              const cx = ((p.x + q.x) / 2) * 0.55, cy = ((p.y + q.y) / 2) * 0.55;
              const on = hiLite === e.a || hiLite === e.b;
              return (
                <path key={e.a + e.b} d={`M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`} fill="none"
                  strokeWidth={on ? 2.5 : e.kind === 'family' ? 1 : 1.75} strokeDasharray={e.kind === 'implicit' ? '4 4' : undefined}
                  className={on ? 'stroke-brand-500' : e.kind === 'family'
                    ? 'stroke-stone-300/50 dark:stroke-stone-600/50'
                    : 'stroke-stone-400/80 dark:stroke-stone-500/80'} />
              );
            })}

            {/* Sector labels */}
            {layout.sectors.map((s) => (
              <text key={'l' + s.key} x={s.lx} y={s.ly} textAnchor="middle" fontSize={12} fontWeight={700} letterSpacing={0.6}
                strokeWidth={4} strokeLinejoin="round" style={{ paintOrder: 'stroke' }}
                className={`${COLORS[s.key].text} stroke-white dark:stroke-stone-900`}>
                {SECTOR_TITLE[s.key].toUpperCase()}
              </text>
            ))}

            {/* Nodes */}
            {layout.slots.map((s) => {
              if (s.more) {
                return (
                  <g key={s.key} data-node={s.key} transform={`translate(${s.x} ${s.y})`} role="button" tabIndex={0}
                    aria-label={`${s.more.length} more in ${SECTOR_TITLE[s.sector]}. Show the list.`} onKeyDown={onKey(s.key)} className="cursor-pointer outline-none">
                    <circle r={hitR} fill="transparent" />
                    <circle r={20} strokeDasharray="3 3" strokeWidth={1.5} className="fill-stone-100 stroke-stone-400 dark:fill-stone-800 dark:stroke-stone-500" />
                    <text textAnchor="middle" y={5} fontSize={13} fontWeight={700} className="fill-stone-700 dark:fill-stone-200">+{s.more.length}</text>
                    <Label y={36} text="more" muted />
                  </g>
                );
              }
              const p = byId.get(s.personId!)!;
              const n = nodeById.get(p.id)!;
              const [bg, fg] = AVATAR_FILL[hash(p.id) % AVATAR_FILL.length];
              const on = hiLite === p.id;
              return (
                <g key={s.key} data-node={s.key} transform={`translate(${s.x} ${s.y})`} role="button" tabIndex={0}
                  aria-label={`${displayName(p)}, ${n.label}`} onKeyDown={onKey(s.key)} className="group cursor-pointer outline-none">
                  <circle r={hitR} fill="transparent" />
                  <circle r={22} strokeWidth={on ? 3 : 2} className={`${on ? 'stroke-brand-500' : 'stroke-white dark:stroke-stone-900'} ${COLORS[s.sector].fill} group-focus-visible:stroke-brand-500`} />
                  {p.photo
                    ? <image href={p.photo} x={-20} y={-20} width={40} height={40} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" className={p.deceased ? 'grayscale' : ''} />
                    : <>
                      <circle r={20} className={bg} />
                      <text textAnchor="middle" y={5} fontSize={14} fontWeight={600} className={fg}>{initials(p)}</text>
                    </>}
                  <Label y={38} text={shortName(p)} />
                </g>
              );
            })}

            {/* Centre */}
            <g data-node={centerId} role="button" tabIndex={0} aria-label={`${displayName(center)}, centre. Fit the map.`} onKeyDown={onKey(centerId)} className="cursor-pointer outline-none">
              <circle r={36} className="fill-brand-600" />
              {center.photo
                ? <image href={center.photo} x={-32} y={-32} width={64} height={64} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />
                : <>
                  <circle r={32} className={AVATAR_FILL[hash(center.id) % AVATAR_FILL.length][0]} />
                  <text textAnchor="middle" y={8} fontSize={22} fontWeight={600} className={AVATAR_FILL[hash(center.id) % AVATAR_FILL.length][1]}>{initials(center)}</text>
                </>}
              <Label y={54} text={centreName} strong />
            </g>
          </g>
        </svg>

        {/* Controls */}
        <div className="absolute right-2 top-2 flex flex-col gap-2">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-card ring-1 ring-stone-200 dark:bg-stone-800/95 dark:text-stone-100 dark:ring-stone-700"
            onClick={() => zoomBy(1.35)} aria-label="Zoom in"><Plus size={20} /></button>
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-card ring-1 ring-stone-200 dark:bg-stone-800/95 dark:text-stone-100 dark:ring-stone-700"
            onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out"><Minus size={20} /></button>
          <button type="button" className="flex h-11 items-center justify-center gap-1 rounded-full bg-white/95 px-3 text-sm font-medium text-stone-700 shadow-card ring-1 ring-stone-200 dark:bg-stone-800/95 dark:text-stone-100 dark:ring-stone-700"
            onClick={() => fit('all', true)} aria-label="Fit everyone on screen"><Maximize2 size={16} /> Fit</button>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-stone-500 dark:text-stone-400">
        Tap a person to see more · pinch or drag to move around
      </p>

      {/* Person sheet */}
      <Sheet open={!!selPerson} onClose={() => setSelected(null)} title={selPerson ? displayName(selPerson) : ''}
        footer={selPerson && <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" className="btn-primary min-h-11 flex-1" onClick={() => { setSelected(null); nav(`/people/${selPerson.id}?view=map`); }}>
            <Users size={17} /> Show {truncate(selPerson.firstName, 14)}’s connections
          </button>
          <button type="button" className="btn-secondary min-h-11 flex-1" onClick={() => { setSelected(null); nav(`/people/${selPerson.id}`); }}>
            <UserRound size={17} /> Open profile
          </button>
        </div>}>
        {selPerson && selNode && <NodeSummary person={selPerson} node={selNode} centre={center} />}
      </Sheet>

      {/* "+N more" list */}
      <Sheet open={!!moreOpen} onClose={() => setMoreOpen(null)}
        title={moreOpen ? `${SECTOR_TITLE[moreOpen.sector]} · ${ringName(moreOpen.ring)}` : ''}>
        {moreOpen && (
          <div className="-mx-2">
            {visible.filter((n) => n.ring === moreOpen.ring && sectorOf(n.group) === moreOpen.sector)
              .map((n) => byId.get(n.id)!)
              .sort((a, b) => a.firstName.localeCompare(b.firstName))
              .map((p) => (
                <PersonRow key={p.id} person={p} subtitle={<span className="font-medium text-brand-700 dark:text-brand-300">{nodeById.get(p.id)?.label}</span>}
                  onClick={() => { setMoreOpen(null); setSelected(p.id); }} />
              ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function Label({ y, text, strong, muted }: { y: number; text: string; strong?: boolean; muted?: boolean }) {
  return (
    <text y={y} textAnchor="middle" fontSize={strong ? 15 : 13} fontWeight={strong ? 700 : 500} strokeWidth={4} strokeLinejoin="round"
      style={{ paintOrder: 'stroke' }}
      className={`stroke-white dark:stroke-stone-900 ${muted ? 'fill-stone-500 dark:fill-stone-400' : 'fill-stone-800 dark:fill-stone-100'}`}>
      {text}
    </text>
  );
}

function NodeSummary({ person, node, centre }: { person: Person; node: SocialNode; centre: Person }) {
  return (
    <div className="flex items-start gap-4">
      <Avatar person={person} size={56} />
      <div className="min-w-0 flex-1">
        <span className="chip !bg-brand-100 !text-brand-800 dark:!bg-brand-900/60 dark:!text-brand-200">{node.label}</span>
        <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">Connection to {centre.firstName}</div>
        {person.howWeMet && <div className="mt-2 text-sm text-stone-700 dark:text-stone-300">{person.howWeMet}</div>}
        {person.appearance && <div className="mt-1 text-sm text-stone-500 dark:text-stone-400">{person.appearance}</div>}
      </div>
    </div>
  );
}
