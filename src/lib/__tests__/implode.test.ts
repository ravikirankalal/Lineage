import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../graph/contract';
import { implodeOffsets, SHRINK, STACK_STEP } from '../implode';

const node = (key: string, x: number, y: number): TreeNode => ({ key, personId: key, x, y, generation: 0, role: 'relative' } as TreeNode);

describe('implode', () => {
  const nodes = [node('me', 0, 0), node('up', 0, -200), node('down', 0, 300), node('left', -400, -100), node('right', 400, 100)];
  const off = implodeOffsets(nodes, { x: 0, y: 0 });
  const at = (k: string, phase: 1 | 2) => {
    const n = nodes.find((m) => m.key === k)!;
    const o = off.get(k)!;
    return { x: n.x + (phase === 2 ? o.dx : 0), y: n.y + o.dy, z: o.z };
  };

  it('phase 1: every card lands on the focus row, piled per column, nearest on top', () => {
    expect(at('me', 1)).toMatchObject({ x: 0, y: 0 });
    expect(at('up', 1).y).toBe(-STACK_STEP); // 200 away: second in the pile
    expect(at('down', 1).y).toBe(-2 * STACK_STEP); // 300 away: third
    expect(at('me', 1).z).toBeGreaterThan(at('up', 1).z);
    expect(at('up', 1).z).toBeGreaterThan(at('down', 1).z);
    expect(at('left', 1)).toMatchObject({ x: -400, y: 0 }); // alone in its column
    for (const k of ['me', 'up', 'down', 'left', 'right']) expect(Math.abs(at(k, 1).y)).toBeLessThanOrEqual(2 * STACK_STEP);
  });

  it('phase 2: the columns slide together around the focus', () => {
    expect(at('left', 2).x).toBeCloseTo(-400 * SHRINK);
    expect(at('right', 2).x).toBeCloseTo(400 * SHRINK);
    expect(at('me', 2).x).toBe(0);
  });
});
