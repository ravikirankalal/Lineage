import type { Gender, ParentSubtype, Person, Relationship, SiblingSubtype, SpouseSubtype } from './types';

/**
 * Family graph built from stored relationships.
 *
 * Only `parent`, `spouse` and `sibling` edges are stored. Everything else
 * (children, grandparents, cousins, in-laws…) is derived here.
 */
export interface Edge<S> {
  id: string;
  subtype?: S;
}

export class FamilyGraph {
  readonly people: Map<string, Person>;
  readonly parents = new Map<string, Edge<ParentSubtype>[]>();
  readonly children = new Map<string, Edge<ParentSubtype>[]>();
  readonly spouses = new Map<string, Edge<SpouseSubtype>[]>();
  /** Explicit step/half sibling edges. They are direct neighbours only and never share parents. */
  readonly looseSiblings = new Map<string, Edge<SiblingSubtype>[]>();
  /** Explicit full/adoptive/untyped sibling groups (union-find root per person); they share parents. */
  private sibRoot = new Map<string, string>();
  /** Members of each explicit sibling group by root, in `sibRoot` insertion order. Built lazily:
   * the graph is immutable after construction, so it never needs invalidating. */
  private groups?: Map<string, string[]>;

  constructor(people: Person[] | Map<string, Person>, rels: Relationship[]) {
    this.people = people instanceof Map ? people : new Map(people.map((p) => [p.id, p]));
    for (const r of rels) {
      if (!this.people.has(r.fromId) || !this.people.has(r.toId) || r.fromId === r.toId) continue;
      if (r.type === 'parent') {
        push(this.parents, r.toId, { id: r.fromId, subtype: r.subtype as ParentSubtype });
        push(this.children, r.fromId, { id: r.toId, subtype: r.subtype as ParentSubtype });
      } else if (r.type === 'spouse') {
        push(this.spouses, r.fromId, { id: r.toId, subtype: r.subtype as SpouseSubtype });
        push(this.spouses, r.toId, { id: r.fromId, subtype: r.subtype as SpouseSubtype });
      } else if (r.type === 'sibling') {
        const sub = r.subtype as SiblingSubtype | undefined;
        if (sub === 'step' || sub === 'half') {
          push(this.looseSiblings, r.fromId, { id: r.toId, subtype: sub });
          push(this.looseSiblings, r.toId, { id: r.fromId, subtype: sub });
        } else this.union(r.fromId, r.toId);
      }
    }
  }

  private find(a: string): string {
    let r = this.sibRoot.get(a) ?? a;
    if (r !== a) {
      r = this.find(r);
      this.sibRoot.set(a, r);
    }
    return r;
  }

