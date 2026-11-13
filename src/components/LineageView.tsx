import { ArrowDown, Crosshair, GitBranch, List, Search, UserPlus, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { CATEGORY_LABELS, CATEGORY_ORDER, directLine, relativesOf, type KinCategory, type Relative } from '../lib/kinship';
import { displayName, formatPlace, lifespan, matchesQuery } from '../lib/person';
import type { Person } from '../lib/types';
import { AddRelationSheet, type RelChoice } from './AddRelationSheet';
import { Avatar } from './Avatar';
import { FamilyTree } from './FamilyTree';
import { PersonRow } from './PersonRow';

type Tab = 'tree' | 'relatives' | 'lines';

/** Tree + relatives list + direct lines for any person. Family only — friends never appear. */
export function LineageView({ ego, egoLabel = 'You' }: { ego: Person; egoLabel?: string }) {
  const { graph, byId } = useData();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('tree');
  const [focusId, setFocusId] = useState(ego.id);
  const [adding, setAdding] = useState<{ person: Person; preset?: RelChoice } | null>(null);
  const focus = byId.get(focusId) ?? ego;
  const relatives = useMemo(() => relativesOf(graph, ego.id), [graph, ego.id]);
  const focusKin = relatives.find((r) => r.person.id === focus.id)?.kin;

  const tabs: { key: Tab; label: string; icon: typeof GitBranch }[] = [
    { key: 'tree', label: 'Tree', icon: GitBranch },
    { key: 'relatives', label: `Relatives (${relatives.length})`, icon: List },
    { key: 'lines', label: 'Lines', icon: ArrowDown },
  ];

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === key ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'tree' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-0 text-sm text-stone-500">
              Showing <b className="text-stone-800 dark:text-stone-100">{displayName(focus)}</b>
              {focusKin && <> · {focusKin.label}</>}
              <span className="hidden sm:inline"> — tap a card to move around</span>
            </div>
            {focus.id !== ego.id && (
              <button className="btn-ghost px-3 py-2" onClick={() => setFocusId(ego.id)}><Crosshair size={16} /> Back to {ego.isMe ? 'me' : ego.firstName}</button>
            )}
            <Link to={`/people/${focus.id}`} className="btn-ghost px-3 py-2"><User size={16} /> Profile</Link>
            <button className="btn-primary px-3 py-2" onClick={() => setAdding({ person: focus })}><UserPlus size={16} /> Add relative</button>
          </div>
          <FamilyTree
            focusId={focus.id}
            egoId={ego.id}
            egoLabel={egoLabel}
            onSelect={setFocusId}
            onOpen={(id) => nav(`/people/${id}`)}
            onAddParent={(which) => setAdding({ person: focus, preset: which })}
            height="max(420px, calc(100dvh - 250px))"
          />
          <p className="mt-2 text-center text-xs text-stone-400">Tap a card to centre on them · tap the highlighted card to open their profile · dashed lines are marriages</p>
        </div>
      )}

      {tab === 'relatives' && <RelativesList relatives={relatives} egoName={ego.isMe ? 'you' : ego.firstName} />}
      {tab === 'lines' && <Lines ego={ego} />}

      {adding && (
        <AddRelationSheet person={adding.person} preset={adding.preset} familyOnly open onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

function RelativesList({ relatives, egoName }: { relatives: Relative[]; egoName: string }) {
  const [side, setSide] = useState<'all' | 'paternal' | 'maternal'>('all');
  const [q, setQ] = useState('');
  const filtered = relatives.filter((r) => (side === 'all' || r.kin.side === side || !r.kin.side) && matchesQuery(r.person, q));
  const groups = new Map<KinCategory, Relative[]>();
  for (const r of filtered) {
    if (!groups.has(r.kin.category)) groups.set(r.kin.category, []);
    groups.get(r.kin.category)!.push(r);
  }
  if (!relatives.length) {
    return <p className="card px-6 py-10 text-center text-sm text-stone-500">No relatives yet. Use the tree to add parents, siblings, spouse and children.</p>;
  }
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className="input bg-white pl-9 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" placeholder="Search relatives" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
          {(['all', 'paternal', 'maternal'] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${side === s ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}>
              {s === 'all' ? 'Both sides' : s === 'paternal' ? "Father's side" : "Mother's side"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => (
          <section key={c}>
            <div className="mb-1 flex items-baseline gap-2 px-1">
              <h3 className="section-title">{CATEGORY_LABELS[c]}</h3>
              <span className="text-xs text-stone-400">{groups.get(c)!.length}</span>
            </div>
            <div className="card p-1.5">
              {groups.get(c)!.map((r) => (
                <PersonRow key={r.person.id} person={r.person} to={`/people/${r.person.id}`}
                  subtitle={<>
                    <span className="font-medium text-brand-700 dark:text-brand-300">{r.kin.label}</span>
                    {r.kin.path !== r.kin.label && <span className="text-stone-400"> · {r.kin.path}</span>}
                    {formatPlace(r.person.address, true) && <span className="text-stone-400"> · {formatPlace(r.person.address, true)}</span>}
                  </>} />
              ))}
            </div>
          </section>
        ))}
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
