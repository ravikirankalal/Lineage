import { ArrowLeft, Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ops } from '../lib/db';
import { write } from '../lib/store';
import { useData } from '../lib/data';
import { emptyPerson, formatPlace, matchesQuery } from '../lib/person';
import type { FamilyType, Gender, ParentSubtype, Person, Relationship, SpouseSubtype } from '../lib/types';
import { PersonRow } from './PersonRow';
import { Sheet } from './Sheet';

export type RelChoice =
  | 'father' | 'mother' | 'son' | 'daughter' | 'husband' | 'wife'
  | 'parent' | 'child' | 'spouse';

/**
 * No "Brother"/"Sister" here (the owner's choice, to keep things simple): a brother or sister is added
 * as a son or daughter of the parents, so they share the parents and every view draws them correctly.
 * Sibling links that already exist are still understood.
 */
const FAMILY_CHOICES: { key: RelChoice; label: string }[] = [
  { key: 'father', label: 'Father' },
  { key: 'mother', label: 'Mother' },
  { key: 'husband', label: 'Husband' },
  { key: 'wife', label: 'Wife' },
  { key: 'son', label: 'Son' },
  { key: 'daughter', label: 'Daughter' },
];
const CHOICE_INFO: Record<RelChoice, { type: FamilyType; gender?: Gender; dir?: 'in' | 'out'; label: string }> = {
  father: { type: 'parent', gender: 'male', dir: 'in', label: 'father' },
  mother: { type: 'parent', gender: 'female', dir: 'in', label: 'mother' },
  parent: { type: 'parent', dir: 'in', label: 'parent' },
  son: { type: 'parent', gender: 'male', dir: 'out', label: 'son' },
  daughter: { type: 'parent', gender: 'female', dir: 'out', label: 'daughter' },
  child: { type: 'parent', dir: 'out', label: 'child' },
  husband: { type: 'spouse', gender: 'male', label: 'husband' },
  wife: { type: 'spouse', gender: 'female', label: 'wife' },
  spouse: { type: 'spouse', label: 'spouse' },
};

export function AddRelationSheet({ person, open, onClose, preset }: {
  person: Person;
  open: boolean;
  onClose: () => void;
  preset?: RelChoice;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={null}>
      {open && <AddRelationBody key={person.id + (preset ?? '')} person={person} preset={preset} onClose={onClose} />}
    </Sheet>
  );
}