  private union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (!this.sibRoot.has(ra)) this.sibRoot.set(ra, ra);
    if (!this.sibRoot.has(rb)) this.sibRoot.set(rb, rb);
    if (ra !== rb) this.sibRoot.set(ra, rb);
  }

  private explicitGroup(id: string): string[] {
    if (!this.sibRoot.has(id)) return [];
    if (!this.groups) {
      this.groups = new Map();
      for (const k of this.sibRoot.keys()) push(this.groups, this.find(k), k);
    }
    return this.groups.get(this.find(id))!.filter((k) => k !== id);
  }

  person(id: string) {
    return this.people.get(id);
  }

  parentsOf(id: string): Edge<ParentSubtype>[] {
    return this.parents.get(id) ?? [];
  }

  childrenOf(id: string): Edge<ParentSubtype>[] {
    return this.children.get(id) ?? [];
  }

  spousesOf(id: string): Edge<SpouseSubtype>[] {
    return this.spouses.get(id) ?? [];
  }

  /** Blood/legal parents (biological or adoptive; not step or foster), including parents inferred via
   * explicit full siblings. */
  bloodParents(id: string): string[] {
    const set = new Set(this.parentsOf(id).filter((e) => isBloodEdge(e.subtype)).map((e) => e.id));
    // Explicit full siblings are assumed to share parents unless parents are recorded for this person.
    if (set.size === 0) {
      for (const s of this.explicitGroup(id)) {
        for (const e of this.parentsOf(s)) if (isBloodEdge(e.subtype)) set.add(e.id);
      }
    }
    return [...set];
  }

  /** Upward neighbours for ancestry search; adds a virtual node for parentless sibling groups. */
  private upNodes(id: string): string[] {
    const ps = this.bloodParents(id);
    if (ps.length) return ps;
    if (id.startsWith('~')) return [];
    const group = this.explicitGroup(id);
    if (group.length) return ['~sib:' + this.find(id)];
    return [];
  }

  /** All ancestors with generation distance; self at 0. `via` = first parent step taken. */
  ancestors(id: string): Map<string, { dist: number; via?: string }> {
    const out = new Map<string, { dist: number; via?: string }>([[id, { dist: 0 }]]);
    let frontier = [id];
    let dist = 0;
    while (frontier.length && dist < 60) {
      dist++;
      const next: string[] = [];
      for (const n of frontier) {
        const via = out.get(n)!.via;
        for (const p of this.upNodes(n)) {
          if (out.has(p)) continue;
          out.set(p, { dist, via: via ?? p });
          next.push(p);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Siblings: share at least one blood parent, or an explicit sibling edge (step/half edges win).
   * An explicit half edge A–B also makes A a half-sibling of B's full siblings (they share B's parents);
   * step edges are never chained. */
  siblingsOf(id: string): { id: string; half: boolean; step?: boolean }[] {
    const res: Map<string, { half: boolean; step?: boolean }> = this.sharedParentSiblings(id);
    const loose = this.looseSiblings.get(id) ?? [];
    // Half edge from me to B: B's full siblings are my half-siblings too.
    for (const e of loose) {
      if (e.subtype !== 'half') continue;
      for (const [c, v] of this.sharedParentSiblings(e.id)) {
        if (c !== id && !v.half && !res.has(c)) res.set(c, { half: true });
      }
    }
    // Reverse: my full sibling B has a half edge to A.
    for (const [b, v] of [...res]) {
      if (v.half) continue;
      for (const e of this.looseSiblings.get(b) ?? []) {
        if (e.subtype === 'half' && e.id !== id && !res.has(e.id)) res.set(e.id, { half: true });
      }
    }
    for (const e of loose) {
      res.set(e.id, e.subtype === 'step' ? { half: false, step: true } : { half: true });
    }
    return [...res].map(([sid, v]) => ({ id: sid, ...v }));
  }

  /** Siblings through shared blood parents or an explicit full/adoptive/untyped group (no loose edges). */
  private sharedParentSiblings(id: string): Map<string, { half: boolean }> {
    const mine = new Set(this.bloodParents(id));
    const res = new Map<string, { half: boolean }>();
    for (const p of mine) {
      for (const c of this.childrenOf(p)) {
        if (c.id === id || !isBloodEdge(c.subtype)) continue;
        const theirs = new Set(this.bloodParents(c.id));
        const shared = [...mine].filter((x) => theirs.has(x)).length;
        const half = shared < 2 && mine.size >= 2 && theirs.size >= 2;
        res.set(c.id, { half: (res.get(c.id)?.half ?? true) && half });
      }
    }
    for (const s of this.explicitGroup(id)) if (!res.has(s)) res.set(s, { half: false });
    return res;
  }

  /** Everyone reachable through family edges only (friends are never included). */
  familyComponent(id: string): Set<string> {
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of this.familyNeighbors(n)) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          stack.push(m.id);
        }
      }
    }
    return seen;
  }

  /** Direct family neighbours with the step word from `id`'s perspective. */
  familyNeighbors(id: string): { id: string; step: Step }[] {
    const out: { id: string; step: Step }[] = [];
    for (const e of this.parentsOf(id)) out.push({ id: e.id, step: { kind: 'parent', sub: e.subtype } });
    for (const e of this.childrenOf(id)) out.push({ id: e.id, step: { kind: 'child', sub: e.subtype } });
    for (const e of this.spousesOf(id)) out.push({ id: e.id, step: { kind: 'spouse', sub: e.subtype } });
    for (const s of this.siblingsOf(id)) out.push({ id: s.id, step: { kind: 'sibling', half: s.half, step: s.step } });
    return out;
  }
}

