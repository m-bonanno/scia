import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadFailure, DownloadStatus } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, silentLogger, until } from './testing/scratch.ts';

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

  async function open(): Promise<DownloadManager> {
    manager = await DownloadManager.open({
      source,
      store: new JsonStateStore(join(folder.path, 'data', 'state.json')),
      defaultDirectory: join(folder.path, 'downloads'),
      logger: silentLogger,
      retryDelayMs: () => 1,
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
