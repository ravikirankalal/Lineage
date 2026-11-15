import { beforeEach, describe, expect, it } from 'vitest';
import { forgetAll, recallSearch, recallView, rememberSearch, rememberView } from '../viewMemory';

describe('tree view memory', () => {
  beforeEach(() => forgetAll());
  it('keeps a view per key and the last settings per page', () => {
    rememberView('map:me|extended|cross|me', { x: 10, y: 20, k: 0.7 });
    rememberView('map:me|immediate|cross|me', { x: 1, y: 2, k: 1.2 });
    expect(recallView('map:me|extended|cross|me')).toEqual({ x: 10, y: 20, k: 0.7 });
    expect(recallView('map:me|everyone|cross|me')).toBeUndefined();
    rememberSearch('map:me', 'level=immediate&dir=cross');
    expect(recallSearch('map:me')).toBe('level=immediate&dir=cross');
  });
  it('keeps only the most recent views', () => {
    for (let i = 0; i < 70; i++) rememberView(`k${i}`, { x: i, y: 0, k: 1 });
    expect(recallView('k0')).toBeUndefined();
    expect(recallView('k69')).toEqual({ x: 69, y: 0, k: 1 });
  });
});
