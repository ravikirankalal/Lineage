import { Crosshair, Download, Maximize, Minus, Plus, Printer, Search, Share2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CARD, type TreeLayout, type TreeLevel, type TreeNode } from '../lib/graph/contract';
import { displayName, initials, lifespan, matchesQuery } from '../lib/person';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';
import { avatarColors, renderTreePng, shareOrDownload } from './tree/exportImage';
import { cardName, GhostCard, TreeCard, type CardInfo } from './tree/TreeCard';
import { TreeEdges } from './tree/TreeEdges';
import { clampZoom, prefersReducedMotion, usePanZoom, type View } from './tree/usePanZoom';

const FIT_PAD = 20;
const CONTROLS_W = 56; // the zoom buttons on the right; fitted views keep clear of them
const READABLE = 0.8; // zoom used when "fit" would make cards too small to read
const PRINT_BOX = { w: 1000, h: 660 }; // CSS px of a landscape A4 page inside the margins

export interface FindCandidate { person: Person; label?: string }

/**
 * The family tree canvas: draws a TreeLayout (cards + SVG edges) inside one transformed container
 * and adds touch/mouse navigation, zoom controls, Find, the level picker, and save/print.
 * It never computes kinship itself: the caller passes labels for the whole tree in `cardInfo`.
 */
