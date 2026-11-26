import { describe, expect, it } from 'vitest';
import { extractLinks, extractMagnets, magnetUri } from './links.ts';

// A text a site or a paste hands over (#383). Read again from each mark of the run, it takes
// seconds; read once, a few milliseconds.
const LONG_RUN = 100_000;
const BOUND_MS = 1000;

describe('extractLinks', () => {
  it('finds every address in a pasted text, once each', () => {
    const text = `Here are the files:
      https://example.com/a.zip
      http://example.org/b.mkv?x=1&y=2 and again https://example.com/a.zip`;
    expect(extractLinks(text)).toEqual([
      'https://example.com/a.zip',
      'http://example.org/b.mkv?x=1&y=2',
    ]);
  });

  it('leaves out the punctuation of the sentence around a link', () => {
    expect(extractLinks('Get it (https://example.com/a.zip), then tell me.')).toEqual([
      'https://example.com/a.zip',
    ]);
  });

  it('leaves out each mark that can end a sentence around a link', () => {
    for (const mark of ['.', ',', ';', ':', '!', '?', ')', ']', '}']) {
      expect(extractLinks(`see https://example.com/a.zip${mark}`), mark).toEqual([
        'https://example.com/a.zip',
      ]);
    }
  });

  it('finds nothing in what is not a link', () => {
    expect(extractLinks('ftp://example.com/a.zip, file:///c:/x, hello')).toEqual([]);
    expect(extractLinks('')).toEqual([]);
  });

  it('reads a long run of punctuation inside a link once, not again from each of its marks', () => {
    const link = `https://example.com/${'!'.repeat(LONG_RUN)}x`;
    const started = Date.now();
    expect(extractLinks(link)).toEqual([link]);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
  });
});

describe('extractMagnets', () => {
  const HASH = '842783e3005495d5d1637f5364b59343c7844707';

  it('finds every magnet in a pasted text, once each, with all its parameters', () => {
    const one = `magnet:?xt=urn:btih:${HASH}&dn=ubuntu-24.04.iso&tr=udp%3A%2F%2Ftracker.example%3A1337`;
    const two = 'magnet:?dn=other&xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    expect(extractMagnets(`Get ${one}, then ${two} and ${one} again.`)).toEqual([one, two]);
  });

  it('finds no magnet without a hash Scia can send, and no http link', () => {
    expect(
      extractMagnets('magnet:?dn=nothing magnet:?xt=urn:btih:1234 https://example.com/a.zip'),
    ).toEqual([]);
  });

  it('leaves the magnets out of the links, and the links out of the magnets', () => {
    expect(extractLinks(`magnet:?xt=urn:btih:${HASH}`)).toEqual([]);
  });

  it('reads a long run of punctuation inside a magnet once, and refuses it as longer than a magnet', () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=${'!'.repeat(LONG_RUN)}x`;
    const started = Date.now();
    expect(extractMagnets(magnet)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
  });

  it("takes no tracker of a magnet for a link: it is the magnet's, not a file", () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&tr=http://tracker.example.org:6969/announce&tr=udp://open.example:1337`;

    expect(extractLinks(`${magnet} and https://example.com/a.zip`)).toEqual([
      'https://example.com/a.zip',
    ]);
    expect(extractMagnets(magnet)).toEqual([magnet]);
  });
});

describe('magnetUri', () => {
  it('takes a magnet with a hash of its torrent, wherever the hash stands in it', () => {
    expect(magnetUri.safeParse(`magnet:?xt=urn:btih:${'a'.repeat(40)}`).success).toBe(true);
    expect(magnetUri.safeParse(`magnet:?dn=x&xt=urn:btih:${'a'.repeat(40)}&tr=y`).success).toBe(
      true,
    );
  });

  it('refuses what is not one: another scheme, no hash, a hash of the wrong length, a space', () => {
    for (const refused of [
      `http://example.com/?xt=urn:btih:${'a'.repeat(40)}`,
      'magnet:?dn=x',
      `magnet:?xt=urn:btih:${'a'.repeat(39)}`,
      `magnet:?xt=urn:btih:${'a'.repeat(40)} more`,
      `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=${'x'.repeat(9000)}`,
    ]) {
      expect(magnetUri.safeParse(refused).success, refused.slice(0, 50)).toBe(false);
    }
  });
});
