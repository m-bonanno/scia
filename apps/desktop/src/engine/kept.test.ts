import { describe, expect, it } from 'vitest';
import { Kept } from './kept.ts';

describe('Kept', () => {
  it('holds every thing it is given, up to its limit', () => {
    const kept = new Kept<string>(3);

    kept.keep('a');
    kept.keep('b');

    expect(kept.held()).toEqual(['a', 'b']);
  });

  it('lets the oldest go when a new one would pass the limit', () => {
    const kept = new Kept<string>(3);

    for (const thing of ['a', 'b', 'c', 'd', 'e']) kept.keep(thing);

    expect(kept.held()).toEqual(['c', 'd', 'e']);
  });

  it('lets go of the one it is told to, and of nothing else', () => {
    const kept = new Kept<string>(3);
    for (const thing of ['a', 'b', 'c']) kept.keep(thing);

    kept.release('b');
    kept.release('never kept');

    expect(kept.held()).toEqual(['a', 'c']);
  });
});
