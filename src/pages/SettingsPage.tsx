import { Download, FlaskConical, Languages, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { AccountCard } from '../components/AccountCard';
import { Sheet } from '../components/Sheet';
import { useCloud, usePermissions } from '../lib/cloud/CloudProvider';
import { clearAll, exportBackup, importBackup } from '../lib/db';
import { useData } from '../lib/data';
import { loadDemo } from '../lib/demo';
import { KIN_LANGUAGES } from '../lib/kinshipTerms';
import { useKinLang } from '../lib/prefs';

export function SettingsPage() {
  const { people, rels } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<unknown>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [kinLang, setKinLang] = useKinLang();
  const { canEdit, isOwner } = usePermissions();
  const cloud = useCloud();
  const signedIn = cloud.configured && !!cloud.auth.user;

  async function download() {
    const data = await exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lineage-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    localStorage.setItem('lineage:lastBackup', new Date().toISOString());
    setMsg('Backup downloaded. Keep it somewhere safe (e.g. Google Drive).');
  }

  async function restore(mode: 'merge' | 'replace') {
    try {
      await importBackup(pending, mode);
      setMsg('Backup restored.');
    } catch (e) {
      setMsg((e as Error).message);
    }
    setPending(null);
  }

  let lastBackup = '';
  try {
    lastBackup = localStorage.getItem('lineage:lastBackup') ?? '';
  } catch { /* ignore */ }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
      {msg && <div className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">{msg}</div>}

      <AccountCard />

      <section className={`card p-5 ${cloud.configured ? 'mt-4' : ''}`}>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-brand-600" />
          <div>
            <h2 className="font-semibold">Private by design</h2>
            <p className="mt-1 text-sm text-stone-500">
              {cloud.isShared && cloud.activeSpace
                ? `You’re viewing ${cloud.activeSpace.name}: ${people.length} people and ${rels.length} relationships. Only family is shared — never friends or private notes.`
                : signedIn
                  ? `Saved on this device and backed up to your Google account. ${people.length} people and ${rels.length} relationships. Only you can see them unless you share your family tree.`
                  : `Everything is stored only in this browser on this device. ${people.length} people and ${rels.length} relationships saved. Sign in above to back it up to your Google account, or download a backup file regularly.`}
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
        <Row icon={<Download size={19} />} title="Download backup" desc={lastBackup ? `Last backup ${new Date(lastBackup).toLocaleDateString()}` : 'Save everything as a file'} onClick={download} />
        {isOwner && <Row icon={<Upload size={19} />} title="Restore from backup" desc="Load a Lineage backup file" onClick={() => fileRef.current?.click()} />}
        {isOwner && people.length === 0 && <Row icon={<FlaskConical size={19} />} title="Try a sample family" desc="Loads a fictional family to explore the app" onClick={async () => { await loadDemo(); setMsg('Sample family loaded. Have a look at People and My Family.'); }} />}
        {isOwner && canEdit && <Row icon={<Trash2 size={19} />} title="Delete all data" desc={signedIn ? 'Remove every person and relationship, here and in your Google account' : 'Remove every person and relationship'} danger onClick={() => setConfirmClear(true)} />}
      </section>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          setPending(JSON.parse(await f.text()));
        } catch {
          setMsg('That file could not be read.');
        }
      }} />

      <p className="mt-6 text-center text-xs text-stone-400">Lineage · install it from your browser menu (“Add to Home screen”) to use it like an app, even offline.</p>

      <Sheet open={!!pending} onClose={() => setPending(null)} title="Restore backup"
        footer={<div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          <button className="btn-secondary" onClick={() => restore('merge')}>Merge with current</button>
          <button className="btn-primary" onClick={() => restore('replace')}>Replace everything</button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">“Merge” keeps your current data and adds or updates from the backup. “Replace” makes this device exactly match the backup.</p>
      </Sheet>
      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title="Delete all data?"
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
          <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={async () => { await clearAll(); setConfirmClear(false); setMsg(signedIn ? 'All data deleted here and in your Google account.' : 'All data deleted.'); }}>{signedIn ? 'Delete everywhere' : 'Delete everything'}</button>
        </div>}>
        {signedIn ? (
          <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
            <p className="font-medium text-red-700 dark:text-red-400">This deletes everything on this device AND in your Google account backup.</p>
            <p>All {people.length} people and their relationships will be gone from every device where you’re signed in{cloud.spaces.length > 1 ? ', and relatives you shared with will no longer see them' : ''}. Download a backup first if you might want them back.</p>
            <p>Only want this device cleared? Use <b>Sign out</b> and choose <b>Remove from this device</b> instead; your account keeps everything.</p>
          </div>
        ) : (
          <p className="text-sm text-stone-600 dark:text-stone-300">This permanently removes all {people.length} people and their relationships from this device. Download a backup first if you might want them back.</p>
        )}
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
