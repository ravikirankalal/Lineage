import { Contact } from 'lucide-react';
import type { Person } from '../lib/types';

/** Small round markers: † for someone who has died, a contact card for someone in your contacts. */
export function PersonMarkers({ person, inContacts, size = 16, className = '' }: { person: Person; inContacts?: boolean; size?: number; className?: string }) {
  if (!person.deceased && !inContacts) return null;
  const dot = 'flex shrink-0 items-center justify-center rounded-full ring-2 ring-white dark:ring-stone-900';
  const style = { width: size, height: size };
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {person.deceased && (
        <span role="img" aria-label="Deceased" title="Deceased" style={{ ...style, fontSize: size * 0.7 }}
          className={`${dot} bg-stone-600 font-bold leading-none text-white dark:bg-stone-400 dark:text-stone-900`} data-marker="deceased">†</span>
      )}
      {inContacts && (
        <span role="img" aria-label="In your contacts" title="In your contacts" style={style}
          className={`${dot} bg-sky-500 text-white`} data-marker="contact"><Contact size={size * 0.62} strokeWidth={2.5} /></span>
      )}
    </span>
  );
}
