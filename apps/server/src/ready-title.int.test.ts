import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus, PageFailure, TITLE_MOST_CHARS } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager, type ManagerDeps } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import type { MagnetService } from './magnet-service.ts';
import { PageError, type PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';
import type { RemoteSource } from './remote-source.ts';
import { JsonStateStore, type PersistedState, type StateStore } from './state-store.ts';
import { type RangeServer, startRangeServer } from './testing/range-server.ts';
import { recordingLogger, scratchFolder, silentLogger, until } from './testing/scratch.ts';
import { silentSource } from './testing/silent-source.ts';
import { YtDlp } from './yt-dlp.ts';

const FAKE_YT_DLP = join(import.meta.dirname, 'testing', 'fake-yt-dlp.mjs');
// Pages of a site Scia knows, by their address alone: nothing here ever reaches them.
const pageOf = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const video = randomBytes(256 * 1024 + 5);
// One file with picture and sound, as a site offers it.
const FORMAT: PageFormat = {
  url: '',
  protocol: 'http',
  ext: 'mp4',
  vcodec: 'avc1',
  acodec: 'mp4a',
  height: 720,
  hasDrm: false,
  headers: {},
  bitrate: null,
  languagePreference: null,
};

interface TitleAsk {
  readonly url: string;
  readonly signal: AbortSignal;
  settled: boolean;
  readonly answer: (title: string | undefined) => void;
  readonly fail: (error: Error) => void;
}

// A reader whose titles are answered by hand, deaf to the signal it is given as a reader that has
// already answered is: what the manager does with a late answer is the manager's own. Told to,
// it ends a title read at its signal, as yt-dlp's adapter does.
function aReader(
  read: (url: string) => Promise<PageMedia | undefined> = () => never(),
  { hearsStop = false } = {},
) {
  const titles: TitleAsk[] = [];
  const reads: string[] = [];
  const reader: PageReader = {
    read: (url) => {
      reads.push(url);
      return read(url);
    },
    readTitle: (url, signal) =>
      new Promise((resolve, reject) => {
        const ask: TitleAsk = {
          url,
          signal,
          settled: false,
          answer: (title) => {
            ask.settled = true;
            resolve(title);
          },
          fail: (error) => {
            ask.settled = true;
            reject(error);
          },
        };
        if (hearsStop) {
          signal.addEventListener('abort', () => {
            ask.fail(new Error('stopped'));
          });
        }
        titles.push(ask);
      }),
  };
  // Asked, and neither answered nor stopped.
  const inFlight = () => titles.filter((ask) => !ask.settled && !ask.signal.aborted);
  return { reader, titles, reads, inFlight };
}

function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

describe('the title of a video’s page added ready (#285)', () => {
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let manager: DownloadManager | undefined;
  let servers: RangeServer[];
  let logger: ReturnType<typeof recordingLogger>;

  beforeEach(async () => {
    folder = await scratchFolder();
    servers = [];
    logger = recordingLogger();
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await Promise.all(servers.map((server) => server.close()));
    await folder.remove();
  });

  const statePath = () => join(folder.path, 'data', 'state.json');
  async function open(overrides: Partial<ManagerDeps> = {}): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source: silentSource,
      store: new JsonStateStore(statePath()),
      defaultDirectory: join(folder.path, 'downloads'),
      logger,
      retryDelayMs: () => 1,
      ...overrides,
    });
    return manager;
  }
  async function closed(downloads: DownloadManager): Promise<string> {
    await downloads.close();
    manager = undefined;
    return readFile(statePath(), 'utf8');
  }
  const titleOf = (downloads: DownloadManager, id: string) => downloads.find(id).title;

  it('reads the title of a video’s page copied, and shows it on the ready row, kept with it', async () => {
    const { reader, titles, reads } = aReader();
    // What the engine keeps is seen through the store it is given (.claude/gotchas.md, Specs).
    const json = new JsonStateStore(statePath());
    const saved: PersistedState[] = [];
    const store: StateStore = {
      load: () => json.load(),
      save: async (state) => {
        saved.push(structuredClone(state));
        await json.save(state);
      },
    };
    const downloads = await open({ pageReader: reader, store });
    // The magnets' first turn says it changed the list, and saves: once, at the start.
    await until(() => saved.length > 0);

    const [file, page] = await downloads.offer(['https://files.example/archive.zip', pageOf('a1')]);
    // The page alone, for its title alone: a file is not a page, and nothing starts.
    expect(titles.map((ask) => ask.url)).toEqual([pageOf('a1')]);
    expect(reads).toEqual([]);
    expect(titleOf(downloads, page!.id)).toBeNull();

    // A change of the list, saved at once: the page and main hear it, and a restart keeps it.
    titles[0]?.answer('A <b>trip</b>');
    await until(() =>
      saved.some((state) => state.downloads.some((row) => row.title === 'A <b>trip</b>')),
    );
    expect(downloads.find(page!.id)).toMatchObject({
      title: 'A <b>trip</b>',
      status: DownloadStatus.Ready,
      url: pageOf('a1'),
    });
    expect(titleOf(downloads, file!.id)).toBeNull();
    expect(JSON.parse(await closed(downloads))).toMatchObject({
      downloads: [{ title: null }, { title: 'A <b>trip</b>' }],
    });

    // Kept after a restart, and not asked again.
    const again = await open({ pageReader: reader });
    expect(titleOf(again, page!.id)).toBe('A <b>trip</b>');
    expect(titles).toHaveLength(1);
  });

  it('loads a ready row written before titles, or with a title no row shows, with none, and keeps it', async () => {
    const first = await open();
    const [older, long, empty] = await first.offer([pageOf('l1'), pageOf('l2'), pageOf('l3')]);
    const state = JSON.parse(await closed(first)) as {
      downloads: Record<string, unknown>[];
    };
    const [olderRow, longRow, emptyRow] = state.downloads;
    delete olderRow?.title;
    if (longRow !== undefined) longRow.title = 'x'.repeat(TITLE_MOST_CHARS + 1);
    if (emptyRow !== undefined) emptyRow.title = '';
    await writeFile(statePath(), JSON.stringify(state));

    const again = await open();
    expect(again.snapshot().downloads.map((download) => [download.id, download.title])).toEqual([
      [older!.id, null],
      [long!.id, null],
      [empty!.id, null],
    ]);
    expect(existsSync(`${statePath()}.unreadable`)).toBe(false);
  });

  it('says in the log that a title was read or not, never which, nor the page', async () => {
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });

    await downloads.offer([pageOf('pqr1'), pageOf('pqr2')]);
    titles[0]?.answer('Secret holiday');
    titles[1]?.fail(new PageError(PageFailure.VideoUnavailable, 'Private.'));
    await until(() => logger.lines.some((line) => line.includes('ready_title_not_read')));
    await until(() => logger.lines.some((line) => line.includes('ready_title_read')));

    const log = logger.lines.join('\n');
    expect(log).toContain(PageFailure.VideoUnavailable);
    expect(log).not.toContain('Secret holiday');
    expect(log).not.toContain('pqr1');
    expect(log).not.toContain('pqr2');
  });

  it('keeps the address of a row whose title could not be read, and does not ask again', async () => {
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });

    const [page] = await downloads.offer([pageOf('c1')]);
    titles[0]?.fail(new PageError(PageFailure.SiteBusy, 'Busy.'));
    await until(() => logger.lines.some((line) => line.includes('ready_title_not_read')));
    titles.length = 0;
    // Nothing more is asked of a row that has its answer, also when other links are copied.
    await downloads.offer([pageOf('c1'), 'https://files.example/one.zip']);

    expect(titleOf(downloads, page!.id)).toBeNull();
    expect(titles).toEqual([]);
  });

  it('asks nothing when no title is wanted: no reader, a file, a pasted page', async () => {
    const withNone = await open();
    const [page] = await withNone.offer([pageOf('d1')]);
    expect(titleOf(withNone, page!.id)).toBeNull();
    await closed(withNone);

    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });
    await downloads.offer(['https://files.example/movie.mkv']);
    // Pasted, a page starts at once, and its own read names it.
    downloads.add({ urls: [pageOf('d2')] });
    expect(titles).toEqual([]);
  });

  it('never holds back a Start: the row starts at once, and the title being read is stopped', async () => {
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });
    const [first, second] = await downloads.offer([pageOf('e1'), pageOf('e2')]);

    expect(downloads.start(first!.id).status).not.toBe(DownloadStatus.Ready);
    expect(titles[0]?.signal.aborted).toBe(true);
    // An answer that comes all the same is not kept.
    titles[0]?.answer('Too late');

    expect(downloads.startReady().map((download) => download.id)).toEqual([second!.id]);
    expect(titles[1]?.signal.aborted).toBe(true);
    // Nor a failure: a read that was stopped did not fail.
    titles[1]?.fail(new PageError(PageFailure.SiteBusy, 'Too late too.'));
    await Promise.resolve();

    expect(titleOf(downloads, first!.id)).toBeNull();
    expect(titleOf(downloads, second!.id)).toBeNull();
    expect(await closed(downloads)).not.toContain('Too late');
    expect(logger.lines.join('\n')).not.toMatch(/ready_title_(not_)?read/);
  });

  it('never reads the title of a row started while it waited its turn', async () => {
    // Ends what it reads at the stop, as yt-dlp does: the engine waits for it as it closes.
    const { reader, titles } = aReader(never, { hearsStop: true });
    const downloads = await open({ pageReader: reader });
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    const [, waiting] = await downloads.offer([pageOf('m1'), pageOf('m2'), pageOf('m3')]);

    downloads.start(waiting!.id);
    titles[0]?.answer('First');
    await until(() => titles.length === 2);

    expect(titles.map((ask) => ask.url)).toEqual([pageOf('m1'), pageOf('m3')]);
  });

  it('stops the title of a row removed, and keeps nothing of a late answer', async () => {
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });
    const [page] = await downloads.offer([pageOf('f1')]);

    await downloads.remove(page!.id, false);
    expect(titles[0]?.signal.aborted).toBe(true);
    titles[0]?.answer('Gone');
    await Promise.resolve();

    expect(downloads.snapshot().downloads).toEqual([]);
    expect(await closed(downloads)).not.toContain('Gone');
  });

  it('stops every title being read when the engine stops, and asks none of those waiting', async () => {
    // A reader that ends its read at the stop, which hands the turn on at once.
    const { reader, titles } = aReader(never, { hearsStop: true });
    const downloads = await open({ pageReader: reader });
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    await downloads.offer([pageOf('g1'), pageOf('g2')]);

    await closed(downloads);
    expect(titles).toHaveLength(1);
    expect(titles[0]?.signal.aborted).toBe(true);
    await new Promise((settle) => setImmediate(settle));
    expect(titles).toHaveLength(1);

    // A copy that reaches an engine that has stopped starts no reader either.
    await downloads.offer([pageOf('g3')]);
    expect(titles).toHaveLength(1);
  });

  it('reads no more titles at once than the queue starts downloads, the pages read for downloads counted with them', async () => {
    const site = await startRangeServer({
      body: Buffer.from('<html></html>'),
      contentType: 'text/html',
    });
    // The video the page plays, which goes on downloading long after its page was read.
    const slow = await startRangeServer({
      body: video,
      fileName: 'slow.mp4',
      chunkBytes: 1024,
      chunkDelayMs: 500,
    });
    servers.push(site, slow);
    let readDone: () => void = () => undefined;
    const { reader, titles, reads, inFlight } = aReader(
      () =>
        new Promise((done) => {
          readDone = () => {
            done({ title: 'Slow', formats: [{ ...FORMAT, url: slow.url }] });
          };
        }),
    );
    const downloads = await open({ pageReader: reader, source: new HttpSource('scia-test') });
    downloads.updateSettings({ maxConcurrentDownloads: 2 });
    // A pasted page whose site is being read for the download.
    const [pasted] = downloads.add({ urls: [site.url] });
    await until(() => reads.length === 1);

    const offered = await downloads.offer([pageOf('h1'), pageOf('h2'), pageOf('h3')]);
    expect(inFlight().map((ask) => ask.url)).toEqual([pageOf('h1')]);

    // The download's read is done: its turn goes to the next title at once, while the download
    // itself goes on.
    readDone();
    await until(() => inFlight().length === 2);
    expect(downloads.find(pasted!.id).status).toBe(DownloadStatus.Downloading);
    titles[0]?.answer('One');
    await until(() => titles.length === 3);
    expect(inFlight().map((ask) => ask.url)).toEqual([pageOf('h2'), pageOf('h3')]);

    // More room, more titles at once; a Start never waits for one.
    titles[1]?.answer('Two');
    titles[2]?.answer('Three');
    await until(() => offered.every((download) => titleOf(downloads, download.id) !== null));
    expect(offered.map((download) => titleOf(downloads, download.id))).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('asks the next title when the queue is given more room', async () => {
    const { reader, inFlight } = aReader(never, { hearsStop: true });
    const downloads = await open({ pageReader: reader });
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    await downloads.offer([pageOf('i1'), pageOf('i2')]);
    expect(inFlight()).toHaveLength(1);

    downloads.updateSettings({ maxConcurrentDownloads: 3 });
    expect(inFlight()).toHaveLength(2);
  });

  it('says the title until the file is named, then the file’s name says it', async () => {
    const site = await startRangeServer({
      body: Buffer.from('<html></html>'),
      contentType: 'text/html',
    });
    const files = await startRangeServer({ body: video });
    servers.push(site, files);
    const http = new HttpSource('scia-test');
    // The page's address is answered by the local site: nothing reaches the real one.
    const local = (url: string) => (url === pageOf('j1') ? site.url : url);
    const source: RemoteSource = {
      probe: (url, headers, signal) => http.probe(local(url), headers, signal),
      open: (url, headers, range, signal) => http.open(local(url), headers, range, signal),
    };
    const { reader, titles } = aReader(() =>
      Promise.resolve({
        title: 'The trip',
        formats: [{ ...FORMAT, url: files.url }],
      }),
    );
    const downloads = await open({ pageReader: reader, source });
    const [page] = await downloads.offer([pageOf('j1')]);
    titles[0]?.answer('The trip, as copied');
    await until(() => titleOf(downloads, page!.id) !== null);

    downloads.start(page!.id);
    await until(() => downloads.find(page!.id).status === DownloadStatus.Completed);
    expect(downloads.find(page!.id)).toMatchObject({ fileName: 'The trip.mp4', title: null });
  });

  describe('with yt-dlp as it answers (a stand-in)', () => {
    it('shows the title yt-dlp prints for the page, one line cut to what a row shows', async () => {
      const reader = new YtDlp({
        command: process.execPath,
        prefix: [FAKE_YT_DLP, join(folder.path, 'given.json')],
        timeoutMs: 10_000,
        tempDir: join(folder.path, 'temp'),
        logger: silentLogger,
      });
      const downloads = await open({ pageReader: reader });

      const [short, long] = await downloads.offer([
        `${pageOf('k1')}&from=/far-title`,
        `${pageOf('k2')}&from=/long-title`,
      ]);
      await until(
        () => titleOf(downloads, short!.id) !== null && titleOf(downloads, long!.id) !== null,
        20_000,
      );

      expect(titleOf(downloads, short!.id)).toBe(
        String.fromCodePoint(0xc9, 0x20, 0x6771, 0x4eac, 0x20, 0x1f3ac),
      );
      expect(titleOf(downloads, long!.id)).toHaveLength(TITLE_MOST_CHARS);
      expect(downloads.find(long!.id).status).toBe(DownloadStatus.Ready);
    }, 30_000);

    it('waits, as it stops, for the yt-dlp of the title it stopped: its tree ended, its folder removed', async () => {
      const givenFile = join(folder.path, 'given.json');
      const tempDir = join(folder.path, 'temp');
      const reader = new YtDlp({
        command: process.execPath,
        prefix: [FAKE_YT_DLP, givenFile],
        timeoutMs: 60_000,
        tempDir,
        logger: silentLogger,
      });
      const downloads = await open({ pageReader: reader });
      // As yt-dlp's Windows build reads: a second process holds the output (#170).
      await downloads.offer([`${pageOf('q1')}&from=/two-processes`]);
      await until(() => existsSync(`${givenFile}.holder`));
      const { pid } = JSON.parse(await readFile(givenFile, 'utf8')) as { pid: number };
      const holder = Number(await readFile(`${givenFile}.holder`, 'utf8'));

      await closed(downloads);

      expect(isRunning(pid)).toBe(false);
      expect(await readdir(tempDir)).toEqual([]);
      await until(() => !isRunning(holder));
    }, 30_000);
  });

  it('starts no title once the engine begins to stop, also for a copy that lands while it stops', async () => {
    let sendAsked = false;
    let letSendAnswer: () => void = () => undefined;
    // A magnet the service takes its time to receive: the stop waits for that turn.
    const magnets: MagnetService = {
      hasService: () => true,
      send: () =>
        new Promise((answer) => {
          sendAsked = true;
          letSendAnswer = () => {
            answer([]);
          };
        }),
      states: () => Promise.resolve([]),
      files: () => Promise.resolve(new Map()),
    };
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader, magnets });
    downloads.addMagnets([`magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Slow`]);
    await until(() => sendAsked);

    const stopping = downloads.close();
    manager = undefined;
    await downloads.offer([pageOf('r1')]);
    letSendAnswer();
    await stopping;

    expect(titles).toEqual([]);
  });

  it('runs no more yt-dlp at once than the queue starts downloads: a download’s page takes the turn of the newest title, which waits again', async () => {
    const site = await startRangeServer({
      body: Buffer.from('<html></html>'),
      contentType: 'text/html',
    });
    servers.push(site);
    let readsLive = 0;
    let most = 0;
    const answers: (() => void)[] = [];
    const { reader, titles, reads, inFlight } = aReader(
      () =>
        new Promise((done) => {
          readsLive += 1;
          most = Math.max(most, readsLive + inFlight().length);
          answers.push(() => {
            readsLive -= 1;
            done(undefined);
          });
        }),
      { hearsStop: true },
    );
    const downloads = await open({ pageReader: reader, source: new HttpSource('scia-test') });
    downloads.updateSettings({ maxConcurrentDownloads: 2 });
    const offered = await downloads.offer([pageOf('s1'), pageOf('s2')]);
    expect(inFlight()).toHaveLength(2);

    // Two downloads start, each reading its page: neither waits, and each takes a title's turn —
    // the newest title's first, then the other's.
    downloads.add({ urls: [`${site.url}?one`] });
    await until(() => reads.length === 1);
    expect(inFlight().map((ask) => ask.url)).toEqual([pageOf('s1')]);
    downloads.add({ urls: [`${site.url}?two`] });
    await until(() => reads.length === 2);
    expect(inFlight()).toEqual([]);
    expect(most).toBe(2);

    // Each page read that ends hands its turn back to the titles, the first copied first.
    answers[0]?.();
    await until(() => titles.length === 3);
    expect(titles[2]?.url).toBe(pageOf('s1'));
    answers[1]?.();
    await until(() => titles.length === 4);
    expect(titles[3]?.url).toBe(pageOf('s2'));
    expect(most).toBe(2);

    titles[2]?.answer('One');
    titles[3]?.answer('Two');
    await until(() => offered.every((download) => titleOf(downloads, download.id) !== null));
    expect(offered.map((download) => titleOf(downloads, download.id))).toEqual(['One', 'Two']);
  });

  it('lets a stopped title that ends late free no turn of the one read again in its place', async () => {
    const site = await startRangeServer({
      body: Buffer.from('<html></html>'),
      contentType: 'text/html',
    });
    servers.push(site);
    const answers: (() => void)[] = [];
    // Deaf to the stop, as a yt-dlp that takes its time to end.
    const { reader, titles, inFlight } = aReader(
      () =>
        new Promise((done) => {
          answers.push(() => {
            done(undefined);
          });
        }),
    );
    const downloads = await open({ pageReader: reader, source: new HttpSource('scia-test') });
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    await downloads.offer([pageOf('v1'), pageOf('v2')]);
    downloads.add({ urls: [site.url] });
    await until(() => answers.length === 1);
    expect(titles[0]?.signal.aborted).toBe(true);
    answers[0]?.();
    // v1 is read again; the stopped read of it ends only now.
    await until(() => titles.length === 2);
    titles[0]?.answer('Late');
    await new Promise((settle) => setImmediate(settle));

    expect(inFlight().map((ask) => ask.url)).toEqual([pageOf('v1')]);
    expect(titles).toHaveLength(2);
    titles[1]?.answer('One');
    await until(() => titles.length === 3);
    titles[2]?.answer('Two');
  });

  it('hands a started row’s turn to the next title at once, before its yt-dlp has ended', async () => {
    const { reader, titles } = aReader();
    const downloads = await open({ pageReader: reader });
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    const [first] = await downloads.offer([pageOf('w1'), pageOf('w2')]);

    downloads.start(first!.id);

    expect(titles.map((ask) => ask.url)).toEqual([pageOf('w1'), pageOf('w2')]);
    // What the engine waits for as it stops: every read, the stopped one too.
    titles[0]?.answer(undefined);
    titles[1]?.answer('Two');
  });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
