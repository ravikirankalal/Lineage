import { GitBranch, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShareLink, SpaceSwitcher } from '../components/Cloud';
import { Empty } from '../components/Empty';
import { LineageView } from '../components/LineageView';
import { PersonRow } from '../components/PersonRow';
import { useIsPhone } from '../components/tree/useTreeParams';
import { savePerson } from '../lib/db';
import { useCloud, usePermissions } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import { lineageStats, relativesOf } from '../lib/kinship';
import { displayName, lifespan, matchesQuery } from '../lib/person';

export function FamilyPage() {
  const { me, people, graph, loaded } = useData();
  const { isShared, canEdit } = usePermissions();
  const { activeSpace } = useCloud();
  const stats = useMemo(() => (me ? lineageStats(graph, me.id, relativesOf(graph, me.id)) : undefined), [graph, me]);
  const phone = useIsPhone();
  if (!loaded) return null;

  return (
    <div>
      <div className="mb-3 flex items-start gap-3 sm:mb-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{isShared && activeSpace ? activeSpace.name : 'My Family'}</h1>
          {phone && me && stats ? (
            // Phones: one short summary so the tree gets the screen.
            <p className="text-sm text-stone-500 dark:text-stone-400">
              <b className="text-stone-700 dark:text-stone-200">{stats.relatives}</b> relatives · <b className="text-stone-700 dark:text-stone-200">{stats.generationsUp + stats.generationsDown + 1}</b> generations
              {stats.earliest && (
                <> · <Link to={`/people/${stats.earliest.id}`} className="underline decoration-stone-300 underline-offset-2">Earliest ancestor: {stats.earliest.firstName}</Link></>
              )}
            </p>
          ) : (
          <p className="text-sm text-stone-500">
            {isShared && me
              ? `Labels show how each person is related to ${me.firstName}.`
              : 'Your ancestors, descendants and every relative — family only, no friends.'}
          </p>
          )}
        </div>
        <ShareLink className="shrink-0 print:hidden" />
      </div>
      <SpaceSwitcher className="mb-4 md:hidden" />
      {!me ? (isShared ? (
        <div className="card">
          <Empty icon={<GitBranch size={26} />} title="This tree isn’t ready yet">
            {canEdit ? 'The owner hasn’t added themselves yet. Once they do, the whole family tree appears here.' : 'The owner hasn’t added their family yet. It appears here as soon as they do.'}
          </Empty>
        </div>
      ) : <ChooseMe hasPeople={people.length > 0} />) : (
        <>
          {stats && !phone && (
            <div className="mb-5 grid print:hidden grid-cols-2 gap-2 sm:grid-cols-4">
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
          <LineageView key={me.id} ego={me} egoLabel={isShared ? me.firstName : 'You'} />
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
