import { Activity, FlaskConical, Languages, RotateCw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AccountCard } from '../components/AccountCard';
import { useCloud, usePermissions } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import { loadDemo } from '../lib/demo';
import { reloadApp, runningBuild } from '../lib/appUpdate';
import { isNativeApp, nativeAppVersion } from '../lib/native';
import { KIN_LANGUAGES } from '../lib/kinshipTerms';
import { useKinLang } from '../lib/prefs';

export function SettingsPage() {
  // Android app: which APK is installed (apps before 1.0.11 can't tell, which says it's an old one).
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => { void nativeAppVersion().then(setAppVersion); }, []);
  const build = runningBuild();
  const versionText = [build && `build ${build.slice(6)}`, isNativeApp() && `app ${appVersion ?? 'before 1.0.11'}`].filter(Boolean).join(' · ');
  const { people, rels } = useData();
  const [msg, setMsg] = useState('');
  const [kinLang, setKinLang] = useKinLang();
  const { canEdit, isOwner } = usePermissions();
  const cloud = useCloud();
  const nav = useNavigate();

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

      {isOwner && (
        <section className="card mt-4">
          <Row icon={<Activity size={19} />} title="Admin" desc="How many people editors have added and how many edits they made" onClick={() => nav('/admin')} />
        </section>
      )}

      <section className="card mt-4">
        <Row icon={<RotateCw size={19} />} title="Reload Lineage" desc={`Gets the latest version${versionText ? ` · ${versionText}` : ''}`} onClick={reloadApp} />
      </section>
      {isOwner && canEdit && people.length === 0 && (
        <section className="card mt-4">
          <Row icon={<FlaskConical size={19} />} title="Try a sample family" desc="Loads a fictional family to explore the app" onClick={async () => { await loadDemo(); setMsg('Sample family loaded. Have a look at People and the Family Tree.'); }} />
        </section>
      )}
    </div>
  );
}

function Row({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/60">
      <span className="text-stone-500">{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-stone-500">{desc}</span>
      </span>
    </button>
  );
}
