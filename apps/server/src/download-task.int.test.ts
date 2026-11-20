import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
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

  it('empties the file before it asks a host without ranges, not between the answer and the reading of it', async () => {
    const { url } = await host({ ranges: false });
    await writeFile(partPath, 'what an earlier attempt left here');
    let sizeWhenAsked: number | undefined;
    const download = task(url, {
      resumable: false,
      segments: [],
      source: {
        probe: (...asked) => source.probe(...asked),
        open: async (...asked) => {
          sizeWhenAsked = (await stat(partPath)).size;
          return source.open(...asked);
        },
      },
    });

    await download.run(new AbortController().signal);

    expect(sizeWhenAsked).toBe(0);
    expect(Buffer.compare(await readFile(partPath), body)).toBe(0);
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

  describe('under a speed limit', () => {
    const small = randomBytes(200_000);
    // What the connections of a download do with the limit, in the order they do it.
    function ledger() {
      const events: string[] = [];
      let opened = 0;
      const allowance: TaskOptions['allowance'] = () => {
        const name = String.fromCharCode('a'.charCodeAt(0) + opened);
        opened += 1;
        return {
          next: () => {
            events.push(`${name} asks`);
            return {
              ms: 0,
              over: () => {
                events.push(`${name} waits`);
                return Promise.resolve();
              },
            };
          },
          took: (bytes) => {
            events.push(`${name} took ${String(bytes)}`);
          },
          settle: () => {
            events.push(`${name} settles`);
          },
        };
      };
      return { events, allowance };
    }
    const taken = (events: readonly string[]) =>
      events
        .map((event) => /took (\d+)$/.exec(event)?.[1])
        .reduce((total, bytes) => total + Number(bytes ?? 0), 0);
    // "a asks", "a waits" before every read; "a took <n>" after it.
    const withoutCounts = (events: readonly string[]) =>
      events.map((event) => event.replace(/ \d+$/, ''));

    it('asks before the host is asked and before every read, never after the last, and settles', async () => {
      const { url, ranges } = await host({ body: small });
      const { events, allowance } = ledger();
      const asksAt: number[] = [];
      const download = task(url, {
        totalBytes: small.length,
        connections: 1,
        segments: [{ start: 0, end: small.length, downloaded: 0 }],
        allowance: () => {
          const own = allowance(null);
          return {
            ...own,
            next: () => {
              // How many requests the host had seen when the limit was asked.
              asksAt.push(ranges.length);
              return own.next();
            },
          };
        },
      });

      await download.run(new AbortController().signal);

      expect(Buffer.compare(await readFile(partPath), small)).toBe(0);
      expect(taken(events)).toBe(small.length);
      expect(asksAt[0]).toBe(0);
      const reads = events.filter((event) => event.includes('took')).length;
      expect(withoutCounts(events)).toEqual([
        ...Array.from({ length: reads }, () => ['a asks', 'a waits', 'a took']).flat(),
        'a settles',
      ]);
    });

    it('tells the limit how much each connection can bring, when its host says', async () => {
      const told: (number | null)[] = [];
      const quiet = (expectedBytes: number | null) => {
        told.push(expectedBytes);
        return {
          next: () => ({ ms: 0, over: () => Promise.resolve() }),
          took: () => undefined,
          settle: () => undefined,
        };
      };
      const signal = new AbortController().signal;

      const ranged = await host({ body: small });
      await task(ranged.url, {
        totalBytes: small.length,
        connections: 1,
        segments: [{ start: 50_000, end: small.length, downloaded: 0 }],
        allowance: quiet,
      }).run(signal);
      await server?.close();
      const whole = await host({ body: small, ranges: false });
      await task(whole.url, {
        totalBytes: small.length,
        resumable: false,
        segments: [],
        allowance: quiet,
      }).run(signal);
      await server?.close();
      const sizeless = await host({ body: small, ranges: false, announcesLength: false });
      await task(sizeless.url, {
        totalBytes: null,
        resumable: false,
        segments: [],
        allowance: quiet,
      }).run(signal);

      // What is left of the range, the whole file, and nothing when the host does not say.
      expect(told).toEqual([small.length - 50_000, small.length, null]);
    });

    it('does the same on a host without ranges', async () => {
      const { url } = await host({ body: small, ranges: false });
      const { events, allowance } = ledger();
      const download = task(url, {
        totalBytes: small.length,
        resumable: false,
        segments: [],
        allowance,
      });

      await download.run(new AbortController().signal);

      expect(Buffer.compare(await readFile(partPath), small)).toBe(0);
      expect(taken(events)).toBe(small.length);
      const reads = events.filter((event) => event.includes('took')).length;
      expect(withoutCounts(events)).toEqual([
        ...Array.from({ length: reads }, () => ['a asks', 'a waits', 'a took']).flat(),
        'a settles',
      ]);
    });

    it('settles what a connection booked when it is stopped while it waits, before or after its host answered', async () => {
      const { url, ranges } = await host();
      for (const heldAt of [1, 2]) {
        const stopped = new AbortController();
        const events: string[] = [];
        let asked = 0;
        const download = task(url, {
          connections: 1,
          segments: [{ start: 0, end: body.length, downloaded: 0 }],
          allowance: () => ({
            next: () => {
              asked += 1;
              const held = asked === heldAt;
              return {
                ms: held ? 60_000 : 0,
                over: (signal) =>
                  held
                    ? new Promise((_, reject) => {
                        events.push('waits');
                        signal.addEventListener('abort', () => {
                          reject(signal.reason as Error);
                        });
                      })
                    : Promise.resolve(),
              };
            },
            took: () => undefined,
            settle: () => {
              events.push('settles');
            },
          }),
        });

        const running = download.run(stopped.signal).catch((error: unknown) => error);
        await until(() => events.includes('waits'), 2000);
        const requests = ranges.length;
        stopped.abort(new Error('paused'));

        expect(await running, `held at ask ${String(heldAt)}`).toEqual(new Error('paused'));
        expect(events).toEqual(['waits', 'settles']);
        // Held before its first read, the connection had asked its host for nothing yet.
        if (heldAt === 1) expect(requests).toBe(0);
      }
    });

    it('writes and counts what arrived before a long wait, not after it', async () => {
      const { url } = await host();
      const stopped = new AbortController();
      let asked = 0;
      const download = task(url, {
        connections: 1,
        segments: [{ start: 0, end: body.length, downloaded: 0 }],
        // Nothing holds the first read; before the second the limit asks for a minute.
        allowance: () => ({
          next: () => {
            asked += 1;
            const held = asked > 1;
            return {
              ms: held ? 60_000 : 0,
              over: (signal) =>
                held
                  ? new Promise((_, reject) => {
                      signal.addEventListener('abort', () => {
                        reject(signal.reason as Error);
                      });
                    })
                  : Promise.resolve(),
            };
          },
          took: () => undefined,
          settle: () => undefined,
        }),
      });

      const running = download.run(stopped.signal).catch((error: unknown) => error);
      await until(() => download.progress().downloadedBytes > 0, 2000);
      const held = download.progress().downloadedBytes;
      stopped.abort(new Error('paused'));

      expect(await running).toEqual(new Error('paused'));
      expect((await readFile(partPath)).subarray(0, held).equals(body.subarray(0, held))).toBe(
        true,
      );
    });
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
