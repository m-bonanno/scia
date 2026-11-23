import { describe, expect, it } from 'vitest';
import {
  BUNKR_DOMAINS,
  bunkrLinkOf,
  isMaintenance,
  linkOfAnswer,
  readAlbumPage,
  readFilePage,
} from './bunkr-pages.ts';
import { albumPageOf, filePageOf } from './testing/bunkr-server.ts';

describe('bunkrLinkOf', () => {
  it('knows the domains Bunkr has used, the ones the issue names among them', () => {
    for (const domain of ['bunkr.cr', 'bunkr.si', 'bunkr.fi', 'bunkr.ru', 'bunkrr.su']) {
      expect(BUNKR_DOMAINS, domain).toContain(domain);
    }
    expect(new Set(BUNKR_DOMAINS).size).toBe(BUNKR_DOMAINS.length);
  });

  it('takes an album by its host and the shape of its path', () => {
    for (const domain of BUNKR_DOMAINS) {
      expect(bunkrLinkOf(`https://${domain}/a/AbCd12`), domain).toEqual({
        kind: 'album',
        origin: `https://${domain}`,
        id: 'AbCd12',
      });
    }
    expect(bunkrLinkOf('https://app.bunkr.cr/a/AbCd12/?page=2#top')).toEqual({
      kind: 'album',
      origin: 'https://app.bunkr.cr',
      id: 'AbCd12',
    });
    expect(bunkrLinkOf('http://BUNKR.SI/a/x')).toEqual({
      kind: 'album',
      origin: 'http://bunkr.si',
      id: 'x',
    });
  });

  it("takes a file's page under each of the shapes Bunkr gives one", () => {
    for (const shape of ['f', 'v', 'i', 'd']) {
      expect(bunkrLinkOf(`https://bunkr.cr/${shape}/Day-1-AbCd.mp4`), shape).toEqual({
        kind: 'file',
        origin: 'https://bunkr.cr',
        path: `/${shape}/Day-1-AbCd.mp4`,
      });
    }
  });

  it('leaves every other link alone: a name in the address is not a host', () => {
    for (const url of [
      'https://bunkr.cr/',
      'https://bunkr.cr/a/',
      'https://bunkr.cr/a/x/y',
      'https://bunkr.cr/albums',
      'https://bunkr.cr/x/AbCd',
      'https://www.bunkr.cr/a/AbCd',
      'https://cdn.bunkr.cr/a/AbCd',
      'https://notbunkr.cr/a/AbCd',
      'https://bunkr.cr.example.com/a/AbCd',
      'https://example.com/a/AbCd?from=bunkr.cr',
      'https://example.com/bunkr.cr/a/AbCd',
      'ftp://bunkr.cr/a/AbCd',
      'not a link',
    ]) {
      expect(bunkrLinkOf(url), url).toBeUndefined();
    }
  });

  it('reads its domains from the list it is given', () => {
    expect(bunkrLinkOf('http://127.0.0.1:4000/a/AbCd', ['127.0.0.1'])).toEqual({
      kind: 'album',
      origin: 'http://127.0.0.1:4000',
      id: 'AbCd',
    });
    expect(bunkrLinkOf('https://bunkr.cr/a/AbCd', ['127.0.0.1'])).toBeUndefined();
  });
});

