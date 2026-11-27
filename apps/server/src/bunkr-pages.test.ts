import { describe, expect, it } from 'vitest';
import {
  BUNKR_DOMAINS,
  bunkrLinkOf,
  isMaintenance,
  linkOfAnswer,
  readAlbumPage,
  readFilePage,
  signatureOf,
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
      ['a line that is no field', good.replace(' type: "application/octet-stream",', ' type')],
      ['a field whose name is no word', good.replace(' type:', ' the type:')],
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
  // An answer in the shape of the download page's API on 27 November 2026 (#398), made up.
  const ANSWER = {
    mediafiles: 'https://c3.example.net',
    original: 'Day 1.mp4',
    path: '/storage/media/5f2c1e0a-7b3d-4c11-9a2e-0123456789ab.mp4',
  };

  it("joins the file's server and its path into its link, as the download page does", () => {
    expect(linkOfAnswer(ANSWER)).toEqual({
      link: 'https://c3.example.net/storage/media/5f2c1e0a-7b3d-4c11-9a2e-0123456789ab.mp4',
    });
    expect(linkOfAnswer({ mediafiles: 'https://c1.example.net', path: '/a b%20c.jpg' })).toEqual({
      link: 'https://c1.example.net/a%20b%20c.jpg',
    });
  });

  it('says that the API knows no such file when it names no file server', () => {
    expect(
      linkOfAnswer({
        mediafiles: '',
        original: 'dev_original.mp4',
        path: '/storage/media/dev_original_1.mp4',
      }),
    ).toBe('unknown');
  });

  it('reads nothing of an answer that is not one, or a link that is not http', () => {
    for (const answer of [
      null,
      'https://c3.example.net/a.mp4',
      {},
      { mediafiles: ANSWER.mediafiles },
      { path: ANSWER.path },
      { mediafiles: 7, path: ANSWER.path },
      { mediafiles: ANSWER.mediafiles, path: 7 },
      { mediafiles: 'not an address', path: ANSWER.path },
      { mediafiles: 'javascript:alert(1)//', path: '/a.mp4' },
      { mediafiles: 'file:///C:/Windows', path: '/win.ini' },
      // A path is joined as it stands: one that does not start at the root would name another host.
      { mediafiles: ANSWER.mediafiles, path: '.example.net/a.mp4' },
      // The answer of the API the download page asked until November 2026.
      { encrypted: false, url: 'https://c3.example.net/a.mp4' },
    ]) {
      expect(linkOfAnswer(answer), JSON.stringify(answer)).toBeUndefined();
    }
  });
});

describe('signatureOf', () => {
  it('reads the token the signing service gives a path, and when it expires', () => {
    expect(signatureOf({ ex: 1_795_766_400, token: 'a1b2c3' })).toEqual({
      token: 'a1b2c3',
      expiry: 1_795_766_400,
    });
  });

  it('reads nothing of an answer that is not one', () => {
    for (const answer of [
      null,
      'a1b2c3',
      {},
      { token: 'a1b2c3' },
      { ex: 1_795_766_400 },
      { ex: 1_795_766_400, token: '' },
      { ex: 1_795_766_400, token: 7 },
      { ex: '1795766400', token: 'a1b2c3' },
      { ex: -1, token: 'a1b2c3' },
      { ex: 1.5, token: 'a1b2c3' },
      { ex: 2 ** 53, token: 'a1b2c3' },
    ]) {
      expect(signatureOf(answer), JSON.stringify(answer)).toBeUndefined();
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
