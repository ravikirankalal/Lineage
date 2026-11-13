import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { db } from './db';
import { FamilyGraph } from './kinship';
import type { Person, Relationship } from './types';

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
