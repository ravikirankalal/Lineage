import { CARD, type TreeEdge, type TreeLayout, type TreeNode, type TreeOptions, type TreeRegion } from './graph/contract';
import { generationLabel } from './generationBands';
import type { FamilyGraph } from './kinship';

/**
 * "Cross" family layout (the owner's design for tall phone screens), centred on the focus:
 *
 *   [father's side] ← [cousins, siblings & spouses] → [mother's side]
 *
 * - Middle: the focus and their siblings in one column, brothers ABOVE the focus and sisters (and
 *   siblings of unknown gender) BELOW, each group oldest first. Each sibling's spouse sits directly below
 *   them in the same column, joined by a short marriage line. Cousins share this column too (the owner's
 *   choice): children of the parents' brothers above, children of the parents' sisters below, each level
 *   with their own parent. Children are not shown in this view (the owner's choice); the other layouts are.
 * - Left: the father, with his brothers above him and sisters below, each person's spouse directly below
 *   them with a marriage line (a step-parent below the parent); his parents one column further
 *   left (father's father above father's mother), and so on outwards. Right: the same for the mother,
 *   mirrored. So every step outwards is one generation older.
 * - Lines only run through the gaps between columns and rows, so no line crosses a card.
 *
 * - Every ancestor's brothers (above) and sisters (below) bring their families: their children one column
 *   further in, level with them, and so on down to the focus's column (parents' cousins in the parents'
 *   column, second cousins beside the focus). Everyone in the focus's column has their spouse below them.
 *   Each such couple's children start collapsed: the card's button (`expanded`) shows them.
 *
 * Levels: immediate (siblings without their spouses, ancestors' siblings hidden), extended (+ siblings'
 * spouses, parents' brothers and sisters with their children), everyone (+ every ancestor's brothers and
 * sisters with their descendants, all generations up). `expanded` shows one sibling's spouse or one ancestor's siblings/parents.
 */

const PC = CARD.w + 44; // column pitch
const RP = CARD.h + 24; // row pitch
const GX = PC - CARD.w; // gap between columns (lines run here)
const W2 = CARD.w / 2;
const H2 = CARD.h / 2;
const MANY = 99;

const isBlood = (sub: string | undefined) => sub !== 'step' && sub !== 'foster';
function birthYear(g: FamilyGraph, id: string) {
  const b = g.person(id)?.birthDate;
  return b ? parseInt(b, 10) || 9999 : 9999;
}
function byBirth(g: FamilyGraph) {
  return (a: string, b: string) =>
    birthYear(g, a) - birthYear(g, b) || (g.person(a)?.firstName ?? '').localeCompare(g.person(b)?.firstName ?? '') || (a < b ? -1 : a > b ? 1 : 0);
}
class Cross {
  readonly nodes: TreeNode[] = [];
  readonly edges: TreeEdge[] = [];
  readonly regions: TreeRegion[] = [];
  private placed = new Map<string, string>();
  private byId = new Map<string, TreeNode>();
  private dupN = 0;
  private edgeN = 0;
  private up: number;

  /** People whose main card is in their birth family: a spouse slot for them is a secondary stub. */
  private pendingStubs: TreeNode[] = [];

  constructor(private g: FamilyGraph, private opts: TreeOptions, private reserved: ReadonlySet<string> = new Set()) {
    this.up = opts.up ?? (opts.level === 'everyone' ? MANY : 4);
  }

  private exp(id: string) {
    return this.opts.expanded.has(id);
  }

  /** Cards drawn beside a partner (a spouse, or a wife below her husband on an ancestor line). */
  readonly partnerNodes = new Set<TreeNode>();