describe('readAlbumPage', () => {
  it("reads the album's title, escaped twice as Bunkr does, and its files in their order", () => {
    const page = albumPageOf({
      title: 'Ada & Bob\'s "holiday" <2026>',
      files: [
        { id: '101', slug: 'Day-1-AbCd', original: 'Day 1.mp4', link: 'unused' },
        { id: '102', slug: 'notes-EfGh', original: "Ada's notes.txt", link: 'unused' },
        { id: '103', slug: 'raw-IjKl', name: 'raw-IjKl.jpg', link: 'unused' },
      ],
    });

    expect(readAlbumPage(page)).toEqual({
      title: 'Ada & Bob\'s "holiday" <2026>',
      files: [
        { slug: 'Day-1-AbCd', name: 'Day 1.mp4' },
        { slug: 'notes-EfGh', name: "Ada's notes.txt" },
        { slug: 'raw-IjKl', name: 'raw-IjKl.jpg' },
      ],
    });
  });

  it('says an album with no title has none, and an album with no file has none', () => {
    expect(readAlbumPage(albumPageOf({ files: [] }))).toEqual({ title: undefined, files: [] });
  });

  it('keeps a name as the album writes it: what it may say is for sanitizeFileName', () => {
    const page = albumPageOf({
      files: [{ id: '1', slug: 's', original: '..\\..\\Windows\\win.ini', link: 'unused' }],
    });

    expect(readAlbumPage(page)?.files).toEqual([{ slug: 's', name: '..\\..\\Windows\\win.ini' }]);
  });

  it('reads nothing of a page that is not an album as gallery-dl knows it', () => {
    const file = { id: '1', slug: 's', original: 'a.mp4', link: 'unused' };
    const good = albumPageOf({ files: [file] });
    const two = albumPageOf({ files: [file, { ...file, id: '2', slug: 't' }] });
    expect(readAlbumPage(two)?.files).toHaveLength(2);
    for (const [why, page] of [
      ['no list of files', '<html><head><title>Bunkr</title></head><body></body></html>'],
      ['a script never closed', good.replace('</script>', '')],
      ['a list never closed', good.replace('\n];', '')],
      ['a file opened inside another', two.replace(/\n},\n/, '\n')],
      ['a file closed twice', good.replace('\n}', '\n}\n}')],
      // Every file on one line: Scia would take the first file's fields for all of them.
      ['a list on one line', good.replace(/\n/g, ' ')],
      ['a file with no slug', good.replace(/\s*slug: .*\n/, '\n')],
      ['a file with two slugs', good.replace(/(\s*slug: .*\n)/, '$1$1')],
      ['a slug that is no string', good.replace(/slug: .*,/, 'slug: s,')],
      ['a name that is no string', good.replace(/original: .*,/, 'original: "a.mp4,')],
      ['a file never closed', good.replace(/\n},?\n/, '\n')],
      ['a field outside of any file', good.replace('window.albumFiles = [', '$&\n id: 7,')],
    ] as const) {
      expect(readAlbumPage(page), why).toBeUndefined();
    }
  });
});

describe('a hostile page', () => {
  // The readers run on the engine's one thread: a page that makes them backtrack stops every
  // download and the API for as long as they run. Linear readers take milliseconds here.
  const BOUND_MS = 250;

  it('is read, or refused, in bounded time: a line of an album of many spaces', () => {
    const file = { id: '1', slug: 's', original: 'a.mp4', link: 'unused' };
    const page = albumPageOf({ files: [file] }).replace(
      ' slug: "s",',
      ` slug: "s"${' '.repeat(60_000)}x,`,
    );
    const startedAt = performance.now();
    readAlbumPage(page);
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS);
  });

  it('is read, or refused, in bounded time: a page of headings never closed', () => {
    const page = `${'<h1 '.repeat(60_000)}<a data-file-id="1">`;
    const startedAt = performance.now();
    readFilePage(page);
    expect(performance.now() - startedAt).toBeLessThan(BOUND_MS);
  });
});

