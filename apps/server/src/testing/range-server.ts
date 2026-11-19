import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export interface RangeServerOptions {
  readonly body: Buffer;
  // False for a host that ignores Range and always sends the whole file.
  readonly ranges?: boolean;
  // False for a host that does not say how big the file is.
  readonly announcesLength?: boolean;
  readonly chunkBytes?: number;
  readonly chunkDelayMs?: number;
  readonly fileName?: string;
  // Cuts this many transfers, each after `dropAfterBytes` of its body.
  readonly drops?: number;
  readonly dropAfterBytes?: number;
  // Answers every request with this status and no body.
  readonly status?: number;
}

export interface RangeServer {
  readonly url: string;
  // The Range header of every request received, in order.
  readonly ranges: (string | undefined)[];
  close(): Promise<void>;
}

async function send(
  response: ServerResponse,
  body: Buffer,
  options: RangeServerOptions,
  mayDrop: () => boolean,
): Promise<void> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  let sent = 0;
  while (sent < body.length && !response.destroyed) {
    if (sent >= (options.dropAfterBytes ?? 0) && mayDrop()) {
      response.destroy();
      return;
    }
    const chunk = body.subarray(sent, sent + chunkBytes);
    if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve));
    sent += chunk.length;
    if (options.chunkDelayMs !== undefined) await sleep(options.chunkDelayMs);
  }
  response.end();
}

// A real HTTP host on a free local port: the adapters are proven against sockets, not mocks.
export async function startRangeServer(options: RangeServerOptions): Promise<RangeServer> {
  const ranges: (string | undefined)[] = [];
  let drops = options.drops ?? 0;
  const mayDrop = () => {
    if (drops === 0) return false;
    drops -= 1;
    return true;
  };

  const server = createServer((request, response) => {
    ranges.push(request.headers.range);
    if (options.status !== undefined) {
      response.writeHead(options.status).end();
      return;
    }
    const headers: Record<string, string> = { etag: '"v1"' };
    if (options.fileName !== undefined) {
      headers['content-disposition'] = `attachment; filename="${options.fileName}"`;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    if (range === null || options.ranges === false) {
      if (options.announcesLength !== false)
        headers['content-length'] = String(options.body.length);
      response.writeHead(200, headers);
      void send(response, options.body, options, mayDrop);
      return;
    }
    const start = Number(range[1]);
    const end = range[2] === '' ? options.body.length - 1 : Number(range[2]);
    if (start >= options.body.length) {
      response.writeHead(416, { 'content-range': `bytes */${String(options.body.length)}` }).end();
      return;
    }
    const slice = options.body.subarray(start, end + 1);
    response.writeHead(206, {
      ...headers,
      'content-length': String(slice.length),
      'content-range': `bytes ${String(start)}-${String(start + slice.length - 1)}/${String(options.body.length)}`,
    });
    void send(response, slice, options, mayDrop);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/files/sample.bin`,
    ranges,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
