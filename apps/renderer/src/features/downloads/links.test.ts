import { describe, expect, it } from 'vitest';
import { extractLinks } from './links.ts';

describe('extractLinks', () => {
  it('finds every address in a pasted text, once each', () => {
    const text = `Ecco i file:
      https://example.com/a.zip
      http://example.org/b.mkv?x=1&y=2 e di nuovo https://example.com/a.zip`;
    expect(extractLinks(text)).toEqual([
      'https://example.com/a.zip',
      'http://example.org/b.mkv?x=1&y=2',
    ]);
  });

  it('leaves out the punctuation of the sentence around a link', () => {
    expect(extractLinks('Scarica (https://example.com/a.zip), poi dimmi.')).toEqual([
      'https://example.com/a.zip',
    ]);
  });

  it('finds nothing in what is not a link', () => {
    expect(extractLinks('ftp://example.com/a.zip, file:///c:/x, ciao')).toEqual([]);
    expect(extractLinks('')).toEqual([]);
  });
});
