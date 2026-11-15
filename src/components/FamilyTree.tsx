import { ArrowDownFromLine, ArrowRightFromLine, Crosshair, Expand, Move, Shrink, Download, Maximize, Maximize2, Minimize2, Minus, Plus, Printer, Search, Share2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CARD, type TreeLayout, type TreeLevel, type TreeNode, type TreeOrient } from '../lib/graph/contract';
import { generationBands, type GenBand } from '../lib/generationBands';
import { displayName, initials, lifespan, matchesQuery } from '../lib/person';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';
import { avatarColors, renderTreePng, shareOrDownload } from './tree/exportImage';
import { cardName, GhostCard, TreeCard, type CardInfo } from './tree/TreeCard';
import { TreeEdges } from './tree/TreeEdges';
import { useImplode } from './tree/useImplode';
import { detailFor, type Detail } from './tree/detail';

/** The opening intro (imploded → exploded) plays once per app start. */
let introPlayed = false;
import { clampZoom, prefersReducedMotion, usePanZoom, type View } from './tree/usePanZoom';
import { recallView, rememberView } from './tree/viewMemory';
import { useAutoHideTabs, useBottomTabsHidden } from './tree/bottomTabs';

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
  viewKey, layout, focusId, centreId, centreLabel, cardInfo, path, pathEdges, panTo, level, onLevel, orient, onOrient, candidates, onFind,
  onTap, onToggle, onAddParent, onRecentre, banner, exportTitle, map = false,
}: {
  layout: TreeLayout;
  focusId: string;
  /** The person "Centre on me" goes to (the ego). */
  centreId: string;
  centreLabel: string;
  cardInfo: (n: TreeNode) => CardInfo | undefined;
  /** Person ids on the highlighted "how are we related" path. */
  path?: ReadonlySet<string>;
  /** Keys of the lines along that path (pathEdgeKeys). */
  pathEdges?: ReadonlySet<string>;
  /** Animate to this person whenever the nonce changes (Find, Show in tree). */
  panTo?: { id: string; nonce: number };
  level: TreeLevel;
  onLevel: (l: TreeLevel) => void;
  orient: TreeOrient;
  onOrient: (o: TreeOrient) => void;
  candidates: FindCandidate[];
  onFind: (id: string) => void;
  onTap: (n: TreeNode) => void;
  onToggle: (personId: string) => void;
  onAddParent?: (which: 'father' | 'mother') => void;
  /** The centre person isn't drawn at this level/focus: re-focus the tree on them. */
  onRecentre: () => void;
  banner?: ReactNode;
  exportTitle: string;
  /** Map view: fills the page edge to edge, with only Find, levels, layout and zoom (no save, no full screen). */
  map?: boolean;
  /** Remember this tree's view (zoom and position) under this name, per level, layout and focus. */
  viewKey?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  // Cards show more or less depending on how big they are on screen (four designs, detail.ts). Only a
  // change of level re-renders them; panning and zooming within a level don't.
  const [detail, setDetail] = useState<Detail>(3);
  const detailRef = useRef<Detail>(3);
  // Each level / layout / focus of this tree keeps its own view (viewMemory.ts).
  const memKey = viewKey ? `${viewKey}|${level}|${orient}|${focusId}` : '';
  const memKeyRef = useRef(memKey);
  const restored = useRef(false);
  const onView = useCallback((v: View) => {
    // Saved by the world point in the middle of the box, so it lines up whatever the box size then.
    if (memKeyRef.current) {
      const { w, h } = pzRef.current?.size() ?? { w: 0, h: 0 };
      rememberView(memKeyRef.current, { x: (w / 2 - v.x) / v.k, y: (h / 2 - v.y) / v.k, k: v.k });
    }
    const d = detailFor(v.k, detailRef.current);
    if (d !== detailRef.current) { detailRef.current = d; setDetail(d); }
  }, []);
  const pz = usePanZoom(box, world, onView);
  const pzRef = useRef(pz);
  pzRef.current = pz;
  // Registered after pan/zoom's click handler, so taps that ended a drag stay swallowed.
  useAutoHideTabs(map, box);
  const tabsHidden = useBottomTabsHidden();
  const phoneTabs = usePhoneTabs();
  const height = useFillHeight(box, map);
  const [full, toggleFull] = useFullScreen();

  const byKey = useMemo(() => new Map(layout.nodes.map((n) => [n.key, n])), [layout]);
  /** Primary card per person (not a collapse stub). */
  const byPerson = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const n of layout.nodes) if (n.personId && !n.dupOf && !m.has(n.personId)) m.set(n.personId, n);
    return m;
  }, [layout]);

  // Generation stripes behind the cards; the view fits them (and their labels) too.
  const focusInfo = byPerson.get(focusId) ? cardInfo(byPerson.get(focusId)!) : undefined;
  const focusName = focusInfo && !focusInfo.isMe ? focusInfo.person.firstName : null;
  const { bands, bounds: viewBounds } = useMemo(() => generationBands(layout, orient, focusName), [layout, orient, focusName]);

  // ---- view helpers -------------------------------------------------------------------------
  const topInset = () => (overlay.current ? overlay.current.offsetTop + overlay.current.offsetHeight + 4 : 0);
  const fitView = useCallback((): View => {
    const { w, h } = pz.size();
    const { minX, maxX, minY, maxY } = viewBounds;
    const top = topInset();
    const bw = maxX - minX;
    const bh = maxY - minY;
    const k = clampZoom(Math.min((w - FIT_PAD * 2 - CONTROLS_W) / bw, (h - top - FIT_PAD * 2) / bh, 1));
    return { k, x: (w - CONTROLS_W) / 2 - (minX + bw / 2) * k, y: top + (h - top) / 2 - (minY + bh / 2) * k };
  }, [viewBounds, pz]);
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

  // ---- Implode / explode (Extended and Everyone, cross layout) ---------------------------------
  const canImplode = (level === 'everyone' || level === 'extended') && orient === 'cross';
  const axisNode = byPerson.get(focusId) ?? byPerson.get(centreId);
  const imp = useImplode({ world, box, layout, axis: axisNode ? { x: axisNode.x, y: axisNode.y } : undefined, pz });

  // ---- layout change: opening view, or keep the anchor still + FLIP the cards ------------------
  const prev = useRef<{ byKey: Map<string, { x: number; y: number }>; byPerson: Map<string, { x: number; y: number }>; focus: string } | null>(null);
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = {
      byKey: new Map(layout.nodes.map((n) => [n.key, { x: n.x, y: n.y }])),
      byPerson: new Map([...byPerson].map(([id, n]) => [id, { x: n.x, y: n.y }])),
      focus: focusId,
    };
    // Back on a level / focus seen before (or on this page after visiting a profile): its own view.
    const keyChanged = memKeyRef.current !== memKey;
    memKeyRef.current = memKey;
    const saved = memKey && (!before || keyChanged) ? recallView(memKey) : undefined;
    if (saved) {
      restored.current = true;
      userMoved.current = true;
      const { w, h } = pz.size();
      pz.set({ k: saved.k, x: w / 2 - saved.x * saved.k, y: h / 2 - saved.y * saved.k });
    }
    if (!before) {
      if (!saved) pz.set(openingView());
      return;
    }
    // Keep a person who is on screen in both layouts at the same screen spot (new focus first).
    const anchorId = saved ? undefined : [focusId, before.focus].find((id) => before.byPerson.has(id) && byPerson.has(id));
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
    if (before.focus !== focusId && !saved) {
      const f = byPerson.get(focusId);
      if (f) pz.set(centreView(f, 0.6), true);
    }
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Family Tree opens imploded at Extended and explodes into the tree, once per app start
  // (owner's request). Skipped under automation (tests tap cards at once) and with reduced motion.
  useLayoutEffect(() => {
    if (introPlayed || !map || !layout.nodes.length) return;
    introPlayed = true; // only the first view of the Family Tree, whatever level it opens at
    if (restored.current) return; // coming back to a remembered view: no intro
    if (level !== 'extended' || !canImplode || (typeof navigator !== 'undefined' && navigator.webdriver)) return;
    imp.intro();
  }, [map, level, canImplode, layout, imp]);

  // When the box changes size (rotation, the height settling, full screen): re-fit until the user moves
  // the tree; after that keep the same point in the middle.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      if (now.w === last.w && now.h === last.h) return;
      const dw = now.w - last.w;
      const dh = now.h - last.h;
      last = now;
      if (!userMoved.current) pz.set(openingView());
      else {
        const v = pz.get();
        pz.set({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 });
      }
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
        // Flash a yellow ring on the card we arrived at, so it's clear which one it is.
        const card = world.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(primary.key)}"] .tree-card`);
        if (card) {
          card.classList.remove('tree-flash');
          void card.offsetWidth; // restart the animation on a second tap
          card.classList.add('tree-flash');
          card.addEventListener('animationend', () => card.classList.remove('tree-flash'), { once: true });
        }
      }
      return;
    }
    onTap(n);
  }, [byKey, pz, centreView, onTap]);

  // ---- print: a CSS variable holds the fit-to-page transform -------------------------------------
  const printTransform = useMemo(() => {
    const { minX, maxX, minY, maxY } = viewBounds;
    const bw = maxX - minX + 40;
    const bh = maxY - minY + 40;
    const k = Math.min(PRINT_BOX.w / bw, PRINT_BOX.h / bh, 1);
    const x = (PRINT_BOX.w - (maxX - minX) * k) / 2 - minX * k;
    const y = (PRINT_BOX.h - (maxY - minY) * k) / 2 - minY * k;
    return `translate(${x}px, ${y}px) scale(${k})`;
  }, [viewBounds]);

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
          name: cardName(p), line1: n.dupOf ? 'Also shown elsewhere' : line1, line2: n.dupOf ? undefined : span || undefined,
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
      className={`tree-viewport touch-none select-none overflow-hidden ${map ? 'tree-map ' : ''}${full
        ? 'fixed inset-0 z-[45] bg-stone-100 dark:bg-stone-900'
        : map ? 'relative bg-stone-100/70 dark:bg-stone-900/60'
        : 'relative rounded-2xl bg-stone-100/70 ring-1 ring-stone-200/70 dark:bg-stone-900/60 dark:ring-stone-800'}`}
      style={{ height: full ? '100dvh' : height, ['--print-transform' as string]: printTransform }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') pz.zoomBy(1.25, undefined, true);
        else if (e.key === '-') pz.zoomBy(0.8, undefined, true);
        else if (e.key === '0') pz.set(fitView(), true);
      }}
    >
      <div ref={world} data-detail={detail} className="tree-world absolute left-0 top-0 origin-top-left will-change-transform"
        style={imp.state !== 'open' ? { pointerEvents: 'none' } : undefined}>
        <GenerationBands bands={bands} />
        <TreeEdges edges={layout.edges} path={path} lit={pathEdges} />
        {nodes.map((n) => {
          if (n.ghost) return onAddParent ? <GhostCard key={n.key} node={n} onAdd={onAddParent} /> : null;
          const info = cardInfo(n);
          if (!info) return null;
          const mark = pathActive ? (path!.has(info.person.id) ? 'path' : 'dim') : undefined;
          return <TreeCard key={n.key} node={n} info={mark ? { ...info, mark } : info} onTap={goToNode} onToggle={onToggle} detail={detail} />;
        })}
      </div>

      {/* Top: Find + level picker + save. */}
      <div ref={overlay} data-no-pan className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-col gap-2 print:hidden"
        style={full ? { top: 'calc(8px + env(safe-area-inset-top))' } : undefined}>
        <div className="flex flex-wrap items-start gap-2">
          <FindInTree candidates={candidates} onFind={onFind} />
          <LevelPicker level={level} onLevel={onLevel} />
          <OrientButton orient={orient} onOrient={onOrient} />
          {!map && <SaveMenu onImage={saveImage} />}
        </div>
        {banner}
      </div>

      {/* Bottom-right controls, clear of the centre and of the phone's home indicator. */}
      <div data-no-pan className="map-glass absolute z-10 flex flex-col gap-1 rounded-2xl bg-white/90 p-1 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/90 dark:ring-stone-700 print:hidden"
        style={{
          right: 'calc(10px + env(safe-area-inset-right))',
          // Map view on phones: the tabs float over the tree, so sit above them while they show.
          bottom: full || (map && phoneTabs) ? `calc(${map && phoneTabs && !tabsHidden ? 68 : 10}px + env(safe-area-inset-bottom))` : 10,
          transition: 'bottom 200ms ease',
        }}>
        {!map && (
          <button type="button" className="icon-btn" onClick={toggleFull} aria-pressed={full}
            aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'}>
            {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}
        {canImplode && (
          <button type="button" className="icon-btn text-brand-700 disabled:opacity-60 dark:text-brand-200" disabled={imp.state === 'moving'} aria-pressed={imp.state === 'imploded'}
            onClick={imp.state === 'imploded' ? imp.explode : imp.implode}
            aria-label={imp.state === 'imploded' ? 'Explode' : 'Implode'}
            title={imp.state === 'imploded' ? 'Explode back into the tree' : 'Implode: collapse the tree into stacks'}>
            {imp.state === 'imploded' ? <Expand size={18} /> : <Shrink size={18} />}
          </button>
        )}
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

/**
 * Full screen for the tree. The box covers the page (above the phone tabs, below sheets, so a tapped
 * card's sheet still opens), and where the browser allows it the page also goes truly full screen,
 * hiding the browser's own bars. Esc, the button or leaving browser full screen all exit.
 */
function useFullScreen(): [boolean, () => void] {
  const [full, setFull] = useState(false);
  const native = useRef(false);
  const exit = useCallback(() => {
    setFull(false);
    if (native.current && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    native.current = false;
  }, []);
  const toggle = useCallback(() => {
    if (full) return exit();
    setFull(true);
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => { native.current = true; }, () => {});
    }
  }, [full, exit]);
  useEffect(() => {
    if (!full) return;
    const onChange = () => {
      if (native.current && !document.fullscreenElement) {
        native.current = false;
        setFull(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) exit();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [full, exit]);
  // Leave full screen if the tree goes away (another tab, another page).
  useEffect(() => () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  return [full, toggle];
}

/** Tree height: fill the viewport below the box, above the phone's bottom tabs. */
/** True where the bottom tab bar is shown (below `md`). */
function usePhoneTabs(): boolean {
  const q = '(max-width: 767px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return on;
}

function useFillHeight(box: React.RefObject<HTMLDivElement | null>, edge = false): string {
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
  // Bottom tabs are ~58px plus the safe area on phones; desktop keeps a small margin. In map view the
  // tree runs to the bottom of the screen and the phone tabs float over it (and hide when idle).
  const reserve = edge ? '0px' : wide ? '24px' : 'calc(70px + env(safe-area-inset-bottom))';
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
      className="map-glass pointer-events-auto order-last inline-flex w-full rounded-xl bg-white/95 p-1 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700 sm:order-none sm:w-auto">
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

/** Soft stripes per generation (four tints, so neighbouring generations always differ). */
const BAND_TINT = [
  'bg-stone-200/45 dark:bg-stone-800/45',
  'bg-amber-100/45 dark:bg-amber-900/15',
  'bg-emerald-100/40 dark:bg-emerald-900/15',
  'bg-sky-100/45 dark:bg-sky-900/15',
];
const REGION_TINT = {
  father: 'bg-sky-100/50 dark:bg-sky-900/15',
  middle: 'bg-stone-200/45 dark:bg-stone-800/45',
  mother: 'bg-rose-100/45 dark:bg-rose-900/15',
};
/** How far a band reaches past the edge of the tree (layout units): more than any screen at the
 * smallest zoom, so the bands look endless when zoomed out (the owner's request). */
const FAR = 20_000;
const GenerationBands = memo(function GenerationBands({ bands }: { bands: GenBand[] }) {
  // A band edge on the outside of the whole picture reaches FAR beyond it; titles stay on the tree.
  const minX = Math.min(...bands.map((b) => b.x0));
  const maxX = Math.max(...bands.map((b) => b.x1));
  const minY = Math.min(...bands.map((b) => b.y0));
  const maxY = Math.max(...bands.map((b) => b.y1));
  const far = (b: GenBand) => {
    const x0 = b.x0 <= minX + 0.5 ? b.x0 - FAR : b.x0;
    const x1 = b.x1 >= maxX - 0.5 ? b.x1 + FAR : b.x1;
    const y0 = b.y0 <= minY + 0.5 ? b.y0 - FAR : b.y0;
    const y1 = b.y1 >= maxY - 0.5 ? b.y1 + FAR : b.y1;
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  };
  const box = (b: GenBand) => ({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
  return (
    <div className="tree-bands pointer-events-none absolute left-0 top-0" aria-hidden>
      {bands.map((b) => (
        <div key={`${b.key}:fill`} className={`absolute ${b.region ? REGION_TINT[b.region] : BAND_TINT[((b.gen % 4) + 4) % 4]}`} style={far(b)} />
      ))}
      {bands.map((b) => b.region ? (
        <div key={b.key} className="absolute" style={box(b)}>
          <span className="absolute left-0 right-0 top-2.5 whitespace-nowrap text-center text-[13px] font-bold uppercase tracking-wide text-stone-600 dark:text-stone-300">
            {b.label}
          </span>
          {b.columns?.map((c) => (
            <span key={c.x} className="absolute top-8 w-[164px] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[11px] font-semibold uppercase tracking-wide text-stone-500/90 dark:text-stone-400/80"
              style={{ left: c.x - b.x0 }}>
              {c.label}
            </span>
          ))}
        </div>
      ) : (
        <div key={b.key} className="absolute" style={box(b)}>
          <span className={`absolute whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-stone-500/90 dark:text-stone-400/80 ${
            b.vertical ? 'left-0 right-0 top-3 overflow-hidden text-ellipsis px-2 text-center' : 'left-3 top-1'}`}>
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
});

/** Cycle the layout: cross (parents' sides left/right, siblings up/down) → top to bottom → left to right. */
const NEXT_ORIENT: Record<TreeOrient, TreeOrient> = { cross: 'down', down: 'right', right: 'cross' };
const ORIENT_LABEL: Record<TreeOrient, string> = {
  cross: "Layout: father's side left, mother's side right",
  down: 'Layout: generations top to bottom',
  right: 'Layout: generations left to right',
};
function OrientButton({ orient, onOrient }: { orient: TreeOrient; onOrient: (o: TreeOrient) => void }) {
  const next = NEXT_ORIENT[orient];
  const label = `${ORIENT_LABEL[next]} (now: ${ORIENT_LABEL[orient].replace('Layout: ', '')})`;
  return (
    <button type="button" data-orient={orient}
      className="map-glass icon-btn pointer-events-auto bg-white/95 shadow-card ring-1 ring-stone-200 dark:bg-stone-800/95 dark:ring-stone-700"
      aria-label={label} title={label} onClick={() => onOrient(next)}>
      {next === 'right' ? <ArrowRightFromLine size={18} /> : next === 'down' ? <ArrowDownFromLine size={18} /> : <Move size={18} />}
    </button>
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
        className="map-glass input h-10 bg-white/95 py-2 pl-9 pr-9 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700"
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
