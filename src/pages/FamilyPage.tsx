import { GitBranch, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Empty } from '../components/Empty';
import { LineageView } from '../components/LineageView';
import { PersonRow } from '../components/PersonRow';
import { savePerson } from '../lib/db';
import { usePermissions } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import { matchesQuery } from '../lib/person';

/**
 * My Family: the family tree and nothing else, filling the screen like a map. (Relatives, lines and
 * stats are on the People page; sharing is in Settings.)
 */
export function FamilyPage() {
  const { me, people, loaded } = useData();
  const { isShared, canEdit } = usePermissions();
  // Relatives and Lines moved to the People page: send old links there.
  const [sp] = useSearchParams();
  const oldTab = sp.get('tab');
  if (oldTab === 'relatives' || oldTab === 'lines') return <Navigate to={`/?view=${oldTab}`} replace />;
  if (!loaded) return null;
  if (me) return <LineageView key={me.id} ego={me} egoLabel={isShared ? me.firstName : 'You'} map />;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 md:pt-8">
      <h1 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">My Family</h1>
      {isShared ? (
        <div className="card">
          <Empty icon={<GitBranch size={26} />} title="This tree isn’t ready yet">
            {canEdit ? 'The owner hasn’t added themselves yet. Once they do, the whole family tree appears here.' : 'The owner hasn’t added their family yet. It appears here as soon as they do.'}
          </Empty>
        </div>
      ) : <ChooseMe hasPeople={people.length > 0} />}
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
