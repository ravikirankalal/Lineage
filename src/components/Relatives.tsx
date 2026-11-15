import { GitBranch, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCanEdit } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import { CATEGORY_LABELS, CATEGORY_ORDER, directLine, lineageStats, type KinCategory, type Relative } from '../lib/kinship';
import { displayName, formatPlace, lifespan, matchesQuery } from '../lib/person';
import { subgroupRelatives } from '../lib/relativeGroups';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';
import { KinLabel } from './KinLabel';
import { PersonRow } from './PersonRow';

/** Every relative of one person, grouped by kind, with a search box and a side filter. */
export function RelativesList({ relatives, egoId, egoName, onShowInTree, query }: {
  relatives: Relative[];
  egoId: string;
  egoName: string;
  onShowInTree: (id: string) => void;
  /** Search text from the page's own search box (then this list shows no search box of its own). */
  query?: string;
}) {
  const [side, setSide] = useState<'all' | 'paternal' | 'maternal'>('all');
  const [ownQ, setQ] = useState('');
  const q = query ?? ownQ;
  const canEdit = useCanEdit();
  const filtered = relatives.filter((r) => (side === 'all' || r.kin.side === side || !r.kin.side) && matchesQuery(r.person, q));
  const groups = new Map<KinCategory, Relative[]>();
  for (const r of filtered) {
    if (!groups.has(r.kin.category)) groups.set(r.kin.category, []);
    groups.get(r.kin.category)!.push(r);
  }
  if (!relatives.length) {
    return <p className="card px-6 py-10 text-center text-sm text-stone-500">No relatives yet.{canEdit && ' Use the family tree to add parents, spouse and children.'}</p>;
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
        {query === undefined && <div className="relative flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className="input bg-white pl-9 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" placeholder="Search relatives" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>}
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

/** Father's line and mother's line, generation by generation. */
export function Lines({ ego }: { ego: Person }) {
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

/** Relatives, generations, direct ancestors and the earliest ancestor of one person. */
export function FamilyStats({ ego, relatives }: { ego: Person; relatives: Relative[] }) {
  const { graph } = useData();
  const stats = useMemo(() => lineageStats(graph, ego.id, relatives), [graph, ego.id, relatives]);
  const stat = (value: number, label: string) => (
    <div className="card p-3.5">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stat(stats.relatives, 'Relatives')}
      {stat(stats.generationsUp + stats.generationsDown + 1, 'Generations')}
      {stat(stats.ancestors, 'Direct ancestors')}
      {stats.earliest ? (
        <Link to={`/people/${stats.earliest.id}`} className="card p-3.5 hover:bg-stone-50 dark:hover:bg-stone-800">
          <div className="truncate text-base font-semibold">{displayName(stats.earliest)}</div>
          <div className="text-xs text-stone-500">Earliest ancestor{lifespan(stats.earliest) && ' · ' + lifespan(stats.earliest)}</div>
        </Link>
      ) : stat(stats.descendants, 'Descendants')}
    </div>
  );
}