function AddRelationBody({ person, preset, onClose }: { person: Person; preset?: RelChoice; onClose: () => void }) {
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
  const otherParent = info?.dir === 'in' && parents.length === 1 ? parents[0] : undefined;
  const [alsoSpouse, setAlsoSpouse] = useState(true);
  // A son or daughter always gets their other parent too (owner, 2026-11-15), so step and half
  // relations are never guessed. A spouse is suggested first; anyone else can be picked or typed.
  const isChild = info?.dir === 'out';
  const exSpouses = graph.spousesOf(person.id).filter((s) => s.subtype === 'divorced').map((s) => byId.get(s.id)!).filter(Boolean);
  const [other, setOther] = useState<OtherParent | undefined>(() => (spouses[0] ? { person: spouses[0] } : undefined));
  const [otherQ, setOtherQ] = useState('');
  const [picking, setPicking] = useState(false);
  const otherIsSpouse = !!other?.person && [...spouses, ...exSpouses].some((s) => s.id === other.person!.id);
  const [married, setMarried] = useState(true);
  const otherCandidates = useMemo(() => {
    if (!isChild || !otherQ.trim()) return [];
    return people.filter((p) => p.id !== person.id && matchesQuery(p, otherQ)).slice(0, 8);
  }, [people, person.id, otherQ, isChild]);
  const oppositeGender: Gender = person.gender === 'male' ? 'female' : person.gender === 'female' ? 'male' : 'unknown';

  const candidates = useMemo(() => {
    const list = people.filter((p) => p.id !== person.id && matchesQuery(p, q));
    if (info?.gender) list.sort((a, b) => Number(b.gender === info.gender) - Number(a.gender === info.gender));
    return list.slice(0, 50);
  }, [people, person.id, q, info?.gender]);

  /** Writes every edge for linking `other` as one batch (optionally creating them first). */
  async function link(child: Person, create = false) {
    if (!info || !choice) return;
    if (isChild && !other) { setError(`Choose ${child.firstName || 'their'}’s other parent first.`); return; }
    if (isChild && other?.person?.id === child.id) { setError('The other parent can’t be the child.'); return; }
    setBusy(true);
    setError('');
    try {
      await write((t) => {
        if (create) ops.savePerson(t, child);
        else if (info.gender && child.gender === 'unknown') ops.savePerson(t, { ...child, gender: info.gender });
        const sub = subtype || undefined;
        // The edge the user picked: a chosen subtype/note updates an existing edge, but the default
        // subtype only applies to a new edge (so re-linking never turns adoptive into biological).
        const userEdge = (r: Parameters<typeof ops.addRelationship>[1], fallback?: Relationship['subtype']) => {
          const exists = ops.findRelationship(t, r.fromId, r.toId, r.type);
          ops.addRelationship(t, { ...r, subtype: r.subtype ?? (exists ? undefined : fallback) });
        };
        if (info.type === 'parent') {
          const [from, to] = info.dir === 'in' ? [child.id, person.id] : [person.id, child.id];
          userEdge({ fromId: from, toId: to, type: 'parent', subtype: sub as ParentSubtype | undefined, note: note || undefined }, 'biological');
          if (otherParent && alsoSpouse && child.id !== otherParent.id) {
            ops.ensureRelationship(t, { fromId: otherParent.id, toId: child.id, type: 'spouse', subtype: 'married' });
          }
          if (isChild && other) {
            // The other parent: a new person, or someone already in the tree.
            let op = other.person;
            if (!op) {
              const parts = other.name!.trim().split(/\s+/);
              op = emptyPerson({ firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined, gender: oppositeGender });
              ops.savePerson(t, op);
            }
            // A step-child is the other parent's own child; adoptive and foster are shared.
            const theirs: ParentSubtype = sub === 'adoptive' ? 'adoptive' : sub === 'foster' ? 'foster' : 'biological';
            ops.ensureRelationship(t, { fromId: op.id, toId: child.id, type: 'parent', subtype: theirs });
            if (married && !otherIsSpouse) ops.ensureRelationship(t, { fromId: person.id, toId: op.id, type: 'spouse', subtype: 'married' });
          }
        } else {
          userEdge({ fromId: person.id, toId: child.id, type: info.type, subtype: sub as SpouseSubtype | undefined, note: note || undefined }, info.type === 'spouse' ? 'married' : undefined);
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
      </div>
    );
  }

  const subtypeOptions =
    info.type === 'parent' ? [['biological', 'Biological'], ['adoptive', 'Adoptive'], ['step', 'Step'], ['foster', 'Foster']]
      : info.type === 'spouse' ? [['married', 'Married'], ['partner', 'Partner'], ['divorced', 'Divorced'], ['separated', 'Separated'], ['widowed', 'Widowed']]
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
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      {otherParent && (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={alsoSpouse} onChange={(e) => setAlsoSpouse(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Married to {otherParent.firstName}
        </label>
      )}
      {isChild && (
        <OtherParentPicker
          person={person} spouses={[...spouses, ...exSpouses]} exSpouseIds={new Set(exSpouses.map((s) => s.id))}
          other={other} setOther={(o) => { setOther(o); setPicking(false); setOtherQ(''); setError(''); }}
          picking={picking || !other} setPicking={setPicking} q={otherQ} setQ={setOtherQ} candidates={otherCandidates}
          married={married} setMarried={setMarried} showMarried={!!other && !otherIsSpouse} />
      )}
      {error && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      <div className={`-mx-2 ${isChild && !other ? 'pointer-events-none opacity-40' : ''}`} aria-disabled={isChild && !other}>
        {q.trim() && (
          <button disabled={busy || (isChild && !other)} onClick={createAndLink} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-brand-50 dark:hover:bg-brand-900/30">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200"><UserPlus size={20} /></div>
            <div>
              <div className="font-medium">Add “{q.trim()}”</div>
              <div className="text-sm text-stone-500">Create a new person as {name}’s {info.label}</div>
            </div>
          </button>
        )}
        {candidates.map((p) => (
          <PersonRow key={p.id} person={p} onClick={() => !busy && (!isChild || other) && link(p)} subtitle={formatPlace(p.address, true) || p.occupation} />
        ))}
        {!candidates.length && !q && <p className="px-2 py-6 text-center text-sm text-stone-500">Type a name to add someone new.</p>}
      </div>
    </div>
  );
}

type OtherParent = { person?: Person; name?: string };

/** "Other parent" for a new son or daughter: required. Spouses first, then anyone in the tree or a new name. */
function OtherParentPicker({ person, spouses, exSpouseIds, other, setOther, picking, setPicking, q, setQ, candidates, married, setMarried, showMarried }: {
  person: Person;
  spouses: Person[];
  exSpouseIds: Set<string>;
  other?: OtherParent;
  setOther: (o: OtherParent) => void;
  picking: boolean;
  setPicking: (v: boolean) => void;
  q: string;
  setQ: (v: string) => void;
  candidates: Person[];
  married: boolean;
  setMarried: (v: boolean) => void;
  showMarried: boolean;
}) {
  const label = other?.person ? `${other.person.firstName}${other.person.lastName ? ' ' + other.person.lastName : ''}` : other?.name?.trim();
  const chip = (active: boolean) => `chip ${active ? '!bg-brand-600 !text-white' : ''}`;
  return (
    <div role="group" aria-label="Other parent" className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200 dark:bg-stone-800/60 dark:ring-stone-700">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">Other parent <span className="font-normal text-red-600">*</span></div>
        {label && !picking && <div className="truncate text-sm text-brand-700 dark:text-brand-300">{label}</div>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {spouses.map((s) => (
          <button key={s.id} type="button" className={chip(other?.person?.id === s.id && !picking)} onClick={() => setOther({ person: s })}>
            {s.firstName}{exSpouseIds.has(s.id) ? ' (former)' : ''}
          </button>
        ))}
        <button type="button" className={chip(picking || (!!other && !spouses.some((s) => s.id === other.person?.id)))} onClick={() => setPicking(true)}>
          {spouses.length ? 'Someone else' : 'Choose…'}
        </button>
      </div>
      {picking && (
        <div className="mt-2">
          <input className="input" placeholder={`Name of ${person.firstName}’s partner`} aria-label="Other parent's name" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() && (
            <div className="-mx-1 mt-1 max-h-56 overflow-y-auto">
              <button type="button" onClick={() => setOther({ name: q.trim() })} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-900/30">
                <UserPlus size={16} className="text-brand-700 dark:text-brand-300" /> Add “{q.trim()}” as the other parent
              </button>
              {candidates.map((p) => (
                <PersonRow key={p.id} person={p} onClick={() => setOther({ person: p })} />
              ))}
            </div>
          )}
        </div>
      )}
      {!other && !picking && <p className="mt-2 text-xs text-stone-500">Needed so brothers, sisters and step-family come out right.</p>}
      {showMarried && !picking && (
        <label className="mt-2 flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={married} onChange={(e) => setMarried(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          {label} is {person.firstName}’s spouse
        </label>
      )}
    </div>
  );
}
