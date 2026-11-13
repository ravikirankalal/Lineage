/** Small cloud UI pieces: Google button, user avatar, role badge, space switcher and banners.
 * Every export renders nothing when Firebase is not configured. */
import { Check, ChevronsUpDown, Eye, Mail, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_HINT, ROLE_LABEL, useCloud, type MySpace } from '../lib/cloud/CloudProvider';
import type { CloudUser, Role } from '../lib/cloud/contract';
import { Sheet } from './Sheet';

/** Google's standard "Sign in with Google" button (light and dark themes). */
export function GoogleButton({ onClick, busy, className = '' }: { onClick: () => void; busy?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`inline-flex h-11 items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-5 text-sm font-medium text-[#1F1F1F] transition hover:bg-stone-50 active:scale-[.98] disabled:opacity-60 dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1f1f20] ${className}`}
      style={{ fontFamily: 'Roboto, "Segoe UI", Arial, sans-serif' }}>
      <GoogleG />
      <span>{busy ? 'Signing in…' : 'Sign in with Google'}</span>
    </button>
  );
}

export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Round avatar for a signed-in account or a member (photo, else first letter). */
export function UserAvatar({ user, size = 40 }: { user: Pick<CloudUser, 'email' | 'name' | 'photoURL'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.4) };
  if (user.photoURL && !broken) {
    return <img src={user.photoURL} alt="" style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" />;
  }
  const letter = (user.name || user.email || '?').trim()[0]?.toUpperCase() ?? '?';
  return <div style={style} className="flex shrink-0 select-none items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">{letter}</div>;
}

export function RoleBadge({ role }: { role: Role }) {
  const cls = role === 'viewer'
    ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'
    : role === 'editor'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
      : 'bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200';
  return <span className={`chip shrink-0 ${cls}`}>{ROLE_LABEL[role]}</span>;
}

