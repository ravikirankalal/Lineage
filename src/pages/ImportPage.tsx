import { Check, ChevronDown, FileUp, Smartphone } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { contactPickerSupported, findDuplicate, mergeInto, parseContactsFile, pickContacts } from '../lib/contacts';
import { db } from '../lib/db';
import { useData } from '../lib/data';
import { displayName } from '../lib/person';
import type { Person } from '../lib/types';

interface Candidate {
  person: Person;
  match?: Person;
  selected: boolean;
}

export function ImportPage() {
  const { people } = useData();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ added: number; updated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const picker = contactPickerSupported();

  const prepare = (list: Person[]) => {
    setDone(null);
    if (!list.length) {
      setError('No contacts found in that file.');
      return;
    }
    setError('');
    setCands(list.map((p) => {
      const match = findDuplicate(p, people);
      return { person: p, match, selected: true };
    }));
  };

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const all: Person[] = [];
    for (const f of Array.from(files)) all.push(...parseContactsFile(f.name, await f.text()));
    prepare(all);
  }

  async function onPick() {
    try {
      prepare(await pickContacts());
    } catch (e) {
      setError((e as Error).message || 'Could not open contacts.');
    }
  }

  async function doImport() {
    if (!cands) return;
    setBusy(true);
    let added = 0;
    let updated = 0;
    const toPut: Person[] = [];
    const mergedById = new Map<string, Person>();
    for (const c of cands) {
      if (!c.selected) continue;
      if (c.match) {
        const base = mergedById.get(c.match.id) ?? c.match;
        mergedById.set(c.match.id, { ...mergeInto(base, c.person), updatedAt: Date.now() });
        updated++;
      } else {
        toPut.push(c.person);
        added++;
      }
    }
    await db.people.bulkPut([...toPut, ...mergedById.values()]);
    setBusy(false);
    setCands(null);
    setDone({ added, updated });
  }

  const selectedCount = cands?.filter((c) => c.selected).length ?? 0;
  const newCount = useMemo(() => cands?.filter((c) => !c.match).length ?? 0, [cands]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Import contacts</h1>
        <p className="text-sm text-stone-500">Bring people in from your phone, then add the details that help you remember them.</p>
      </div>

      {done && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800">
          <Check size={20} />
          <span className="flex-1">Added {done.added} new {done.added === 1 ? 'person' : 'people'}{done.updated ? `, filled in details for ${done.updated}` : ''}.</span>
          <Link to="/" className="font-semibold">View people →</Link>
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      {!cands ? (
        <div className="space-y-3">
          {picker && (
            <button onClick={onPick} className="card flex w-full items-center gap-4 p-5 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/60">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><Smartphone /></div>
              <div>
                <div className="font-semibold">Choose from this phone’s contacts</div>
                <div className="text-sm text-stone-500">Pick the people you want — nothing else is read.</div>
              </div>
            </button>
          )}
          <button onClick={() => fileRef.current?.click()} className="card flex w-full items-center gap-4 p-5 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/60">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><FileUp /></div>
            <div>
              <div className="font-semibold">Import a contacts file</div>
              <div className="text-sm text-stone-500">vCard (.vcf) or CSV from Android, iPhone, Google or Outlook.</div>
            </div>
          </button>
          <input ref={fileRef} type="file" accept=".vcf,.vcard,.csv,text/vcard,text/csv" multiple className="hidden"
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

          <div className="card divide-y divide-stone-100 dark:divide-stone-800">
            <HowTo title="Android">Open <b>Contacts</b> → menu → <b>Fix & manage</b> (or Settings) → <b>Export to file</b>. Save the .vcf and choose it above. Or in Chrome on Android, use “Choose from this phone’s contacts”.</HowTo>
            <HowTo title="iPhone">Open <b>Contacts</b> → <b>Lists</b> → long-press <b>All Contacts</b> → <b>Export</b>. Save the .vcf to Files and choose it above.</HowTo>
            <HowTo title="Google Contacts">On contacts.google.com click <b>Export</b> → <b>vCard</b> or <b>Google CSV</b>.</HowTo>
          </div>
          <p className="px-1 text-xs text-stone-400">Contacts are read on this device only. Duplicates are detected by phone number, email or name, and only fill in missing details — nothing you typed is overwritten.</p>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm text-stone-500">{cands.length} found · {newCount} new · {cands.length - newCount} already known</div>
            <div className="flex gap-1">
              <button className="btn-ghost px-3 py-1.5" onClick={() => setCands(cands.map((c) => ({ ...c, selected: true })))}>All</button>
              <button className="btn-ghost px-3 py-1.5" onClick={() => setCands(cands.map((c) => ({ ...c, selected: false })))}>None</button>
              <button className="btn-ghost px-3 py-1.5" onClick={() => setCands(cands.map((c) => ({ ...c, selected: !c.match })))}>Only new</button>
            </div>
          </div>
          <div className="card max-h-[60dvh] overflow-y-auto p-1.5">
            {cands.map((c, i) => (
              <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-stone-50 dark:hover:bg-stone-800">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={c.selected}
                  onChange={(e) => setCands(cands.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} />
                <Avatar person={c.person} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{displayName(c.person)}</div>
                  <div className="truncate text-sm text-stone-500">
                    {c.match ? <span className="text-amber-600">Matches {displayName(c.match)} — will fill gaps</span> : c.person.phones[0]?.value || c.person.emails[0]?.value}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setCands(null)}>Cancel</button>
            <button className="btn-primary" disabled={!selectedCount || busy} onClick={doImport}>Import {selectedCount}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function HowTo({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium" onClick={() => setOpen(!open)}>
        How to export from {title}
        <ChevronDown size={17} className={`text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="px-4 pb-4 text-sm text-stone-600 dark:text-stone-300">{children}</p>}
    </div>
  );
}
