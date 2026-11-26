import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runsFolderOf } from './yt-dlp.ts';

describe('runsFolderOf', () => {
  const temp = join('temp');
  const profile = join('profiles', 'someone', 'engine');

  it('gives each profile a folder of its own in the system’s temporary one, the same at every start (#174)', () => {
    const folder = runsFolderOf(temp, profile);

    expect(dirname(folder)).toBe(temp);
    expect(runsFolderOf(temp, profile)).toBe(folder);
    expect(runsFolderOf(temp, join('profiles', 'another', 'engine'))).not.toBe(folder);
  });

  it('names the folder without the profile’s path, which names the person’s account', () => {
    expect(basename(runsFolderOf(temp, profile))).not.toMatch(/profiles|someone|engine/);
  });
});