describe('readFilePage', () => {
  it("reads the file's id and its name, as its page writes them", () => {
    expect(readFilePage(filePageOf({ id: '4521', name: 'Day 1 &amp; 2.mp4' }))).toEqual({
      id: '4521',
      name: 'Day 1 & 2.mp4',
    });
    expect(readFilePage(filePageOf({ id: 'a_B-9', name: 'Day%201.mp4' }))).toEqual({
      id: 'a_B-9',
      name: 'Day 1.mp4',
    });
    expect(readFilePage(filePageOf({ id: '1', name: '100%.mp4' }))).toEqual({
      id: '1',
      name: '100%.mp4',
    });
    expect(readFilePage(filePageOf({ id: '1', name: '  ' }))).toEqual({ id: '1', name: undefined });
  });

  it('reads nothing of a page with no id, or an id that is not one', () => {
    expect(readFilePage('<h1>a.mp4</h1>')).toBeUndefined();
    expect(readFilePage(filePageOf({ id: '../4521', name: 'a.mp4' }))).toBeUndefined();
    expect(readFilePage(filePageOf({ id: '', name: 'a.mp4' }))).toBeUndefined();
    // Sixty-four characters at most: an id is a short word, sent as it stands to the API.
    expect(readFilePage(filePageOf({ id: 'a'.repeat(64), name: 'a.mp4' }))?.id).toBe(
      'a'.repeat(64),
    );
    expect(readFilePage(filePageOf({ id: 'a'.repeat(65), name: 'a.mp4' }))).toBeUndefined();
  });

  it('keeps a reference to no character as it is written, rather than failing on it', () => {
    expect(readFilePage(filePageOf({ id: '1', name: 'a&#x110000;b&#0;c.mp4' }))?.name).toBe(
      'a&#x110000;b&#0;c.mp4',
    );
  });
});

describe('linkOfAnswer', () => {
  // Made with gallery-dl's decrypt_xor read backwards: each byte XOR'd with the bytes of
  // `SECRET_KEY_498611` (1795000000 ÷ 3600), then base64.
  const ENCRYPTED = 'OzE3IjZucGQmanFRQVlbQV02ay03MXsbKjx5bhl4WnVVHz41d20raRsqPHxtBAg=';

  it('undoes the XOR of a link with the key its answer dates', () => {
    expect(linkOfAnswer({ encrypted: true, timestamp: 1795000000, url: ENCRYPTED })).toBe(
      'https://c3.example.net/Day%201-AbCd.mp4?n=Day%201',
    );
  });

  it('takes a link the answer gives as it stands', () => {
    expect(linkOfAnswer({ encrypted: false, url: 'https://c3.example.net/a.mp4' })).toBe(
      'https://c3.example.net/a.mp4',
    );
  });

  it('reads nothing of an answer that is not one, or a link that is not http', () => {
    for (const answer of [
      null,
      'https://c3.example.net/a.mp4',
      {},
      { encrypted: false },
      { encrypted: false, url: 7 },
      { encrypted: false, url: 'javascript:alert(1)' },
      { encrypted: false, url: 'file:///C:/Windows/win.ini' },
      { encrypted: false, url: '/a.mp4' },
      { encrypted: true, url: ENCRYPTED },
      { encrypted: true, timestamp: '1795000000', url: ENCRYPTED },
      // An address hidden under the key of a time before 1970: read, it would be an address.
      { encrypted: true, timestamp: -3600, url: 'OzE3IjZucGQmanFISTIoMz4gejEuMXY+A1wjcQ==' },
      // Only `true` says the address is hidden: read as hidden, this one would be an address.
      { encrypted: 'true', timestamp: 1795000000, url: ENCRYPTED },
      // Another key: what comes out is no address.
      { encrypted: true, timestamp: 0, url: ENCRYPTED },
      { encrypted: true, timestamp: 1795000000, url: 'not base64!' },
      // Bytes that are no UTF-8 after the XOR: read leniently, they end in U+FFFD, an address.
      { encrypted: true, timestamp: 1795000000, url: 'OzE3IjZucGQmanFRQVlbQV02ay03MXs+tA==' },
    ]) {
      expect(linkOfAnswer(answer), JSON.stringify(answer)).toBeUndefined();
    }
  });
});

describe('isMaintenance', () => {
  it("is the name Bunkr's file servers land a link on while they are in maintenance", () => {
    expect(isMaintenance('maint.mp4')).toBe(true);
    expect(isMaintenance('maintenance-vid.mp4')).toBe(true);
    expect(isMaintenance('MAINT.MP4')).toBe(true);
    expect(isMaintenance('Day 1.mp4')).toBe(false);
    expect(isMaintenance(undefined)).toBe(false);
  });
});
