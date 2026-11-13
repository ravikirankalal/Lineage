import { initials } from '../lib/person';
import type { Person } from '../lib/types';

const PALETTE = [
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200',
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ person, size = 40, className = '' }: { person: Person; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38) };
  if (person.photo) {
    return <img src={person.photo} alt="" style={style} className={`shrink-0 rounded-full object-cover ${person.deceased ? 'grayscale' : ''} ${className}`} />;
  }
  return (
    <div style={style} className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${PALETTE[hash(person.id) % PALETTE.length]} ${className}`}>
      {initials(person)}
    </div>
  );
}
