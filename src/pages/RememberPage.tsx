import { Brain, Cake, Eye, RotateCcw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Empty } from '../components/Empty';
import { PersonRow } from '../components/PersonRow';
import { useData } from '../lib/data';
import { kinship } from '../lib/kinship';
import { completeness, daysUntilBirthday, displayName, formatPartialDate, formatPlace, missingDetails } from '../lib/person';
import type { Person } from '../lib/types';

function cues(p: Person): { label: string; value: string }[] {
  const c: { label: string; value: string }[] = [];
  if (p.appearance) c.push({ label: 'Looks', value: p.appearance });
  if (p.howWeMet) c.push({ label: 'You know them from', value: p.howWeMet });
  if (formatPlace(p.origin, true)) c.push({ label: 'From', value: formatPlace(p.origin, true) });
  if (formatPlace(p.address, true)) c.push({ label: 'Lives in', value: formatPlace(p.address, true) });
  if (p.occupation || p.work[0]) c.push({ label: 'Work', value: p.occupation || [p.work[0].role, p.work[0].organization].filter(Boolean).join(' at ') });
  if (p.education[0]) c.push({ label: 'Studied at', value: p.education[0].institution });
  if (p.facts[0]) c.push({ label: p.facts[0].label, value: p.facts[0].value });
  return c;
}

export function RememberPage() {
  const { people, me, graph, loaded } = useData();
  const pool = useMemo(() => people.filter((p) => !p.isMe && (p.photo || cues(p).length >= 2)), [people]);
  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ knew: 0, forgot: 0 });

  const thin = useMemo(() => people.filter((p) => !p.isMe).map((p) => ({ p, c: completeness(p) })).filter((x) => x.c < 60).sort((a, b) => a.c - b.c).slice(0, 12), [people]);
  const birthdays = useMemo(() => people.map((p) => ({ p, d: daysUntilBirthday(p) })).filter((x) => x.d !== undefined && x.d <= 60).sort((a, b) => a.d! - b.d!), [people]);

  if (!loaded) return null;

  const start = () => {
    const ids = pool.map((p) => p.id).sort(() => Math.random() - 0.5);
    setOrder(ids);
    setIdx(0);
    setRevealed(false);
    setScore({ knew: 0, forgot: 0 });
  };
  const current = order.length && idx < order.length ? people.find((p) => p.id === order[idx]) : undefined;
  const next = (knew: boolean) => {
    setScore((s) => (knew ? { ...s, knew: s.knew + 1 } : { ...s, forgot: s.forgot + 1 }));
    setRevealed(false);
    setIdx((i) => i + 1);
  };
  const finished = order.length > 0 && idx >= order.length;
  const kin = current && me ? kinship(graph, me.id, current.id) : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Remember</h1>
        <p className="text-sm text-stone-500">Practise recalling people, and fill in what you’d otherwise forget.</p>
      </div>

      {/* Recall practice */}
      <section className="card overflow-hidden">
        {!order.length || finished ? (
          <Empty icon={<Brain size={26} />} title={finished ? `Done! You remembered ${score.knew} of ${score.knew + score.forgot}` : 'Who’s who?'}
            action={pool.length ? <button className="btn-primary" onClick={start}>{finished ? <><RotateCcw size={17} /> Go again</> : 'Start practice'}</button> : undefined}>
            {pool.length
              ? `See a face or a few clues, try to recall the name, then check. ${pool.length} people have enough details to practise.`
              : 'Add a photo or a couple of details (looks, how you met, where they’re from) to people to practise recalling them.'}
          </Empty>
        ) : current ? (
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between text-xs text-stone-400">
              <span>{idx + 1} / {order.length}</span>
              <span>✓ {score.knew} · ✗ {score.forgot}</span>
            </div>
            <div className="flex flex-col items-center text-center">
              {current.photo ? <img src={current.photo} alt="" className="h-36 w-36 rounded-3xl object-cover shadow-card" />
                : <div className="flex h-36 w-36 items-center justify-center rounded-3xl bg-stone-100 text-5xl text-stone-300 dark:bg-stone-800">?</div>}
              <div className="mt-4 w-full space-y-2 text-left">
                {cues(current).map((c, i) => (
                  <div key={i} className="rounded-xl bg-stone-50 px-3.5 py-2.5 dark:bg-stone-800/60">
                    <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{c.label}</div>
                    <div className="text-[15px]">{c.value}</div>
                  </div>
                ))}
              </div>
              {revealed ? (
                <div className="mt-5 w-full">
                  <Link to={`/people/${current.id}`} className="text-2xl font-bold tracking-tight hover:underline">{displayName(current)}</Link>
                  {current.nickname && <div className="text-stone-500">“{current.nickname}”</div>}
                  {kin && <div className="mt-1 text-sm text-brand-700 dark:text-brand-300">{kin.label}{kin.path !== kin.label && ` · ${kin.path}`}</div>}
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button className="btn-secondary" onClick={() => next(false)}><ThumbsDown size={17} /> Forgot</button>
                    <button className="btn-primary" onClick={() => next(true)}><ThumbsUp size={17} /> Knew it</button>
                  </div>
                </div>
              ) : (
                <button className="btn-primary mt-5 w-full py-3" onClick={() => setRevealed(true)}><Eye size={18} /> Show who it is</button>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* Birthdays */}
      {birthdays.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title mb-1.5 ml-1">Upcoming birthdays</h2>
          <div className="card p-1.5">
            {birthdays.map(({ p, d }) => (
              <PersonRow key={p.id} person={p} to={`/people/${p.id}`}
                subtitle={<span className="inline-flex items-center gap-1"><Cake size={13} className="text-amber-500" /> {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`} · {formatPartialDate(p.birthDate)}</span>} />
            ))}
          </div>
        </section>
      )}

      {/* Thin profiles */}
      <section className="mt-6">
        <h2 className="section-title mb-1.5 ml-1">Add details while you still remember</h2>
        {thin.length === 0 ? (
          <p className="card px-5 py-6 text-center text-sm text-stone-500">Everyone has good details. Nice work!</p>
        ) : (
          <div className="card p-1.5">
            {thin.map(({ p, c }) => (
              <Link key={p.id} to={`/people/${p.id}/edit`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-stone-100 dark:hover:bg-stone-800/70">
                <Avatar person={p} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{displayName(p)}</div>
                  <div className="truncate text-sm text-stone-500"><Sparkles size={12} className="mr-1 inline text-amber-500" />Add {missingDetails(p).slice(0, 2).join(', ')}</div>
                </div>
                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${c}%` }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
