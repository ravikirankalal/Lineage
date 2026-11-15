import { Crosshair, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCanEdit } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import type { TreeNode } from '../lib/graph/contract';
import { displayName } from '../lib/person';
import { labelsFor, layoutFamily, pathEdgeKeys, relationPath } from '../lib/tree';
import type { Person } from '../lib/types';
import { AddRelationSheet, type RelChoice } from './AddRelationSheet';
import { FamilyTree, type FindCandidate } from './FamilyTree';
import { KinLabel, useRegionalTerm } from './KinLabel';
import { PersonSheet } from './tree/PersonSheet';
import type { CardInfo } from './tree/TreeCard';
import { useTreeParams } from './tree/useTreeParams';
import { markVisited, wasVisited } from './tree/viewMemory';

/** The family tree for any person. (Relatives and lines live on the People page.) */
/**
 * `map`: the Family Tree page — the tree fills the screen with only Find, levels, layout and zoom.
 * Relatives are added from a card (tap → Add relative) or the "Add father / Add mother" placeholders.
 */
export function LineageView({ ego, egoLabel = 'You', map = false }: { ego: Person; egoLabel?: string; map?: boolean }) {
  const { graph, byId, me } = useData();
  const nav = useNavigate();
  const canEdit = useCanEdit();
  const termFor = useRegionalTerm();
  const family = useMemo(() => graph.familyComponent(ego.id), [graph, ego.id]);
  const isValid = useCallback((id: string) => family.has(id), [family]);
  const viewScope = `${map ? 'map' : 'tree'}:${ego.id}`;
  const [params, update] = useTreeParams(ego.id, isValid, viewScope);
  const { focus: focusId, level, hl, expanded, orient } = params;
  const [adding, setAdding] = useState<{ person: Person; preset?: RelChoice } | null>(null);
  const [sheet, setSheet] = useState<TreeNode | null>(null);
  // A highlight in the link ("Show in tree") pans to that person, the first time only: coming back to
  // the same history entry (Back from a profile) keeps the view as it was left.
  const loc = useLocation();
  const [panTo, setPanTo] = useState<{ id: string; nonce: number } | undefined>(() =>
    (hl && new URLSearchParams(loc.search).has('hl') && !wasVisited(loc.key) ? { id: hl, nonce: 0 } : undefined));
  useEffect(() => { markVisited(loc.key); }, [loc.key]);
  const isMe = !!ego.isMe && egoLabel === 'You';
  const egoName = isMe ? 'you' : ego.firstName;

  // ONE batch label search per ego (never kinship() per card).
  const labels = useMemo(() => labelsFor(graph, ego.id), [graph, ego.id]);
  const aspect = useScreenAspect();
  const layout = useMemo(
    () => layoutFamily(graph, { focusId, level, expanded, ghosts: canEdit, orient, aspect }),
    [graph, focusId, level, expanded, canEdit, orient, aspect],
  );
  const pathIds = useMemo(() => (hl ? relationPath(graph, ego.id, hl) : undefined), [graph, ego.id, hl]);
  const path = useMemo(() => (pathIds ? new Set(pathIds) : undefined), [pathIds]);
  const pathEdges = useMemo(() => (pathIds ? pathEdgeKeys(layout.edges, pathIds) : undefined), [pathIds, layout]);

  // Card text for every node, computed once per layout/labels (cards are memoised on it).
  const infos = useMemo(() => {
    const m = new Map<string, CardInfo>();
    for (const n of layout.nodes) {
      const p = n.personId ? byId.get(n.personId) : undefined;
      if (!p) continue;
      const isEgo = p.id === ego.id;
      const label = isEgo ? egoLabel : labels.get(p.id)?.label;
      m.set(n.key, {
        person: p, label, term: isEgo ? undefined : termFor(ego.id, p.id, label),
        isFocus: n.role === 'focus' && !n.dupOf, isMe: !!me && p.id === me.id,
      });
    }
    return m;
  }, [layout, byId, labels, ego.id, egoLabel, termFor, me]);
  const cardInfo = useCallback((n: TreeNode) => infos.get(n.key), [infos]);

  const candidates = useMemo<FindCandidate[]>(() => {
    const out: FindCandidate[] = [];
    for (const id of family) {
      const p = byId.get(id);
      if (p) out.push({ person: p, label: id === ego.id ? egoLabel : labels.get(id)?.label });
    }
    return out.sort((a, b) => a.person.firstName.localeCompare(b.person.firstName));
  }, [family, byId, labels, ego.id, egoLabel]);

  const inLayout = (id: string, l = layout) => l.nodes.some((n) => n.personId === id && !n.dupOf);
  const nonce = () => Date.now();

  /** Find in tree: highlight the path and pan there; widen the view or re-focus if they aren't drawn. */
  const find = (id: string) => {
    setPanTo({ id, nonce: nonce() });
    if (inLayout(id)) return update({ hl: id === ego.id ? null : id }, { push: true });
    if (level !== 'everyone' && inLayout(id, layoutFamily(graph, { focusId, level: 'everyone', expanded, ghosts: canEdit }))) {
      return update({ hl: id === ego.id ? null : id, level: 'everyone' }, { push: true });
    }
    update({ hl: id === ego.id ? null : id, focus: id }, { push: true });
  };
  const toggle = (pid: string) => {
    const next = new Set(expanded);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    update({ expanded: next });
  };

  const sheetPerson = sheet?.personId ? byId.get(sheet.personId) : undefined;
  const hlPerson = hl ? byId.get(hl) : undefined;
  const focusPerson = byId.get(focusId);
  const pathHidden = !!path && [...path].some((id) => !inLayout(id));

  const banner = hlPerson ? (
    <div data-no-pan className="map-glass pointer-events-auto flex max-w-full items-center gap-2 self-start rounded-2xl bg-amber-50/95 py-1.5 pl-3 pr-1 text-sm shadow-card ring-1 ring-amber-200 backdrop-blur dark:bg-amber-950/80 dark:ring-amber-900">
      <span className="min-w-0 flex-1">
        <b>{hlPerson.firstName}</b> is {isMe ? 'your' : `${ego.firstName}’s`}{' '}
        <KinLabel label={labels.get(hlPerson.id)?.label ?? 'relative'} egoId={ego.id} targetId={hlPerson.id} className="font-semibold text-amber-800 dark:text-amber-200" termClassName="font-normal" />
        {labels.get(hlPerson.id)?.path && labels.get(hlPerson.id)!.path !== labels.get(hlPerson.id)!.label && (
          <span className="text-stone-500 dark:text-stone-400"> · {labels.get(hlPerson.id)!.path}</span>
        )}
        {pathHidden && level !== 'everyone' && (
          <button type="button" className="ml-1 font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200" onClick={() => update({ level: 'everyone' })}>Show the whole path</button>
        )}
      </span>
      <button type="button" className="icon-btn h-9 w-9 shrink-0" aria-label="Clear highlight" onClick={() => update({ hl: null })}><X size={17} /></button>
    </div>
  ) : focusId !== ego.id && focusPerson ? (
    <div data-no-pan className="map-glass pointer-events-auto flex max-w-full items-center gap-1 self-start rounded-2xl bg-white/95 py-1 pl-3 pr-1 text-sm shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700">
      <span className="min-w-0 truncate text-stone-500 dark:text-stone-400">Centred on <b className="text-stone-800 dark:text-stone-100">{displayName(focusPerson)}</b></span>
      <button type="button" className="btn-ghost shrink-0 px-2.5 py-1.5" onClick={() => update({ focus: ego.id }, { push: true })}>
        <Crosshair size={15} /> Back to {isMe ? 'me' : ego.firstName}
      </button>
    </div>
  ) : null;

  return (
    <div>

      <FamilyTree
        layout={layout}
        focusId={focusId}
        centreId={ego.id}
        centreLabel={isMe ? 'me' : ego.firstName}
        cardInfo={cardInfo}
        path={path}
        pathEdges={pathEdges}
        panTo={panTo}
        level={level}
        onLevel={(l) => update({ level: l })}
        orient={orient}
        onOrient={(o) => update({ orient: o })}
        candidates={candidates}
        onFind={find}
        onTap={setSheet}
        onToggle={toggle}
        onAddParent={canEdit && focusPerson ? (which) => setAdding({ person: focusPerson, preset: which }) : undefined}
        onRecentre={() => update({ focus: ego.id }, { push: true })}
        banner={banner}
        exportTitle={isMe ? 'My family tree' : `${displayName(ego)}’s family tree`}
        map={map}
        viewKey={viewScope}
      />

      {sheet && sheetPerson && (
        <PersonSheet
          person={sheetPerson}
          node={sheet}
          label={labels.get(sheetPerson.id)?.label}
          path={labels.get(sheetPerson.id)?.path}
          term={termFor(ego.id, sheetPerson.id, labels.get(sheetPerson.id)?.label)}
          isEgo={sheetPerson.id === ego.id}
          isFocus={sheetPerson.id === focusId}
          egoName={egoName}
          canEdit={canEdit}
          onClose={() => setSheet(null)}
          onCentre={() => { setSheet(null); update({ focus: sheetPerson.id }, { push: true }); }}
          onProfile={() => { setSheet(null); nav(`/people/${sheetPerson.id}`); }}
          onToggle={() => { setSheet(null); toggle(sheetPerson.id); }}
          onRelate={() => { setSheet(null); setPanTo({ id: sheetPerson.id, nonce: nonce() }); update({ hl: sheetPerson.id }, { push: true }); }}
          onAdd={() => { setSheet(null); setAdding({ person: sheetPerson }); }}
        />
      )}
      {canEdit && adding && (
        <AddRelationSheet person={adding.person} preset={adding.preset} open onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

/**
 * The screen's width ÷ height, in coarse steps (so the tree is only laid out again when the shape really
 * changes, e.g. on rotating a phone). The cross layout uses it to decide whether second cousins get their
 * own column.
 */
function useScreenAspect(): number {
  const read = () => (typeof window === 'undefined' || !window.innerHeight ? 1 : Math.round((window.innerWidth / window.innerHeight) * 4) / 4);
  const [aspect, setAspect] = useState(read);
  useEffect(() => {
    const on = () => setAspect(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return aspect;
}
