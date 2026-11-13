import { Maximize2, Minus, Plus, UserPlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/data';
import { kinship } from '../lib/kinship';
import { displayName, lifespan } from '../lib/person';
import { CARD_H, CARD_W, layoutTree } from '../lib/tree';
import { Avatar } from './Avatar';
import { useRegionalTerm } from './KinLabel';

const PAD = 40;

export function FamilyTree({ focusId, egoId, egoLabel = 'You', onSelect, onOpen, onAddParent, height = '70dvh' }: {
  focusId: string;
  /** Whose point of view kinship labels use (defaults to focus). */
  egoId?: string;
  /** Label shown on the ego's own card. */
  egoLabel?: string;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  onAddParent?: (which: 'father' | 'mother') => void;
  height?: string;
}) {
  const { graph, byId } = useData();
  const layout = useMemo(() => layoutTree(graph, focusId, { ghosts: !!onAddParent }), [graph, focusId, onAddParent]);
  const ego = egoId ?? focusId;
  const egoAnc = useMemo(() => graph.ancestors(ego), [graph, ego]);
  const termFor = useRegionalTerm();
  const [scale, setScale] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 0.8 : 1));
  const scroller = useRef<HTMLDivElement>(null);

  const w = layout.maxX - layout.minX + PAD * 2;
  const h = layout.maxY - layout.minY + PAD * 2;
  const ox = -layout.minX + PAD;
  const oy = -layout.minY + PAD;

  const centre = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({
      left: ox * scale - el.clientWidth / 2,
      top: (oy + CARD_H / 2) * scale - el.clientHeight / 2,
      behavior: smooth ? 'smooth' : 'auto',
    });
  };
  useLayoutEffect(() => { centre(false); }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { centre(false); }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-to-pan with mouse (touch scrolls natively).
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !scroller.current) return;
    drag.current = { x: e.clientX, y: e.clientY, l: scroller.current.scrollLeft, t: scroller.current.scrollTop, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !scroller.current) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    scroller.current.scrollLeft = d.l - dx;
    scroller.current.scrollTop = d.t - dy;
  };
  const endDrag = () => {
    setTimeout(() => (drag.current = null), 0);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-stone-100/70 ring-1 ring-stone-200/70 dark:bg-stone-900/60 dark:ring-stone-800" style={{ height }}>
      <div
        ref={scroller}
        className="no-scrollbar h-full w-full cursor-grab overflow-auto active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div style={{ width: Math.max(w * scale, 1), height: h * scale, position: 'relative' }}>
          <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'absolute', inset: 0 }}>
            <svg width={w} height={h} className="absolute inset-0 text-stone-300 dark:text-stone-600">
              <g transform={`translate(${ox} ${oy})`} fill="none" stroke="currentColor" strokeWidth={1.5}>
                {layout.paths.map((d, i) => <path key={i} d={d} strokeLinejoin="round" />)}
                {layout.marriages.map((d, i) => <path key={'m' + i} d={d} strokeDasharray="4 4" className="text-brand-400" stroke="currentColor" />)}
              </g>
            </svg>
            {layout.nodes.map((n) => {
              const style = { left: n.x + ox - CARD_W / 2, top: n.y + oy, width: CARD_W, height: CARD_H };
              if (n.ghost) {
                return (
                  <button key={n.key} style={style} onClick={() => onAddParent?.(n.ghost!)}
                    className="absolute flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 text-sm font-medium text-stone-500 transition hover:border-brand-400 hover:text-brand-600 dark:border-stone-700">
                    <UserPlus size={16} /> Add {n.ghost}
                  </button>
                );
              }
              const p = byId.get(n.personId!);
              if (!p) return null;
              const kin = n.personId === ego ? undefined : kinship(graph, ego, p.id, egoAnc);
              const term = kin ? termFor(ego, p.id, kin.label) : undefined;
              const span = lifespan(p);
              const relCls = n.focus ? 'text-white/85' : 'text-brand-700 dark:text-brand-300';
              const mutedCls = n.focus ? 'text-white/70' : 'text-stone-500 dark:text-stone-400';
              const spanCls = n.focus ? 'text-white/70' : 'text-stone-400';
              return (
                <button
                  key={n.key}
                  style={style}
                  onClick={() => {
                    if (drag.current?.moved) return;
                    if (n.focus && onOpen) onOpen(p.id);
                    else onSelect(p.id);
                  }}
                  title={(n.focus ? 'Open profile' : 'Centre tree on ' + displayName(p)) + (term ? ` (${term} · ${kin?.label})` : '')}
                  className={`absolute flex items-center gap-2.5 rounded-2xl px-2.5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-md ${
                    n.focus
                      ? 'bg-brand-600 text-white ring-2 ring-brand-600 ring-offset-2 ring-offset-stone-100 dark:ring-offset-stone-900'
                      : 'bg-white ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700'
                  } ${p.deceased ? 'opacity-80' : ''}`}
                >
                  <Avatar person={p} size={38} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[13px] font-semibold">{p.nickname && p.nickname.length < 12 ? p.nickname : p.firstName} {p.lastName ? p.lastName[0] + '.' : ''}</div>
                    {term ? (
                      // Regional term first: it's the word the family uses, and it's short enough to
                      // survive truncation. The English label follows, quieter. With no lifespan, the
                      // English label gets the third line to itself so neither word is cut.
                      span ? (
                        <>
                          <div className={`truncate text-[11px] ${relCls}`}>
                            <span className="font-semibold">{term}</span>
                            <span className={mutedCls}> · {kin?.label}</span>
                          </div>
                          <div className={`truncate text-[11px] ${spanCls}`}>{span}</div>
                        </>
                      ) : (
                        <>
                          <div className={`truncate text-[11px] font-semibold ${relCls}`}>{term}</div>
                          <div className={`truncate text-[11px] ${mutedCls}`}>{kin?.label}</div>
                        </>
                      )
                    ) : (
                      <>
                        <div className={`truncate text-[11px] ${relCls}`}>{n.personId === ego ? egoLabel : kin?.label ?? ''}</div>
                        <div className={`truncate text-[11px] ${spanCls}`}>{span}</div>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-2xl bg-white/90 p-1 shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/90 dark:ring-stone-700">
        <button className="icon-btn h-9 w-9" onClick={() => setScale((s) => Math.min(1.6, s + 0.15))} aria-label="Zoom in"><Plus size={18} /></button>
        <button className="icon-btn h-9 w-9" onClick={() => setScale((s) => Math.max(0.4, s - 0.15))} aria-label="Zoom out"><Minus size={18} /></button>
        <button className="icon-btn h-9 w-9" onClick={() => centre(true)} aria-label="Centre"><Maximize2 size={16} /></button>
      </div>
    </div>
  );
}
