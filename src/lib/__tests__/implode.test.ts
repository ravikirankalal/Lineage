import { describe, expect, it } from 'vitest';
import { CARD, type TreeNode } from '../graph/contract';
import { implodeOffsets, treeOf } from '../implode';
import { layoutFamily } from '../tree';
import { generatedFamily } from './families';

const node = (key: string, x: number, y: number): TreeNode => ({ key, personId: key, x, y, generation: 0, role: 'relative' } as TreeNode);
const W = CARD.w;
const H = CARD.h;

describe('implode: a wall of cards', () => {
  // Columns 416 apart (wider than a card), rows with gaps, a tree stacked far below.
  const nodes = [
    node('me', 0, 0), node('up', 0, -230), node('up2', 0, -460), node('down', 0, 300), node('far', 0, 2000),
    node('left', -416, -115), node('left2', -416, 115), node('right', 416, 200), node('right2', 832, -50),
  ];
  const off = implodeOffsets(nodes, { x: 0, y: 0 });
  const at = (k: string, phase: 1 | 2) => {
    const n = nodes.find((m) => m.key === k)!;
    const o = off.get(k)!;
    return { x: n.x + (phase === 2 ? o.dx : 0), y: n.y + o.dy };
  };

  it('phase 1: each column stacks flush (no gaps, no overlap), order kept, nearest card on the row', () => {
    expect(['up2', 'up', 'me', 'down', 'far'].map((k) => at(k, 1).y)).toEqual([-2 * H, -H, 0, H, 2 * H]);
    expect(['left', 'left2'].map((k) => at(k, 1).y)).toEqual([0, H]); // -115 is nearest the row (ties go to the first)
    expect(at('right', 1)).toEqual({ x: 416, y: 0 });
  });

  it('phase 2: columns close up side by side, the focus column staying put', () => {
    expect(at('me', 2).x).toBe(0);
    expect(at('left', 2).x).toBe(-W);
    expect(at('right', 2).x).toBe(W);
    expect(at('right2', 2).x).toBe(2 * W);
  });

  it('no two cards overlap in the wall', () => {
    const boxes = nodes.map((n) => at(n.key, 2));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(Math.abs(a.x - b.x) >= W || Math.abs(a.y - b.y) >= H, `${nodes[i].key} vs ${nodes[j].key}`).toBe(true);
    }
  });
});

describe('implode: every tree in Everyone packs on its own', () => {
  for (const seed of [1, 2, 3, 4]) it(`generated family ${seed}: separate walls, each around its own root, no overlaps`, () => {
    const G = generatedFamily(120, seed);
    const focus = [...G.people.keys()][0];
    const L = layoutFamily(G, { focusId: focus, level: 'everyone', expanded: new Set(), orient: 'cross' });
    const focusNode = L.nodes.find((n) => n.role === 'focus')!;
    const off = implodeOffsets(L.nodes, { x: focusNode.x, y: focusNode.y });
    const trees = new Set(L.nodes.map((n) => treeOf(n.key)));
    expect(trees.size, 'the family should draw more than one tree').toBeGreaterThan(1);
    const wall = L.nodes.map((n) => ({ n, x: n.x + off.get(n.key)!.dx, y: n.y + off.get(n.key)!.dy }));
    // Each tree's wall stays within its own tree's rows, so walls never meet across trees.
    for (const t of trees) {
      const mine = wall.filter((w) => treeOf(w.n.key) === t);
      const top = Math.min(...mine.map((w) => w.n.y)), bottom = Math.max(...mine.map((w) => w.n.y));
      for (const w of mine) expect(w.y >= top - 0.5 && w.y <= bottom + 0.5, `${t || 'main'} ${w.n.key}`).toBe(true);
      const root = t ? mine.find((w) => w.n.treeRoot) : mine.find((w) => w.n === focusNode);
      expect(root, `${t || 'main'} has a root`).toBeTruthy();
      expect(root!.x).toBe(root!.n.x);
      expect(root!.y).toBe(root!.n.y);
    }
    for (let i = 0; i < wall.length; i++) for (let j = i + 1; j < wall.length; j++) {
      const a = wall[i], b = wall[j];
      expect(Math.abs(a.x - b.x) >= W - 0.5 || Math.abs(a.y - b.y) >= H - 0.5, `${a.n.key} vs ${b.n.key}`).toBe(true);
    }
  });
});
