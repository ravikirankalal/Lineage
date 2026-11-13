import { ArrowLeft, Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addRelationship, db, ensureRelationship, findRelationship, savePerson } from '../lib/db';
import { useData } from '../lib/data';
import { emptyPerson, formatPlace, matchesQuery } from '../lib/person';
import type { Gender, ParentSubtype, Person, RelType, Relationship, SpouseSubtype } from '../lib/types';
import { PersonRow } from './PersonRow';
import { Sheet } from './Sheet';

export type RelChoice =
  | 'father' | 'mother' | 'son' | 'daughter' | 'husband' | 'wife' | 'brother' | 'sister'
  | 'parent' | 'child' | 'spouse' | 'sibling'
  | 'close_friend' | 'friend' | 'colleague' | 'classmate' | 'neighbor' | 'acquaintance' | 'other';

const FAMILY_CHOICES: { key: RelChoice; label: string }[] = [
  { key: 'father', label: 'Father' },
  { key: 'mother', label: 'Mother' },
  { key: 'husband', label: 'Husband' },
  { key: 'wife', label: 'Wife' },
  { key: 'brother', label: 'Brother' },
  { key: 'sister', label: 'Sister' },
  { key: 'son', label: 'Son' },
  { key: 'daughter', label: 'Daughter' },
];
const SOCIAL_CHOICES: { key: RelChoice; label: string }[] = [
  { key: 'close_friend', label: 'Close friend' },
  { key: 'friend', label: 'Friend' },
  { key: 'colleague', label: 'Colleague' },
  { key: 'classmate', label: 'Classmate' },
  { key: 'neighbor', label: 'Neighbour' },
  { key: 'acquaintance', label: 'Acquaintance' },
  { key: 'other', label: 'Other' },
];

const CHOICE_INFO: Record<RelChoice, { type: RelType; gender?: Gender; dir?: 'in' | 'out'; label: string }> = {
  father: { type: 'parent', gender: 'male', dir: 'in', label: 'father' },
  mother: { type: 'parent', gender: 'female', dir: 'in', label: 'mother' },
  parent: { type: 'parent', dir: 'in', label: 'parent' },
  son: { type: 'parent', gender: 'male', dir: 'out', label: 'son' },
  daughter: { type: 'parent', gender: 'female', dir: 'out', label: 'daughter' },
  child: { type: 'parent', dir: 'out', label: 'child' },
  husband: { type: 'spouse', gender: 'male', label: 'husband' },
  wife: { type: 'spouse', gender: 'female', label: 'wife' },
  spouse: { type: 'spouse', label: 'spouse' },
  brother: { type: 'sibling', gender: 'male', label: 'brother' },
  sister: { type: 'sibling', gender: 'female', label: 'sister' },
  sibling: { type: 'sibling', label: 'sibling' },
  close_friend: { type: 'close_friend', label: 'close friend' },
  friend: { type: 'friend', label: 'friend' },
  colleague: { type: 'colleague', label: 'colleague' },
  classmate: { type: 'classmate', label: 'classmate' },
  neighbor: { type: 'neighbor', label: 'neighbour' },
  acquaintance: { type: 'acquaintance', label: 'acquaintance' },
  other: { type: 'other', label: 'connection' },
};

export function AddRelationSheet({ person, open, onClose, preset, familyOnly }: {
  person: Person;
  open: boolean;
  onClose: () => void;
  preset?: RelChoice;
  /** Hide friends/colleagues etc. (used in the lineage section). */
  familyOnly?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={null}>
      {open && <AddRelationBody key={person.id + (preset ?? '')} person={person} preset={preset} familyOnly={familyOnly} onClose={onClose} />}
    </Sheet>
  );
}

