import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxHeaderOf, boxOf, childrenOf, DownloadStatus, PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadManager, type ManagerDeps } from './download-manager.ts';
import { HttpSource } from './http-source.ts';
import type { PageFormat } from './media-choice.ts';
import type { PageMedia, PageReader } from './page-reader.ts';
import { JsonStateStore } from './state-store.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, silentLogger, until } from './testing/scratch.ts';

// Made by testing/pair/generate.mjs: three seconds of picture and of sound, apart.
const FIXTURES = join(import.meta.dirname, 'testing', 'pair');
const fixture = (name: string) => readFile(join(FIXTURES, name));
const page = Buffer.from('<!doctype html><title>A video</title><video src="/x"></video>');

const format = (url: string, overrides: Partial<PageFormat>): PageFormat => ({
  url,
  protocol: 'http',
  ext: 'mp4',
  vcodec: 'avc1.42c00a',
  acodec: 'none',
  height: 64,
  hasDrm: false,
  headers: { 'User-Agent': 'SiteAgent/1' },
  bitrate: null,
  languagePreference: null,
  ...overrides,
});
const pictureAt = (url: string) => format(url, {});
const soundAt = (url: string) =>
  format(url, { ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', height: null, bitrate: 24 });

interface Box {
  readonly type: string;
  readonly bytes: Buffer;
}

// The boxes of a file, each with its bytes.
function boxesOf(file: Buffer): Box[] {
  const boxes: Box[] = [];
  let start = 0;
  while (start < file.byteLength) {
    const { type, size } = boxHeaderOf(file.subarray(start, start + 16), file.byteLength - start);
    boxes.push({ type, bytes: file.subarray(start, start + size) });
    start += size;
  }
  return boxes;
}

const typeOf = (box: Uint8Array) => String.fromCharCode(...box.subarray(4, 8));

// The handler of each track of the file's movie: `vide`, `soun`.
function handlersOf(file: Buffer): string[] {
  const moov = boxesOf(file).find((box) => box.type === 'moov')!.bytes;
  return childrenOf(moov)
    .filter((child) => typeOf(child) === 'trak')
    .map((trak) => {
      const mdia = childrenOf(trak).find((child) => typeOf(child) === 'mdia')!;
      const hdlr = childrenOf(mdia).find((child) => typeOf(child) === 'hdlr')!;
      return String.fromCharCode(...hdlr.subarray(16, 20));
    });
}

const payloadOf = (box: Box) =>
  box.bytes.subarray(boxHeaderOf(box.bytes, box.bytes.byteLength).headerSize);

describe('DownloadManager and a picture and a sound offered apart (docs/adr/0021)', () => {
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
  function reader(answer: () => PageMedia): PageReader {
    return { read: () => Promise.resolve(answer()), readTitle: () => Promise.resolve(undefined) };
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
  const downloadsFolder = () => join(folder.path, 'downloads');
  const statusOf = (downloads: DownloadManager, id: string) => downloads.find(id).status;

  async function pairOf(
    pictureName: string,
    soundName: string,
    extra: Partial<RangeServerOptions> = {},
  ) {
    const site = await host({ body: page, contentType: 'text/html' });
    const pictureBytes = await fixture(pictureName);
    const soundBytes = await fixture(soundName);
    const picture = await host({ body: pictureBytes, ...extra });
    const sound = await host({ body: soundBytes, ...extra });
    return { site, picture, sound, pictureBytes, soundBytes };
  }

  it('joins a plain picture and sound into one mp4 under the title, their media as they were', async () => {
    const { site, picture, sound, pictureBytes, soundBytes } = await pairOf(
      'picture.mp4',
      'sound.m4a',
    );
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'A video',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    // Nothing beside it: the picture and the sound are gone once joined.
    expect(await readdir(downloadsFolder())).toEqual(['A video.mp4']);
    const joined = await readFile(join(downloadsFolder(), 'A video.mp4'));
    expect(handlersOf(joined)).toEqual(['vide', 'soun']);
    const mediaOf = (file: Buffer) =>
      Buffer.concat(
        boxesOf(file)
          .filter((box) => box.type === 'mdat')
          .map(payloadOf),
      );
    expect(
      Buffer.compare(mediaOf(joined), Buffer.concat([mediaOf(pictureBytes), mediaOf(soundBytes)])),
    ).toBe(0);
    const done = downloads.find(added!.id);
    expect(done.media).toEqual({ ext: 'mp4', height: 64 });
    expect(done.totalBytes).toBe(joined.byteLength);
    // Both asked for with the headers the site gave.
    expect(
      [...picture.asked, ...sound.asked].every((asked) => asked.userAgent === 'SiteAgent/1'),
    ).toBe(true);
  });

  it('asks for the picture and the sound to be made sparse, and joins them all the same when they cannot be (#182)', async () => {
    const { site, picture, sound } = await pairOf('picture.mp4', 'sound.m4a');
    const marked: string[] = [];
    const warned: { event: string; details: object | undefined }[] = [];
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'A video',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
      logger: {
        ...silentLogger,
        warn: (event, details) => {
          warned.push({ event, details });
        },
      },
      markSparse: async (path) => {
        marked.push(path);
        throw new Error('fsutil did not answer.');
      },
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(await readdir(downloadsFolder())).toEqual(['A video.mp4']);
    expect(marked.map((path) => path.slice(path.lastIndexOf('.')))).toEqual(['.picture', '.sound']);
    expect(warned.map((warning) => warning.event)).toEqual([
      'part_file_not_sparse',
      'part_file_not_sparse',
    ]);
    for (const warning of warned) expect(warning.details).toMatchObject({ id: added!.id });
  });

  it('joins a fragmented picture and sound, as a DASH site gives them, every fragment of both', async () => {
    const { site, picture, sound, pictureBytes, soundBytes } = await pairOf(
      'picture-fragmented.mp4',
      'sound-fragmented.m4a',
    );
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'Fragments',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    const joined = await readFile(join(downloadsFolder(), 'Fragments.mp4'));
    const boxes = boxesOf(joined);
    expect(handlersOf(joined)).toEqual(['vide', 'soun']);
    // No sidx: it named places in the files it came from.
    expect(
      boxes.map((box) => box.type).filter((type) => type !== 'moof' && type !== 'mdat'),
    ).toEqual(['ftyp', 'moov']);
    const dataOf = (file: Buffer) => boxesOf(file).filter((box) => box.type === 'mdat');
    const fragments = [...dataOf(pictureBytes), ...dataOf(soundBytes)];
    expect(dataOf(joined)).toHaveLength(fragments.length);
    for (const fragment of fragments) expect(joined.includes(fragment.bytes)).toBe(true);
  });

  it('keeps what both files have across a pause and a restart, and asks for no byte twice', async () => {
    // The picture weighs more than it plays: a free box of 3 MiB after it, which the join leaves
    // out. Its host is slow enough to be paused partway.
    const site = await host({ body: page, contentType: 'text/html' });
    const pictureBytes = Buffer.concat([
      await fixture('picture.mp4'),
      Buffer.from(boxOf('free', new Uint8Array(3 * 1024 * 1024))),
    ]);
    const picture = await host({ body: pictureBytes, chunkBytes: 16 * 1024, chunkDelayMs: 5 });
    const sound = await host({ body: await fixture('sound.m4a') });
    const pageReader = reader(() => ({
      title: 'Paused',
      formats: [pictureAt(picture.url), soundAt(sound.url)],
    }));
    let downloads = await open({ pageReader });
    const [added] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 256 * 1024);
    await downloads.pause(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Paused);
    const kept = downloads.find(added!.id).downloadedBytes;
    expect(kept).toBeGreaterThan(0);
    expect(downloads.find(added!.id).totalBytes).toBe(
      pictureBytes.byteLength + (await fixture('sound.m4a')).byteLength,
    );
    await downloads.close();
    manager = undefined;
    // The sound's address is kept for the restart, in the state and nowhere else.
    expect(await readFile(join(folder.path, 'data', 'state.json'), 'utf8')).toContain(sound.url);

    downloads = await open({ pageReader });
    expect(downloads.find(added!.id).downloadedBytes).toBe(kept);
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed, 30_000);

    expect(handlersOf(await readFile(join(downloadsFolder(), 'Paused.mp4')))).toEqual([
      'vide',
      'soun',
    ]);
    // Asked again from where it stood: past the probes (`bytes=0-0`), no range starts at the
    // first byte twice, and every segment goes on from what it kept.
    const fetched = picture.ranges.filter((range) => range !== 'bytes=0-0');
    expect(fetched.filter((range) => range?.startsWith('bytes=0-'))).toHaveLength(1);
    expect(new Set(fetched).size).toBe(fetched.length);
  }, 60_000);

  it('fails a picture and sound it does not join as a format it cannot fetch, and keeps them for a retry', async () => {
    // The "picture" is a sound: no picture to join.
    const { site, picture, sound } = await pairOf('sound.m4a', 'sound.m4a');
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'Two sounds',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    expect(downloads.find(added!.id).failure).toBe(PageFailure.FormatUnsupported);
    expect(await readdir(downloadsFolder())).not.toContain('Two sounds.mp4');
  });

  it('removes the picture and the sound with a download that is removed before it ends', async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const picture = await host({
      body: Buffer.concat([
        await fixture('picture.mp4'),
        Buffer.from(boxOf('free', new Uint8Array(2 * 1024 * 1024))),
      ]),
      chunkBytes: 16 * 1024,
      chunkDelayMs: 5,
    });
    const sound = await host({ body: await fixture('sound.m4a') });
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'Removed',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(added!.id).downloadedBytes > 0);
    await downloads.remove(added!.id, false);

    expect(await readdir(downloadsFolder())).toEqual([]);
  });

  it('removes the picture and the sound when the page, read again, gives one file instead', async () => {
    // Two files it does not join: a plain picture beside a fragmented sound.
    const { site, picture, sound } = await pairOf('picture.mp4', 'sound-fragmented.m4a');
    const single = await host({ body: await fixture('picture.mp4') });
    let apart = true;
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'Changed',
        formats: apart
          ? [pictureAt(picture.url), soundAt(sound.url)]
          : [format(single.url, { acodec: 'mp4a.40.2' })],
      })),
    });
    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);
    // Kept for a retry: the bytes are there.
    expect((await readdir(downloadsFolder())).sort()).toEqual([
      'Changed.mp4.scia.picture',
      'Changed.mp4.scia.sound',
    ]);

    apart = false;
    downloads.resume(added!.id);
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

    expect(await readdir(downloadsFolder())).toEqual(['Changed.mp4']);
  });

  // What a download keeps beside its name while it runs: its part file, a stream's pieces, a pair's
  // picture and sound.
  it.each(['.scia', '.scia.pieces', '.scia.picture', '.scia.sound'])(
    'never names a download after a file that stands where its %s will',
    async (suffix) => {
      // A host once named a file after what a download keeps beside its name while it runs.
      await mkdir(downloadsFolder(), { recursive: true });
      const theirs = Buffer.from('a finished file of someone else');
      await writeFile(join(downloadsFolder(), `clip.mp4${suffix}`), theirs);
      const { site, picture, sound } = await pairOf('picture.mp4', 'sound.m4a');
      const downloads = await open({
        pageReader: reader(() => ({
          title: 'clip',
          formats: [pictureAt(picture.url), soundAt(sound.url)],
        })),
      });

      const [added] = downloads.add({ urls: [site.url] });
      await until(() => statusOf(downloads, added!.id) === DownloadStatus.Completed);

      expect(downloads.find(added!.id).fileName).toBe('clip (1).mp4');
      expect(await readFile(join(downloadsFolder(), `clip.mp4${suffix}`))).toEqual(theirs);
    },
  );

  it("never gives a file the name of a pair's picture while the pair is fetched", async () => {
    const site = await host({ body: page, contentType: 'text/html' });
    const picture = await host({
      body: Buffer.concat([
        await fixture('picture.mp4'),
        Buffer.from(boxOf('free', new Uint8Array(2 * 1024 * 1024))),
      ]),
      chunkBytes: 16 * 1024,
      chunkDelayMs: 5,
    });
    const sound = await host({ body: await fixture('sound.m4a') });
    const named = await host({ body: Buffer.from('a file'), fileName: 'clip.mp4.scia.picture' });
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'clip',
        formats: [pictureAt(picture.url), soundAt(sound.url)],
      })),
    });
    const [pair] = downloads.add({ urls: [site.url] });
    await until(() => downloads.find(pair!.id).downloadedBytes > 0);

    const [file] = downloads.add({ urls: [named.url] });
    await until(() => statusOf(downloads, file!.id) === DownloadStatus.Completed);
    await until(() => statusOf(downloads, pair!.id) === DownloadStatus.Completed, 30_000);

    expect(downloads.find(file!.id).fileName).not.toBe('clip.mp4.scia.picture');
    expect(handlersOf(await readFile(join(downloadsFolder(), 'clip.mp4')))).toEqual([
      'vide',
      'soun',
    ]);
  }, 60_000);

  it("never says the sound's address in an answer or in the log", async () => {
    const { site, picture, sound } = await pairOf('picture.mp4', 'sound.m4a', { status: 403 });
    const secret = `${sound.url}?token=sound-secret-0000`;
    const lines: string[] = [];
    const record = (event: string, details?: object) => {
      lines.push(JSON.stringify({ event, ...details }));
    };
    const downloads = await open({
      pageReader: reader(() => ({
        title: 'Secret',
        formats: [pictureAt(picture.url), soundAt(secret)],
      })),
      logger: { info: record, warn: record, error: record },
    });

    const [added] = downloads.add({ urls: [site.url] });
    await until(() => statusOf(downloads, added!.id) === DownloadStatus.Failed);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('sound-secret-0000');
    expect(JSON.stringify(downloads.snapshot())).not.toContain('sound-secret-0000');
  });
});
