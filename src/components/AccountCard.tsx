import { ChevronRight, LogOut, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../lib/cloud/CloudProvider';
import { RoleBadge, SpaceList, UserAvatar } from './Cloud';
import { Sheet } from './Sheet';

/** Settings: the signed-in account, sharing, families shared with you, and sign out. */
export function AccountCard() {
  const cloud = useCloud();
  const { auth, spaces } = cloud;
  const [confirmOut, setConfirmOut] = useState(false);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);

  if (!auth.user) return null;

  const user = auth.user;
  const shared = spaces.filter((s) => s.id !== user.uid);

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
        <div className="mt-4 flex flex-wrap gap-2">
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
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmOut(false)}>Cancel</button>
          <button className="btn-primary" onClick={async () => { setConfirmOut(false); await cloud.signOut(); }}>Sign out</button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">Your family tree stays safe in your Google account. Sign in again to see it.</p>
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
