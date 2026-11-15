import { Check, Crosshair, Minus, Pencil, Plus, Route, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { TreeNode } from '../../lib/graph/contract';
import { displayName, formatPlace, lifespan } from '../../lib/person';
import { ops } from '../../lib/db';
import { useData } from '../../lib/data';
import { birthParents } from '../../lib/kinship';
import { write } from '../../lib/store';
import type { Person } from '../../lib/types';
import { AddRelationBody, FAMILY_CHOICES, type RelChoice } from '../AddRelationSheet';
import { Avatar } from '../Avatar';
import { Sheet } from '../Sheet';

/**
 * Everything you can do with a card, in one sheet: who they are, then Centre / How related / Show
 * relatives, then "Add to <name>'s family". Picking Father, Son… opens the add steps in the same sheet
 * (Back returns here); adding someone closes it.
 */
export function PersonSheet({ person, node, label, path, term, isEgo, isFocus, egoName, canEdit, onClose, onCentre, onProfile, onToggle, onRelate }: {
  person: Person;
  node: TreeNode;
  label?: string;
  path?: string;
  term?: string;
  isEgo: boolean;
  isFocus: boolean;
  /** "you" or the ego's first name. */
  egoName: string;
  canEdit: boolean;
  onClose: () => void;
  onCentre: () => void;
  onProfile: () => void;
  onToggle: () => void;
  onRelate: () => void;
}) {
  const [adding, setAdding] = useState<RelChoice | undefined>();
  const [editing, setEditing] = useState(false);
  const { graph, byId } = useData();
  // Father / Mother can't be added twice: those buttons are off once the tree has them.
  const assigned = birthParents(graph, byId, person.id);
  const taken: Partial<Record<RelChoice, Person>> = { father: assigned.father, mother: assigned.mother };
  const span = lifespan(person);
  const place = formatPlace(person.address, true) || formatPlace(person.origin, true);
  const canExpand = !!node.expandable && (node.expandable.up || node.expandable.down || node.expandable.side);
  const first = person.nickname || person.firstName || 'them';
  const relate = `How ${egoName === 'you' ? 'are we' : `is ${first}`} related${egoName === 'you' ? '' : ` to ${egoName}`}?`;

  if (adding) {
    return (
      <Sheet open onClose={onClose} title={null}>
        <AddRelationBody person={person} preset={adding} onClose={onClose} onBack={() => setAdding(undefined)} />
      </Sheet>
    );
  }

  const actions: { key: string; icon: ReactNode; short: string; full: string; onClick: () => void }[] = [];
  if (!isFocus) actions.push({ key: 'centre', icon: <Crosshair size={20} />, short: 'Centre tree', full: `Centre the tree on ${first}`, onClick: onCentre });
  if (!isEgo) actions.push({ key: 'relate', icon: <Route size={20} />, short: 'How related?', full: relate, onClick: onRelate });
  if (canExpand) {
    actions.push(node.expanded
      ? { key: 'toggle', icon: <Minus size={20} />, short: 'Fewer relatives', full: `Hide ${first}’s extra relatives`, onClick: onToggle }
      : { key: 'toggle', icon: <Plus size={20} />, short: 'More relatives', full: `Show ${first}’s relatives`, onClick: onToggle });
  }

  // The name, editable in place for editors: tap it (or the pencil) to change first and last name.
  const title = editing ? null : canEdit ? (
    <button type="button" onClick={() => setEditing(true)} aria-label={`Edit name: ${displayName(person)}`}
      className="group -mx-1.5 inline-flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-left hover:bg-stone-100 dark:hover:bg-stone-800">
      <span className="min-w-0 break-words">{displayName(person)}</span>
      <Pencil size={15} className="shrink-0 text-stone-400 group-hover:text-brand-700 dark:group-hover:text-brand-300" />
    </button>
  ) : displayName(person);

  return (
    <Sheet open onClose={onClose} title={title}
      footer={<button type="button" className="btn-primary w-full" onClick={onProfile}><User size={18} /> Open profile</button>}>
      {editing && <NameEditor person={person} onDone={() => setEditing(false)} />}
      <div className="flex items-center gap-3">
        <Avatar person={person} size={56} />
        <div className="min-w-0">
          {isEgo ? (
            <div className="text-lg font-semibold text-brand-700 dark:text-brand-300">{egoName === 'you' ? 'You' : egoName}</div>
          ) : label ? (
            <div className="text-lg font-semibold leading-snug text-brand-700 dark:text-brand-300">
              {label}{term && <span className="font-normal text-stone-500 dark:text-stone-400"> · {term}</span>}
            </div>
          ) : (
            <div className="text-stone-500">Family</div>
          )}
          {!isEgo && path && path !== label && <div className="text-sm text-stone-600 dark:text-stone-300">{path}</div>}
          {(span || place) && <div className="text-sm text-stone-500 dark:text-stone-400">{[span, place].filter(Boolean).join(' · ')}</div>}
          {(node.half || node.step) && (
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {node.step ? 'Joined by marriage, adoption or fostering, not by birth.' : 'Shares one parent, not both.'}
            </div>
          )}
        </div>
      </div>

      {actions.length > 0 && (
        <div className={`mt-5 grid gap-2 ${actions.length === 1 ? 'grid-cols-1' : actions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {actions.map((a) => (
            <button key={a.key} type="button" onClick={a.onClick} aria-label={a.full} title={a.full}
              className="btn-secondary min-h-[64px] flex-col gap-1 px-2 py-2.5 text-[13px] leading-tight">
              <span className="text-brand-700 dark:text-brand-300">{a.icon}</span>
              {a.short}
            </button>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-5">
          <div className="section-title mb-2">Add to {first}’s family</div>
          <div className="grid grid-cols-3 gap-2">
            {FAMILY_CHOICES.map((c) => {
              const has = taken[c.key];
              // A man isn't offered a husband, a woman isn't offered a wife (owner).
              const notFor = (c.key === 'husband' && person.gender === 'male') || (c.key === 'wife' && person.gender === 'female');
              if (notFor) {
                return (
                  <button key={c.key} type="button" disabled className="btn-secondary"
                    aria-label={`Add ${first}’s ${c.label.toLowerCase()} (not available)`}>{c.label}</button>
                );
              }
              return has ? (
                <button key={c.key} type="button" disabled title={`${first}’s ${c.label.toLowerCase()} is ${displayName(has)}`}
                  aria-label={`${first}’s ${c.label.toLowerCase()} is already ${displayName(has)}`}
                  className="btn-secondary flex-col gap-0 py-1.5 leading-tight">
                  <span>{c.label}</span>
                  <span className="max-w-full truncate text-[11px] font-normal text-stone-500">{has.firstName}</span>
                </button>
              ) : (
                <button key={c.key} type="button" className="btn-secondary" onClick={() => setAdding(c.key)}
                  aria-label={`Add ${first}’s ${c.label.toLowerCase()}`}>{c.label}</button>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** First and last name, saved straight to the family tree. */
function NameEditor({ person, onDone }: { person: Person; onDone: () => void }) {
  const [first, setFirst] = useState(person.firstName);
  const [last, setLast] = useState(person.lastName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = first.trim() !== person.firstName || last.trim() !== (person.lastName ?? '');

  async function save() {
    if (!first.trim()) { setError('A first name is needed.'); return; }
    if (!changed) { onDone(); return; }
    setBusy(true);
    setError('');
    try {
      await write((t) => { ops.savePerson(t, { ...person, firstName: first.trim(), lastName: last.trim() || undefined }); });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="mb-4" aria-label="Edit name" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid grid-cols-2 gap-2">
        <input autoFocus className="input" aria-label="First name" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
        <input className="input" aria-label="Last name" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}><Check size={16} /> Save name</button>
      </div>
    </form>
  );
}
