import { Minus, Plus, UserPlus, CornerUpRight } from 'lucide-react';
import { memo } from 'react';
import { CARD, type TreeNode } from '../../lib/graph/contract';
import { age, formatPlace, fullName, initials, lifespan } from '../../lib/person';
import type { Person } from '../../lib/types';
import { Avatar } from '../Avatar';
import type { Detail } from './detail';

/** Short name for a card: nickname (if short) or first name, plus last initial. "Ravi R." */
export function cardName(p: Person): string {
  const first = p.nickname && p.nickname.length < 12 ? p.nickname : p.firstName;
  return `${first || 'Unnamed'}${p.lastName ? ' ' + p.lastName[0] + '.' : ''}`;
}

export interface CardInfo {
  person: Person;
  label?: string; // English label from ego, or the ego label ("You")
  term?: string; // regional term
  isFocus: boolean;
  isMe: boolean;
  /** Highlight state: in the "how are we related" path, dimmed (not in it), or neutral. */
  mark?: 'path' | 'dim';
}

/** One person card at CARD size, positioned in layout units. Keyed by node.key for FLIP. */
export const TreeCard = memo(function TreeCard({ node, info, onTap, onToggle, detail = 4 }: {
  node: TreeNode;
  info: CardInfo;
  onTap: (node: TreeNode) => void;
  onToggle: (personId: string) => void;
  /** How much the card shows, from the zoom (see detail.ts): 1 tile … 5 detailed. */
  detail?: Detail;
}) {
  const p = info.person;
  const style = { left: node.x - CARD.w / 2, top: node.y, width: CARD.w, height: CARD.h };
  const dim = info.mark === 'dim' ? 'opacity-40' : '';

  if (node.dupOf) {
    // A secondary card (pedigree collapse, or beside a spouse when the main card is in the birth family):
    // a light stub that jumps to the main card.
    return (
      <div data-key={node.key} className={`tree-node absolute ${dim}`} style={style}>
        <button type="button" onClick={() => onTap(node)}
          title={`${cardName(p)} is shown elsewhere in the tree. Tap to go there.`}
          className="tree-card flex h-full w-full items-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/80 px-2.5 text-left dark:border-stone-600 dark:bg-stone-900/80">
          {detail === 1 ? (
            <span className="w-full text-center text-[30px] font-bold text-stone-500 dark:text-stone-400">{initials(p)}</span>
          ) : detail === 2 ? (
            <span className="w-full truncate text-center text-[22px] font-semibold text-stone-600 dark:text-stone-300">{firstName(p)}</span>
          ) : (
            <>
              <Avatar person={p} size={30} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-semibold text-stone-700 dark:text-stone-200">{cardName(p)}</div>
                <div className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400"><CornerUpRight size={12} /> Also shown elsewhere</div>
              </div>
            </>
          )}
        </button>
      </div>
    );
  }

  const span = lifespan(p);
  const focus = info.isFocus;
  const relCls = focus ? 'text-white/90' : 'text-brand-700 dark:text-brand-300';
  const mutedCls = focus ? 'text-white/75' : 'text-stone-500 dark:text-stone-400';
  const spanCls = focus ? 'text-white/75' : 'text-stone-400';
  const { label, term } = info;
  const badge = node.step ? 'Step' : node.half ? 'Half' : undefined;
  const canExpand = !!node.expandable && (node.expandable.up || node.expandable.down || node.expandable.side);
  // A couple's children (cross layout: an ancestor's brother or sister): the button only opens those.
  const kidsOnly = !!node.expandable?.down && !node.expandable.up && !node.expandable.side && node.generation > 0;
  const ring = focus
    ? 'bg-brand-600 text-white ring-2 ring-brand-600 ring-offset-2 ring-offset-stone-100 dark:ring-offset-stone-900'
    : info.isMe
      ? 'bg-white ring-[3px] ring-brand-500 dark:bg-stone-800'
      : 'bg-white ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700';
  const pathRing = info.mark === 'path' ? 'outline outline-[3px] outline-offset-2 outline-amber-400' : '';

  return (
    <div data-key={node.key} className={`tree-node absolute ${dim}`} style={style}>
      <button
        type="button"
        onClick={() => onTap(node)}
        title={`${cardName(p)}${label ? ' — ' + (term ? term + ' · ' : '') + label : ''}`}
        className={`tree-card ${focus ? 'tree-card-focus' : ''} flex h-full w-full items-center gap-2.5 rounded-2xl px-2.5 text-left shadow-card transition-shadow hover:shadow-md ${ring} ${pathRing} ${p.deceased ? 'opacity-85' : ''}`}
      >
        <CardBody p={p} detail={detail} label={label} term={term} span={span} relCls={relCls} mutedCls={mutedCls} spanCls={spanCls} focus={focus} />
      </button>
      {info.isMe && (
        <span aria-hidden className="pointer-events-none absolute -left-2 -top-2.5 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow ring-2 ring-white dark:ring-stone-900">
          Me
        </span>
      )}
      {badge && (
        <span className={`pointer-events-none absolute -bottom-2 right-3 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ring-2 ring-stone-100 dark:ring-stone-900 ${focus ? 'bg-brand-800 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'}`}>
          {badge}
        </span>
      )}
      {canExpand && (
        <button
          type="button"
          onClick={() => onToggle(p.id)}
          aria-label={`${node.expanded ? 'Hide' : 'Show'} ${cardName(p)}'s ${kidsOnly ? 'children' : 'relatives'}`}
          title={kidsOnly ? (node.expanded ? 'Hide children' : 'Show children') : node.expanded ? 'Hide relatives' : 'Show more relatives'}
          className="absolute -right-4 -top-4 flex h-10 w-10 print:hidden items-center justify-center"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-700 shadow ring-1 ring-stone-300 dark:bg-stone-700 dark:text-brand-200 dark:ring-stone-600">
            {node.expanded ? <Minus size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
          </span>
        </button>
      )}
    </div>
  );
});

/** First name for the big-name design: nickname if short, else first name. */
function firstName(p: Person): string {
  return (p.nickname && p.nickname.length < 12 ? p.nickname : p.firstName) || 'Unnamed';
}

/** "b. 1988 · 37" / "1930–2008 · 78": years with age (at death for the deceased). */
function yearsWithAge(p: Person, span: string): string {
  const a = age(p);
  return a !== undefined && span ? `${span} · ${a}` : span;
}

/** The inside of a card, one of five designs by zoom (detail.ts). The card's size never changes. */
function CardBody({ p, detail, label, term, span, relCls, mutedCls, spanCls, focus }: {
  p: Person; detail: Detail; label?: string; term?: string; span: string; relCls: string; mutedCls: string; spanCls: string; focus: boolean;
}) {
  const nameCls = focus ? '' : 'text-stone-800 dark:text-stone-100';
  if (detail === 1) {
    // Tile: big initials, readable from far away.
    return <span className={`tree-text w-full text-center text-[32px] font-bold tracking-wide ${nameCls}`}>{initials(p)}</span>;
  }
  if (detail === 2) {
    // Name: the first name, large.
    return <span className={`tree-text w-full truncate text-center text-[24px] font-semibold ${nameCls}`}>{firstName(p)}</span>;
  }
  const rel = term ?? label ?? '';
  if (detail === 3) {
    // Compact: small photo, short name and how they're related, a bit larger than standard.
    return (
      <>
        <Avatar person={p} size={34} />
        <div className="tree-text min-w-0 flex-1 leading-tight">
          <div className="truncate text-[16px] font-semibold">{cardName(p)}</div>
          <div className={`truncate text-[13px] font-medium ${relCls}`}>{rel}</div>
        </div>
      </>
    );
  }
  if (detail === 5) {
    // Detailed: full name, relation and family term, years with age, then place or occupation.
    const place = formatPlace(p.address, true) || formatPlace(p.origin, true);
    const extra = [p.occupation, place].filter(Boolean).join(' · ');
    return (
      <>
        <Avatar person={p} size={44} />
        <div className="tree-text min-w-0 flex-1 text-[10.5px] leading-[1.3]">
          <div className="truncate text-[12.5px] font-semibold">{fullName(p) || cardName(p)}</div>
          <div className={`truncate ${relCls}`}>
            {term ? <><span className="font-semibold">{term}</span>{label ? <span className={mutedCls}> · {label}</span> : null}</> : label}
          </div>
          {span && <div className={`truncate ${spanCls}`}>{yearsWithAge(p, span)}</div>}
          {extra && <div className={`truncate ${mutedCls}`}>{extra}</div>}
        </div>
      </>
    );
  }
  // Standard (today's card).
  return (
    <>
      <Avatar person={p} size={40} />
      <div className="tree-text min-w-0 flex-1 leading-tight">
        <div className="truncate text-[14px] font-semibold">{cardName(p)}</div>
        {term ? (
          // Regional term first: it is the word the family uses and survives truncation.
          span ? (
            <>
              <div className={`truncate text-[12px] ${relCls}`}>
                <span className="font-semibold">{term}</span>
                <span className={mutedCls}> · {label}</span>
              </div>
              <div className={`truncate text-[12px] ${spanCls}`}>{span}</div>
            </>
          ) : (
            <>
              <div className={`truncate text-[12px] font-semibold ${relCls}`}>{term}</div>
              <div className={`truncate text-[12px] ${mutedCls}`}>{label}</div>
            </>
          )
        ) : (
          <>
            <div className={`truncate text-[12px] ${relCls}`}>{label ?? ''}</div>
            <div className={`truncate text-[12px] ${spanCls}`}>{span}</div>
          </>
        )}
      </div>
    </>
  );
}

/** "Add father" / "Add mother" placeholder above the focus. */
export function GhostCard({ node, onAdd }: { node: TreeNode; onAdd: (which: 'father' | 'mother') => void }) {
  return (
    <div data-key={node.key} className="tree-node absolute" style={{ left: node.x - CARD.w / 2, top: node.y, width: CARD.w, height: CARD.h }}>
      <button type="button" onClick={() => onAdd(node.ghost!)}
        className="flex h-full w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 text-sm font-medium text-stone-500 transition hover:border-brand-400 hover:text-brand-600 dark:border-stone-700 dark:text-stone-400">
        <UserPlus size={16} /> Add {node.ghost}
      </button>
    </div>
  );
}
