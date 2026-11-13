import { AlertCircle, ChevronRight, Cloud, CloudOff, LogOut, RefreshCw, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { syncStatusText, useCloud } from '../lib/cloud/CloudProvider';
import { GoogleButton, RoleBadge, SpaceList, UserAvatar } from './Cloud';
import { Sheet } from './Sheet';

/** Re-render every 30 s so "Synced 2 min ago" stays true. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Settings: sign in with Google, sync status, sharing and sign out. Hidden when not configured. */
export function AccountCard() {
  const cloud = useCloud();
  const { auth, status, backup, spaces } = cloud;
  const now = useNow();
  const [signingIn, setSigningIn] = useState(false);
  const [err, setErr] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);

  if (!cloud.configured) return null;

  if (auth.loading) {
    return <section className="card p-5 text-sm text-stone-500">Checking your account…</section>;
  }

  if (!auth.user) {
    return (
      <section className="card p-5">
        <div className="flex items-start gap-3">
          <Cloud className="mt-0.5 shrink-0 text-brand-600" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Back up and share</h2>
            <p className="mt-1 text-sm text-stone-500">Sign in to keep your people safe on all your devices and to share your family tree with relatives. You can keep using Lineage without signing in.</p>
            <GoogleButton className="mt-4" busy={signingIn} onClick={async () => {
              setSigningIn(true);
              setErr('');
              try { await auth.signIn(); } catch (e) { setErr('Sign-in didn’t finish. ' + ((e as Error).message ?? '')); }
              setSigningIn(false);
            }} />
            {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          </div>
        </div>
      </section>
    );
  }

  const user = auth.user;
  const shared = spaces.filter((s) => s.id !== user.uid);
  const statusIcon = status.state === 'syncing' ? <RefreshCw size={15} className="animate-spin" />
    : status.state === 'offline' ? <CloudOff size={15} />
      : status.state === 'error' ? <AlertCircle size={15} />
        : <Cloud size={15} />;
  const statusCls = status.state === 'error' ? 'text-red-600 dark:text-red-400' : status.state === 'offline' ? 'text-amber-700 dark:text-amber-300' : 'text-stone-500';
  const unsynced = status.state === 'error' || status.state === 'offline' || backup.paused;

  return (
    <section className="card">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <UserAvatar user={user} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{user.name || user.email}</div>
            {user.name && <div className="truncate text-sm text-stone-500">{user.email}</div>}
          </div>
        </div>
        {backup.paused ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 sm:flex-row sm:items-center">
            <span className="flex-1">Backup is off. Your people are only on this device.</span>
            <button className="btn-primary" onClick={backup.approve}>Back up now</button>
          </div>
        ) : (
          <div className={`mt-4 flex items-center gap-2 text-sm ${statusCls}`} role="status" aria-live="polite">
            {statusIcon}<span>{syncStatusText(status, now)}</span>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!backup.paused && <button className="btn-secondary" disabled={status.state === 'syncing'} onClick={() => cloud.syncNow()}><RefreshCw size={16} /> Sync now</button>}
          <button className="btn-ghost" onClick={() => setConfirmOut(true)}><LogOut size={16} /> Sign out</button>
        </div>
      </div>

      {!cloud.isShared && (
        <Link to="/sharing" className="flex min-h-[56px] items-center gap-3 border-t border-stone-100 px-5 py-3.5 transition hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/60">
          <Users size={19} className="text-stone-500" />
          <span className="flex-1">
            <span className="block font-medium">Share my family tree</span>
            <span className="block text-sm text-stone-500">Invite relatives to see or help build it</span>
          </span>
          <ChevronRight size={18} className="text-stone-400" />
        </Link>
      )}

      {shared.length > 0 && (
        <div className="border-t border-stone-100 p-3 dark:border-stone-800">
          <div className="section-title px-2 pb-2 pt-1">Whose family to show</div>
          <SpaceList />
          <div className="mt-2 flex flex-wrap gap-1 px-1">
            {shared.map((s) => (
              <button key={s.id} className="btn-ghost px-3 py-2 text-sm text-stone-500" onClick={() => setLeaving({ id: s.id, name: s.name })}>
                Leave {s.name} <RoleBadge role={s.role} />
              </button>
            ))}
          </div>
        </div>
      )}

      <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?"
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-ghost" onClick={() => setConfirmOut(false)}>Cancel</button>
          <button className="btn-danger" onClick={async () => { setConfirmOut(false); await cloud.signOut(false); }}>Remove from this device</button>
          <button className="btn-primary" onClick={async () => { setConfirmOut(false); await cloud.signOut(true); }}>Keep on this device</button>
        </div>}>
        <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
          {backup.separateLocal
            ? <p><b>Keep on this device</b>: your people stay saved on this device, ready for when you sign in again. Signed out, this browser shows the people that were here before you.</p>
            : <p><b>Keep on this device</b>: your people stay here and you can keep using Lineage. Changes won’t be backed up until you sign in again.</p>}
          <p><b>Remove from this device</b>: good for a shared or borrowed phone. Everything stays safe in your Google account; sign in again to get it back.</p>
          {unsynced && <p className="rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">Some recent changes may not be backed up yet. If you remove them now, they’ll be lost.</p>}
        </div>
      </Sheet>

      <Sheet open={!!leaving} onClose={() => setLeaving(null)} title={`Leave ${leaving?.name ?? ''}?`}
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setLeaving(null)}>Cancel</button>
          <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={async () => { const l = leaving; setLeaving(null); if (l) await cloud.leaveSpace(l.id); }}>Leave</button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">You’ll stop seeing this family tree. The owner can invite you again later.</p>
      </Sheet>
    </section>
  );
}
