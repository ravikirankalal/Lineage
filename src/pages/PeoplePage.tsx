import { ArrowDown, Cake, Contact, FlaskConical, List, Search, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { PersonRow } from '../components/PersonRow';
import { FamilyStats, Lines, RelativesList } from '../components/Relatives';
import { SpaceSwitcher } from '../components/Cloud';
import { usePermissions } from '../lib/cloud/CloudProvider';
import { useData } from '../lib/data';
import { googleContactsAvailable, loadGoogleContacts, loadNativeContacts, useGoogleContacts } from '../lib/cloud/googleContacts';
import { useContactMatches } from '../lib/contactMatches';
import { isNativeApp } from '../lib/native';
import { loadDemo } from '../lib/demo';
import { relativesOf } from '../lib/kinship';
import { daysUntilBirthday, formatPlace, fullName, matchesQuery } from '../lib/person';
import type { Person } from '../lib/types';

/** One bar: the Relatives and Lines views (with "me"), then filters over everyone. */
type Tab = 'relatives' | 'lines' | 'contacts' | `tag:${string}`;

export function PeoplePage() {
  const { people, graph, me, loaded } = useData();
  const nav = useNavigate();
  const { isOwner, isShared } = usePermissions();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  // The tab lives in the URL (?view=relatives|lines|contacts|tag:x), so Back returns to it.
  // There is no "everyone" list any more (owner): Relatives is the start, search finds anyone.
  const [sp, setSp] = useSearchParams();
  const v = sp.get('view') ?? '';
  const isTab = (x: string): x is Tab => x === 'contacts' || x.startsWith('tag:') || (!!me && (x === 'relatives' || x === 'lines'));
  const tab: Tab | null = isTab(v) ? v : me ? 'relatives' : null;
  const setTab = (next: Tab | null) => setSp((prev) => {
    const p = new URLSearchParams(prev);
    if (!next || (next === 'relatives' && me)) p.delete('view'); else p.set('view', next);
    return p;
  }, { replace: true });
  const filter = tab === 'relatives' || tab === 'lines' ? null : tab;

  // How each person relates to me — shown as the subtitle, and the Relatives view.
  const relatives = useMemo(() => (me ? relativesOf(graph, me.id) : []), [graph, me]);
  const relToMe = useMemo(() => new Map(relatives.map((r) => [r.person.id, r.kin.label])), [relatives]);

  const tags = useMemo(() => [...new Set(people.flatMap((p) => p.tags))].sort(), [people]);
  // "In contacts": people in the tree who are also in your contacts (loaded on the first tap).
  const gc = useGoogleContacts();
  const matches = useContactMatches();
  const contactsOffered = gc.status === 'ready' || googleContactsAvailable() || isNativeApp();

  const list = useMemo(() => {
    let l = people.filter((p) => matchesQuery(p, q));
    if (filter === 'contacts') l = l.filter((p) => matches.has(p.id));
    else if (filter?.startsWith('tag:')) l = l.filter((p) => p.tags.includes(filter.slice(4)));
    if (sort === 'name') l.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    else l.sort((a, b) => b.updatedAt - a.updatedAt);
    return l;
  }, [people, q, filter, sort, relToMe, matches]);

  const birthdays = useMemo(
    () => people.map((p) => ({ p, d: daysUntilBirthday(p) })).filter((x) => x.d !== undefined && x.d <= 14).sort((a, b) => a.d! - b.d!),
    [people],
  );

  const subtitle = (p: Person) => {
    if (p.isMe) return 'You';
    const rel = relToMe.get(p.id);
    const extra = p.occupation || p.work[0]?.organization || formatPlace(p.address, true);
    return [rel, extra].filter(Boolean).join(' · ') || p.phones[0]?.value || '';
  };

  if (!loaded) return null;

  if (!people.length) {
    return (
      <div className="pt-6">
        <Header count={0} />
        <SpaceSwitcher className="mb-4 md:hidden" />
        <div className="card">
          {isShared ? (
            <Empty icon={<Users size={26} />} title="No one here yet">
              The family shared with you is empty so far. People appear here as soon as the owner adds them.
            </Empty>
          ) : <Empty icon={<Users size={26} />} title="Start with the people you know"
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <button className="btn-primary" onClick={() => nav('/people/new?me=1')}><UserPlus size={18} /> Add yourself first</button>
                {isOwner && <button className="btn-ghost" onClick={() => loadDemo()}><FlaskConical size={18} /> Try a sample family</button>}
              </div>
            }>
            Add yourself, then your parents, partner, children and the rest of your family.
          </Empty>}
        </div>
      </div>
    );
  }

  const pickContacts = () => { if (gc.status !== 'ready' && gc.status !== 'loading') void (isNativeApp() ? loadNativeContacts() : loadGoogleContacts()); };
  const chips: { key: Tab; label: string; icon?: ReactNode; onPick?: () => void }[] = [
    ...(me ? [
      { key: 'relatives' as Tab, label: `Relatives (${relatives.length})`, icon: <List size={15} /> },
      { key: 'lines' as Tab, label: 'Lines', icon: <ArrowDown size={15} /> },
    ] : []),
    ...(contactsOffered ? [{ key: 'contacts' as Tab, label: gc.status === 'ready' ? `In contacts (${matches.size})` : 'In contacts', icon: <Contact size={15} />, onPick: pickContacts }] : []),
    ...tags.map((t) => ({ key: `tag:${t}` as Tab, label: '#' + t })),
  ];
  // A view (Relatives, Lines) stays picked when tapped again; a filter toggles back to the start.
  const pick = (c: (typeof chips)[number]) => {
    if (tab === c.key) { if (filter) setTab(null); return; }
    setTab(c.key);
    c.onPick?.();
  };

  // What shows under the bar: search results across everyone, a filtered list, or a view.
  const showList = !!q || !!filter || !me;
  const groups: [string, Person[]][] = [];
  if (sort === 'name' && !q) {
    for (const p of list) {
      const letter = /[a-z]/i.test(fullName(p)[0]) ? fullName(p)[0].toUpperCase() : '#';
      const last = groups[groups.length - 1];
      if (last && last[0] === letter) last[1].push(p);
      else groups.push([letter, [p]]);
    }
  } else groups.push(['', list]);

  return (
    <div>
      <Header count={people.length} />
      <SpaceSwitcher className="mb-4 md:hidden" />

      {!me && !isShared && (
        <Link to="/family" className="mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800">
          <UserPlus size={20} className="shrink-0" />
          <span><b>Show which one is you</b> so Lineage can show how everyone is related to you.</span>
        </Link>
      )}

      {birthdays.length > 0 && !q && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {birthdays.map(({ p, d }) => (
            <Link key={p.id} to={`/people/${p.id}`} className="card flex shrink-0 items-center gap-2.5 py-2 pl-2 pr-4">
              <Avatar person={p} size={34} />
              <div className="leading-tight">
                <div className="text-sm font-medium">{p.nickname || p.firstName}</div>
                <div className="flex items-center gap-1 text-xs text-amber-600"><Cake size={12} /> {d === 0 ? 'Today!' : d === 1 ? 'Tomorrow' : `in ${d} days`}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="sticky top-safe z-10 -mx-4 mb-3 bg-stone-50/90 px-4 pb-3 pt-1 backdrop-blur dark:bg-stone-950/90 sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className="input bg-white pl-10 pr-10 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" placeholder="Search names, places, college, looks, anything…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}
        </div>
        <div className="no-scrollbar -mx-1 mt-2 flex items-center gap-2 overflow-x-auto px-1 py-1" role="toolbar" aria-label="Views and filters">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => pick(c)} aria-pressed={tab === c.key}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === c.key ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-700'}`}>
              {c.icon}{c.label}
            </button>
          ))}
          {showList && (
            <select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'recent')} aria-label="Sort"
              className="ml-auto shrink-0 rounded-full border-0 bg-transparent py-1.5 pl-2 pr-7 text-sm text-stone-500 focus:ring-0">
              <option value="name">A–Z</option>
              <option value="recent">Recent</option>
            </select>
          )}
        </div>
      </div>

      {!showList && me && tab === 'relatives' && (
        <div className="card mb-4 p-1.5" aria-label="You">
          <PersonRow person={me} to={`/people/${me.id}`} subtitle={isShared ? 'In this family' : 'You'} />
        </div>
      )}
      {!showList && me && tab === 'relatives' && (
        <RelativesList relatives={relatives} egoId={me.id} egoName={isShared ? me.firstName : 'you'} query=""
          onShowInTree={(id) => nav(`/family?focus=${encodeURIComponent(id)}&hl=${encodeURIComponent(id)}`)} />
      )}
      {!showList && me && tab === 'lines' && <><FamilyStats ego={me} relatives={relatives} /><Lines ego={me} /></>}

      {showList && (filter === 'contacts' && gc.status !== 'ready' ? (
        <div className="card flex items-center gap-3 p-4 text-sm text-stone-600 dark:text-stone-300">
          <Contact size={19} className="shrink-0 text-sky-600" />
          {gc.status === 'loading' ? 'Looking through your contacts…' : gc.error || 'Tap “In contacts” to look through your contacts. Nothing is saved.'}
        </div>
      ) : list.length === 0 && filter === 'contacts' ? (
        <div className="card"><Empty icon={<Contact size={24} />} title="No one found">No one in your tree is in your contacts yet.</Empty></div>
      ) : list.length === 0 ? (
        <div className="card"><Empty icon={<Search size={24} />} title="No one matches">{q ? 'Try a different word — search looks through every detail you’ve saved.' : 'No one here right now.'}</Empty></div>
      ) : (
        <div className="space-y-4">
          {groups.map(([letter, ps]) => (
            <div key={letter || 'all'}>
              {letter && <div className="section-title mb-1 ml-2">{letter}</div>}
              <div className="card p-1.5">
                {ps.map((p) => <PersonRow key={p.id} person={p} to={`/people/${p.id}`} subtitle={subtitle(p)} />)}
              </div>
            </div>
          ))}
        </div>
      ))}

    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Family</h1>
        <p className="text-sm text-stone-500">{count ? `${count} ${count === 1 ? 'person' : 'people'} in your family` : 'Everyone you want to remember'}</p>
      </div>
    </div>
  );
}
