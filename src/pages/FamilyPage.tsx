import { GitBranch, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/Empty';
import { LineageView } from '../components/LineageView';
import { PersonRow } from '../components/PersonRow';
import { savePerson } from '../lib/db';
import { useData } from '../lib/data';
import { lineageStats, relativesOf } from '../lib/kinship';
import { displayName, lifespan, matchesQuery } from '../lib/person';

export function FamilyPage() {
  const { me, people, graph, loaded } = useData();
  const stats = useMemo(() => (me ? lineageStats(graph, me.id, relativesOf(graph, me.id)) : undefined), [graph, me]);
  if (!loaded) return null;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My Family</h1>
        <p className="text-sm text-stone-500">Your ancestors, descendants and every relative — family only, no friends.</p>
      </div>
      {!me ? <ChooseMe hasPeople={people.length > 0} /> : (
        <>
          {stats && (
            <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={stats.relatives} label="Relatives" />
              <Stat value={stats.generationsUp + stats.generationsDown + 1} label="Generations" />
              <Stat value={stats.ancestors} label="Direct ancestors" />
              {stats.earliest ? (
                <Link to={`/people/${stats.earliest.id}`} className="card p-3.5 hover:bg-stone-50 dark:hover:bg-stone-800">
                  <div className="truncate text-base font-semibold">{displayName(stats.earliest)}</div>
                  <div className="text-xs text-stone-500">Earliest ancestor{lifespan(stats.earliest) && ' · ' + lifespan(stats.earliest)}</div>
                </Link>
              ) : <Stat value={stats.descendants} label="Descendants" />}
            </div>
          )}
          <LineageView key={me.id} ego={me} />
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card p-3.5">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}

function ChooseMe({ hasPeople }: { hasPeople: boolean }) {
  const { people } = useData();
  const [q, setQ] = useState('');
  return (
    <div className="card">
      <Empty icon={<GitBranch size={26} />} title="Who are you?"
        action={<Link to="/people/new?me=1" className="btn-primary"><UserPlus size={18} /> Add myself</Link>}>
        Your family tree grows from you. Add yourself, then your parents, grandparents and beyond.
      </Empty>
      {hasPeople && (
        <div className="border-t border-stone-100 p-4 dark:border-stone-800">
          <p className="mb-2 text-sm text-stone-500">…or pick yourself from people you already added:</p>
          <input className="input mb-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-72 overflow-y-auto">
            {people.filter((p) => matchesQuery(p, q)).slice(0, 30).map((p) => (
              <PersonRow key={p.id} person={p} onClick={() => savePerson({ ...p, isMe: true })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