/** Parent edges that carry blood/legal descent. Step and foster do not. */
function isBloodEdge(sub: ParentSubtype | undefined) {
  return sub !== 'step' && sub !== 'foster';
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) {
    if (!arr.some((x) => JSON.stringify(x) === JSON.stringify(v))) arr.push(v);
  } else m.set(k, [v]);
}

export type Step =
  | { kind: 'parent'; sub?: ParentSubtype }
  | { kind: 'child'; sub?: ParentSubtype }
  | { kind: 'spouse'; sub?: SpouseSubtype }
  | { kind: 'sibling'; half?: boolean; step?: boolean };

// ---------------------------------------------------------------------------
// Words

const W = {
  parent: ['Father', 'Mother', 'Parent'],
  child: ['Son', 'Daughter', 'Child'],
  sibling: ['Brother', 'Sister', 'Sibling'],
  spouse: ['Husband', 'Wife', 'Spouse'],
  grandparent: ['Grandfather', 'Grandmother', 'Grandparent'],
  grandchild: ['Grandson', 'Granddaughter', 'Grandchild'],
  uncle: ['Uncle', 'Aunt', 'Uncle/Aunt'],
  nephew: ['Nephew', 'Niece', 'Nephew/Niece'],
} as const;

export function g(gender: Gender | undefined, words: readonly [string, string, string]): string {
  return gender === 'male' ? words[0] : gender === 'female' ? words[1] : words[2];
}

const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
function ordinal(n: number) {
  return ORD[n] ?? `${n}th`;
}
function times(n: number) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}
function greats(n: number): string {
  if (n <= 0) return '';
  if (n <= 2) return 'Great-'.repeat(n);
  return `${n}× Great-`;
}
function lowerFirst(s: string) {
  return s.replace(/(^|-)(\w)/g, (_m, a, b) => a + b.toLowerCase());
}

function stepWord(step: Step, gender: Gender): string {
  switch (step.kind) {
    case 'parent':
      return step.sub === 'step' ? 'Step' + g(gender, W.parent).toLowerCase()
        : step.sub === 'adoptive' ? 'Adoptive ' + g(gender, W.parent).toLowerCase()
          : step.sub === 'foster' ? 'Foster ' + g(gender, W.parent).toLowerCase()
            : g(gender, W.parent);
    case 'child':
      return step.sub === 'step' ? 'Step' + g(gender, W.child).toLowerCase()
        : step.sub === 'adoptive' ? 'Adopted ' + g(gender, W.child).toLowerCase()
          : step.sub === 'foster' ? 'Foster ' + g(gender, W.child).toLowerCase()
            : g(gender, W.child);
    case 'spouse':
      return (step.sub === 'divorced' ? 'Ex-' + g(gender, W.spouse).toLowerCase() : g(gender, W.spouse));
    case 'sibling':
      return step.step ? 'Step' + g(gender, W.sibling).toLowerCase()
        : step.half ? 'Half-' + g(gender, W.sibling).toLowerCase() : g(gender, W.sibling);
  }
}

// ---------------------------------------------------------------------------
// Kinship

export type KinCategory =
  | 'self'
  | 'spouse'
  | 'parents'
  | 'siblings'
  | 'children'
  | 'grandparents'
  | 'grandchildren'
  | 'ancestors'
  | 'descendants'
  | 'uncles'
  | 'nephews'
  | 'cousins'
  | 'inlaws'
  | 'other';

export const CATEGORY_LABELS: Record<KinCategory, string> = {
  self: 'You',
  spouse: 'Spouse',
  parents: 'Parents',
  siblings: 'Siblings',
  children: 'Children',
  grandparents: 'Grandparents',
  grandchildren: 'Grandchildren',
  ancestors: 'Ancestors',
  descendants: 'Descendants',
  uncles: 'Uncles & aunts',
  nephews: 'Nephews & nieces',
  cousins: 'Cousins',
  inlaws: 'In-laws & by marriage',
  other: 'Other relatives',
};

export const CATEGORY_ORDER: KinCategory[] = [
  'self', 'spouse', 'parents', 'siblings', 'children', 'grandparents', 'grandchildren',
  'uncles', 'nephews', 'cousins', 'ancestors', 'descendants', 'inlaws', 'other',
];

