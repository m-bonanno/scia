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
  // Answers this many requests for a range other than the first byte with 204 No Content,
  // as a direct link of AllDebrid did while the service was, most likely, still fetching the
  // file from its hoster (#65).
  readonly noContent?: number;
  // Answers this many requests for the first byte with a 200 that carries that one byte, as
  // the same link did once: read as it stands, the file is one byte long (#65).
  readonly firstByteAs200?: number;
  // The Content-Type of every answer with a body: a page is `text/html`.
  readonly contentType?: string;
  // The ETag of every answer with a body; `"v1"` if absent.
  readonly etag?: string;
}

export interface RangeServer {
  readonly url: string;
  // The Range header of every request received, in order.
  readonly ranges: (string | undefined)[];
  // The User-Agent, Referer and Accept-Encoding of every request received, in order, with the
  // path and query it asked for.
  readonly asked: {
    readonly link: string | undefined;
    readonly range: string | undefined;
    readonly userAgent: string | undefined;
    readonly referer: string | undefined;
    readonly acceptEncoding: string | undefined;
  }[];
  // Every link asked for so far — a path and query — expires, as a direct link a service gives
  // does after a while: what it is sending is cut, and it answers `status` from now on. A link
  // asked for afterwards is good.
  expireLinks(status: number): void;
  // The bytes of bodies sent on a link, by its path and query.
  sentOn(link: string): number;
  close(): Promise<void>;
}

async function send(
  response: ServerResponse,
  body: Buffer,
  options: RangeServerOptions,
  mayDrop: () => boolean,
  onSent: (count: number) => void,
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
    onSent(chunk.length);
    if (options.chunkDelayMs !== undefined) await sleep(options.chunkDelayMs);
  }
  response.end();
}

// A real HTTP host on a free local port: the adapters are proven against sockets, not mocks.
export async function startRangeServer(options: RangeServerOptions): Promise<RangeServer> {
  const ranges: (string | undefined)[] = [];
  const asked: RangeServer['asked'][number][] = [];
  let drops = options.drops ?? 0;
  const mayDrop = () => {
    if (drops === 0) return false;
    drops -= 1;
    return true;
  };

  let noContent = options.noContent ?? 0;
  let firstByteAs200 = options.firstByteAs200 ?? 0;
  const expired = new Map<string, number>();
  const answering = new Map<ServerResponse, string>();
  const sent = new Map<string, number>();

  const server = createServer((request, response) => {
    const link = request.url ?? '';
    ranges.push(request.headers.range);
    asked.push({
      link: request.url,
      range: request.headers.range,
      userAgent: request.headers['user-agent'],
      referer: request.headers.referer,
      acceptEncoding: request.headers['accept-encoding'],
    });
    const status = options.status ?? expired.get(link);
    if (status !== undefined) {
      response.writeHead(status).end();
      return;
    }
    answering.set(response, link);
    response.on('close', () => answering.delete(response));
    const counted = (count: number) => {
      sent.set(link, (sent.get(link) ?? 0) + count);
    };
    const firstByte = request.headers.range === 'bytes=0-0';
    if (request.headers.range !== undefined && !firstByte && noContent > 0) {
      noContent -= 1;
      response.writeHead(204).end();
      return;
    }
    if (firstByte && firstByteAs200 > 0) {
      firstByteAs200 -= 1;
      response.writeHead(200, { 'content-length': '1' }).end(options.body.subarray(0, 1));
      return;
    }
    const headers: Record<string, string> = {
      etag: options.etag ?? '"v1"',
      ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
    };
    if (options.fileName !== undefined) {
      headers['content-disposition'] = `attachment; filename="${options.fileName}"`;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    if (range === null || options.ranges === false) {
      if (options.announcesLength !== false)
        headers['content-length'] = String(options.body.length);
      response.writeHead(200, headers);
      void send(response, options.body, options, mayDrop, counted);
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
    void send(response, slice, options, mayDrop, counted);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/files/sample.bin`,
    ranges,
    asked,
    expireLinks: (status) => {
      for (const each of asked) expired.set(each.link ?? '', status);
      for (const [response, link] of answering) {
        if (expired.has(link)) response.destroy();
      }
    },
    sentOn: (link) => sent.get(link) ?? 0,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
