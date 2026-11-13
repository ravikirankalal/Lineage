import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { displayName, lifespan } from '../lib/person';
import type { Person } from '../lib/types';
import { Avatar } from './Avatar';

export function PersonRow({ person, subtitle, right, to, onClick, size = 44 }: {
  person: Person;
  subtitle?: ReactNode;
  right?: ReactNode;
  to?: string;
  onClick?: () => void;
  size?: number;
}) {
  const body = (
    <>
      <Avatar person={person} size={size} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium">{displayName(person)}</span>
          {person.nickname && <span className="truncate text-sm text-stone-400">“{person.nickname}”</span>}
          {person.deceased && <span className="text-xs text-stone-400">{lifespan(person) || '†'}</span>}
        </div>
        {subtitle && <div className="truncate text-sm text-stone-500 dark:text-stone-400">{subtitle}</div>}
      </div>
      {right}
    </>
  );
  const cls = 'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-stone-100 active:bg-stone-200/60 dark:hover:bg-stone-800/70';
  if (to) return <Link to={to} className={cls}>{body}{!right && <ChevronRight size={18} className="text-stone-300" />}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}
