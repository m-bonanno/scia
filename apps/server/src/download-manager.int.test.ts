import { randomBytes } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager, type ManagerDeps, PART_SUFFIX } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { markerFor } from './origin-mark.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { refusingFiles, scratchFolder, silentLogger, until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
const body = randomBytes(4 * MIB + 7);

describe('DownloadManager', () => {
  const source = new HttpSource('scia-test');
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let servers: RangeServer[];
  let manager: DownloadManager | undefined;

  beforeEach(async () => {
    folder = await scratchFolder();
    servers = [];
  });
  afterEach(async () => {
    await manager?.close();
    manager = undefined;
    await Promise.all(servers.map((server) => server.close()));
    await folder.remove();
  });

  async function host(options: Partial<RangeServerOptions> = {}): Promise<RangeServer> {
    const server = await startRangeServer({ body, ...options });
    servers.push(server);
    return server;
  }

  async function open(overrides: Partial<ManagerDeps> = {}): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(join(folder.path, 'data', 'state.json')),
      defaultDirectory: join(folder.path, 'downloads'),
      logger: silentLogger,
      retryDelayMs: () => 1,
      ...overrides,
    });
    return manager;
  }

  const statusOf = (downloads: DownloadManager, id: string) => downloads.find(id).status;
  const inDownloads = (name: string) => join(folder.path, 'downloads', name);

  it('downloads a file under the name the host gives it and leaves no part file', async () => {
    const { url } = await host({ fileName: 'Film.mkv' });
    const downloads = await open();

    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    expect(await readdir(join(folder.path, 'downloads'))).toEqual(['Film.mkv']);
    const finished = downloads.find(added!.id);
    expect(finished.downloadedBytes).toBe(body.length);
    expect(finished.totalBytes).toBe(body.length);
    expect(finished.completedAt).not.toBeNull();
  });

  it('marks a file as coming from the network before it appears under its name', async () => {
    const { url } = await host({ fileName: 'setup.exe' });
    const marked: { path: string; alreadyNamed: boolean }[] = [];
    const downloads = await open({
      markDownloaded: async (path) => {
        marked.push({ path, alreadyNamed: existsSync(inDownloads('setup.exe')) });
      },
    });

    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(marked).toEqual([{ path: inDownloads(`setup.exe${PART_SUFFIX}`), alreadyNamed: false }]);
  });

  it('looks at the name only after the mark: a file that takes the name meanwhile is left alone', async () => {
    const { url } = await host({ fileName: 'setup.exe' });
    const downloads = await open({
      // While the mark is being written, someone else puts a file of that name in the folder.
      markDownloaded: async (path) => {
        await markerFor(process.platform)(path);
        await writeFile(inDownloads('setup.exe'), 'not ours');
      },
    });

    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(await readFile(inDownloads('setup.exe'), 'utf8')).toBe('not ours');
    expect(downloads.find(added!.id).fileName).toBe('setup (1).exe');
    expect(Buffer.compare(await readFile(inDownloads('setup (1).exe')), body)).toBe(0);
    if (process.platform === 'win32') {
      // The mark went with the part file to the name it found free.
      expect(await readFile(`${inDownloads('setup (1).exe')}:Zone.Identifier`, 'utf8')).toBe(
        '[ZoneTransfer]\r\nZoneId=3\r\n',
      );
    }
  });

  it('keeps a file whose disk refuses the mark, and says so in the log', async () => {
    const { url } = await host({ fileName: 'Film.mkv' });
    const warned: { event: string; details: object | undefined }[] = [];
    const downloads = await open({
      logger: {
        ...silentLogger,
        warn: (event, details) => {
          warned.push({ event, details });
        },
      },
      markDownloaded: async () => {
        throw new Error('This disk has no streams.');
      },
    });

    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
    // Named by its id, as every other event of a download: the engine adds no path of its own.
    expect(warned.map((warning) => warning.event)).toEqual(['mark_refused']);
    expect(warned[0]?.details).toMatchObject({ id: added!.id });
    expect(JSON.stringify(warned)).not.toContain('Film.mkv');
  });

  it.runIf(process.platform === 'win32')(
    'on Windows, leaves on a finished file the zone it came from and nothing else',
    async () => {
      const { url } = await host({ fileName: 'setup.exe' });
      const downloads = await open();

      const [added] = downloads.add({ urls: [url] });
      await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

      expect(await readFile(`${inDownloads('setup.exe')}:Zone.Identifier`, 'utf8')).toBe(
        '[ZoneTransfer]\r\nZoneId=3\r\n',
      );
    },
  );

  it('never overwrites a file already in the folder', async () => {
    const { url } = await host();
    const downloads = await open();
    const [first] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, first!.id) === DownloadStatus.Completed);
    await writeFile(inDownloads('sample.bin'), 'mine');

    const [second] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, second!.id) === DownloadStatus.Completed);

    expect(downloads.find(second!.id).fileName).toBe('sample (1).bin');
    expect(await readFile(inDownloads('sample.bin'), 'utf8')).toBe('mine');
  });

  it('sends what is added afterwards to a new folder, and leaves what was added before where it was going', async () => {
    const first = await host({ fileName: 'first.bin' });
    const second = await host({ fileName: 'second.bin' });
    const elsewhere = join(folder.path, 'elsewhere', 'films');
    const downloads = await open();

    const [before] = downloads.add({ urls: [first.url] });
    expect((await downloads.setDownloadDirectory(elsewhere)).downloadDirectory).toBe(elsewhere);
    const [after] = downloads.add({ urls: [second.url] });
    await until(
      () =>
        statusOf(downloads, before!.id) === DownloadStatus.Completed &&
        statusOf(downloads, after!.id) === DownloadStatus.Completed,
    );

    expect(Buffer.compare(await readFile(inDownloads('first.bin')), body)).toBe(0);
    expect(Buffer.compare(await readFile(join(elsewhere, 'second.bin')), body)).toBe(0);
  });

  it('keeps the chosen folder when the engine stops and starts again', async () => {
    const elsewhere = join(folder.path, 'elsewhere');
    const downloads = await open();
    await downloads.setDownloadDirectory(elsewhere);
    await downloads.close();

    expect((await open()).settings().downloadDirectory).toBe(elsewhere);
  });

  it('refuses a folder it cannot use, and changes nothing', async () => {
    const downloads = await open();
    const before = downloads.settings().downloadDirectory;
    await writeFile(join(folder.path, 'a-file'), 'in the way');

    await expect(downloads.setDownloadDirectory('films')).rejects.toThrow(
      'The folder has to be an absolute path.',
    );
    await expect(
      downloads.setDownloadDirectory(join(folder.path, 'a-file', 'inside')),
    ).rejects.toThrow('The folder cannot be made or written to.');

    expect(downloads.settings().downloadDirectory).toBe(before);
  });

  it('refuses a folder that is there and takes no file, and leaves nothing of its own in it', async () => {
    const locked = join(folder.path, 'locked');
    await mkdir(locked);
    const unlock = await refusingFiles(locked);
    const downloads = await open();
    const before = downloads.settings().downloadDirectory;

    try {
      await expect(downloads.setDownloadDirectory(locked)).rejects.toThrow(
        'The folder cannot be made or written to.',
      );
    } finally {
      await unlock();
    }

    expect(downloads.settings().downloadDirectory).toBe(before);
    expect(await readdir(locked)).toEqual([]);
  });

  it('keeps the folder as the system names it, whatever way it was written', async () => {
    const downloads = await open();
    const elsewhere = join(folder.path, 'elsewhere');

    const kept = await downloads.setDownloadDirectory(`${elsewhere}${sep}films${sep}..${sep}`);

    expect(kept.downloadDirectory).toBe(elsewhere);
    // The path is read before anything is made: nothing is left of the detour.
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('stops waiting for a change when whoever asked has gone', async () => {
    const downloads = await open();
    const seen = await downloads.nextChange(-1);
    const gone = new AbortController();
    let answered = false;

    // Nothing changes: the wait would last until something does.
    const waiting = downloads.nextChange(seen, gone.signal).then((version) => {
      answered = true;
      return version;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(answered).toBe(false);
    gone.abort();

    expect(await waiting).toBe(seen);
    // And asked by someone who has already gone, it does not wait at all.
    expect(await downloads.nextChange(seen, gone.signal)).toBe(seen);
  });

  it('leaves nothing on the signal of whoever waits, however many changes it is told of', async () => {
    const downloads = await open();
    const listening = new AbortController();
    let version = await downloads.nextChange(-1);

    for (const connections of [2, 3, 4, 5]) {
      const waiting = downloads.nextChange(version, listening.signal);
      downloads.updateSettings({ connectionsPerDownload: connections });
      version = await waiting;
      expect(getEventListeners(listening.signal, 'abort')).toHaveLength(0);
    }
  });

  it('holds a download under the speed limit', async () => {
    const { url } = await host({ body: randomBytes(MIB) });
    const downloads = await open();
    downloads.updateSettings({ speedLimitBytesPerSecond: MIB / 2 });

    const startedAt = Date.now();
    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    // A megabyte at half a megabyte a second: two seconds, less the first bytes, which wait
    // for nothing.
    expect(Date.now() - startedAt).toBeGreaterThan(1500);
  });

  it('holds files that arrive in one read under the limit, all of them together', async () => {
    const small = randomBytes(60_000);
    const { url } = await host({ body: small });
    const downloads = await open();
    downloads.updateSettings({ speedLimitBytesPerSecond: 256 * 1024 });

    const startedAt = Date.now();
    const added = downloads.add({ urls: Array.from({ length: 12 }, () => url) });
    await until(() =>
      added.every(({ id }) => statusOf(downloads, id) === DownloadStatus.Completed),
    );

    // 720 000 bytes at 256 KB/s: 2.7 seconds, less the three files that start together and wait
    // for nothing. Without a limit shared by every download they are done in a tenth of a second.
    expect(Date.now() - startedAt).toBeGreaterThan(1500);
    const files = await readdir(join(folder.path, 'downloads'));
    expect(files).toHaveLength(12);
    for (const file of files) {
      expect(Buffer.compare(await readFile(inDownloads(file)), small), file).toBe(0);
    }
  });

  it('frees every connection at once when the limit is lifted, without stopping the download', async () => {
    const { url } = await host({ fileName: 'Film.mkv' });
    const downloads = await open();
    // Four megabytes are four ranges, a connection each, a second apart: three of them are
    // waiting to open when the limit is lifted, the last for three seconds.
    downloads.updateSettings({ speedLimitBytesPerSecond: 64 * 1024 });

    const [added] = downloads.add({ urls: [url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    const liftedAt = Date.now();
    expect(downloads.updateSettings({ speedLimitBytesPerSecond: null })).toMatchObject({
      speedLimitBytesPerSecond: null,
    });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(Date.now() - liftedAt).toBeLessThan(1500);
    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
  });

  it('does not keep a paused download waiting on the limit, and resumes it byte for byte', async () => {
    const { url } = await host({ fileName: 'Film.mkv' });
    const downloads = await open();
    // Four connections, a second apart: three are waiting to open when the pause comes, the
    // last for three seconds, and the first for the four seconds before its next read.
    downloads.updateSettings({ speedLimitBytesPerSecond: 64 * 1024 });

    const [added] = downloads.add({ urls: [url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    const askedAt = Date.now();
    await downloads.pause(added!.id);

    expect(statusOf(downloads, added!.id)).toBe(DownloadStatus.Paused);
    expect(Date.now() - askedAt).toBeLessThan(500);

    downloads.updateSettings({ speedLimitBytesPerSecond: null });
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);
    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), body)).toBe(0);
  });

  it('reaches a high limit on one connection: a wait that ends late is made up', async () => {
    const large = randomBytes(32 * MIB);
    const { url } = await host({ body: large, fileName: 'Film.mkv' });
    const downloads = await open();
    // A read every two and a half milliseconds: less than a system's timer may take to fire.
    downloads.updateSettings({ speedLimitBytesPerSecond: 25 * MIB, connectionsPerDownload: 1 });

    const startedAt = Date.now();
    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);
    const took = Date.now() - startedAt;

    // Thirty-two megabytes at twenty-five a second: 1.28 seconds. Not faster, and not at a
    // third of the limit, which is what one read a tick comes to.
    expect(took).toBeGreaterThan(1150);
    expect(took).toBeLessThan(1900);
    expect(Buffer.compare(await readFile(inDownloads('Film.mkv')), large)).toBe(0);
  });

  it('reads no more than the limit gives while the connections of a download open, from a host that does not pause', async () => {
    const { url } = await host({ body: randomBytes(8 * MIB) });
    const downloads = await open();
    const limit = 256 * 1024;
    downloads.updateSettings({ speedLimitBytesPerSecond: limit });

    const startedAt = Date.now();
    const [added] = downloads.add({ urls: [url] });
    // The two seconds in which the eight connections open, a quarter of a second apart: the
    // wait is the stretch that is measured.
    await until(() => Date.now() - startedAt >= 2000);
    const read = downloads.find(added!.id).downloadedBytes;
    const given = (limit * (Date.now() - startedAt)) / 1000;

    // What the limit gives, to within a read: not a second read on each connection's turn.
    expect(read).toBeLessThanOrEqual(given + 64 * 1024);
    expect(read).toBeGreaterThan(given / 2);
  });

  it('lets the reads under way finish when a limit is set, one for each connection, and has them paid for', async () => {
    // Fast enough to be reading on every connection, slow enough to last: 50 MB/s over eight.
    const { url } = await host({ body: randomBytes(32 * MIB), chunkDelayMs: 10 });
    // What the engine reads, counted as it takes it: what it has written lags behind.
    let read = 0;
    const counting: ManagerDeps['source'] = {
      probe: (...asked) => source.probe(...asked),
      open: async (...asked) => {
        const answer = await source.open(...asked);
        return (async function* () {
          for await (const chunk of answer) {
            read += chunk.byteLength;
            yield chunk;
          }
        })();
      },
    };
    const downloads = await open({ source: counting });
    const limit = 256 * 1024;
    const aRead = 64 * 1024;

    downloads.add({ urls: [url] });
    await until(() => read > 2 * MIB);
    downloads.updateSettings({ speedLimitBytesPerSecond: limit });
    const setAt = Date.now();
    const readAtSet = read;
    const since = () => ({ bytes: read - readAtSet, given: (limit * (Date.now() - setAt)) / 1000 });

    // Half a second later: the eight reads that were under way, and no second one beside them.
    await until(() => Date.now() - setAt >= 500);
    const early = since();
    expect(early.bytes).toBeLessThanOrEqual(8 * aRead + early.given + aRead);

    // Each connection books the read it made with the next one, so the first round goes at half
    // the limit: four seconds, after which what was read is what the limit gives.
    await until(() => Date.now() - setAt >= 4500);
    const late = since();
    expect(late.bytes).toBeLessThanOrEqual(late.given + 2 * aRead);
    expect(late.bytes).toBeGreaterThan(late.given * 0.7);
  });

  it('leaves nothing owed by a download paused in its stride, or while its connections wait their turn', async () => {
    const film = await host({ body: randomBytes(8 * MIB), fileName: 'Film.mkv' });
    const cover = randomBytes(60_000);
    const image = await host({ body: cover, fileName: 'cover.jpg' });
    const downloads = await open();
    downloads.updateSettings({ speedLimitBytesPerSecond: 256 * 1024 });
    for (const reads of [1, 12]) {
      // After one read the other seven connections have booked and not read; after twelve,
      // every connection has read and waits its turn again.
      const [paused] = downloads.add({ urls: [film.url] });
      await until(() => downloads.find(paused!.id).downloadedBytes >= reads * 60_000);
      await downloads.pause(paused!.id);

      const addedAt = Date.now();
      const [added] = downloads.add({ urls: [image.url] });
      await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

      // It waits for the read under way when the pause came, a quarter of a second at most,
      // and takes the quarter of a second its own bytes need — not a turn of the paused eight.
      expect(Date.now() - addedAt, `paused after ${String(reads)} reads`).toBeLessThan(900);
      await downloads.remove(paused!.id, true);
      await downloads.remove(added!.id, false);
    }
    expect(Buffer.compare(await readFile(inDownloads('cover.jpg')), cover)).toBe(0);
  });

  it('goes on under the limit when the clock of the system is set back', async () => {
    const { url } = await host();
    let setBackMs = 0;
    const downloads = await open({ now: () => Date.now() - setBackMs });
    // Four megabytes at two a second: two seconds.
    downloads.updateSettings({ speedLimitBytesPerSecond: 2 * MIB });

    const [added] = downloads.add({ urls: [url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    setBackMs = 3_600_000;

    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed, 6000);
  });

  it('does not ask a host again for what the limit made it wait to send', async () => {
    const patient = new HttpSource('scia-test', { idleTimeoutMs: 200 });
    try {
      const { url, ranges } = await host({ body: randomBytes(MIB) });
      const downloads = await open({ source: patient });
      // One connection, a read a second: five times what the host may stay silent for.
      downloads.updateSettings({ speedLimitBytesPerSecond: 64 * 1024, connectionsPerDownload: 1 });

      const [added] = downloads.add({ urls: [url] });
      await until(() => downloads.find(added!.id).downloadedBytes >= 3 * 64 * 1024);

      // The probe and the one range: a connection cut for its silence would have asked again.
      expect(ranges).toHaveLength(2);
      expect(statusOf(downloads, added!.id)).toBe(DownloadStatus.Downloading);
    } finally {
      await manager?.close();
      manager = undefined;
      patient.close();
    }
  });

  it('loads a state written before the speed limit existed, with no limit', async () => {
    const statePath = join(folder.path, 'data', 'state.json');
    await mkdir(join(folder.path, 'data'), { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        settings: {
          maxConcurrentDownloads: 2,
          connectionsPerDownload: 4,
          downloadDirectory: join(folder.path, 'downloads'),
        },
        downloads: [],
      }),
    );

    expect((await open()).settings()).toEqual({
      maxConcurrentDownloads: 2,
      connectionsPerDownload: 4,
      downloadDirectory: join(folder.path, 'downloads'),
      speedLimitBytesPerSecond: null,
      theme: 'black-tie',
      betaUpdates: false,
      watchClipboard: false,
    });
    expect(existsSync(`${statePath}.unreadable`)).toBe(false);
  });

  it('keeps the betas switch after a restart, and loads a state whose switch is not one with it off', async () => {
    const first = await open();
    expect(first.settings().betaUpdates).toBe(false);
    first.updateSettings({ betaUpdates: true });
    await first.close();
    const statePath = join(folder.path, 'data', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      settings: Record<string, unknown>;
    };
    expect(state.settings.betaUpdates).toBe(true);

    const second = await open();
    expect(second.settings().betaUpdates).toBe(true);
    await second.close();
    state.settings.betaUpdates = 'yes';
    await writeFile(statePath, JSON.stringify(state));

    expect((await open()).settings().betaUpdates).toBe(false);
    expect(existsSync(`${statePath}.unreadable`)).toBe(false);
  });

  it('loads a state that names a theme of another time with the default one, and keeps its downloads', async () => {
    const { url } = await host();
    const first = await open();
    const [added] = first.add({ urls: [url] });
    await until(() => statusOf(first, added!.id) === DownloadStatus.Completed);
    first.updateSettings({ theme: 'ice' });
    await first.close();
    const statePath = join(folder.path, 'data', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      settings: Record<string, unknown>;
    };
    expect(state.settings.theme).toBe('ice');
    state.settings.theme = 'teal';
    await writeFile(statePath, JSON.stringify(state));

    const again = await open();

    expect(again.settings().theme).toBe('black-tie');
    expect(statusOf(again, added!.id)).toBe(DownloadStatus.Completed);
    expect(existsSync(`${statePath}.unreadable`)).toBe(false);
  });

  it('loads a state whose limit is below the floor of today with no limit, and keeps its downloads', async () => {
    const { url } = await host();
    const first = await open();
    const [added] = first.add({ urls: [url] });
    await until(() => statusOf(first, added!.id) === DownloadStatus.Completed);
    await first.close();
    const statePath = join(folder.path, 'data', 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      settings: Record<string, unknown>;
    };
    state.settings.speedLimitBytesPerSecond = 1000;
    await writeFile(statePath, JSON.stringify(state));

    const again = await open();

    expect(again.settings().speedLimitBytesPerSecond).toBeNull();
    expect(statusOf(again, added!.id)).toBe(DownloadStatus.Completed);
    expect(existsSync(`${statePath}.unreadable`)).toBe(false);
  });

  it('runs no more downloads at once than the setting allows', async () => {
    const { url } = await host({ chunkDelayMs: 3 });
    const downloads = await open();
    downloads.updateSettings({ maxConcurrentDownloads: 1 });

    const [first, second] = downloads.add({ urls: [url, url] });

    await until(() => downloads.find(first!.id).downloadedBytes > 0);
    expect(statusOf(downloads, second!.id)).toBe(DownloadStatus.Queued);
    await until(() => statusOf(downloads, second!.id) === DownloadStatus.Completed);
    expect(statusOf(downloads, first!.id)).toBe(DownloadStatus.Completed);
  });

  it('pauses, keeps the bytes, and resumes to the same file', async () => {
    const { url } = await host({ chunkDelayMs: 5 });
    const downloads = await open();
    const [added] = downloads.add({ urls: [url] });
    await until(() => downloads.find(added!.id).downloadedBytes > MIB);

    const paused = await downloads.pause(added!.id);

    expect(paused.status).toBe(DownloadStatus.Paused);
    expect(paused.downloadedBytes).toBeGreaterThan(0);
    expect(paused.bytesPerSecond).toBe(0);
    expect(existsSync(inDownloads('sample.bin.scia'))).toBe(true);

    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);
    expect(Buffer.compare(await readFile(inDownloads('sample.bin')), body)).toBe(0);
  });

  it('goes on after the engine stops and starts again', async () => {
    const { url } = await host({ chunkDelayMs: 5 });
    const first = await open();
    const [added] = first.add({ urls: [url] });
    await until(() => first.find(added!.id).downloadedBytes > MIB);
    await first.close();

    const second = await open();

    await until(() => statusOf(second, added!.id) === DownloadStatus.Completed);
    expect(Buffer.compare(await readFile(inDownloads('sample.bin')), body)).toBe(0);
  });

  it('removes a running download with its unfinished bytes', async () => {
    const { url } = await host({ chunkDelayMs: 5 });
    const downloads = await open();
    const [added] = downloads.add({ urls: [url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);

    await downloads.remove(added!.id, false);

    expect(downloads.snapshot().downloads).toEqual([]);
    expect(await readdir(join(folder.path, 'downloads'))).toEqual([]);
  });

  it('keeps a finished file unless asked to delete it', async () => {
    const { url } = await host();
    const downloads = await open();
    const [kept, deleted] = downloads.add({ urls: [url, url] });
    await until(
      () =>
        statusOf(downloads, kept!.id) === DownloadStatus.Completed &&
        statusOf(downloads, deleted!.id) === DownloadStatus.Completed,
    );

    // Which of the two took the plain name is the network's choice.
    const keptName = downloads.find(kept!.id).fileName;

    await downloads.remove(kept!.id, false);
    await downloads.remove(deleted!.id, true);

    expect(await readdir(join(folder.path, 'downloads'))).toEqual([keptName]);
  });

  it('says why a download failed, and resumes it when asked', async () => {
    const { url } = await host({ status: 404 });
    const downloads = await open();

    const [added] = downloads.add({ urls: [url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    const failed = downloads.find(added!.id);
    expect(failed.failure).toBe(DownloadFailure.HttpStatus);
    expect(failed.failureStatus).toBe(404);
    expect(downloads.resume(added!.id).failure).toBeNull();
  });

  it('wakes whoever waits for a change', async () => {
    const downloads = await open();
    const version = await downloads.nextChange(-1);
    const next = downloads.nextChange(version);

    downloads.updateSettings({ connectionsPerDownload: 2 });

    expect(await next).toBeGreaterThan(version);
    expect(downloads.settings().connectionsPerDownload).toBe(2);
  });

  it('says when a download starts to run or wait, and when none does any more', async () => {
    const { url } = await host({ chunkBytes: 64 * 1024, chunkDelayMs: 20 });
    const downloads = await open();
    downloads.updateSettings({ maxConcurrentDownloads: 1 });
    const told: boolean[] = [];
    const stop = downloads.onBusyChange((busy) => told.push(busy));
    expect(downloads.isBusy()).toBe(false);

    const [first, second] = downloads.add({ urls: [url, url] });
    expect(downloads.isBusy()).toBe(true);
    // The second waits its turn while the first runs: still busy, and not said again.
    await downloads.pause(first!.id);
    expect(downloads.isBusy()).toBe(true);
    await downloads.pause(second!.id);
    expect(downloads.isBusy()).toBe(false);
    expect(told).toEqual([true, false]);

    stop();
    downloads.resume(first!.id);
    expect(downloads.isBusy()).toBe(true);
    expect(told).toEqual([true, false]);
  });
});
