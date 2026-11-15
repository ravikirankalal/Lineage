import { Crosshair, Minus, Plus, Route, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { TreeNode } from '../../lib/graph/contract';
import { displayName, formatPlace, lifespan } from '../../lib/person';
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

  return (
    <Sheet open onClose={onClose} title={displayName(person)}
      footer={<button type="button" className="btn-primary w-full" onClick={onProfile}><User size={18} /> Open profile</button>}>
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
            {FAMILY_CHOICES.map((c) => (
              <button key={c.key} type="button" className="btn-secondary" onClick={() => setAdding(c.key)}
                aria-label={`Add ${first}’s ${c.label.toLowerCase()}`}>{c.label}</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
