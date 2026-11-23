import { describe, expect, it } from 'vitest';
import { windowInUse } from './foreground.ts';

describe('windowInUse (#62, ADR 0020)', () => {
  it('is in use when the system names its handle, and not when it names another', () => {
    expect(windowInUse(42n, 42n)).toBe(true);
    expect(windowInUse(7n, 42n)).toBe(false);
  });

  it('counts a system that did not answer as another window in use: a notification too many over one that never comes', () => {
    expect(windowInUse(undefined, 42n)).toBe(false);
  });
});