export interface Kinship {
  label: string; // "First cousin once removed"
  path: string; // "Father's brother's son"
  category: KinCategory;
  side?: 'paternal' | 'maternal';
  /** Generation relative to ego: +1 parents, -1 children. */
  generation: number;
  /** Lower = closer. */
  degree: number;
  blood: boolean;
}

interface Blood {
  up: number;
  down: number;
  side?: 'paternal' | 'maternal';
  half: boolean;
}

/** Find consanguinity between a and b via the closest common ancestor. */
export function bloodRelation(graph: FamilyGraph, a: string, b: string, aAnc = graph.ancestors(a)): Blood | undefined {
  const bAnc = graph.ancestors(b);
  let best: { up: number; down: number; node: string } | undefined;
  let commonAtBest = 0;
  for (const [node, ia] of aAnc) {
    const ib = bAnc.get(node);
    if (!ib) continue;
    const score = ia.dist + ib.dist;
    if (!best || score < best.up + best.down || (score === best.up + best.down && ia.dist < best.up)) {
      best = { up: ia.dist, down: ib.dist, node };
      commonAtBest = 1;
    } else if (best && ia.dist === best.up && ib.dist === best.down) {
      commonAtBest++;
    }
  }
  if (!best) return undefined;
  let side: Blood['side'];
  if (best.up >= 2) {
    const via = aAnc.get(best.node)?.via;
    const vg = via ? graph.person(via)?.gender : undefined;
    side = vg === 'male' ? 'paternal' : vg === 'female' ? 'maternal' : undefined;
  }
  // Half relation: only one shared ancestor where two exist on both sides.
  // Half-siblings: exactly one shared parent while both have two recorded.
  const half = best.up === 1 && best.down === 1 && commonAtBest === 1 && !best.node.startsWith('~') &&
    graph.bloodParents(a).length >= 2 && graph.bloodParents(b).length >= 2;
  return { up: best.up, down: best.down, side, half };
}

function bloodLabel(bl: Blood, gender: Gender): { label: string; category: KinCategory } {
  const { up, down, half } = bl;
  const h = half ? 'Half-' : '';
  if (up === 0 && down === 0) return { label: 'You', category: 'self' };
  if (down === 0) {
    if (up === 1) return { label: g(gender, W.parent), category: 'parents' };
    if (up === 2) return { label: g(gender, W.grandparent), category: 'grandparents' };
    return { label: greats(up - 2) + lowerFirst(g(gender, W.grandparent)), category: 'ancestors' };
  }
  if (up === 0) {
    if (down === 1) return { label: g(gender, W.child), category: 'children' };
    if (down === 2) return { label: g(gender, W.grandchild), category: 'grandchildren' };
    return { label: greats(down - 2) + lowerFirst(g(gender, W.grandchild)), category: 'descendants' };
  }
  if (up === 1 && down === 1) return { label: h ? h + g(gender, W.sibling).toLowerCase() : g(gender, W.sibling), category: 'siblings' };
  if (down === 1) {
    // uncle/aunt line: up=2 uncle, 3 great-uncle, 4 great-great-uncle
    const base = g(gender, W.uncle);
    return { label: up === 2 ? base : greats(up - 2) + base.toLowerCase(), category: 'uncles' };
  }
  if (up === 1) {
    const base = g(gender, W.nephew);
    return { label: down === 2 ? base : greats(down - 2) + base.toLowerCase(), category: 'nephews' };
  }
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  const label = `${ordinal(degree)} cousin${removed ? ' ' + times(removed) + ' removed' : ''}`;
  return { label, category: 'cousins' };
}

/** Shortest family path from a to b as words, e.g. "Father's brother's son". */
export function familyPath(graph: FamilyGraph, a: string, b: string): FamilyPath | undefined {
  if (a === b) return { steps: [], text: 'You' };
  return pathInTree(graph, familyPathTree(graph, a, b), a, b);
}

/** A family path from one person to another: steps in order, plus the words. */
export interface FamilyPath {
  steps: { id: string; step: Step }[];
  text: string;
}

