import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HlsTask, type HlsTaskOptions } from './hls-task.ts';
import { HttpSource } from './http-source.ts';
import { PageError } from './media-choice.ts';
import { type FolderServer, startFolderServer } from './testing/folder-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';

const FIXTURES = join(import.meta.dirname, 'testing', 'hls');

// The top-level boxes of an mp4, by type, in order.
function boxesOf(bytes: Buffer): string[] {
  const types: string[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(at);
    types.push(bytes.subarray(at + 4, at + 8).toString('latin1'));
    if (size < 8) break;
    at += size;
  }
  return types;
}

// A fragmented mp4 of pieces pieces: its header, then a fragment of picture and one of sound for
// each piece, each a moof and its mdat.
function expectAnMp4Of(bytes: Buffer, pieces: number): void {
  const boxes = boxesOf(bytes);
  expect(boxes.slice(0, 2)).toEqual(['ftyp', 'moov']);
  expect(boxes.slice(2)).toEqual(Array.from({ length: pieces * 2 }, () => ['moof', 'mdat']).flat());
}

describe('HlsTask against a real HTTP host', () => {
  const source = new HttpSource('scia-test');
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let server: FolderServer | undefined;

  beforeEach(async () => {
    folder = await scratchFolder();
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
    await folder.remove();
  });

  async function serve(options: { failOnce?: string[]; delayMs?: number } = {}) {
    server = await startFolderServer({ root: FIXTURES, ...options });
    return server;
  }
  function task(playlistUrl: string, overrides: Partial<HlsTaskOptions> = {}): HlsTask {
    return new HlsTask({
      source,
      playlistUrl,
      headers: {},
      partPath: join(folder.path, 'video.mp4.scia'),
      connections: 2,
      onBytes: () => undefined,
      retryDelayMs: () => 1,
      ...overrides,
    });
  }
  const output = () => readFile(join(folder.path, 'video.mp4.scia'));

  it('makes one mp4 of a stream of MPEG-TS pieces, and keeps no piece behind', async () => {
    const host = await serve();
    let counted = 0;
    const stream = task(`${host.url}/ts/index.m3u8`, { onBytes: (count) => (counted += count) });

    await stream.run(new AbortController().signal);

    const mp4 = await output();
    expectAnMp4Of(mp4, 3);
    expect(counted).toBe(6580 + 6204 + 6204);
    expect(await readdir(folder.path)).toEqual(['video.mp4.scia']);
  });

  it('puts fragmented mp4 pieces behind their init segment as they are', async () => {
    const host = await serve();

    await task(`${host.url}/fmp4/index.m3u8`).run(new AbortController().signal);

    const parts = await Promise.all(
      ['init.mp4', 'segment0.m4s', 'segment1.m4s', 'segment2.m4s'].map((name) =>
        readFile(join(FIXTURES, 'fmp4', name)),
      ),
    );
    expect(Buffer.compare(await output(), Buffer.concat(parts))).toBe(0);
  });

  it('opens pieces encrypted with AES-128 with the key the playlist names', async () => {
    const host = await serve();

    await task(`${host.url}/aes/index.m3u8`).run(new AbortController().signal);

    expectAnMp4Of(await output(), 3);
    expect(host.asked.filter((path) => path === '/aes/key.bin')).toHaveLength(1);
  });

  it('says how far it is by the pieces and how long each lasts', async () => {
    const host = await serve();
    const stream = task(`${host.url}/ts/index.m3u8`);

    await stream.run(new AbortController().signal);

    expect(stream.progress().timeline).toEqual({
      totalMs: 3000,
      segments: [
        { start: 0, end: 1000, downloaded: 1000 },
        { start: 1000, end: 2000, downloaded: 1000 },
        { start: 2000, end: 3000, downloaded: 1000 },
      ],
    });
    expect(stream.progress().downloadedBytes).toBe(6580 + 6204 + 6204);
  });

  it('goes on after a pause with the pieces it has, asking for none of them again', async () => {
    const host = await serve({ delayMs: 150 });
    const first = task(`${host.url}/ts/index.m3u8`, { connections: 1 });
    const pause = new AbortController();
    const running = first.run(pause.signal);
    await until(
      () => first.progress().timeline?.segments.some((piece) => piece.downloaded > 0) === true,
    );
    pause.abort(new Error('paused'));
    await expect(running).rejects.toThrow('paused');
    const kept = first.progress().downloadedBytes;
    const askedBefore = host.asked.filter((path) => path.endsWith('.mpegts')).length;

    const second = task(`${host.url}/ts/index.m3u8`);
    await second.run(new AbortController().signal);

    const piecesAsked = host.asked.filter((path) => path.endsWith('.mpegts'));
    expect(kept).toBeGreaterThan(0);
    expect(piecesAsked.length - askedBefore).toBe(3 - kept / 6580);
    expectAnMp4Of(await output(), 3);
  });

  it('asks a host that failed a piece again', async () => {
    const host = await serve({ failOnce: ['/ts/segment1.mpegts'] });

    await task(`${host.url}/ts/index.m3u8`).run(new AbortController().signal);

    expect(host.asked.filter((path) => path === '/ts/segment1.mpegts')).toHaveLength(2);
    expectAnMp4Of(await output(), 3);
  });

  it('reads every piece against the speed limit, and gives back what it booked', async () => {
    const host = await serve();
    let took = 0;
    let settled = 0;
    const stream = task(`${host.url}/ts/index.m3u8`, {
      allowance: () => ({
        next: () => ({ over: async () => undefined }),
        took: (count: number) => (took += count),
        settle: () => (settled += 1),
      }),
    });

    await stream.run(new AbortController().signal);

    expect(took).toBe(
      6580 + 6204 + 6204 + (await readFile(join(FIXTURES, 'ts', 'index.m3u8'))).length,
    );
    expect(settled).toBe(4);
  });

  it('says a stream that does not end is live, and a protected or unreadable one why not', async () => {
    const copy = join(folder.path, 'site');
    await cp(join(FIXTURES, 'ts'), copy, { recursive: true });
    const playlist = await readFile(join(copy, 'index.m3u8'), 'utf8');
    await writeFile(join(copy, 'live.m3u8'), playlist.replace('#EXT-X-ENDLIST', ''));
    await writeFile(
      join(copy, 'drm.m3u8'),
      playlist.replace('#EXTINF', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k"\n#EXTINF'),
    );
    await writeFile(join(copy, 'page.m3u8'), '<!doctype html><title>no</title>');
    server = await startFolderServer({ root: copy });
    const failureOf = (path: string) =>
      task(`${server!.url}/${path}`)
        .run(new AbortController().signal)
        .then(
          () => undefined,
          (error: unknown) => (error instanceof PageError ? error.failure : error),
        );

    expect(await failureOf('live.m3u8')).toBe(PageFailure.Live);
    expect(await failureOf('drm.m3u8')).toBe(PageFailure.Drm);
    expect(await failureOf('page.m3u8')).toBe(PageFailure.Unreadable);
  });
});
