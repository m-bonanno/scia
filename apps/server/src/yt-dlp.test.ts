import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPrefixOf } from './yt-dlp.ts';

describe('runPrefixOf', () => {
  const profile = join('profiles', 'someone', 'engine');

  it('names the folders of each profile’s runs apart, the same at every start (#174)', () => {
    const prefix = runPrefixOf(profile);

    expect(runPrefixOf(profile)).toBe(prefix);
    expect(runPrefixOf(join('profiles', 'another', 'engine'))).not.toBe(prefix);
  });

  it('names them without the profile’s path, which names the person’s account', () => {
    expect(runPrefixOf(profile)).not.toMatch(/profiles|someone|engine|[\\/]/);
  });
});