/** The path from the tree's root `a` to `b`, as `familyPath` would return it; undefined if `b` is not in the tree. */
export function pathInTree(graph: FamilyGraph, prev: FamilyPathTree, a: string, b: string): FamilyPath | undefined {
  if (a === b) return { steps: [], text: 'You' };
  if (!prev.has(b)) return undefined;
  const steps: { id: string; step: Step }[] = [];
  let cur = b;
  while (cur !== a) {
    const p = prev.get(cur)!;
    steps.unshift({ id: cur, step: p.step });
    cur = p.from;
  }
  const words = steps.map((s) => stepWord(s.step, graph.person(s.id)?.gender ?? 'unknown'));
  const text = words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join("'s ");
  return { steps, text };
}

/** Predecessor of each node on its shortest family path from the BFS root. */
export type FamilyPathTree = Map<string, { from: string; step: Step }>;

/**
 * Shortest-path tree of family links from `a` (breadth-first, neighbours tried in `order`).
 * Every node's predecessor is fixed when it is first reached, independent of `stopAt`, so the
 * tree with or without `stopAt` gives the same path to each node it contains. `familyPath` and
 * `regionalTermsFor` both rely on that: one full tree answers every target identically.
 * `stopAt` ends the search after the level that reaches it.
 */
export function familyPathTree(graph: FamilyGraph, a: string, stopAt?: string): FamilyPathTree {
  const prev: FamilyPathTree = new Map();
  const seen = new Set([a]);
  let frontier = [a];
  while (frontier.length && !(stopAt !== undefined && seen.has(stopAt))) {
    const next: string[] = [];
    for (const n of frontier) {
      // prefer sibling/spouse words first for nicer phrasing
      const nb = graph.familyNeighbors(n).sort((x, y) => order(x.step) - order(y.step));
      for (const m of nb) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        prev.set(m.id, { from: n, step: m.step });
        next.push(m.id);
      }
    }
    frontier = next;
  }
  return prev;
}

/** Neighbour preference for path search; within a kind, blood/current links beat step/foster/ex links. */
function order(s: Step) {
  const base = s.kind === 'sibling' ? 0 : s.kind === 'parent' ? 1 : s.kind === 'child' ? 2 : 3;
  const weak = s.kind === 'sibling' ? !!s.step
    : s.kind === 'spouse' ? s.sub === 'divorced'
      : !isBloodEdge(s.sub);
  return base + (weak ? 0.5 : 0);
}

/** Full kinship of `b` from `a`'s point of view, or undefined if not family-connected. */
export function kinship(graph: FamilyGraph, a: string, b: string, aAnc = graph.ancestors(a),
  /** Precomputed `familyPath(graph, a, b)` (e.g. from one `familyPathTree` for many targets); null = not connected. */
  knownPath?: FamilyPath | null): Kinship | undefined {
  const target = graph.person(b);
  if (!target) return undefined;
  const gender = target.gender;
  if (a === b) return { label: 'You', path: 'You', category: 'self', generation: 0, degree: 0, blood: true };

  const path = knownPath === undefined ? familyPath(graph, a, b) : knownPath;
  if (!path) return undefined;

  // Direct non-blood links first (step-parents, spouses).
  const direct = path.steps.length === 1 ? path.steps[0].step : undefined;
  if (direct?.kind === 'spouse') {
    return { label: stepWord(direct, gender), path: path.text, category: 'spouse', generation: 0, degree: 1, blood: false };
  }
  if (direct?.kind === 'parent' && !isBloodEdge(direct.sub)) {
    return { label: stepWord(direct, gender), path: path.text, category: 'parents', generation: 1, degree: 1, blood: false };
  }
  if (direct?.kind === 'child' && !isBloodEdge(direct.sub)) {
    return { label: stepWord(direct, gender), path: path.text, category: 'children', generation: -1, degree: 1, blood: false };
  }
  if (direct?.kind === 'sibling' && direct.step) {
    return { label: stepWord(direct, gender), path: path.text, category: 'siblings', generation: 0, degree: 3, blood: false };
  }

  const bl = bloodRelation(graph, a, b, aAnc);
  if (bl) {
    const { label, category } = bloodLabel(bl, gender);
    let lab = label;
    if (direct?.kind === 'parent' && direct.sub && direct.sub !== 'biological') lab = stepWord(direct, gender);
    if (direct?.kind === 'child' && direct.sub && direct.sub !== 'biological') lab = stepWord(direct, gender);
    if (direct?.kind === 'sibling' && direct.half) lab = stepWord(direct, gender);
    return { label: lab, path: path.text, category, side: bl.side, generation: bl.up - bl.down, degree: bl.up + bl.down, blood: true };
  }
  // Explicit half-sibling with no recorded shared parent: still a blood sibling.
  if (direct?.kind === 'sibling' && direct.half) {
    return { label: stepWord(direct, gender), path: path.text, category: 'siblings', generation: 0, degree: 2, blood: true };
  }

  // Foster sibling: we share a parent and at least one of us is that parent's foster child.
  if (areFosterSiblings(graph, a, b)) {
    return { label: 'Foster ' + g(gender, W.sibling).toLowerCase(), path: path.text, category: 'siblings', generation: 0, degree: 3, blood: false };
  }

  // Step-sibling: child of my step-parent / my parent's spouse (or the reverse).
  if (areStepSiblings(graph, a, b) || areStepSiblings(graph, b, a)) {
    return { label: 'Step' + g(gender, W.sibling).toLowerCase(), path: path.text, category: 'siblings', generation: 0, degree: 3, blood: false };
  }

  // Affinal: through a spouse (mine or theirs).
  const affinal = affinalLabel(graph, a, b, aAnc);
  if (affinal) return { ...affinal, path: path.text, blood: false };

  // No named relation: the path itself ("Son's half-sister") says more than "Relative".
  return {
    label: path.text,
    path: path.text,
    category: 'other',
    generation: 0,
    degree: path.steps.length + 2,
    blood: false,
  };
}

