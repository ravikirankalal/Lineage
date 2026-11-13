import { ArrowLeft, Clock, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleButton, RoleBadge, UserAvatar } from '../components/Cloud';
import { Sheet } from '../components/Sheet';
import { ROLE_HINT, ROLE_LABEL, useCloud } from '../lib/cloud/CloudProvider';
import type { InviteDoc, MemberRole } from '../lib/cloud/contract';
import { invite, listInvites, removeMember, revokeInvite, setRole } from '../lib/cloud/spaces';
import { useData } from '../lib/data';

const ROLES: MemberRole[] = ['viewer', 'editor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owner-only: invite relatives to the family part of the tree, and manage who has access. */
export function SharingPage() {
  const nav = useNavigate();
  const cloud = useCloud();
  const { auth, spaces, isShared } = cloud;
  const { me } = useData();
  const uid = auth.user?.uid;
  const space = spaces.find((s) => s.id === uid);

  const [email, setEmail] = useState('');
  const [role, setNewRole] = useState<MemberRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [removing, setRemoving] = useState<{ uid: string; label: string } | null>(null);

  const loadInvites = useCallback(async () => {
    if (!uid) return;
    try { setInvites(await listInvites(uid)); } catch { /* offline: keep what we have */ }
  }, [uid]);
  useEffect(() => { void loadInvites(); }, [loadInvites]);

  const header = (
    <div className="mb-5 flex items-center gap-2">
      <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Share my family tree</h1>
        <p className="text-sm text-stone-500">Let relatives see your family, or help you build it.</p>
      </div>
    </div>
  );

  if (!cloud.configured) {
    return <div className="mx-auto max-w-2xl">{header}<p className="card p-5 text-sm text-stone-500">Sharing isn’t available in this version of Lineage.</p></div>;
  }
  if (!auth.user) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="card p-5">
          <p className="text-sm text-stone-600 dark:text-stone-300">Sign in first. Your people are backed up to your Google account, and then you can invite relatives.</p>
          <GoogleButton className="mt-4" onClick={() => auth.signIn()} />
        </div>
      </div>
    );
  }
  if (isShared) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="card p-5 text-sm text-stone-600 dark:text-stone-300">
          You’re looking at someone else’s family. Switch back to your own people to share them.
          <div className="mt-4"><button className="btn-primary" onClick={() => cloud.switchSpace(auth.user!.uid)}>Show my people</button></div>
        </div>
      </div>
    );
  }

  const members = Object.entries(space?.members ?? {}).filter(([id]) => id !== uid);

  async function send() {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) { setMsg({ ok: false, text: 'That doesn’t look like an email address.' }); return; }
    if (e === auth.user!.email.toLowerCase()) { setMsg({ ok: false, text: 'That’s your own email.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await invite(uid!, e, role);
      setEmail('');
      setMsg({ ok: true, text: `Invited ${e}. Ask them to open Lineage and sign in with that Google account. The invitation will be waiting.` });
      await loadInvites();
    } catch (err) {
      setMsg({ ok: false, text: 'Couldn’t send the invite: ' + (err as Error).message });
    }
    setBusy(false);
  }

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await Promise.all([cloud.refreshSpaces(), loadInvites()]);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {header}

      <div className="mb-4 flex items-start gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-900 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-100 dark:ring-brand-800">
        <ShieldCheck size={20} className="mt-0.5 shrink-0" />
        <span>They’ll see only your family — not friends, colleagues or private notes.</span>
      </div>

      {!me && (
        <Link to="/family" className="mb-4 block rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40">
          Add yourself to My Family first. Lineage shares the people connected to you by family, so without you there’s nothing to share yet.
        </Link>
      )}

      {/* Invite */}
      <section className="card p-5">
        <h2 className="font-semibold">Invite a relative</h2>
        <label className="mt-3 block">
          <span className="label">Their Google email</span>
          <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="name@gmail.com"
            value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        </label>
        <div className="mt-3">
          <span className="label" id="invite-role">They can</span>
          <div role="radiogroup" aria-labelledby="invite-role" className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button key={r} role="radio" aria-checked={role === r} onClick={() => setNewRole(r)}
                className={`min-h-[56px] rounded-xl px-3 py-2.5 text-left ring-1 transition ${role === r
                  ? 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30'
                  : 'ring-stone-200 hover:bg-stone-50 dark:ring-stone-700 dark:hover:bg-stone-800'}`}>
                <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                <span className="block text-xs text-stone-500">{ROLE_HINT[r]}</span>
              </button>
            ))}
          </div>
        </div>
        {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-brand-700 dark:text-brand-300' : 'text-red-600'}`} role="status">{msg.text}</p>}
        <button className="btn-primary mt-4 w-full sm:w-auto" disabled={busy || !email.trim()} onClick={send}><UserPlus size={17} /> {busy ? 'Inviting…' : 'Send invite'}</button>
      </section>

      {/* Members */}
      <h2 className="section-title mb-1.5 ml-1 mt-6">People with access</h2>
      <div className="card p-1.5">
        {members.length === 0 ? (
          <p className="px-4 py-5 text-sm text-stone-500">No one yet. Invite a relative above.</p>
        ) : members.map(([mid, r]) => {
          const info = space?.memberInfo?.[mid];
          const label = info?.name || info?.email || 'A relative';
          return (
            <div key={mid} className="flex flex-wrap items-center gap-3 rounded-xl px-2.5 py-2">
              <UserAvatar user={{ email: info?.email ?? '', name: info?.name }} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{label}</div>
                {info?.name && info.email && <div className="truncate text-sm text-stone-500">{info.email}</div>}
              </div>
              <select aria-label={`What ${label} can do`} value={r === 'owner' ? 'editor' : r}
                onChange={(e) => act(() => setRole(uid!, mid, e.target.value as MemberRole))}
                className="min-h-[40px] rounded-xl border-0 bg-stone-100 py-2 pl-3 pr-8 text-sm dark:bg-stone-800">
                {ROLES.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]} · {ROLE_HINT[x].toLowerCase()}</option>)}
              </select>
              <button className="icon-btn text-stone-400 hover:text-red-600" aria-label={`Remove ${label}`} onClick={() => setRemoving({ uid: mid, label })}><Trash2 size={17} /></button>
            </div>
          );
        })}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <>
          <h2 className="section-title mb-1.5 ml-1 mt-6">Waiting to join</h2>
          <div className="card p-1.5">
            {invites.map((i) => (
              <div key={i.email} className="flex flex-wrap items-center gap-3 rounded-xl px-2.5 py-2">
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800"><Clock size={17} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.email}</div>
                  <div className="text-sm text-stone-500">Invited {new Date(i.createdAt).toLocaleDateString()}</div>
                </div>
                <RoleBadge role={i.role} />
                <button className="btn-ghost px-3" onClick={() => act(() => revokeInvite(uid!, i.email))}>Cancel invite</button>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.label ?? ''}?`}
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
          <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={() => { const r = removing; setRemoving(null); if (r) void act(() => removeMember(uid!, r.uid)); }}>Remove</button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">They’ll stop seeing your family tree. You can invite them again any time.</p>
      </Sheet>
    </div>
  );
}
