import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadStatus, PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager, type ManagerDeps } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import { PageError, type PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, silentLogger, until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
const page = Buffer.from('<!doctype html><title>A video</title><video src="/x"></video>');
const video = randomBytes(3 * MIB + 11);

// A reader of sites that answers as it is told, and counts what it was asked.
function aReader(answer: (url: string) => Promise<PageMedia | undefined>) {
  const asked: string[] = [];
  const reader: PageReader = {
    read: (url) => {
      asked.push(url);
      return answer(url);
    },
  };
  return { reader, asked };
}

const formatAt = (url: string, overrides: Partial<PageFormat> = {}): PageFormat => ({
  url,
  protocol: 'http',
  ext: 'mp4',
  vcodec: 'avc1',
  acodec: 'mp4a',
  height: 1080,
  hasDrm: false,
  headers: { 'User-Agent': 'SiteAgent/1', Referer: 'https://site.example/watch' },
  ...overrides,
});

describe('DownloadManager and a link that is a page', () => {
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

  async function host(options: Partial<RangeServerOptions> & { body: Buffer }) {
    const server = await startRangeServer(options);
    servers.push(server);
    return server;
  }
  async function open(overrides: Partial<ManagerDeps> = {}) {
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

  it('downloads the video a page plays, under what the site calls it, with the headers the site asks for', async () => {
    const site = await host({ body: page, contentType: 'text/html; charset=utf-8' });
    const files = await host({ body: video, fileName: 'videoplayback.mp4' });
    const { reader, asked } = aReader(async () => ({
      title: 'A video: the trip',
      formats: [formatAt(files.url, { height: 360 }), formatAt(files.url)],
    }));
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([site.url]);
    expect(await readdir(join(folder.path, 'downloads'))).toEqual(['A video_ the trip.mp4']);
    expect(Buffer.compare(await readFile(inDownloads('A video_ the trip.mp4')), video)).toBe(0);
    expect(downloads.find(added!.id).media).toEqual({ ext: 'mp4', height: 1080 });
    expect(files.asked.every((request) => request.userAgent === 'SiteAgent/1')).toBe(true);
    expect(files.asked.every((request) => request.referer === 'https://site.example/watch')).toBe(
      true,
    );
  });

  it('fetches a page of a site the reader does not know as it stands, as before', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const { reader, asked } = aReader(async () => undefined);
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([site.url]);
    expect(Buffer.compare(await readFile(inDownloads('sample.bin')), page)).toBe(0);
    expect(downloads.find(added!.id).media).toBeNull();
  });

  it('never asks the reader about a link that is a file', async () => {
    const files = await host({ body: video, contentType: 'video/mp4' });
    const { reader, asked } = aReader(async () => undefined);
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [files.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([]);
  });

  it('says why a video was not downloaded, and reads the page again when it is tried again', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const files = await host({ body: video });
    let protectedVideo = true;
    const { reader, asked } = aReader(async () => {
      if (protectedVideo) throw new PageError(PageFailure.Drm, 'protected');
      return { title: 'Now open', formats: [formatAt(files.url)] };
    });
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);
    expect(downloads.find(added!.id).failure).toBe(PageFailure.Drm);

    protectedVideo = false;
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);
    expect(asked).toHaveLength(2);
    expect(Buffer.compare(await readFile(inDownloads('Now open.mp4')), video)).toBe(0);
  });

  it('reads the page again for a new address when the address of its video stopped working', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const expired = await host({ body: video, status: 403 });
    const files = await host({ body: video });
    let address = expired.url;
    const { reader, asked } = aReader(async () => ({
      title: 'Signed',
      formats: [formatAt(address)],
    }));
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);
    address = files.url;
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([site.url, site.url]);
    expect(Buffer.compare(await readFile(inDownloads('Signed.mp4')), video)).toBe(0);
  });

  it('says a video offered only as a stream is not one it can fetch yet', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const { reader } = aReader(async () => ({
      title: 'Stream',
      formats: [formatAt('https://cdn.example/index.m3u8', { protocol: 'm3u8_native' })],
    }));
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    expect(downloads.find(added!.id).failure).toBe(PageFailure.FormatUnsupported);
  });

  it('keeps the video it chose across a pause and a restart, and does not read the page again', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const files = await host({ body: video, chunkDelayMs: 5 });
    const { reader, asked } = aReader(async () => ({
      title: 'Kept',
      formats: [formatAt(files.url)],
    }));
    const downloads = await open({ pageReader: reader });
    const [added] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    await downloads.pause(added!.id);
    await downloads.close();

    const again = await open({ pageReader: reader });
    expect(again.find(added!.id).media).toEqual({ ext: 'mp4', height: 1080 });
    again.resume(added!.id);
    await until(() => statusOf(again, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([site.url]);
    expect(Buffer.compare(await readFile(inDownloads('Kept.mp4')), video)).toBe(0);
  });

  it('goes on with a page it fetches as it stands after a pause, without asking the reader again', async () => {
    const bigPage = Buffer.concat([page, randomBytes(2 * MIB)]);
    const site = await host({ body: bigPage, contentType: 'text/html', chunkDelayMs: 5 });
    const files = await host({ body: video });
    let known = false;
    const { reader, asked } = aReader(async () =>
      known ? { title: 'Late', formats: [formatAt(files.url)] } : undefined,
    );
    const downloads = await open({ pageReader: reader });
    const [added] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    await downloads.pause(added!.id);

    known = true;
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([site.url]);
    expect(downloads.find(added!.id).media).toBeNull();
    expect(Buffer.compare(await readFile(inDownloads('sample.bin')), bigPage)).toBe(0);
  });

  it('never reads a page a connected service sent it to: the service said what the link is', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const { reader, asked } = aReader(async () => ({ title: 'No', formats: [] }));
    const downloads = await open({
      pageReader: reader,
      resolver: {
        serviceFor: async () => 'alldebrid',
        unlock: async () => ({ url: site.url, fileName: 'from-the-service.html' }),
      },
    });

    const [added] = downloads.add({ urls: ['https://host.example/file/1'] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(asked).toEqual([]);
    expect(Buffer.compare(await readFile(inDownloads('from-the-service.html')), page)).toBe(0);
  });

  it('says to the video’s host only what its site asked for, never the page the link was on', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const files = await host({ body: video });
    const { reader } = aReader(async () => ({
      title: 'Plain',
      formats: [formatAt(files.url, { headers: {} })],
    }));
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url], referrer: 'https://elsewhere.example/list' });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(files.asked.map((request) => request.referer)).not.toContain(
      'https://elsewhere.example/list',
    );
    expect(files.asked.every((request) => request.referer === undefined)).toBe(true);
  });

  it('never says the video’s address in an answer or in the log, also when its host refuses it', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const refusing = await host({ body: video, status: 403 });
    const secret = `${refusing.url}?token=video-secret-0000`;
    const lines: string[] = [];
    const record = (event: string, details?: object) => {
      lines.push(JSON.stringify({ event, ...details }));
    };
    const { reader } = aReader(async () => ({ title: 'Secret', formats: [formatAt(secret)] }));
    const downloads = await open({
      pageReader: reader,
      logger: { info: record, warn: record, error: record },
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('video-secret-0000');
    expect(JSON.stringify(downloads.snapshot())).not.toContain('video-secret-0000');
  });

  it('goes on with the container its name carries when the page is read again, or says it cannot', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    // The first address stops answering in the middle: the download has a name and bytes.
    const going = await startRangeServer({ body: video, chunkDelayMs: 5 });
    const smaller = randomBytes(MIB + 5);
    const files = await host({ body: smaller });
    let offered: PageFormat[] = [formatAt(going.url)];
    const { reader } = aReader(async () => ({ title: 'Clip', formats: offered }));
    const downloads = await open({ pageReader: reader });
    const [added] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    await going.close();
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    // Only another container now: the name says mp4, and nothing of a webm is fetched into it.
    offered = [formatAt(files.url, { ext: 'webm', height: 2160 })];
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);
    expect(downloads.find(added!.id).failure).toBe(PageFailure.FormatUnsupported);

    offered = [
      formatAt(files.url, { ext: 'webm', height: 2160 }),
      formatAt(files.url, { height: 480 }),
    ];
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);
    expect(downloads.find(added!.id).fileName).toBe('Clip.mp4');
    expect(downloads.find(added!.id).media).toEqual({ ext: 'mp4', height: 480 });
    expect(Buffer.compare(await readFile(inDownloads('Clip.mp4')), smaller)).toBe(0);
  });

  it('names a video whose site gives it no title, or one of spaces, as a video', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const files = await host({ body: video });
    const { reader } = aReader(async () => ({ title: '   ', formats: [formatAt(files.url)] }));
    const downloads = await open({ pageReader: reader });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(downloads.find(added!.id).fileName).toBe('video.mp4');
  });

  it('reads a stored video whole or not at all: one whose description is refused keeps no address either', async () => {
    const stateFile = join(folder.path, 'data', 'state.json');
    const downloads = await open();
    downloads.add({ urls: ['http://127.0.0.1:9/never.html'] });
    await downloads.pause(downloads.snapshot().downloads[0]!.id);
    await downloads.close();
    manager = undefined;
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as {
      downloads: Record<string, unknown>[];
    };
    state.downloads[0]!.video = {
      media: { ext: 'mp4', height: -1 },
      source: { url: 'https://cdn.example/v.mp4', headers: {} },
    };
    await writeFile(stateFile, JSON.stringify(state));

    const loaded = await new JsonStateStore(stateFile).load();

    expect(loaded?.downloads[0]?.video).toBeNull();
  });

  it('fetches every page as it stands when there is no reader of sites', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const downloads = await open();

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(Buffer.compare(await readFile(inDownloads('sample.bin')), page)).toBe(0);
  });
});
