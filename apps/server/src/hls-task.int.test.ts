import { createCipheriv } from 'node:crypto';
import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timelineSchema } from '@scia/contracts';
import { PageFailure } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HlsTask, type HlsTaskOptions } from './hls-task.ts';
import { HttpSource } from './http-source.ts';
import { PageError } from './media-choice.ts';
import { RemoteError } from './remote-source.ts';
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
    // What the row is sent passes the contract the page and main read it with.
    expect(() => timelineSchema.parse(stream.progress().timeline)).not.toThrow();
  });

  it('goes on after a pause with the pieces it has, asking for none of them again [flaky #162]', async () => {
    const host = await serve({ delayMs: 150 });
    const first = task(`${host.url}/ts/index.m3u8`, { connections: 1 });
    const pause = new AbortController();
    const running = first.run(pause.signal);
    await until(
      () => first.progress().timeline?.segments.some((piece) => piece.downloaded > 0) === true,
    );
    pause.abort(new Error('paused'));
    await expect(running).rejects.toThrow('paused');
    const kept = (first.progress().timeline?.segments ?? []).flatMap((piece, index) =>
      piece.downloaded > 0 ? [index] : [],
    );

    const second = task(`${host.url}/ts/index.m3u8`);
    await second.run(new AbortController().signal);

    // Counted per piece, not after a moment: a request the first task sent before the pause can
    // reach the host after it (#127).
    const timesAsked = (index: number) =>
      host.asked.filter((path) => path.endsWith(`/segment${String(index)}.mpegts`)).length;
    expect(kept.length).toBeGreaterThan(0);
    for (const index of [0, 1, 2]) {
      if (kept.includes(index)) expect(timesAsked(index), `segment${String(index)}`).toBe(1);
      else expect(timesAsked(index), `segment${String(index)}`).toBeGreaterThanOrEqual(1);
    }
    expectAnMp4Of(await output(), 3);
  });

  it('says its pieces only once it has read what it kept: never every piece at nothing on a resume', async () => {
    const host = await serve({ delayMs: 100 });
    const first = task(`${host.url}/ts/index.m3u8`, { connections: 1 });
    const pause = new AbortController();
    const running = first.run(pause.signal);
    await until(
      () => first.progress().timeline?.segments.some((piece) => piece.downloaded > 0) === true,
    );
    pause.abort(new Error('paused'));
    await expect(running).rejects.toThrow('paused');

    const second = task(`${host.url}/ts/index.m3u8`);
    const resumed = second.run(new AbortController().signal);
    let firstSeen: ReturnType<HlsTask['progress']>['timeline'] = null;
    while (firstSeen === null) {
      await new Promise((resolve) => setImmediate(resolve));
      firstSeen = second.progress().timeline;
    }
    await resumed;

    expect(firstSeen.segments.some((piece) => piece.downloaded > 0)).toBe(true);
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
        next: () => ({ ms: 0, over: async () => undefined }),
        took: (count: number) => {
          took += count;
        },
        settle: () => {
          settled += 1;
        },
      }),
    });

    await stream.run(new AbortController().signal);

    expect(took).toBe(
      6580 + 6204 + 6204 + (await readFile(join(FIXTURES, 'ts', 'index.m3u8'))).length,
    );
    expect(settled).toBe(4);
  });

  it('fetches pieces and an init segment that are ranges of one file, with and without an offset', async () => {
    const parts = await Promise.all(
      ['init.mp4', 'segment0.m4s', 'segment1.m4s', 'segment2.m4s'].map((name) =>
        readFile(join(FIXTURES, 'fmp4', name)),
      ),
    );
    const [init, a, b, c] = parts as [Buffer, Buffer, Buffer, Buffer];
    const site = join(folder.path, 'site');
    await cp(join(FIXTURES, 'fmp4'), site, { recursive: true });
    await writeFile(join(site, 'all.mp4'), Buffer.concat(parts));
    await writeFile(
      join(site, 'ranges.m3u8'),
      [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:1',
        `#EXT-X-MAP:URI="all.mp4",BYTERANGE="${String(init.length)}@0"`,
        '#EXTINF:1,',
        `#EXT-X-BYTERANGE:${String(a.length)}@${String(init.length)}`,
        'all.mp4',
        '#EXTINF:1,',
        `#EXT-X-BYTERANGE:${String(b.length)}`,
        'all.mp4',
        '#EXTINF:1,',
        `#EXT-X-BYTERANGE:${String(c.length)}`,
        'all.mp4',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    );
    server = await startFolderServer({ root: site });

    await task(`${server.url}/ranges.m3u8`).run(new AbortController().signal);

    expect(Buffer.compare(await output(), Buffer.concat(parts))).toBe(0);
  });

  it('opens encrypted fragmented pieces behind an init segment named before the key, which is clear', async () => {
    const site = join(folder.path, 'site');
    await cp(join(FIXTURES, 'fmp4'), site, { recursive: true });
    const key = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const iv = Buffer.alloc(16, 7);
    for (const name of ['segment0.m4s', 'segment1.m4s', 'segment2.m4s']) {
      const clear = await readFile(join(site, name));
      const cipher = createCipheriv('aes-128-cbc', key, iv);
      await writeFile(join(site, name), Buffer.concat([cipher.update(clear), cipher.final()]));
    }
    await writeFile(join(site, 'key.bin'), key);
    const playlist = await readFile(join(site, 'index.m3u8'), 'utf8');
    await writeFile(
      join(site, 'locked.m3u8'),
      playlist.replace(
        /(#EXT-X-MAP:[^\n]*\n)/,
        `$1#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x${iv.toString('hex')}\n`,
      ),
    );
    server = await startFolderServer({ root: site });

    await task(`${server.url}/locked.m3u8`).run(new AbortController().signal);

    const plain = await Promise.all(
      ['init.mp4', 'segment0.m4s', 'segment1.m4s', 'segment2.m4s'].map((name) =>
        readFile(join(FIXTURES, 'fmp4', name)),
      ),
    );
    expect(Buffer.compare(await output(), Buffer.concat(plain))).toBe(0);
  });

  it('says the failure of the piece that failed, not the end of a wait to ask again', async () => {
    const site = join(folder.path, 'site');
    await cp(join(FIXTURES, 'ts'), site, { recursive: true });
    await writeFile(
      join(site, 'index.m3u8'),
      '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment0.mpegts\n#EXTINF:1,\ngone.mpegts\n#EXT-X-ENDLIST\n',
    );
    // The first piece answers 503, and its connection waits to ask again, while the second's is
    // refused for good.
    server = await startFolderServer({ root: site, failOnce: ['/segment0.mpegts'], delayMs: 50 });

    const failure = await task(`${server.url}/index.m3u8`, { retryDelayMs: () => 10_000 })
      .run(new AbortController().signal)
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(RemoteError);
    expect((failure as RemoteError).status).toBe(404);
  });

  it('stops every connection when a piece fails for good, and fetches nothing after [flaky #162]', async () => {
    const copy = join(folder.path, 'site');
    await cp(join(FIXTURES, 'ts'), copy, { recursive: true });
    const names = [
      'segment0',
      'gone',
      'segment1',
      'segment2',
      'segment0',
      'segment1',
      'segment2',
      'segment0',
    ];
    await writeFile(
      join(copy, 'index.m3u8'),
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n${names.map((name) => `#EXTINF:1,\n${name}.mpegts`).join('\n')}\n#EXT-X-ENDLIST\n`,
    );
    server = await startFolderServer({ root: copy, delayMs: 100 });

    await expect(
      task(`${server.url}/index.m3u8`).run(new AbortController().signal),
    ).rejects.toThrow();
    const askedThen = server.asked.length;
    // The other connection stopped at the piece it had: not every piece was asked for.
    expect(server.asked.filter((path) => path.endsWith('.mpegts')).length).toBeLessThan(
      names.length,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(server.asked.length).toBe(askedThen);
  });

  it('stops waiting to ask again when it is told to stop', async () => {
    const host = await serve({ failOnce: ['/ts/segment0.mpegts'] });
    const stopped = new AbortController();
    const running = task(`${host.url}/ts/index.m3u8`, { retryDelayMs: () => 10_000 }).run(
      stopped.signal,
    );
    await until(() => host.asked.includes('/ts/segment0.mpegts'));

    const startedAt = Date.now();
    stopped.abort(new Error('paused'));
    await expect(running).rejects.toThrow('paused');
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it('refuses, before fetching a piece, a stream that changes partway: Scia cannot make one mp4 of it yet', async () => {
    const copy = join(folder.path, 'site');
    await cp(FIXTURES, copy, { recursive: true });
    const ts = await readFile(join(copy, 'ts', 'index.m3u8'), 'utf8');
    await writeFile(
      join(copy, 'ts', 'jump.m3u8'),
      ts.replace(
        '#EXTINF:1.000000,\nsegment1',
        '#EXT-X-DISCONTINUITY\n#EXTINF:1.000000,\nsegment1',
      ),
    );
    const fmp4 = await readFile(join(copy, 'fmp4', 'index.m3u8'), 'utf8');
    await writeFile(
      join(copy, 'fmp4', 'two-inits.m3u8'),
      fmp4.replace(
        '#EXTINF:1.000000,\nsegment2',
        '#EXT-X-MAP:URI="other-init.mp4"\n#EXTINF:1.000000,\nsegment2',
      ),
    );
    // An init segment under a key: encrypted, it would be no mp4's as fetched (#123).
    await writeFile(
      join(copy, 'fmp4', 'locked-init.m3u8'),
      fmp4.replace('#EXT-X-MAP', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP'),
    );
    server = await startFolderServer({ root: copy });
    const failureOf = (path: string) =>
      task(`${server!.url}/${path}`)
        .run(new AbortController().signal)
        .then(
          () => undefined,
          (error: unknown) => (error instanceof PageError ? error.failure : error),
        );

    expect(await failureOf('ts/jump.m3u8')).toBe(PageFailure.FormatUnsupported);
    expect(await failureOf('fmp4/two-inits.m3u8')).toBe(PageFailure.FormatUnsupported);
    expect(await failureOf('fmp4/locked-init.m3u8')).toBe(PageFailure.FormatUnsupported);
    expect(server.asked.filter((path) => !path.endsWith('.m3u8'))).toEqual([]);
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
