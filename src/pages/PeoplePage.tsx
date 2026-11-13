import { Cake, Download, FlaskConical, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { PersonRow } from '../components/PersonRow';
import { useData } from '../lib/data';
import { loadDemo } from '../lib/demo';
import { relativesOf } from '../lib/kinship';
import { daysUntilBirthday, formatPlace, fullName, matchesQuery, missingDetails } from '../lib/person';
import { SOCIAL_LABELS, isFamilyType, type Person, type SocialType } from '../lib/types';

type Filter = 'all' | 'family' | 'friends' | 'thin' | `tag:${string}`;

export function PeoplePage() {
  const { people, rels, graph, me, loaded } = useData();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'name' | 'recent'>('name');

  // How each person relates to me — shown as the subtitle.
  const relToMe = useMemo(() => {
    const m = new Map<string, string>();
    if (!me) return m;
    for (const r of relativesOf(graph, me.id)) m.set(r.person.id, r.kin.label);
    for (const r of rels) {
      if (isFamilyType(r.type)) continue;
      const other = r.fromId === me.id ? r.toId : r.toId === me.id ? r.fromId : undefined;
      if (other && !m.has(other)) m.set(other, SOCIAL_LABELS[r.type as SocialType]);
    }
    return m;
  }, [graph, rels, me]);

  const friendIds = useMemo(() => {
    const s = new Set<string>();
    if (!me) return s;
    for (const r of rels) if (!isFamilyType(r.type) && (r.fromId === me.id || r.toId === me.id)) s.add(r.fromId === me.id ? r.toId : r.fromId);
    return s;
  }, [rels, me]);

  const tags = useMemo(() => [...new Set(people.flatMap((p) => p.tags))].sort(), [people]);

  const list = useMemo(() => {
    let l = people.filter((p) => matchesQuery(p, q));
    if (filter === 'family') l = l.filter((p) => p.isMe || (relToMe.has(p.id) && !friendIds.has(p.id)));
    else if (filter === 'friends') l = l.filter((p) => friendIds.has(p.id));
    else if (filter === 'thin') l = l.filter((p) => !p.isMe && missingDetails(p).length >= 3);
    else if (filter.startsWith('tag:')) l = l.filter((p) => p.tags.includes(filter.slice(4)));
    if (sort === 'name') l.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    else l.sort((a, b) => b.updatedAt - a.updatedAt);
    return l;
  }, [people, q, filter, sort, relToMe, friendIds]);

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
        <div className="card">
          <Empty icon={<Users size={26} />} title="Start with the people you know"
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <button className="btn-primary" onClick={() => nav('/people/new?me=1')}><UserPlus size={18} /> Add yourself first</button>
                <Link to="/import" className="btn-secondary"><Download size={18} /> Import contacts</Link>
                <button className="btn-ghost" onClick={() => loadDemo()}><FlaskConical size={18} /> Try a sample family</button>
              </div>
            }>
            Add yourself, then your family and friends — or bring them in from your phone’s contacts. Everything stays on this device.
          </Empty>
        </div>
      </div>
    );
  }

  // Group alphabetically when sorting by name.
  const groups: [string, Person[]][] = [];
  if (sort === 'name' && !q) {
    for (const p of list) {
      const letter = /[a-z]/i.test(fullName(p)[0]) ? fullName(p)[0].toUpperCase() : '#';
      const last = groups[groups.length - 1];
      if (last && last[0] === letter) last[1].push(p);
      else groups.push([letter, [p]]);
    }
  } else groups.push(['', list]);

  const chip = (f: Filter, label: string) => (
    <button key={f} onClick={() => setFilter(filter === f ? 'all' : f)}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
        filter === f ? 'bg-stone-900 text-white dark:bg-white dark:text-stone-900' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-700'}`}>
      {label}
    </button>
  );

  return (
    <div>
      <Header count={people.length} />

      {!me && (
        <Link to="/people/new?me=1" className="mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800">
          <UserPlus size={20} className="shrink-0" />
          <span><b>Add yourself</b> so Lineage can show how everyone is related to you.</span>
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

      <div className="sticky top-0 z-10 -mx-4 bg-stone-50/90 px-4 pb-3 pt-1 backdrop-blur dark:bg-stone-950/90 sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input className="input bg-white pl-10 pr-10 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800" placeholder="Search names, places, college, looks, anything…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setQ('')} aria-label="Clear"><X size={16} /></button>}
        </div>
        <div className="no-scrollbar mt-3 flex items-center gap-2 overflow-x-auto">
          {chip('all', 'All')}
          {me && chip('family', 'Family')}
          {me && chip('friends', 'Friends & others')}
          {chip('thin', 'Needs details')}
          {tags.map((t) => chip(`tag:${t}`, '#' + t))}
          <select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'recent')}
            className="ml-auto shrink-0 rounded-full border-0 bg-transparent py-1.5 pl-2 pr-7 text-sm text-stone-500 focus:ring-0">
            <option value="name">A–Z</option>
            <option value="recent">Recent</option>
          </select>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card"><Empty icon={<Search size={24} />} title="No one matches">Try a different word — search looks through every detail you’ve saved.</Empty></div>
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
      )}

      <Link to="/people/new" aria-label="Add person"
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-900/20 transition hover:bg-brand-700 active:scale-95 md:bottom-8 md:right-8">
        <Plus size={26} />
      </Link>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">People</h1>
        <p className="text-sm text-stone-500">{count ? `${count} ${count === 1 ? 'person' : 'people'} in your life` : 'Everyone you want to remember'}</p>
      </div>
    </div>
  );
}
