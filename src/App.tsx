import { Cloud, Download, Eye, GitBranch, Settings, Users } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BackupConsentSheet, CloudNotice, InviteBanner, SharedSpaceBanner, SpaceSwitcher } from './components/Cloud';
import { Empty } from './components/Empty';
import { CloudProvider, useCanEdit, useCloud } from './lib/cloud/CloudProvider';
import { DataProvider } from './lib/data';
import { FamilyPage } from './pages/FamilyPage';
import { ImportPage } from './pages/ImportPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonEditPage } from './pages/PersonEditPage';
import { PersonPage } from './pages/PersonPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharingPage } from './pages/SharingPage';
import { TreePage } from './pages/TreePage';

const NAV = [
  { to: '/', label: 'People', icon: Users, end: true },
  { to: '/family', label: 'My Family', icon: GitBranch },
  { to: '/import', label: 'Import', icon: Download },
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

function SidebarNote() {
  const { configured, auth, status, isShared } = useCloud();
  if (configured && auth.user) {
    return (
      <p className="mt-auto flex items-start gap-2 px-3 text-xs leading-relaxed text-stone-400">
        <Cloud size={14} className="mt-0.5 shrink-0" />
        {isShared ? 'Shared family. Only family is shown here.' : status.state === 'offline' ? 'Offline. Changes are saved on this device.' : 'Backed up to your Google account.'}
      </p>
    );
  }
  return <p className="mt-auto px-3 text-xs leading-relaxed text-stone-400">Your data stays on this device. Back it up from Settings.</p>;
}

function Shell() {
  return (
    <div className="min-h-dvh md:flex">
      <ScrollTop />
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
        <SidebarNote />
      </aside>

      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10 md:pt-8">
        <CloudNotice />
        <SharedSpaceBanner />
        <InviteBanner />
        <BackupConsentSheet />
        <Routes>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/people/new" element={<EditOnly><PersonEditPage /></EditOnly>} />
          <Route path="/people/:id" element={<PersonPage />} />
          <Route path="/people/:id/edit" element={<EditOnly><PersonEditPage /></EditOnly>} />
          <Route path="/people/:id/tree" element={<TreePage />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sharing" element={<SharingPage />} />
          <Route path="*" element={<PeoplePage />} />
        </Routes>
      </main>

      {/* Bottom tabs (phone) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/90 pb-safe backdrop-blur-lg dark:border-stone-800 dark:bg-stone-900/90 md:hidden">
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

/** Re-mounts the data layer whenever the local database is swapped (sign-out, space switch). */
function SpaceData({ children }: { children: ReactNode }) {
  const { dataKey } = useCloud();
  return <DataProvider key={dataKey}>{children}</DataProvider>;
}

export function App() {
  return (
    <CloudProvider>
      <SpaceData>
        <HashRouter>
          <Shell />
        </HashRouter>
      </SpaceData>
    </CloudProvider>
  );
}
