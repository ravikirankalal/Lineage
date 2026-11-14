import type { KinCategory, Relative } from './kinship';

/** A sub-heading inside a large Relatives category (e.g. "Cousins · First cousins · Father's side"). */
export interface RelativeSubgroup {
  key: string;
  title: string;
  items: Relative[];
}

const SIDE_TITLE = { paternal: "Father's side", maternal: "Mother's side" } as const;
const SIDE_ORDER = { paternal: 0, maternal: 1, none: 2 } as const;

/** Categories big enough in real families to need sub-headings. */
export const SUBGROUPED: ReadonlySet<KinCategory> = new Set<KinCategory>(['uncles', 'cousins']);

/** "Uncles & aunts", "Great-uncles & aunts", "Great-great-uncles & aunts" by generations above ego. */
function uncleTier(generation: number): string {
  if (generation <= 2) return 'Uncles & aunts';
  return 'Great-'.repeat(generation - 2) + 'uncles & aunts';
}

/** "First cousin once removed" → "First cousins once removed". Other labels stay as they are. */
function pluralCousin(label: string): string {
  const base = label.replace(/\s*\(by marriage\)$/i, '');
  return /cousin/i.test(base) ? base.replace(/cousin(?!s)/i, 'cousins') : base;
}

/**
 * Splits a large category into sub-groups so long lists stay scannable:
 * uncles & aunts by generation then side, cousins by kind (first, second, removed) then side.
 * Returns a single untitled group when splitting would not help (small list, or only one group).
 */
export function subgroupRelatives(category: KinCategory, list: Relative[], minSize = 6): RelativeSubgroup[] {
  if (!SUBGROUPED.has(category) || list.length < minSize) return [{ key: 'all', title: '', items: list }];
  const groups = new Map<string, { title: string; rank: [number, number, string]; items: Relative[] }>();
  for (const r of list) {
    const side = r.kin.side ?? 'none';
    const tier = category === 'uncles' ? uncleTier(r.kin.generation) : pluralCousin(r.kin.label);
    const byMarriage = !r.kin.blood && category === 'uncles';
    const sideTitle = side === 'none' ? '' : SIDE_TITLE[side];
    const parts = [tier, sideTitle, byMarriage ? 'by marriage' : ''].filter(Boolean);
    const key = parts.join('|');
    if (!groups.has(key)) {
      // Rank: closest generation first, then degree (first cousins before second), then side.
      const primary = category === 'uncles' ? r.kin.generation : r.kin.degree;
      groups.set(key, { title: parts.join(' · '), rank: [primary, SIDE_ORDER[side] * 2 + (byMarriage ? 1 : 0), tier], items: [] });
    }
    groups.get(key)!.items.push(r);
  }
  if (groups.size < 2) return [{ key: 'all', title: '', items: list }];
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.rank[0] - b.rank[0] || a.rank[2].localeCompare(b.rank[2]) || a.rank[1] - b.rank[1])
    .map(([key, g]) => ({ key, title: g.title, items: g.items }));
}
