import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { purgeNonFamilyLinks } from './db';
import { FamilyGraph } from './kinship';
import { store } from './store';
import { isFamilyType, type Person, type Relationship } from './types';

interface Data {
  loaded: boolean;
  people: Person[];
  rels: Relationship[];
  byId: Map<string, Person>;
  graph: FamilyGraph;
  me?: Person;
}

const Ctx = createContext<Data | null>(null);

/** The live family tree from the store (see store.ts), plus the derived family graph. */
export function DataProvider({ children }: { children: ReactNode }) {
  const snap = useSyncExternalStore(store.subscribe, store.get);
  const value = useMemo<Data>(() => {
    const ps = [...snap.people.values()];
    const rs = [...snap.rels.values()];
    const byId = new Map(ps.map((p) => [p.id, p]));
    return {
      loaded: snap.loaded,
      people: ps,
      rels: rs,
      byId,
      graph: new FamilyGraph(byId, rs),
      me: ps.find((p) => p.isMe),
    };
  }, [snap]);
  // Family only: links from older versions (friend, colleague, …) are deleted for good when seen.
  const stray = value.rels.some((r) => !isFamilyType(r.type));
  useEffect(() => { if (stray) void purgeNonFamilyLinks().catch(() => { /* not allowed here (viewer) or offline */ }); }, [stray, value.rels]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
