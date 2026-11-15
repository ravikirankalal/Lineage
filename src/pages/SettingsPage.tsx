import { FlaskConical, Languages, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AccountCard } from '../components/AccountCard';
import { Sheet } from '../components/Sheet';
import { useCloud, usePermissions } from '../lib/cloud/CloudProvider';
import { clearAll } from '../lib/db';
import { useData } from '../lib/data';
import { loadDemo } from '../lib/demo';
import { KIN_LANGUAGES } from '../lib/kinshipTerms';
import { useKinLang } from '../lib/prefs';

export function SettingsPage() {
  const { people, rels } = useData();
  const [msg, setMsg] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [kinLang, setKinLang] = useKinLang();
  const { canEdit, isOwner } = usePermissions();
  const cloud = useCloud();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
      {msg && <div className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">{msg}</div>}

      <AccountCard />

      <section className="card mt-4 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <h2 className="font-semibold">Private by design</h2>
            <p className="mt-1 text-sm text-stone-500">
              {cloud.isShared && cloud.activeSpace
                ? `You’re viewing ${cloud.activeSpace.name}: ${people.length} people and ${rels.length} relationships. Only the family tree is shared — never private notes.`
                : `Kept in your Google account, not on this device. ${people.length} people and ${rels.length} relationships. Only you can see them unless you share your family tree.`}
            </p>
          </div>
        </div>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-start gap-3">
          <Languages className="mt-0.5 shrink-0 text-stone-500" />
          <div className="min-w-0 flex-1">
            <h2 id="kin-terms-title" className="font-semibold">Family terms</h2>
            <p className="mt-1 text-sm text-stone-500">Show terms like Chacha, Mama, Bua alongside English labels.</p>
            <div role="radiogroup" aria-labelledby="kin-terms-title" className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
              {KIN_LANGUAGES.map((l) => (
                <button key={l.id} role="radio" aria-checked={kinLang === l.id} onClick={() => setKinLang(l.id)}
                  className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition ${kinLang === l.id ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-50' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'}`}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card mt-4 divide-y divide-stone-100 dark:divide-stone-800">
        {isOwner && people.length === 0 && <Row icon={<FlaskConical size={19} />} title="Try a sample family" desc="Loads a fictional family to explore the app" onClick={async () => { await loadDemo(); setMsg('Sample family loaded. Have a look at People and the Family Tree.'); }} />}
        {isOwner && canEdit && <Row icon={<Trash2 size={19} />} title="Delete all data" desc="Remove every person and relationship from your family tree" danger onClick={() => setConfirmClear(true)} />}
      </section>
      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Delete all data?"
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
          <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={async () => { setConfirmClear(false); try { await clearAll(); setMsg('All data deleted.'); } catch (e) { setMsg((e as Error).message); } }}>Delete everything</button>
        </div>}>
        <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
          <p className="font-medium text-red-700 dark:text-red-400">This permanently deletes your whole family tree from your Google account.</p>
          <p>All {people.length} people and their relationships will be gone{cloud.spaces.length > 1 ? ', and relatives you shared with will no longer see them' : ''}. This can’t be undone.</p>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ icon, title, desc, onClick, danger }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/60">
      <span className={danger ? 'text-red-600' : 'text-stone-500'}>{icon}</span>
      <span className="flex-1">
        <span className={`block font-medium ${danger ? 'text-red-600' : ''}`}>{title}</span>
        <span className="block text-sm text-stone-500">{desc}</span>
      </span>
    </button>
  );
}