export function FamilyTree({
  layout, focusId, centreId, centreLabel, cardInfo, path, panTo, level, onLevel, candidates, onFind,
  onTap, onToggle, onAddParent, onRecentre, banner, exportTitle,
}: {
  layout: TreeLayout;
  focusId: string;
  /** The person "Centre on me" goes to (the ego). */
  centreId: string;
  centreLabel: string;
  cardInfo: (n: TreeNode) => CardInfo | undefined;
  /** Person ids on the highlighted "how are we related" path. */
  path?: ReadonlySet<string>;
  /** Animate to this person whenever the nonce changes (Find, Show in tree). */
  panTo?: { id: string; nonce: number };
  level: TreeLevel;
  onLevel: (l: TreeLevel) => void;
  candidates: FindCandidate[];
  onFind: (id: string) => void;
  onTap: (n: TreeNode) => void;
  onToggle: (personId: string) => void;
  onAddParent?: (which: 'father' | 'mother') => void;
  /** The centre person isn't drawn at this level/focus: re-focus the tree on them. */
  onRecentre: () => void;
  banner?: ReactNode;
  exportTitle: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const pz = usePanZoom(box, world);
  const height = useFillHeight(box);

  const byKey = useMemo(() => new Map(layout.nodes.map((n) => [n.key, n])), [layout]);
  /** Primary card per person (not a collapse stub). */
  const byPerson = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const n of layout.nodes) if (n.personId && !n.dupOf && !m.has(n.personId)) m.set(n.personId, n);
    return m;
  }, [layout]);

  // ---- view helpers -------------------------------------------------------------------------
  const topInset = () => (overlay.current ? overlay.current.offsetTop + overlay.current.offsetHeight + 4 : 0);
  const fitView = useCallback((): View => {
    const { w, h } = pz.size();
    const { minX, maxX, minY, maxY } = layout.bounds;
    const top = topInset();
    const bw = maxX - minX;
    const bh = maxY - minY;
    const k = clampZoom(Math.min((w - FIT_PAD * 2 - CONTROLS_W) / bw, (h - top - FIT_PAD * 2) / bh, 1));
    return { k, x: (w - CONTROLS_W) / 2 - (minX + bw / 2) * k, y: top + (h - top) / 2 - (minY + bh / 2) * k };
  }, [layout, pz]);
  /** Centre a card in the area below the top bar, at least at zoom `minK` (or exactly `k`). */
  const centreView = useCallback((n: TreeNode, minK = READABLE, exactK?: number): View => {
    const { w, h } = pz.size();
    const top = topInset();
    const k = clampZoom(exactK ?? Math.max(pz.get().k, minK));
    return { k, x: w / 2 - n.x * k, y: top + (h - top) / 2 - (n.y + CARD.h / 2) * k };
  }, [pz]);
  /** On open: fit when everything stays readable, otherwise centre the focus at a readable zoom. */
  const openingView = useCallback((): View => {
    const f = byPerson.get(focusId);
    const fit = fitView();
    return fit.k >= 0.75 || !f ? fit : centreView(f, READABLE, READABLE);
  }, [byPerson, focusId, fitView, centreView]);

  // ---- layout change: opening view, or keep the anchor still + FLIP the cards ------------------
  const prev = useRef<{ byKey: Map<string, { x: number; y: number }>; byPerson: Map<string, { x: number; y: number }>; focus: string } | null>(null);
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = {
      byKey: new Map(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }])),
      byPerson: new Map([...byPerson].map(([id, n]) => [id, { x: n.x, y: n.y }])),
      focus: focusId,
    };
    if (!before) {
      pz.set(openingView());
      return;
    }
    // Keep a person who is on screen in both layouts at the same screen spot (new focus first).
    const anchorId = [focusId, before.focus].find((id) => before.byPerson.has(id) && byPerson.has(id));
    if (anchorId) {
      const o = before.byPerson.get(anchorId)!;
      const n = byPerson.get(anchorId)!;
      const v = pz.get();
      if (o.x !== n.x || o.y !== n.y) pz.set({ ...v, x: v.x + (o.x - n.x) * v.k, y: v.y + (o.y - n.y) * v.k });
    }
    const reduce = prefersReducedMotion();
    const el = world.current;
    if (el && !reduce) {
      const moved: HTMLElement[] = [];
      el.querySelectorAll<HTMLElement>('[data-key]').forEach((card) => {
        const node = byKey.get(card.dataset.key!);
        if (!node) return;
        const from = before.byKey.get(node.key) ?? (node.personId && !node.dupOf ? before.byPerson.get(node.personId) : undefined);
        card.style.transition = 'none';
        if (from && anchorId) {
          const dx = from.x - node.x;
          const dy = from.y - node.y;
          if (!dx && !dy) return;
          card.style.transform = `translate(${dx}px, ${dy}px)`;
        } else {
          card.style.opacity = '0';
        }
        moved.push(card);
      });
      const edges = moved.length ? el.querySelector<SVGElement>('.tree-edges') : null;
      if (edges) {
        edges.style.transition = 'none';
        edges.style.opacity = '0';
      }
      void el.offsetWidth; // commit the "from" state before transitioning
      requestAnimationFrame(() => {
        for (const card of moved) {
          card.style.transition = 'transform 380ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease';
          card.style.transform = '';
          card.style.opacity = '';
        }
        if (edges) {
          edges.style.transition = 'opacity 260ms ease 220ms';
          edges.style.opacity = '';
        }
      });
    }
    if (before.focus !== focusId) {
      const f = byPerson.get(focusId);
      if (f) pz.set(centreView(f, 0.6), true);
    }
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit when the box changes size (rotation, the height settling) until the user moves the tree.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = `${el.clientWidth}x${el.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const now = `${el.clientWidth}x${el.clientHeight}`;
      if (now === last) return;
      last = now;
      if (!userMoved.current) pz.set(openingView());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [openingView, pz]);

  // Any touch, click-drag or wheel means the user is in charge of the view now.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mark = () => { userMoved.current = true; };
    el.addEventListener('pointerdown', mark, true);
    el.addEventListener('wheel', mark, { capture: true, passive: true });
    return () => {
      el.removeEventListener('pointerdown', mark, true);
      el.removeEventListener('wheel', mark, true);
    };
  }, []);

  // Animated pan to a person (Find, Show in tree).
  const lastPan = useRef('');
  useEffect(() => {
    if (!panTo) return;
    // The highlight path can arrive a tick after the request (URL update): re-frame when it does.
    const key = `${panTo.id}:${panTo.nonce}:${path?.has(panTo.id) ? 'path' : ''}`;
    if (key === lastPan.current) return;
    const n = byPerson.get(panTo.id);
    if (!n) return; // waits for the layout that contains them
    lastPan.current = key;
    userMoved.current = true;
    // Wait a frame so a focus change's own animation doesn't fight this one, and the banner
    // (which changes the free space) has been laid out.
    requestAnimationFrame(() => pz.set((path?.has(panTo.id) && frameView([...path])) || centreView(n, READABLE), true));
  }, [panTo, byPerson, pz, centreView, path]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fit a group of people (a "how are we related" path) on screen, if that stays readable. */
  function frameView(ids: string[]): View | undefined {
    const ns = ids.map((id) => byPerson.get(id)).filter((n): n is TreeNode => !!n);
    if (ns.length < 2) return undefined;
    const minX = Math.min(...ns.map((n) => n.x)) - CARD.w / 2;
    const maxX = Math.max(...ns.map((n) => n.x)) + CARD.w / 2;
    const minY = Math.min(...ns.map((n) => n.y));
    const maxY = Math.max(...ns.map((n) => n.y)) + CARD.h;
    const { w, h } = pz.size();
    const top = topInset();
    const k = Math.min((w - FIT_PAD * 2 - CONTROLS_W) / (maxX - minX), (h - top - FIT_PAD * 2) / (maxY - minY), 1);
    if (k < 0.45) return undefined;
    return { k, x: (w - CONTROLS_W) / 2 - ((minX + maxX) / 2) * k, y: top + (h - top) / 2 - ((minY + maxY) / 2) * k };
  }

  const centreOnEgo = () => {
    const n = byPerson.get(centreId);
    userMoved.current = true;
    if (n) pz.set(centreView(n, READABLE), true);
    else onRecentre();
  };
  const goToNode = useCallback((n: TreeNode) => {
    if (n.dupOf) {
      const primary = byKey.get(n.dupOf);
      if (primary) {
        userMoved.current = true;
        pz.set(centreView(primary, READABLE), true);
      }
      return;
    }
    onTap(n);
  }, [byKey, pz, centreView, onTap]);

  // ---- print: a CSS variable holds the fit-to-page transform -------------------------------------
  const printTransform = useMemo(() => {
    const { minX, maxX, minY, maxY } = layout.bounds;
    const bw = maxX - minX + 40;
    const bh = maxY - minY + 40;
    const k = Math.min(PRINT_BOX.w / bw, PRINT_BOX.h / bh, 1);
    const x = (PRINT_BOX.w - (maxX - minX) * k) / 2 - minX * k;
    const y = (PRINT_BOX.h - (maxY - minY) * k) / 2 - minY * k;
    return `translate(${x}px, ${y}px) scale(${k})`;
  }, [layout]);

  // ---- save as image -----------------------------------------------------------------------------
  const [saving, setSaving] = useState<string | null>(null);
  const saveImage = async () => {
    setSaving('Making the picture…');
    try {
      const blob = await renderTreePng(layout, (n) => {
        const info = n.personId ? cardInfo(n) : undefined;
        if (!info) return undefined;
        const p = info.person;
        const span = lifespan(p);
        const line1 = info.term ? `${info.term} · ${info.label ?? ''}` : info.label;
        return {
          name: cardName(p), line1: n.dupOf ? 'Also shown above' : line1, line2: n.dupOf ? undefined : span || undefined,
          initials: initials(p), photo: p.photo, isFocus: info.isFocus, isMe: info.isMe,
          badge: n.step ? 'Step' : n.half ? 'Half' : undefined, colors: avatarColors(p.id),
        };
      }, exportTitle);
      const name = exportTitle.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'family-tree';
      const res = await shareOrDownload(blob, `${name}.png`, exportTitle);
      setSaving(res === 'downloaded' ? 'Saved to your downloads' : res === 'shared' ? 'Shared' : null);
    } catch {
      setSaving('Sorry, the picture could not be made');
    }
    setTimeout(() => setSaving(null), 2500);
  };

  const pathActive = !!path && path.size > 0;
  const nodes = layout.nodes;

  return (
    <div
      ref={box}
      className="tree-viewport relative touch-none select-none overflow-hidden rounded-2xl bg-stone-100/70 ring-1 ring-stone-200/70 dark:bg-stone-900/60 dark:ring-stone-800"
      style={{ height, ['--print-transform' as string]: printTransform }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') pz.zoomBy(1.25, undefined, true);
        else if (e.key === '-') pz.zoomBy(0.8, undefined, true);
        else if (e.key === '0') pz.set(fitView(), true);
      }}
    >
      <div ref={world} className="tree-world absolute left-0 top-0 origin-top-left will-change-transform">
        <TreeEdges edges={layout.edges} path={path} />
        {nodes.map((n) => {
          if (n.ghost) return onAddParent ? <GhostCard key={n.key} node={n} onAdd={onAddParent} /> : null;
          const info = cardInfo(n);
          if (!info) return null;
          const mark = pathActive ? (path!.has(info.person.id) ? 'path' : 'dim') : undefined;
          return <TreeCard key={n.key} node={n} info={mark ? { ...info, mark } : info} onTap={goToNode} onToggle={onToggle} />;
        })}
      </div>

      {/* Top: Find + level picker + save. */}
      <div ref={overlay} data-no-pan className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-col gap-2 print:hidden">
        <div className="flex flex-wrap items-start gap-2">
          <FindInTree candidates={candidates} onFind={onFind} />
          <LevelPicker level={level} onLevel={onLevel} />
          <SaveMenu onImage={saveImage} />
        </div>
        {banner}
      </div>

      {/* Bottom-right controls, clear of the centre and of the phone's home indicator. */}
      <div data-no-pan className="absolute z-10 flex flex-col gap-1 rounded-2xl bg-white/90 p-1 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/90 dark:ring-stone-700 print:hidden"
        style={{ right: 'calc(10px + env(safe-area-inset-right))', bottom: 10 }}>
        <button type="button" className="icon-btn" onClick={() => { userMoved.current = true; pz.zoomBy(1.3, undefined, true); }} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button>
        <button type="button" className="icon-btn" onClick={() => { userMoved.current = true; pz.zoomBy(1 / 1.3, undefined, true); }} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button>
        <button type="button" className="icon-btn" onClick={() => { userMoved.current = true; pz.set(fitView(), true); }} aria-label="Fit the whole tree" title="Fit the whole tree"><Maximize size={17} /></button>
        <button type="button" className="icon-btn" onClick={centreOnEgo} aria-label={`Centre on ${centreLabel}`} title={`Centre on ${centreLabel}`}><Crosshair size={18} /></button>
      </div>

      {saving && (
        <div role="status" className="absolute bottom-3 print:hidden left-1/2 z-20 -translate-x-1/2 rounded-full bg-stone-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
          {saving}
        </div>
      )}
    </div>
  );
}

/** Tree height: fill the viewport below the box, above the phone's bottom tabs. */
function useFillHeight(box: React.RefObject<HTMLDivElement | null>): string {
  const [top, setTop] = useState<number | null>(null);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 768px)').matches);
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current;
      if (!el) return;
      setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
      setWide(!!window.matchMedia?.('(min-width: 768px)').matches);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [box]);
  // Bottom tabs are ~58px plus the safe area on phones; desktop keeps a small margin.
  const reserve = wide ? '24px' : 'calc(70px + env(safe-area-inset-bottom))';
  return `max(360px, calc(100dvh - ${top ?? 200}px - ${reserve}))`;
}

function LevelPicker({ level, onLevel }: { level: TreeLevel; onLevel: (l: TreeLevel) => void }) {
  const opts: { key: TreeLevel; label: string; hint: string }[] = [
    { key: 'immediate', label: 'Immediate', hint: 'Parents, brothers and sisters, partners, children, and the direct line' },
    { key: 'extended', label: 'Extended', hint: 'Adds uncles, aunts, cousins, nieces, nephews and in-laws' },
    { key: 'everyone', label: 'Everyone', hint: 'The whole family' },
  ];
  return (
    <div role="radiogroup" aria-label="How much of the family to show"
      className="pointer-events-auto order-last inline-flex w-full rounded-xl bg-white/95 p-1 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700 sm:order-none sm:w-auto">
      {opts.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={level === o.key} title={o.hint} onClick={() => onLevel(o.key)}
          className={`min-h-[34px] flex-1 rounded-lg px-3 text-[13px] font-medium transition sm:flex-none ${
            level === o.key ? 'bg-brand-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SaveMenu({ onImage }: { onImage: () => void }) {
  const [open, setOpen] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-save-menu]')) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div data-save-menu className="pointer-events-auto relative z-20">
      <button type="button" className="icon-btn bg-white/95 shadow-card ring-1 ring-stone-200 dark:bg-stone-800/95 dark:ring-stone-700"
        aria-label="Save or print the tree" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {canShare ? <Share2 size={18} /> : <Download size={18} />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 w-56 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700">
          <button type="button" className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700"
            onClick={() => { setOpen(false); onImage(); }}>
            {canShare ? <Share2 size={17} /> : <Download size={17} />} {canShare ? 'Share as picture' : 'Save as picture'}
          </button>
          <button type="button" className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700"
            onClick={() => { setOpen(false); setTimeout(() => window.print(), 50); }}>
            <Printer size={17} /> Print
          </button>
        </div>
      )}
    </div>
  );
}

