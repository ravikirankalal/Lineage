import { ArrowLeft, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoleBadge, UserAvatar } from '../components/Cloud';
import { activityByMember, listActivity, type ActivityCounts, type ActivityEntry } from '../lib/cloud/activity';
import { useCloud, usePermissions } from '../lib/cloud/CloudProvider';
import type { Role } from '../lib/cloud/contract';

const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "added 2 people, changed 1 link" */
export function describeChange(c: ActivityCounts): string {
  const parts = [
    c.peopleAdded && `added ${c.peopleAdded === 1 ? '1 person' : `${c.peopleAdded.toLocaleString()} people`}`,
    c.peopleEdited && `edited ${c.peopleEdited === 1 ? '1 person' : `${c.peopleEdited.toLocaleString()} people`}`,
    c.peopleRemoved && `removed ${c.peopleRemoved === 1 ? '1 person' : `${c.peopleRemoved.toLocaleString()} people`}`,
    c.linksAdded && `added ${plural(c.linksAdded, 'relationship')}`,
    c.linksChanged && `changed ${plural(c.linksChanged, 'relationship')}`,
    c.linksRemoved && `removed ${plural(c.linksRemoved, 'relationship')}`,
  ].filter(Boolean);
  return parts.join(', ') || 'no changes';
}

/** Owner-only: who has been adding to and editing the family tree. */
export function AdminPage() {
  const nav = useNavigate();
  const { auth, spaces, refreshSpaces } = useCloud();
  const { isOwner } = usePermissions();
  const uid = auth.user?.uid;
  const space = spaces.find((s) => s.id === uid);
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!uid || !isOwner) return;
    setError('');
    // Fresh member list too, so someone who joined since the app opened shows by name.
    try { const [list] = await Promise.all([listActivity(uid), refreshSpaces()]); setEntries(list); } catch (e) { setError((e as Error).message); }
  }, [uid, isOwner, refreshSpaces]);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => activityByMember(entries ?? []), [entries]);

  const header = (
    <div className="mb-5 flex items-center gap-2">
      <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin</h1>
        <p className="text-sm text-stone-500">What editors have added and changed in your family tree.</p>
      </div>
      {isOwner && <button className="icon-btn" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={18} /></button>}
    </div>
  );

  if (!isOwner || !uid) {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <div className="card flex items-start gap-3 p-5 text-sm text-stone-600 dark:text-stone-300">
          <Lock size={18} className="mt-0.5 shrink-0 text-stone-400" />
          Only the family’s owner can see this page.
        </div>
      </div>
    );
  }

  // Owner and editors, plus anyone else who has activity (a viewer now, or someone since removed).
  const roles = space?.members ?? {};
  const ids = [...new Set([uid, ...Object.keys(roles).filter((m) => roles[m] === 'editor'), ...totals.keys()])];
  const who = (m: string) => {
    if (m === uid) return { name: 'You', email: auth.user?.email ?? '', photoURL: auth.user?.photoURL };
    const info = space?.memberInfo?.[m];
    return { name: info?.name || info?.email || (roles[m] ? 'Member' : 'Former member'), email: info?.email ?? '', photoURL: undefined };
  };
  const rows = ids
    .map((m) => ({ id: m, role: roles[m] as Role | undefined, user: who(m), t: totals.get(m) ?? { peopleAdded: 0, edits: 0 } }))
    .sort((a, b) => Number(b.id !== uid) - Number(a.id !== uid) || (b.t.last ?? 0) - (a.t.last ?? 0));
  const since = entries?.length ? entries[entries.length - 1].at : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      {header}
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">Couldn’t load activity: {error}</div>}

      <section className="card divide-y divide-stone-100 dark:divide-stone-800" aria-label="Activity by person">
        {rows.map(({ id, role, user, t }) => (
          <div key={id} className="flex items-center gap-3 px-5 py-4" data-member={id === uid ? 'me' : 'other'}>
            <UserAvatar user={user} size={38} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{user.name}</span>
                {role && <RoleBadge role={role} />}
              </div>
              <div className="truncate text-sm text-stone-500">{t.last ? `Last active ${dateTime(t.last)}` : 'No changes yet'}</div>
            </div>
            <Stat label="New people" value={t.peopleAdded} />
            <Stat label="Edits" value={t.edits} />
          </div>
        ))}
        {rows.length === 1 && <p className="px-5 py-4 text-sm text-stone-500">No editors yet. Invite someone as an editor from Share my family tree.</p>}
      </section>

      <h2 className="mb-2 mt-6 font-semibold">Recent changes</h2>
      <section className="card divide-y divide-stone-100 dark:divide-stone-800">
        {entries === null && !error && <p className="px-5 py-4 text-sm text-stone-500">Loading…</p>}
        {entries?.length === 0 && <p className="px-5 py-4 text-sm text-stone-500">Nothing recorded yet.</p>}
        {entries?.slice(0, 50).map((e) => (
          <div key={e.id} className="px-5 py-3 text-sm">
            <span className="font-medium">{who(e.by).name}</span> <span className="text-stone-600 dark:text-stone-300">{describeChange(e)}</span>
            <div className="text-xs text-stone-500">{dateTime(e.at)}</div>
          </div>
        ))}
      </section>
      <p className="mt-3 text-xs text-stone-500">
        {since ? `Counted since ${dateTime(since)}. ` : ''}Changes are counted from when this page was added; earlier edits aren’t included. An edit is one save that changes people or relationships already in the tree.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="w-16 shrink-0 text-right sm:w-20">
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[11px] leading-tight text-stone-500">{label}</div>
    </div>
  );
}
