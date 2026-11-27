import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// A file of a simulated album: its page's slug, the id its page and the API know it by, and
// where its bytes are (a local host's link, which the API gives as its server and its path).
export interface SimulatedFile {
  readonly id: string;
  readonly slug: string;
  // The name it was uploaded with; the album may give only the name it is stored under.
  readonly original?: string;
  readonly name?: string;
  // What its own page's heading says, when not the name it was uploaded with.
  readonly heading?: string;
  readonly link: string;
}

export interface SimulatedAlbum {
  readonly title?: string;
  readonly files: readonly SimulatedFile[];
}

export interface BunkrServerOptions {
  // By id: the album at `/a/<id>`.
  readonly albums: Readonly<Record<string, SimulatedAlbum>>;
  // Paths answered with this status and no body, the API's (`/api/_001_v2`) and the signing
  // service's (`/sign`) among them. Read at every request: a spec changes it to mend the host.
  readonly status?: Record<string, number>;
  // A wait before every answer.
  readonly delayMs?: number;
  // Paths answered with a redirect to this address.
  readonly redirects?: Readonly<Record<string, string>>;
  // Paths answered with this page, as it stands.
  readonly pages?: Readonly<Record<string, string>>;
  // What the API answers instead of a file's server and path, and the signing service instead of
  // a signature.
  readonly apiAnswer?: string;
  readonly signAnswer?: string;
  // By path, what the first requests to it meet, one each, in order: a status with no body (and a
  // `Retry-After`, when given), or a connection dropped before any answer. Then it answers.
  readonly troubles?: Readonly<
    Record<string, readonly ({ status: number; retryAfter?: string } | 'drop')[]>
  >;
}

export interface BunkrServer {
  // The site's address: albums at `<url>/a/<id>`, files at `<url>/f/<slug>`, its API at
  // `<url>/api/_001_v2` and its signing service at `<url>/sign`.
  readonly url: string;
  // Every request, in order.
  readonly asked: {
    readonly method: string | undefined;
    readonly path: string;
    // With its `?`, or empty.
    readonly query: string;
    readonly referer: string | undefined;
    readonly origin: string | undefined;
    readonly userAgent: string | undefined;
    readonly body: string;
    // On the clock that never steps.
    readonly atMs: number;
  }[];
  close(): Promise<void>;
}

// When the first signature expires, in seconds, as the signing service says it: each one after
// it a second later, so that a link signed again is a new address.
const FIRST_EXPIRY = 1_795_766_400;
// What signs a path here: Bunkr's own key is its file servers' and its signing service's.
const SIGNING_KEY = 'a key of the spec';

function tokenOf(path: string, expiry: string): string {
  return createHmac('sha256', SIGNING_KEY).update(`${path}\n${expiry}`).digest('hex').slice(0, 40);
}

