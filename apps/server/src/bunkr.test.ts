import { describe, expect, it } from 'vitest';
import { apiOf, Bunkr } from './bunkr.ts';

// Where a run's reader asks, read back with nothing sent: a mutant of these lines would point the
// integration specs at Bunkr itself (.claude/gotchas.md, Specs).
describe("the reader's addresses", () => {
  it("asks Bunkr's own API, or the same path on a run's local host", () => {
    expect(apiOf(undefined)).toBe('https://apidl.bunkr.ru/api/_001_v2');
    expect(apiOf('http://127.0.0.1:8082')).toBe('http://127.0.0.1:8082/api/_001_v2');
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