function FindInTree({ candidates, onFind }: { candidates: FindCandidate[]; onFind: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => (q.trim() ? candidates.filter((c) => matchesQuery(c.person, q)).slice(0, 8) : []), [q, candidates]);
  const pick = (id: string) => {
    onFind(id);
    setQ('');
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <div className="pointer-events-auto relative z-20 min-w-0 flex-1 sm:max-w-xs">
      <input
        className="input h-10 bg-white/95 py-2 pl-9 pr-9 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700"
        placeholder="Find in tree" aria-label="Find a person in the tree" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) pick(results[0].person.id);
          if (e.key === 'Escape') { setQ(''); setOpen(false); }
        }}
      />
      <Search size={17} className="pointer-events-none absolute left-3 top-5 -translate-y-1/2 text-stone-400" />
      {q && (
        <button type="button" className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-stone-400" aria-label="Clear search" onClick={() => { setQ(''); setOpen(false); }}>
          <X size={16} />
        </button>
      )}
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-12 max-h-80 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700">
          {results.length ? results.map(({ person: p, label }) => (
            <button key={p.id} type="button" onClick={() => pick(p.id)}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-stone-100 dark:hover:bg-stone-700">
              <Avatar person={p} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{displayName(p)}</div>
                {label && <div className="truncate text-xs text-brand-700 dark:text-brand-300">{label}</div>}
              </div>
            </button>
          )) : <p className="px-3 py-3 text-sm text-stone-500">No one in this family matches “{q}”.</p>}
        </div>
      )}
    </div>
  );
}
