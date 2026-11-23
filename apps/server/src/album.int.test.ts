import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IntegrationId } from '@scia/contracts';
import { AlbumFailure, DownloadFailure, DownloadStatus, PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bunkr } from './bunkr.ts';
import { DownloadManager, type ManagerDeps } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import type { LinkResolver } from './link-resolver.ts';
import type { Logger } from './logger.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type BunkrServer,
  type BunkrServerOptions,
  type SimulatedFile,
  albumPageOf,
  filePageOf,
  startBunkrServer,
} from './testing/bunkr-server.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
// What the API's link is fetched with: Bunkr's own page of the file (docs/adr/0024).
const refererOf = (id: string) => `https://get.bunkrr.su/file/${id}`;

// An album pasted, from the paste to its files on disk: the manager, Bunkr's reader and the
// downloader, against a local host that answers as Bunkr does and local hosts of the files.
describe('a Bunkr album', () => {
  const source = new HttpSource('scia-test');
  const film = randomBytes(MIB + 11);
  const notes = randomBytes(5000);
  const photo = randomBytes(70_000);
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let hosts: RangeServer[];
  let site: BunkrServer | undefined;
  let manager: DownloadManager | undefined;
  let logged: string[];
  let logger: Logger;

  beforeEach(async () => {
    folder = await scratchFolder();
    hosts = [];
    logged = [];
    const log = (event: string, details?: object) => {
      logged.push(JSON.stringify({ event, ...details }));
    };
    logger = { info: log, warn: log, error: log };
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await site?.close();
    site = undefined;
    await Promise.all(hosts.map((host) => host.close()));
    await folder.remove();
  });

  async function host(body: Buffer, options: Partial<RangeServerOptions> = {}): Promise<string> {
    const started = await startRangeServer({ body, ...options });
    hosts.push(started);
    return started.url;
  }

  // Three files, each on a host of its own; the last one the API gives as it stands. The notes
  // are named otherwise by their server and by their own page: the album's name wins.
  async function holiday(options: Partial<RangeServerOptions> = {}): Promise<SimulatedFile[]> {
    return [
      { id: '101', slug: 'Day-1-AbCd', original: 'Day 1.mp4', link: await host(film, options) },
      {
        id: '102',
        slug: 'notes-EfGh',
        original: "Ada's notes.txt",
        heading: 'Notes of the trip.txt',
        link: await host(notes, { fileName: '5f2c-0123456789ab.txt' }),
      },
      {
        id: '103',
        slug: 'photo-IjKl',
        name: 'photo-IjKl.jpg',
        link: await host(photo),
        encrypted: false,
      },
    ];
  }

  async function bunkr(options: Partial<BunkrServerOptions> = {}): Promise<BunkrServer> {
    site = await startBunkrServer({
      albums: { AbCd12: { title: 'Holiday 2026', files: await holiday() } },
      ...options,
    });
    return site;
  }

  async function open(
    on: BunkrServer,
    overrides: Partial<ManagerDeps> & { readonly timeoutMs?: number } = {},
  ): Promise<DownloadManager> {
    const { timeoutMs, ...deps } = overrides;
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(join(folder.path, 'data', 'state.json')),
      defaultDirectory: join(folder.path, 'downloads'),
      logger,
      retryDelayMs: () => 1,
      bunkr: new Bunkr({
        userAgent: 'Scia/spec',
        site: on.url,
        retryDelayMs: () => 1,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
      ...deps,
    });
    return manager;
  }

  const inDownloads = (...names: string[]) => join(folder.path, 'downloads', ...names);
  const allDone = (downloads: DownloadManager, count: number) => {
    const { downloads: list } = downloads.snapshot();
    return list.length === count && list.every(({ status }) => status === DownloadStatus.Completed);
  };
  const failureOf = async (downloads: DownloadManager, id: string) => {
    await until(() => downloads.find(id).status === DownloadStatus.Failed);
    return downloads.find(id).failure;
  };

  it('downloads every file of the album into a folder named after it, byte for byte', async () => {
    const on = await bunkr();
    const downloads = await open(on);

    const [album] = downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => allDone(downloads, 3));

    expect(await readdir(inDownloads())).toEqual(['Holiday 2026']);
    expect((await readdir(inDownloads('Holiday 2026'))).sort()).toEqual(
      ["Ada's notes.txt", 'Day 1.mp4', 'photo-IjKl.jpg'].sort(),
    );
    expect(Buffer.compare(await readFile(inDownloads('Holiday 2026', 'Day 1.mp4')), film)).toBe(0);
    expect(
      Buffer.compare(await readFile(inDownloads('Holiday 2026', "Ada's notes.txt")), notes),
    ).toBe(0);
    expect(
      Buffer.compare(await readFile(inDownloads('Holiday 2026', 'photo-IjKl.jpg')), photo),
    ).toBe(0);
    // The album's row left the list; its files took its place, in its order, each its own.
    const { downloads: list } = downloads.snapshot();
    expect(list.map(({ id }) => id)).not.toContain(album!.id);
    expect(list.map(({ fileName }) => fileName)).toEqual([
      'Day 1.mp4',
      "Ada's notes.txt",
      'photo-IjKl.jpg',
    ]);
    expect(list.map(({ url }) => url)).toEqual([
      `${on.url}/f/Day-1-AbCd`,
      `${on.url}/f/notes-EfGh`,
      `${on.url}/f/photo-IjKl`,
    ]);
    expect(list.every(({ via }) => via === null)).toBe(true);
  });

  it("asks Bunkr's pages and its API as its own pages do, and fetches each file with its page as referrer", async () => {
    const on = await bunkr();
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => allDone(downloads, 3));

    // The page that lists every file, as gallery-dl asks it.
    expect(on.asked.filter(({ path }) => path === '/a/AbCd12').map(({ query }) => query)).toEqual([
      '?advanced=1',
    ]);
    const api = on.asked.filter(({ path }) => path === '/api/_001_v2');
    expect(api.map(({ method }) => method)).toEqual(['POST', 'POST', 'POST']);
    const ids = api.map(({ body }) => (JSON.parse(body) as { id: string }).id);
    expect(ids.sort()).toEqual(['101', '102', '103']);
    for (const { body, referer, origin } of api) {
      const { id } = JSON.parse(body) as { id: string };
      expect(JSON.parse(body)).toEqual({ id });
      expect(referer).toBe(refererOf(id));
      expect(origin).toBe('https://get.bunkrr.su');
    }
    // Scia's own user agent, never a browser's.
    expect(new Set(on.asked.map(({ userAgent }) => userAgent))).toEqual(new Set(['Scia/spec']));
    const [filmHost] = hosts;
    expect(new Set(filmHost?.asked.map(({ referer }) => referer))).toEqual(
      new Set([refererOf('101')]),
    );
  });

  it('says in the log how many files an album gave, never the album or a link', async () => {
    const on = await bunkr();
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => allDone(downloads, 3));

    expect(logged).toContain(JSON.stringify({ event: 'album_read', files: 3 }));
    for (const line of logged) {
      expect(line).not.toContain('AbCd12');
      expect(line).not.toContain('127.0.0.1');
    }
  });

  it('keeps every name inside the album folder, and the folder inside the download folder', async () => {
    const files: SimulatedFile[] = [
      { id: '1', slug: 'a', original: '..\\..\\evil.exe', link: await host(notes) },
      { id: '2', slug: 'b', original: '../../../escape.txt', link: await host(notes) },
      { id: '3', slug: 'c', original: 'CON.txt', link: await host(notes) },
    ];
    const live: SimulatedFile = {
      id: '4',
      slug: 'd',
      original: 'set.mp3',
      link: await host(notes),
    };
    const on = await bunkr({
      albums: { x: { title: '..', files }, y: { title: '../AC/DC: live', files: [live] } },
    });
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/x`, `${on.url}/a/y`] });
    await until(() => allDone(downloads, 4));

    // A title is no path: its slashes are characters. One that says nothing is `download`, as
    // a magnet's.
    expect((await readdir(inDownloads())).sort()).toEqual(['.._AC_DC_ live', 'download'].sort());
    expect((await readdir(inDownloads('download'))).sort()).toEqual(
      ['_CON.txt', 'escape.txt', 'evil.exe'].sort(),
    );
    expect(await readdir(inDownloads('.._AC_DC_ live'))).toEqual(['set.mp3']);
    expect((await readdir(folder.path)).sort()).toEqual(['data', 'downloads']);
  });

  it('names the folder after the album id when the album has no title, and a file by its stored name when it has no other', async () => {
    const files: SimulatedFile[] = [
      { id: '1', slug: 'a', name: 'a-0123456789ab.bin', link: await host(notes) },
    ];
    const on = await bunkr({ albums: { Qz9: { files } } });
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/Qz9`] });
    await until(() => allDone(downloads, 1));

    expect(await readdir(inDownloads('Qz9'))).toEqual(['a-0123456789ab.bin']);
  });

  it('never overwrites: two files of one name, a file where the folder would be, a file already in the folder', async () => {
    const same = randomBytes(3000);
    const files: SimulatedFile[] = [
      { id: '1', slug: 'a', original: 'clip.mp4', link: await host(notes) },
      { id: '2', slug: 'b', original: 'clip.mp4', link: await host(same) },
    ];
    const on = await bunkr({
      albums: { a1: { title: 'Trip', files }, a2: { title: 'Mix', files } },
    });
    await mkdir(inDownloads('Mix'), { recursive: true });
    await writeFile(inDownloads('Trip'), 'a file, not a folder');
    await writeFile(inDownloads('Mix', 'clip.mp4'), 'already here');
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/a1`] });
    await until(() => allDone(downloads, 2));
    downloads.add({ urls: [`${on.url}/a/a2`] });
    await until(() => allDone(downloads, 4));

    expect(await readFile(inDownloads('Trip'), 'utf8')).toBe('a file, not a folder');
    expect((await readdir(inDownloads('Trip (1)'))).sort()).toEqual(['clip (1).mp4', 'clip.mp4']);
    const trip = [
      await readFile(inDownloads('Trip (1)', 'clip.mp4')),
      await readFile(inDownloads('Trip (1)', 'clip (1).mp4')),
    ];
    expect(trip.map((bytes) => bytes.length).sort()).toEqual([notes.length, same.length].sort());
    // A folder of the album's name is shared, and its files take free names inside it.
    expect(await readFile(inDownloads('Mix', 'clip.mp4'), 'utf8')).toBe('already here');
    expect((await readdir(inDownloads('Mix'))).sort()).toEqual(
      ['clip (1).mp4', 'clip (2).mp4', 'clip.mp4'].sort(),
    );
  });

  it('holds the files of an album under the speed limit', async () => {
    const files: SimulatedFile[] = [
      { id: '1', slug: 'a', original: 'a.bin', link: await host(randomBytes(MIB / 2)) },
      { id: '2', slug: 'b', original: 'b.bin', link: await host(randomBytes(MIB / 2)) },
    ];
    const on = await bunkr({ albums: { x: { title: 'Limited', files } } });
    const downloads = await open(on);
    downloads.updateSettings({ speedLimitBytesPerSecond: MIB / 2 });

    const startedAt = performance.now();
    downloads.add({ urls: [`${on.url}/a/x`] });
    await until(() => allDone(downloads, 2));

    // A megabyte in all at half a megabyte a second: two seconds, less the first bytes, which
    // wait for nothing.
    expect(performance.now() - startedAt).toBeGreaterThan(1500);
  });

  it('pauses a file of the album and resumes it from its bytes, reading its page and the API again', async () => {
    const files: SimulatedFile[] = [
      {
        id: '101',
        slug: 'Day-1-AbCd',
        original: 'Day 1.mp4',
        link: await host(film, { chunkDelayMs: 5 }),
      },
    ];
    const on = await bunkr({ albums: { x: { title: 'Slow', files } } });
    const downloads = await open(on);
    downloads.add({ urls: [`${on.url}/a/x`] });
    await until(() => downloads.snapshot().downloads[0]?.fileName === 'Day 1.mp4');
    const [file] = downloads.snapshot().downloads;
    await until(() => downloads.find(file!.id).downloadedBytes > MIB / 4);

    await downloads.pause(file!.id);
    const kept = downloads.find(file!.id).downloadedBytes;
    expect(existsSync(inDownloads('Slow', 'Day 1.mp4.scia'))).toBe(true);
    const [filmHost] = hosts;
    const askedBefore = filmHost?.ranges.length ?? 0;
    downloads.resume(file!.id);
    await until(() => downloads.find(file!.id).status === DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('Slow', 'Day 1.mp4')), film)).toBe(0);
    expect(on.asked.filter(({ path }) => path === '/f/Day-1-AbCd')).toHaveLength(2);
    expect(on.asked.filter(({ path }) => path === '/api/_001_v2')).toHaveLength(2);
    // Resumed: past what was asked of the file at its start, its host was asked only from the
    // bytes kept on.
    const resumed = (filmHost?.ranges.slice(askedBefore) ?? []).filter(
      (range) => range !== 'bytes=0-0',
    );
    expect(resumed.length).toBeGreaterThan(0);
    for (const range of resumed) {
      expect(Number(/^bytes=(\d+)-/.exec(range ?? '')?.[1])).toBeGreaterThanOrEqual(kept);
    }
  });

  it('says that the link the site gave stopped working partway, and goes on from the bytes at a retry, with a new link', async () => {
    const file = await host(film, { chunkDelayMs: 5 });
    const [fileHost] = hosts;
    const files: SimulatedFile[] = [{ id: '1', slug: 'a', original: 'a.bin', link: file }];
    const on = await bunkr({ albums: { x: { title: 'Expiring', files } }, freshLinks: true });
    const downloads = await open(on);
    downloads.add({ urls: [`${on.url}/a/x`] });
    await until(() => (downloads.snapshot().downloads[0]?.downloadedBytes ?? 0) > MIB / 4);
    const [row] = downloads.snapshot().downloads;

    fileHost?.expireLinks(403);

    expect(await failureOf(downloads, row!.id)).toBe(AlbumFailure.LinkFailed);
    expect(downloads.find(row!.id).failureStatus).toBe(403);
    const kept = downloads.find(row!.id).downloadedBytes;
    expect(kept).toBeGreaterThan(0);
    const askedBefore = fileHost?.asked.length ?? 0;
    downloads.resume(row!.id);
    await until(() => downloads.find(row!.id).status === DownloadStatus.Completed);
    expect(Buffer.compare(await readFile(inDownloads('Expiring', 'a.bin')), film)).toBe(0);
    // The page and the API asked again, a new link given, and only what was missing asked of it.
    expect(on.asked.filter(({ path }) => path === '/api/_001_v2')).toHaveLength(2);
    const resumed = (fileHost?.asked.slice(askedBefore) ?? []).filter(
      ({ range }) => range !== 'bytes=0-0',
    );
    expect(resumed.every(({ link }) => link?.endsWith('?given=2') === true)).toBe(true);
    for (const { range } of resumed) {
      expect(Number(/^bytes=(\d+)-/.exec(range ?? '')?.[1])).toBeGreaterThanOrEqual(kept);
    }
  });

  it('goes on with the files of an album after the engine stops and starts again', async () => {
    const files: SimulatedFile[] = [
      { id: '1', slug: 'a', original: 'a.bin', link: await host(film, { chunkDelayMs: 5 }) },
    ];
    const on = await bunkr({ albums: { x: { title: 'Again', files } } });
    const first = await open(on);
    first.add({ urls: [`${on.url}/a/x`] });
    await until(() => (first.snapshot().downloads[0]?.downloadedBytes ?? 0) > MIB / 4);
    await first.close();

    const second = await open(on);

    await until(() => allDone(second, 1));
    expect(Buffer.compare(await readFile(inDownloads('Again', 'a.bin')), film)).toBe(0);
  });

  it('reads an album added before a restart at the next start', async () => {
    const on = await bunkr({ delayMs: 300 });
    const first = await open(on);
    first.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => on.asked.length > 0);
    await first.close();

    const second = await open(on);

    await until(() => allDone(second, 3));
    expect(await readdir(inDownloads('Holiday 2026'))).toHaveLength(3);
  });

  it('pauses an album while its page is read, and adds nothing until it is resumed', async () => {
    const on = await bunkr({ delayMs: 300 });
    const downloads = await open(on);
    const [album] = downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => on.asked.length > 0);

    // Its run has ended when the pause answers: nothing it read can add a file afterwards.
    await downloads.pause(album!.id);

    expect(downloads.snapshot().downloads.map(({ id }) => id)).toEqual([album!.id]);
    expect(downloads.find(album!.id).status).toBe(DownloadStatus.Paused);
    downloads.resume(album!.id);
    await until(() => allDone(downloads, 3));
  });

  it('removes an album while its page is read, and adds none of its files', async () => {
    const on = await bunkr({ delayMs: 300 });
    const downloads = await open(on);
    const [album] = downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => on.asked.length > 0);

    await downloads.remove(album!.id, false);

    expect(downloads.snapshot().downloads).toEqual([]);
    expect(existsSync(inDownloads('Holiday 2026'))).toBe(false);
  });

  it('names a file page pasted by itself after its page, and fetches it the same way', async () => {
    const on = await bunkr();
    const downloads = await open(on);

    const [file] = downloads.add({ urls: [`${on.url}/f/notes-EfGh`] });
    await until(() => downloads.find(file!.id).status === DownloadStatus.Completed);

    // Its page's heading, not what its server calls it.
    expect(downloads.find(file!.id).fileName).toBe('Notes of the trip.txt');
    expect(Buffer.compare(await readFile(inDownloads('Notes of the trip.txt')), notes)).toBe(0);
  });

  it('keeps a file pasted by itself in the download folder, whatever its page calls it', async () => {
    const files: SimulatedFile[] = [
      { id: '7', slug: 'esc', heading: '..\\..\\escape.txt', link: await host(notes) },
    ];
    const on = await bunkr({ albums: { x: { files } } });
    const downloads = await open(on);

    const [file] = downloads.add({ urls: [`${on.url}/f/esc`] });
    await until(() => downloads.find(file!.id).status === DownloadStatus.Completed);

    expect(await readdir(inDownloads())).toEqual(['escape.txt']);
    expect((await readdir(folder.path)).sort()).toEqual(['data', 'downloads']);
  });

  it('puts the files of an album in its place in the list, between what was added with it', async () => {
    const before = await host(notes, { fileName: 'before.bin' });
    const after = await host(notes, { fileName: 'after.bin' });
    const on = await bunkr();
    const downloads = await open(on);

    downloads.add({ urls: [before, `${on.url}/a/AbCd12`, after] });
    await until(() => allDone(downloads, 5));

    expect(downloads.snapshot().downloads.map(({ fileName }) => fileName)).toEqual([
      'before.bin',
      'Day 1.mp4',
      "Ada's notes.txt",
      'photo-IjKl.jpg',
      'after.bin',
    ]);
  });

  it('writes a slug into the address of its page, and reads an album id out of its own', async () => {
    const files: SimulatedFile[] = [
      { id: '1', slug: 'Day 1#x?y', original: 'x.bin', link: await host(notes) },
    ];
    const on = await bunkr({ albums: { 'My album': { files } } });
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/My%20album`] });
    await until(() => allDone(downloads, 1));

    expect(await readdir(inDownloads('My album'))).toEqual(['x.bin']);
    expect(downloads.snapshot().downloads[0]?.url).toBe(`${on.url}/f/Day%201%23x%3Fy`);
  });

  it('reads a page or an answer up to its bound, and none past it', async () => {
    const KIB = 1024;
    const page = (padding: number) =>
      `${filePageOf({ id: '102', name: 'notes.txt' })}${' '.repeat(padding)}`;
    const on = await bunkr({
      pages: { '/f/within': page(2 * MIB - 4 * KIB), '/f/past': page(2 * MIB + KIB) },
    });
    const downloads = await open(on);
    const [within, past] = downloads.add({ urls: [`${on.url}/f/within`, `${on.url}/f/past`] });
    await until(() => downloads.find(within!.id).status === DownloadStatus.Completed);
    expect(await failureOf(downloads, past!.id)).toBe(AlbumFailure.Unrecognised);
    await manager?.close();
    manager = undefined;

    for (const [padding, completes] of [
      [60 * KIB, true],
      [65 * KIB, false],
    ] as const) {
      await site?.close();
      const link = await host(notes);
      const api = await bunkr({
        apiAnswer: `${JSON.stringify({ encrypted: false, url: link })}${' '.repeat(padding)}`,
      });
      const again = await open(api);
      const [file] = again.add({ urls: [`${api.url}/f/notes-EfGh`] });
      if (completes) {
        await until(() => again.find(file!.id).status === DownloadStatus.Completed);
      } else {
        expect(await failureOf(again, file!.id)).toBe(AlbumFailure.Unrecognised);
      }
      await again.close();
    }
  });

  it('follows a redirect to a host of the list, and never one off it', async () => {
    const other = await startBunkrServer({
      albums: { AbCd12: { title: 'Moved', files: await holiday() } },
    });
    try {
      const on = await bunkr({
        redirects: {
          '/a/old': `${other.url}/a/AbCd12`,
          '/a/away': 'http://localhost:9/a/x',
          '/a/loop': '/a/loop',
          // A host of the list, by another scheme than the web's.
          '/a/ftp': `ftp://127.0.0.1/a/AbCd12`,
        },
      });
      const downloads = await open(on);

      downloads.add({ urls: [`${on.url}/a/old`] });
      await until(() => allDone(downloads, 3));
      expect(await readdir(inDownloads('Moved'))).toHaveLength(3);
      // The files' pages are on the host the album was read at.
      expect(downloads.snapshot().downloads[0]?.url).toBe(`${other.url}/f/Day-1-AbCd`);

      const [away] = downloads.add({ urls: [`${on.url}/a/away`] });
      expect(await failureOf(downloads, away!.id)).toBe(AlbumFailure.Unrecognised);
      // A host that sends Scia round in a circle: five redirects, then no more.
      const [loop] = downloads.add({ urls: [`${on.url}/a/loop`] });
      expect(await failureOf(downloads, loop!.id)).toBe(AlbumFailure.Unrecognised);
      expect(on.asked.filter(({ path }) => path === '/a/loop')).toHaveLength(6);
      const [ftp] = downloads.add({ urls: [`${on.url}/a/ftp`] });
      expect(await failureOf(downloads, ftp!.id)).toBe(AlbumFailure.Unrecognised);
    } finally {
      await other.close();
    }
  });

  it('says why an album gave no file, and reads it again at a retry', async () => {
    const status: Record<string, number> = {
      '/a/gone': 404,
      '/a/refused': 403,
      '/a/busy': 503,
      '/a/many': 429,
      '/a/unknown': 401,
      // A redirect that says nowhere to go: a status like any other.
      '/a/nowhere': 302,
    };
    const on = await bunkr({
      status,
      // A host that asks for longer than Scia waits is not waited for, and not asked again.
      troubles: {
        '/a/later': [{ status: 503, retryAfter: '3600' }],
        '/a/tomorrow': [{ status: 429, retryAfter: 'Wed, 01 Jan 2100 00:00:00 GMT' }],
      },
      albums: {
        AbCd12: { title: 'Holiday 2026', files: await holiday() },
        empty: { title: 'Nothing', files: [] },
        // Slugs the address parser makes into another path: `/f/..` is `/`, `/f/.` is `/f/`.
        dot: { title: 'Dot', files: [{ id: '1', slug: '.', original: 'a.bin', link: '' }] },
        dots: { title: 'Dots', files: [{ id: '2', slug: '..', original: 'b.bin', link: '' }] },
        none: { title: 'None', files: [{ id: '3', slug: '', original: 'c.bin', link: '' }] },
      },
      pages: {
        '/a/strange': '<html><body>A page of another shape</body></html>',
        // An album Scia would read, but for its size.
        '/a/huge': `${albumPageOf({ title: 'Huge', files: [{ id: '1', slug: 'a', link: '' }] })}${' '.repeat(17 * MIB)}`,
      },
    });
    const downloads = await open(on);

    const failures = await Promise.all(
      [
        'gone',
        'refused',
        'unknown',
        'nowhere',
        'busy',
        'many',
        'later',
        'tomorrow',
        'strange',
        'huge',
        'empty',
        'dot',
        'dots',
        'none',
      ].map(async (id) => {
        const [added] = downloads.add({ urls: [`${on.url}/a/${id}`] });
        return [id, await failureOf(downloads, added!.id)] as const;
      }),
    );

    expect(Object.fromEntries(failures)).toEqual({
      gone: AlbumFailure.Gone,
      refused: AlbumFailure.Refused,
      unknown: AlbumFailure.Refused,
      nowhere: DownloadFailure.HttpStatus,
      busy: PageFailure.SiteBusy,
      many: PageFailure.SiteBusy,
      later: PageFailure.SiteBusy,
      tomorrow: PageFailure.SiteBusy,
      strange: AlbumFailure.Unrecognised,
      huge: AlbumFailure.Unrecognised,
      empty: AlbumFailure.Empty,
      dot: AlbumFailure.Unrecognised,
      dots: AlbumFailure.Unrecognised,
      none: AlbumFailure.Unrecognised,
    });
    expect(existsSync(inDownloads())).toBe(false);
    const askedOf = (path: string) => on.asked.filter((each) => each.path === path).length;
    // What cannot heal is asked once; what can, four times in all; a wait longer than Scia's,
    // once.
    expect(['gone', 'refused', 'unknown'].map((id) => askedOf(`/a/${id}`))).toEqual([1, 1, 1]);
    expect(['busy', 'many'].map((id) => askedOf(`/a/${id}`))).toEqual([4, 4]);
    expect(['later', 'tomorrow'].map((id) => askedOf(`/a/${id}`))).toEqual([1, 1]);
    const nowhere = downloads.snapshot().downloads.find(({ url }) => url.endsWith('/a/nowhere'));
    expect(nowhere?.failureStatus).toBe(302);

    // The site mended, a retry reads the album again: there is no album of that id, the site says.
    const busy = downloads.snapshot().downloads.find(({ url }) => url.endsWith('/a/busy'));
    delete status['/a/busy'];
    const before = on.asked.length;
    downloads.resume(busy!.id);
    expect(await failureOf(downloads, busy!.id)).toBe(AlbumFailure.Gone);
    expect(on.asked.slice(before).map(({ path }) => path)).toEqual(['/a/busy']);
  });

  it('asks again, after a wait, what can heal: a busy page, a dropped connection, a 429 and its Retry-After', async () => {
    const on = await bunkr({
      troubles: {
        '/a/AbCd12': [{ status: 503 }, 'drop'],
        '/f/notes-EfGh': [{ status: 502 }],
        '/api/_001_v2': [{ status: 429, retryAfter: '1' }],
      },
    });
    const downloads = await open(on);

    downloads.add({ urls: [`${on.url}/a/AbCd12`] });
    await until(() => allDone(downloads, 3));

    expect(await readdir(inDownloads('Holiday 2026'))).toHaveLength(3);
    expect(on.asked.filter(({ path }) => path === '/a/AbCd12')).toHaveLength(3);
    expect(on.asked.filter(({ path }) => path === '/f/notes-EfGh')).toHaveLength(2);
    // The file the 429 was for was asked again no sooner than the host said, not after Scia's
    // own wait (a millisecond here).
    const api = on.asked.filter(({ path }) => path === '/api/_001_v2');
    expect(api).toHaveLength(4);
    const [refused] = api;
    const again = api.slice(1).find(({ body }) => body === refused?.body);
    expect((again?.atMs ?? 0) - (refused?.atMs ?? 0)).toBeGreaterThanOrEqual(950);
  });

  it('says that a site that does not answer in time is busy', async () => {
    const on = await bunkr({ delayMs: 400 });
    const downloads = await open(on, { timeoutMs: 100 });

    const [album] = downloads.add({ urls: [`${on.url}/a/AbCd12`] });

    expect(await failureOf(downloads, album!.id)).toBe(PageFailure.SiteBusy);
    // Asked again three times, each given the same time.
    expect(on.asked.filter(({ path }) => path === '/a/AbCd12')).toHaveLength(4);
  });

  it("says why a file of the album gave no file, and saves nothing in that file's place", async () => {
    // A file server in maintenance: the file's link lands on its video that says so.
    const video = new URL(await host(randomBytes(2000))).origin;
    const server = await startBunkrServer({
      albums: {},
      redirects: { '/cdn/maint': `${video}/maint.mp4` },
    });
    const page = await host(Buffer.from('<!doctype html><title>Not here</title>'), {
      contentType: 'text/html',
    });
    const files: SimulatedFile[] = [
      { id: '1', slug: 'gone', original: 'gone.bin', link: await host(notes) },
      { id: '2', slug: 'refused', original: 'refused.bin', link: await host(notes) },
      { id: '3', slug: 'noid', original: 'noid.bin', link: await host(notes) },
      { id: '4', slug: 'maint', original: 'maint.bin', link: `${server.url}/cdn/maint` },
      { id: '5', slug: 'html', original: 'html.bin', link: page },
      // The link the API gives is refused at its first byte.
      { id: '8', slug: 'nolink', original: 'nolink.bin', link: await host(notes, { status: 404 }) },
      // The API knows no file of this id: gallery-dl's sign of an album deleted.
      { id: '6', slug: 'unknown', original: 'unknown.bin', link: await host(notes) },
    ];
    const on = await bunkr({
      albums: { x: { title: 'Broken', files } },
      status: { '/f/gone': 410, '/f/refused': 403 },
      pages: {
        '/f/noid': '<html><h1>noid.bin</h1></html>',
        '/f/unknown': '<html><h1>unknown.bin</h1><a data-file-id="999">Download</a></html>',
      },
    });
    const downloads = await open(on);

    try {
      downloads.add({ urls: [`${on.url}/a/x`] });
      await until(() => downloads.snapshot().downloads.length === files.length);
      const failed = await Promise.all(
        downloads
          .snapshot()
          .downloads.map(async ({ id, fileName }) => [fileName, await failureOf(downloads, id)]),
      );

      expect(Object.fromEntries(failed)).toEqual({
        'gone.bin': AlbumFailure.Gone,
        'refused.bin': AlbumFailure.Refused,
        'noid.bin': AlbumFailure.Unrecognised,
        'maint.bin': PageFailure.SiteBusy,
        'html.bin': AlbumFailure.LinkFailed,
        'nolink.bin': AlbumFailure.LinkFailed,
        'unknown.bin': AlbumFailure.Gone,
      });
      const statusOf = (name: string) =>
        downloads.snapshot().downloads.find(({ fileName }) => fileName === name)?.failureStatus;
      expect([statusOf('html.bin'), statusOf('nolink.bin')]).toEqual([null, 404]);
      // Nothing written: not the maintenance video, not the page, not a part file.
      expect(existsSync(inDownloads())).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("says what the API's refusals mean", async () => {
    for (const [status, failure] of [
      [403, AlbumFailure.Refused],
      [503, PageFailure.SiteBusy],
      [429, PageFailure.SiteBusy],
      [418, DownloadFailure.HttpStatus],
    ] as const) {
      await site?.close();
      const on = await bunkr({ status: { '/api/_001_v2': status } });
      const downloads = await open(on);

      const [file] = downloads.add({ urls: [`${on.url}/f/notes-EfGh`] });

      expect(await failureOf(downloads, file!.id), String(status)).toBe(failure);
      if (failure === DownloadFailure.HttpStatus) {
        expect(downloads.find(file!.id).failureStatus).toBe(status);
      }
      await manager?.close();
      manager = undefined;
    }
  });

  it("says what Scia cannot read of the API's answer, and follows none of its redirects", async () => {
    for (const options of [
      { apiAnswer: JSON.stringify({ encrypted: false, url: 'file:///C:/x' }) },
      { apiAnswer: 'not JSON' },
      { redirects: { '/api/_001_v2': '/api/elsewhere' } },
    ]) {
      await site?.close();
      const on = await bunkr(options);
      const downloads = await open(on);

      const [file] = downloads.add({ urls: [`${on.url}/f/notes-EfGh`] });

      expect(await failureOf(downloads, file!.id), JSON.stringify(options)).toBe(
        AlbumFailure.Unrecognised,
      );
      expect(on.asked.map(({ path }) => path)).not.toContain('/api/elsewhere');
      await manager?.close();
      manager = undefined;
    }
  });

  it('never asks a connected service about an album or its files', async () => {
    const asked: string[] = [];
    const resolver: LinkResolver = {
      serviceFor: (url) => {
        asked.push(url);
        return Promise.resolve(IntegrationId.AllDebrid);
      },
      unlock: () => Promise.reject(new Error('Not a link of the service.')),
    };
    const on = await bunkr();
    const downloads = await open(on, { resolver });

    downloads.add({ urls: [`${on.url}/a/AbCd12`, `${on.url}/f/photo-IjKl`] });
    await until(() => allDone(downloads, 4));

    expect(asked).toEqual([]);
  });
});
