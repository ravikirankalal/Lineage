import { Contact, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  googleContactsAvailable, loadGoogleContacts, loadNativeContacts, phonePickerAvailable, pickPhoneContact, useGoogleContacts,
} from '../lib/cloud/googleContacts';
import { contactName } from '../lib/contactSuggest';
import { isNativeApp } from '../lib/native';
import { norm } from '../lib/person';
import { Sheet } from './Sheet';

/** Can this device offer numbers from the user's contacts? */
export function contactNumbersAvailable(ready: boolean): boolean {
  return ready || isNativeApp() || googleContactsAvailable() || phonePickerAvailable();
}

/**
 * "From contacts" next to the phone numbers when editing someone: search your contacts (the phone's
 * in the app, Google's on the web) and tap a number to add it. Chrome on Android without Google
 * contacts uses the phone's own contact picker instead. Nothing is stored except the number picked.
 */
export function ContactNumberPicker({ name, onPick }: { name: string; onPick: (number: string) => void }) {
  const gc = useGoogleContacts();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(name);
  if (!contactNumbersAvailable(gc.status === 'ready')) return null;

  async function start() {
    setQ(name);
    if (gc.status !== 'ready' && !isNativeApp() && !googleContactsAvailable() && phonePickerAvailable()) {
      try {
        const c = await pickPhoneContact();
        const tel = c?.tel?.find((t) => t.trim());
        if (tel) onPick(tel.trim());
      } catch { /* closed */ }
      return;
    }
    setOpen(true);
    if (gc.status !== 'ready' && gc.status !== 'loading') void (isNativeApp() ? loadNativeContacts() : loadGoogleContacts());
  }

  return (
    <>
      <button type="button" onClick={() => void start()}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-900/30">
        <Contact size={16} /> From contacts
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pick a number">
        <NumberList q={q} setQ={setQ} onPick={(n) => { onPick(n); setOpen(false); }} />
      </Sheet>
    </>
  );
}

function NumberList({ q, setQ, onPick }: { q: string; setQ: (v: string) => void; onPick: (n: string) => void }) {
  const gc = useGoogleContacts();
  const hits = useMemo(() => {
    const terms = norm(q).split(' ').filter(Boolean);
    const withPhones = gc.contacts.filter((c) => c.phones.length);
    if (!terms.length) return withPhones.slice(0, 40);
    return withPhones.filter((c) => {
      const text = norm([contactName(c), c.nickname, ...c.phones.map((p) => p.replace(/\D/g, ''))].filter(Boolean).join(' '));
      return terms.every((t) => text.includes(t));
    }).slice(0, 40);
  }, [gc.contacts, q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input autoFocus className="input pl-10" placeholder="Search your contacts" aria-label="Search your contacts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {gc.status === 'loading' && <p className="py-4 text-center text-sm text-stone-500">Looking through your contacts…</p>}
      {gc.status === 'error' && <p className="py-4 text-center text-sm text-red-600 dark:text-red-400">{gc.error}</p>}
      {gc.status === 'ready' && !hits.length && <p className="py-4 text-center text-sm text-stone-500">No contacts with a number match “{q}”. Try fewer letters.</p>}
      <div className="-mx-2">
        {hits.map((c) => (
          <div key={c.key} className="rounded-xl px-2 py-2">
            <div className="truncate font-medium">{contactName(c)}{c.nickname ? <span className="font-normal text-stone-500"> “{c.nickname}”</span> : null}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {c.phones.map((n) => (
                <button key={n} type="button" onClick={() => onPick(n)} aria-label={`Use ${n}`}
                  className="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800 ring-1 ring-sky-100 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-900">
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
