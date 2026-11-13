import { Check, ChevronDown, Download, FileUp, GitFork, Smartphone } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { contactPickerSupported, mergeInto, parseContactsFile, pickContacts, planImport, type DuplicateMatch } from '../lib/contacts';
import { db } from '../lib/db';
import { useData } from '../lib/data';
import { decodeGedcom, exportGedcom, parseGedcom, type GedcomImport } from '../lib/gedcom';
import { displayName } from '../lib/person';
import type { Person } from '../lib/types';

interface Candidate {
  person: Person;
  match?: DuplicateMatch;
  selected: boolean;
}

const isGedcom = (name: string) => /\.ged(com)?$/i.test(name);

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-gedcom' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportPage() {
  const { people, rels, me, graph } = useData();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [ged, setGed] = useState<GedcomImport | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ added: number; updated: number; rels?: number } | null>(null);
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
    // Strong (phone/email) and possible (same name, nothing conflicting) matches are both pre-selected.
    setCands(planImport(list, people).map((c) => ({ ...c, selected: true })));
  };

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const geds = list.filter((f) => isGedcom(f.name));
    if (geds.length) {
      if (geds.length < list.length) {
        setError('Choose family tree (.ged) files and contacts files separately.');
        return;
      }
      await onGedcom(geds);
      return;
    }
    const all: Person[] = [];
    for (const f of list) all.push(...parseContactsFile(f.name, await f.text()));
    prepare(all);
  }

  async function onGedcom(files: File[]) {
    setDone(null);
    setCands(null);
    try {
      const merged: GedcomImport = { people: [], relationships: [], warnings: [] };
      for (const f of files) {
        const r = parseGedcom(decodeGedcom(await f.arrayBuffer()));
        merged.people.push(...r.people);
        merged.relationships.push(...r.relationships);
        merged.warnings.push(...r.warnings.map((w) => (files.length > 1 ? `${f.name}: ${w}` : w)));
      }
      if (!merged.people.length) {
        setError('No people found in that family tree file.');
        return;
      }
      setError('');
      setGed(merged);
    } catch (e) {
      setError(`Could not read that file: ${(e as Error).message || 'unknown error'}`);
    }
  }

  async function doGedImport() {
    if (!ged) return;
    setBusy(true);
    setError('');
    try {
      const now = Date.now();
      await db.transaction('rw', db.people, db.relationships, async () => {
        await db.people.bulkAdd(ged.people);
        await db.relationships.bulkAdd(ged.relationships.map((r) => ({ ...r, createdAt: now })));
      });
      setDone({ added: ged.people.length, updated: 0, rels: ged.relationships.length });
      setGed(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message || 'could not save the family tree.'} Nothing was added.`);
    } finally {
      setBusy(false);
    }
  }

  const familyCount = useMemo(() => (me ? graph.familyComponent(me.id).size : 0), [graph, me]);
  const stamp = () => new Date().toISOString().slice(0, 10);
  const exportFamily = () => me && downloadText(`lineage-family-${stamp()}.ged`, exportGedcom(people, rels, { familyOfId: me.id }));
  const exportAll = () => downloadText(`lineage-everyone-${stamp()}.ged`, exportGedcom(people, rels));

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
    setError('');
    try {
      let added = 0;
      let updated = 0;
      const toPut: Person[] = [];
      const mergedById = new Map<string, Person>();
      for (const c of cands) {
        if (!c.selected) continue;
        if (c.match) {
          const id = c.match.person.id;
          const base = mergedById.get(id) ?? c.match.person;
          mergedById.set(id, { ...mergeInto(base, c.person), updatedAt: Date.now() });
          updated++;
        } else {
          toPut.push(c.person);
          added++;
        }
      }
      await db.people.bulkPut([...toPut, ...mergedById.values()]);
      setCands(null);
      setDone({ added, updated });
    } catch (e) {
      setError(`Import failed: ${(e as Error).message || 'could not save contacts.'}`);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = cands?.filter((c) => c.selected).length ?? 0;
  const newCount = useMemo(() => cands?.filter((c) => !c.match).length ?? 0, [cands]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Import &amp; export</h1>
        <p className="text-sm text-stone-500">Bring people in from your phone or a family tree, then add the details that help you remember them.</p>
      </div>

      {done && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800">
          <Check size={20} />
          <span className="flex-1">Added {done.added} new {done.added === 1 ? 'person' : 'people'}{done.rels ? ` and ${done.rels} ${done.rels === 1 ? 'relationship' : 'relationships'}` : ''}{done.updated ? `, filled in details for ${done.updated}` : ''}.</span>
          <Link to="/" className="font-semibold">View people →</Link>
        </div>
      )}
      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      {ged ? (
        <div className="card p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><GitFork /></div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Family tree ready to import</div>
              <div className="text-sm text-stone-500">
                {ged.people.length} {ged.people.length === 1 ? 'person' : 'people'}, {ged.relationships.length} {ged.relationships.length === 1 ? 'relationship' : 'relationships'}, {ged.warnings.length} {ged.warnings.length === 1 ? 'warning' : 'warnings'} — will be added as new people
              </div>
            </div>
          </div>
          {ged.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 rounded-xl bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {ged.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-stone-400">Tip: you can merge any duplicates from a person’s page.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setGed(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={doGedImport}>Import {ged.people.length}</button>
          </div>
        </div>
      ) : !cands ? (
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
              <div className="font-semibold">Import a file</div>
              <div className="text-sm text-stone-500">Contacts as vCard (.vcf) or CSV from Android, iPhone, Google or Outlook, or a family tree (.ged).</div>
            </div>
          </button>
          <input ref={fileRef} type="file" accept=".vcf,.vcard,.csv,.ged,.gedcom,text/vcard,text/csv" multiple className="hidden"
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />

          <div className="card divide-y divide-stone-100 dark:divide-stone-800">
            <HowTo title="Android">Open <b>Contacts</b> → menu → <b>Fix & manage</b> (or Settings) → <b>Export to file</b>. Save the .vcf and choose it above. Or in Chrome on Android, use “Choose from this phone’s contacts”.</HowTo>
            <HowTo title="iPhone">Open <b>Contacts</b> → <b>Lists</b> → long-press <b>All Contacts</b> → <b>Export</b>. Save the .vcf to Files and choose it above.</HowTo>
            <HowTo title="Google Contacts">On contacts.google.com click <b>Export</b> → <b>vCard</b> or <b>Google CSV</b>.</HowTo>
            <HowTo title="a family tree site">Ancestry, FamilySearch, MyHeritage and Gramps can all export your tree as a <b>GEDCOM (.ged)</b> file — look for <b>Export tree</b> or <b>Export GEDCOM</b>. Everyone in it is added as a new person.</HowTo>
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
                    {c.match ? <span className="text-amber-600">{c.match.strength === 'strong' ? 'Matches' : 'Possibly'} {displayName(c.match.person)} — will fill gaps</span> : c.person.phones[0]?.value || c.person.emails[0]?.value}
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

      <section className="mt-8">
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Export</h2>
        <div className="card divide-y divide-stone-100 dark:divide-stone-800">
          <button onClick={exportFamily} disabled={!me} className="flex w-full items-center gap-4 p-4 text-left transition enabled:hover:bg-stone-50 disabled:opacity-60 dark:enabled:hover:bg-stone-800/60">
            <Download size={19} className="shrink-0 text-brand-600 dark:text-brand-300" />
            <div>
              <div className="font-medium">Download my family tree (.ged)</div>
              <div className="text-sm text-stone-500">
                {me ? `${familyCount} ${familyCount === 1 ? 'person' : 'people'} connected to you by family — friends are left out.` : 'Add yourself first: edit your own entry and tick “This is me”.'}
              </div>
            </div>
          </button>
          <button onClick={exportAll} disabled={!people.length} className="flex w-full items-center gap-4 p-4 text-left transition enabled:hover:bg-stone-50 disabled:opacity-60 dark:enabled:hover:bg-stone-800/60">
            <Download size={19} className="shrink-0 text-brand-600 dark:text-brand-300" />
            <div>
              <div className="font-medium">Download everyone (.ged)</div>
              <div className="text-sm text-stone-500">{people.length} {people.length === 1 ? 'person' : 'people'}. GEDCOM 5.5.1 works with Ancestry, FamilySearch, MyHeritage and Gramps.</div>
            </div>
          </button>
        </div>
      </section>
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