function AddRelationBody({ person, preset, familyOnly, onClose }: { person: Person; preset?: RelChoice; familyOnly?: boolean; onClose: () => void }) {
  const { people, graph, byId } = useData();
  const [choice, setChoice] = useState<RelChoice | undefined>(preset);
  const [q, setQ] = useState('');
  const [subtype, setSubtype] = useState<string>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const info = choice ? CHOICE_INFO[choice] : undefined;
  const name = person.nickname || person.firstName;

  // Helpful extra links.
  const spouses = graph.spousesOf(person.id).filter((s) => s.subtype !== 'divorced').map((s) => byId.get(s.id)!).filter(Boolean);
  const parents = graph.parentsOf(person.id).filter((e) => e.subtype !== 'step').map((e) => byId.get(e.id)!).filter(Boolean);
  // Parents a full/adoptive sibling would share: only biological or adoptive edges (not step/foster).
  const sharedParents = graph.parentsOf(person.id)
    .filter((e) => !e.subtype || e.subtype === 'biological' || e.subtype === 'adoptive')
    .map((e) => byId.get(e.id)!).filter(Boolean);
  const otherParent = info?.dir === 'in' && parents.length === 1 ? parents[0] : undefined;
  const [alsoSpouse, setAlsoSpouse] = useState(true);
  // A step/foster child of this person is not automatically the spouse's child.
  const coParent = info?.dir === 'out' && spouses.length === 1 && subtype !== 'step' && subtype !== 'foster' ? spouses[0] : undefined;
  const [alsoCoParent, setAlsoCoParent] = useState(true);

  const candidates = useMemo(() => {
    const list = people.filter((p) => p.id !== person.id && matchesQuery(p, q));
    if (info?.gender) list.sort((a, b) => Number(b.gender === info.gender) - Number(a.gender === info.gender));
    return list.slice(0, 50);
  }, [people, person.id, q, info?.gender]);

  /** Writes every edge for linking `other`, inside one transaction (optionally creating them first). */
  async function link(other: Person, create = false) {
    if (!info || !choice) return;
    setBusy(true);
    setError('');
    try {
      await db.transaction('rw', db.people, db.relationships, async () => {
        if (create) await savePerson(other);
        else if (info.gender && other.gender === 'unknown') await savePerson({ ...other, gender: info.gender });
        const sub = subtype || undefined;
        // The edge the user picked: a chosen subtype/note updates an existing edge, but the default
        // subtype only applies to a new edge (so re-linking never turns adoptive into biological).
        const userEdge = async (r: Parameters<typeof addRelationship>[0], fallback?: Relationship['subtype']) => {
          const exists = await findRelationship(r.fromId, r.toId, r.type);
          await addRelationship({ ...r, subtype: r.subtype ?? (exists ? undefined : fallback) });
        };
        if (info.type === 'parent') {
          const [from, to] = info.dir === 'in' ? [other.id, person.id] : [person.id, other.id];
          await userEdge({ fromId: from, toId: to, type: 'parent', subtype: sub as ParentSubtype | undefined, note: note || undefined }, 'biological');
          if (otherParent && alsoSpouse && other.id !== otherParent.id) {
            await ensureRelationship({ fromId: otherParent.id, toId: other.id, type: 'spouse', subtype: 'married' });
          }
          if (coParent && alsoCoParent && sub !== 'step' && sub !== 'foster') {
            await ensureRelationship({ fromId: coParent.id, toId: other.id, type: 'parent', subtype: sub === 'adoptive' ? 'adoptive' : 'biological' });
          }
        } else if (info.type === 'sibling') {
          // Full/adoptive siblings: link to the same (biological/adoptive) parents so the tree is complete.
          // Step/half siblings, or no known parents: store an explicit sibling edge.
          const viaParents = (!sub || sub === 'full' || sub === 'adoptive') && sharedParents.length > 0;
          if (viaParents) {
            const parentSub: ParentSubtype = sub === 'adoptive' ? 'adoptive' : 'biological';
            for (const p of sharedParents) {
              if (p.id === other.id) continue;
              await ensureRelationship({ fromId: p.id, toId: other.id, type: 'parent', subtype: parentSub });
            }
          } else {
            await addRelationship({ fromId: person.id, toId: other.id, type: 'sibling', subtype: sub as never, note: note || undefined });
          }
        } else {
          await userEdge({ fromId: person.id, toId: other.id, type: info.type, subtype: sub as SpouseSubtype | undefined, note: note || undefined }, info.type === 'spouse' ? 'married' : undefined);
        }
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createAndLink() {
    const parts = q.trim().split(/\s+/);
    const p = emptyPerson({
      firstName: parts[0] ?? '',
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : info?.type === 'parent' && info.gender === 'male' ? person.lastName : undefined,
      gender: info?.gender ?? 'unknown',
    });
    if (!p.firstName) return;
    await link(p, true);
  }

  if (!choice || !info) {
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-semibold">Add someone to {name}</h2>
        <div>
          <div className="section-title mb-2">Family</div>
          <div className="grid grid-cols-2 gap-2">
            {FAMILY_CHOICES.map((c) => (
              <button key={c.key} className="btn-secondary justify-start" onClick={() => setChoice(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>
        {!familyOnly && <div>
          <div className="section-title mb-2">Social</div>
          <div className="grid grid-cols-2 gap-2">
            {SOCIAL_CHOICES.map((c) => (
              <button key={c.key} className="btn-secondary justify-start" onClick={() => setChoice(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>}
      </div>
    );
  }

  const subtypeOptions =
    info.type === 'parent' ? [['biological', 'Biological'], ['adoptive', 'Adoptive'], ['step', 'Step'], ['foster', 'Foster']]
      : info.type === 'spouse' ? [['married', 'Married'], ['partner', 'Partner'], ['divorced', 'Divorced'], ['separated', 'Separated'], ['widowed', 'Widowed']]
        : info.type === 'sibling' ? [['full', 'Full'], ['half', 'Half'], ['step', 'Step'], ['adoptive', 'Adoptive']]
          : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {!preset && <button className="icon-btn -ml-2" onClick={() => setChoice(undefined)} aria-label="Back"><ArrowLeft size={20} /></button>}
        <h2 className="text-lg font-semibold">{name}’s {info.label}</h2>
      </div>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input autoFocus className="input pl-10" placeholder="Search people or type a new name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {subtypeOptions && (
        <div className="flex flex-wrap gap-1.5">
          {subtypeOptions.map(([k, l]) => (
            <button key={k} onClick={() => setSubtype(subtype === k ? '' : k)}
              className={`chip ${subtype === k ? '!bg-brand-600 !text-white' : ''}`}>{l}</button>
          ))}
        </div>
      )}
      {!subtypeOptions && (
        <input className="input" placeholder="Note (optional) — e.g. “from the gym”" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      {otherParent && (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={alsoSpouse} onChange={(e) => setAlsoSpouse(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Married to {otherParent.firstName}
        </label>
      )}
      {coParent && (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={alsoCoParent} onChange={(e) => setAlsoCoParent(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Also {coParent.firstName}’s {info.label}
        </label>
      )}
      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      <div className="-mx-2">
        {q.trim() && (
          <button disabled={busy} onClick={createAndLink} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-brand-50 dark:hover:bg-brand-900/30">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200"><UserPlus size={20} /></div>
            <div>
              <div className="font-medium">Add “{q.trim()}”</div>
              <div className="text-sm text-stone-500">Create a new person as {name}’s {info.label}</div>
            </div>
          </button>
        )}
        {candidates.map((p) => (
          <PersonRow key={p.id} person={p} onClick={() => !busy && link(p)} subtitle={formatPlace(p.address, true) || p.occupation} />
        ))}
        {!candidates.length && !q && <p className="px-2 py-6 text-center text-sm text-stone-500">Type a name to add someone new.</p>}
      </div>
    </div>
  );
}