/** True when a and b share a parent and at least one of them is that parent's foster child (never step). */
function areFosterSiblings(graph: FamilyGraph, a: string, b: string): boolean {
  const bParents = new Map(graph.parentsOf(b).map((e) => [e.id, e.subtype]));
  for (const e of graph.parentsOf(a)) {
    if (!bParents.has(e.id)) continue;
    const bs = bParents.get(e.id);
    if (e.subtype === 'step' || bs === 'step') continue;
    if (e.subtype === 'foster' || bs === 'foster') return true;
  }
  return false;
}

/** True when one of b's parents is a's step-parent or the (non-divorced) spouse of a's parent. */
function areStepSiblings(graph: FamilyGraph, a: string, b: string): boolean {
  const aSide = new Set<string>();
  for (const p of graph.parentsOf(a)) {
    if (p.subtype === 'step') aSide.add(p.id);
    else if (isBloodEdge(p.subtype)) {
      for (const sp of graph.spousesOf(p.id)) if (sp.subtype !== 'divorced') aSide.add(sp.id);
    }
  }
  const aBlood = new Set(graph.bloodParents(a));
  for (const p of graph.parentsOf(b)) {
    if (!isBloodEdge(p.subtype)) continue;
    if (aSide.has(p.id) && !aBlood.has(p.id)) return true;
  }
  return false;
}

