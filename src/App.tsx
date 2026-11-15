import { CloudOff, Eye, GitBranch, Settings, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { CloudNotice, GoogleButton, InviteBanner, SharedSpaceBanner, SpaceSwitcher } from './components/Cloud';
import { Empty } from './components/Empty';
import { PullToRefresh, UpdateBar } from './components/AppRefresh';
import { hideSplash, isNativeApp } from './lib/native';
import { useBottomTabsHidden } from './components/tree/bottomTabs';
import { CloudProvider, useCanEdit, useCloud } from './lib/cloud/CloudProvider';
import { DataProvider } from './lib/data';
import { AdminPage } from './pages/AdminPage';
import { FamilyPage } from './pages/FamilyPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonEditPage } from './pages/PersonEditPage';
import { PersonPage } from './pages/PersonPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharingPage } from './pages/SharingPage';

const NAV = [
  { to: '/', label: 'Family', icon: Users, end: true },
  { to: '/family', label: 'Family Tree', icon: GitBranch },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/** Routes that change data: viewers get a plain explanation instead. */
function EditOnly({ children }: { children: ReactNode }) {
  const canEdit = useCanEdit();
  if (canEdit) return children;
  return (
    <div className="card">
      <Empty icon={<Eye size={26} />} title="You can look, not change"
        action={<Link to="/" className="btn-primary">Back to people</Link>}>
        This family was shared with you to view. Ask the owner to make you an editor if you’d like to add or change people.
      </Empty>
    </div>
  );
}

/** No internet: nothing can be read or saved, so say so plainly. */
function OfflineBar() {
  const { online } = useCloud();
  if (online) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40">
      <CloudOff size={17} className="shrink-0" />
      <span>You’re offline. Lineage needs the internet; changes can’t be made until you’re back online.</span>
    </div>
  );
}

function Shell() {
  // Family Tree is a full-bleed map of the tree: no page padding or width limit.
  const map = useLocation().pathname === '/family';
  const tabsHidden = useBottomTabsHidden() && map;
  return (
    <div className="min-h-[calc(100dvh-var(--sat))] md:flex">
      <ScrollTop />
      <PullToRefresh enabled={isNativeApp() && !map} />
      {/* Sidebar (tablet / desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-stone-200/70 bg-white/60 px-3 py-5 backdrop-blur dark:border-stone-800 dark:bg-stone-900/40 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <img src="./icon.svg" alt="" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Lineage</span>
        </div>
        <SpaceSwitcher className="mb-4" />
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'}`}>
              <Icon size={19} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className={map ? 'w-full min-w-0 flex-1' : 'mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10 md:pt-8'}>
        <div className={map ? 'px-4 pt-3 empty:hidden sm:px-6 [&>*:last-child]:mb-3' : undefined}>
          <OfflineBar />
          <CloudNotice />
          <SharedSpaceBanner />
          <InviteBanner />
        </div>
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/people/new" element={<EditOnly><PersonEditPage /></EditOnly>} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/people/:id/edit" element={<EditOnly><PersonEditPage /></EditOnly>} />
          <Route path="/people/:id/tree" element={<OldTreeLink />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sharing" element={<SharingPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<PeoplePage />} />
        </Routes>
      </main>

      {/* Bottom tabs (phone) */}
      {/* On Family Tree they slide away when idle; a tap on the tree brings them back (bottomTabs.ts). */}
      <nav inert={tabsHidden} aria-hidden={tabsHidden || undefined} data-hidden={tabsHidden || undefined}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/90 pb-safe backdrop-blur-lg transition-transform duration-200 dark:border-stone-800 dark:bg-stone-900/90 md:hidden ${map ? 'map-glass' : ''} ${tabsHidden ? 'translate-y-full' : ''}`}>
        <div className="mx-auto flex max-w-lg">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium transition ${
                isActive ? 'text-brand-600 dark:text-brand-300' : 'text-stone-500 dark:text-stone-400'}`}>
              <Icon size={22} strokeWidth={1.9} /> {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[calc(100dvh-var(--sat))] flex-col items-center justify-center px-6 py-10 text-center">{children}</div>;
}

/** While Lineage starts: the logo, like the launch screen and the sign-in screen, so nothing jumps. */
function Starting({ text }: { text: string }) {
  return (
    <Centered>
      <img src="./icon.svg" alt="" className="h-14 w-14" />
      <p className="mt-4 text-stone-500">{text}</p>
    </Centered>
  );
}

/** Sign-in is required: the family tree lives in your Google account, not on this device. */
function SignIn() {
  const { auth } = useCloud();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Centered>
      <img src="./icon.svg" alt="" className="h-14 w-14" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Lineage</h1>
      <p className="mt-2 max-w-sm text-stone-500">Your family tree, kept safe in your Google account and shared with the relatives you choose.</p>
      <GoogleButton className="mt-8" busy={busy} onClick={async () => {
        setBusy(true);
        setErr('');
        document.body.dataset.signingIn = '1'; // no update reload while Google's sign-in is open
        try { await auth.signIn(); } catch (e) { setErr('Sign-in didn’t finish. ' + ((e as Error).message ?? '')); }
        delete document.body.dataset.signingIn;
        setBusy(false);
      }} />
      {err && <p className="mt-3 max-w-sm text-sm text-red-600">{err}</p>}
    </Centered>
  );
}

/** Signed out → sign in; signed in → the app once the family tree has loaded. */
function Gate() {
  const { configured, auth, state, error, online } = useCloud();
  // The app's launch screen stays until sign-in is known (the sign-in screen, or the tree opening).
  useEffect(() => { if (!auth.loading) hideSplash(); }, [auth.loading]);
  if (!configured) return <Centered><p className="text-stone-500">Lineage isn’t set up correctly (no Firebase settings in this build).</p></Centered>;
  if (auth.loading) return <Starting text="Loading…" />;
  if (!auth.user) return <SignIn />;
  if (state === 'error') return <Centered><p className="max-w-sm text-stone-600 dark:text-stone-300">{error}</p><button className="btn-primary mt-6" onClick={() => location.reload()}>Try again</button></Centered>;
  if (state === 'loading') return <Starting text={online ? 'Opening your family tree…' : 'You’re offline. Lineage needs the internet.'} />;
  return <Shell />;
}

export function App() {
  return (
    <CloudProvider>
      <DataProvider>
        <HashRouter>
          <UpdateBar />
          <Gate />
        </HashRouter>
      </DataProvider>
    </CloudProvider>
  );
}

/** The per-person tree page is gone (owner): old links open the person's profile. */
function OldTreeLink() {
  const { id } = useParams();
  return <Navigate to={`/people/${id ?? ''}`} replace />;
}
