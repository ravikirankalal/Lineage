import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { LineageView } from '../components/LineageView';
import { useData } from '../lib/data';
import { displayName } from '../lib/person';

/** Lineage for any person (same views as My Family, centred on them). */
export function TreePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { byId, loaded } = useData();
  const p = id ? byId.get(id) : undefined;
  if (!loaded) return null;
  if (!p) return <p className="p-6 text-stone-500">Person not found.</p>;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{displayName(p)}’s family</h1>
          <p className="text-sm text-stone-500">Labels show how each person is related to {p.isMe ? 'you' : p.firstName}.</p>
        </div>
      </div>
      <LineageView key={p.id} ego={p} egoLabel={p.isMe ? 'You' : p.firstName} />
    </div>
  );
}
