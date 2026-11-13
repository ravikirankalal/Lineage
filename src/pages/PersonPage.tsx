import {
  ArrowLeft, Briefcase, Cake, GitBranch, GraduationCap, Home, Mail, MapPin, MessageCircle, Pencil, Phone, Plus,
  Sparkles, Trash2, Users, X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddRelationSheet } from '../components/AddRelationSheet';
import { Avatar } from '../components/Avatar';
import { PersonRow } from '../components/PersonRow';
import { Sheet } from '../components/Sheet';
import { connectionsOf, type ConnectionGroup } from '../lib/connections';
import { deletePerson, deleteRelationship } from '../lib/db';
import { useData } from '../lib/data';
import { kinship } from '../lib/kinship';
import { age, displayName, formatPartialDate, formatPlace, missingDetails } from '../lib/person';
import { SOCIAL_LABELS, isFamilyType, type SocialType } from '../lib/types';

export function PersonPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { byId, people, rels, graph, me, loaded } = useData();
  const p = id ? byId.get(id) : undefined;
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const groups = useMemo(() => (p ? connectionsOf(p.id, people, rels, graph) : []), [p, people, rels, graph]);
  const toMe = useMemo(() => {
    if (!p || !me || p.id === me.id) return undefined;
    const k = kinship(graph, me.id, p.id);
    if (k) return { label: k.label, path: k.path !== k.label ? k.path : undefined };
    const r = rels.find((x) => !isFamilyType(x.type) && ((x.fromId === me.id && x.toId === p.id) || (x.toId === me.id && x.fromId === p.id)));
    return r ? { label: 'Your ' + SOCIAL_LABELS[r.type as SocialType].toLowerCase(), path: undefined } : undefined;
  }, [p, me, graph, rels]);

  if (!loaded) return null;
  if (!p) return <p className="p-6 text-stone-500">This person doesn’t exist anymore. <Link className="text-brand-600" to="/">Back to people</Link></p>;

  const a = age(p);
  const missing = missingDetails(p);
  const phone = p.phones[0]?.value;
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex items-center justify-between">
        <button className="icon-btn -ml-2" onClick={() => nav(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
        <Link to={`/people/${p.id}/edit`} className="btn-ghost"><Pencil size={16} /> Edit</Link>
      </div>

      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <Avatar person={p} size={104} className="shadow-card ring-4 ring-white dark:ring-stone-900" />
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{displayName(p)}</h1>
        {p.nickname && <div className="text-stone-500">“{p.nickname}”</div>}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          {p.isMe && <span className="chip !bg-brand-100 !text-brand-800 dark:!bg-brand-900/60 dark:!text-brand-200">You</span>}
          {toMe && <span className="chip !bg-brand-100 !text-brand-800 dark:!bg-brand-900/60 dark:!text-brand-200" title={toMe.path}>{toMe.label}</span>}
          {a !== undefined && <span className="chip">{p.deceased ? `Lived ${a} years` : `${a} years`}</span>}
          {p.deceased && !a && <span className="chip">Passed away</span>}
          {p.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
        </div>
        {toMe?.path && <div className="mt-1 text-sm text-stone-500">{toMe.path}</div>}

        <div className="mt-5 flex gap-2">
          {phone && <a href={`tel:${phone}`} className="btn-secondary"><Phone size={16} /> Call</a>}
          {phone && <a href={`sms:${phone}`} className="btn-secondary"><MessageCircle size={16} /> Text</a>}
          <Link to={`/people/${p.id}/tree`} className="btn-secondary"><GitBranch size={16} /> Family tree</Link>
        </div>
      </div>

      {missing.length > 0 && !p.isMe && (
        <Link to={`/people/${p.id}/edit`} className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40">
          <Sparkles size={18} className="mt-0.5 shrink-0" />
          <span>Help future you: add {missing.slice(0, 3).join(', ')}.</span>
        </Link>
      )}

      <Details p={p} />

      {/* Connections */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Connections {total > 0 && <span className="text-stone-400">· {total}</span>}</h2>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={17} /> Add</button>
      </div>
      {groups.length === 0 ? (
        <button onClick={() => setAdding(true)} className="card mt-3 flex w-full flex-col items-center px-6 py-10 text-center hover:bg-stone-50 dark:hover:bg-stone-800/60">
          <Users className="mb-2 text-stone-400" />
          <div className="font-medium">No connections yet</div>
          <div className="text-sm text-stone-500">Add family, friends or colleagues — people in the same city, home town or college appear automatically.</div>
        </button>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((g) => <Group key={g.key} group={g} personName={p.firstName} />)}
        </div>
      )}

      <div className="mt-10 flex justify-center">
        <button className="btn-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete {p.firstName}</button>
      </div>

      <AddRelationSheet person={p} open={adding} onClose={() => setAdding(false)} />
      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${p.firstName}?`}
        footer={<div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn bg-red-600 text-white hover:bg-red-700" onClick={async () => { await deletePerson(p.id); nav('/', { replace: true }); }}>Delete</button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">This removes {displayName(p)} and all of their relationships. It can’t be undone (unless you have a backup).</p>
      </Sheet>
    </div>
  );
}

function Group({ group, personName }: { group: ConnectionGroup; personName: string }) {
  const [all, setAll] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const LIMIT = 8;
  const items = all ? group.items : group.items.slice(0, LIMIT);
  const implicit = !group.items.some((i) => i.relId) && ['area', 'city', 'origin', 'school', 'work'].includes(group.key);
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <h3 className="section-title">{group.title}</h3>
        <span className="text-xs text-stone-400">{group.items.length}</span>
        {implicit && group.hint && <span className="truncate text-xs text-stone-400">· {group.hint}</span>}
      </div>
      <div className="card p-1.5">
        {items.map((it) => (
          <div key={it.person.id} className="group/row flex items-center">
            <div className="min-w-0 flex-1">
              <PersonRow person={it.person} to={`/people/${it.person.id}`}
                subtitle={<>
                  <span className={implicit ? '' : 'font-medium text-brand-700 dark:text-brand-300'}>{it.label}</span>
                  {it.side && <span className="text-stone-400"> · {it.side}</span>}
                  {it.detail && <span className="text-stone-400"> · {it.detail}</span>}
                </>}
                right={<span />} />
            </div>
            {it.relId && (
              removing === it.relId ? (
                <div className="flex shrink-0 items-center gap-1 pr-1">
                  <button className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white" onClick={() => deleteRelationship(it.relId!)}>Unlink</button>
                  <button className="icon-btn h-8 w-8" onClick={() => setRemoving(null)} aria-label="Cancel"><X size={15} /></button>
                </div>
              ) : (
                <button className="icon-btn h-8 w-8 shrink-0 text-stone-300 opacity-60 hover:text-red-600 group-hover/row:opacity-100" title={`Remove link with ${personName}`}
                  onClick={() => setRemoving(it.relId!)} aria-label="Remove link"><X size={15} /></button>
              )
            )}
          </div>
        ))}
        {group.items.length > LIMIT && (
          <button className="w-full rounded-xl py-2 text-sm font-medium text-brand-600 hover:bg-stone-50 dark:hover:bg-stone-800" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `Show all ${group.items.length}`}
          </button>
        )}
      </div>
    </section>
  );
}

function Details({ p }: { p: ReturnType<typeof useData>['people'][number] }) {
  const rows: { icon: ReactNode; label: string; value: ReactNode }[] = [];
  if (p.appearance) rows.push({ icon: <Sparkles size={17} />, label: 'Looks', value: p.appearance });
  if (p.howWeMet) rows.push({ icon: <Users size={17} />, label: 'How you know them', value: p.howWeMet + (p.metOn ? ` (${p.metOn})` : '') });
  if (p.birthDate || p.deathDate) {
    rows.push({ icon: <Cake size={17} />, label: p.deathDate ? 'Life' : 'Birthday', value: [p.birthDate && 'Born ' + formatPartialDate(p.birthDate), p.deathDate && 'Died ' + formatPartialDate(p.deathDate)].filter(Boolean).join(' · ') });
  }
  if (formatPlace(p.origin)) rows.push({ icon: <MapPin size={17} />, label: 'From', value: formatPlace(p.origin) });
  if (formatPlace(p.address)) rows.push({ icon: <Home size={17} />, label: 'Lives in', value: formatPlace(p.address) });
  if (p.occupation) rows.push({ icon: <Briefcase size={17} />, label: 'Does', value: p.occupation });
  for (const w of p.work) rows.push({ icon: <Briefcase size={17} />, label: 'Work', value: [w.role, w.organization].filter(Boolean).join(' at ') + (w.from || w.to ? ` · ${[w.from, w.to].filter(Boolean).join('–')}` : '') });
  for (const e of p.education) rows.push({ icon: <GraduationCap size={17} />, label: 'Studied', value: [e.course, e.institution].filter(Boolean).join(', ') + (e.from || e.to ? ` · ${[e.from, e.to].filter(Boolean).join('–')}` : '') });
  for (const ph of p.phones) rows.push({ icon: <Phone size={17} />, label: ph.label || 'Phone', value: <a className="text-brand-700 dark:text-brand-300" href={`tel:${ph.value}`}>{ph.value}</a> });
  for (const em of p.emails) rows.push({ icon: <Mail size={17} />, label: em.label || 'Email', value: <a className="text-brand-700 dark:text-brand-300" href={`mailto:${em.value}`}>{em.value}</a> });
  if (p.otherNames) rows.push({ icon: <Users size={17} />, label: 'Also known as', value: p.otherNames });
  for (const f of p.facts) rows.push({ icon: <Sparkles size={17} />, label: f.label || 'Detail', value: f.value });

  if (!rows.length && !p.notes) return null;
  return (
    <div className="card mt-6 divide-y divide-stone-100 dark:divide-stone-800">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <div className="mt-0.5 text-stone-400">{r.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{r.label}</div>
            <div className="whitespace-pre-wrap break-words text-[15px]">{r.value}</div>
          </div>
        </div>
      ))}
      {p.notes && (
        <div className="px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-stone-400">Notes</div>
          <div className="whitespace-pre-wrap text-[15px]">{p.notes}</div>
        </div>
      )}
    </div>
  );
}
