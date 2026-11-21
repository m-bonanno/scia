import { describe, expect, it } from 'vitest';
import { hashOfMagnet, magnetFolders } from './magnet.ts';

describe('hashOfMagnet', () => {
  it('reads the hash of the torrent wherever it stands, in lower case', () => {
    expect(hashOfMagnet(`magnet:?dn=x&xt=urn:btih:${'A'.repeat(40)}&tr=y`)).toBe('a'.repeat(40));
  });

  it('gives the magnet itself when it names no hash', () => {
    expect(hashOfMagnet('magnet:?dn=x')).toBe('magnet:?dn=x');
  });
});

describe('magnetFolders', () => {
  it("puts a file in the magnet's folder, then in the folders the magnet has", () => {
    expect(magnetFolders('Season 1', ['Disc 2', 'Extras'])).toEqual([
      'Season 1',
      'Disc 2',
      'Extras',
    ]);
    expect(magnetFolders('ubuntu-24.04.iso', [])).toEqual(['ubuntu-24.04.iso']);
  });

  it("climbs out of the magnet's folder through no name: a step back, a slash, a drive", () => {
    expect(magnetFolders('..', ['..', '.', 'a/../b', 'C:\\Windows'])).toEqual([
      'download',
      'download',
      'download',
      'a_.._b',
      'C__Windows',
    ]);
  });

  it('names no device and keeps no character a disk refuses', () => {
    expect(magnetFolders('CON', ['nul', 'what?', 'end. '])).toEqual([
      '_CON',
      '_nul',
      'what_',
      'end',
    ]);
  });
});
