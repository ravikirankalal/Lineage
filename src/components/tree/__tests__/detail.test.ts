import { describe, expect, it } from 'vitest';
import { detailFor } from '../detail';

describe('card detail by zoom', () => {
  it('four levels from zoomed out to zoomed in', () => {
    expect([0.25, 0.4, 0.6, 1, 1.5, 2].map((k) => detailFor(k))).toEqual([1, 1, 2, 3, 4, 4]);
  });
  it('stays put near a boundary (no flicker), changes once clearly past it', () => {
    expect(detailFor(0.81, 2)).toBe(2); // just over 0.8: still compact
    expect(detailFor(0.84, 2)).toBe(3);
    expect(detailFor(0.79, 3)).toBe(3); // just under 0.8: still standard
    expect(detailFor(0.76, 3)).toBe(2);
    expect(detailFor(0.25, 4)).toBe(1); // a big jump goes straight there
  });
});
