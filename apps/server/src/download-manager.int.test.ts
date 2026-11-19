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