// Whether a link a file server was asked — its path and query — carries the signature the
// signing service gives for its path: Bunkr's file servers answer 403 to any other (#398).
export function isSigned(link: string): boolean {
  const address = new URL(link, 'http://127.0.0.1');
  const token = address.searchParams.get('token');
  const expiry = address.searchParams.get('ex');
  return (
    token !== null &&
    expiry !== null &&
    token === tokenOf(decodeURIComponent(address.pathname), expiry)
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A string as Bunkr's script writes one: JSON, with `'` escaped as JavaScript allows (gallery-dl
// turns `\'` back into `'` before it reads it as JSON).
function scriptString(text: string): string {
  return JSON.stringify(text).replace(/'/g, "\\'");
}

// An album's page in the shape gallery-dl's reader of Bunkr reads (docs/adr/0024): its title in
// `og:title`, escaped twice, and its files in `window.albumFiles`, one field a line.
export function albumPageOf(album: SimulatedAlbum): string {
  const files = album.files.map((file) =>
    [
      '{',
      ` id: ${file.id},`,
      ` name: ${scriptString(file.name ?? `${file.slug}-0123456789ab.bin`)},`,
      ...(file.original === undefined ? [] : [` original: ${scriptString(file.original)},`]),
      ` slug: ${scriptString(file.slug)},`,
      ' type: "application/octet-stream",',
      ' size:  1234 ,',
      ' timestamp: "12:00:00 21/11/2026"',
      '}',
    ].join('\n'),
  );
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    ...(album.title === undefined
      ? []
      : [`<meta property="og:title" content="${escapeHtml(escapeHtml(album.title))}">`]),
    '<title>Bunkr</title>',
    '</head>',
    '<body>',
    '<span class="font-semibold">(1.2 KB)</span>',
    '<script>',
    'window.albumFiles = [',
    files.join(',\n'),
    '];',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

// A file's page, as gallery-dl reads one: its id in `data-file-id`, its name in the first `<h1>`,
// and its Download button to Bunkr's download page (#398). `name` is written as it stands: HTML,
// escaped or not.
export function filePageOf(file: { readonly id: string; readonly name: string }): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<body>',
    `<h1 class="text-subs font-semibold">${file.name}</h1>`,
    `<div id="fileTracker" data-file-id="${file.id}" style="display: none;"></div>`,
    `<a class="btn" href="https://dl.bunkr.cr/file/${file.id}" target="_blank">Download</a>`,
    '</body>',
    '</html>',
  ].join('\n');
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function idOf(body: string): string | undefined {
  try {
    const { id } = JSON.parse(body) as { id?: unknown };
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

// Where the API says a file is: its file server and its path there, and the name it was uploaded
// with. An id of no file is answered as Bunkr answered one on 27 November 2026: with no file
// server, and a name and a path of its own.
function whereOf(file: SimulatedFile | undefined): object {
  if (file === undefined) {
    return {
      mediafiles: '',
      original: 'dev_original.mp4',
      path: '/storage/media/dev_original_1.mp4',
    };
  }
  const link = new URL(file.link);
  return {
    mediafiles: link.origin,
    ...(file.original === undefined ? {} : { original: file.original }),
    path: link.pathname,
  };
}

// A real HTTP host that answers as Bunkr does, on a free local port. Never the real site. Its
// album and file pages as gallery-dl's source says (docs/adr/0024); its download page's API and
// signing service as Bunkr's own download page asked them on 27 November 2026 (#398).
export async function startBunkrServer(options: BunkrServerOptions): Promise<BunkrServer> {
  const asked: BunkrServer['asked'][number][] = [];
  const files = Object.values(options.albums).flatMap((album) => album.files);
  const troubles = new Map(
    Object.entries(options.troubles ?? {}).map(([path, list]) => [path, [...list]]),
  );
  let signatures = 0;
  const decoded = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  const server = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request);
      const address = request.url ?? '/';
      const path = address.split('?')[0] ?? '/';
      asked.push({
        method: request.method,
        path,
        query: address.slice(path.length),
        referer: request.headers.referer,
        origin: request.headers.origin,
        userAgent: request.headers['user-agent'],
        body,
        atMs: performance.now(),
      });
      // After the request is counted: a spec that sees it asked has the whole wait to act in.
      if (options.delayMs !== undefined) await sleep(options.delayMs);
      const trouble = troubles.get(path)?.shift();
      if (trouble === 'drop') {
        request.socket.destroy();
        return;
      }
      if (trouble !== undefined) {
        response
          .writeHead(
            trouble.status,
            trouble.retryAfter === undefined ? {} : { 'retry-after': trouble.retryAfter },
          )
          .end();
        return;
      }
      const status = options.status?.[path];
      if (status !== undefined) {
        response.writeHead(status).end();
        return;
      }
      const location = options.redirects?.[path];
      if (location !== undefined) {
        response.writeHead(302, { location }).end();
        return;
      }
      const html = (page: string) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
      };
      const page = options.pages?.[path];
      if (page !== undefined) {
        html(page);
        return;
      }
      const json = (answer: string) => {
        response.writeHead(200, { 'content-type': 'application/json' }).end(answer);
      };
      const refuse = (text: string) => {
        response.writeHead(400, { 'content-type': 'text/plain' }).end(`${text}\n`);
      };
      if (request.method === 'POST' && path === '/api/_001_v2') {
        const id = idOf(body);
        if (options.apiAnswer !== undefined) json(options.apiAnswer);
        else if (id === undefined) refuse('ID not provided');
        else json(JSON.stringify(whereOf(files.find((each) => each.id === id))));
        return;
      }
      if (request.method === 'GET' && path === '/sign') {
        const signed = new URLSearchParams(address.slice(path.length)).get('path') ?? '';
        if (options.signAnswer !== undefined) {
          json(options.signAnswer);
          return;
        }
        if (signed === '') {
          refuse('path required');
          return;
        }
        const expiry = FIRST_EXPIRY + signatures;
        signatures += 1;
        json(JSON.stringify({ ex: expiry, token: tokenOf(signed, String(expiry)) }));
        return;
      }
      const album = /^\/a\/([^/]+)$/.exec(path);
      if (request.method === 'GET' && album !== null) {
        const found = options.albums[decoded(album[1] ?? '')];
        if (found === undefined) response.writeHead(404).end();
        else html(albumPageOf(found));
        return;
      }
      const file = /^\/[fvid]\/([^/]+)$/.exec(path);
      const found = files.find((each) => file?.[1] !== undefined && each.slug === decoded(file[1]));
      if (request.method === 'GET' && found !== undefined) {
        html(
          filePageOf({
            id: found.id,
            name: escapeHtml(found.heading ?? found.original ?? found.name ?? found.slug),
          }),
        );
        return;
      }
      response.writeHead(404).end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${String(port)}`;
  return {
    url,
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
