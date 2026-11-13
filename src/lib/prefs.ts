import { useCallback, useSyncExternalStore } from 'react';
import { KIN_LANGUAGES, type KinLang } from './kinshipTerms';

const KEY = 'lineage:kinLang';
const EVENT = 'lineage:prefs';

function load(): KinLang {
  try {
    const v = localStorage.getItem(KEY);
    if (v && KIN_LANGUAGES.some((l) => l.id === v)) return v as KinLang;
  } catch { /* storage blocked */ }
  return 'en';
}

// In-memory copy so the choice still works this session when storage is blocked or full.
let current: KinLang | undefined;
const readKinLang = (): KinLang => (current ??= load());

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { current = load(); cb(); }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage); // other tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function setKinLang(l: KinLang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch { /* storage unavailable: still notify so this session updates */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Language for regional family terms ("Chacha", "Mama"…), shared by every component. */
export function useKinLang(): [KinLang, (l: KinLang) => void] {
  const lang = useSyncExternalStore(subscribe, readKinLang, () => 'en' as KinLang);
  return [lang, useCallback(setKinLang, [])];
}
