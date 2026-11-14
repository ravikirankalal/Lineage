import { ChevronRight, Crosshair, Minus, Plus, Route, User, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TreeNode } from '../../lib/graph/contract';
import { displayName, formatPlace, lifespan } from '../../lib/person';
import type { Person } from '../../lib/types';
import { Avatar } from '../Avatar';
import { Sheet } from '../Sheet';

/** What a tapped card offers: the full label (never truncated), then the next steps. */
export function PersonSheet({ person, node, label, path, term, isEgo, isFocus, egoName, canEdit, onClose, onCentre, onProfile, onToggle, onRelate, onAdd }: {
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
  onAdd: () => void;
}) {
  const span = lifespan(person);
  const place = formatPlace(person.address, true) || formatPlace(person.origin, true);
  const canExpand = !!node.expandable && (node.expandable.up || node.expandable.down || node.expandable.side);
  const first = person.firstName || 'them';
  return (
    <Sheet open onClose={onClose} title={displayName(person)}
      footer={<button type="button" className="btn-primary w-full" onClick={onProfile}><User size={18} /> Open profile</button>}>
      <div className="mb-4 flex items-center gap-3">
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
      <div className="-mx-2 flex flex-col">
        {!isFocus && <Action icon={<Crosshair size={19} />} onClick={onCentre}>Centre the tree on {first}</Action>}
        {canExpand && (
          <Action icon={node.expanded ? <Minus size={19} /> : <Plus size={19} />} onClick={onToggle}>
            {node.expanded ? `Hide ${first}’s extra relatives` : `Show ${first}’s relatives`}
          </Action>
        )}
        {!isEgo && <Action icon={<Route size={19} />} onClick={onRelate}>How {egoName === 'you' ? 'are we' : `is ${first}`} related{egoName === 'you' ? '' : ` to ${egoName}`}?</Action>}
        {canEdit && <Action icon={<UserPlus size={19} />} onClick={onAdd}>Add a relative of {first}</Action>}
      </div>
    </Sheet>
  );
}

function Action({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left text-[15px] font-medium hover:bg-stone-100 active:bg-stone-200/60 dark:hover:bg-stone-800">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{icon}</span>
      <span className="flex-1">{children}</span>
      <ChevronRight size={18} className="text-stone-300" />
    </button>
  );
}
