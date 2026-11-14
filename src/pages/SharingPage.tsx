import { ArrowLeft, Clock, Phone, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleButton, RoleBadge, UserAvatar } from '../components/Cloud';
import { Sheet } from '../components/Sheet';
import { ROLE_HINT, ROLE_LABEL, useCloud } from '../lib/cloud/CloudProvider';
import type { InviteDoc, MemberRole } from '../lib/cloud/contract';
import { invite, listInvites, removeMember, revokeInvite, setRole } from '../lib/cloud/spaces';
import { useData } from '../lib/data';
import { fullName } from '../lib/person';
import { firstEmail, hasPhone, matchPeople } from '../lib/sharing';
import type { Person } from '../lib/types';

const ROLES: MemberRole[] = ['viewer', 'editor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owner-only: invite relatives to the family part of the tree, and manage who has access. */
export function SharingPage() {
  const nav = useNavigate();
  const cloud = useCloud();
  const { auth, spaces, isShared } = cloud;
  const { me, people, byId } = useData();
  const uid = auth.user?.uid;
  const space = spaces.find((s) => s.id === uid);

  const [email, setEmail] = useState('');
  const [role, setNewRole] = useState<MemberRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [removing, setRemoving] = useState<{ uid: string; label: string } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<{ uid: string; label: string } | null>(null);
  const [promotePick, setPromotePick] = useState<Person | undefined>();
  const chosen = personId ? byId.get(personId) : undefined;
  const editorReady = role !== 'editor' || (!!chosen && hasPhone(chosen));

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
    if (!editorReady) { setMsg({ ok: false, text: 'Pick who they are in your tree. They need a phone number saved.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      // The rules check the person and phone in the cloud copy, so push local edits first.
      if (role === 'editor') await cloud.syncNow();
      await invite(uid!, e, role, role === 'editor' ? chosen!.id : undefined);
      setEmail('');
      setPersonId(null);
      setMsg({ ok: true, text: `Invited ${e}. Ask them to open Lineage and sign in with that Google account. The invitation will be waiting.` });
      await loadInvites();
    } catch (err) {
      setMsg({ ok: false, text: 'Couldn’t send the invite: ' + (err as Error).message });
    }
    setBusy(false);
  }

  function pick(p: Person) {
    setPersonId(p.id);
    if (!email.trim()) setEmail(firstEmail(p));
    setMsg(null);
  }

  /** Changing someone to editor needs the person they are in the tree, with a phone number. */
  function changeRole(mid: string, label: string, next: MemberRole) {
    if (next !== 'editor') { void act(() => setRole(uid!, mid, next)); return; }
    const linked = space?.memberInfo?.[mid]?.personId;
    const p = linked ? byId.get(linked) : undefined;
    if (p && hasPhone(p)) void act(() => setRole(uid!, mid, 'editor', p.id));
    else setPromoting({ uid: mid, label });
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
        <span>They’ll see your family tree, but not your private notes.</span>
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
        {role === 'editor' && (
          <div className="mt-3">
            <span className="label">Who are they in your tree?</span>
            <PersonPick people={people} chosen={chosen} onPick={pick} onClear={() => setPersonId(null)} />
            <p className="mt-1.5 text-xs text-stone-500">Only people already in your tree, with a phone number saved, can edit.</p>
          </div>
        )}
        {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-brand-700 dark:text-brand-300' : 'text-red-600'}`} role="status">{msg.text}</p>}
        <button className="btn-primary mt-4 w-full sm:w-auto" disabled={busy || !email.trim() || !editorReady} onClick={send}><UserPlus size={17} /> {busy ? 'Inviting…' : 'Send invite'}</button>
      </section>

      {/* Members */}
      <h2 className="section-title mb-1.5 ml-1 mt-6">People with access</h2>
      <div className="card p-1.5">
        {members.length === 0 ? (
          <p className="px-4 py-5 text-sm text-stone-500">No one yet. Invite a relative above.</p>
        ) : members.map(([mid, r]) => {
          const info = space?.memberInfo?.[mid];
          const label = info?.name || info?.email || 'A relative';
          const linked = info?.personId ? byId.get(info.personId) : undefined;
          return (
            <div key={mid} className="flex flex-wrap items-center gap-3 rounded-xl px-2.5 py-2">
              <UserAvatar user={{ email: info?.email ?? '', name: info?.name }} size={38} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{label}</div>
                {info?.name && info.email && <div className="truncate text-sm text-stone-500">{info.email}</div>}
                {linked && <Link to={`/people/${linked.id}`} className="truncate text-sm text-brand-700 dark:text-brand-300">In your tree: {fullName(linked)}</Link>}
              </div>
              <select aria-label={`What ${label} can do`} value={r === 'owner' ? 'editor' : r}
                onChange={(e) => changeRole(mid, label, e.target.value as MemberRole)}
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
                  <div className="text-sm text-stone-500">Invited {new Date(i.createdAt).toLocaleDateString()}{i.personId && byId.get(i.personId) ? ` · ${fullName(byId.get(i.personId)!)}` : ''}</div>
                </div>
                <RoleBadge role={i.role} />
                <button className="btn-ghost px-3" onClick={() => act(() => revokeInvite(uid!, i.email))}>Cancel invite</button>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!promoting} onClose={() => { setPromoting(null); setPromotePick(undefined); }} title={`Let ${promoting?.label ?? ''} edit?`}
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => { setPromoting(null); setPromotePick(undefined); }}>Cancel</button>
          <button className="btn-primary" disabled={!promotePick || !hasPhone(promotePick)} onClick={() => {
            const m = promoting; const p = promotePick; setPromoting(null); setPromotePick(undefined);
            if (m && p) void act(async () => { await cloud.syncNow(); await setRole(uid!, m.uid, 'editor', p.id); });
          }}>Make editor</button>
        </div>}>
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">Editors must be in your tree with a phone number saved. Who are they?</p>
        <PersonPick people={people} chosen={promotePick} onPick={setPromotePick} onClear={() => setPromotePick(undefined)} />
      </Sheet>

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

/** Search the tree for a person. Picking one without a phone number shows a link to add it. */
function PersonPick({ people, chosen, onPick, onClear }: { people: Person[]; chosen?: Person; onPick: (p: Person) => void; onClear?: () => void }) {
  const [q, setQ] = useState('');
  if (chosen) {
    const ok = hasPhone(chosen);
    return (
      <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ${ok ? 'ring-brand-300 bg-brand-50 dark:bg-brand-900/30 dark:ring-brand-800' : 'ring-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:ring-amber-900/40'}`}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{fullName(chosen)}</div>
          {ok
            ? <div className="flex items-center gap-1 truncate text-sm text-stone-500"><Phone size={13} /> {chosen.phones.find((x) => x.value.trim())!.value}</div>
            : <Link to={`/people/${chosen.id}/edit`} className="text-sm text-amber-800 underline dark:text-amber-200">No phone number yet. Add one first.</Link>}
        </div>
        {onClear && <button className="icon-btn" aria-label="Pick someone else" onClick={onClear}><X size={17} /></button>}
      </div>
    );
  }
  const found = matchPeople(people, q);
  return (
    <div>
      <input className="input" type="search" placeholder="Search your tree by name" aria-label="Search your tree by name"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <ul className="mt-1.5 max-h-72 overflow-auto rounded-xl ring-1 ring-stone-200 dark:ring-stone-700">
          {found.map((p) => {
            const ok = hasPhone(p);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => { setQ(''); onPick(p); }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800">
                  <span className={`min-w-0 flex-1 truncate ${ok ? '' : 'text-stone-500'}`}>{fullName(p)}</span>
                  <span className="shrink-0 text-xs text-stone-500">{ok ? <span className="inline-flex items-center gap-1"><Phone size={12} /> has phone</span> : 'no phone'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {q.trim() && found.length === 0 && <p className="mt-1.5 text-sm text-stone-500">Nobody in your tree matches. Add them to the tree first.</p>}
    </div>
  );
}
