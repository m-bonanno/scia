import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { until } from '@scia/server/testing/scratch.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followDownloads } from './engine-events.ts';

function aDownload(id: string, status: string) {
  return {
    id,
    url: 'https://example.com/file.bin',
    fileName: `${id}.bin`,
    title: null,
    directory: 'downloads',
    kind: 'other',
    status,
    totalBytes: 10,
    downloadedBytes: 5,
    bytesPerSecond: 0,
    etaSeconds: null,
    resumable: true,
    segments: [],
    failure: null,
    failureStatus: null,
    via: null,
    media: null,
    timeline: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    completedAt: null,
  };
}

const snapshot = (...downloads: unknown[]) =>
  `event: snapshot\ndata: ${JSON.stringify({ downloads, magnets: [], bundles: [], watchClipboard: false, connectedServices: [], codeConnectFailed: null })}\n\n`;

// What the follower logged, with the reason it gave.
function aLog() {
  const lost: string[] = [];
  const back: string[] = [];
  return {
    lost,
    back,
    log: {
      warn: (message: string, details: object) => {
        lost.push(`${message} ${JSON.stringify(details)}`);
      },
      info: (message: string) => {
        back.push(message);
      },
    },
  };
}

describe('followDownloads against a real host, with the real fetch', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  it('gives up a host that begins its answer and says nothing more, and says why', async () => {
    let requests = 0;
    const host = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      // The first answer is headers and nothing else; the one after it has a list.
      if (requests > 1) response.write(Buffer.from(snapshot(aDownload('a', 'queued'))));
    });
    server = host;
    await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
    const { port } = host.address() as AddressInfo;
    const stopped = new AbortController();
    const names: string[] = [];
    const { lost, back, log } = aLog();

    const done = followDownloads({
      engine: () => ({ origin: `http://127.0.0.1:${String(port)}`, apiToken: 'token', fetch }),
      onSnapshot: ({ downloads }) => {
        names.push(...downloads.map((download) => download.fileName));
      },
      signal: stopped.signal,
      answerLimitMs: 2000,
      silenceLimitMs: 250,
      retryMs: 20,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
    });
    await vi.waitFor(() => {
      expect(names).toEqual(['a.bin']);
    });

    expect(requests).toBe(2);
    expect(lost).toEqual(['engine_events_lost {"reason":"Error: The engine went silent."}']);
    expect(back).toEqual(['engine_events_back']);
    stopped.abort();
    await done;
  });

  it('keeps the stream it was answered on, past the time an answer has to begin, and reads a name cut in two', async () => {
    const requests: string[] = [];
    const first = Buffer.from(snapshot(aDownload('a', 'downloading')));
    // "è" is two bytes: the second list is sent in two pieces, cut between them.
    const second = Buffer.from(snapshot({ ...aDownload('a', 'completed'), fileName: 'Caffè.mkv' }));
    const cut = second.indexOf(Buffer.from('è')) + 1;
    const host = createServer((request, response) => {
      requests.push(
        `${request.method ?? ''} ${request.url ?? ''} ${request.headers.authorization ?? ''}`,
      );
      // The answer begins — its headers — and then says nothing for well past the 50 ms it had
      // to begin within: from here on only the bound on silence applies. The follower's 50 ms
      // began before this request arrived, in this same process, so it falls first, whatever the
      // load: a stream still under it would be given up before a byte of a list.
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      setTimeout(() => {
        response.write(first);
        setTimeout(() => {
          response.write(second.subarray(0, cut));
          setTimeout(() => {
            response.write(second.subarray(cut));
          }, 30);
        }, 150);
      }, 200);
    });
    server = host;
    await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
    const { port } = host.address() as AddressInfo;
    const stopped = new AbortController();
    const names: string[] = [];
    const warnings: string[] = [];

    const done = followDownloads({
      engine: () => ({ origin: `http://127.0.0.1:${String(port)}`, apiToken: 'token', fetch }),
      onSnapshot: ({ downloads }) => {
        names.push(...downloads.map((download) => `${download.fileName}:${download.status}`));
      },
      signal: stopped.signal,
      answerLimitMs: 50,
      silenceLimitMs: 2000,
      retryMs: 20,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: { warn: (message) => warnings.push(message), info: () => undefined },
    });
    await until(() => names.length >= 2);

    // Both lists, once each: they came on one stream, kept past its 50 ms. How many streams were
    // opened is not counted: a loaded machine can take more than 50 ms to read the headers of the
    // first, which is then rightly given up and asked again — every one answered alike (#238).
    expect(names).toEqual(['a.bin:downloading', 'Caffè.mkv:completed']);
    expect(new Set(requests)).toEqual(new Set(['GET /api/v1/events Bearer token']));
    expect(warnings.filter((warning) => warning !== 'engine_events_lost')).toEqual([]);
    stopped.abort();
    await done;
  });
});
