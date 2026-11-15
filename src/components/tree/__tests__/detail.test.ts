import { describe, expect, it } from 'vitest';
import { detailFor } from '../detail';

describe('card detail by zoom', () => {
  it('five levels from zoomed out to zoomed in', () => {
    expect([0.25, 0.4, 0.6, 1, 1.5, 2].map((k) => detailFor(k))).toEqual([1, 2, 3, 4, 5, 5]);
  });
  it('stays put near a boundary (no flicker), changes once clearly past it', () => {
    expect(detailFor(0.81, 3)).toBe(3); // just over 0.8: still compact
    expect(detailFor(0.84, 3)).toBe(4);
    expect(detailFor(0.79, 4)).toBe(4); // just under 0.8: still standard
    expect(detailFor(0.76, 4)).toBe(3);
    expect(detailFor(0.25, 5)).toBe(1); // a big jump goes straight there
  });
});
