/**
 * Level of detail for tree cards, from how big a card is on screen (the zoom). Five designs:
 * 1 tile (initials), 2 name, 3 compact (photo, short name, relation), 4 standard (+ years),
 * 5 detailed (full name, relation and term, years with age, place and occupation).
 */
export type Detail = 1 | 2 | 3 | 4 | 5;

/** Zoom where each level starts: level 2 from 0.35, 3 from 0.55, 4 from 0.8, 5 from 1.3. */
export const DETAIL_FROM = [0.35, 0.55, 0.8, 1.3] as const;
const SLACK = 0.03; // hysteresis, so a zoom resting on a boundary doesn't flicker between designs

/** The level for zoom `k`, staying at `current` until `k` is clearly past a boundary. */
export function detailFor(k: number, current?: Detail): Detail {
  const raw = (1 + DETAIL_FROM.filter((t) => k >= t).length) as Detail;
  if (!current || raw === current) return raw;
  if (raw > current) return k >= DETAIL_FROM[current - 1] + SLACK ? raw : current;
  return k <= DETAIL_FROM[current - 2] - SLACK ? raw : current;
}