  node(id: string, role: TreeNode['role'], gen: number, x: number, y: number, flags: Partial<TreeNode> = {}, partner = false): TreeNode {
    let n: TreeNode;
    if (this.placed.has(id)) {
      n = { key: `dup:${id}:${this.dupN++}`, personId: id, dupOf: this.placed.get(id), x, y, generation: gen, role };
    } else if (partner && this.reserved.has(id)) {
      n = { key: `dup:${id}:${this.dupN++}`, personId: id, dupOf: '?', x, y, generation: gen, role };
      this.pendingStubs.push(n);
    } else {
      n = { key: `${role}:${id}`, personId: id, x, y, generation: gen, role, ...flags };
      this.placed.set(id, n.key);
      this.byId.set(id, n);
      if (this.exp(id)) n.expanded = true;
    }
    this.nodes.push(n);
    if (partner) this.partnerNodes.add(n);
    return n;
  }
  ghost(which: 'father' | 'mother', x: number, y: number): TreeNode {
    const n: TreeNode = { key: 'ghost:' + which, ghost: which, x, y, generation: 1, role: 'ghost' };
    this.nodes.push(n);
    return n;
  }
  edge(kind: TreeEdge['kind'], points: [number, number][], from: string, to: string): TreeEdge {
    return { key: `${kind}:${from}:${to}:${this.edgeN++}`, kind, points, from, to };
  }
  descentKind(parent: string, child: string): TreeEdge['kind'] {
    return isBlood(this.g.parentsOf(child).find((e) => e.id === parent)?.subtype) ? 'descent' : 'step';
  }
  /** A recorded parent, or one inferred through an explicit full/untyped sibling link (as kinship does). */
  childOf(parent: string, child: string) {
    return this.isParent(parent, child) || this.g.bloodParents(child).includes(parent);
  }
  isParent(parent: string, child: string) {
    return this.g.parentsOf(child).some((e) => e.id === parent);
  }

