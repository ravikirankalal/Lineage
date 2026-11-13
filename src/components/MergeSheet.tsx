import { ArrowLeft, Check, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { phoneKey } from '../lib/contacts';
import { useData } from '../lib/data';
import { mergePeople, previewMerge, type MergePreview } from '../lib/db';
import { displayName, formatPlace, fullName, lifespan, matchesQuery, norm } from '../lib/person';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';
import { PersonRow } from './PersonRow';
import { Sheet } from './Sheet';

// ---------------------------------------------------------------------------------------------
// Duplicate suggestions. Pure and UI-free; belongs in src/lib (next to findDuplicate in
// contacts.ts) once that file is free to edit.

export interface DuplicateSuggestion {
  person: Person;
  reason: string;
  score: number;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const phoneKeys = (p: Person) => p.phones.map((x) => phoneKey(x.value)).filter((k) => k.length >= 6);

/** Names this person might be known by: first name, nickname and each "also known as" entry. */
function nameKeys(p: Person): string[] {
  return [p.firstName, p.nickname, ...(p.otherNames ?? '').split(/[,;/]/)].map(norm).filter(Boolean);
}

/** People who are probably the same person as `p`: shared phone, similar full name, or same first name. */
export function likelyDuplicates(p: Person, people: Person[], limit = 6): DuplicateSuggestion[] {
  const myPhones = new Set(phoneKeys(p));
  const myFull = norm(fullName(p));
  const myNames = new Set(nameKeys(p));
  const out: DuplicateSuggestion[] = [];
  for (const o of people) {
    if (o.id === p.id) continue;
    if (myPhones.size && phoneKeys(o).some((k) => myPhones.has(k))) {
      out.push({ person: o, reason: 'Same phone number', score: 3 });
      continue;
    }
    const full = norm(fullName(o));
    const d = editDistance(myFull, full);
    if (full === myFull || (Math.min(full.length, myFull.length) >= 5 && d <= Math.max(1, Math.floor(Math.max(full.length, myFull.length) * 0.2)))) {
      out.push({ person: o, reason: full === myFull ? 'Same name' : 'Similar name', score: 2 + (d === 0 ? 0.5 : 0) });
      continue;
    }
    if (nameKeys(o).some((n) => myNames.has(n))) out.push({ person: o, reason: 'Same first name', score: 1 });
  }
  return out.sort((a, b) => b.score - a.score || a.person.firstName.localeCompare(b.person.firstName)).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function previewSummary(m: MergePreview): string {
  const parts: string[] = [];
  if (m.relationshipsMoved) parts.push(`${plural(m.relationshipsMoved, 'relationship', 'relationships')} will move`);
  if (m.duplicatesDropped) parts.push(`${plural(m.duplicatesDropped, 'duplicate link', 'duplicate links')} removed`);
  return parts.length ? parts.join(', ') + '.' : 'No relationships need to move.';
}

/** Find another record of the same person and fold it into `person` (which is kept). */
export function MergeSheet({ person, open, onClose }: { person: Person; open: boolean; onClose: () => void }) {
  const { people, byId } = useData();
  const [q, setQ] = useState('');
  const [otherId, setOtherId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const other = otherId ? byId.get(otherId) : undefined;

  const suggestions = useMemo(() => (open ? likelyDuplicates(person, people) : []), [open, person, people]);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return people.filter((x) => x.id !== person.id && matchesQuery(x, q)).sort((a, b) => a.firstName.localeCompare(b.firstName)).slice(0, 40);
  }, [q, people, person.id]);

  useEffect(() => {
    if (!open || !otherId) return;
    let live = true;
    setPreview(null);
    setError('');
    previewMerge(person.id, otherId).then(
      (m) => { if (live) setPreview(m); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [open, person.id, otherId]);

  function close() {
    setQ('');
    setOtherId(null);
    setPreview(null);
    setError('');
    setBusy(false);
    onClose();
  }

  function back() {
    setOtherId(null);
    setPreview(null);
    setError('');
  }

  async function merge() {
    if (!other) return;
    setBusy(true);
    setError('');
    try {
      await mergePeople(person.id, other.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const name = displayName(person);

  if (other) {
    return (
      <Sheet open={open} onClose={close} title="Check before merging"
        footer={<div className="flex items-center justify-between gap-2">
          <button className="btn-ghost" onClick={back} disabled={busy}><ArrowLeft size={16} /> Back</button>
          <button className="btn-primary min-w-0" onClick={merge} disabled={busy || !preview}>
            <Check size={16} className="shrink-0" /> <span className="truncate">{busy ? 'Merging…' : `Merge into ${name}`}</span>
          </button>
        </div>}>
        <p className="text-sm text-stone-600 dark:text-stone-300">
          <b>This profile</b> (left) stays. Details and relationships from the copy on the right are added to it, then the copy is removed.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Side person={person} kept />
          <Side person={other} />
        </div>

        <div className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          {preview ? previewSummary(preview) : error ? 'These two can’t be merged.' : 'Checking relationships…'}
        </div>

        {preview && preview.conflicts.length > 0 && (
          <div className="mt-3 flex gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40">
            <TriangleAlert size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">These differ — {name}’s value is kept:</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {preview.conflicts.map((c, i) => <li key={i} className="break-words">{c}</li>)}
              </ul>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title="Merge a duplicate"
      footer={<div className="flex justify-end"><button className="btn-ghost" onClick={close}>Cancel</button></div>}>
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Saved the same person twice? Pick the other copy. It will be combined into <b>{name}</b>, and this profile is the one that stays.
      </p>
      <div className="relative mt-4">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input className="input pl-9" placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      </div>

      {q.trim() ? (
        <div className="mt-3">
          {results.length ? results.map((x) => (
            <PersonRow key={x.id} person={x} onClick={() => setOtherId(x.id)} subtitle={details(x)[0]} />
          )) : <p className="py-6 text-center text-sm text-stone-500">No one matches “{q.trim()}”.</p>}
        </div>
      ) : suggestions.length ? (
        <div className="mt-4">
          <h3 className="section-title mb-1">Possible duplicates</h3>
          {suggestions.map((s) => (
            <PersonRow key={s.person.id} person={s.person} onClick={() => setOtherId(s.person.id)}
              subtitle={<><span className="font-medium text-amber-700 dark:text-amber-300">{s.reason}</span>{details(s.person)[0] && <span className="text-stone-400"> · {details(s.person)[0]}</span>}</>} />
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-stone-500">No obvious duplicates. Search for the other copy above.</p>
      )}
    </Sheet>
  );
}

/** Short facts that help tell two records apart. */
function details(p: Person): string[] {
  return [
    lifespan(p),
    p.phones[0]?.value,
    formatPlace(p.address, true) && 'Lives in ' + formatPlace(p.address, true),
    formatPlace(p.origin, true) && 'From ' + formatPlace(p.origin, true),
    p.occupation,
  ].filter((x): x is string => !!x);
}

function Side({ person, kept }: { person: Person; kept?: boolean }) {
  const facts = details(person).slice(0, 3);
  return (
    <div className={`flex min-w-0 flex-col items-center rounded-2xl p-3 text-center ring-1 ${kept
      ? 'bg-brand-50 ring-brand-200 dark:bg-brand-900/30 dark:ring-brand-800'
      : 'bg-stone-50 ring-stone-200 dark:bg-stone-800/60 dark:ring-stone-700'}`}>
      <span className={`chip mb-2 ${kept ? '!bg-brand-600 !text-white' : ''}`}>{kept ? 'Kept' : 'Merged in'}</span>
      <Avatar person={person} size={56} />
      <div className="mt-2 w-full truncate font-semibold" title={displayName(person)}>{displayName(person)}</div>
      {person.nickname && <div className="w-full truncate text-xs text-stone-500">“{person.nickname}”</div>}
      <div className="mt-1 w-full space-y-0.5 text-xs text-stone-500 dark:text-stone-400">
        {facts.length ? facts.map((f, i) => <div key={i} className="truncate" title={f}>{f}</div>) : <div className="italic">No other details</div>}
      </div>
    </div>
  );
}
