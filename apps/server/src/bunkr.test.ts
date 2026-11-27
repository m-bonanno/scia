import { describe, expect, it } from 'vitest';
import { addressesOf, Bunkr, defaultRetryDelayMs } from './bunkr.ts';

describe("the reader's waits", () => {
  // ADR 0024 point 4: a busy Bunkr is asked again after 1, 2 and 4 s, never at once.
  it('waits a second before the first retry, and twice as long before each after it', () => {
    expect([1, 2, 3].map(defaultRetryDelayMs)).toEqual([1000, 2000, 4000]);
  });
});

// Where a run's reader asks, read back with nothing sent: a mutant of these lines would point the
// integration specs at Bunkr itself (.claude/gotchas.md, Specs).
describe("the reader's addresses", () => {
  it("asks the API of Bunkr's download page and Bunkr's signing service, or the same paths on a run's local host", () => {
    expect(addressesOf(undefined)).toEqual({
      api: 'https://dl.bunkr.cr/api/_001_v2',
      sign: 'https://glb-apisign.cdn.cr/sign',
    });
    expect(addressesOf('http://127.0.0.1:8082')).toEqual({
      api: 'http://127.0.0.1:8082/api/_001_v2',
      sign: 'http://127.0.0.1:8082/sign',
    });
  });

  it("takes Bunkr's links at Bunkr's domains, or at the local host's name alone", () => {
    const bunkr = new Bunkr({ userAgent: 'Scia/spec' });
    expect(bunkr.isAlbum('https://bunkr.cr/a/AbCd12')).toBe(true);
    expect(bunkr.isAlbum('http://127.0.0.1:8082/a/AbCd12')).toBe(false);

    const local = new Bunkr({ userAgent: 'Scia/spec', site: 'http://127.0.0.1:8082' });
    expect(local.isAlbum('http://127.0.0.1:8082/a/AbCd12')).toBe(true);
    expect(local.isFile('http://127.0.0.1:8082/f/Day-1')).toBe(true);
    expect(local.isAlbum('https://bunkr.cr/a/AbCd12')).toBe(false);
  });
});
