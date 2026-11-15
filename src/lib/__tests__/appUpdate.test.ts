import { describe, expect, it } from 'vitest';
import { buildIdOf } from '../appUpdate';

describe('app update check', () => {
  it('reads the build id from the page', () => {
    expect(buildIdOf('<script type="module" crossorigin src="./assets/index-BAZkONw0.js"></script>')).toBe('index-BAZkONw0');
    expect(buildIdOf('<script src="/assets/index-a_b-C1.js">')).toBe('index-a_b-C1');
    expect(buildIdOf('<html>no build</html>')).toBeNull();
  });
});
