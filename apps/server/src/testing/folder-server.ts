import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface FolderServerOptions {
  // What is served, by path under `/`.
  readonly root: string;
  // Paths answered 503 the first time each is asked.
  readonly failOnce?: readonly string[];
  // A wait before every answer.
  readonly delayMs?: number;
}

export interface FolderServer {
  readonly url: string;
  // Every path asked, in order.
  readonly asked: string[];
  close(): Promise<void>;
}

// A real HTTP host that serves a folder, and a Range of a file when asked one: the HLS specs fetch
// their pieces from it, over a socket.
export async function startFolderServer(options: FolderServerOptions): Promise<FolderServer> {
  const root = resolve(options.root);
  const asked: string[] = [];
  const failing = new Set(options.failOnce ?? []);
  const server = createServer((request, response) => {
    void (async () => {
      let path: string;
      try {
        path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
      } catch {
        response.writeHead(400).end();
        return;
      }
      asked.push(path);
      if (failing.delete(path)) {
        response.writeHead(503).end();
        return;
      }
      if (options.delayMs !== undefined) await sleep(options.delayMs);
      // A request may name a whole address (`GET http://host/../../x`), whose `..` no leading
      // slash stops.
      const file = resolve(root, path.replace(/^[/\\]+/, ''));
      if (!file.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      let body: Buffer;
      try {
        body = await readFile(file);
      } catch {
        response.writeHead(404).end();
        return;
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      if (range === null) {
        response.writeHead(200, { 'content-length': body.length }).end(body);
        return;
      }
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), body.length - 1);
      response
        .writeHead(206, {
          'content-length': end - start + 1,
          'content-range': `bytes ${String(start)}-${String(end)}/${String(body.length)}`,
        })
        .end(body.subarray(start, end + 1));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    asked,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
