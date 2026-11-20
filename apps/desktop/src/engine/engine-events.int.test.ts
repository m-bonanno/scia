import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followDownloads } from './engine-events.ts';

function aDownload(id: string, status: string) {
  return {
    id,
    url: 'https://example.com/file.bin',
    fileName: `${id}.bin`,
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
    createdAt: '2026-11-20T10:00:00.000Z',
    completedAt: null,
  };
}

const snapshot = (...downloads: unknown[]) =>
  `event: snapshot\ndata: ${JSON.stringify({ downloads })}\n\n`;

describe('followDownloads against a real host, with the real fetch', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
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
      // to begin within: from here on only the bound on silence applies.
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
      onDownloads: (downloads) => {
        names.push(...downloads.map((download) => `${download.fileName}:${download.status}`));
      },
      signal: stopped.signal,
      answerLimitMs: 50,
      silenceLimitMs: 2000,
      retryMs: 20,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: { warn: (message) => warnings.push(message), info: () => undefined },
    });
    await vi.waitFor(() => {
      expect(names).toEqual(['a.bin:downloading', 'Caffè.mkv:completed']);
    });

    expect(requests).toEqual(['GET /api/v1/events Bearer token']);
    expect(warnings).toEqual([]);
    stopped.abort();
    await done;
  });
});