  /** Blood parents, father first (at most two). */
  parents(id: string): string[] {
    const ps = this.g.bloodParents(id);
    const rank = (p: string) => (this.g.person(p)?.gender === 'male' ? 0 : this.g.person(p)?.gender === 'female' ? 1 : 2);
    return ps.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)).slice(0, 2);
  }

  /** p with siblings: brothers above (oldest first), then p, then sisters and others (oldest first). */
  siblingColumn(p: string, withSiblings: boolean): { ids: string[]; info: Map<string, { half: boolean; step?: boolean }> } {
    const info = new Map<string, { half: boolean; step?: boolean }>();
    if (!withSiblings) return { ids: [p], info };
    for (const s of this.g.siblingsOf(p)) info.set(s.id, { half: s.half, step: s.step });
    const order = byBirth(this.g);
    const sibs = [...info.keys()];
    const brothers = sibs.filter((s) => this.g.person(s)?.gender === 'male').sort(order);
    const rest = sibs.filter((s) => this.g.person(s)?.gender !== 'male').sort(order);
    return { ids: [...brothers, p, ...rest], info };
  }

  /** Spouses plus co-parents of the person's children, ordered by first child, then name. */
  partners(p: string): string[] {
    const set = new Set(this.g.spousesOf(p).map((e) => e.id));
    for (const c of this.g.childrenOf(p)) for (const e of this.g.parentsOf(c.id)) if (e.id !== p) set.add(e.id);
    const kids = this.g.childrenOf(p).map((c) => c.id);
    const first = (s: string) => Math.min(9999, ...kids.filter((c) => this.isParent(s, c)).map((c) => birthYear(this.g, c)));
    const order = byBirth(this.g);
    return [...set].sort((a, b) => first(a) - first(b) || order(a, b));
  }

  /** An ancestor with their brothers (above) and sisters (below), when the level shows them. */
  ancestorGroup(p: string, gen: number) {
    const sideOk = this.opts.level === 'everyone' || (this.opts.level === 'extended' && gen === 1) || this.exp(p);
    return { sideOk, ...this.siblingColumn(p, sideOk) };
  }

  /**
   * Who sits below a person in an ancestor column, joined by a marriage line: for the ancestor on the
   * line, their other partners (not `linePartner`, the other parent of the child we came from); for their
   * brothers and sisters, every partner (when those siblings are shown).
   */
  columnPartners(id: string, p: string, sideOk: boolean, linePartner?: string, wife?: string): string[] {
    if (id === p) return [...(wife ? [wife] : []), ...this.partners(p).filter((x) => x !== linePartner && x !== wife)];
    return sideOk ? this.partners(id) : [];
  }

  /** x of a card column: generation `gen` on the father's side (dir −1) or the mother's (dir 1). */
  private colX(dir: number, gen: number) {
    return dir * gen * PC || 0; // never −0
  }

  private memo = new Map<string, number>();
  /**
   * Rows a brother's or sister's family takes in the cross layout: the person, their partners below them,
   * and beside them (one column further in per generation) their children, each with their own family,
   * down to the focus's generation (people there are drawn with their partners, without children).
   */
  bandRows(id: string, gen: number): number {
    if (gen <= 0) return 1 + this.partners(id).length; // the focus's generation: partners, no children
    const k = `${id}:${gen}`;
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    let kidRows = 0;
    if (this.exp(id)) for (const c of this.g.childrenOf(id)) kidRows += this.bandRows(c.id, gen - 1);
    const rows = Math.max(1 + this.partners(id).length, kidRows);
    this.memo.set(k, rows);
    return rows;
  }

  /** People left out because a couple's children are collapsed (so Everyone doesn't add them back). */
  readonly hidden = new Set<string>();
  private hideFamily(id: string, gen: number) {
    if (gen <= 0) return;
    for (const c of this.g.childrenOf(id)) {
      this.hidden.add(c.id);
      for (const sp of this.partners(c.id)) this.hidden.add(sp);
      this.hideFamily(c.id, gen - 1);
    }
  }

  /**
   * Draw a brother's or sister's family (see bandRows) with the person's card at `row`. Each child sits
   * level with the rows of their own family, the first one level with the parent, so lines run straight.
   */
  placeBand(id: string, gen: number, dir: number, row: number, yRow: (r: number) => number, flags: Partial<TreeNode> = {}): TreeNode {
    const x = this.colX(dir, gen);
    const n = this.node(id, 'relative', gen, x, yRow(row), flags);
    if (n.dupOf) return n;
    const partners = this.partners(id);
    this.partnerCards(id, partners, gen, dir, row, yRow, () => 'spouse');
    if (gen <= 0) return n;
    const kids = this.g.childrenOf(id).map((c) => c.id).sort(byBirth(this.g));
    if (!kids.length) return n;
    // Each couple's children start collapsed (the owner's choice): the card's button opens them.
    if (!this.exp(id)) {
      n.expandable = { ...n.expandable, down: true };
      this.hideFamily(id, gen);
      return n;
    }
    let r = row;
    const placed: { id: string; y: number }[] = [];
    for (const k of kids) {
      const kn = this.placeBand(k, gen - 1, dir, r, yRow);
      placed.push({ id: k, y: kn.y });
      r += this.bandRows(k, gen - 1);
    }
    const xb = dir * (gen * PC - PC / 2);
    this.childLines(id, n.y, partners, placed, dir, gen, xb, xb, true);
    return n;
  }

  /** Partner cards right below a person in their column, each joined by a marriage line. */
  partnerCards(id: string, partners: string[], gen: number, dir: number, row: number, yRow: (r: number) => number, role: (sp: string) => TreeNode['role']) {
    const x = this.colX(dir, gen);
    const y = yRow(row);
    const xLoop = x + (dir || -1) * (W2 + 10); // a later partner: round the outer side of the column
    const xOut = x + (dir || -1) * W2;
    partners.forEach((sp, j) => {
      const pn = this.node(sp, role(sp), gen, x, yRow(row + 1 + j), {}, true);
      const sub = this.g.spousesOf(id).find((e) => e.id === sp)?.subtype;
      const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
      this.edges.push(j === 0
        ? this.edge(kind, [[x, y + CARD.h], [x, pn.y]], id, sp)
        : this.edge(kind, [[xOut, y + H2], [xLoop, y + H2], [xLoop, pn.y + H2], [xOut, pn.y + H2]], id, sp));
    });
  }

  /**
   * Lines from a person in a side column (generation `gen`) to their children one column further in.
   * Children of the partner sitting directly below (the first one) hang from the middle of that marriage
   * line; children of a later partner from that partner's card; children with no partner shown from the
   * person's own card. Both parents' edges share the path.
   */
  childLines(person: string, personY: number, partners: string[], kids: { id: string; y: number }[], dir: number, gen: number,
    xbOwn: number, xbCouple: number, joinUnknown = false) {
    const xPar = this.colX(dir, gen);
    const xFrom = xPar - dir * W2; // the person's column, inner edge
    const edgeX = this.colX(dir, gen - 1) + dir * W2; // the children's column, outer edge
    for (const k of kids) {
      if (!this.childOf(person, k.id)) continue;
      let j = partners.findIndex((sp) => this.childOf(sp, k.id));
      // A child whose other parent isn't recorded at all joins the couple's single line (drawn from the
      // person only), so a family with one partner shown never gets two lines.
      const unknownOther = this.g.parentsOf(k.id).every((e) => e.id === person);
      const adopted = j < 0 && joinUnknown && partners.length > 0 && unknownOther;
      if (adopted) j = 0;
      let start: [number, number];
      let xbk = xbOwn;
      if (j === 0) {
        start = [xPar, personY + CARD.h + (RP - CARD.h) / 2];
        xbk = xbCouple;
      } else if (j > 0) {
        start = [xFrom, personY + (1 + j) * RP + H2];
        xbk = xbCouple;
      } else start = [xFrom, personY + H2];
      const yc = k.y + H2;
      const pts: [number, number][] = [start, [xbk, start[1]], [xbk, yc], [edgeX, yc]];
      for (const par of j >= 0 && !adopted ? [person, partners[j]] : [person]) {
        this.edges.push(this.edge(this.descentKind(par, k.id), pts.map((q) => [q[0], q[1]]), par, k.id));
      }
    }
  }

  build(): void {
    const g = this.g;
    const f = this.opts.focusId;
    const level = this.opts.level;

    // ---- the middle column: the focus with brothers above, sisters below, each spouse below them --
    // Rows are shared by the whole layout: this core first, then each generation outwards adds the
    // families of that generation's brothers (above everything so far) and sisters (below), on both sides.
    // So cousins, second cousins, … sit in their generation's column level with their own parent, and every
    // line runs straight across through the gaps.
    const { ids: column, info } = this.siblingColumn(f, true);
    interface Band { id: string; partners: string[]; open: boolean }
    const bands: Band[] = column.map((id) => {
      const open = id === f || level !== 'immediate' || this.exp(id);
      return { id, partners: open ? this.partners(id) : [], open };
    });
    const xS = 0;
    const ps = this.up >= 1 ? this.parents(f) : [];
    const dad = ps.find((p) => g.person(p)?.gender === 'male') ?? (ps.length === 2 ? ps[0] : undefined);
    const mom = ps.find((p) => p !== dad);

    let row = 0;
    const rowsOf = bands.map((bd) => {
      const start = row;
      row += 1 + bd.partners.length;
      return { start };
    });
    const focusRow = rowsOf[column.indexOf(f)].start;
    // Each parent's other partners (a step-parent) sit below them, level with the core.
    const parentPartners = new Map<string, string[]>();
    if (dad) parentPartners.set(dad, this.columnPartners(dad, dad, false, mom));
    if (mom) parentPartners.set(mom, this.columnPartners(mom, mom, false, dad));
    let top = 0;
    let bottom = Math.max(row, focusRow + 1 + Math.max(0, ...[...parentPartners.values()].map((l) => l.length)));
    const yRow = (r: number) => (r - focusRow) * RP;

    // The focus first so it is the primary card if anyone repeats.
    const order = [column.indexOf(f), ...column.map((_, i) => i).filter((i) => column[i] !== f)];
    const sibNodes = new Map<string, TreeNode>();
    // Spouse cards are made last: someone who also appears in their own birth family (a cousin who married
    // a sibling) gets their main card there, with their parents; the card beside the spouse is a secondary
    // "shown elsewhere" card that can't open their ancestors.
    const spouseCards: { id: string; y: number }[] = [];
    const fNode = this.node(f, 'focus', 0, xS, yRow(focusRow));
    sibNodes.set(f, fNode);
    for (const i of order) {
      const bd = bands[i];
      const { start } = rowsOf[i];
      const ys = yRow(start);
      const sNode = bd.id === f ? fNode : this.node(bd.id, 'sibling', 0, xS, ys, { half: info.get(bd.id)?.half || undefined, step: info.get(bd.id)?.step || undefined });
      sibNodes.set(bd.id, sNode);
      if (!bd.open) {
        if (!sNode.dupOf && g.spousesOf(bd.id).length) sNode.expandable = { down: true };
        continue;
      }
      if (sNode.dupOf) continue;
      const xLoop = xS - W2 - 10; // marriage line to a later partner, round the left of the column
      const yS = ys + H2;
      bd.partners.forEach((p, j) => {
        const py = yRow(start + 1 + j);
        spouseCards.push({ id: p, y: py });
        const sub = g.spousesOf(bd.id).find((e) => e.id === p)?.subtype;
        const kind: TreeEdge['kind'] = sub === 'divorced' || sub === 'separated' ? 'divorced' : 'marriage';
        if (j === 0) this.edges.push(this.edge(kind, [[xS, ys + CARD.h], [xS, py]], bd.id, p));
        else this.edges.push(this.edge(kind, [[xS - W2, yS], [xLoop, yS], [xLoop, py + H2], [xS - W2, py + H2]], bd.id, p));
      });
    }

    // ---- the sides: father's to the left, mother's to the right, one column per generation ------
    // Above the parents each side follows the father's line: a wife married into it sits right below her
    // husband and her own family isn't drawn here. (With only a mother known, her line continues.)
    interface Line { dir: -1 | 1; id: string; row: number; partners: string[]; wife?: string; node?: TreeNode; group?: TreeNode[] }
    let lines: Line[] = [];
    if (this.up >= 1) {
      if (dad) lines.push({ dir: -1, id: dad, row: focusRow, partners: parentPartners.get(dad)! });
      else if (this.opts.ghosts) this.ghost('father', xS - PC, fNode.y);
      if (mom) lines.push({ dir: 1, id: mom, row: focusRow, partners: parentPartners.get(mom)! });
      else if (this.opts.ghosts) this.ghost('mother', xS + PC, fNode.y);
    }
    for (let gen = 1; lines.length; gen++) {
      // The line ancestors of this generation, with their partners below them.
      for (const ln of lines) {
        ln.node = this.node(ln.id, 'ancestor', gen, this.colX(ln.dir, gen), yRow(ln.row));
        this.partnerCards(ln.id, ln.partners, gen, ln.dir, ln.row, yRow, (sp) => (sp === ln.wife ? 'ancestor' : 'spouse'));
      }
      if (gen === 1) {
        // The parents to the focus and siblings (half-siblings via a step-parent from that couple's line).
        for (const ln of lines) {
          const xb = ln.dir * (W2 + GX * 0.5);
          const xbStep = ln.dir * (W2 + GX * 0.25);
          this.childLines(ln.id, ln.node!.y, ln.partners, column.map((id) => ({ id, y: sibNodes.get(id)!.y })), ln.dir, 1, xb, xbStep);
        }
      }
      // Their brothers' families above everything drawn so far, sisters' below (father's side first).
      const above: { ln: Line; id: string }[] = [];
      const below: { ln: Line; id: string }[] = [];
      const infos = new Map<string, { half: boolean; step?: boolean }>();
      for (const ln of lines) {
        ln.group = [ln.node!];
        if (ln.node!.dupOf) continue;
        const hasSibs = g.siblingsOf(ln.id).some((x) => !this.placed.has(x.id));
        const grp = this.ancestorGroup(ln.id, gen);
        if (!grp.sideOk && hasSibs) ln.node!.expandable = { ...ln.node!.expandable, side: true };
        const at = grp.ids.indexOf(ln.id);
        for (const id of grp.ids.slice(0, at)) above.push({ ln, id });
        for (const id of grp.ids.slice(at + 1)) below.push({ ln, id });
        for (const [k, v] of grp.info) infos.set(k, v);
      }
      const flags = (id: string) => ({ half: infos.get(id)?.half || undefined, step: infos.get(id)?.step || undefined });
      let r = top - above.reduce((sum, a) => sum + this.bandRows(a.id, gen), 0);
      top = r;
      for (const a of above) {
        a.ln.group!.push(this.placeBand(a.id, gen, a.ln.dir, r, yRow, flags(a.id)));
        r += this.bandRows(a.id, gen);
      }
      for (const b of below) {
        b.ln.group!.push(this.placeBand(b.id, gen, b.ln.dir, bottom, yRow, flags(b.id)));
        bottom += this.bandRows(b.id, gen);
      }

      // The next generation: each line's parents, centred on this generation's group (couple: the middle
      // of their marriage line level with the middle of the group).
      const next: Line[] = [];
      for (const ln of lines) {
        const pn = ln.node!;
        if (pn.dupOf) continue;
        const pps = this.parents(ln.id);
        if (!pps.length) continue;
        if (gen + 1 > this.up && !this.exp(ln.id)) {
          pn.expandable = { ...pn.expandable, up: true };
          continue;
        }
        const [lineId, married] = pps;
        const partners = this.columnPartners(lineId, lineId, false, undefined, married);
        const rowsY = ln.group!.map((n) => n.y / RP + focusRow);
        const mid = (Math.min(...rowsY) + Math.max(...rowsY)) / 2;
        const couple = partners.length > 0;
        const hRow = couple ? mid - 0.5 : mid;
        top = Math.min(top, hRow);
        bottom = Math.max(bottom, hRow + 1 + partners.length);
        // ONE line from the couple to their children, from the middle of their marriage line.
        const x1 = this.colX(ln.dir, gen + 1);
        const xb = ln.dir * (gen * PC + PC / 2);
        const yq = couple ? yRow(hRow) + CARD.h + (RP - CARD.h) / 2 : yRow(hRow) + H2;
        const start: [number, number] = couple ? [x1, yq] : [x1 - ln.dir * W2, yq];
        for (const q of pps) {
          for (const c of ln.group!) {
            const cid = c.personId!;
            if (!this.childOf(q, cid)) continue;
            const yc = c.y + H2;
            this.edges.push(this.edge(this.descentKind(q, cid), [[start[0], start[1]], [xb, yq], [xb, yc], [this.colX(ln.dir, gen) + ln.dir * W2, yc]], q, cid));
          }
        }
        next.push({ dir: ln.dir, id: lineId, row: hRow, partners, wife: married });
      }
      lines = next;
    }
    for (const sc of spouseCards) this.node(sc.id, 'spouse', 0, xS, sc.y, {}, true);

    // Point the reserved spouse stubs at their birth cards.
    for (const n of this.pendingStubs) {
      const key = this.placed.get(n.personId!);
      if (key) n.dupOf = key;
      else {
        delete n.dupOf;
        n.key = `${n.role}:${n.personId}`;
        this.placed.set(n.personId!, n.key);
        this.byId.set(n.personId!, n);
      }
    }

    // An expanded card keeps its control so it can be collapsed again.
    for (const n of this.nodes) if (n.expanded && !n.dupOf && !n.expandable) n.expandable = { down: true };

    // ---- regions for the background: father's side | your generation | mother's side ----
    const leftEdge = xS - PC / 2;
    const rightEdge = xS + PC / 2;
    const sideColumns = (keep: (x: number) => boolean) => {
      const gens = new Map<number, Map<number, number>>();
      for (const n of this.nodes) {
        if (!keep(n.x)) continue;
        const m = gens.get(n.x) ?? new Map<number, number>();
        m.set(n.generation, (m.get(n.generation) ?? 0) + 1);
        gens.set(n.x, m);
      }
      return [...gens].sort((a, b) => a[0] - b[0]).map(([x, m]) => {
        const gen = [...m].sort((a, b) => b[1] - a[1])[0][0];
        return { x, label: gen === 0 ? 'Cousins' : generationLabel(gen) };
      });
    };
    const fatherCols = sideColumns((x) => x < leftEdge);
    const motherCols = sideColumns((x) => x > rightEdge);
    const middleCols: { x: number; label: string }[] = []; // one column: the region's title says it
    if (fatherCols.length) this.regions.push({ side: 'father', x0: -Infinity, x1: leftEdge, columns: fatherCols });
    this.regions.push({ side: 'middle', x0: leftEdge, x1: rightEdge, columns: middleCols });
    if (motherCols.length) this.regions.push({ side: 'mother', x0: rightEdge, x1: Infinity, columns: motherCols });
  }
}

