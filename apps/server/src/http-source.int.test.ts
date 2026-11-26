import { randomBytes } from 'node:crypto';
import { type AddressInfo, createServer, type Server } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { DownloadFailure } from '@scia/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { HttpSource } from './http-source.ts';
import { RemoteError } from './remote-source.ts';
import { type RangeServer, startRangeServer } from './testing/range-server.ts';
import { until } from './testing/scratch.ts';

const MIB = 1024 * 1024;
const IDLE_MS = 150;

describe('HttpSource.open and a host that has no content for a range', () => {
  const source = new HttpSource('scia-test');
  afterAll(() => {
    source.close();
  });

  it('answers a 204 to a range with a refusal worth another attempt', async () => {
    const server = await startRangeServer({ body: randomBytes(MIB), noContent: 1 });

    const failure = await source
      .open(server.url, {}, { start: 1024, end: 2048 }, new AbortController().signal)
      .catch((error: unknown) => error);
    await server.close();

    expect(failure).toBeInstanceOf(RemoteError);
    expect(failure).toMatchObject({
      status: 204,
      retryable: true,
      failure: DownloadFailure.HttpStatus,
    });
  });
});

describe('HttpSource.open and a host that goes silent', () => {
  const source = new HttpSource('scia-test', { idleTimeoutMs: IDLE_MS });
  const signal = new AbortController().signal;
  let server: RangeServer | undefined;
  let mute: Server | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    mute?.close();
    mute = undefined;
  });
  afterAll(() => {
    source.close();
  });

  it('does not take a reader that stays away between two reads for a silent host', async () => {
    const body = randomBytes(MIB);
    server = await startRangeServer({ body });

    const stream = await source.open(server.url, {}, { start: 0, end: body.length }, signal);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      // What a speed limit has a connection do, for longer than a host may stay silent. The
      // pause is the case itself, not a wait for something to happen.
      // eslint-disable-next-line scia/no-fixed-sleep -- the case itself: a connection silent
      if (chunks.length === 1) await sleep(IDLE_MS * 4);
    }

    expect(Buffer.compare(Buffer.concat(chunks), body)).toBe(0);
    expect(server.ranges).toHaveLength(1);
  });

  it('gives up on a host that stops sending in the middle of a file', async () => {
    server = await startRangeServer({
      body: randomBytes(64 * 1024),
      chunkBytes: 1024,
      chunkDelayMs: IDLE_MS * 20,
    });

    const stream = await source.open(server.url, {}, null, signal);
    const read = async () => {
      let bytes = 0;
      for await (const chunk of stream) bytes += chunk.byteLength;
      return bytes;
    };

    await expect(read()).rejects.toThrow('The host stopped answering.');
  });

  it('gives up on a host that takes the request and never answers it', async () => {
    const listening = createServer(() => undefined);
    mute = listening;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const { port } = listening.address() as AddressInfo;

    const failure = await source
      .open(`http://127.0.0.1:${String(port)}/file.bin`, {}, null, signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RemoteError);
    expect((failure as RemoteError).failure).toBe(DownloadFailure.Network);
    expect((failure as RemoteError).retryable).toBe(true);
  });

  it('closes the connection of a redirect whose body never comes, and follows it all the same', async () => {
    const body = randomBytes(64 * 1024);
    const target = await startRangeServer({ body });
    server = target;
    let redirectOpen = false;
    // Announces a body with its redirect and never sends it.
    const redirecting = createServer((socket) => {
      redirectOpen = true;
      socket.on('close', () => {
        redirectOpen = false;
      });
      socket.on('error', () => undefined);
      socket.once('data', () => {
        socket.write(`HTTP/1.1 302 Found\r\nLocation: ${target.url}\r\nContent-Length: 10\r\n\r\n`);
      });
    });
    mute = redirecting;
    await new Promise<void>((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
    const { port } = redirecting.address() as AddressInfo;

    const stream = await source.open(`http://127.0.0.1:${String(port)}/file.bin`, {}, null, signal);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(Buffer.compare(Buffer.concat(chunks), body)).toBe(0);
    await until(() => !redirectOpen, 2000);
  });
});
