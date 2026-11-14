import { ArrowDown, Crosshair, GitBranch, List, Search, UserPlus, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCanEdit } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import type { TreeNode } from '../lib/graph/contract';
import { CATEGORY_LABELS, CATEGORY_ORDER, directLine, relativesOf, type KinCategory, type Relative } from '../lib/kinship';
import { displayName, formatPlace, lifespan, matchesQuery } from '../lib/person';
import { subgroupRelatives } from '../lib/relativeGroups';
import { labelsFor, layoutFamily, relationPath } from '../lib/tree';
import type { Person } from '../lib/types';
import { AddRelationSheet, type RelChoice } from './AddRelationSheet';
import { Avatar } from './Avatar';
import { FamilyTree, type FindCandidate } from './FamilyTree';
import { KinLabel, useRegionalTerm } from './KinLabel';
import { PersonRow } from './PersonRow';
import { PersonSheet } from './tree/PersonSheet';
import type { CardInfo } from './tree/TreeCard';
import { useTreeParams, type LineageTab } from './tree/useTreeParams';

/** Tree + relatives list + direct lines for any person. Family only — friends never appear. */
export function LineageView({ ego, egoLabel = 'You' }: { ego: Person; egoLabel?: string }) {
  const { graph, byId, me } = useData();
  const nav = useNavigate();
  const canEdit = useCanEdit();
  const termFor = useRegionalTerm();
  const family = useMemo(() => graph.familyComponent(ego.id), [graph, ego.id]);
  const isValid = useCallback((id: string) => family.has(id), [family]);
  const [params, update] = useTreeParams(ego.id, isValid);
  const { tab, focus: focusId, level, hl, expanded, orient } = params;
  const [adding, setAdding] = useState<{ person: Person; preset?: RelChoice } | null>(null);
  const [sheet, setSheet] = useState<TreeNode | null>(null);
  const [panTo, setPanTo] = useState<{ id: string; nonce: number } | undefined>(() => (hl ? { id: hl, nonce: 0 } : undefined));
  const isMe = !!ego.isMe && egoLabel === 'You';
  const egoName = isMe ? 'you' : ego.firstName;

  // ONE batch label search per ego (never kinship() per card).
  const labels = useMemo(() => labelsFor(graph, ego.id), [graph, ego.id]);
  const layout = useMemo(
    () => layoutFamily(graph, { focusId, level, expanded, ghosts: canEdit, orient }),
    [graph, focusId, level, expanded, canEdit, orient],
  );
  const path = useMemo(() => (hl ? new Set(relationPath(graph, ego.id, hl)) : undefined), [graph, ego.id, hl]);
  const relatives = useMemo(() => (tab === 'relatives' ? relativesOf(graph, ego.id) : undefined), [graph, ego.id, tab]);
  const relativeCount = Math.max(0, family.size - 1);

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
  const showInTree = (id: string) => {
    setPanTo({ id, nonce: nonce() });
    update({ tab: 'tree', focus: id, hl: id }, { push: true });
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
    <div data-no-pan className="pointer-events-auto flex max-w-full items-center gap-2 self-start rounded-2xl bg-amber-50/95 py-1.5 pl-3 pr-1 text-sm shadow-card ring-1 ring-amber-200 backdrop-blur dark:bg-amber-950/80 dark:ring-amber-900">
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
    <div data-no-pan className="pointer-events-auto flex max-w-full items-center gap-1 self-start rounded-2xl bg-white/95 py-1 pl-3 pr-1 text-sm shadow-card ring-1 ring-stone-200 backdrop-blur dark:bg-stone-800/95 dark:ring-stone-700">
      <span className="min-w-0 truncate text-stone-500 dark:text-stone-400">Centred on <b className="text-stone-800 dark:text-stone-100">{displayName(focusPerson)}</b></span>
      <button type="button" className="btn-ghost shrink-0 px-2.5 py-1.5" onClick={() => update({ focus: ego.id }, { push: true })}>
        <Crosshair size={15} /> Back to {isMe ? 'me' : ego.firstName}
      </button>
    </div>
  ) : null;

  const tabs: { key: LineageTab; label: string; icon: typeof GitBranch }[] = [
    { key: 'tree', label: 'Tree', icon: GitBranch },
    { key: 'relatives', label: `Relatives (${relativeCount})`, icon: List },
    { key: 'lines', label: 'Lines', icon: ArrowDown },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 print:hidden">
        <div className="inline-flex min-w-0 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => update({ tab: key })}
              className={`flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition sm:px-3 ${tab === key ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500 dark:text-stone-400'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === 'tree' && canEdit && focusPerson && (
          <button type="button" className="btn-primary ml-auto shrink-0 px-3 py-2" onClick={() => setAdding({ person: focusPerson })}
            aria-label={`Add a relative of ${focusPerson.firstName}`}>
            <UserPlus size={17} /> <span className="hidden sm:inline">Add relative</span>
          </button>
        )}
      </div>

      {tab === 'tree' && (
        <FamilyTree
          layout={layout}
          focusId={focusId}
          centreId={ego.id}
          centreLabel={isMe ? 'me' : ego.firstName}
          cardInfo={cardInfo}
          path={path}
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
        />
      )}

      {tab === 'relatives' && relatives && <RelativesList relatives={relatives} egoId={ego.id} egoName={egoName} onShowInTree={showInTree} />}
      {tab === 'lines' && <Lines ego={ego} />}

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
        <AddRelationSheet person={adding.person} preset={adding.preset} familyOnly open onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

function RelativesList({ relatives, egoId, egoName, onShowInTree }: {
  relatives: Relative[];
  egoId: string;
  egoName: string;
  onShowInTree: (id: string) => void;
}) {
  const [side, setSide] = useState<'all' | 'paternal' | 'maternal'>('all');
  const [q, setQ] = useState('');
  const canEdit = useCanEdit();
  const filtered = relatives.filter((r) => (side === 'all' || r.kin.side === side || !r.kin.side) && matchesQuery(r.person, q));
  const groups = new Map<KinCategory, Relative[]>();
  for (const r of filtered) {
    if (!groups.has(r.kin.category)) groups.set(r.kin.category, []);
    groups.get(r.kin.category)!.push(r);
  }
  if (!relatives.length) {
    return <p className="card px-6 py-10 text-center text-sm text-stone-500">No relatives yet.{canEdit && ' Use the tree to add parents, spouse and children.'}</p>;
  }
  const row = (r: Relative) => (
    <div key={r.person.id} className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <PersonRow person={r.person} to={`/people/${r.person.id}`}
          subtitle={<>
            <KinLabel label={r.kin.label} egoId={egoId} targetId={r.person.id} className="font-medium text-brand-700 dark:text-brand-300" />
            {r.kin.path !== r.kin.label && <span className="text-stone-400"> · {r.kin.path}</span>}
            {formatPlace(r.person.address, true) && <span className="text-stone-400"> · {formatPlace(r.person.address, true)}</span>}
          </>} />
      </div>
      <button type="button" className="icon-btn shrink-0 text-stone-500" onClick={() => onShowInTree(r.person.id)}
        aria-label={`Show ${r.person.firstName} in the tree`} title="Show in tree">
        <GitBranch size={18} />
      </button>
    </div>
  );
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className="input bg-white pl-9 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" placeholder="Search relatives" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
          {(['all', 'paternal', 'maternal'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${side === s ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}>
              {s === 'all' ? 'Both sides' : s === 'paternal' ? "Father's side" : "Mother's side"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => {
          const subs = subgroupRelatives(c, groups.get(c)!);
          return (
            <section key={c}>
              <div className="mb-1 flex items-baseline gap-2 px-1">
                <h3 className="section-title">{CATEGORY_LABELS[c]}</h3>
                <span className="text-xs text-stone-400">{groups.get(c)!.length}</span>
              </div>
              <div className="card p-1.5">
                {subs.map((s, i) => (
                  <div key={s.key}>
                    {s.title && (
                      <div className={`flex items-baseline gap-2 px-2 pb-1 text-[13px] font-semibold text-stone-600 dark:text-stone-300 ${i ? 'mt-2 border-t border-stone-100 pt-3 dark:border-stone-800' : 'pt-1.5'}`}>
                        {s.title} <span className="text-xs font-normal text-stone-400">{s.items.length}</span>
                      </div>
                    )}
                    {s.items.map(row)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {!filtered.length && <p className="py-8 text-center text-sm text-stone-500">No relatives match for {egoName}.</p>}
      </div>
    </div>
  );
}

function Lines({ ego }: { ego: Person }) {
  const { graph } = useData();
  const pat = directLine(graph, ego.id, 'paternal');
  const mat = directLine(graph, ego.id, 'maternal');
  const col = (title: string, hint: string, line: Person[]) => (
    <div className="card p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-4 text-sm text-stone-500">{hint}</p>
      {line.length === 0 ? <p className="text-sm text-stone-400">Not recorded yet.</p> : (
        <ol className="relative ml-5 border-l-2 border-dashed border-stone-200 dark:border-stone-700">
          {[ego, ...line].map((p, i) => (
            <li key={p.id} className="relative -ml-5 mb-3 flex items-center gap-3 last:mb-0">
              <Link to={`/people/${p.id}`} className="flex flex-1 items-center gap-3 rounded-xl p-1.5 hover:bg-stone-50 dark:hover:bg-stone-800">
                <Avatar person={p} size={38} className="ring-4 ring-white dark:ring-stone-900" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{displayName(p)}</div>
                  <div className="text-xs text-stone-500">
                    {i === 0 ? (ego.isMe ? 'You' : 'Start') : i === 1 ? 'Generation 1' : `Generation ${i}`}
                    {lifespan(p) && ' · ' + lifespan(p)}
                    {formatPlace(p.origin, true) && ' · ' + formatPlace(p.origin, true)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {col("Father's line", 'Father → his father → … (surname / gotra line)', pat)}
      {col("Mother's line", 'Mother → her mother → …', mat)}
    </div>
  );
}