/** Contract: `layoutFamily` with `orient: 'cross'`. */
export function layoutCross(graph: FamilyGraph, opts: TreeOptions): TreeLayout {
  if (!graph.person(opts.focusId)) return { nodes: [], edges: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  let c = new Cross(graph, opts);
  c.build();
  // Main-card rule: if someone's main card landed beside a spouse while they also appear in their birth
  // family, lay out again with that spouse slot reserved as a secondary card.
  const cards = new Map<string, TreeNode[]>();
  for (const n of c.nodes) if (n.personId) cards.set(n.personId, [...(cards.get(n.personId) ?? []), n]);
  const reserved = new Set<string>();
  for (const [id, ns] of cards) {
    const main = ns.find((n) => !n.dupOf);
    // (A grandmother who is also a blood relative drawn in her birth family counts too: her card below her
    // husband becomes the secondary one.)
    if (main && c.partnerNodes.has(main) && ns.some((n) => n.dupOf && !c.partnerNodes.has(n))) reserved.add(id);
  }
  if (reserved.size) {
    c = new Cross(graph, opts, reserved);
    c.build();
  }
  // Nodes made inside pedigree blocks are already in c.nodes (node() records every card once).
  const nodes = [...new Set(c.nodes)];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - W2);
    maxX = Math.max(maxX, n.x + W2);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + CARD.h);
  }
  for (const e of c.edges) for (const [x, y] of e.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // Open-ended regions reach the edge of the tree.
  const regions = c.regions.map((r) => ({ ...r, x0: Math.max(r.x0, minX - 20), x1: Math.min(r.x1, maxX + 20) }));
  const drawn = new Set(nodes.map((n) => n.personId));
  const hidden = [...c.hidden].filter((id) => !drawn.has(id));
  return { nodes, edges: c.edges, bounds: { minX, maxX, minY, maxY }, regions, ...(hidden.length ? { hidden } : {}) };
}
