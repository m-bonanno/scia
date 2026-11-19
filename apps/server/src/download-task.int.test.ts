import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadFailure, isComplete, planSegments, type Segment } from '@scia/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadTask, type TaskOptions } from './download-task.ts';
import { HttpSource } from './http-source.ts';
import { RemoteError } from './remote-source.ts';
import {
  type RangeServer,
  type RangeServerOptions,
  startRangeServer,
} from './testing/range-server.ts';
import { scratchFolder, until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
const body = randomBytes(6 * MIB + 123);

describe('DownloadTask against a real HTTP host', () => {
  const source = new HttpSource('scia-test');
  let folder: Awaited<ReturnType<typeof scratchFolder>>;
  let server: RangeServer | undefined;
  let partPath: string;

  beforeEach(async () => {
    folder = await scratchFolder();
    partPath = join(folder.path, 'sample.bin.scia');
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
    await folder.remove();
  });

  async function host(options: Partial<RangeServerOptions> = {}): Promise<RangeServer> {
    server = await startRangeServer({ body, ...options });
    return server;
  }

  function task(url: string, overrides: Partial<TaskOptions> = {}): DownloadTask {
    return new DownloadTask({
      source,
      url,
      headers: {},
      partPath,
      totalBytes: body.length,
      resumable: true,
      connections: 4,
      segments: planSegments(body.length, 4, MIB),
      onBytes: () => undefined,
      retryDelayMs: () => 1,
      ...overrides,
    });
  }

  it('fetches the file over several connections, byte for byte', async () => {
    const { url, ranges } = await host();
    let counted = 0;
    const download = task(url, { onBytes: (count) => (counted += count) });

    await download.run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
    expect(new Set(ranges).size).toBeGreaterThanOrEqual(4);
    expect(download.progress().downloadedBytes).toBe(body.length);
    expect(counted).toBe(body.length);
  });

  it('keeps every connection busy by splitting the range with the most left', async () => {
    const { url, ranges } = await host({ chunkDelayMs: 2 });
    // One range for eight connections: seven of them have to take a share of it.
    const download = task(url, {
      connections: 8,
      segments: [{ start: 0, end: body.length, downloaded: 0 }],
    });

    await download.run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
    expect(ranges.length).toBeGreaterThan(1);
  });

  it('goes on after a pause from the bytes it already has', async () => {
    const { url } = await host({ chunkDelayMs: 5 });
    const first = task(url);
    const pause = new AbortController();
    const running = first.run(pause.signal);
    await until(() => first.progress().downloadedBytes > MIB);
    pause.abort();
    await expect(running).rejects.toThrow();

    const kept: Segment[] = first.progress().segments;
    const keptBytes = first.progress().downloadedBytes;
    expect(keptBytes).toBeGreaterThan(0);
    expect(isComplete(kept)).toBe(false);

    let fetchedAfter = 0;
    const second = task(url, { segments: kept, onBytes: (count) => (fetchedAfter += count) });
    await second.run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
    expect(fetchedAfter).toBe(body.length - keptBytes);
  });

  it('retries a connection the host cut, without losing what had arrived', async () => {
    const { url } = await host({ drops: 3, dropAfterBytes: 200 * 1024 });

    await task(url).run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
  });

  it('gives up on a host that keeps cutting, and says the network failed', async () => {
    const { url } = await host({ drops: 1000, dropAfterBytes: 0 });

    const failure = await task(url)
      .run(new AbortController().signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RemoteError);
  });

  it('takes the whole file in one connection from a host without ranges', async () => {
    const { url, ranges } = await host({ ranges: false });
    const download = task(url, { resumable: false, segments: [] });

    await download.run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
    expect(ranges).toEqual([undefined]);
  });

  it('takes a file whose size the host never says', async () => {
    const { url } = await host({ ranges: false, announcesLength: false });
    const download = task(url, { resumable: false, totalBytes: null, segments: [] });

    await download.run(new AbortController().signal);

    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
    expect(download.progress()).toEqual({ segments: [], downloadedBytes: body.length });
  });

  it('does not retry a refusal', async () => {
    const { url, ranges } = await host({ status: 404 });

    const failure = await task(url)
      .run(new AbortController().signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RemoteError);
    expect((failure as RemoteError).failure).toBe(DownloadFailure.HttpStatus);
    expect((failure as RemoteError).status).toBe(404);
    // One request per connection, none repeated.
    expect(ranges.length).toBeLessThanOrEqual(4);
  });
});

describe('HttpSource.probe', () => {
  const source = new HttpSource('scia-test');
  let server: RangeServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('learns the size, the name and that ranges are served from the first byte', async () => {
    server = await startRangeServer({ body, fileName: 'Relazione finale.pdf' });

    expect(await source.probe(server.url, {}, new AbortController().signal)).toEqual({
      totalBytes: body.length,
      acceptsRanges: true,
      fileName: 'Relazione finale.pdf',
      validator: '"v1"',
    });
  });

  it('sees a host that ignores ranges', async () => {
    server = await startRangeServer({ body, ranges: false });

    const remote = await source.probe(server.url, {}, new AbortController().signal);

    expect(remote.acceptsRanges).toBe(false);
    expect(remote.totalBytes).toBe(body.length);
    expect(remote.fileName).toBeUndefined();
  });

  it('reports a refusal with its status', async () => {
    server = await startRangeServer({ body, status: 403 });

    const failure = await source
      .probe(server.url, {}, new AbortController().signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RemoteError);
    expect((failure as RemoteError).status).toBe(403);
    expect((failure as RemoteError).retryable).toBe(false);
  });
});