/** "My people" plus each family shared with me. Shows only when there's something to switch to. */
export function SpaceSwitcher({ className = '' }: { className?: string }) {
  const { configured, auth, spaces, activeSpace, isShared } = useCloud();
  const [open, setOpen] = useState(false);
  if (!configured || !auth.user || !spaces.some((s) => s.id !== auth.user!.uid)) return null;
  const current = isShared && activeSpace ? activeSpace.name : 'My people';
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={`Showing ${current}. Switch family`}
        className={`flex min-h-[40px] w-full min-w-0 items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-left text-sm font-medium transition hover:bg-stone-200/70 dark:bg-stone-800 dark:hover:bg-stone-700 ${className}`}>
        <Users size={16} className="shrink-0 text-stone-500" />
        <span className="min-w-0 flex-1 truncate">{current}</span>
        {isShared && activeSpace && <RoleBadge role={activeSpace.role} />}
        <ChevronsUpDown size={16} className="shrink-0 text-stone-400" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Whose family?">
        <SpaceList onPicked={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

/** The list used by the switcher sheet and the Settings account card. */
export function SpaceList({ onPicked }: { onPicked?: () => void }) {
  const { auth, spaces, activeSpace, switchSpace } = useCloud();
  const nav = useNavigate();
  const uid = auth.user?.uid;
  if (!uid) return null;
  const mine = spaces.find((s) => s.id === uid);
  const shared = spaces.filter((s) => s.id !== uid);
  const pick = async (id: string) => {
    onPicked?.();
    // A different family has different people: leave any person page behind first
    // (switching re-mounts the router).
    if ((activeSpace?.id ?? uid) !== id) nav(id === uid ? '/' : '/family');
    await switchSpace(id);
  };
  const row = (id: string, title: string, sub: string, role?: Role, s?: MySpace) => {
    const active = (activeSpace?.id ?? uid) === id;
    return (
      <button key={id} onClick={() => pick(id)} aria-pressed={active}
        className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-300'}`}>
          {active ? <Check size={18} /> : s ? <Eye size={17} /> : <Users size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-stone-500">{sub}</span>
        </span>
        {role && <RoleBadge role={role} />}
      </button>
    );
  };
  return (
    <div className="space-y-1">
      {row(uid, 'My people', mine ? 'Everyone you’ve added' : 'Your own family and friends')}
      {shared.length > 0 && <div className="section-title px-3 pb-1 pt-3">Shared with me</div>}
      {shared.map((s) => row(s.id, s.name, ROLE_HINT[s.role], s.role, s))}
    </div>
  );
}

/** Subtle, persistent banner while looking at someone else's family. */
export function SharedSpaceBanner() {
  const { configured, isShared, activeSpace, auth, switchSpace } = useCloud();
  const nav = useNavigate();
  if (!configured || !isShared || !activeSpace || !auth.user) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-sky-50 px-4 py-2.5 text-sm text-sky-900 ring-1 ring-sky-100 dark:bg-sky-950/40 dark:text-sky-100 dark:ring-sky-900/60">
      <Eye size={17} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">Viewing <b>{activeSpace.name}</b> · {ROLE_LABEL[activeSpace.role]}</span>
      <button className="shrink-0 rounded-lg px-2.5 py-2 font-medium hover:bg-sky-100 dark:hover:bg-sky-900/50" onClick={() => { nav('/'); void switchSpace(auth.user!.uid); }}>My people</button>
    </div>
  );
}

/** "You're invited" cards with Accept / Decline. */
export function InviteBanner() {
  const { configured, invites, acceptInvite, declineInvite } = useCloud();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (!configured || !invites.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {invites.map((i) => (
        <div key={i.spaceId} className="flex flex-col gap-3 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:ring-brand-800 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Mail size={20} className="mt-0.5 shrink-0 text-brand-700 dark:text-brand-300" />
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-brand-900 dark:text-brand-100">You’re invited to {i.spaceName}</div>
              <div className="text-brand-800/80 dark:text-brand-200/80">
                {i.role === 'editor' ? 'You’ll be able to see their family tree and add or edit relatives.' : 'You’ll be able to see their family tree.'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn-ghost" disabled={!!busy} onClick={() => declineInvite(i.spaceId)}>Decline</button>
            <button className="btn-primary" disabled={!!busy} onClick={async () => {
              setBusy(i.spaceId);
              setErr('');
              try { await acceptInvite(i.spaceId); window.location.hash = '#/family'; } catch (e) { setErr('Couldn’t join: ' + (e as Error).message); }
              setBusy(null);
            }}>{busy === i.spaceId ? 'Joining…' : 'Accept'}</button>
          </div>
        </div>
      ))}
      {err && <p className="px-1 text-sm text-red-600">{err}</p>}
    </div>
  );
}

/** One-time question before this device's people are uploaded for the first time. */
export function BackupConsentSheet() {
  const { configured, backup, signOut } = useCloud();
  const [busy, setBusy] = useState(false);
  if (!configured) return null;
  const n = backup.count;
  const people = `${n} ${n === 1 ? 'person' : 'people'}`;
  if (backup.foreign) {
    const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
    return (
      <Sheet open onClose={() => { void signOut(true); }} title={`This device has ${people} from another account`}
        footer={<div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button className="btn-primary" disabled={busy} onClick={() => run(backup.keepSeparate)}>Keep them only on this device</button>
          <button className="btn-danger" disabled={busy} onClick={() => run(backup.removeLocal)}>Remove them from this device</button>
          <button className="btn-ghost sm:mr-auto" disabled={busy} onClick={() => signOut(true)}>Cancel and sign out</button>
        </div>}>
        <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
          <p>Someone else signed in to Lineage on this browser before. Their people will <b>not</b> be added to your account.</p>
          <p><b>Keep them only on this device</b>: they stay here for whoever uses this browser signed out. Your own people are kept separately while you’re signed in.</p>
          <p><b>Remove them from this device</b>: deletes them here only. If they were backed up, the other account still has them.</p>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open={backup.asking} onClose={backup.decline} title={`Back up your ${n} ${n === 1 ? 'person' : 'people'} to your Google account?`}
      footer={<div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={backup.decline}>Not now</button>
        <button className="btn-primary" onClick={backup.approve}>Back up</button>
      </div>}>
      <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
        <p>They’ll be kept safe in your account and appear on every device where you sign in.</p>
        {backup.combine && <p>Your account already has people saved from another device. The two will be combined.</p>}
        <p className="text-stone-500">Only you can see them. If you later share your family tree, relatives see only family — never friends, colleagues or private notes.</p>
      </div>
    </Sheet>
  );
}

/** Link shown in a page header to the sharing screen (owner, own people only). */
export function ShareLink({ className = '' }: { className?: string }) {
  const { configured, isShared } = useCloud();
  if (!configured || isShared) return null;
  return <Link to="/sharing" className={`btn-secondary ${className}`}><Users size={16} /> Share</Link>;
}

/** One-time notice from the cloud layer (e.g. access to a shared family was removed). */
export function CloudNotice() {
  const { configured, notice, dismissNotice } = useCloud();
  if (!configured || !notice) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40">
      <span className="min-w-0 flex-1">{notice}</span>
      <button className="shrink-0 rounded-lg px-2.5 py-2 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40" onClick={dismissNotice}>OK</button>
    </div>
  );
}
