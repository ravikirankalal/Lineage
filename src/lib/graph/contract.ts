/**
 * GRAPH CONTRACT (Phase 11, family graph and navigation). This is the agreement between
 * kinship-engineer (layout, labels, social graph) and ui-builder (rendering, interaction).
 * Change it only with the coordinator's agreement.
 *
 * Mobile first: every screen must work on a 390×844 touch phone. That means pinch-zoom, drag-pan,
 * tap targets of at least 44px, no hover-only information, the focus visible on open, and smooth
 * rendering with ~150 people.
 */
import type { FamilyGraph } from '../kinship';
import type { Person, Relationship } from '../types';

// ---------------------------------------------------------------------------
// kinship-engineer: src/lib/tree.ts (replaces layoutTree)

/** How much of the family to draw around the focus. */
export type TreeLevel =
  | 'immediate' // parents, siblings, spouses, children, plus ancestors and descendants (today's view, fixed)
  | 'extended' // + aunts/uncles with spouses and cousins, siblings' spouses and children, the spouse's parents and siblings
  | 'everyone'; // the whole family component (may be wide; the UI offers fit-to-screen)

export interface TreeOptions {
  focusId: string; // the card the view is centred on
  level: TreeLevel;
  /** Person ids whose hidden relatives the user expanded (tap "+" on a card). */
  expanded: ReadonlySet<string>;
  up?: number; // generations above the focus (default 4)
  down?: number; // generations below the focus (default 3)
  ghosts?: boolean; // "Add father/mother" placeholders above the focus when parents are missing
}

/** Card geometry in layout units (px at zoom 1). Sized to stay readable on a phone at about 0.8 zoom. */
export const CARD = { w: 164, h: 76, gapX: 20, rowH: 128 } as const;

export interface TreeNode {
  key: string; // stable across re-layouts for the same person and role (used for FLIP animation)
  personId?: string; // absent for ghost placeholders
  ghost?: 'father' | 'mother';
  x: number; // card centre x
  y: number; // card top y
  generation: number; // relative to the focus: +1 parents, -1 children
  role: 'focus' | 'ancestor' | 'descendant' | 'sibling' | 'spouse' | 'relative' | 'ghost';
  half?: boolean; // half-sibling of the focus
  step?: boolean; // joined by a step or foster link (not blood)
  /** The person is drawn elsewhere too (pedigree collapse). This card is a small stub. */
  dupOf?: string; // key of the primary node
  /** Hidden relatives exist in these directions; the UI shows a "+" affordance. */
  expandable?: { up?: boolean; down?: boolean; side?: boolean };
  expanded?: boolean;
}

export interface TreeEdge {
  key: string;
  /** descent: parents → child. marriage/divorced: the couple line. collapse: dotted link to a duplicate stub. */
  kind: 'descent' | 'marriage' | 'divorced' | 'step' | 'collapse';
  /** Polyline in layout units. The UI draws it as is (rounded joins). */
  points: [number, number][];
  /** Person ids at both ends (for highlighting a chain). */
  from: string;
  to: string;
}

export interface TreeLayout {
  nodes: TreeNode[];
  edges: TreeEdge[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// export function layoutFamily(graph: FamilyGraph, opts: TreeOptions): TreeLayout
//   Guarantees (all tested):
//   - no two cards overlap and no edge passes through a card;
//   - every marriage gets its own child bar, so remarriages are correct;
//   - children hang from their blood parent unit, with step links drawn as 'step' edges;
//   - sibling order never depends on the focus (birth order, then name);
//   - Walker / Reingold–Tilford contour packing in both directions;
//   - < 30 ms for 1,000 people.

/** The ids along the shortest family path from a to b (inclusive). Used to highlight "how are we related". */
// export function relationPath(graph: FamilyGraph, a: string, b: string): string[]

/** Batch labels for many people from one ego: ONE path search (familyPathTree), never per card. */
// export function labelsFor(graph: FamilyGraph, egoId: string): Map<string, { label: string; path: string }>

// ---------------------------------------------------------------------------
// kinship-engineer: src/lib/connections.ts (a social graph, separate from FamilyGraph)

export interface SocialNode {
  id: string;
  ring: number; // 0 = the centre person, 1 = family & close friends, 2 = friends/colleagues/classmates, 3 = acquaintances/neighbours, 4 = implicit circles
  group: string; // ConnectionGroup key, e.g. 'family', 'close_friend', 'colleague', 'city', 'school'
  label: string; // e.g. "Close friend", "Same college · JNTU"
}
export interface SocialEdge {
  a: string;
  b: string;
  kind: 'family' | 'social' | 'implicit';
}
export interface SocialGraph {
  centerId: string;
  nodes: SocialNode[];
  edges: SocialEdge[]; // includes edges BETWEEN the centre's connections (friend-of-friend), so clusters show
}
// export function socialGraph(id: string, people: Person[], rels: Relationship[], graph?: FamilyGraph): SocialGraph

export type _Unused = Person | Relationship | FamilyGraph; // keeps the type imports for documentation
