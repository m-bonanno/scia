import { randomBytes } from 'node:crypto';
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
    // Eight connections with a read each to wait for: the last of them is owed eight seconds.
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
    // Eight connections, each waiting up to eight seconds for its turn when the pause comes.
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

  it('leaves nothing owed by a download paused while its connections wait their turn', async () => {
    const film = await host({ fileName: 'Film.mkv' });
    const cover = randomBytes(60_000);
    const image = await host({ body: cover, fileName: 'cover.jpg' });
    const downloads = await open();
    // Eight connections: one has read, seven have booked the seconds after it.
    downloads.updateSettings({ speedLimitBytesPerSecond: 64 * 1024 });
    const [paused] = downloads.add({ urls: [film.url] });
    await until(() => downloads.find(paused!.id).downloadedBytes > 0);
    await downloads.pause(paused!.id);

    const addedAt = Date.now();
    const [added] = downloads.add({ urls: [image.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    // It waits for the one read that was made, a second at most — not for the seven that were not.
    expect(Date.now() - addedAt).toBeLessThan(2500);
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
    });
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
});
