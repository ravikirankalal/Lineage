import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { db, purgeNonFamilyLinks } from './db';
import { FamilyGraph } from './kinship';
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

export function DataProvider({ children }: { children: ReactNode }) {
  const people = useLiveQuery(() => db.people.toArray(), []);
  const rels = useLiveQuery(() => db.relationships.toArray(), []);
  // Family only: links from older versions (friend, colleague, …), or pulled from an old device, are
  // deleted for good as soon as they show up. The tombstones sync the deletion to the cloud.
  const stray = !!rels?.some((r) => !isFamilyType(r.type));
  useEffect(() => { if (stray) void purgeNonFamilyLinks().catch(() => { /* retried on the next change */ }); }, [stray, rels]);
  const value = useMemo<Data>(() => {
    const ps = people ?? [];
    const rs = rels ?? [];
    const byId = new Map(ps.map((p) => [p.id, p]));
    return {
      loaded: people !== undefined && rels !== undefined,
      people: ps,
      rels: rs,
      byId,
      graph: new FamilyGraph(byId, rs),
      me: ps.find((p) => p.isMe),
    };
  }, [people, rels]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