function affinalLabel(graph: FamilyGraph, a: string, b: string, aAnc: ReturnType<FamilyGraph['ancestors']>):
  Omit<Kinship, 'path' | 'blood'> | undefined {
  const target = graph.person(b)!;
  const gender = target.gender;

  // 1) Blood relative of my spouse.
  for (const sp of graph.spousesOf(a)) {
    if (sp.subtype === 'divorced') continue;
    const bl = bloodRelation(graph, sp.id, b);
    if (!bl) continue;
    const { label, category } = bloodLabel(bl, gender);
    const spWord = g(graph.person(sp.id)?.gender, W.spouse);
    let lab: string;
    let cat: KinCategory = 'inlaws';
    if (category === 'parents' || category === 'siblings' || category === 'grandparents') lab = `${label}-in-law`;
    else if (category === 'children') {
      lab = 'Step' + label.toLowerCase();
      cat = 'children';
    } else lab = `${spWord}'s ${label.toLowerCase()}`;
    return { label: lab, category: cat, generation: bl.up - bl.down, degree: bl.up + bl.down + 1 };
  }

  // 2) Spouse of my blood relative.
  for (const sp of graph.spousesOf(b)) {
    if (sp.subtype === 'divorced') continue;
    const bl = bloodRelation(graph, a, sp.id, aAnc);
    if (!bl) continue;
    const relGender = graph.person(sp.id)?.gender ?? 'unknown';
    const { label, category } = bloodLabel(bl, relGender);
    let lab: string;
    let cat: KinCategory = 'inlaws';
    let side = bl.side;
    switch (category) {
      case 'siblings':
        lab = g(gender, W.sibling) + '-in-law';
        break;
      case 'children':
        lab = g(gender, W.child) + '-in-law';
        break;
      case 'grandchildren':
        lab = g(gender, W.grandchild) + '-in-law';
        break;
      case 'parents':
        lab = 'Step' + g(gender, W.parent).toLowerCase();
        cat = 'parents';
        break;
      case 'grandparents':
        lab = 'Step-grand' + g(gender, W.parent).toLowerCase();
        cat = 'grandparents';
        break;
      case 'uncles':
        lab = g(gender, W.uncle) + ' (by marriage)';
        cat = 'uncles';
        break;
      default:
        lab = `${label}'s ${g(gender, W.spouse).toLowerCase()}`;
        side = bl.side;
    }
    return { label: lab, category: cat, side, generation: bl.up - bl.down, degree: bl.up + bl.down + 1 };
  }
  return undefined;
}

export interface Relative {
  person: Person;
  kin: Kinship;
}

/** Every family-connected person with kinship from ego's view, closest first. */
export function relativesOf(graph: FamilyGraph, ego: string): Relative[] {
  const comp = graph.familyComponent(ego);
  const aAnc = graph.ancestors(ego);
  // One shortest-path tree for every target; each path equals familyPath(graph, ego, id).
  const tree = familyPathTree(graph, ego);
  const out: Relative[] = [];
  for (const id of comp) {
    if (id === ego) continue;
    const p = graph.person(id);
    if (!p) continue;
    const kin = kinship(graph, ego, id, aAnc, pathInTree(graph, tree, ego, id) ?? null);
    if (kin) out.push({ person: p, kin });
  }
  out.sort((x, y) => x.kin.degree - y.kin.degree || y.kin.generation - x.kin.generation || x.person.firstName.localeCompare(y.person.firstName));
  return out;
}

/** Follow the father (or mother) line upward. */
export function directLine(graph: FamilyGraph, id: string, side: 'paternal' | 'maternal'): Person[] {
  const want: Gender = side === 'paternal' ? 'male' : 'female';
  const line: Person[] = [];
  const seen = new Set([id]);
  let cur = id;
  for (;;) {
    const parents = graph.parentsOf(cur).filter((e) => isBloodEdge(e.subtype)).map((e) => graph.person(e.id)!).filter(Boolean);
    const next = parents.find((p) => p.gender === want);
    if (!next || seen.has(next.id)) break;
    line.push(next);
    seen.add(next.id);
    cur = next.id;
  }
  return line;
}

export interface LineageStats {
  relatives: number;
  ancestors: number;
  descendants: number;
  generationsUp: number;
  generationsDown: number;
  earliest?: Person;
}

export function lineageStats(graph: FamilyGraph, ego: string, relatives = relativesOf(graph, ego)): LineageStats {
  let up = 0;
  let down = 0;
  let anc = 0;
  let desc = 0;
  let earliest: Person | undefined;
  let earliestKey = Infinity;
  for (const r of relatives) {
    const { generation } = r.kin;
    if (generation > up) up = generation;
    if (-generation > down) down = -generation;
    if (r.kin.blood && ['parents', 'grandparents', 'ancestors'].includes(r.kin.category)) anc++;
    if (r.kin.blood && ['children', 'grandchildren', 'descendants'].includes(r.kin.category)) desc++;
    // Only ancestors with a known birth year qualify; otherwise there is no meaningful "earliest".
    const by = parseInt(r.person.birthDate ?? '', 10);
    if (r.kin.blood && r.kin.generation > 0 && Number.isFinite(by) && by < earliestKey) {
      earliestKey = by;
      earliest = r.person;
    }
  }
  return { relatives: relatives.length, ancestors: anc, descendants: desc, generationsUp: up, generationsDown: down, earliest };
}
